-- Ottodot trial booking — schema
--
-- Design note: every invariant that protects money or the roster is enforced by
-- the database, not by application code. Application-level "check then insert"
-- is always racy; a constraint is not.
--
--   1. No duplicate active booking per (student, class)  -> partial unique index
--   2. Never more than `capacity` seats taken            -> counter + CHECK constraint
--   3. A seat is only ever held by exactly one booking   -> the counter is moved
--                                                           inside the same transaction
--                                                           that creates/settles the booking

DROP TABLE IF EXISTS payment_attempts CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS trial_classes CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS parents CASCADE;
DROP TYPE IF EXISTS booking_status CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pending_payment  : seat is held, waiting for the parent to pay
-- confirmed        : paid, on the roster
-- payment_failed   : payment declined, seat released
-- expired          : hold ran out before payment, seat released
-- cancelled_no_seat: payment succeeded but the seat was gone (needs refund)
-- cancelled        : cancelled by parent or admin
CREATE TYPE booking_status AS ENUM (
  'pending_payment',
  'confirmed',
  'payment_failed',
  'expired',
  'cancelled_no_seat',
  'cancelled'
);

CREATE TYPE payment_status AS ENUM ('succeeded', 'failed');

CREATE TABLE parents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  name       text NOT NULL,
  grade      int  NOT NULL CHECK (grade BETWEEN 1 AND 6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX students_parent_idx ON students(parent_id);

CREATE TABLE trial_classes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject      text NOT NULL CHECK (subject IN ('math', 'science')),
  title        text NOT NULL,
  teacher_name text NOT NULL,
  starts_at    timestamptz NOT NULL,
  capacity     int NOT NULL DEFAULT 4 CHECK (capacity > 0),

  -- Denormalised seat counter. It counts seats that are *taken*, which means
  -- both confirmed bookings and live holds. It is only ever moved by
  -- conditional UPDATEs inside the booking transaction, so it cannot drift
  -- from the bookings table without the transaction rolling back.
  seats_taken  int NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- The hard stop. Even a bug in the service layer cannot oversell a class:
  -- the transaction that would take a fifth seat aborts here.
  CONSTRAINT trial_classes_seats_within_capacity
    CHECK (seats_taken >= 0 AND seats_taken <= capacity)
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  trial_class_id  uuid NOT NULL REFERENCES trial_classes(id) ON DELETE CASCADE,
  status          booking_status NOT NULL DEFAULT 'pending_payment',

  -- When the hold lapses. NULL once the booking is settled (confirmed or dead).
  hold_expires_at timestamptz,

  -- Lets a retried client request return the original booking instead of
  -- creating a second one.
  idempotency_key text UNIQUE,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- INVARIANT 1: one child cannot hold or own two seats in the same class.
-- Partial, so a failed/expired/cancelled attempt does not block a genuine retry.
CREATE UNIQUE INDEX bookings_one_active_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'confirmed');

-- Supports both the background expiry job and the lazy sweep on read.
CREATE INDEX bookings_expiring_idx
  ON bookings (hold_expires_at)
  WHERE status = 'pending_payment';

CREATE INDEX bookings_class_status_idx ON bookings (trial_class_id, status);

CREATE TABLE payment_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount_cents    int NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL DEFAULT 'SGD',
  status          payment_status NOT NULL,
  provider_ref    text,
  failure_reason  text,

  -- Set when we captured money we could not honour with a seat. This is the
  -- queue an ops person (or a refund job) works from.
  refund_required boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A payment provider retrying its webhook must not create a second attempt row.
CREATE UNIQUE INDEX payment_attempts_provider_ref_key
  ON payment_attempts (provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE INDEX payment_attempts_booking_idx ON payment_attempts (booking_id);
CREATE INDEX payment_attempts_refunds_idx ON payment_attempts (created_at)
  WHERE refund_required;
