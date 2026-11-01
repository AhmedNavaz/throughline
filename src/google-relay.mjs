import { randomBytes, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';

// On some networks Google's API front ends accept IPv6 connections and then stall the TLS handshake. The
// Antigravity runtime prefers IPv6 and never falls back, so its checks hang for ten seconds and fail. It reaches
// Google through this loopback relay instead, which connects over IPv4 first and uses IPv6 only when IPv4 fails.
// The relay only opens CONNECT tunnels to Google hosts on port 443, for clients holding its token. TLS runs end to
// end inside the tunnel, so the relay never sees requests or credentials.
const allowedHost = host => /^(?:[a-z0-9-]+\.)*(?:googleapis|google)\.com$/.test(host);
const attemptTimeout = 5000;

export function createGoogleRelay({ lookup = (host) => dns.lookup(host, { all: true }), connect = options => net.connect(options) } = {}) {
  const token = randomBytes(24).toString('hex'), expected = Buffer.from('Basic ' + Buffer.from('throughline:' + token).toString('base64'));
  const sockets = new Set();
  const server = http.createServer((request, response) => { response.writeHead(405, { connection: 'close' }).end(); });
  const refuse = (socket, status) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
  server.on('connect', async (request, socket, head) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => socket.destroy());
    const offered = Buffer.from(String(request.headers['proxy-authorization'] || ''));
    if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) return refuse(socket, '407 Proxy Authentication Required');
    const target = /^([a-z0-9.-]+):443$/i.exec(request.url || ''), host = target?.[1].toLowerCase();
    if (!host || !allowedHost(host)) return refuse(socket, '403 Forbidden');
    let addresses = [];
    try { addresses = (await lookup(host)).filter(entry => entry.family === 4 || entry.family === 6).sort((a, b) => a.family - b.family); } catch {}
    for (const { address } of addresses) {
      if (socket.destroyed) return;
      const upstream = await new Promise(resolve => {
        const attempt = connect({ host: address, port: 443 });
        const timer = setTimeout(() => { attempt.destroy(); resolve(null); }, attemptTimeout);
        attempt.once('connect', () => { clearTimeout(timer); resolve(attempt); });
        attempt.once('error', () => { clearTimeout(timer); resolve(null); });
      });
      if (!upstream) continue;
      if (socket.destroyed) { upstream.destroy(); return; }
      sockets.add(upstream); upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); }); upstream.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
      return;
    }
    refuse(socket, '502 Bad Gateway');
  });
  // The relay serves the runtime while it runs; it does not keep the app or a test process alive by itself.
  const ready = new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.unref(); resolve(`http://throughline:${token}@127.0.0.1:${server.address().port}`); }); });
  return { ready, close() { for (const socket of sockets) socket.destroy(); sockets.clear(); return new Promise(resolve => server.close(() => resolve())); } };
}

let shared = null;
// One relay per process: the app server for connection checks, a provider worker for its run.
export function googleRelay() {
  shared ||= createGoogleRelay();
  return shared.ready.catch(error => { shared = null; throw error; });
}
export async function closeGoogleRelay() { const current = shared; shared = null; if (current) await current.close(); }

// A proxy the user configured already decides how Google is reached; the relay stays out of its way.
const proxyKeys = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
export function relayEnvironment(env, relay) {
  if (!relay || proxyKeys.some(key => env[key])) return env;
  return { ...env, HTTPS_PROXY: relay, https_proxy: relay, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' };
}
