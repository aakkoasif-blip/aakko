# Nasru Speed Ferry Booking System v4

## Customer website
- Responsive desktop and mobile trip search
- Maldives timezone for display and date search
- Future scheduled trips only; cancelled/past trips cannot be booked
- Separate Tourist and Local fares
- Work Visa passengers automatically use the Local fare
- Adult / Child / Infant validation
- MVR and USD fares set independently
- Admin-managed USD → MVR exchange rate
- Live seat availability with 10-minute checkout holds
- Server validates seat range and blocks duplicate/taken seats
- Bank transfer, merchant/payment link, or cash/counter payment
- Secure Manage Booking using a cryptographic token or booking contact verification
- Receipt re-upload after rejection
- Receipt file-content validation for JPEG / PNG / PDF

## Payment & notification workflow
- Telegram Bot API sending
- WhatsApp Business Cloud API sending
- WhatsApp approved-template support for business-initiated messages
- Separate WhatsApp template settings for payment link, bank transfer, confirmation, admin alert, trip change, and rejection
- Admin new-booking alerts
- Admin receipt-upload alerts
- Secure mobile payment verification link
- Approve & Confirm / Reject after admin login
- Automatic customer confirmation after approval
- Bank-transfer customers receive bank details, not a gateway link
- Dynamic gateway payment-link connector
- HMAC-signed gateway webhook endpoint
- Failed webhook events remain retryable until processed
- Notification queue uses atomic database claiming and de-duplication
- Failed-message retry log; manual retry resets attempts

## Security
- scrypt salted password hashing using Node.js crypto
- Legacy SHA-256 password migration on successful login
- Persistent database-backed sessions
- Login rate limiting / temporary lockout
- No pre-filled admin password in the login screen
- Server-side permissions on admin routes
- Staff permissions for trips, payments, expenses, reports, settings, users, notifications, and audit log
- Integration secrets encrypted at rest with APP_SECRET
- Customer booking lookup no longer exposes passport/phone/email publicly
- Receipt files stored outside the public web directory
- CSP and secure response headers

## Accounting/data integrity
- Money is calculated and stored in integer minor units in the SQLite runtime
- PostgreSQL production schema uses NUMERIC monetary columns
- Per-passenger tax snapshots include tax profile code, name, classification and rate
- USD/MVR exchange-rate snapshot per booking line
- Work Visa fare class snapshot records that Local pricing was used
- Booking reference counter resets by Maldives date and includes a random anti-guessing suffix
- Financial reports use Maldives date boundaries

## Operations
- Company name, logo URL, TIN, contact details, bank accounts and branding editable by admin
- Speedboats and seat capacity
- Locations and routes
- Trips and fare tables
- Passenger manifest data
- Payments and verification
- Expenses
- Daily / date-range revenue, expense, GST and profit/loss reporting
- PDF and spreadsheet-compatible exports
- Audit log