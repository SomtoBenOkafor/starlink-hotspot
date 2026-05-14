# Starlink Hotspot — Backend

Node.js backend for the paid WiFi captive portal. Handles user auth, Paystack payment verification, and iptables network access control.

---

## Stack

| Layer | Tool |
|---|---|
| Server | Node.js + Express |
| Database | SQLite (via better-sqlite3) |
| Auth | bcrypt passwords + JWT tokens |
| Payments | Paystack |
| Network control | iptables |
| Hardware | Raspberry Pi 4 (or any Linux router) |

---

## Project Structure

```
hotspot-backend/
├── server.js          # Express app entry point
├── db.js              # SQLite schema + query helpers
├── network.js         # iptables grant/revoke functions
├── middleware/
│   └── auth.js        # JWT authentication middleware
├── routes/
│   ├── auth.js        # /api/auth — register, login, logout
│   └── session.js     # /api/session — verify payment, pause, resume, end
├── public/
│   └── index.html     # PUT YOUR PORTAL FRONTEND FILE HERE
├── setup.sh           # One-time network setup script
├── .env.example       # Environment variable template
└── package.json
```

---

## Setup & Deployment

### 1. Hardware setup

You need a device with **two network interfaces**:
- One connected to Starlink (WAN) — usually `eth0` or `wlan0`
- One broadcasting your hotspot WiFi AP — usually `wlan1` or `ap0`

A **Raspberry Pi 4** with a USB WiFi adapter works perfectly.

### 2. Install dependencies

```bash
sudo apt update && sudo apt install -y nodejs npm dnsmasq hostapd iptables-persistent
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env
# Fill in: PAYSTACK_SECRET_KEY, JWT_SECRET, HOTSPOT_INTERFACE
```

### 4. Run the one-time network setup

```bash
# Replace wlan1 (your AP) and eth0 (Starlink) with your actual interfaces
sudo bash setup.sh wlan1 eth0
```

This configures:
- IP forwarding
- NAT masquerading through Starlink
- Default FORWARD DROP (blocks all unauthenticated clients)
- DNS redirect to portal
- dnsmasq DHCP for connected clients

### 5. Place the portal frontend

Copy your `starlink-portal-nigeria.html` into the `public/` folder and rename it `index.html`:

```bash
mkdir -p public
cp /path/to/starlink-portal-nigeria.html public/index.html
```

### 6. Start the server

The server needs root to run iptables commands:

```bash
sudo npm start
```

To run it as a service that auto-starts on boot:

```bash
sudo nano /etc/systemd/system/hotspot.service
```

Paste:
```ini
[Unit]
Description=Starlink Hotspot Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/pi/hotspot-backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/home/pi/hotspot-backend/.env

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable hotspot
sudo systemctl start hotspot
```

---

## API Reference

All session endpoints require `Authorization: Bearer <token>` header.

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, phone, password }` | Create account |
| POST | `/api/auth/login` | `{ email, password }` | Sign in → returns JWT |
| POST | `/api/auth/logout` | — | Sign out |
| GET  | `/api/auth/me` | — | Get current user |
| GET  | `/api/session` | — | Get current session status |
| POST | `/api/session/verify-payment` | `{ reference, planLabel, seconds }` | Verify Paystack + open access |
| POST | `/api/session/resume` | — | Reconnect + re-open iptables rule |
| POST | `/api/session/pause` | `{ secondsRemaining }` | Disconnect + save remaining time |
| POST | `/api/session/end` | — | End session permanently |

---

## How payment + access works

```
User pays on Paystack
        ↓
Portal calls POST /api/session/verify-payment
        ↓
Backend calls Paystack API to confirm payment
        ↓
Backend saves session to DB + calls grantAccess(userIP)
        ↓
iptables -I FORWARD -s <userIP> -j ACCEPT
        ↓
User can now browse the internet
        ↓
User disconnects → POST /api/session/pause
        ↓
Backend saves secondsRemaining to DB + calls revokeAccess(userIP)
        ↓
iptables -D FORWARD -s <userIP> -j ACCEPT
        ↓
User reconnects + signs in → POST /api/session/resume
        ↓
Backend re-opens iptables, timer resumes from saved time
```

---

## Security notes

- Passwords are hashed with bcrypt (cost factor 12) — never stored in plain text
- JWT tokens expire after 30 days
- The server must run as root (for iptables) — keep it on a local network only
- Use HTTPS in production (Let's Encrypt / self-signed cert with nginx reverse proxy)
- Back up `hotspot.db` regularly — it holds all user accounts and sessions
