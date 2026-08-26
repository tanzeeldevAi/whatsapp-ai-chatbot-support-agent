#!/usr/bin/env node
/**
 * A second linked device whose only job is to collect the history.
 *
 * Why this is separate from the bot rather than a flag on it:
 *
 *   WhatsApp allows four linked devices. Running the collector as its own
 *   device means it can be linked, unlinked, restarted and experimented on
 *   as many times as it takes, and the support number keeps answering
 *   people throughout. The two attempts that cost a re-link each and
 *   returned nothing are what this exists to stop happening again.
 *
 * It never sends a message. It has no model, no worker, no persona — it
 * cannot reply even if something went badly wrong. It listens, writes to its
 * own database, and asks the phone for older messages chat by chat.
 *
 *   node scripts/archiver.mjs
 *
 * Then open http://<host>:<ARCH_PORT>/qr/<ARCH_TOKEN> and scan.
 * When it says it is finished, unlink it from the phone.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QR from 'qrcode';
import Database from 'better-sqlite3';

/* ── settings ────────────────────────────────────────────── */

const envFile = process.env.ENV_FILE || path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const DB_PATH = process.env.ARCH_DB || '/data/archive.db';
const AUTH_DIR = process.env.ARCH_AUTH || '/data/arch-auth';
const PORT = num(process.env.ARCH_PORT, 3000);
const TOKEN = (process.env.ARCH_TOKEN || '').replace(/[^A-Za-z0-9_-]/g, '');
const MONTHS = num(process.env.ARCH_MONTHS, 12);
const PAGE = num(process.env.ARCH_PAGE, 50);
const EVERY = num(process.env.ARCH_INTERVAL_SECONDS, 8) * 1000;
const SETTLE = num(process.env.ARCH_SETTLE_SECONDS, 20) * 1000;

const cutoff = Date.now() - MONTHS * 30 * 86400000;
const logger = pino({ level: process.env.ARCH_LOG || 'warn' });

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

/* ── storage ─────────────────────────────────────────────── */

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS archive (
  msg_id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, wa_id TEXT,
  from_me INTEGER NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_chat ON archive(chat_jid, ts);
CREATE TABLE IF NOT EXISTS archive_chats (
  chat_jid TEXT PRIMARY KEY, oldest_ts INTEGER, oldest_id TEXT, oldest_from_me INTEGER,
  done INTEGER NOT NULL DEFAULT 0, asked_at INTEGER, updated_at INTEGER NOT NULL
);
`);

const insertMsg = db.prepare(
  `INSERT OR IGNORE INTO archive (msg_id, chat_jid, wa_id, from_me, body, ts, saved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const seeChat = db.prepare(
  `INSERT INTO archive_chats (chat_jid, oldest_ts, oldest_id, oldest_from_me, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(chat_jid) DO UPDATE SET
     oldest_ts = CASE WHEN archive_chats.oldest_ts IS NULL OR excluded.oldest_ts < archive_chats.oldest_ts
                      THEN excluded.oldest_ts ELSE archive_chats.oldest_ts END,
     oldest_id = CASE WHEN archive_chats.oldest_ts IS NULL OR excluded.oldest_ts < archive_chats.oldest_ts
                      THEN excluded.oldest_id ELSE archive_chats.oldest_id END,
     oldest_from_me = CASE WHEN archive_chats.oldest_ts IS NULL OR excluded.oldest_ts < archive_chats.oldest_ts
                      THEN excluded.oldest_from_me ELSE archive_chats.oldest_from_me END,
     updated_at = excluded.updated_at`
);

const one = (sql, ...a) => db.prepare(sql).get(...a);
const stats = () => ({
  messages: one('SELECT COUNT(*) n FROM archive').n,
  chats: one('SELECT COUNT(*) n FROM archive_chats').n,
  done: one('SELECT COUNT(*) n FROM archive_chats WHERE done = 1').n,
  oldest: one('SELECT MIN(ts) t FROM archive').t,
  theirs: one('SELECT COUNT(*) n FROM archive WHERE from_me = 0').n,
});

const oneToOne = (jid) =>
  Boolean(jid) && !jid.endsWith('@g.us') && !jid.includes('broadcast') && !jid.endsWith('@newsletter');

function bodyOf(m) {
  const x = m?.message;
  if (!x) return null;
  return (
    x.conversation ||
    x.extendedTextMessage?.text ||
    x.imageMessage?.caption ||
    x.videoMessage?.caption ||
    x.documentMessage?.caption ||
    x.ephemeralMessage?.message?.conversation ||
    x.ephemeralMessage?.message?.extendedTextMessage?.text ||
    (x.audioMessage ? '[voice note]' : null) ||
    (x.imageMessage ? '[image]' : null) ||
    (x.documentMessage ? '[document]' : null) ||
    null
  );
}

function store(messages = []) {
  const now = Date.now();
  const oldestPerChat = new Map();
  let added = 0;

  for (const m of messages) {
    const jid = m?.key?.remoteJid;
    if (!oneToOne(jid)) continue;
    const body = bodyOf(m);
    const ts = Number(m?.messageTimestamp || 0) * 1000;
    if (!body || !ts || !m.key?.id) continue;

    const waId = String(m.key.senderPn || jid).split('@')[0].split(':')[0];
    added += insertMsg.run(m.key.id, jid, waId, m.key.fromMe ? 1 : 0, body, ts, now).changes;

    const prev = oldestPerChat.get(jid);
    if (!prev || ts < prev.ts) oldestPerChat.set(jid, { ts, id: m.key.id, fromMe: m.key.fromMe ? 1 : 0 });
  }

  for (const [jid, o] of oldestPerChat) seeChat.run(jid, o.ts, o.id, o.fromMe, now);
  return added;
}

/* ── the link ────────────────────────────────────────────── */

let currentQr = null;
let sock = null;
let sawHistory = false;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    // Firefox, not Chrome, purely so this shows up under Linked Devices as
    // a different entry from the bot and the right one can be unlinked
    // afterwards. Still a stock browser name, which matters to WhatsApp.
    browser: Browsers.ubuntu('Firefox'),
    // The whole point. Ask for everything the phone is willing to give.
    syncFullHistory: true,
    // Left true here, unlike the bot. A device that presents as online is
    // treated as an active client, and an active client is the one the phone
    // bothers to send a history sync to.
    markOnlineOnConnect: true,
    shouldSyncHistoryMessage: () => true,
  });

  const registered = Boolean(sock.authState.creds.registered);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      QR.toDataURL(qr, { width: 520, margin: 2 })
        .then((u) => {
          currentQr = u;
        })
        .catch(() => {});
    }

    if (connection === 'open') {
      currentQr = null;
      console.log(`[arch] linked as +${sock.user?.id?.split('@')[0]?.split(':')[0]}`);
      console.log('[arch] waiting for the phone to send its history. Keep WhatsApp Business OPEN ON SCREEN.');
      setTimeout(() => {
        if (!sawHistory) {
          console.log('');
          console.log('  ────────────────────────────────────────────────');
          console.log('  Ninety seconds and the phone has sent nothing.');
          console.log('  On the phone, all three of these:');
          console.log('    1. WhatsApp Business open, on screen, not in the background');
          console.log('    2. plugged in, and on wifi');
          console.log('    3. battery optimisation turned off for WhatsApp Business');
          console.log('       (Settings, Apps, WhatsApp Business, Battery, Unrestricted)');
          console.log('  Then unlink this device and scan again.');
          console.log('  ────────────────────────────────────────────────');
          console.log('');
        }
      }, 90_000);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        if (!registered) {
          console.warn('[arch] link attempt failed, clearing and retrying');
          try {
            sock.ev.removeAllListeners();
          } catch {
            /* already gone */
          }
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
          setTimeout(() => connect().catch((e) => console.error('[arch]', e.message)), 3000);
          return;
        }
        console.log('[arch] unlinked from the phone. Done here.');
        return;
      }
      setTimeout(() => connect().catch((e) => console.error('[arch]', e.message)), 4000);
    }
  });

  sock.ev.on('messaging-history.set', ({ messages = [], chats = [], progress, syncType }) => {
    sawHistory = true;
    const added = store(messages);
    const now = Date.now();
    for (const c of chats) {
      if (oneToOne(c?.id)) {
        db.prepare(
          'INSERT OR IGNORE INTO archive_chats (chat_jid, oldest_ts, updated_at) VALUES (?, NULL, ?)'
        ).run(c.id, now);
      }
    }
    const s = stats();
    console.log(
      `[arch] +${added} new (${messages.length} in batch, ${chats.length} chats)` +
        `${progress != null ? ` ${progress}%` : ''}${syncType != null ? ` type=${syncType}` : ''}` +
        ` → ${s.messages} messages from ${s.chats} chats, oldest ${
          s.oldest ? new Date(s.oldest).toISOString().slice(0, 10) : 'n/a'
        }`
    );
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Never reply to anything, ever. Only record.
    if (type === 'append') store(messages);
  });

  return sock;
}

/* ── paging backwards ────────────────────────────────────── */

const nextChat = db.prepare(
  `SELECT * FROM archive_chats WHERE done = 0 AND oldest_ts IS NOT NULL AND oldest_ts > ?
     AND (asked_at IS NULL OR asked_at < ?) ORDER BY oldest_ts DESC LIMIT 1`
);
const markAsked = db.prepare('UPDATE archive_chats SET asked_at = ? WHERE chat_jid = ?');
const markDone = db.prepare('UPDATE archive_chats SET done = 1 WHERE chat_jid = ?');

let idleReports = 0;

async function tick() {
  if (!sock?.user) return;

  const row = nextChat.get(cutoff, Date.now() - SETTLE);
  if (!row) {
    const s = stats();
    if (s.chats && s.done >= s.chats) {
      if (idleReports === 0) {
        console.log('');
        console.log(`  FINISHED. ${s.messages} messages from ${s.chats} chats.`);
        console.log(`  ${s.theirs} from them, ${s.messages - s.theirs} from you.`);
        console.log(`  Oldest: ${s.oldest ? new Date(s.oldest).toISOString().slice(0, 10) : 'n/a'}`);
        console.log('');
        console.log('  You can unlink this device from the phone now.');
        console.log('');
      }
      idleReports += 1;
    }
    return;
  }

  idleReports = 0;
  const before = row.oldest_ts;
  try {
    markAsked.run(Date.now(), row.chat_jid);
    await sock.fetchMessageHistory(
      PAGE,
      { remoteJid: row.chat_jid, id: row.oldest_id, fromMe: Boolean(row.oldest_from_me) },
      Math.floor(row.oldest_ts / 1000)
    );
    setTimeout(() => {
      const now = db.prepare('SELECT oldest_ts FROM archive_chats WHERE chat_jid = ?').get(row.chat_jid);
      if (now && now.oldest_ts >= before) markDone.run(row.chat_jid);
    }, SETTLE);
  } catch (err) {
    console.warn(`[arch] ${row.chat_jid.split('@')[0]}: ${err.message}`);
    markDone.run(row.chat_jid);
  }
}

/* ── the page you scan from ──────────────────────────────── */

http
  .createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    // The image's healthcheck asks for this. Without it the container reports
    // unhealthy forever, which looks like a fault and is not one.
    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ linked: Boolean(sock?.user), sawHistory, ...stats() }));
    }
    if (TOKEN && url === `/qr/${TOKEN}`) {
      const s = stats();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="8">
<title>Collect history</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0b141a;color:#e9edef;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}
img{background:#fff;padding:12px;border-radius:12px}.n{color:#8696a0;font-size:13px}
b{font-size:26px;color:#00a884}</style>
<div>${
        currentQr
          ? `<img src="${currentQr}" width="300" height="300">
             <p>WhatsApp Business &rarr; Settings &rarr; Linked devices &rarr; Link a device</p>
             <p class=n>Keep the app open on screen after scanning.</p>`
          : sock?.user
            ? `<p class=n>collected so far</p><b>${s.messages}</b>
               <p>messages from ${s.chats} chats${s.done ? `, ${s.done} finished` : ''}</p>
               <p class=n>oldest: ${s.oldest ? new Date(s.oldest).toISOString().slice(0, 10) : 'waiting…'}</p>
               <p class=n>${sawHistory ? 'phone is sending' : 'waiting for the phone — keep WhatsApp open on screen'}</p>`
            : '<p>starting…</p>'
      }</div>`);
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '0.0.0.0');

console.log(`[arch] collecting back to ${new Date(cutoff).toISOString().slice(0, 10)} (${MONTHS} months)`);
console.log(`[arch] database: ${DB_PATH}`);

await connect();
setInterval(() => tick().catch((e) => console.warn('[arch] tick:', e.message)), EVERY);
setInterval(() => {
  const s = stats();
  if (s.messages) console.log(`[arch] ${s.messages} messages · ${s.chats} chats · ${s.done} finished`);
}, 60_000);
