/**
 * nostr.buzz push server.
 *
 * Watches Nostr relays for gift wraps (kind 1059) and legacy DMs (kind 4) addressed to
 * registered pubkeys and forwards them, still encrypted, as Web Push messages. The service
 * worker on the device decrypts them. This server never sees keys or message text.
 *
 * It must run as one always-on process (it keeps relay WebSockets open).
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { verifyEvent } from 'nostr-tools/pure';
import webpush from 'web-push';

/* --------------------------------- settings -------------------------------- */

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'https://nostr.buzz';
/** Comma separated origins allowed to call the API, or "*". */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
/** Set to 1 only for local testing: allows ws:// relays and private addresses. */
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';

const MAX_SUBSCRIPTIONS = Number(process.env.MAX_SUBSCRIPTIONS ?? 50_000);
const MAX_WATCH = 200;
const MAX_RELAYS = 8;
const MAX_BODY = 64 * 1024;
/** Web Push payloads are capped near 4 KB; bigger events are fetched by the device. */
const MAX_INLINE_EVENT = 2800;
const TWO_DAYS = 2 * 24 * 60 * 60;
const SEEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const IGNORE_TTL_MS = 10 * 60 * 1000;
const STALE_SUBSCRIPTION_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Optional TURN relay for calls (coturn with `use-auth-secret`). TURN_URLS is a comma
 * separated list such as "turn:turn.example.com:3478,turns:turn.example.com:5349".
 */
const TURN_URLS = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TURN_SECRET = process.env.TURN_SECRET ?? '';
const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

const HEX64 = /^[0-9a-f]{64}$/;
/** Only real browser push services may be used as endpoints (prevents SSRF). */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
  ...(process.env.EXTRA_PUSH_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
];

const log = (...args) => console.log(new Date().toISOString(), ...args);

/* --------------------------------- storage --------------------------------- */

fs.mkdirSync(DATA_DIR, { recursive: true });
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(file, value, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode });
  fs.renameSync(tmp, file);
}

function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const stored = readJson(VAPID_FILE);
  if (stored?.publicKey && stored?.privateKey) return stored;
  const keys = webpush.generateVAPIDKeys();
  writeJsonAtomic(VAPID_FILE, keys, 0o600);
  log('Generated new VAPID keys in', VAPID_FILE, '(keep this file: losing it breaks every subscription)');
  return keys;
}

const vapid = loadVapid();
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

/**
 * token -> { token, owner, endpoint, keys: { p256dh, auth }, watch: string[], relays: string[], legacy, seenAt }
 * The token is a random secret made by the device; it is the only credential.
 */
const subs = new Map();
for (const sub of readJson(SUBS_FILE) ?? []) {
  if (sub && HEX64.test(sub.token)) subs.set(sub.token, sub);
}

let saveTimer;
function saveSubs() {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    try {
      writeJsonAtomic(SUBS_FILE, [...subs.values()], 0o600);
    } catch (error) {
      log('Could not save subscriptions', error);
    }
  }, 1000);
}

/* ------------------------------- relay watching ----------------------------- */

/** pubkey -> Set<token> of devices that want gift wraps for it. */
let watchers = new Map();
/** owner pubkey -> Set<token> of devices that want legacy kind 4 DMs. */
let legacyWatchers = new Map();
/** event id -> first seen (ms). */
const seen = new Map();
/** Marks an event that should not be forwarded to any device. */
const EVERYONE = '*';
/** event id -> { owner, at }: wraps a user published themselves; their devices skip them. */
const ignored = new Map();
/** url -> RelayConnection */
const relays = new Map();

class RelayConnection {
  constructor(url) {
    this.url = url;
    this.pubkeys = new Set();
    this.legacy = new Set();
    /** Targets whose stored history we have already skipped on this relay. */
    this.primed = new Set();
    this.requested = new Set();
    this.generation = 0;
    this.eose = false;
    this.backoff = 1000;
    this.closed = false;
    void this.connect();
  }

  async connect() {
    if (this.closed) return;
    try {
      if (!(await isPublicHost(new URL(this.url).hostname))) throw new Error('private address');
      if (this.closed) return;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.backoff = 1000;
        this.subscribe();
      });
      ws.addEventListener('message', (message) => this.onMessage(message.data));
      ws.addEventListener('close', () => this.retry(ws));
      ws.addEventListener('error', () => this.retry(ws));
    } catch (error) {
      log('Relay', this.url, 'unavailable:', error.message);
      this.retry(this.ws);
    }
  }

  retry(ws) {
    if (this.closed || ws !== this.ws || this.retryTimer) return;
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    this.ws = undefined;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60_000);
  }

  setTargets(pubkeys, legacy) {
    const same =
      pubkeys.size === this.pubkeys.size &&
      legacy.size === this.legacy.size &&
      [...pubkeys].every((p) => this.pubkeys.has(p)) &&
      [...legacy].every((p) => this.legacy.has(p));
    this.pubkeys = pubkeys;
    this.legacy = legacy;
    if (!same) this.subscribe();
  }

  subscribe() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.generation > 0) ws.send(JSON.stringify(['CLOSE', `buzz${this.generation}`]));
    this.generation++;
    this.eose = false;
    this.requested = new Set([...this.pubkeys, ...[...this.legacy].map((p) => `4:${p}`)]);
    if (this.pubkeys.size === 0 && this.legacy.size === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const filters = [];
    // Gift wraps carry a timestamp up to two days in the past (NIP-59).
    if (this.pubkeys.size > 0) filters.push({ kinds: [1059], '#p': [...this.pubkeys], since: now - TWO_DAYS - 3600 });
    if (this.legacy.size > 0) filters.push({ kinds: [4], '#p': [...this.legacy], since: now - 300 });
    ws.send(JSON.stringify(['REQ', `buzz${this.generation}`, ...filters]));
  }

  onMessage(data) {
    if (typeof data !== 'string' || data.length > 256 * 1024) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(message) || message[1] !== `buzz${this.generation}`) return;
    if (message[0] === 'EOSE') {
      this.eose = true;
      this.primed = this.requested;
      return;
    }
    if (message[0] === 'EVENT') this.onEvent(message[2]);
  }

  onEvent(event) {
    if (!event || typeof event !== 'object' || !HEX64.test(event.id) || !Array.isArray(event.tags)) return;
    if (event.kind !== 1059 && event.kind !== 4) return;
    if (seen.has(event.id)) return;
    const targets = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 'p' && HEX64.test(tag[1])).map((tag) => tag[1]);
    const wanted = targets.filter((p) => (event.kind === 4 ? legacyWatchers.has(p) : watchers.has(p)));
    if (wanted.length === 0) return;
    seen.set(event.id, Date.now());

    // Stored events replayed when we first ask about a pubkey are history, not news.
    const key = (p) => (event.kind === 4 ? `4:${p}` : p);
    const fresh = wanted.filter((p) => this.eose || this.primed.has(key(p)));
    if (fresh.length === 0) return;
    if (!verifyEvent(event)) return;

    const tokens = new Set();
    for (const p of fresh) {
      for (const token of (event.kind === 4 ? legacyWatchers : watchers).get(p) ?? []) tokens.add(token);
    }
    const skipOwner = ignored.get(event.id)?.owner;
    if (skipOwner === EVERYONE) return;
    for (const token of tokens) {
      const sub = subs.get(token);
      if (!sub || sub.owner === skipOwner) continue;
      // A legacy DM the user sent to themselves needs no alert.
      if (event.kind === 4 && event.pubkey === sub.owner) continue;
      void deliver(sub, eventPayload(event, this.url));
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
  }
}

function eventPayload(event, relay) {
  const inline = JSON.stringify({ t: 'e', e: event });
  if (Buffer.byteLength(inline) <= MAX_INLINE_EVENT) return inline;
  return JSON.stringify({ t: 'r', id: event.id, r: [relay] });
}

async function deliver(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
      TTL: 24 * 60 * 60,
      urgency: 'high',
    });
    return true;
  } catch (error) {
    const status = error?.statusCode;
    if (status === 404 || status === 410) {
      // The browser dropped this subscription.
      subs.delete(sub.token);
      saveSubs();
      scheduleRefresh();
    } else {
      log('Push failed', status ?? error?.message);
    }
    return false;
  }
}

let refreshTimer;
function scheduleRefresh() {
  refreshTimer ??= setTimeout(() => {
    refreshTimer = undefined;
    refresh();
  }, 300);
}

/** Recompute who watches what, and bring relay connections in line. */
function refresh() {
  const nextWatchers = new Map();
  const nextLegacy = new Map();
  const perRelay = new Map();
  const add = (map, key, value) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
  };

  for (const sub of subs.values()) {
    for (const pubkey of sub.watch) add(nextWatchers, pubkey, sub.token);
    if (sub.legacy) add(nextLegacy, sub.owner, sub.token);
    for (const url of sub.relays) {
      let entry = perRelay.get(url);
      if (!entry) perRelay.set(url, (entry = { pubkeys: new Set(), legacy: new Set() }));
      for (const pubkey of sub.watch) entry.pubkeys.add(pubkey);
      if (sub.legacy) entry.legacy.add(sub.owner);
    }
  }
  watchers = nextWatchers;
  legacyWatchers = nextLegacy;

  for (const [url, connection] of relays) {
    if (!perRelay.has(url)) {
      connection.close();
      relays.delete(url);
    }
  }
  for (const [url, { pubkeys, legacy }] of perRelay) {
    let connection = relays.get(url);
    if (!connection) relays.set(url, (connection = new RelayConnection(url)));
    connection.setTargets(pubkeys, legacy);
  }
}

/* --------------------------------- validation ------------------------------- */

const privateRanges = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3],
]) privateRanges.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  privateRanges.addSubnet(address, prefix, 'ipv6');
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return privateRanges.check(mapped[1], 'ipv4');
  return privateRanges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

async function isPublicHost(hostname) {
  if (ALLOW_PRIVATE) return true;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !isPrivateAddress(host);
  const addresses = await dns.lookup(host, { all: true });
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
}

function cleanRelay(value) {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'wss:' && !(ALLOW_PRIVATE && url.protocol === 'ws:')) return undefined;
    if (url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (!ALLOW_PRIVATE && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.'))) {
      return undefined;
    }
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function cleanEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (!PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

const isKey = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(value);

/* ----------------------------------- HTTP ----------------------------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** ip -> { count, resetAt }: a small fixed-window rate limit. */
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (++entry.count > 240) throw new HttpError(429, 'Too many requests');
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    request.on('error', () => reject(new HttpError(400, 'Bad request')));
  });
}

function requireSub(body) {
  if (!HEX64.test(body.token ?? '')) throw new HttpError(400, 'Invalid token');
  const sub = subs.get(body.token);
  if (!sub) throw new HttpError(404, 'Unknown device');
  return sub;
}

const routes = {
  'GET /health': () => ({ ok: true, subscriptions: subs.size, relays: relays.size }),

  'GET /vapid': () => ({ key: vapid.publicKey }),

  /** Servers a call may use to connect two devices. TURN credentials expire after a day. */
  'GET /ice': () => {
    const iceServers = [{ urls: STUN_URLS }];
    if (TURN_URLS.length > 0 && TURN_SECRET) {
      const username = String(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
      const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
      iceServers.push({ urls: TURN_URLS, username, credential });
    }
    return { iceServers };
  },

  'POST /subscribe': (body) => {
    const { token, owner, subscription } = body;
    if (!HEX64.test(token ?? '')) throw new HttpError(400, 'Invalid token');
    if (!HEX64.test(owner ?? '')) throw new HttpError(400, 'Invalid owner');
    const endpoint = cleanEndpoint(subscription?.endpoint);
    if (!endpoint) throw new HttpError(400, 'Unsupported push endpoint');
    if (!isKey(subscription?.keys?.p256dh) || !isKey(subscription?.keys?.auth)) throw new HttpError(400, 'Invalid push keys');

    const watch = [...new Set((Array.isArray(body.watch) ? body.watch : []).filter((p) => HEX64.test(p)))].slice(0, MAX_WATCH);
    const relayList = [...new Set((Array.isArray(body.relays) ? body.relays : []).map(cleanRelay).filter(Boolean))].slice(0, MAX_RELAYS);
    if (watch.length === 0 || relayList.length === 0) throw new HttpError(400, 'Nothing to watch');
    if (!subs.has(token) && subs.size >= MAX_SUBSCRIPTIONS) throw new HttpError(503, 'Server is full');

    subs.set(token, {
      token,
      owner,
      endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      watch,
      relays: relayList,
      legacy: body.legacy === true,
      seenAt: Date.now(),
    });
    saveSubs();
    scheduleRefresh();
    return { ok: true, watching: watch.length, relays: relayList.length };
  },

  'POST /unsubscribe': (body) => {
    if (!HEX64.test(body.token ?? '')) throw new HttpError(400, 'Invalid token');
    if (subs.delete(body.token)) {
      saveSubs();
      scheduleRefresh();
    }
    return { ok: true };
  },

  /** "I am about to publish these wraps myself: don't alert my own devices." */
  'POST /ignore': (body) => {
    const sub = requireSub(body);
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => HEX64.test(id)).slice(0, 20);
    const at = Date.now();
    for (const id of ids) ignored.set(id, { owner: sub.owner, at });
    return { ok: true };
  },

  /** "Never forward these events": housekeeping messages such as read receipts. */
  'POST /quiet': (body) => {
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => HEX64.test(id)).slice(0, 20);
    const at = Date.now();
    for (const id of ids) ignored.set(id, { owner: EVERYONE, at });
    return { ok: true };
  },

  'POST /test': async (body) => {
    const sub = requireSub(body);
    const ok = await deliver(sub, JSON.stringify({ t: 't' }));
    if (!ok) throw new HttpError(502, 'Push service rejected the message');
    return { ok: true };
  },
};

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowed = ALLOWED_ORIGINS.includes('*') ? '*' : origin && ALLOWED_ORIGINS.includes(origin) ? origin : undefined;
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const server = http.createServer(async (request, response) => {
  const headers = { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const send = (status, value) => {
    response.writeHead(status, headers);
    response.end(JSON.stringify(value));
  };
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    const forwarded = process.env.TRUST_PROXY === '1' ? String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    rateLimit(forwarded || request.socket.remoteAddress || '');
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const handler = routes[`${request.method} ${pathname}`];
    if (!handler) throw new HttpError(404, 'Not found');
    const body = request.method === 'POST' ? await readBody(request) : {};
    send(200, await handler(body));
  } catch (error) {
    if (error instanceof HttpError) send(error.status, { error: error.message });
    else {
      log('Request failed', error);
      send(500, { error: 'Internal error' });
    }
  }
});

/* -------------------------------- housekeeping ------------------------------- */

setInterval(() => {
  const now = Date.now();
  for (const [id, at] of seen) if (now - at > SEEN_TTL_MS) seen.delete(id);
  for (const [id, entry] of ignored) if (now - entry.at > IGNORE_TTL_MS) ignored.delete(id);
  for (const [ip, entry] of hits) if (entry.resetAt < now) hits.delete(ip);
  let removed = false;
  for (const [token, sub] of subs) {
    if (now - (sub.seenAt ?? 0) > STALE_SUBSCRIPTION_MS) {
      subs.delete(token);
      removed = true;
    }
  }
  if (removed) {
    saveSubs();
    scheduleRefresh();
  }
}, 60_000).unref();

function shutdown() {
  try {
    writeJsonAtomic(SUBS_FILE, [...subs.values()], 0o600);
  } catch (error) {
    log('Could not save subscriptions', error);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

refresh();
server.listen(PORT, () => log(`nostr.buzz push server on :${PORT} with ${subs.size} devices`));
