const { exec } = require('child_process');
const util      = require('util');

const execAsync = util.promisify(exec);

/*
 * ─────────────────────────────────────────────────────────────────
 *  NETWORK ACCESS CONTROL via iptables
 *
 *  HOW IT WORKS:
 *  ─────────────
 *  On startup, all forwarding from the hotspot interface is DROPPED
 *  by default. When a user pays, we INSERT an ACCEPT rule for their
 *  specific IP. When their time runs out or they disconnect, we
 *  DELETE that rule.
 *
 *  PREREQUISITE SETUP (run once on your Raspberry Pi / router):
 *  ─────────────────────────────────────────────────────────────
 *  Replace wlan0 (hotspot AP interface) and eth0 (WAN/Starlink) with
 *  your actual interface names. Find them with: ip link show
 *
 *  # Enable IP forwarding
 *  echo 1 > /proc/sys/net/ipv4/ip_forward
 *  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
 *
 *  # NAT: masquerade hotspot traffic out through Starlink interface
 *  iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
 *
 *  # Default FORWARD policy: DROP everything
 *  iptables -P FORWARD DROP
 *
 *  # Allow DNS and DHCP through (so devices can get IPs and reach portal)
 *  iptables -A INPUT  -i wlan0 -p udp --dport 53  -j ACCEPT
 *  iptables -A INPUT  -i wlan0 -p tcp --dport 53  -j ACCEPT
 *  iptables -A INPUT  -i wlan0 -p udp --dport 67  -j ACCEPT
 *  iptables -A INPUT  -i wlan0 -p tcp --dport 80  -j ACCEPT   # portal HTTP
 *  iptables -A INPUT  -i wlan0 -p tcp --dport 443 -j ACCEPT   # portal HTTPS
 *
 *  # Save rules so they survive reboot
 *  apt install iptables-persistent
 *  netfilter-persistent save
 * ─────────────────────────────────────────────────────────────────
 */

const IFACE = process.env.HOTSPOT_INTERFACE || 'wlan0';

/**
 * Grant internet access to an IP address.
 * Inserts an ACCEPT rule in the FORWARD chain for that IP.
 */
async function grantAccess(ip) {
  if (!isValidIp(ip)) throw new Error('Invalid IP: ' + ip);
  const cmd = `iptables -I FORWARD -s ${ip} -i ${IFACE} -j ACCEPT`;
  console.log(`[network] GRANT  ${ip}`);
  try {
    await execAsync(cmd);
  } catch (err) {
    console.error(`[network] Failed to grant access for ${ip}:`, err.message);
    throw err;
  }
}

/**
 * Revoke internet access for an IP address.
 * Deletes the ACCEPT rule from the FORWARD chain.
 */
async function revokeAccess(ip) {
  if (!isValidIp(ip)) throw new Error('Invalid IP: ' + ip);
  const cmd = `iptables -D FORWARD -s ${ip} -i ${IFACE} -j ACCEPT`;
  console.log(`[network] REVOKE ${ip}`);
  try {
    await execAsync(cmd);
  } catch (err) {
    /* Rule may already be gone — not fatal */
    console.warn(`[network] Could not revoke ${ip} (may already be removed):`, err.message);
  }
}

/**
 * Check if a given IP currently has an ACCEPT rule in FORWARD.
 */
async function hasAccess(ip) {
  if (!isValidIp(ip)) return false;
  try {
    const { stdout } = await execAsync(`iptables -C FORWARD -s ${ip} -i ${IFACE} -j ACCEPT 2>&1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Basic IPv4 validation.
 */
function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

/**
 * Get the real client IP, accounting for proxy headers.
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    req.ip
  );
}

module.exports = { grantAccess, revokeAccess, hasAccess, getClientIp };
