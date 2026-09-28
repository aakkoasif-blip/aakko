import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const MALDIVES_TZ = 'Indian/Maldives';
process.env.TZ = MALDIVES_TZ;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny .env loader. No npm dependency required.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const DB_FILE = path.join(__dirname, 'data', 'nasru-speed.db');
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function addColumn(table, def) {
  const name = def.trim().split(/\s+/)[0];
  if (!q(`PRAGMA table_info(${table})`).some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
}
function safeJson(s, fallback = {}) { try { return JSON.parse(s); } catch { return fallback; } }
function boolish(v) { return ['1','true','yes','on'].includes(String(v ?? '').toLowerCase()); }
function normalizePhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function constantEqual(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function roundDivBigInt(n, d) { return (n + d / 2n) / d; }
function parseMoney(v) {
  const s = String(v ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money amount: ${s}`);
  const neg = s.startsWith('-'); const clean = neg ? s.slice(1) : s;
  const [a,b=''] = clean.split('.'); const cents = BigInt(a) * 100n + BigInt((b + '00').slice(0,2));
  const n = neg ? -cents : cents;
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Amount is too large');
  return Number(n);
}
function minorToMajor(n) { return Number(n || 0) / 100; }
function rateMicros(v) {
  const s = String(v ?? '0').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(s)) throw new Error('Invalid exchange rate');
  const [a,b=''] = s.split('.'); return BigInt(a) * 1_000_000n + BigInt((b + '000000').slice(0,6));
}
function percentBasisPoints(v) {
  const s = String(v ?? '0').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Invalid tax rate');
  const [a,b=''] = s.split('.'); return BigInt(a) * 100n + BigInt((b + '00').slice(0,2));
}
function calcTaxMinor(unitMinor, ratePercent, includesTax) {
  const rateBp = percentBasisPoints(ratePercent);
  const u = BigInt(unitMinor);
  if (includesTax) {
    const gst = rateBp === 0n ? 0n : roundDivBigInt(u * rateBp, 10000n + rateBp);
    const taxable = u - gst;
    return { unit_minor:Number(u), taxable_minor:Number(taxable), gst_minor:Number(gst), gross_minor:Number(u) };
  }
  const gst = rateBp === 0n ? 0n : roundDivBigInt(u * rateBp, 10000n);
  return { unit_minor:Number(u), taxable_minor:Number(u), gst_minor:Number(gst), gross_minor:Number(u + gst) };
}
function convertUsdMinorToMvrMinor(usdMinor, rate) {
  return Number(roundDivBigInt(BigInt(usdMinor) * rateMicros(rate), 1_000_000n));
}

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone:MALDIVES_TZ, year:'numeric', month:'2-digit', day:'2-digit' });
function maldivesDate(d = new Date()) {
  const parts = Object.fromEntries(dateFmt.formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function maldivesDateCompact(d = new Date()) { return maldivesDate(d).replaceAll('-', ''); }
function fmtDateTime(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone:MALDIVES_TZ, dateStyle:'medium', timeStyle:'short' }).format(new Date(v));
}
function fmtDate(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone:MALDIVES_TZ, dateStyle:'medium' }).format(new Date(v));
}
function fmtTime(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone:MALDIVES_TZ, hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(v));
}
function maldivesUtcRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Invalid date');
  const start = new Date(`${date}T00:00:00+05:00`);
  const end = new Date(start.getTime() + 86400000);
  return [start.toISOString(), end.toISOString()];
}

function validateStrongPassword(password, { currentPassword='', allowInitial=false } = {}) {
  const p=String(password||'');
  if(p.length<12) throw Object.assign(new Error('Password must be at least 12 characters'),{status:400});
  if(!/[a-z]/.test(p)||!/[A-Z]/.test(p)||!/[0-9]/.test(p)||!/[^A-Za-z0-9]/.test(p)) throw Object.assign(new Error('Password must include uppercase, lowercase, a number and a symbol'),{status:400});
  if(currentPassword && p===String(currentPassword)) throw Object.assign(new Error('New password must be different from the current password'),{status:400});
  const bad=['changeme123!','password123!','replace-with-a-strong-unique-password','replace_with_a_strong_unique_password','change_this_before_first_start','admin123!','admin123456!'];
  if(!allowInitial && bad.includes(p.toLowerCase())) throw Object.assign(new Error('Choose a unique password instead of a default or example password'),{status:400});
  return p;
}
function passwordHash(password, options={}) {
  const valid=validateStrongPassword(password,options);
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(valid, salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}
function verifyPassword(stored, password) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [,salt,hex] = stored.split('$');
    const got = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return constantEqual(got, hex);
  }
  // Legacy SHA-256 migration path.
  if (/^[a-f0-9]{64}$/i.test(stored)) return constantEqual(sha256(password), stored);
  return false;
}

function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, name TEXT, role TEXT, permissions TEXT, active INTEGER DEFAULT 1, password_change_required INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS login_attempts(login_key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS boats(id TEXT PRIMARY KEY, name TEXT, reg_no TEXT, code TEXT, seat_capacity INTEGER, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY, name TEXT, island TEXT, atoll TEXT, jetty_name TEXT, map_url TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS tax_profiles(id TEXT PRIMARY KEY, code TEXT, name TEXT, classification TEXT, rate TEXT, effective_from TEXT, effective_to TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS exchange_rates(id TEXT PRIMARY KEY, currency TEXT, to_currency TEXT, rate TEXT, source TEXT, effective_from TEXT, effective_to TEXT, active INTEGER DEFAULT 1, created_at TEXT);
  CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, trip_no TEXT UNIQUE, boat_id TEXT, departure_location_id TEXT, arrival_location_id TEXT, departure_at TEXT, arrival_at TEXT, adult_mvr REAL, adult_usd REAL, child_mvr REAL, child_usd REAL, infant_mvr REAL, infant_usd REAL, price_includes_tax INTEGER DEFAULT 1, tax_profile_id TEXT, status TEXT DEFAULT 'SCHEDULED');
  CREATE TABLE IF NOT EXISTS fares(id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, passenger_type TEXT NOT NULL, residency_class TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, active INTEGER DEFAULT 1, UNIQUE(trip_id, passenger_type, residency_class, currency), FOREIGN KEY(trip_id) REFERENCES trips(id));
  CREATE TABLE IF NOT EXISTS booking_sequences(book_date TEXT PRIMARY KEY, seq INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, reference TEXT UNIQUE, trip_id TEXT, customer_name TEXT, phone TEXT, email TEXT, currency TEXT, status TEXT, payment_status TEXT, total_amount REAL, total_mvr REAL, exchange_rate_snapshot REAL, created_at TEXT, telegram_chat_id TEXT, manage_token_hash TEXT, total_minor INTEGER, total_mvr_minor INTEGER);
  CREATE TABLE IF NOT EXISTS booking_lines(id TEXT PRIMARY KEY, booking_id TEXT, passenger_name TEXT, passenger_type TEXT, nationality TEXT, passport_no TEXT, seat_no TEXT, currency TEXT, unit_fare REAL, price_includes_tax_snapshot INTEGER, gst_rate_snapshot REAL, taxable_amount REAL, gst_amount REAL, gross_amount REAL, exchange_rate_snapshot REAL, mvr_taxable_amount REAL, mvr_gst_amount REAL, mvr_gross_amount REAL, residency_class TEXT, fare_residency_snapshot TEXT, tax_profile_code_snapshot TEXT, tax_classification_snapshot TEXT, tax_name_snapshot TEXT, unit_fare_minor INTEGER, taxable_minor INTEGER, gst_minor INTEGER, gross_minor INTEGER, mvr_taxable_minor INTEGER, mvr_gst_minor INTEGER, mvr_gross_minor INTEGER);
  CREATE TABLE IF NOT EXISTS passenger_tickets(id TEXT PRIMARY KEY, booking_line_id TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL, token_enc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', scan_count INTEGER NOT NULL DEFAULT 0, last_scanned_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(booking_line_id) REFERENCES booking_lines(id));
  CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, booking_id TEXT, method TEXT, provider TEXT, amount REAL, currency TEXT, payment_link TEXT, external_reference TEXT, receipt_url TEXT, status TEXT, verified_by TEXT, verified_at TEXT, created_at TEXT, rejected_by TEXT, rejected_at TEXT, rejection_reason TEXT, gateway_payload TEXT, amount_minor INTEGER);
  CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY, expense_date TEXT, category TEXT, description TEXT, amount_mvr REAL, payment_method TEXT, trip_id TEXT, boat_id TEXT, created_at TEXT, amount_mvr_minor INTEGER);
  CREATE TABLE IF NOT EXISTS seat_holds(id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, seat_no TEXT NOT NULL, checkout_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(trip_id, seat_no));
  CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, booking_id TEXT, channel TEXT, recipient TEXT, subject TEXT, message TEXT, status TEXT, created_at TEXT, kind TEXT DEFAULT 'GENERAL', attempts INTEGER DEFAULT 0, next_attempt_at TEXT, last_error TEXT, sent_at TEXT, provider_message_id TEXT, claimed_at TEXT, dedupe_key TEXT, template_name TEXT, template_params_json TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, actor TEXT, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, provider TEXT, event_key TEXT UNIQUE, payload TEXT, status TEXT, last_error TEXT, created_at TEXT, processed_at TEXT);
  CREATE TABLE IF NOT EXISTS customer_devices(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, push_token TEXT NOT NULL, platform TEXT DEFAULT 'EXPO', active INTEGER DEFAULT 1, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(booking_id,push_token));
  CREATE TABLE IF NOT EXISTS booking_requests(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', admin_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);

  // Migration columns for databases created by older builds.
  addColumn('users','password_change_required INTEGER DEFAULT 0');
  addColumn('bookings','telegram_chat_id TEXT'); addColumn('bookings','manage_token_hash TEXT'); addColumn('bookings','total_minor INTEGER'); addColumn('bookings','total_mvr_minor INTEGER');
  for (const def of ['residency_class TEXT','fare_residency_snapshot TEXT','tax_profile_code_snapshot TEXT','tax_classification_snapshot TEXT','tax_name_snapshot TEXT','unit_fare_minor INTEGER','taxable_minor INTEGER','gst_minor INTEGER','gross_minor INTEGER','mvr_taxable_minor INTEGER','mvr_gst_minor INTEGER','mvr_gross_minor INTEGER']) addColumn('booking_lines',def);
  for (const def of ['rejected_by TEXT','rejected_at TEXT','rejection_reason TEXT','gateway_payload TEXT','amount_minor INTEGER']) addColumn('payments',def);
  addColumn('expenses','amount_mvr_minor INTEGER');
  for (const def of ["kind TEXT DEFAULT 'GENERAL'",'attempts INTEGER DEFAULT 0','next_attempt_at TEXT','last_error TEXT','sent_at TEXT','provider_message_id TEXT','claimed_at TEXT','dedupe_key TEXT','template_name TEXT','template_params_json TEXT']) addColumn('notifications',def);
  addColumn('webhook_events','last_error TEXT'); addColumn('webhook_events','processed_at TEXT');

  seedMissingSettings();
  if (!one('SELECT COUNT(*) c FROM users').c) seed();
  migrateLegacyFares();
}

function setSetting(key, value) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value ?? '')); }
function getSetting(key, fallback='') { return one('SELECT value FROM settings WHERE key=?', key)?.value ?? fallback; }
function boolSetting(key, fallback=false) { return boolish(getSetting(key, fallback ? '1' : '0')); }
function seedMissingSettings() {
  const defaults = {
    public_base_url: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`,
    timezone:MALDIVES_TZ,
    admin_notify_channels:'TELEGRAM', admin_whatsapp_number:'', admin_telegram_chat_id:'',
    notify_admin_new_booking:'1', notify_admin_receipt:'1', notify_customer_payment_link:'1', notify_customer_confirmation:'1',
    whatsapp_enabled:'0', whatsapp_phone_number_id:'', whatsapp_graph_version:'v23.0', whatsapp_template_language:'en_US',
    whatsapp_payment_template:'', whatsapp_confirmation_template:'', whatsapp_bank_transfer_template:'', whatsapp_admin_alert_template:'', whatsapp_trip_change_template:'', whatsapp_rejected_template:'', whatsapp_request_template:'', whatsapp_allow_free_text:'0',
    telegram_enabled:'0', payment_gateway_enabled:'0', payment_gateway_create_url:'', payment_gateway_provider:'Generic Gateway', payment_gateway_webhook_path:'/api/webhooks/payment/generic', notification_retry_max:'5', seat_hold_minutes:'10',
    company_name:'Nasru Speed', tagline:'Safe • Fast • Comfortable', logo_url:'', address:'Thoddoo, AA. Thoddoo, Maldives', phone:'', whatsapp:'', telegram:'', email:'', website:'', tin:'', booking_prefix:'NS', show_exchange_rate:'1', payment_provider:'Bank Merchant', payment_mode:'FIXED', merchant_link:'', bank_name:'', bank_account_name:'', bank_mvr:'', bank_usd:'', gst_default:'8', currency:'MVR'
  };
  for (const [k,v] of Object.entries(defaults)) if (!one('SELECT 1 FROM settings WHERE key=?',k)) setSetting(k,v);
}
function audit(actor, action, entityType, entityId, details={}) { run('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)',uid(),actor||'SYSTEM',action,entityType||'',entityId||'',JSON.stringify(details),now()); }
function seed() {
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'DevOnly-ChangeMe123!');
  if (!initialPassword) throw new Error('ADMIN_INITIAL_PASSWORD is required on first production start');
  if(process.env.NODE_ENV==='production') validateStrongPassword(initialPassword);
  run('INSERT INTO users(id,username,password_hash,name,role,permissions,active,password_change_required) VALUES(?,?,?,?,?,?,1,1)',uid(),process.env.ADMIN_USERNAME||'admin',passwordHash(initialPassword,{allowInitial:process.env.NODE_ENV!=='production'}),'Administrator','ADMIN',JSON.stringify(['*']));
  const taxId=uid(); run('INSERT INTO tax_profiles VALUES(?,?,?,?,?,?,?,1)',taxId,'GENERAL_GST','General GST','STANDARD',getSetting('gst_default','8'),'2026-01-01',null);
  run('INSERT INTO exchange_rates VALUES(?,?,?,?,?,?,?,?,?)',uid(),'USD','MVR','15.42','MANUAL',now(),null,1,now());
  if (process.env.NODE_ENV === 'production') {
    audit('SYSTEM','SEED','system','seed',{message:'Production database initialized. Add boats, locations and trips in Admin.'});
    return;
  }
  const boats=[['Nasru Speed 01','MV-NS-01','NS01',49],['Nasru Speed 02','MV-NS-02','NS02',36],['Nasru Speed 03','MV-NS-03','NS03',42]];
  for (const b of boats) run('INSERT INTO boats VALUES(?,?,?,?,?,1)',uid(),...b);
  const locs=[['Thoddoo','Thoddoo','Alif Alif','Thoddoo Harbor'],['Malé','Malé','Kaafu','Jetty'],['Velana Airport','Hulhulé','Kaafu','Airport Jetty'],['Rasdhoo','Rasdhoo','Alif Alif','Rasdhoo Harbor'],['Ukulhas','Ukulhas','Alif Alif','Ukulhas Harbor'],['Dharavandhoo','Dharavandhoo','Baa','Dharavandhoo Harbor']];
  for (const l of locs) run('INSERT INTO locations VALUES(?,?,?,?,?,?,1)',uid(),...l,'');
  const boatRows=q('SELECT * FROM boats'), locationRows=q('SELECT * FROM locations');
  const td=locationRows.find(x=>x.name==='Thoddoo'), ml=locationRows.find(x=>x.name==='Malé'), ap=locationRows.find(x=>x.name==='Velana Airport');
  const today = maldivesDate(); const d = new Date(`${today}T00:00:00+05:00`); d.setUTCDate(d.getUTCDate()+1); const nextDate = maldivesDate(d);
  const addTrip=(n,boat,from,to,h,m,dur)=>{ const dep=new Date(`${nextDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+05:00`); const arr=new Date(dep.getTime()+dur*60000); const tid=uid(); run('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',tid,n,boat.id,from.id,to.id,dep.toISOString(),arr.toISOString(),750,50,500,35,0,0,1,taxId,'SCHEDULED'); seedTripFares(tid,{adult_mvr:750,adult_usd:50,child_mvr:500,child_usd:35,infant_mvr:0,infant_usd:0}); };
  addTrip('NS-001',boatRows[0],td,ml,7,0,75); addTrip('NS-002',boatRows[1],td,ml,10,0,75); addTrip('NS-003',boatRows[2],td,ap,13,0,80); addTrip('NS-004',boatRows[0],ml,td,16,0,75);
  audit('SYSTEM','SEED','system','seed',{message:'Demo data created'});
}
function seedTripFares(tripId, legacy) {
  for (const residency of ['LOCAL','TOURIST']) for (const type of ['ADULT','CHILD','INFANT']) for (const currency of ['MVR','USD']) {
    const key=`${type.toLowerCase()}_${currency.toLowerCase()}`;
    const amount=legacy[key] ?? 0;
    run('INSERT OR IGNORE INTO fares VALUES(?,?,?,?,?,?,1)',uid(),tripId,type,residency,currency,parseMoney(String(amount)));
  }
}
function migrateLegacyFares() {
  for (const t of q('SELECT * FROM trips')) {
    const count=one('SELECT COUNT(*) c FROM fares WHERE trip_id=?',t.id).c;
    if (!count) seedTripFares(t,t);
  }
}
initDb();

function activeRate() { return String(one("SELECT rate FROM exchange_rates WHERE currency='USD' AND active=1 ORDER BY effective_from DESC LIMIT 1")?.rate || '15.42'); }
function companyRaw() { const rows=q('SELECT * FROM settings'); return Object.fromEntries(rows.map(r=>[r.key,r.value])); }
const SECRET_KEYS = new Set(['telegram_bot_token','whatsapp_access_token','payment_gateway_api_key','payment_gateway_api_secret','payment_gateway_webhook_secret']);
function companyPublic() { const all=companyRaw(); const keys=['company_name','tagline','logo_url','address','phone','whatsapp','telegram','email','website','tin','booking_prefix','show_exchange_rate','gst_default','currency']; return Object.fromEntries(keys.map(k=>[k,all[k]??''])); }
function companyAdmin() { const c=companyRaw(); for (const k of SECRET_KEYS){ delete c[k]; c[k+'_configured']=Boolean(getSecret(k)); } return c; }
function BASE_URL() { return getSetting('public_base_url', process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/,''); }

function cleanupSeatHolds() { run('DELETE FROM seat_holds WHERE expires_at<=?',now()); }
function fareRows(tripId) { return q('SELECT passenger_type,residency_class,currency,amount_minor FROM fares WHERE trip_id=? AND active=1',tripId); }
function fareObject(tripId) {
  const obj={LOCAL:{},TOURIST:{}};
  for (const f of fareRows(tripId)) { obj[f.residency_class] ??= {}; obj[f.residency_class][f.passenger_type] ??= {}; obj[f.residency_class][f.passenger_type][f.currency]=minorToMajor(f.amount_minor); }
  return obj;
}
function tripRows(where='1=1',args=[]) {
  cleanupSeatHolds();
  const current=now();
  const rows=q(`SELECT t.*, b.name boat_name,b.seat_capacity,l1.name departure_name,l2.name arrival_name,
    (SELECT COUNT(*) FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=t.id AND bk.status NOT IN ('CANCELLED','EXPIRED')) booked,
    (SELECT COUNT(*) FROM seat_holds sh WHERE sh.trip_id=t.id AND sh.expires_at>?) held
    FROM trips t LEFT JOIN boats b ON b.id=t.boat_id LEFT JOIN locations l1 ON l1.id=t.departure_location_id LEFT JOIN locations l2 ON l2.id=t.arrival_location_id WHERE ${where} ORDER BY t.departure_at`,current,...args);
  return rows.map(r=>({ ...r, available:Math.max(0,Number(r.seat_capacity||0)-Number(r.booked||0)-Number(r.held||0)), fares:fareObject(r.id) }));
}
function validResidency(v) { const x=String(v||'TOURIST').toUpperCase(); if (!['LOCAL','WORK_VISA','TOURIST'].includes(x)) throw Object.assign(new Error('Invalid fare/residency type'),{status:400}); return x; }
function fareResidency(v) { return validResidency(v)==='WORK_VISA' ? 'LOCAL' : validResidency(v); }
function validPassengerType(v) { const x=String(v||'').toUpperCase(); if (!['ADULT','CHILD','INFANT'].includes(x)) throw Object.assign(new Error('Invalid passenger type'),{status:400}); return x; }
function validCurrency(v) { const x=String(v||'').toUpperCase(); if (!['MVR','USD'].includes(x)) throw Object.assign(new Error('Unsupported currency'),{status:400}); return x; }
function validateFareAmount(type, value) { const minor=parseMoney(String(value)); if(minor<0 || (String(type).toUpperCase()!=='INFANT' && minor<=0)) throw Object.assign(new Error(`${type} fare must be greater than zero`),{status:400}); return minor; }
function calcLine(passengerType, residencyClass, currency, trip) {
  const type=validPassengerType(passengerType), residency=validResidency(residencyClass), fareClass=fareResidency(residency), curr=validCurrency(currency);
  const fare=one('SELECT * FROM fares WHERE trip_id=? AND passenger_type=? AND residency_class=? AND currency=? AND active=1',trip.id,type,fareClass,curr);
  if (!fare) throw new Error(`No ${fareClass.toLowerCase()} ${type.toLowerCase()} fare is configured for ${curr}`);
  if (Number(fare.amount_minor) < 0 || (type !== 'INFANT' && Number(fare.amount_minor) <= 0)) throw new Error(`Invalid fare for ${fareClass.toLowerCase()} ${type.toLowerCase()}`);
  const tax=one('SELECT * FROM tax_profiles WHERE id=?',trip.tax_profile_id) || {rate:'0',code:'NONE',classification:'OUT_OF_SCOPE',name:'No Tax'};
  const parts=calcTaxMinor(Number(fare.amount_minor),String(tax.rate||'0'),Boolean(trip.price_includes_tax));
  return { ...parts, type, residency, fareClass, currency:curr, tax };
}
function nextBookingRef() {
  const date=maldivesDate(), compact=date.replaceAll('-','');
  const row=one('SELECT seq FROM booking_sequences WHERE book_date=?',date);
  const seq=(row?.seq||0)+1;
  run('INSERT INTO booking_sequences(book_date,seq) VALUES(?,?) ON CONFLICT(book_date) DO UPDATE SET seq=excluded.seq',date,seq);
  const suffix=crypto.randomBytes(3).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4).padEnd(4,'X');
  return `${getSetting('booking_prefix','NS')}-${compact}-${String(seq).padStart(3,'0')}-${suffix}`;
}

function keyMaterial(){
  const s = process.env.APP_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-only-change-this-before-production');
  if (!s) throw new Error('APP_SECRET must be set in production before saving integration secrets');
  return crypto.createHash('sha256').update(s).digest();
}
function encryptSecret(value){ if(!value)return ''; const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',keyMaterial(),iv); const enc=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]); const tag=cipher.getAuthTag(); return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`; }
function decryptSecret(value){ if(!value)return ''; if(!value.startsWith('enc:'))return value; const [,ivs,tags,data]=value.split(':'); const decipher=crypto.createDecipheriv('aes-256-gcm',keyMaterial(),Buffer.from(ivs,'base64')); decipher.setAuthTag(Buffer.from(tags,'base64')); return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8'); }
function setSecret(k,v){ if(v)setSetting(k,encryptSecret(v)); }
function getSecret(k){ try{return decryptSecret(getSetting(k,''));}catch{return '';} }
function ensurePassengerTicket(lineId){
  let t=one('SELECT * FROM passenger_tickets WHERE booking_line_id=?',lineId);
  if(t){ try{return {...t,token:decryptSecret(t.token_enc)};}catch{} }
  const token=randomToken(32);
  if(t){ run('UPDATE passenger_tickets SET token_hash=?,token_enc=?,status=\'ACTIVE\' WHERE id=?',sha256(token),encryptSecret(token),t.id); }
  else { run('INSERT INTO passenger_tickets(id,booking_line_id,token_hash,token_enc,status,scan_count,last_scanned_at,created_at) VALUES(?,?,?,?,\'ACTIVE\',0,NULL,?)',uid(),lineId,sha256(token),encryptSecret(token),now()); }
  t=one('SELECT * FROM passenger_tickets WHERE booking_line_id=?',lineId);
  return {...t,token};
}
function ticketQrValue(token){ return `NASRU:TICKET:${token}`; }

function paymentFallbackLink(booking){
  const base=getSetting('merchant_link',''); if(!base)return '';
  if(getSetting('payment_mode','FIXED')==='FIXED') return base;
  return `${base.replace(/\/$/,'')}/pay?ref=${encodeURIComponent(booking.reference)}&amount=${encodeURIComponent(booking.total_amount)}&currency=${booking.currency}`;
}
async function createGatewayPaymentLink(booking){
  if(!boolSetting('payment_gateway_enabled',false)||!getSetting('payment_gateway_create_url','')) return {url:paymentFallbackLink(booking),external_reference:'',source:'merchant-link'};
  const endpoint=getSetting('payment_gateway_create_url',''), apiKey=getSecret('payment_gateway_api_key'), apiSecret=getSecret('payment_gateway_api_secret');
  const headers={'Content-Type':'application/json'}; if(apiKey)headers.Authorization=`Bearer ${apiKey}`; if(apiSecret)headers['X-API-Secret']=apiSecret;
  const payload={booking_reference:booking.reference,amount:minorToMajor(booking.total_minor),currency:booking.currency,description:`Ferry ticket ${booking.reference}`,customer:{name:booking.customer_name,phone:booking.phone,email:booking.email},webhook_url:`${BASE_URL()}${getSetting('payment_gateway_webhook_path','/api/webhooks/payment/generic')}`,return_url:`${customerBookingUrl(booking.reference,booking._manage_token||'')}`};
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}); const txt=await r.text(); let data={}; try{data=JSON.parse(txt)}catch{data={raw:txt}};
  if(!r.ok)throw new Error(`Gateway create-link failed (${r.status}): ${String(data.message||data.error||txt).slice(0,200)}`);
  const url=data.payment_url||data.checkout_url||data.url||data.link; if(!url)throw new Error('Gateway response did not contain a payment URL');
  return {url,external_reference:String(data.transaction_id||data.reference||data.id||''),source:'gateway',raw:data};
}
function bankDetailsText(){
  const lines=[`Bank: ${getSetting('bank_name','')}`,`Account Name: ${getSetting('bank_account_name','')}`];
  if(getSetting('bank_mvr',''))lines.push(`MVR Account: ${getSetting('bank_mvr')}`); if(getSetting('bank_usd',''))lines.push(`USD Account: ${getSetting('bank_usd')}`); return lines.join('\n');
}

function whatsappTemplateForKind(kind){
  if(kind==='CUSTOMER_PAYMENT_LINK')return getSetting('whatsapp_payment_template','');
  if(kind==='CUSTOMER_CONFIRMATION')return getSetting('whatsapp_confirmation_template','');
  if(kind==='CUSTOMER_BANK_TRANSFER')return getSetting('whatsapp_bank_transfer_template','');
  if(kind==='CUSTOMER_TRIP_CHANGE')return getSetting('whatsapp_trip_change_template','');
  if(kind==='CUSTOMER_PAYMENT_REJECTED')return getSetting('whatsapp_rejected_template','');
  if(kind==='CUSTOMER_REQUEST_UPDATE')return getSetting('whatsapp_request_template','');
  if(kind.startsWith('ADMIN_'))return getSetting('whatsapp_admin_alert_template','');
  return '';
}
function queueNotification({bookingId=null,channel,recipient,subject,message,kind='GENERAL',dedupe=true,templateParams=null}){
  if(!recipient)return null;
  const templateName=channel==='WHATSAPP'?whatsappTemplateForKind(kind):'';
  const dedupeKey=dedupe?sha256([bookingId||'',channel,recipient,kind,subject||'',message||''].join('|')):null;
  const id=uid();
  try { run('INSERT INTO notifications(id,booking_id,channel,recipient,subject,message,status,created_at,kind,attempts,next_attempt_at,last_error,sent_at,provider_message_id,claimed_at,dedupe_key,template_name,template_params_json) VALUES(?,?,?,?,?,?,?,?,?,0,?,NULL,NULL,NULL,NULL,?,?,?)',id,bookingId,channel,recipient,subject,message,'QUEUED',now(),kind,now(),dedupeKey,templateName,JSON.stringify(templateParams||[message])); return id; }
  catch(e){ if(String(e.message).includes('UNIQUE constraint failed: notifications.dedupe_key'))return null; throw e; }
}
function adminChannels(){ return getSetting('admin_notify_channels','TELEGRAM').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean); }
function queueAdminAlert(booking,subject,message,kind='ADMIN_ALERT'){ for(const ch of adminChannels()){ if(ch==='TELEGRAM')queueNotification({bookingId:booking.id,channel:'TELEGRAM',recipient:getSetting('admin_telegram_chat_id',''),subject,message,kind}); if(ch==='WHATSAPP')queueNotification({bookingId:booking.id,channel:'WHATSAPP',recipient:getSetting('admin_whatsapp_number',''),subject,message,kind}); } }
function queueCustomer(booking,subject,message,kind='CUSTOMER',dedupe=true){ if(boolSetting('whatsapp_enabled',false)&&booking.phone)queueNotification({bookingId:booking.id,channel:'WHATSAPP',recipient:booking.phone,subject,message,kind,dedupe}); if(boolSetting('telegram_enabled',false)&&booking.telegram_chat_id)queueNotification({bookingId:booking.id,channel:'TELEGRAM',recipient:booking.telegram_chat_id,subject,message,kind,dedupe}); }

async function sendExpoPushForBooking(bookingId,title,body,data={}){
  const tokens=q("SELECT push_token FROM customer_devices WHERE booking_id=? AND active=1",bookingId).map(x=>x.push_token).filter(Boolean);
  if(!tokens.length)return;
  const messages=tokens.map(to=>({to,sound:'default',title,body,data:{booking_id:bookingId,...data}}));
  try{
    const r=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'gzip, deflate'},body:JSON.stringify(messages)});
    if(!r.ok)throw new Error(`Expo push ${r.status}: ${(await r.text()).slice(0,300)}`);
    audit('SYSTEM','PUSH_SENT','booking',bookingId,{title,count:tokens.length});
  }catch(e){audit('SYSTEM','PUSH_FAILED','booking',bookingId,{title,error:String(e.message||e)});}
}
function formatTripMessage(booking){ const t=tripRows('t.id=?',[booking.trip_id])[0]; return `${t?.departure_name||''} → ${t?.arrival_name||''}\nDate: ${fmtDate(t?.departure_at)}\nDeparture: ${fmtTime(t?.departure_at)}\nArrival: ${fmtTime(t?.arrival_at)}\nBoat: ${t?.boat_name||''}`; }
async function sendTelegram(recipient,message){ if(!boolSetting('telegram_enabled',false))throw new Error('Telegram integration is disabled'); const token=getSecret('telegram_bot_token'); if(!token)throw new Error('Telegram bot token is not configured'); const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:recipient,text:message,disable_web_page_preview:false}),signal:AbortSignal.timeout(15000)}); const data=await r.json().catch(()=>({})); if(!r.ok||data.ok===false)throw new Error(data.description||`Telegram HTTP ${r.status}`); return String(data.result?.message_id||''); }
async function sendWhatsAppNotification(n){
  if(!boolSetting('whatsapp_enabled',false))throw new Error('WhatsApp integration is disabled');
  const token=getSecret('whatsapp_access_token'), phoneId=getSetting('whatsapp_phone_number_id',''); if(!token||!phoneId)throw new Error('WhatsApp Cloud API credentials are not configured'); const ver=getSetting('whatsapp_graph_version','v23.0');
  let payload;
  if(n.template_name){ const params=safeJson(n.template_params_json,[]).map(x=>({type:'text',text:String(x)})); payload={messaging_product:'whatsapp',to:normalizePhone(n.recipient),type:'template',template:{name:n.template_name,language:{code:getSetting('whatsapp_template_language','en_US')},components:[{type:'body',parameters:params}]}}; }
  else {
    if(!boolSetting('whatsapp_allow_free_text',false)) throw new Error(`Approved WhatsApp template is required for ${n.kind}`);
    payload={messaging_product:'whatsapp',to:normalizePhone(n.recipient),type:'text',text:{preview_url:true,body:`${n.subject?`${n.subject}\n\n`:''}${n.message}`}};
  }
  const r=await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}); const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(data.error?.message||`WhatsApp HTTP ${r.status}`); return String(data.messages?.[0]?.id||'');
}
let notificationWorkerRunning=false;
function claimNotification(max){
  db.exec('BEGIN IMMEDIATE');
  try {
    const stale=new Date(Date.now()-2*60*1000).toISOString(); run("UPDATE notifications SET status='RETRY',claimed_at=NULL,next_attempt_at=? WHERE status='SENDING' AND claimed_at<?",now(),stale);
    const n=one("SELECT * FROM notifications WHERE status IN ('QUEUED','RETRY') AND attempts < ? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT 1",max,now());
    if(!n){db.exec('COMMIT');return null;}
    run("UPDATE notifications SET status='SENDING',claimed_at=?,attempts=attempts+1 WHERE id=? AND status IN ('QUEUED','RETRY')",now(),n.id);
    const claimed=one('SELECT * FROM notifications WHERE id=?',n.id); db.exec('COMMIT'); return claimed;
  } catch(e){try{db.exec('ROLLBACK')}catch{} throw e;}
}
async function processNotifications(){
  if(notificationWorkerRunning)return; notificationWorkerRunning=true;
  try {
    const max=Math.max(1,Number(getSetting('notification_retry_max','5'))||5);
    for(let i=0;i<20;i++){
      const n=claimNotification(max); if(!n)break;
      try { const text=`${n.subject?`${n.subject}\n\n`:''}${n.message}`; const providerId=n.channel==='TELEGRAM'?await sendTelegram(n.recipient,text):n.channel==='WHATSAPP'?await sendWhatsAppNotification(n):(()=>{throw new Error(`Unsupported notification channel: ${n.channel}`)})(); run("UPDATE notifications SET status='SENT',sent_at=?,provider_message_id=?,last_error=NULL,claimed_at=NULL WHERE id=?",now(),providerId,n.id); }
      catch(e){ const attempts=Number(n.attempts||0); const delay=Math.min(3600,30*Math.pow(2,Math.max(0,attempts-1))); const next=new Date(Date.now()+delay*1000).toISOString(); run('UPDATE notifications SET status=?,next_attempt_at=?,last_error=?,claimed_at=NULL WHERE id=?',attempts>=max?'FAILED':'RETRY',next,String(e.message||e).slice(0,500),n.id); }
      await sleep(25);
    }
  } finally { notificationWorkerRunning=false; }
}
setInterval(()=>processNotifications().catch(console.error),10000).unref(); setTimeout(()=>processNotifications().catch(console.error),1500).unref();

function isLoopbackAddress(v){ const ip=String(v||'').replace(/^::ffff:/,''); return ip==='127.0.0.1'||ip==='::1'; }
function clientIp(req){
  // The application is intended to sit behind local Nginx. Never trust a client-supplied
  // X-Forwarded-For chain. Only accept X-Real-IP when the direct TCP peer is loopback.
  const peer=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  if(isLoopbackAddress(peer)){ const xr=String(req.headers['x-real-ip']||'').trim(); if(/^([0-9a-f:.]+)$/i.test(xr)&&xr.length<=64)return xr; }
  return peer;
}
function loginKeys(req,username){ const ip=clientIp(req),u=String(username||'').trim().toLowerCase(); return [sha256(`ip|${ip}`),sha256(`ip-user|${ip}|${u}`)]; }
function checkLoginRate(req,username){ const t=Date.now(), keys=loginKeys(req,username), rows=keys.map(k=>one('SELECT * FROM login_attempts WHERE login_key=?',k)); const blocked=rows.filter(r=>r?.blocked_until>t).sort((a,b)=>b.blocked_until-a.blocked_until)[0]; return {blocked:Boolean(blocked),retryAfter:blocked?Math.ceil((blocked.blocked_until-t)/1000):0,keys,rows}; }
function recordOneLoginFailure(key,row,index){ const t=Date.now(), windowMs=15*60*1000; let failures=1, started=t; if(row && t-row.window_started_at<windowMs){failures=row.failures+1;started=row.window_started_at;} const limit=index===0?12:5; const blocked=failures>=limit?t+15*60*1000:0; run('INSERT INTO login_attempts(login_key,failures,window_started_at,blocked_until) VALUES(?,?,?,?) ON CONFLICT(login_key) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until',key,failures,started,blocked); }
function recordLoginFailure(rate){ rate.keys.forEach((k,i)=>recordOneLoginFailure(k,rate.rows[i],i)); }
function clearLoginFailures(rate){ rate.keys.forEach(k=>run('DELETE FROM login_attempts WHERE login_key=?',k)); }
function createSession(user){ const token=randomToken(32), tokenHash=sha256(token), exp=new Date(Date.now()+12*60*60*1000).toISOString(); run('DELETE FROM sessions WHERE expires_at<=?',now()); run('INSERT INTO sessions VALUES(?,?,?,?)',tokenHash,user.id,exp,now()); return token; }
function session(req){ const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(!token)return null; const r=one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',sha256(token),now()); return r||null; }
function can(user,perm){ if(!user)return false; const ps=safeJson(user.permissions,[]); return ps.includes('*')||ps.includes(perm); }
function requirePerm(res,u,perm){ if(can(u,'*')||can(u,perm))return true; json(res,{error:'Forbidden'},403); return false; }

function send(res,status,data,headers={}){ const body=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data)); res.writeHead(status,{'Content-Type':Buffer.isBuffer(data)?'application/octet-stream':'application/json; charset=utf-8','Content-Length':body.length,'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store',...headers}); res.end(body); }
function json(res,data,status=200){ send(res,status,JSON.stringify(data),{'Content-Type':'application/json; charset=utf-8'}); }
async function rawBody(req,limit=6e6){ return await new Promise((resolve,reject)=>{const chunks=[];let n=0;req.on('data',c=>{n+=c.length;if(n>limit){reject(new Error('Request too large'));req.destroy();}else chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);}); }
async function body(req){ const raw=await rawBody(req); if(!raw.length)return {}; try{return JSON.parse(raw.toString('utf8'))}catch{throw new Error('Invalid JSON body')} }
function parseUrl(req){return new URL(req.url,`http://${req.headers.host||'localhost'}`)}
function pdfBuffer(lines){ const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); let content='BT /F1 11 Tf 40 810 Td\n',y=800; for(const line of lines){content+=`0 -16 Td (${esc(line).slice(0,110)}) Tj\n`;y-=16;if(y<60)break;}content+='ET';const objs=[];const add=s=>{objs.push(s);return objs.length};const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');const stream=add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);const page=add(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`);const pages=add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);const catalog=add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);let out='%PDF-1.4\n',offs=[0];objs.forEach((o,i)=>{offs.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`});const x=Buffer.byteLength(out);out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offs.length;i++)out+=String(offs[i]).padStart(10,'0')+' 00000 n \n';out+=`trailer\n<< /Size ${objs.length+1} /Root ${catalog} 0 R >>\nstartxref\n${x}\n%%EOF`;return Buffer.from(out); }
function xlsXml(title,columns,rows){const cell=(v,type='String')=>`<Cell><Data ss:Type="${type}">${String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</Data></Cell>`;return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${title}"><Table><Row>${columns.map(c=>cell(c)).join('')}</Row>${rows.map(r=>`<Row>${r.map(v=>cell(v,typeof v==='number'?'Number':'String')).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`}

function adminVerifyUrl(paymentId){return `${BASE_URL()}/?adminVerify=${encodeURIComponent(paymentId)}`}
function customerBookingUrl(ref,token=''){return `${BASE_URL()}/?booking=${encodeURIComponent(ref)}${token?`&token=${encodeURIComponent(token)}`:''}`}
function publicAuthOk(bk,urlOrBody){ const token=String(urlOrBody.token||urlOrBody.manage_token||''); if(token&&bk.manage_token_hash&&constantEqual(sha256(token),bk.manage_token_hash))return true; const contact=String(urlOrBody.contact||'').trim(); if(contact){if(bk.email&&contact.toLowerCase()===String(bk.email).trim().toLowerCase())return true;if(bk.phone&&normalizePhone(contact)===normalizePhone(bk.phone))return true;} return false; }
function publicBookingShape(bk){ return {id:bk.id,reference:bk.reference,trip_id:bk.trip_id,customer_name:bk.customer_name,currency:bk.currency,status:bk.status,payment_status:bk.payment_status,total_amount:minorToMajor(bk.total_minor ?? Math.round(Number(bk.total_amount||0)*100)),total_mvr:minorToMajor(bk.total_mvr_minor ?? Math.round(Number(bk.total_mvr||0)*100)),exchange_rate_snapshot:bk.exchange_rate_snapshot,created_at:bk.created_at}; }
function sniffReceipt(buf){ if(buf.length>=4&&buf[0]===0x25&&buf[1]===0x50&&buf[2]===0x44&&buf[3]===0x46)return {mime:'application/pdf',ext:'pdf'}; if(buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return {mime:'image/png',ext:'png'}; if(buf.length>=3&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return {mime:'image/jpeg',ext:'jpg'}; return null; }
function availableSeats(tripId,capacity,ownToken=''){ cleanupSeatHolds(); const booked=new Set(q("SELECT bl.seat_no FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",tripId).map(x=>String(x.seat_no))); const heldOther=new Set(q('SELECT seat_no FROM seat_holds WHERE trip_id=? AND expires_at>? AND checkout_token<>?',tripId,now(),ownToken||'').map(x=>String(x.seat_no))); const mine=new Set(ownToken?q('SELECT seat_no FROM seat_holds WHERE trip_id=? AND checkout_token=? AND expires_at>?',tripId,ownToken,now()).map(x=>String(x.seat_no)):[]); const seats=[]; for(let i=1;i<=capacity;i++){const s=String(i).padStart(2,'0');seats.push({seat_no:s,status:booked.has(s)?'BOOKED':heldOther.has(s)?'HELD':mine.has(s)?'YOURS':'AVAILABLE'})} return seats; }

async function confirmPayment(p,actor='SYSTEM',source='MANUAL'){
  if(!p)throw new Error('Payment not found'); if(!['PENDING','RECEIPT_SUBMITTED'].includes(String(p.status)))throw Object.assign(new Error(`Payment cannot be approved from status ${p.status}`),{status:409});
  const bk=one('SELECT * FROM bookings WHERE id=?',p.booking_id); if(!bk)throw new Error('Booking not found');
  db.exec('BEGIN IMMEDIATE'); try{ const current=one('SELECT * FROM payments WHERE id=?',p.id); if(!['PENDING','RECEIPT_SUBMITTED'].includes(String(current.status)))throw Object.assign(new Error(`Payment cannot be approved from status ${current.status}`),{status:409}); run("UPDATE payments SET status='PAID',verified_by=?,verified_at=? WHERE id=?",actor,now(),p.id); run("UPDATE bookings SET payment_status='PAID',status='CONFIRMED' WHERE id=?",p.booking_id); db.exec('COMMIT'); }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
  const updated=one('SELECT * FROM bookings WHERE id=?',p.booking_id);
  if(boolSetting('notify_customer_confirmation',true)) queueCustomer(updated,'Booking confirmed',`Payment received. Your booking ${updated.reference} is CONFIRMED.\n\n${formatTripMessage(updated)}\n\nAmount paid: ${updated.currency} ${minorToMajor(updated.total_minor).toFixed(2)}.`,'CUSTOMER_CONFIRMATION');
  sendExpoPushForBooking(updated.id,'Booking confirmed',`${updated.reference} is confirmed. Tap to view your trip.`,{reference:updated.reference,type:'BOOKING_CONFIRMED'}).catch(console.error);
  queueAdminAlert(updated,'Payment confirmed',`Payment confirmed for ${updated.reference}.\nAmount: ${updated.currency} ${minorToMajor(updated.total_minor).toFixed(2)}\nSource: ${source}`,'ADMIN_PAYMENT_CONFIRMED');
  audit(actor,'PAYMENT_APPROVED','payment',p.id,{booking:updated.reference,source}); processNotifications().catch(console.error); return updated;
}

async function api(req,res,url){
  try{
    if(req.method==='POST'&&url.pathname==='/api/login'){
      const b=await body(req), username=String(b.username||'').trim(); const rate=checkLoginRate(req,username); if(rate.blocked)return json(res,{error:'Too many failed login attempts. Try again later.',retry_after:rate.retryAfter},429);
      const u=one('SELECT * FROM users WHERE username=? AND active=1',username); if(!u||!verifyPassword(u.password_hash,b.password)){recordLoginFailure(rate);return json(res,{error:'Invalid login'},401)}
      if(!String(u.password_hash).startsWith('scrypt$'))run('UPDATE users SET password_hash=? WHERE id=?',passwordHash(b.password),u.id); clearLoginFailures(rate); const token=createSession(u); audit(u.username,'LOGIN','user',u.id,{ip:clientIp(req)}); return json(res,{token,user:{id:u.id,name:u.name,role:u.role,permissions:safeJson(u.permissions,[]),password_change_required:Boolean(u.password_change_required)}});
    }
    if(req.method==='GET'&&url.pathname==='/api/public/settings') return json(res,{company:companyPublic(),exchange_rate:Number(activeRate()),today_maldives:maldivesDate(),timezone:MALDIVES_TZ});
    if(req.method==='GET'&&url.pathname==='/api/public/locations') return json(res,q('SELECT * FROM locations WHERE active=1 ORDER BY name'));
    if(req.method==='GET'&&url.pathname==='/api/public/trips'){
      const from=url.searchParams.get('from'),to=url.searchParams.get('to'),date=url.searchParams.get('date'); let w=["t.status IN ('SCHEDULED','BOARDING')",'t.departure_at>?'],a=[now()]; if(from){w.push('t.departure_location_id=?');a.push(from)} if(to){w.push('t.arrival_location_id=?');a.push(to)} if(date){const [s,e]=maldivesUtcRange(date);w.push('t.departure_at>=? AND t.departure_at<?');a.push(s,e)} return json(res,tripRows(w.join(' AND '),a));
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/trips\/[^/]+\/quote$/)){
      const tid=url.pathname.split('/')[4], t=one('SELECT * FROM trips WHERE id=?',tid); if(!t)return json(res,{error:'Trip not found'},404); if(!['SCHEDULED','BOARDING'].includes(String(t.status))||new Date(t.departure_at)<=new Date())return json(res,{error:'This trip is not bookable'},409); const b=await body(req),currency=validCurrency(b.currency||'MVR'),pax=Array.isArray(b.passengers)?b.passengers:[]; if(!pax.length)return json(res,{error:'At least one passenger is required'},400); const xr=currency==='USD'?activeRate():'1'; let totalMinor=0,totalMvrMinor=0;const lines=[];for(const p of pax){const c=calcLine(p.type,p.residency_class,currency,t),mvrGross=currency==='USD'?convertUsdMinorToMvrMinor(c.gross_minor,xr):c.gross_minor;totalMinor+=c.gross_minor;totalMvrMinor+=mvrGross;lines.push({passenger_type:c.type,residency_class:c.residency,fare_class:c.fareClass,currency,unit_fare:minorToMajor(c.unit_minor),taxable:minorToMajor(c.taxable_minor),gst:minorToMajor(c.gst_minor),gross:minorToMajor(c.gross_minor),mvr_gross:minorToMajor(mvrGross),gst_rate:Number(c.tax.rate||0),tax_code:c.tax.code||''})}return json(res,{currency,exchange_rate:Number(xr),lines,total:minorToMajor(totalMinor),total_mvr:minorToMajor(totalMvrMinor),price_includes_tax:Boolean(t.price_includes_tax)});
    }
    if(req.method==='GET'&&url.pathname.match(/^\/api\/public\/trips\/[^/]+\/seats$/)){
      const tid=url.pathname.split('/')[4], t=one('SELECT t.*,b.seat_capacity FROM trips t JOIN boats b ON b.id=t.boat_id WHERE t.id=?',tid); if(!t)return json(res,{error:'Trip not found'},404); return json(res,{seats:availableSeats(t.id,Number(t.seat_capacity),url.searchParams.get('checkout_token')||'')});
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/trips\/[^/]+\/hold$/)){
      const tid=url.pathname.split('/')[4], b=await body(req), t=one('SELECT t.*,bo.seat_capacity FROM trips t JOIN boats bo ON bo.id=t.boat_id WHERE t.id=?',tid); if(!t)return json(res,{error:'Trip not found'},404); if(!['SCHEDULED','BOARDING'].includes(t.status)||new Date(t.departure_at)<=new Date())return json(res,{error:'This trip is not bookable'},409);
      const count=Math.max(1,Math.min(Number(t.seat_capacity),Number(b.passenger_count||1))); const token=String(b.checkout_token||randomToken(18)); const requested=(b.requested_seats||[]).map(x=>String(Number(x)).padStart(2,'0')).filter(Boolean); const minutes=Math.max(2,Math.min(30,Number(getSetting('seat_hold_minutes','10'))||10)); const expires=new Date(Date.now()+minutes*60000).toISOString();
      db.exec('BEGIN IMMEDIATE'); try{cleanupSeatHolds(); run('DELETE FROM seat_holds WHERE trip_id=? AND checkout_token=?',tid,token); const seats=availableSeats(tid,Number(t.seat_capacity),token); const free=new Set(seats.filter(x=>x.status==='AVAILABLE'||x.status==='YOURS').map(x=>x.seat_no)); const chosen=[]; for(const s of requested){if(chosen.length>=count)break;if(!free.has(s))throw Object.assign(new Error(`Seat ${s} is no longer available`),{status:409});if(!chosen.includes(s))chosen.push(s)} for(const s of free){if(chosen.length>=count)break;if(!chosen.includes(s))chosen.push(s)} if(chosen.length<count)throw Object.assign(new Error('Not enough seats available'),{status:409}); for(const s of chosen)run('INSERT INTO seat_holds VALUES(?,?,?,?,?,?)',uid(),tid,s,token,expires,now()); db.exec('COMMIT'); return json(res,{checkout_token:token,seats:chosen,expires_at:expires,seat_map:availableSeats(tid,Number(t.seat_capacity),token)}); }catch(e){try{db.exec('ROLLBACK')}catch{}return json(res,{error:e.message},e.status||409)}
    }
    if(req.method==='POST'&&url.pathname==='/api/public/bookings'){
      const b=await body(req), t=one('SELECT * FROM trips WHERE id=?',b.trip_id); if(!t)return json(res,{error:'Trip not found'},404); if(!['SCHEDULED','BOARDING'].includes(String(t.status))||new Date(t.departure_at)<=new Date())return json(res,{error:'This trip is cancelled, closed, or already departed'},409); const boat=one('SELECT * FROM boats WHERE id=? AND active=1',t.boat_id); if(!boat)return json(res,{error:'Boat unavailable'},409); const pax=Array.isArray(b.passengers)?b.passengers:[]; if(!pax.length)return json(res,{error:'At least one passenger is required'},400); if(pax.some((p,i)=>!String(p?.name||'').trim()))return json(res,{error:'Full name is required for every passenger'},400); const currency=validCurrency(b.currency||'MVR'); const paymentMethod=String(b.payment_method||'PAYMENT_LINK').toUpperCase(); if(!['PAYMENT_LINK','BANK_TRANSFER','CASH'].includes(paymentMethod))return json(res,{error:'Invalid payment method'},400); const manageToken=randomToken(24);
      db.exec('BEGIN IMMEDIATE'); let bid,ref,totalMinor=0,totalMvrMinor=0,lines=[];
      try{
        cleanupSeatHolds(); const current=one("SELECT COUNT(*) c FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",t.id).c; if(current+pax.length>Number(boat.seat_capacity))throw Object.assign(new Error('Not enough seats'),{status:409});
        const seats=[]; for(const p of pax){const n=Number(p.seat_no);if(!Number.isInteger(n)||n<1||n>Number(boat.seat_capacity))throw Object.assign(new Error(`Invalid seat ${p.seat_no||''}`),{status:400});seats.push(String(n).padStart(2,'0'))} if(new Set(seats).size!==seats.length)throw Object.assign(new Error('Duplicate seats in booking'),{status:409});
        const checkout=String(b.checkout_token||''); for(const seat of seats){const taken=one("SELECT COUNT(*) c FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=? AND bl.seat_no=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",t.id,seat).c;if(taken)throw Object.assign(new Error(`Seat ${seat} already booked`),{status:409}); const held=one('SELECT * FROM seat_holds WHERE trip_id=? AND seat_no=? AND expires_at>?',t.id,seat,now()); if(held&&held.checkout_token!==checkout)throw Object.assign(new Error(`Seat ${seat} is currently held by another customer`),{status:409}); }
        const xr=currency==='USD'?activeRate():'1';
        for(let i=0;i<pax.length;i++){const p=pax[i],c=calcLine(p.type,p.residency_class,currency,t); const mvrTaxable=currency==='USD'?convertUsdMinorToMvrMinor(c.taxable_minor,xr):c.taxable_minor, mvrGst=currency==='USD'?convertUsdMinorToMvrMinor(c.gst_minor,xr):c.gst_minor, mvrGross=currency==='USD'?convertUsdMinorToMvrMinor(c.gross_minor,xr):c.gross_minor; totalMinor+=c.gross_minor; totalMvrMinor+=mvrGross; lines.push({p:{...p,seat_no:seats[i]},c,mvrTaxable,mvrGst,mvrGross}); }
        ref=nextBookingRef(); bid=uid(); run('INSERT INTO bookings(id,reference,trip_id,customer_name,phone,email,currency,status,payment_status,total_amount,total_mvr,exchange_rate_snapshot,created_at,telegram_chat_id,manage_token_hash,total_minor,total_mvr_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',bid,ref,t.id,b.customer_name||pax[0]?.name||'Guest',b.phone||'',b.email||'',currency,'PENDING_PAYMENT','PENDING',minorToMajor(totalMinor),minorToMajor(totalMvrMinor),Number(xr),now(),b.telegram_chat_id||'',sha256(manageToken),totalMinor,totalMvrMinor);
        for(const {p,c,mvrTaxable,mvrGst,mvrGross} of lines){const lineId=uid();run('INSERT INTO booking_lines(id,booking_id,passenger_name,passenger_type,nationality,passport_no,seat_no,currency,unit_fare,price_includes_tax_snapshot,gst_rate_snapshot,taxable_amount,gst_amount,gross_amount,exchange_rate_snapshot,mvr_taxable_amount,mvr_gst_amount,mvr_gross_amount,residency_class,fare_residency_snapshot,tax_profile_code_snapshot,tax_classification_snapshot,tax_name_snapshot,unit_fare_minor,taxable_minor,gst_minor,gross_minor,mvr_taxable_minor,mvr_gst_minor,mvr_gross_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',lineId,bid,String(p.name).trim(),c.type,p.nationality||'',p.passport_no||'',p.seat_no,currency,minorToMajor(c.unit_minor),t.price_includes_tax,Number(c.tax.rate||0),minorToMajor(c.taxable_minor),minorToMajor(c.gst_minor),minorToMajor(c.gross_minor),Number(xr),minorToMajor(mvrTaxable),minorToMajor(mvrGst),minorToMajor(mvrGross),c.residency,c.fareClass,c.tax.code||'',c.tax.classification||'',c.tax.name||'',c.unit_minor,c.taxable_minor,c.gst_minor,c.gross_minor,mvrTaxable,mvrGst,mvrGross);ensurePassengerTicket(lineId);}
        run('DELETE FROM seat_holds WHERE trip_id=? AND checkout_token=?',t.id,String(b.checkout_token||'')); db.exec('COMMIT');
      }catch(e){try{db.exec('ROLLBACK')}catch{}return json(res,{error:e.message},e.status||500)}
      const bk=one('SELECT * FROM bookings WHERE id=?',bid); bk._manage_token=manageToken; let payInfo={url:'',external_reference:'',source:paymentMethod};
      if(paymentMethod==='PAYMENT_LINK'){try{payInfo=await createGatewayPaymentLink(bk)}catch(e){audit('SYSTEM','GATEWAY_LINK_FAILED','booking',bid,{error:e.message});payInfo={url:paymentFallbackLink(bk),external_reference:'',source:'fallback'}}}
      const pid=uid(); const provider=paymentMethod==='BANK_TRANSFER'?getSetting('bank_name','Bank Transfer'):paymentMethod==='CASH'?'Cash / Counter':getSetting('payment_gateway_provider',getSetting('payment_provider','Bank Merchant')); run('INSERT INTO payments(id,booking_id,method,provider,amount,currency,payment_link,external_reference,receipt_url,status,verified_by,verified_at,created_at,gateway_payload,amount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',pid,bid,paymentMethod,provider,minorToMajor(totalMinor),currency,payInfo.url||'',payInfo.external_reference||'','','PENDING',null,null,now(),JSON.stringify(payInfo.raw||{}),totalMinor);
      const adminMsg=`New booking ${ref}\n${formatTripMessage(bk)}\nPassengers: ${pax.length}\nAmount: ${currency} ${minorToMajor(totalMinor).toFixed(2)}\nPayment: ${paymentMethod}\n\nVerify/approve: ${adminVerifyUrl(pid)}`; if(boolSetting('notify_admin_new_booking',true))queueAdminAlert(bk,'New booking received',adminMsg,'ADMIN_NEW_BOOKING');
      if(boolSetting('notify_customer_payment_link',true)){
        if(paymentMethod==='PAYMENT_LINK'&&payInfo.url)queueCustomer(bk,'Complete your payment',`Booking ${ref} created.\n${formatTripMessage(bk)}\nAmount: ${currency} ${minorToMajor(totalMinor).toFixed(2)}\n\nPay securely: ${payInfo.url}\n\nYour booking will be confirmed after payment verification.`,'CUSTOMER_PAYMENT_LINK');
        if(paymentMethod==='BANK_TRANSFER')queueCustomer(bk,'Bank transfer details',`Booking ${ref} created.\n${formatTripMessage(bk)}\nAmount: ${currency} ${minorToMajor(totalMinor).toFixed(2)}\n\n${bankDetailsText()}\n\nAfter transferring, upload your receipt from Manage Booking.`,'CUSTOMER_BANK_TRANSFER');
      }
      audit('PUBLIC','BOOKING_CREATED','booking',bid,{reference:ref,total_minor:totalMinor,currency,payment:pid}); processNotifications().catch(console.error); return json(res,{booking:publicBookingShape(bk),manage_token:manageToken,manage_url:customerBookingUrl(ref,manageToken),payment:{id:pid,method:paymentMethod,payment_link:payInfo.url||''},payment_link:payInfo.url||'',bank_details:paymentMethod==='BANK_TRANSFER'?{bank_name:getSetting('bank_name',''),account_name:getSetting('bank_account_name',''),mvr:getSetting('bank_mvr',''),usd:getSetting('bank_usd','')}:null});
    }
    if(req.method==='POST'&&url.pathname==='/api/public/tickets/verify'){
      const b=await body(req); let token=String(b.token||'').trim(); token=token.replace(/^NASRU:TICKET:/i,'').replace(/^.*\/ticket\//i,''); if(!/^[a-f0-9]{64}$/i.test(token))return json(res,{valid:false,error:'Invalid Nasru Speed ticket QR'},400);
      const ticket=one('SELECT * FROM passenger_tickets WHERE token_hash=?',sha256(token)); if(!ticket)return json(res,{valid:false,status:'INVALID',message:'Ticket not found'},404);
      const row=one(`SELECT pt.status ticket_status, bl.passenger_name,bl.passenger_type,bl.residency_class,bl.seat_no,bk.reference,bk.status booking_status,bk.payment_status,t.departure_at,t.arrival_at,t.status trip_status,bo.name boat_name,dl.name departure_name,al.name arrival_name FROM passenger_tickets pt JOIN booking_lines bl ON bl.id=pt.booking_line_id JOIN bookings bk ON bk.id=bl.booking_id JOIN trips t ON t.id=bk.trip_id LEFT JOIN boats bo ON bo.id=t.boat_id LEFT JOIN locations dl ON dl.id=t.departure_location_id LEFT JOIN locations al ON al.id=t.arrival_location_id WHERE pt.id=?`,ticket.id);
      if(!row)return json(res,{valid:false,status:'INVALID',message:'Ticket data unavailable'},404); run('UPDATE passenger_tickets SET scan_count=scan_count+1,last_scanned_at=? WHERE id=?',now(),ticket.id);
      const cancelled=['CANCELLED','EXPIRED','REFUNDED'].includes(String(row.booking_status))||String(row.trip_status)==='CANCELLED'||String(row.ticket_status)!=='ACTIVE'; const paid=String(row.payment_status)==='PAID'; const confirmed=String(row.booking_status)==='CONFIRMED'&&paid&&!cancelled;
      const displayStatus=cancelled?'CANCELLED':confirmed?'VALID':paid?'NOT_CONFIRMED':'PAYMENT_PENDING'; const name=String(row.passenger_name||'Passenger'); const masked=name.length>2?`${name.slice(0,Math.max(1,name.indexOf(' ')>0?name.indexOf(' '):1))}${name.includes(' ')?' '+name.split(' ').slice(1).map(x=>x[0]?x[0]+'.':'').join(' '):''}`:name;
      return json(res,{valid:confirmed,status:displayStatus,message:cancelled?'Ticket is cancelled':confirmed?'Valid Nasru Speed ticket':paid?'Payment received but booking is not confirmed':'Payment is not confirmed',ticket:{passenger_name:masked,passenger_type:row.passenger_type,residency_class:row.residency_class,seat_no:row.seat_no,booking_reference:row.reference,booking_status:row.booking_status,payment_status:row.payment_status,trip_status:row.trip_status,boat_name:row.boat_name,departure_name:row.departure_name,arrival_name:row.arrival_name,departure_at:row.departure_at,arrival_at:row.arrival_at}});
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/bookings\/[^/]+\/claim$/)){
      const ref=decodeURIComponent(url.pathname.split('/')[4]), bk=one('SELECT * FROM bookings WHERE reference=?',ref); if(!bk)return json(res,{error:'Booking not found'},404); const b=await body(req); const contact=String(b.contact||'').trim(); if(!contact)return json(res,{error:'Phone or email is required'},400); if(!publicAuthOk(bk,{contact}))return json(res,{error:'Booking reference and phone/email do not match'},403); const token=randomToken(24); run('UPDATE bookings SET manage_token_hash=? WHERE id=?',sha256(token),bk.id); audit('PUBLIC','BOOKING_ACCESS_CLAIMED','booking',bk.id,{reference:ref}); return json(res,{manage_token:token});
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/bookings\/[^/]+\/push$/)){
      const ref=decodeURIComponent(url.pathname.split('/')[4]), bk=one('SELECT * FROM bookings WHERE reference=?',ref); if(!bk)return json(res,{error:'Booking not found'},404); const b=await body(req); if(!publicAuthOk(bk,b))return json(res,{error:'Secure booking access required'},403); const push=String(b.push_token||'').trim(); if(!/^ExponentPushToken\[[A-Za-z0-9_-]+\]$|^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(push))return json(res,{error:'Invalid Expo push token'},400); run('INSERT INTO customer_devices(id,booking_id,push_token,platform,active,created_at,last_seen_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(booking_id,push_token) DO UPDATE SET active=1,last_seen_at=excluded.last_seen_at',uid(),bk.id,push,String(b.platform||'EXPO'),now(),now()); return json(res,{ok:true});
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/bookings\/[^/]+\/requests$/)){
      const ref=decodeURIComponent(url.pathname.split('/')[4]), bk=one('SELECT * FROM bookings WHERE reference=?',ref); if(!bk)return json(res,{error:'Booking not found'},404); const b=await body(req); if(!publicAuthOk(bk,b))return json(res,{error:'Secure booking access required'},403); const type=String(b.type||'').toUpperCase(); if(!['TRIP_CHANGE','SEAT_CHANGE','CANCEL','REFUND'].includes(type))return json(res,{error:'Invalid request type'},400); const note=String(b.note||'').trim(); if(note.length<3||note.length>1500)return json(res,{error:'Request details must be between 3 and 1500 characters'},400); if(['CANCEL','REFUND'].includes(type)&&['CANCELLED','REFUNDED','EXPIRED'].includes(String(bk.status)))return json(res,{error:'This booking is already closed'},409); const existing=one("SELECT id FROM booking_requests WHERE booking_id=? AND type=? AND status='PENDING'",bk.id,type); if(existing)return json(res,{error:'A pending request of this type already exists'},409); const id=uid();run('INSERT INTO booking_requests(id,booking_id,type,note,status,admin_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,bk.id,type,note,'PENDING','',now(),now()); queueAdminAlert(bk,'Booking change request',`${ref}
Request: ${type}
${note}`,'ADMIN_BOOKING_REQUEST'); processNotifications().catch(console.error); audit('PUBLIC','BOOKING_REQUEST_CREATED','booking_request',id,{booking:ref,type}); return json(res,{ok:true,id,status:'PENDING'});
    }
    if(req.method==='POST'&&url.pathname.match(/^\/api\/public\/bookings\/[^/]+\/receipt$/)){
      const ref=decodeURIComponent(url.pathname.split('/')[4]), bk=one('SELECT * FROM bookings WHERE reference=?',ref); if(!bk)return json(res,{error:'Booking not found'},404); const b=await body(req); if(!publicAuthOk(bk,b))return json(res,{error:'Booking reference and phone/email do not match, or secure link is invalid'},403); if(!b.data_base64||!b.filename)return json(res,{error:'Receipt file required'},400); const m=String(b.data_base64).match(/^data:[^;]+;base64,(.+)$/); if(!m)return json(res,{error:'Invalid receipt data'},400); const buf=Buffer.from(m[1],'base64'); if(buf.length>5*1024*1024)return json(res,{error:'Receipt must be 5 MB or less'},400); const sig=sniffReceipt(buf); if(!sig)return json(res,{error:'File content is not a valid JPG, PNG or PDF'},400);
      let p=one("SELECT * FROM payments WHERE booking_id=? AND method='BANK_TRANSFER' AND status IN ('PENDING','RECEIPT_SUBMITTED') ORDER BY created_at DESC LIMIT 1",bk.id); if(!p){const rejected=one("SELECT * FROM payments WHERE booking_id=? AND method='BANK_TRANSFER' AND status='REJECTED' ORDER BY created_at DESC LIMIT 1",bk.id); if(!rejected)return json(res,{error:'No bank transfer payment is available for receipt upload'},409); const pid=uid();run('INSERT INTO payments(id,booking_id,method,provider,amount,currency,payment_link,external_reference,receipt_url,status,verified_by,verified_at,created_at,gateway_payload,amount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',pid,bk.id,'BANK_TRANSFER',rejected.provider,rejected.amount,rejected.currency,'','','','PENDING',null,null,now(),'{}',rejected.amount_minor);p=one('SELECT * FROM payments WHERE id=?',pid);run("UPDATE bookings SET payment_status='PENDING' WHERE id=?",bk.id);}
      const name=`${p.id}.${sig.ext}`; fs.writeFileSync(path.join(UPLOAD_DIR,name),buf,{mode:0o600}); const receipt=`/api/admin/receipts/${encodeURIComponent(p.id)}`; run("UPDATE payments SET receipt_url=?,status='RECEIPT_SUBMITTED' WHERE id=?",receipt,p.id); run("UPDATE bookings SET payment_status='RECEIPT_SUBMITTED' WHERE id=?",bk.id); if(boolSetting('notify_admin_receipt',true))queueAdminAlert(bk,'Payment receipt uploaded',`Customer uploaded a payment receipt for ${bk.reference}.\nAmount: ${p.currency} ${minorToMajor(p.amount_minor ?? Math.round(Number(p.amount)*100)).toFixed(2)}\n\nReview now: ${adminVerifyUrl(p.id)}`,'ADMIN_RECEIPT'); audit('PUBLIC','PAYMENT_RECEIPT_UPLOADED','payment',p.id,{booking:bk.reference,mime:sig.mime,size:buf.length}); processNotifications().catch(console.error); return json(res,{ok:true,payment_id:p.id});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/public/bookings/')){
      const ref=decodeURIComponent(url.pathname.split('/').pop()), bk=one('SELECT * FROM bookings WHERE reference=?',ref); if(!bk)return json(res,{error:'Booking not found'},404); if(!publicAuthOk(bk,{token:url.searchParams.get('token'),contact:url.searchParams.get('contact')}))return json(res,{error:'Enter the booking phone/email, or use the secure Manage Booking link'},403); const passengerRows=q('SELECT id,passenger_name,passenger_type,residency_class,seat_no FROM booking_lines WHERE booking_id=? ORDER BY rowid',bk.id); const passengers=passengerRows.map(p=>{const tk=ensurePassengerTicket(p.id);return {...p,ticket_token:tk.token,ticket_qr:ticketQrValue(tk.token)}}); const payments=q('SELECT id,method,provider,amount,currency,payment_link,receipt_url,status,verified_at,created_at,rejection_reason FROM payments WHERE booking_id=? ORDER BY created_at DESC',bk.id); const requests=q('SELECT id,type,note,status,admin_note,created_at,updated_at FROM booking_requests WHERE booking_id=? ORDER BY created_at DESC',bk.id); const bankPayment=payments.find(x=>x.method==='BANK_TRANSFER'); const bank_details=bankPayment?{bank_name:getSetting('bank_name',''),account_name:getSetting('bank_account_name',''),mvr:getSetting('bank_mvr',''),usd:getSetting('bank_usd','')}:null; return json(res,{booking:publicBookingShape(bk),trip:tripRows('t.id=?',[bk.trip_id])[0],passengers,payments,requests,bank_details});
    }

    if(req.method==='POST'&&url.pathname.startsWith('/api/webhooks/payment/')){
      const provider=decodeURIComponent(url.pathname.split('/').pop()), raw=await rawBody(req,2e6), secret=getSecret('payment_gateway_webhook_secret'); if(!secret)return json(res,{error:'Webhook secret not configured'},503); const sig=String(req.headers['x-signature']||req.headers['x-webhook-signature']||'').replace(/^sha256=/,''); const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex'); if(!sig||sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return json(res,{error:'Invalid webhook signature'},401);
      let b; try{b=JSON.parse(raw.toString('utf8'))}catch{return json(res,{error:'Invalid JSON'},400)} const eventKey=String(b.event_id||b.transaction_id||b.reference||sha256(raw)); const previous=one('SELECT * FROM webhook_events WHERE event_key=?',eventKey); if(previous?.status==='PROCESSED')return json(res,{ok:true,duplicate:true}); if(previous)run("UPDATE webhook_events SET payload=?,status='PROCESSING',last_error=NULL WHERE event_key=?",raw.toString('utf8'),eventKey); else run('INSERT INTO webhook_events(id,provider,event_key,payload,status,last_error,created_at,processed_at) VALUES(?,?,?,?,?,?,?,NULL)',uid(),provider,eventKey,raw.toString('utf8'),'PROCESSING',null,now());
      try{ const ref=String(b.booking_reference||b.booking_ref||b.metadata?.booking_reference||''); const p=ref?one('SELECT p.* FROM payments p JOIN bookings bk ON bk.id=p.booking_id WHERE bk.reference=? ORDER BY p.created_at DESC LIMIT 1',ref):one('SELECT * FROM payments WHERE external_reference=? ORDER BY created_at DESC LIMIT 1',String(b.transaction_id||b.reference||'')); if(!p)throw new Error('Payment not found'); const status=String(b.status||b.payment_status||'').toUpperCase(); const paid=['PAID','SUCCESS','SUCCEEDED','COMPLETED'].includes(status); if(!paid){run("UPDATE webhook_events SET status='PROCESSED',processed_at=? WHERE event_key=?",now(),eventKey);return json(res,{ok:true,ignored_status:status})} const incomingMinor=parseMoney(String(b.amount)); if(incomingMinor!==Number(p.amount_minor??Math.round(Number(p.amount)*100))||String(b.currency||'').toUpperCase()!==String(p.currency).toUpperCase())throw new Error('Amount or currency mismatch'); if(p.status==='PAID'){run("UPDATE webhook_events SET status='PROCESSED',processed_at=?,last_error=NULL WHERE event_key=?",now(),eventKey);return json(res,{ok:true,already_paid:true})} if(!['PENDING','RECEIPT_SUBMITTED'].includes(String(p.status)))throw new Error(`Payment cannot be confirmed from status ${p.status}`); run('UPDATE payments SET external_reference=?,gateway_payload=? WHERE id=?',String(b.transaction_id||b.reference||p.external_reference||''),raw.toString('utf8'),p.id); await confirmPayment(p,'GATEWAY_WEBHOOK',provider); run("UPDATE webhook_events SET status='PROCESSED',processed_at=?,last_error=NULL WHERE event_key=?",now(),eventKey); return json(res,{ok:true}); }catch(e){run("UPDATE webhook_events SET status='FAILED',last_error=? WHERE event_key=?",String(e.message||e).slice(0,500),eventKey); return json(res,{error:e.message||'Webhook processing failed'},500)}
    }

    const u=session(req); if(!u)return json(res,{error:'Unauthorized'},401);
    if(req.method==='POST'&&url.pathname==='/api/logout'){const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(token)run('DELETE FROM sessions WHERE token_hash=?',sha256(token));return json(res,{ok:true})}
    if(Boolean(u.password_change_required) && !(req.method==='POST'&&url.pathname==='/api/admin/change-password')) return json(res,{error:'Password change required before using admin features',code:'PASSWORD_CHANGE_REQUIRED'},403);
    if(req.method==='POST'&&url.pathname==='/api/admin/change-password'){const b=await body(req);if(!verifyPassword(u.password_hash,b.current_password))return json(res,{error:'Current password is incorrect'},400);let newHash;try{newHash=passwordHash(b.new_password,{currentPassword:b.current_password})}catch(e){return json(res,{error:e.message},e.status||400)}run('UPDATE users SET password_hash=?,password_change_required=0 WHERE id=?',newHash,u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);audit(u.username,'PASSWORD_CHANGED','user',u.id);return json(res,{ok:true,login_again:true})}
    if(req.method==='GET'&&url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/receipt-data$/)){if(!requirePerm(res,u,'PAYMENTS_VIEW'))return;const parts=url.pathname.split('/'),pid=decodeURIComponent(parts[4]),pmt=one('SELECT * FROM payments WHERE id=?',pid);if(!pmt||!pmt.receipt_url)return json(res,{error:'Receipt not found'},404);const files=fs.readdirSync(UPLOAD_DIR).filter(x=>x.startsWith(pid+'.'));if(!files.length)return json(res,{error:'Receipt file not found'},404);const f=path.join(UPLOAD_DIR,files[0]),ext=path.extname(f).toLowerCase(),contentType=ext==='.pdf'?'application/pdf':ext==='.png'?'image/png':'image/jpeg';const buf=fs.readFileSync(f);return json(res,{content_type:contentType,filename:`receipt${ext}`,data_base64:buf.toString('base64')});}
    if(req.method==='GET'&&url.pathname.startsWith('/api/admin/receipts/')){if(!requirePerm(res,u,'PAYMENTS_VIEW'))return; const pid=decodeURIComponent(url.pathname.split('/').pop()), p=one('SELECT * FROM payments WHERE id=?',pid); if(!p||!p.receipt_url)return json(res,{error:'Receipt not found'},404); const files=fs.readdirSync(UPLOAD_DIR).filter(x=>x.startsWith(pid+'.')); if(!files.length)return json(res,{error:'Receipt file not found'},404); const f=path.join(UPLOAD_DIR,files[0]), ext=path.extname(f).toLowerCase(), ct=ext==='.pdf'?'application/pdf':ext==='.png'?'image/png':'image/jpeg'; return send(res,200,fs.readFileSync(f),{'Content-Type':ct,'Content-Disposition':`inline; filename="receipt${ext}"`});}
    if(req.method==='GET'&&url.pathname==='/api/admin/dashboard'){if(!requirePerm(res,u,'DASHBOARD'))return; const [s,e]=maldivesUtcRange(maldivesDate()); const trips=tripRows('t.departure_at>=? AND t.departure_at<?',[s,e]); const revenue=Number(one("SELECT COALESCE(SUM(total_mvr_minor),0) v FROM bookings WHERE payment_status='PAID' AND created_at>=? AND created_at<?",s,e).v||0); const exp=Number(one('SELECT COALESCE(SUM(amount_mvr_minor),0) v FROM expenses WHERE expense_date=?',maldivesDate()).v||0); return json(res,{trips,totals:{trips:trips.length,passengers:trips.reduce((x,r)=>x+Number(r.booked||0),0),revenue:minorToMajor(revenue),expenses:minorToMajor(exp),profit:minorToMajor(revenue-exp),pending:Number(one("SELECT COUNT(*) c FROM payments WHERE status IN ('PENDING','RECEIPT_SUBMITTED')").c)}});}
    if(req.method==='GET'&&url.pathname==='/api/admin/bookings'){if(!requirePerm(res,u,'BOOKINGS_VIEW'))return;return json(res,q(`SELECT bk.id,bk.reference,bk.customer_name,bk.currency,bk.total_amount,bk.status,bk.payment_status,bk.created_at,t.trip_no,l1.name departure_name,l2.name arrival_name FROM bookings bk LEFT JOIN trips t ON t.id=bk.trip_id LEFT JOIN locations l1 ON l1.id=t.departure_location_id LEFT JOIN locations l2 ON l2.id=t.arrival_location_id ORDER BY bk.created_at DESC`));}
    if(req.method==='GET'&&url.pathname==='/api/admin/payments'){if(!requirePerm(res,u,'PAYMENTS_VIEW'))return;return json(res,q(`SELECT p.*,bk.reference,bk.customer_name,bk.phone,bk.email,t.trip_no,l1.name departure_name,l2.name arrival_name,t.departure_at FROM payments p LEFT JOIN bookings bk ON bk.id=p.booking_id LEFT JOIN trips t ON t.id=bk.trip_id LEFT JOIN locations l1 ON l1.id=t.departure_location_id LEFT JOIN locations l2 ON l2.id=t.arrival_location_id ORDER BY p.created_at DESC`));}
    if(req.method==='GET'&&url.pathname.match(/^\/api\/admin\/payments\/[^/]+$/)){if(!requirePerm(res,u,'PAYMENTS_VIEW'))return;const pid=url.pathname.split('/').pop();const p=one(`SELECT p.*,bk.reference,bk.customer_name,bk.phone,bk.email,bk.status booking_status,bk.payment_status,t.trip_no,b.name boat_name,l1.name departure_name,l2.name arrival_name,t.departure_at,t.arrival_at FROM payments p JOIN bookings bk ON bk.id=p.booking_id JOIN trips t ON t.id=bk.trip_id LEFT JOIN boats b ON b.id=t.boat_id LEFT JOIN locations l1 ON l1.id=t.departure_location_id LEFT JOIN locations l2 ON l2.id=t.arrival_location_id WHERE p.id=?`,pid);if(!p)return json(res,{error:'Payment not found'},404);return json(res,p)}
    if(req.method==='POST'&&url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/approve$/)){if(!requirePerm(res,u,'PAYMENTS_VERIFY'))return;const pid=url.pathname.split('/')[4],p=one('SELECT * FROM payments WHERE id=?',pid);if(!p)return json(res,{error:'Payment not found'},404);try{await confirmPayment(p,u.username,'ADMIN');return json(res,{ok:true})}catch(e){return json(res,{error:e.message},e.status||409)}}
    if(req.method==='POST'&&url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/reject$/)){if(!requirePerm(res,u,'PAYMENTS_VERIFY'))return;const pid=url.pathname.split('/')[4],p=one('SELECT * FROM payments WHERE id=?',pid);if(!p)return json(res,{error:'Payment not found'},404);if(!['PENDING','RECEIPT_SUBMITTED'].includes(String(p.status)))return json(res,{error:`Payment cannot be rejected from status ${p.status}`},409);const b=await body(req);run("UPDATE payments SET status='REJECTED',rejected_by=?,rejected_at=?,rejection_reason=? WHERE id=?",u.id,now(),String(b.reason||'Payment could not be verified'),pid);const bk=one('SELECT * FROM bookings WHERE id=?',p.booking_id);run("UPDATE bookings SET payment_status='REJECTED',status='PENDING_PAYMENT' WHERE id=?",bk.id);queueCustomer(bk,'Payment verification issue',`We could not verify the payment for booking ${bk.reference}.\nReason: ${String(b.reason||'Please upload a new receipt.')}`,'CUSTOMER_PAYMENT_REJECTED');sendExpoPushForBooking(bk.id,'Payment needs attention',`${bk.reference}: ${String(b.reason||'Please upload a new receipt.')}`,{reference:bk.reference,type:'PAYMENT_REJECTED'}).catch(console.error);audit(u.username,'PAYMENT_REJECTED','payment',pid,{booking:bk.reference,reason:b.reason||''});processNotifications().catch(console.error);return json(res,{ok:true})}
    if(req.method==='POST'&&url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/resend$/)){if(!requirePerm(res,u,'PAYMENTS_VIEW'))return;const pid=url.pathname.split('/')[4],p=one('SELECT * FROM payments WHERE id=?',pid);if(!p)return json(res,{error:'Payment not found'},404);const bk=one('SELECT * FROM bookings WHERE id=?',p.booking_id);if(p.method==='BANK_TRANSFER')queueCustomer(bk,'Bank transfer details',`Booking ${bk.reference}\nAmount: ${p.currency} ${minorToMajor(p.amount_minor).toFixed(2)}\n\n${bankDetailsText()}`,'CUSTOMER_BANK_TRANSFER',false);else if(p.payment_link)queueCustomer(bk,'Complete your payment',`Booking ${bk.reference}\nAmount: ${p.currency} ${minorToMajor(p.amount_minor).toFixed(2)}\nPay: ${p.payment_link}`,'CUSTOMER_PAYMENT_LINK',false);processNotifications().catch(console.error);audit(u.username,'PAYMENT_MESSAGE_RESENT','payment',pid,{booking:bk.reference});return json(res,{ok:true})}
    if(req.method==='GET'&&url.pathname==='/api/admin/tax-profiles'){if(!requirePerm(res,u,'TRIPS_VIEW'))return;return json(res,q('SELECT * FROM tax_profiles WHERE active=1 ORDER BY effective_from DESC'))}
    if(req.method==='GET'&&url.pathname==='/api/admin/trips'){if(!requirePerm(res,u,'TRIPS_VIEW'))return;return json(res,tripRows())}
    if(req.method==='POST'&&url.pathname==='/api/admin/trips'){if(!requirePerm(res,u,'TRIPS_EDIT'))return;const b=await body(req);if(new Date(b.departure_at)<=new Date())return json(res,{error:'Departure must be in the future'},400);const tid=uid();const legacy={adult_mvr:Number(b.tourist_adult_mvr??b.adult_mvr),adult_usd:Number(b.tourist_adult_usd??b.adult_usd),child_mvr:Number(b.tourist_child_mvr??b.child_mvr),child_usd:Number(b.tourist_child_usd??b.child_usd),infant_mvr:Number(b.tourist_infant_mvr??b.infant_mvr??0),infant_usd:Number(b.tourist_infant_usd??b.infant_usd??0)};run('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',tid,b.trip_no,b.boat_id,b.departure_location_id,b.arrival_location_id,b.departure_at,b.arrival_at,legacy.adult_mvr,legacy.adult_usd,legacy.child_mvr,legacy.child_usd,legacy.infant_mvr,legacy.infant_usd,b.price_includes_tax?1:0,b.tax_profile_id,b.status||'SCHEDULED');const farePayload=b.fares||{TOURIST:{ADULT:{MVR:legacy.adult_mvr,USD:legacy.adult_usd},CHILD:{MVR:legacy.child_mvr,USD:legacy.child_usd},INFANT:{MVR:legacy.infant_mvr,USD:legacy.infant_usd}},LOCAL:{ADULT:{MVR:b.local_adult_mvr??legacy.adult_mvr,USD:b.local_adult_usd??legacy.adult_usd},CHILD:{MVR:b.local_child_mvr??legacy.child_mvr,USD:b.local_child_usd??legacy.child_usd},INFANT:{MVR:b.local_infant_mvr??legacy.infant_mvr,USD:b.local_infant_usd??legacy.infant_usd}}};for(const rc of ['LOCAL','TOURIST'])for(const pt of ['ADULT','CHILD','INFANT'])for(const cur of ['MVR','USD']){const val=farePayload?.[rc]?.[pt]?.[cur];if(val===undefined)throw new Error(`Missing ${rc} ${pt} ${cur} fare`);run('INSERT INTO fares VALUES(?,?,?,?,?,?,1)',uid(),tid,pt,rc,cur,validateFareAmount(pt,val))}audit(u.username,'TRIP_CREATED','trip',tid,b);return json(res,{id:tid})}
    if(req.method==='GET'&&url.pathname.match(/^\/api\/admin\/trips\/[^/]+\/impact$/)){if(!requirePerm(res,u,'TRIPS_VIEW'))return;const tid=url.pathname.split('/')[4];const active=q("SELECT bk.id FROM bookings bk WHERE bk.trip_id=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",tid);const passengers=Number(one("SELECT COUNT(*) c FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",tid).c);return json(res,{bookings:active.length,passengers})}
    if(req.method==='PUT'&&url.pathname.startsWith('/api/admin/trips/')){if(!requirePerm(res,u,'TRIPS_EDIT'))return;const tid=url.pathname.split('/').pop(),old=one('SELECT * FROM trips WHERE id=?',tid);if(!old)return json(res,{error:'Trip not found'},404);const b=await body(req),merged={...old,...b};const changedFields=['boat_id','departure_location_id','arrival_location_id','departure_at','arrival_at','status'].filter(k=>String(old[k])!==String(merged[k]));const affected=changedFields.length?Number(one("SELECT COUNT(*) c FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.trip_id=? AND bk.status NOT IN ('CANCELLED','EXPIRED')",tid).c):0;if(changedFields.length&&affected>0&&!b.confirm_change)return json(res,{error:`This change affects ${affected} booked passengers`,requires_confirmation:true,affected_passengers:affected,changed_fields:changedFields},409);run('UPDATE trips SET boat_id=?,departure_location_id=?,arrival_location_id=?,departure_at=?,arrival_at=?,adult_mvr=?,adult_usd=?,child_mvr=?,child_usd=?,infant_mvr=?,infant_usd=?,price_includes_tax=?,tax_profile_id=?,status=? WHERE id=?',merged.boat_id,merged.departure_location_id,merged.arrival_location_id,merged.departure_at,merged.arrival_at,merged.adult_mvr,merged.adult_usd,merged.child_mvr,merged.child_usd,merged.infant_mvr||0,merged.infant_usd||0,merged.price_includes_tax?1:0,merged.tax_profile_id,merged.status,tid);if(b.fares){for(const rc of ['LOCAL','TOURIST'])for(const pt of ['ADULT','CHILD','INFANT'])for(const cur of ['MVR','USD'])if(b.fares?.[rc]?.[pt]?.[cur]!==undefined)run('UPDATE fares SET amount_minor=? WHERE trip_id=? AND residency_class=? AND passenger_type=? AND currency=?',validateFareAmount(pt,b.fares[rc][pt][cur]),tid,rc,pt,cur)}if(changedFields.length&&b.notify_customers!==false){const bookings=q("SELECT * FROM bookings WHERE trip_id=? AND status NOT IN ('CANCELLED','EXPIRED')",tid);for(const bk of bookings){queueCustomer(bk,'Trip updated',`IMPORTANT TRIP UPDATE\nBooking ${bk.reference}\nYour trip has changed.\n\n${formatTripMessage(bk)}\n\nPlease check your latest travel details.`,'CUSTOMER_TRIP_CHANGE');sendExpoPushForBooking(bk.id,'Trip updated',`${bk.reference}: your travel details changed. Tap to view.`,{reference:bk.reference,type:'TRIP_UPDATED'}).catch(console.error)}processNotifications().catch(console.error)}audit(u.username,'TRIP_UPDATED','trip',tid,{changed_fields:changedFields,affected_passengers:affected});return json(res,{ok:true,affected_passengers:affected})}
    if(req.method==='GET'&&url.pathname==='/api/admin/boats'){if(!requirePerm(res,u,'TRIPS_VIEW'))return;return json(res,q('SELECT * FROM boats ORDER BY name'))}
    if(req.method==='POST'&&url.pathname==='/api/admin/boats'){if(!requirePerm(res,u,'TRIPS_EDIT'))return;const b=await body(req),x=uid();run('INSERT INTO boats VALUES(?,?,?,?,?,1)',x,b.name,b.reg_no||'',b.code||'',Number(b.seat_capacity));audit(u.username,'BOAT_CREATED','boat',x,b);return json(res,{id:x})}
    if(req.method==='GET'&&url.pathname==='/api/admin/locations'){if(!requirePerm(res,u,'TRIPS_VIEW'))return;return json(res,q('SELECT * FROM locations ORDER BY name'))}
    if(req.method==='POST'&&url.pathname==='/api/admin/locations'){if(!requirePerm(res,u,'TRIPS_EDIT'))return;const b=await body(req),x=uid();run('INSERT INTO locations VALUES(?,?,?,?,?,?,1)',x,b.name,b.island||'',b.atoll||'',b.jetty_name||'',b.map_url||'');audit(u.username,'LOCATION_CREATED','location',x,b);return json(res,{id:x})}
    if(req.method==='GET'&&url.pathname==='/api/admin/settings'){if(!requirePerm(res,u,'SETTINGS'))return;return json(res,{company:companyAdmin()})}
    if(req.method==='POST'&&url.pathname==='/api/admin/settings'){if(!requirePerm(res,u,'SETTINGS'))return;const b=await body(req);for(const[k,v]of Object.entries(b)){if(SECRET_KEYS.has(k)){if(v)setSecret(k,v)}else setSetting(k,v)}audit(u.username,'SETTINGS_UPDATED','settings','company',{keys:Object.keys(b)});return json(res,{ok:true})}
    if(req.method==='POST'&&url.pathname==='/api/admin/integrations/test'){if(!requirePerm(res,u,'SETTINGS'))return;const b=await body(req),ch=String(b.channel||'').toUpperCase();if(ch==='TELEGRAM'){const to=b.recipient||getSetting('admin_telegram_chat_id',''),mid=await sendTelegram(to,`Nasru Speed test message\n${fmtDateTime(now())}`);return json(res,{ok:true,message_id:mid})}if(ch==='WHATSAPP'){const temp=getSetting('whatsapp_admin_alert_template','');if(!temp&&!boolSetting('whatsapp_allow_free_text',false))return json(res,{error:'Configure an approved WhatsApp admin template, or temporarily allow free text for an open 24-hour conversation'},400);const n={recipient:b.recipient||getSetting('admin_whatsapp_number',''),subject:'Nasru Speed test',message:`Test ${fmtDateTime(now())}`,kind:'ADMIN_TEST',template_name:temp,template_params_json:JSON.stringify([`Nasru Speed test ${fmtDateTime(now())}`])};const mid=await sendWhatsAppNotification(n);return json(res,{ok:true,message_id:mid})}return json(res,{error:'Unknown channel'},400)}
    if(req.method==='GET'&&url.pathname==='/api/admin/exchange-rates'){if(!requirePerm(res,u,'SETTINGS'))return;return json(res,q('SELECT * FROM exchange_rates ORDER BY effective_from DESC'))}
    if(req.method==='POST'&&url.pathname==='/api/admin/exchange-rates'){if(!requirePerm(res,u,'SETTINGS'))return;const b=await body(req);rateMicros(String(b.rate));run('UPDATE exchange_rates SET active=0 WHERE currency=?',b.currency||'USD');const x=uid();run('INSERT INTO exchange_rates VALUES(?,?,?,?,?,?,?,?,?)',x,b.currency||'USD','MVR',String(b.rate),b.source||'MANUAL',b.effective_from||now(),null,1,now());audit(u.username,'EXCHANGE_RATE_CREATED','exchange_rate',x,b);return json(res,{id:x})}
    if(req.method==='GET'&&url.pathname==='/api/admin/expenses'){if(!requirePerm(res,u,'EXPENSES_VIEW'))return;return json(res,q('SELECT * FROM expenses ORDER BY expense_date DESC'))}
    if(req.method==='POST'&&url.pathname==='/api/admin/expenses'){if(!requirePerm(res,u,'EXPENSES_EDIT'))return;const b=await body(req),x=uid(),minor=parseMoney(String(b.amount_mvr));run('INSERT INTO expenses(id,expense_date,category,description,amount_mvr,payment_method,trip_id,boat_id,created_at,amount_mvr_minor) VALUES(?,?,?,?,?,?,?,?,?,?)',x,b.expense_date||maldivesDate(),b.category,b.description||'',minorToMajor(minor),b.payment_method||'CASH',b.trip_id||null,b.boat_id||null,now(),minor);audit(u.username,'EXPENSE_CREATED','expense',x,b);return json(res,{id:x})}
    if(req.method==='GET'&&url.pathname==='/api/admin/notifications'){if(!requirePerm(res,u,'NOTIFICATIONS'))return;return json(res,q('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 300'))}
    if(req.method==='GET'&&url.pathname==='/api/admin/booking-requests'){if(!requirePerm(res,u,'BOOKINGS_VIEW'))return;return json(res,q(`SELECT r.*,bk.reference,bk.customer_name,bk.phone,bk.email,t.trip_no,l1.name departure_name,l2.name arrival_name,t.departure_at FROM booking_requests r JOIN bookings bk ON bk.id=r.booking_id LEFT JOIN trips t ON t.id=bk.trip_id LEFT JOIN locations l1 ON l1.id=t.departure_location_id LEFT JOIN locations l2 ON l2.id=t.arrival_location_id ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END,r.created_at DESC`))}
    if(req.method==='POST'&&url.pathname.match(/^\/api\/admin\/booking-requests\/[^/]+$/)){if(!requirePerm(res,u,'BOOKINGS_EDIT'))return;const id=url.pathname.split('/').pop(),r=one('SELECT * FROM booking_requests WHERE id=?',id);if(!r)return json(res,{error:'Request not found'},404);if(r.status!=='PENDING')return json(res,{error:'Request is already closed'},409);const b=await body(req),status=String(b.status||'').toUpperCase();if(!['APPROVED','REJECTED','COMPLETED'].includes(status))return json(res,{error:'Invalid request status'},400);run('UPDATE booking_requests SET status=?,admin_note=?,updated_at=? WHERE id=?',status,String(b.admin_note||''),now(),id);const bk=one('SELECT * FROM bookings WHERE id=?',r.booking_id);sendExpoPushForBooking(bk.id,'Booking request updated',`${bk.reference}: ${r.type} request is ${status.toLowerCase()}.`,{reference:bk.reference,type:'REQUEST_UPDATED'}).catch(console.error);queueCustomer(bk,'Booking request updated',`Your ${r.type} request for ${bk.reference} is ${status}.
${String(b.admin_note||'')}`,'CUSTOMER_REQUEST_UPDATE');processNotifications().catch(console.error);audit(u.username,'BOOKING_REQUEST_UPDATED','booking_request',id,{status,admin_note:b.admin_note||''});return json(res,{ok:true})}
    if(req.method==='POST'&&url.pathname.match(/^\/api\/admin\/notifications\/[^/]+\/retry$/)){if(!requirePerm(res,u,'NOTIFICATIONS'))return;const nid=url.pathname.split('/')[4];run("UPDATE notifications SET status='QUEUED',attempts=0,next_attempt_at=?,last_error=NULL,claimed_at=NULL,dedupe_key=NULL WHERE id=?",now(),nid);processNotifications().catch(console.error);return json(res,{ok:true})}
    if(req.method==='GET'&&url.pathname==='/api/admin/audit'){if(!requirePerm(res,u,'AUDIT'))return;return json(res,q('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500'))}
    if(req.method==='GET'&&url.pathname==='/api/admin/users'){if(!requirePerm(res,u,'USERS_MANAGE'))return;return json(res,q('SELECT id,username,name,role,permissions,active,password_change_required FROM users ORDER BY name'))}
    if(req.method==='POST'&&url.pathname==='/api/admin/users'){if(!requirePerm(res,u,'USERS_MANAGE'))return;const b=await body(req),x=uid();let ph;try{ph=passwordHash(b.password)}catch(e){return json(res,{error:e.message},e.status||400)}run('INSERT INTO users(id,username,password_hash,name,role,permissions,active,password_change_required) VALUES(?,?,?,?,?,?,1,1)',x,b.username,ph,b.name,b.role||'STAFF',JSON.stringify(b.permissions||[]));audit(u.username,'USER_CREATED','user',x,{username:b.username,role:b.role,permissions:b.permissions});return json(res,{id:x})}
    if(req.method==='GET'&&url.pathname==='/api/admin/report'){if(!requirePerm(res,u,'REPORTS_FINANCIAL'))return;const type=url.searchParams.get('type')||'daily',from=url.searchParams.get('from')||maldivesDate(),to=url.searchParams.get('to')||from,[s]=maldivesUtcRange(from),[,e]=maldivesUtcRange(to);const sales=q('SELECT bk.reference,bk.created_at,bk.total_mvr,bk.total_mvr_minor,bk.currency,bk.total_amount,bk.payment_status FROM bookings bk WHERE bk.created_at>=? AND bk.created_at<? ORDER BY bk.created_at',s,e),expenses=q('SELECT expense_date,category,description,amount_mvr,amount_mvr_minor FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date',from,to);const revenueMinor=sales.filter(x=>x.payment_status==='PAID').reduce((sum,x)=>sum+Number(x.total_mvr_minor??Math.round(Number(x.total_mvr||0)*100)),0),expMinor=expenses.reduce((sum,x)=>sum+Number(x.amount_mvr_minor??Math.round(Number(x.amount_mvr||0)*100)),0),gstMinor=Number(one(`SELECT COALESCE(SUM(bl.mvr_gst_minor),0) v FROM booking_lines bl JOIN bookings bk ON bk.id=bl.booking_id WHERE bk.payment_status='PAID' AND bk.created_at>=? AND bk.created_at<?`,s,e).v||0);return json(res,{type,from,to,sales,expenses,totals:{revenue:minorToMajor(revenueMinor),expenses:minorToMajor(expMinor),profit:minorToMajor(revenueMinor-expMinor),gst:minorToMajor(gstMinor)}})}
    if(req.method==='GET'&&url.pathname==='/api/admin/export'){if(!requirePerm(res,u,'REPORTS_FINANCIAL'))return;const format=url.searchParams.get('format')||'pdf',from=url.searchParams.get('from')||maldivesDate(),to=url.searchParams.get('to')||from,[s]=maldivesUtcRange(from),[,e]=maldivesUtcRange(to),sales=q('SELECT reference,created_at,total_mvr,total_mvr_minor,payment_status FROM bookings WHERE created_at>=? AND created_at<? ORDER BY created_at',s,e),revenueMinor=sales.filter(x=>x.payment_status==='PAID').reduce((sum,x)=>sum+Number(x.total_mvr_minor??Math.round(Number(x.total_mvr||0)*100)),0);audit(u.username,'REPORT_EXPORTED','report','financial',{format,from,to,records:sales.length});if(format==='xls'){const xml=xlsXml('Report',['Reference','Created (Maldives)','MVR Total','Status'],sales.map(x=>[x.reference,fmtDateTime(x.created_at),minorToMajor(x.total_mvr_minor??Math.round(Number(x.total_mvr||0)*100)),x.payment_status]));return send(res,200,xml,{'Content-Type':'application/vnd.ms-excel','Content-Disposition':`attachment; filename="Nasru-Speed-Report-${from}-${to}.xls"`})}const lines=[getSetting('company_name','Nasru Speed'),`Financial Report ${from} to ${to} (Maldives time)`,`Generated by ${u.name} at ${fmtDateTime(now())}`,'',...sales.map(x=>`${x.reference} | ${fmtDateTime(x.created_at)} | MVR ${minorToMajor(x.total_mvr_minor??Math.round(Number(x.total_mvr||0)*100)).toFixed(2)} | ${x.payment_status}`),'',`Paid revenue: MVR ${minorToMajor(revenueMinor).toFixed(2)}`];return send(res,200,pdfBuffer(lines),{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Nasru-Speed-Report-${from}-${to}.pdf"`})}
    return json(res,{error:'API route not found'},404);
  }catch(e){console.error(e);return json(res,{error:e.message||'Server error'},e.status||500)}
}

const server=http.createServer(async(req,res)=>{const url=parseUrl(req);if(url.pathname.startsWith('/api/'))return api(req,res,url);let p=url.pathname==='/'?'/index.html':url.pathname;p=path.normalize(p).replace(/^\.\.(\/|\\)/,'');const file=path.join(__dirname,'public',p);if(!file.startsWith(path.join(__dirname,'public'))||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});fs.createReadStream(file).pipe(res)});
server.listen(PORT,HOST,()=>console.log(`Nasru Speed running on http://${HOST}:${PORT} (${MALDIVES_TZ})`));