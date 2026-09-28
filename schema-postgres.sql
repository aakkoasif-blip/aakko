-- Nasru Speed Ferry Booking System v4
-- PostgreSQL reference schema for future runtime migration.
-- Monetary values use NUMERIC; application should still calculate with decimal-safe logic.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  password_change_required boolean NOT NULL DEFAULT false
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE login_attempts (
  login_key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_started_at bigint NOT NULL,
  blocked_until bigint NOT NULL DEFAULT 0
);

CREATE TABLE boats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  reg_no text,
  code text,
  seat_capacity integer NOT NULL CHECK (seat_capacity > 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  island text,
  atoll text,
  jetty_name text,
  map_url text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE')),
  rate numeric(7,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  EXCLUDE USING gist (
    code WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (active)
);

CREATE TABLE exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency text NOT NULL,
  to_currency text NOT NULL DEFAULT 'MVR',
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'MANUAL',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_no text UNIQUE NOT NULL,
  boat_id uuid NOT NULL REFERENCES boats(id),
  departure_location_id uuid NOT NULL REFERENCES locations(id),
  arrival_location_id uuid NOT NULL REFERENCES locations(id),
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  price_includes_tax boolean NOT NULL DEFAULT true,
  tax_profile_id uuid REFERENCES tax_profiles(id),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','BOARDING','DEPARTED','COMPLETED','DELAYED','CANCELLED')),
  CHECK (arrival_at > departure_at)
);

CREATE TABLE fares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  passenger_type text NOT NULL CHECK (passenger_type IN ('ADULT','CHILD','INFANT')),
  residency_class text NOT NULL CHECK (residency_class IN ('LOCAL','TOURIST')),
  currency text NOT NULL CHECK (currency IN ('MVR','USD')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (trip_id, passenger_type, residency_class, currency)
);

CREATE TABLE booking_sequences (
  book_date date PRIMARY KEY,
  seq integer NOT NULL CHECK (seq > 0)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  trip_id uuid NOT NULL REFERENCES trips(id),
  customer_name text NOT NULL,
  phone text,
  email text,
  telegram_chat_id text,
  manage_token_hash text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('MVR','USD')),
  status text NOT NULL,
  payment_status text NOT NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  total_mvr numeric(14,2) NOT NULL CHECK (total_mvr >= 0),
  exchange_rate_snapshot numeric(18,6) NOT NULL CHECK (exchange_rate_snapshot > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_trip_idx ON bookings(trip_id);
CREATE INDEX bookings_created_idx ON bookings(created_at);

CREATE TABLE booking_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_name text NOT NULL,
  passenger_type text NOT NULL CHECK (passenger_type IN ('ADULT','CHILD','INFANT')),
  residency_class text NOT NULL CHECK (residency_class IN ('LOCAL','WORK_VISA','TOURIST')),
  fare_residency_snapshot text NOT NULL CHECK (fare_residency_snapshot IN ('LOCAL','TOURIST')),
  nationality text,
  passport_no text,
  seat_no integer NOT NULL CHECK (seat_no > 0),
  currency text NOT NULL CHECK (currency IN ('MVR','USD')),
  unit_fare numeric(14,2) NOT NULL CHECK (unit_fare >= 0),
  price_includes_tax_snapshot boolean NOT NULL,
  tax_profile_code_snapshot text NOT NULL,
  tax_classification_snapshot text NOT NULL,
  tax_name_snapshot text NOT NULL,
  gst_rate_snapshot numeric(7,4) NOT NULL CHECK (gst_rate_snapshot >= 0),
  taxable_amount numeric(14,2) NOT NULL CHECK (taxable_amount >= 0),
  gst_amount numeric(14,2) NOT NULL CHECK (gst_amount >= 0),
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  exchange_rate_snapshot numeric(18,6) NOT NULL CHECK (exchange_rate_snapshot > 0),
  mvr_taxable_amount numeric(14,2) NOT NULL CHECK (mvr_taxable_amount >= 0),
  mvr_gst_amount numeric(14,2) NOT NULL CHECK (mvr_gst_amount >= 0),
  mvr_gross_amount numeric(14,2) NOT NULL CHECK (mvr_gross_amount >= 0)
);
CREATE UNIQUE INDEX active_trip_seat_placeholder_idx ON booking_lines(booking_id, seat_no);

CREATE TABLE seat_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_no integer NOT NULL CHECK (seat_no > 0),
  checkout_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, seat_no)
);
CREATE INDEX seat_holds_expiry_idx ON seat_holds(expires_at);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  method text NOT NULL CHECK (method IN ('PAYMENT_LINK','BANK_TRANSFER','CASH')),
  provider text,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency IN ('MVR','USD')),
  payment_link text,
  external_reference text,
  receipt_url text,
  status text NOT NULL CHECK (status IN ('PENDING','RECEIPT_SUBMITTED','REJECTED','PAID','FAILED','EXPIRED','REFUNDED')),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  rejected_by uuid REFERENCES users(id),
  rejected_at timestamptz,
  rejection_reason text,
  gateway_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL,
  category text NOT NULL,
  description text,
  amount_mvr numeric(14,2) NOT NULL CHECK (amount_mvr >= 0),
  payment_method text,
  trip_id uuid REFERENCES trips(id),
  boat_id uuid REFERENCES boats(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id),
  channel text NOT NULL CHECK (channel IN ('TELEGRAM','WHATSAPP')),
  recipient text NOT NULL,
  subject text,
  message text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED','SENDING','RETRY','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  provider_message_id text,
  dedupe_key text UNIQUE,
  template_name text,
  template_params jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_worker_idx ON notifications(status, next_attempt_at, created_at);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_key text UNIQUE NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING','FAILED','PROCESSED')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at);