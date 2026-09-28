# Nasru Speed v8 release notes

This release addresses the latest pre-launch audit.

## Fixed

- Passenger details on the public website are preserved when Adult / Child / Infant counts change.
- The backend now refuses any booking line with an empty passenger name.
- Login throttling no longer creates a global per-username lock that an attacker from another IP can use to lock the real administrator out. Limits are scoped to the real client IP and IP+username combination.
- Admin booking tables only format known timestamp fields as dates, so `status` and `payment_status` no longer render as `Invalid Date`.
- Password changes require 12+ characters, upper/lowercase, a number and a symbol, reject known example/default passwords, and reject reusing the current password. Validation failures return HTTP 400 with a clear message.
- Production first-start rejects the example ADMIN_INITIAL_PASSWORD instead of silently accepting it.
- The forced password-change page now includes Log Out.
- Mobile admin Settings now writes the actual server fields: `phone`, `email`, `tin`, `admin_notify_channels`, `admin_whatsapp_number`, and `admin_telegram_chat_id`.
- Mobile Verify Payment can securely load an uploaded receipt from the authenticated backend and display image receipts in-app.
- App fare choices now show separate Local, Work Visa, and Tourist options. Work Visa still resolves to the Local fare server-side.
- React Native is pinned to 0.81.5 for Expo 54.
- Expo web no longer calls SecureStore on web; it uses a web-safe storage fallback for preview/testing while native admin tokens remain in SecureStore.
- Saved guest booking access is also stored through the same secure/native storage abstraction.
- Public Manage Booking status labels are human readable rather than raw underscore codes.

## Release hygiene

The release ZIP does not contain `data/`, `uploads/`, a SQLite database, or default credentials. A fresh production install requires a strong `ADMIN_INITIAL_PASSWORD`.