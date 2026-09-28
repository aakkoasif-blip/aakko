# Mobile App API additions (v5)

This backend remains compatible with the public website and adds mobile-app support.

## Added customer endpoints

- `POST /api/public/trips/:tripId/quote`
  - authoritative fare quote for passenger classes and currency
- `POST /api/public/bookings/:reference/claim`
  - verifies original phone/email and issues a new secure manage token for a new device
- `POST /api/public/bookings/:reference/push`
  - associates an Expo push token with that booking
- `POST /api/public/bookings/:reference/requests`
  - creates trip/date, seat, cancellation or refund requests

`GET /api/public/bookings/:reference` now also returns management requests and bank details when the booking payment method is bank transfer.

## Added staff endpoints

- `GET /api/admin/booking-requests`
- `POST /api/admin/booking-requests/:id`

Staff can mark a request approved/rejected/completed and add a reply. The customer receives an app push and the configured customer notification channel.

## Push events

The server sends Expo push notifications for:

- payment approved / booking confirmed
- payment rejected
- trip changed
- booking management request updated

WhatsApp and Telegram remain separate server-side integrations.