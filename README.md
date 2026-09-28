# Nasru Speed Ferry Booking System v5

This is the website/backend build required by the Nasru Speed mobile app v2.

It includes the production fixes from v4 plus mobile customer support:

- server-authoritative fare quotes
- local / work-visa and tourist fare classes
- seat holds and seat validation
- payment link + webhook flow
- bank transfer receipts and admin verification
- secure manage tokens
- existing-booking recovery using matching phone/email
- customer device push-token registration
- Expo push notifications
- booking change/cancel/refund requests
- admin request status updates
- WhatsApp / Telegram customer and admin messaging

## Run

```bash
cp .env.example .env
node server.mjs
```

Production should run behind Nginx/HTTPS on DigitalOcean with `NODE_ENV=production` and a strong `ADMIN_INITIAL_PASSWORD` on first initialization.

See `DEPLOY_DIGITALOCEAN.md` and `APP_API_V5.md`.


## v6 launch hardening
The release ZIP intentionally contains no `data/` directory or database. First start creates a fresh database and requires `ADMIN_INITIAL_PASSWORD`. Accounts marked `password_change_required` cannot access any admin endpoint except password change/logout. Login IP handling ignores client `X-Forwarded-For`; with local Nginx it accepts only Nginx-provided `X-Real-IP`.