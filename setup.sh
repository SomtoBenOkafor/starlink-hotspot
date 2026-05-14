#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
#  Starlink Hotspot — One-time Network Setup Script
#  Run this once on your Raspberry Pi / Linux router as root.
#
#  Usage:
#    sudo bash setup.sh <HOTSPOT_IFACE> <WAN_IFACE>
#
#  Example:
#    sudo bash setup.sh wlan0 eth0
#    sudo bash setup.sh ap0 wlan0    (if Starlink is on wlan0)
#
#  HOTSPOT_IFACE = interface your clients connect to (your WiFi AP)
#  WAN_IFACE     = interface that connects to Starlink
# ─────────────────────────────────────────────────────────────────────

HOTSPOT_IFACE=${1:-wlan0}
WAN_IFACE=${2:-eth0}

echo "==> Setting up hotspot NAT"
echo "    Hotspot interface : $HOTSPOT_IFACE"
echo "    WAN interface     : $WAN_IFACE"
echo ""

# ── 1. Enable IP forwarding ──────────────────────────────────────────
echo "==> Enabling IP forwarding..."
echo 1 > /proc/sys/net/ipv4/ip_forward
grep -qxF 'net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p

# ── 2. NAT — masquerade hotspot traffic out through Starlink ─────────
echo "==> Adding NAT masquerade rule..."
iptables -t nat -C POSTROUTING -o $WAN_IFACE -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o $WAN_IFACE -j MASQUERADE

# ── 3. Default FORWARD policy: DROP (block all by default) ──────────
echo "==> Setting default FORWARD policy to DROP..."
iptables -P FORWARD DROP

# ── 4. Allow DNS & DHCP through (so devices get IPs) ────────────────
echo "==> Allowing DNS and DHCP..."
iptables -C INPUT -i $HOTSPOT_IFACE -p udp --dport 53  -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p udp --dport 53  -j ACCEPT
iptables -C INPUT -i $HOTSPOT_IFACE -p tcp --dport 53  -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p tcp --dport 53  -j ACCEPT
iptables -C INPUT -i $HOTSPOT_IFACE -p udp --dport 67  -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p udp --dport 67  -j ACCEPT

# ── 5. Allow portal (HTTP port 3000 and/or 80) ──────────────────────
echo "==> Allowing portal access on port 80 and 3000..."
iptables -C INPUT -i $HOTSPOT_IFACE -p tcp --dport 80   -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p tcp --dport 80   -j ACCEPT
iptables -C INPUT -i $HOTSPOT_IFACE -p tcp --dport 3000 -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p tcp --dport 3000 -j ACCEPT
iptables -C INPUT -i $HOTSPOT_IFACE -p tcp --dport 443  -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -i $HOTSPOT_IFACE -p tcp --dport 443  -j ACCEPT

# ── 6. Allow established/related connections back through ────────────
iptables -C FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── 7. Captive portal redirect — all port 80 → portal ───────────────
echo "==> Setting up captive portal redirect..."
iptables -t nat -C PREROUTING -i $HOTSPOT_IFACE -p tcp --dport 80 \
  -j REDIRECT --to-port 3000 2>/dev/null \
  || iptables -t nat -A PREROUTING -i $HOTSPOT_IFACE -p tcp --dport 80 \
     -j REDIRECT --to-port 3000

# ── 8. dnsmasq config — redirect all DNS to this device ─────────────
echo "==> Writing dnsmasq config..."
cat > /etc/dnsmasq.d/hotspot.conf << EOF
# Hotspot captive portal DNS config
interface=$HOTSPOT_IFACE
dhcp-range=192.168.10.10,192.168.10.200,255.255.255.0,12h
dhcp-option=3,192.168.10.1
dhcp-option=6,192.168.10.1
# Redirect ALL DNS queries to this device (captive portal trick)
address=/#/192.168.10.1
EOF
systemctl restart dnsmasq 2>/dev/null || echo "  (dnsmasq not installed — install with: apt install dnsmasq)"

# ── 9. Save iptables rules so they survive reboot ───────────────────
echo "==> Saving iptables rules..."
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save
else
  echo "  (iptables-persistent not installed)"
  echo "  Install with: apt install iptables-persistent"
  echo "  Then run:     netfilter-persistent save"
fi

echo ""
echo "✓ Setup complete."
echo ""
echo "Next steps:"
echo "  1. Copy your .env.example to .env and fill in your keys"
echo "  2. npm install"
echo "  3. sudo npm start   (needs root for iptables)"
echo "  4. Set up hostapd to broadcast your WiFi SSID"
