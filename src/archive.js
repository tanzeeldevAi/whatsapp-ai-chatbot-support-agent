import { config } from './config.js';
import { db } from './db.js';

/**
 * Pulling the last few months of real conversations off the account.
 *
 * The point is not backup. It is that the best possible instruction for how
 * this bot should sound is a few hundred messages the owner actually wrote —
 * far better than any rule I can describe, because it is the real thing
 * rather than a description of the real thing. Same for what people really
 * ask, which is never quite what a syllabus predicts.
 *
 * Two sources, both handled here:
 *
 *   messaging-history.set   what WhatsApp pushes on connect, and the answers
 *                           to anything we request
 *   fetchMessageHistory     asking for older messages, chat by chat, walking
 *                           backwards until we reach the cutoff
 *
 * Nothing here can ever cause a reply. It writes to its own table, the bot
 * never reads it, and the live path only ever looks at `messages.upsert` with
 * type 'notify'. Historical messages arrive on entirely different events.
 *
 * Off unless ARCHIVE_HISTORY=true. It is a one-off job, not a feature, and
 * leaving it on means asking the phone for old messages forever.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS archive (
  msg_id     TEXT PRIMARY KEY,
  chat_jid   TEXT NOT NULL,
  wa_id      TEXT,
  from_me    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  saved_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_chat ON archive(chat_jid, ts);

-- One row per conversation, tracking how far back we have got so the paging
-- can pick up where it left off across restarts.
CREATE TABLE IF NOT EXISTS archive_chats (
  chat_jid    TEXT PRIMARY KEY,
  oldest_ts   INTEGER,
  oldest_id   TEXT,
  oldest_from_me INTEGER,
  done        INTEGER NOT NULL DEFAULT 0,
  asked_at    INTEGER,
  updated_at  INTEGER NOT NULL
);
`);

const insertMsg = db.prepare(
  `INSERT OR IGNORE INTO archive (msg_id, chat_jid, wa_id, from_me, body, ts, saved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const touchChat = db.prepare(
  `INSERT INTO archive_chats (chat_jid, oldest_ts, oldest_id, oldest_from_me, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(chat_jid) DO UPDATE SET
     oldest_ts = CASE WHEN excluded.oldest_ts < archive_chats.oldest_ts
                        OR archive_chats.oldest_ts IS NULL
                      THEN excluded.oldest_ts ELSE archive_chats.oldest_ts END,
     oldest_id = CASE WHEN excluded.oldest_ts < archive_chats.oldest_ts
                        OR archive_chats.oldest_ts IS NULL
                      THEN excluded.oldest_id ELSE archive_chats.oldest_id END,
     oldest_from_me = CASE WHEN excluded.oldest_ts < archive_chats.oldest_ts
                             OR archive_chats.oldest_ts IS NULL
                           THEN excluded.oldest_from_me ELSE archive_chats.oldest_from_me END,
     updated_at = excluded.updated_at`
);

/* ── reading a stored message ────────────────────────────── */

function bodyOf(m) {
  const msg = m?.message;
  if (!msg) return null;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.ephemeralMessage?.message?.conversation ||
    msg.ephemeralMessage?.message?.extendedTextMessage?.text ||
    (msg.audioMessage ? '[voice note]' : null) ||
    (msg.imageMessage ? '[image]' : null) ||
    (msg.documentMessage ? '[document]' : null) ||
    null
  );
}

const isOneToOne = (jid) =>
  Boolean(jid) && !jid.endsWith('@g.us') && !jid.includes('broadcast') && !jid.endsWith('@newsletter');

let saved = 0;
let skipped = 0;

export function store(messages = []) {
  const now = Date.now();
  const seenChats = new Map();

  for (const m of messages) {
    const jid = m?.key?.remoteJid;
    if (!isOneToOne(jid)) {
      skipped += 1;
      continue;
    }
    const body = bodyOf(m);
    const ts = Number(m?.messageTimestamp || 0) * 1000;
    if (!body || !ts || !m.key?.id) {
      skipped += 1;
      continue;
    }

    const waId = String(m.key.senderPn || jid).split('@')[0].split(':')[0];
    const info = insertMsg.run(
      m.key.id,
      jid,
      waId,
      m.key.fromMe ? 1 : 0,
      body,
      ts,
      now
    );
    if (info.changes) saved += 1;

    const prev = seenChats.get(jid);
    if (!prev || ts < prev.ts) {
      seenChats.set(jid, { ts, id: m.key.id, fromMe: m.key.fromMe ? 1 : 0 });
    }
  }

  for (const [jid, oldest] of seenChats) {
    touchChat.run(jid, oldest.ts, oldest.id, oldest.fromMe, now);
  }
}

/* ── walking backwards ───────────────────────────────────── */

/**
 * Ask for the next page of one chat.
 *
 * WhatsApp answers asynchronously on `messaging-history.set`, so this fires
 * a request and moves on. Progress is judged by whether `oldest_ts` moved,
 * which is why the paging is driven off the database rather than off a
 * promise: nothing here is a request/response pair.
 */
const nextChat = db.prepare(
  `SELECT * FROM archive_chats
    WHERE done = 0 AND oldest_ts > ?
      AND (asked_at IS NULL OR asked_at < ?)
    ORDER BY oldest_ts DESC LIMIT 1`
);

const markAsked = db.prepare('UPDATE archive_chats SET asked_at = ? WHERE chat_jid = ?');
const markDone = db.prepare('UPDATE archive_chats SET done = 1 WHERE chat_jid = ?');

export function progress() {
  const one = (sql) => db.prepare(sql).get();
  return {
    messages: one('SELECT COUNT(*) n FROM archive').n,
    chats: one('SELECT COUNT(*) n FROM archive_chats').n,
    done: one('SELECT COUNT(*) n FROM archive_chats WHERE done = 1').n,
    oldest: one('SELECT MIN(ts) t FROM archive').t,
    theirs: one('SELECT COUNT(*) n FROM archive WHERE from_me = 0').n,
    ours: one('SELECT COUNT(*) n FROM archive WHERE from_me = 1').n,
  };
}

export function start(sock) {
  if (!config.archive.enabled) return;

  const cutoff = Date.now() - config.archive.months * 30 * 86400000;
  console.log(
    `[archive] on, collecting back to ${new Date(cutoff).toISOString().slice(0, 10)} ` +
      `(${config.archive.months} months)`
  );

  sock.ev.on('messaging-history.set', ({ messages = [], chats = [], progress: p, syncType }) => {
    const before = progress().messages;
    store(messages);
    const after = progress();
    console.log(
      `[archive] history batch: ${messages.length} in, ${after.messages - before} new, ` +
        `${after.messages} total from ${after.chats} chats` +
        (p != null ? ` (${p}%)` : '') +
        (syncType != null ? ` type=${syncType}` : '')
    );
    // Chats with no messages in the payload still tell us they exist.
    const now = Date.now();
    for (const c of chats) {
      if (isOneToOne(c?.id)) {
        db.prepare(
          'INSERT OR IGNORE INTO archive_chats (chat_jid, oldest_ts, updated_at) VALUES (?, NULL, ?)'
        ).run(c.id, now);
      }
    }
  });

  // Anything appended after the fact is history too.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type === 'append') store(messages);
  });

  const tick = async () => {
    const row = nextChat.get(cutoff, Date.now() - config.archive.retryMs);
    if (!row) {
      const p = progress();
      console.log(
        `[archive] nothing more to ask for. ${p.messages} messages, ${p.chats} chats, ` +
          `oldest ${p.oldest ? new Date(p.oldest).toISOString().slice(0, 10) : 'n/a'}`
      );
      return;
    }

    if (!row.oldest_id) {
      // We know the chat exists but have no anchor to page from. Nothing to
      // ask with, so leave it: the initial sync will have given what it had.
      markDone.run(row.chat_jid);
      return;
    }

    try {
      markAsked.run(Date.now(), row.chat_jid);
      const before = row.oldest_ts;
      await sock.fetchMessageHistory(
        config.archive.pageSize,
        { remoteJid: row.chat_jid, id: row.oldest_id, fromMe: Boolean(row.oldest_from_me) },
        Math.floor(row.oldest_ts / 1000)
      );
      // Give the reply a moment to land, then see whether we actually moved.
      setTimeout(() => {
        const now = db
          .prepare('SELECT oldest_ts FROM archive_chats WHERE chat_jid = ?')
          .get(row.chat_jid);
        if (now && now.oldest_ts >= before) {
          // Asked and got nothing older. That is the start of the chat.
          markDone.run(row.chat_jid);
          console.log(`[archive] ${row.chat_jid.split('@')[0]} is fully collected`);
        }
      }, config.archive.retryMs);
    } catch (err) {
      console.warn(`[archive] request failed for ${row.chat_jid}: ${err.message}`);
      markDone.run(row.chat_jid);
    }
  };

  // Slowly. This is somebody's phone being asked to dig through months of
  // messages, and there is nothing to be gained by hurrying it.
  setInterval(() => {
    tick().catch((err) => console.warn('[archive] tick failed:', err.message));
  }, config.archive.intervalMs);
}
