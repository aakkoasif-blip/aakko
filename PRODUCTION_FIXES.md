# Production audit fixes in v4

The following items from the production audit were addressed in this build.

## Must fix

1. **Duplicate notifications**
   - Queue rows are claimed atomically as `SENDING` inside a database transaction.
   - One in-process worker guard prevents overlapping local workers.
   - A normal-event de-duplication key prevents the same event from being queued repeatedly.
   - Stale `SENDING` claims are recovered for retry.

2. **Maldives timezone**
   - Server timezone is explicitly `Indian/Maldives`.
   - UI date/time formatting also explicitly uses `Indian/Maldives`.
   - Trip search, dashboard dates, report date ranges and booking reference dates use Maldives day boundaries.

3. **WhatsApp production templates**
   - Approved template names are configurable for payment links, confirmations, bank transfer instructions, admin alerts, trip changes and payment rejection.
   - Business-initiated WhatsApp messages use the template API when configured.
   - Free text is disabled by default.

4. **Public booking privacy**
   - Booking reference alone is insufficient.
   - Manage Booking requires a cryptographic manage token or the booking phone/email.
   - Public booking responses do not expose phone, email or passport/ID numbers.
   - References reset by Maldives date and include a random suffix.

5. **Receipt upload security**
   - Receipt upload requires booking authorization.
   - Server checks file magic bytes for JPEG, PNG or PDF instead of trusting MIME metadata.
   - Files remain outside the public web directory.

6. **Server-side staff permissions**
   - Read/write permissions are enforced on payments, trips, boats/locations, expenses, reports, notifications, settings, users and audit routes.
   - UI also hides unavailable admin sections, but backend checks remain authoritative.

7. **Free / unsupported tickets**
   - Only `MVR` and `USD` are accepted.
   - Only `ADULT`, `CHILD`, `INFANT` passenger types are accepted.
   - Only `LOCAL`, `WORK_VISA`, `TOURIST` fare classes are accepted.
   - Adult/child fares must be greater than zero; infant fares may be zero.

8. **Cancelled/past trips and invalid seats**
   - Past, cancelled or closed trips cannot be booked.
   - Seat numbers must be within the assigned boat capacity.
   - Taken/held seats are rejected server-side.

9. **Receipt re-upload after rejection**
   - A rejected bank-transfer attempt remains immutable.
   - A new receipt creates a fresh pending payment attempt.

10. **Rejected payment cannot later be approved**
    - Approval is allowed only for `PENDING` or `RECEIPT_SUBMITTED` payments.

11. **Manual notification retry**
    - Manual retry resets `attempts` to zero and requeues the message immediately.

12. **Webhook retry/idempotency**
    - Only `PROCESSED` events are considered final duplicates.
    - Failed events can be retried with the same event ID.
    - If a payment was already confirmed before a worker/webhook crash, a retry safely records the event as processed.

13. **Login security**
    - Passwords use salted scrypt hashes.
    - Legacy SHA-256 hashes are upgraded after successful login.
    - Failed logins are rate-limited and temporarily blocked after repeated failures.
    - The login form is not pre-filled.
    - Sessions are stored in the database and survive application restarts.

## Should fix

- Bank-transfer bookings show/send bank details and do not create a gateway link.
- Seat availability is shown before submission and checkout seats are held temporarily.
- New money calculations use integer minor units in the SQLite runtime; PostgreSQL reference schema uses `NUMERIC`.
- Booking-line tax profile code, name, classification and rate are snapshotted.
- Trip updates merge fields instead of blanking omitted values.
- Operational trip changes warn how many booked passengers are affected and notify all active bookings after confirmation.
- Customer Home / Manage Booking navigation remains visible on mobile.
- Admin navigation scrolls horizontally on mobile and wide tables remain horizontally scrollable.

## Local / tourist pricing

- `TOURIST` has its own fare table.
- `LOCAL` has its own fare table.
- `WORK_VISA` is stored as the passenger classification but automatically prices from the `LOCAL` fare table.
- The booking-line snapshot records both the passenger classification and which fare class was actually used.


## v6 audit fixes
- Release database removed.
- Password-change-required is server-enforced.
- Passenger form values survive seat changes.
- Login rate limiting ignores spoofed X-Forwarded-For and also limits by username.
- Public availability subtracts live seat holds.
- Receipt submitted state is visible and upload is hidden while awaiting verification.
- Mobile admin tables include a swipe cue and tighter layout.