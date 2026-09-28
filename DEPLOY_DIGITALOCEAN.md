# DigitalOcean deployment: Nasru Speed v4

This guide deploys one Node.js application process behind Nginx on Ubuntu 24.04.

## 1. Create the Droplet

Use Ubuntu 24.04 LTS. A Basic Droplet with 2 GB RAM is a comfortable starting point.

## 2. Connect

```bash
ssh root@YOUR_SERVER_IP
```

## 3. Update and install software

```bash
apt update && apt upgrade -y
apt install -y nginx unzip curl ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
node -v
```

Use Node 22 or newer.

## 4. Create a dedicated Linux user

```bash
adduser --system --group --home /var/www/nasru-speed nasruspeed
mkdir -p /var/www/nasru-speed
chown -R nasruspeed:nasruspeed /var/www/nasru-speed
```

## 5. Upload and extract the ZIP

Upload the project ZIP to `/var/www/nasru-speed/`, then:

```bash
cd /var/www/nasru-speed
unzip nasru-speed-ferry-system-v4.zip
chown -R nasruspeed:nasruspeed /var/www/nasru-speed/nasru-speed-ferry-system-v4
cd /var/www/nasru-speed/nasru-speed-ferry-system-v4
```

## 6. Create production environment settings

Generate a strong app secret:

```bash
openssl rand -hex 32
```

Create `.env`:

```bash
nano .env
```

Example:

```text
NODE_ENV=production
PORT=4173
HOST=127.0.0.1
PUBLIC_BASE_URL=https://booking.yourdomain.com
TZ=Indian/Maldives
APP_SECRET=PASTE_THE_RANDOM_SECRET_HERE
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=USE_A_STRONG_UNIQUE_PASSWORD_HERE
```

`APP_SECRET` protects stored integration credentials. Do not lose it.

On first start the admin account is created from `ADMIN_INITIAL_PASSWORD`. After login, change the password from Company Settings.

## 7. Protect file permissions

```bash
chown -R nasruspeed:nasruspeed /var/www/nasru-speed/nasru-speed-ferry-system-v4
chmod 600 .env
mkdir -p data/uploads
chmod 700 data data/uploads
```

## 8. Test the app

```bash
sudo -u nasruspeed node server.mjs
```

In another terminal:

```bash
curl http://127.0.0.1:4173/api/public/settings
```

Stop the foreground process with Ctrl+C.

## 9. Start with PM2

Run exactly **one instance** for this SQLite version:

```bash
sudo -u nasruspeed pm2 start server.mjs --name nasru-speed --instances 1
sudo -u nasruspeed pm2 save
```

Do not use PM2 cluster mode with this SQLite runtime.

Configure PM2 startup using the command printed by:

```bash
sudo -u nasruspeed pm2 startup
```

Run the command it prints, then save again.

## 10. Nginx

```bash
nano /etc/nginx/sites-available/nasru-speed
```

Use:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name booking.yourdomain.com;

    client_max_body_size 7M;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/nasru-speed /etc/nginx/sites-enabled/nasru-speed
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## 11. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Do not expose port 4173 publicly.

## 12. DNS and HTTPS

Point your domain's A record to the Droplet IP. Then:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d booking.yourdomain.com
certbot renew --dry-run
```

Update `PUBLIC_BASE_URL` in `.env` to the final HTTPS URL and restart:

```bash
sudo -u nasruspeed pm2 restart nasru-speed
```

## 13. Configure integrations in Admin

In Company Settings configure:

- Bank account details
- Telegram Bot Token and admin Chat ID
- WhatsApp Cloud API Phone Number ID and access token
- Approved WhatsApp template names
- Bank/payment gateway create-link endpoint and webhook secret if applicable
- USD → MVR rate
- Tourist and Local fares when creating trips

Work Visa passengers automatically use the Local fare.

## 14. Backups

The live data is in `data/nasru-speed.db` and receipt files are under `data/uploads/`. Back up both off-server every day. DigitalOcean snapshots are useful but should not be the only backup.

Example local snapshot while the app is running with WAL:

```bash
sqlite3 data/nasru-speed.db ".backup '/var/backups/nasru-speed-$(date +%F).db'"
```

Then copy backups to another server or object storage.

## 15. Logs

```bash
sudo -u nasruspeed pm2 logs nasru-speed
journalctl -u nginx --since today
```

## Go-live checklist

Before taking real customers: change the initial admin password; test staff permissions; enter real Local/Tourist fares; verify Work Visa = Local rate; enter real bank accounts; test Telegram; get WhatsApp templates approved and test them; test a real gateway sandbox payment/webhook; test bank receipt rejection and re-upload; test seat holds with two phones; test Maldives times; and configure off-server backups.


### Reverse-proxy security
The production app binds to `127.0.0.1` by default. Keep port 4173 closed publicly. Nginx must overwrite `X-Real-IP` with `$remote_addr`. The app ignores `X-Forwarded-For` for login lockouts.