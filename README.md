# Ottodot — Trial Booking Slice

A small, working slice of trial class booking: a parent picks a child and a trial slot, pays
(mock), and the class roster only ever contains children who actually have a seat.

Trials are capped at **4 students**. Everything here exists to keep that number honest under
duplicate submissions, failed payments, and two parents reaching for the same last seat.

---

## Running it

Requirements: Node 20+, Docker (or any PostgreSQL 14+).

```bash
cp .env.example .env.local

docker compose up -d        # Postgres on port 5433, plus the test database
npm install
npm run db:setup            # schema + synthetic data
npm run dev                 # http://localhost:3000
```

Then:

| Page | What it is |
| --- | --- |
| `/` | Parent view — pick a child, hold a seat |
| `/bookings/<id>` | Booking status + the mock payment step |
| `/admin` | Ops / teacher view — the roster for every trial class |

Verify the invariants without clicking anything:

```bash
npm test                    # 21 tests against a real Postgres database
npm run race-demo           # prints the three race scenarios, step by step
npm run expire-holds        # the background job, run by hand
npm run db:reset            # back to the seeded state
```

If you already run Postgres on 5432, this compose file uses **5433** so it won't collide.
Without Docker, point `DATABASE_URL` and `TEST_DATABASE_URL` at any two databases and run
`npm run db:setup` and `npm run db:setup -- --test`.

---

## What I built

- **Booking flow** — choose child → hold a seat → mock payment → status page.
- **Seat holds** with a TTL (10 minutes, `HOLD_TTL_MINUTES`), released by a background job and
  lazily whenever a class looks full.
- **Hold cancellation** — parents and ops/teachers can release a hold immediately, putting the seat back on sale.
- **Payment attempts** recorded separately from bookings, including declines and payments that
  could not be honoured.
- **Roster** — a page and a JSON endpoint, confirmed seats only.
- **Tests** — 21 of them, against a real database, including genuinely concurrent bookings.

Time spent: ~3.5 hours

---

## Backend design

### Data model

```
parents ──< students ──< bookings >── trial_classes
                            │
                            └──< payment_attempts
```

| Table | Notable columns |
| --- | --- |
| `parents` | `name`, `email` (unique) |
| `students` | `parent_id`, `name`, `grade` |
| `trial_classes` | `capacity` (4), **`seats_taken`**, `starts_at`, `teacher_name` |
| `bookings` | `student_id`, `trial_class_id`, `status`, `hold_expires_at`, `idempotency_key` |
| `payment_attempts` | `booking_id`, `status`, `provider_ref`, `failure_reason`, **`refund_required`** |

`seats_taken` counts seats that are *taken*, which means confirmed bookings **plus live holds**.
It is denormalised on purpose — see the race section below.

### Booking statuses

| Status | Meaning | Holds a seat? |
| --- | --- | --- |
| `pending_payment` | Seat held, waiting for the parent to pay | yes |
| `confirmed` | Paid, on the roster | yes |
| `payment_failed` | Payment declined, seat released | no |
| `expired` | Hold ran out before payment | no |
| `cancelled_no_seat` | Payment succeeded but the seat was gone — refund owed | no |
| `cancelled` | Cancelled by a parent or ops | no |

Only `confirmed` appears on a roster. Nothing else does, ever.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/classes` | Trial classes with seats free, confirmed count, seats on hold |
| `GET` | `/api/parents` | Parents and their children (stands in for an authenticated session) |
| `POST` | `/api/bookings` | Hold a seat. Accepts an `Idempotency-Key` header |
| `GET` | `/api/bookings/:id` | Booking status and the latest payment attempt |
| `DELETE` | `/api/bookings/:id` | Cancel hold and release seat back to inventory immediately |
| `POST` | `/api/bookings/:id/payment` | Mock payment callback: `{ outcome: 'success' \| 'failure' }` |
| `GET` | `/api/classes/:id/roster` | The roster — confirmed students, plus holds reported separately |

All of them are thin. The logic lives in `src/lib/bookings.ts`.

### How duplicates are prevented

A partial unique index, not an application check:

```sql
CREATE UNIQUE INDEX bookings_one_active_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'confirmed');
```

"Does this child already have a booking?" asked in application code is always racy — two requests
can both read "no" before either writes. The index cannot be raced, and being partial it only
covers *live* bookings, so a child whose payment failed can try again.

`Idempotency-Key` handles the other kind of duplicate: the same request arriving twice because a
parent double-clicked or the network retried. That returns the original booking rather than
holding a second seat.

### How payment failure is handled

Payment never writes to the roster directly. `settlePayment()` records an attempt whatever
happens, and only then decides what the booking becomes:

- **Declined** → booking becomes `payment_failed`, the seat is released in the same transaction,
  and the child is not on the roster. They can rebook immediately.
- **Succeeded, hold still valid** → `confirmed`. No second seat is taken; the hold already counted.
- **Succeeded, hold gone** → we try once to take any seat that is still free. If there is none, the
  booking becomes `cancelled_no_seat` and the payment row is flagged `refund_required`.

That last case is the uncomfortable one, and it is deliberate. It is better to owe someone a
refund than to put a fifth child in a class of four, which is a problem a teacher discovers live
in front of children.

### The last-seat race

**The approach.** A seat is taken when the parent starts checkout, not when their payment lands.
Taking it is one statement:

```sql
UPDATE trial_classes
   SET seats_taken = seats_taken + 1
 WHERE id = $1 AND seats_taken < capacity
```

Postgres evaluates `seats_taken < capacity` while holding the row lock. Two concurrent
transactions cannot both see the same free seat: the second waits for the first to commit, the
condition is re-checked against the new value, and it matches zero rows. No `SELECT ... FOR
UPDATE`, no advisory lock, no retry loop. If the seat is not taken, `INSERT` never runs.

The insert happens *after* the seat is taken, in the same transaction, so if the duplicate index
rejects the booking the rollback puts the seat straight back on sale.

Walking through the scenario in the brief:

1. **A selects the last seat** → seat taken, booking `pending_payment`, hold for 10 minutes.
2. **B selects the same slot** → the class has no free seat, so B is rejected with `CLASS_FULL`
   before touching a payment form. This is the outcome I want: fail before money, not after.
3. **B completes payment first** — only reachable if A's hold expired first (or A's payment
   failed), which released the seat and let B in. B is confirmed normally.
4. **A completes payment late** → A's hold is gone. We try once to take a free seat; there is
   none, so A's booking ends as `cancelled_no_seat` and A's payment is flagged for refund. The
   roster stays at 4 and contains B, not A.

**Why this and not the alternatives.** Optimistic locking on a version column needs a retry loop
and still ends with someone paying for a seat they can't have. `SERIALIZABLE` would work but
pushes serialisation failures into every caller for a problem that is one row wide. A
`SELECT ... FOR UPDATE` on the class row is correct but takes a write lock on the single hottest
row per class on *every* booking attempt, including the 99% that are nowhere near capacity.

**The tradeoffs I accepted.**

- `seats_taken` is denormalised, so it can in principle drift from the bookings table. I accepted
  that because every path that moves it does so in the same transaction as the booking row, and
  added a `CHECK (seats_taken <= capacity)` as a backstop — a bug in my service layer aborts the
  transaction rather than overselling. A reconciliation job (see "next") would close this properly.
- **Holds can waste seats.** A parent who opens checkout and walks away keeps a seat out of
  circulation for up to 10 minutes. That is the price of not charging people for seats they can't
  have. The TTL is the dial: shorter is more available, longer is friendlier on a slow phone.
- **`cancelled_no_seat` needs a human or a refund job.** I record it and flag it; I don't automate
  the refund.
- Expired holds are swept lazily (only when a class looks full) rather than at the top of every
  booking. The up-front sweep was my first version and it was worse: it writes to the class row,
  which serialises every booking attempt in that class behind one lock.

### Which check belongs where

| Layer | What it does | Why there |
| --- | --- | --- |
| **UI** | Greys out full classes, disables the pay button unless the booking is payable | Comfort only. Never trusted — the page is a snapshot from a second ago |
| **API route** | Shape validation, maps domain errors to status codes | Keeps invariants out of transport code |
| **Service (transaction)** | Seat claim, status transitions, payment recording | One place where the rules live, all inside a single transaction |
| **Database** | Partial unique index, `CHECK (seats_taken <= capacity)`, foreign keys | The only layer that cannot be raced or bypassed |
| **Background job** | Expiring holds; would also own refunds and reconciliation | Work that must happen when nobody is on the site |

---

## Assumptions

- No authentication. `/api/parents` stands in for a logged-in parent's session; ops pages are
  unprotected. Auth is orthogonal to what this test is asking about.
- One trial per child per class is the rule to enforce. A child booking trials in *different*
  classes is allowed — including math and science, which is exactly Ottodot's buy-one-get-one.
- Payment is mocked as a callback with an explicit outcome, so both paths are deterministic in
  tests. A real provider would post to the same handler; `provider_ref` is already the idempotency
  key for a replayed webhook.
- Prices are a flat 5000 cents. Nothing here depends on the amount.
- Timestamps are `timestamptz` and all comparisons use database `now()`, so nothing depends on the
  app server's clock.

## What I deliberately cut

- **Regular enrollment**, per the brief. Trial only.
- **Real payments, refunds, emails.** `refund_required` is a flag on a payment row and an ops
  queue waiting to be built, not a Stripe call.
- **Auth, roles, rate limiting.** Would be first on the list in a real service.
- **Waitlists.** A tempting answer to "the class is full" and completely out of scope here.
- **Frontend polish.** Three plain pages, no component library. The brief said backend correctness
  matters more, and I spent the time there.
- **Migration tooling.** One `schema.sql` that drops and recreates. Fine for a take-home, wrong for
  anything with real data in it.

## What I would monitor after release

- **Confirmed bookings per class over capacity** — should be zero, alert on the first one. Cheap
  query, and it is the invariant the whole product rests on.
- **`seats_taken` versus the real count of live bookings** — the drift check for the denormalised
  counter, run continuously.
- **`payment_attempts` where `refund_required` is true** — every row is a parent owed money. This
  should be a small trickle; a spike means holds are expiring too fast or the job is stuck.
- **Hold outcome ratio** — confirmed versus expired. A rising expiry rate is usually a broken
  payment step, not indecisive parents.
- **Age of the oldest unswept expired hold** — tells you the background job has died, which
  presents to users as "the class is full" when it isn't.
- **Booking failures by error code** — a jump in `CLASS_FULL` right after a marketing email is
  normal; a jump in `INTERNAL_ERROR` is not.

## What I would do next

1. **Real migrations** (`node-pg-migrate` or Drizzle) instead of a drop-and-recreate schema file.
2. **The refund path** — turn `refund_required` into an actual queue with retries and an ops view.
3. **A reconciliation job** that recomputes `seats_taken` from bookings and alerts on any drift,
   so the denormalised counter is verified rather than trusted.
4. **Auth and authorisation** — parents see only their children; the roster is staff-only.
5. **A waitlist**, so a released seat goes to someone rather than back into the void.
6. **Idempotency on the payment callback by booking**, not just by `provider_ref`, for providers
   that retry with a fresh reference.
7. **Load test on the hot path** — the interesting number is how the class row behaves when
   hundreds of parents hit one popular slot at 8pm.
