-- Synthetic data. Fixed UUIDs so the README's curl examples and the video
-- walkthrough always refer to the same rows.
--
-- Covers the four cases the brief asks for:
--   C1  a class with available seats               (0 / 4 taken)
--   C2  a class with exactly 3 confirmed students  (the last-seat demo)
--   C3  a class that is already full               (4 / 4 taken)
--   C4  a class that already saw a payment failure (failed booking, seat released)
--       plus a child already confirmed in C1, to demo the duplicate rule

TRUNCATE payment_attempts, bookings, trial_classes, students, parents RESTART IDENTITY CASCADE;

INSERT INTO parents (id, name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Mei Ling Tan',  'meiling@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'Arjun Rao',     'arjun@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'Siti Rahman',   'siti@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'Daniel Wong',   'daniel@example.com');

INSERT INTO students (id, parent_id, name, grade) VALUES
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Chloe Tan',    4),
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Ethan Tan',    2),
  ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Kiran Rao',    5),
  ('a3333333-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Aisyah Rahman',3),
  ('a4444444-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Marcus Wong',  4),
  ('a4444444-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Olivia Wong',  6);

INSERT INTO trial_classes (id, subject, title, teacher_name, starts_at, capacity, seats_taken) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'math',    'P4 Math Trial — Fractions',        'Ms. Jaryn',    now() + interval '3 days',  4, 1),
  ('c0000000-0000-0000-0000-000000000002', 'science', 'P5 Science Trial — Electricity',   'Mr. Iskandar', now() + interval '4 days',  4, 3),
  ('c0000000-0000-0000-0000-000000000003', 'math',    'P3 Math Trial — Multiplication',   'Ms. Clarrie',  now() + interval '5 days',  4, 4),
  ('c0000000-0000-0000-0000-000000000004', 'science', 'P6 Science Trial — Human Body',    'Mr. Shengdi',  now() + interval '6 days',  4, 1);

-- C1: one confirmed child. Chloe is already in, so booking her again must be rejected.
INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'confirmed', NULL);

-- C2: exactly three confirmed. One seat left — this is the class used for the race demo.
INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a2222222-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'confirmed', NULL),
  ('b0000000-0000-0000-0000-000000000003', 'a3333333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'confirmed', NULL),
  ('b0000000-0000-0000-0000-000000000004', 'a4444444-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'confirmed', NULL);

-- C3: full.
INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at) VALUES
  ('b0000000-0000-0000-0000-000000000005', 'a1111111-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'confirmed', NULL),
  ('b0000000-0000-0000-0000-000000000006', 'a2222222-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'confirmed', NULL),
  ('b0000000-0000-0000-0000-000000000007', 'a3333333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'confirmed', NULL),
  ('b0000000-0000-0000-0000-000000000008', 'a4444444-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'confirmed', NULL);

-- C4: one confirmed, plus a booking whose payment was declined. The failed
-- booking holds no seat (seats_taken is 1, not 2) and does not block a retry.
INSERT INTO bookings (id, student_id, trial_class_id, status, hold_expires_at) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'a1111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'confirmed',      NULL),
  ('b0000000-0000-0000-0000-00000000000a', 'a4444444-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 'payment_failed', NULL);

INSERT INTO payment_attempts (booking_id, amount_cents, status, provider_ref, failure_reason) VALUES
  ('b0000000-0000-0000-0000-000000000001', 5000, 'succeeded', 'mock_seed_001', NULL),
  ('b0000000-0000-0000-0000-000000000002', 5000, 'succeeded', 'mock_seed_002', NULL),
  ('b0000000-0000-0000-0000-000000000003', 5000, 'succeeded', 'mock_seed_003', NULL),
  ('b0000000-0000-0000-0000-000000000004', 5000, 'succeeded', 'mock_seed_004', NULL),
  ('b0000000-0000-0000-0000-000000000005', 5000, 'succeeded', 'mock_seed_005', NULL),
  ('b0000000-0000-0000-0000-000000000006', 5000, 'succeeded', 'mock_seed_006', NULL),
  ('b0000000-0000-0000-0000-000000000007', 5000, 'succeeded', 'mock_seed_007', NULL),
  ('b0000000-0000-0000-0000-000000000008', 5000, 'succeeded', 'mock_seed_008', NULL),
  ('b0000000-0000-0000-0000-000000000009', 5000, 'succeeded', 'mock_seed_009', NULL),
  ('b0000000-0000-0000-0000-00000000000a', 5000, 'failed',    'mock_seed_00a', 'card_declined');
