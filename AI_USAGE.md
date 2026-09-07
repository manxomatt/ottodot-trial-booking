# AI usage

> Draft — rewrite anything here that does not match how you actually worked before submitting.

## Tools

- **Claude (Opus)** — the main tool. Used through a working session with shell and file access, so
  it could run the tests and the database itself rather than handing me code to paste.
- No other assistant was involved.

## What I used it for

- Talking through the seat-claim strategy before any code existed.
- Writing the schema, the booking service, the API routes, and the three plain pages.
- Writing the test suite, including the concurrent ones.
- A first draft of this README, which I then cut down.

What I did not delegate: the design decisions. When to take the seat, what happens to a payment we
can't honour, what to leave out — those I decided and the model implemented.

## Where AI clearly helped

The test suite. Once the invariants were settled, generating 19 tests covering duplicates,
capacity, payment failure, hold expiry, webhook replay and two flavours of concurrency took
minutes rather than an hour. Writing genuinely concurrent tests by hand — twelve simultaneous
bookings against one seat, asserting on how each one failed — is exactly the tedious work I would
have cut for time otherwise, and it is the work that proves the feature.

## Where I disagreed with it

Two places.

**The first design would have quietly serialised every booking.** The initial implementation swept
expired holds at the top of every booking transaction. That sweep writes to the trial class row,
which takes a row lock, which means every parent booking that class queues behind it — a
correctness-by-accident that also throttles the busiest path in the product. I moved the sweep so
it only runs when a class actually looks full.

I only found it because I checked whether the race test could fail. I replaced the atomic seat
claim with a naive read-then-write and re-ran the suite, expecting red — and it stayed green. The
lock from the sweep was covering for the bug. A concurrency test that cannot fail is worse than no
test, because it tells you something reassuring that isn't true. With the sweep moved off the hot
path, the naive version fails exactly as it should:

```
× sells exactly one seat when many parents click at the same instant
  → expected [ 'CLASS_FULL', 'DUPLICATE_BOOKING' ] to include 'unexpected:new row for relation "trial_classes" violates check constraint'
```

**The second was about where the seat is claimed.** The straightforward reading of the brief is to
claim the seat when payment succeeds, which matches the narrative exactly. I went with holds
instead, because the version that matches the story most literally is the version where you take
money from a parent who then has no seat. Holds move the rejection to before the payment form,
where it costs nothing. The refund path still exists for the case where a hold expires, but it is
the rare branch rather than the normal one.

## What I would change about my AI workflow

Write the failing test first. I let it write the implementation and the tests together, which is
how a test ends up shaped to fit the code rather than to the requirement — and it is why the seat
claim went unverified for a while. Next time: state the invariant, ask for a test that fails
against an empty implementation, watch it fail, then build.

I would also ask for the design as prose before any code. The one design change that mattered here
(seat claim placement) came out of a conversation, not from reviewing a diff — and reviewing prose
is far cheaper than reviewing a thousand lines.

## How I verified the final implementation

- `npm test` — 19 tests against a real PostgreSQL database, not mocks. The concurrency tests use
  separate connections through the pool, so they exercise real Postgres locking.
- **Deliberately broke it.** Swapped the atomic seat claim for a read-then-write and confirmed the
  suite goes red, then restored it. Same idea for the capacity constraint: a test tries to oversell
  by writing directly to the table and asserts the database refuses.
- `npm run race-demo` — walks the three race scenarios against the real database and prints each
  step, including the refund flag.
- Manual pass over the HTTP surface with `curl`: booking, a rejected duplicate, a rejected full
  class, payment success and failure, and the roster afterwards.
- `npx tsc --noEmit` and a production `next build` both clean.
