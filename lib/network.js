const os = require('node:os');

// Discover local IPv4 addresses to help users connect from other devices.
function getLocalNetworkAddresses() {
  const addresses = [];
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue;
    for (const detail of iface) {
      if (detail.family === 'IPv4' && !detail.internal) {
        addresses.push(detail.address);
      }
    }
  }
  return addresses;
}

function isPrivateIpv4(ip) {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;

  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1] || -1);
    return second >= 16 && second <= 31;
  }

  return false;
}

// Return the most likely LAN IPv4 of this machine, or null.
function getLanIp() {
  const ifaces = os.networkInterfaces();
  const preferred = [];
  const fallback = [];

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;

    const lowerName = name.toLowerCase();
    const isVirtual = ['docker', 'veth', 'br-', 'virbr', 'tun', 'tap', 'tailscale', 'wg']
      .some((prefix) => lowerName.startsWith(prefix) || lowerName.includes(prefix));

    for (const iface of entries) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (!isPrivateIpv4(iface.address)) continue;

      if (isVirtual) {
        fallback.push(iface.address);
      } else {
        preferred.push(iface.address);
      }
    }
  }

  return preferred[0] || fallback[0] || null;
}

// Infer public protocol for join URLs behind reverse proxies or local HTTP.
function inferProtocol(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.encrypted ? 'https' : 'http';
}

// Build the host part for the join URL, preferring the LAN IP over localhost.
function resolveJoinHost(req) {
  const forced = (process.env.PUBLIC_HOST || '').trim();
  if (forced) return forced;

  const forwarded = req.headers['x-forwarded-host'] || req.headers.host || '';
  const hostname = forwarded.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    const lanIp = getLanIp();
    if (lanIp) {
      const port = (forwarded.split(':')[1] || '').replace(/\D/g, '');
      return port ? `${lanIp}:${port}` : lanIp;
    }
  }
  return forwarded;
}

module.exports = {
  getLocalNetworkAddresses,
  inferProtocol,
  resolveJoinHost,
};
