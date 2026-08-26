import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id             TEXT NOT NULL UNIQUE,
  -- Where a reply actually goes. Usually <wa_id>@s.whatsapp.net, but
  -- WhatsApp is moving one-to-one chats onto LID addressing, and a LID
  -- chat must be answered on the LID it arrived from.
  jid               TEXT,
  profile_name      TEXT,
  name              TEXT,
  city              TEXT,

  -- student | enquiry | unknown. Sticky once set from the student list.
  kind              TEXT NOT NULL DEFAULT 'unknown',
  batch             TEXT,
  lang              TEXT,

  bot_enabled       INTEGER NOT NULL DEFAULT 1,
  -- 'bot' (it handed over and may resume) or 'human' (you replied, it stays off)
  paused_by         TEXT,
  unread            INTEGER NOT NULL DEFAULT 0,
  source            TEXT,

  created_at        INTEGER NOT NULL,
  last_message_at   INTEGER,
  last_inbound_at   INTEGER,
  last_outbound_at  INTEGER,

  -- The one timer that both bundles rapid messages and creates the pause.
  reply_due_at      INTEGER,

  -- Support-ended reminder, at most once per cooldown.
  reminder_sent_at  INTEGER,
  -- Which phrasing they got, so the next one is a different one.
  last_reminder_line TEXT,
  asked_name        INTEGER NOT NULL DEFAULT 0,

  followup_count    INTEGER NOT NULL DEFAULT 0,
  next_followup_at  INTEGER,

  -- Last few opening words, so replies do not all start the same way.
  openers           TEXT,
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER NOT NULL,
  direction     TEXT NOT NULL,          -- in | out
  sender        TEXT NOT NULL,          -- them | bot | human | system
  body          TEXT NOT NULL,
  wa_message_id TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- A linked device can be handed the same message twice on a flaky
-- connection, and a duplicate must not produce a second reply to the
-- same sentence.
CREATE TABLE IF NOT EXISTS seen_messages (
  wa_message_id TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL
);

-- A message forwarded to the owner because it was not ours to answer.
-- Keyed by the id of the message WE sent him, so that when he replies to it
-- on his phone we know which conversation the reply belongs to.
CREATE TABLE IF NOT EXISTS forwards (
  wa_message_id TEXT PRIMARY KEY,
  contact_id    INTEGER NOT NULL,
  -- what they asked, so his reply can be learned against it
  question      TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- Live overrides for the handful of facts that change without a deploy.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_reply ON contacts(reply_due_at);
CREATE INDEX IF NOT EXISTS idx_contacts_followup ON contacts(next_followup_at);
`);

/* ── migrations ──────────────────────────────────────────────
   `CREATE TABLE IF NOT EXISTS` does nothing to a table that already
   exists, so every column added after the first deploy has to be added
   here too. Without this the live database keeps its original shape and
   the first write to a new column fails with "no such column" — at
   runtime, in front of a real person. Safe to run on every boot. */

const columns = db.prepare('PRAGMA table_info(contacts)').all().map((c) => c.name);
const addColumn = (name, definition) => {
  if (!columns.includes(name)) {
    db.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${definition}`);
    columns.push(name);
    console.log(`[db] added contacts.${name}`);
  }
};

addColumn('jid', 'TEXT');
addColumn('last_reminder_line', 'TEXT');
/* Everybody who has asked when the next batch starts.
   The whole point of answering "I will message you the day registration
   opens" is being able to keep it, and that needs a list. Set the first
   time they ask and never cleared, so somebody who asked in June is still
   told in September. `waitlist_told_at` records the launch message so a
   second `launch` does not message the same person twice. */
/* Chats the bot must stay out of completely: personal conversations,
   friends, family, anything the owner archives.

   This started as an in-memory Set filled from Baileys' chat events. It
   never fired once. Those events do not arrive reliably after a fresh
   link, and every restart emptied the Set anyway — so the bot kept
   replying in personal chats while the guard sat there looking correct.
   A flag on the row survives both. */
addColumn('ignored', 'INTEGER DEFAULT 0');
addColumn('waitlist_at', 'INTEGER');
addColumn('waitlist_told_at', 'INTEGER');

const fwdCols = db.prepare('PRAGMA table_info(forwards)').all().map((c) => c.name);
if (!fwdCols.includes('question')) {
  db.exec('ALTER TABLE forwards ADD COLUMN question TEXT');
  console.log('[db] added forwards.question');
}

const now = () => Date.now();

/* ── contacts ────────────────────────────────────────────── */

export const getContactByWaId = (waId) =>
  db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);

export const getContact = (id) => db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);

export function upsertContact(waId, { profileName, source, jid } = {}) {
  const existing = getContactByWaId(waId);
  if (existing) {
    // Fill blanks only, except the address: that one is refreshed every time,
    // because WhatsApp can move a chat from a phone number onto a LID and a
    // stale address means replies silently go nowhere.
    db.prepare(
      `UPDATE contacts SET profile_name = COALESCE(profile_name, ?), source = COALESCE(source, ?),
         jid = COALESCE(?, jid)
       WHERE id = ?`
    ).run(profileName || null, source || null, jid || null, existing.id);
    return getContact(existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO contacts (wa_id, jid, profile_name, source, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(waId, jid || null, profileName || null, source || null, now());
  return getContact(info.lastInsertRowid);
}

/**
 * Stay out of this chat entirely, or come back into it.
 *
 * Stored rather than held in memory, because the memory version silently
 * emptied on every restart and the bot went back to replying in personal
 * chats without anything in the log to say so.
 */
export function setIgnored(waId, on = true) {
  const c = getContactByWaId(waId);
  if (c) {
    db.prepare('UPDATE contacts SET ignored = ? WHERE id = ?').run(on ? 1 : 0, c.id);
    return true;
  }
  // Not seen yet — record it now so the first message is ignored too.
  db.prepare('INSERT INTO contacts (wa_id, ignored, created_at) VALUES (?, ?, ?)')
    .run(waId, on ? 1 : 0, Date.now());
  return true;
}

export const isIgnored = (waId) =>
  Boolean(db.prepare('SELECT ignored FROM contacts WHERE wa_id = ?').get(waId)?.ignored);

export const ignoredList = () =>
  db.prepare('SELECT wa_id FROM contacts WHERE ignored = 1 ORDER BY wa_id').all().map((r) => r.wa_id);

/** Where to send. The address it came from wins over a rebuilt one. */
export const replyTo = (contact) => contact?.jid || contact?.wa_id;

const CONTACT_FIELDS = new Set([
  'jid', 'profile_name', 'name', 'city', 'kind', 'batch', 'lang', 'bot_enabled', 'paused_by',
  'unread', 'source', 'last_message_at', 'last_inbound_at', 'last_outbound_at',
  'reply_due_at', 'reminder_sent_at', 'last_reminder_line', 'asked_name',
  'followup_count', 'next_followup_at', 'ignored', 'waitlist_at', 'waitlist_told_at',
  'openers', 'notes',
]);

export function updateContact(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => CONTACT_FIELDS.has(k));
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE contacts SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => (v === undefined ? null : v)), id);
}

export const listContacts = (limit = 200) =>
  db
    .prepare(
      `SELECT c.*, (SELECT body FROM messages m WHERE m.contact_id = c.id
                    ORDER BY m.created_at DESC LIMIT 1) AS preview
       FROM contacts c ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ?`
    )
    .all(limit);

/* ── messages ────────────────────────────────────────────── */

export function addMessage(contactId, { direction, sender, body, waMessageId }) {
  const ts = now();
  db.prepare(
    `INSERT INTO messages (contact_id, direction, sender, body, wa_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(contactId, direction, sender, body, waMessageId || null, ts);

  const field = direction === 'in' ? 'last_inbound_at' : 'last_outbound_at';
  db.prepare(`UPDATE contacts SET last_message_at = ?, ${field} = ? WHERE id = ?`)
    .run(ts, ts, contactId);
  return ts;
}

export const getMessages = (contactId, limit = 30) =>
  db
    .prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE contact_id = ?
       ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC`
    )
    .all(contactId, limit);

/**
 * Everything they said since our last reply, as one block.
 *
 * Three messages arriving four seconds apart are one thought, and answering
 * each separately is both robotic and usually wrong — the question is often
 * not finished until the third one.
 */
export function unansweredInbound(contactId) {
  const rows = db
    .prepare(
      /* `sender != 'system'` is load bearing.
         A forward writes "[forwarded, not answered]" as an outbound row, so
         it counted as a reply and hid everything the person had said before
         it. Once a message was forwarded, their actual question became
         invisible to every later attempt: a lead asked "new batch ka
         admission kab sy start" after a greeting, the greeting alone went to
         the model, and every retry afterwards saw nothing at all and
         forwarded again. A system note is a note to the owner. They were not
         answered, so their question is still waiting. */
      `SELECT body FROM messages
       WHERE contact_id = ? AND direction = 'in'
         AND created_at > COALESCE((SELECT MAX(created_at) FROM messages
                                    WHERE contact_id = ? AND direction = 'out'
                                      AND sender != 'system'), 0)
       ORDER BY created_at ASC`
    )
    .all(contactId, contactId);
  return rows.map((r) => r.body).join('\n');
}

/* ── dedupe ──────────────────────────────────────────────── */

export function alreadySeen(waMessageId) {
  if (!waMessageId) return false;
  try {
    db.prepare('INSERT INTO seen_messages (wa_message_id, created_at) VALUES (?, ?)')
      .run(waMessageId, now());
    return false;
  } catch {
    return true; // UNIQUE violation, Meta sent it twice
  }
}

/* ── the worker's two queues ─────────────────────────────── */

export const contactsDueForReply = () =>
  db
    .prepare(
      `SELECT * FROM contacts WHERE reply_due_at IS NOT NULL AND reply_due_at <= ?
       ORDER BY reply_due_at ASC LIMIT 25`
    )
    .all(now());

export const contactsDueForFollowup = () =>
  db
    .prepare(
      `SELECT * FROM contacts WHERE next_followup_at IS NOT NULL AND next_followup_at <= ?
       AND bot_enabled = 1 ORDER BY next_followup_at ASC LIMIT 25`
    )
    .all(now());

/* ── the waiting list ────────────────────────────────────────
   Anybody who asked when the next batch starts. They were told they would
   be messaged the day registration opens, and this is how that promise is
   kept rather than remembered. */

/** Mark them, once. The first time they asked is the date that matters. */
export const joinWaitlist = (contactId) =>
  db
    .prepare('UPDATE contacts SET waitlist_at = ? WHERE id = ? AND waitlist_at IS NULL')
    .run(now(), contactId).changes > 0;

/**
 * Who still has to be told.
 *
 * `waitlist_told_at IS NULL` is what makes `launch` safe to run twice. A
 * broadcast interrupted halfway — a dropped link, a restart — is resumed by
 * running it again, and nobody hears about the same launch a second time.
 */
export const waitlistPending = () =>
  db
    .prepare(
      'SELECT * FROM contacts WHERE waitlist_at IS NOT NULL AND waitlist_told_at IS NULL ORDER BY waitlist_at ASC'
    )
    .all();

export const waitlistAll = () =>
  db.prepare('SELECT * FROM contacts WHERE waitlist_at IS NOT NULL ORDER BY waitlist_at ASC').all();

export const markWaitlistTold = (contactId) =>
  db.prepare('UPDATE contacts SET waitlist_told_at = ? WHERE id = ?').run(now(), contactId);

/* ── openers ─────────────────────────────────────────────── */

export const readOpeners = (contact) => {
  try {
    return JSON.parse(contact.openers || '[]');
  } catch {
    return [];
  }
};

export const pushOpener = (contact, word) =>
  JSON.stringify([...readOpeners(contact), word].filter(Boolean).slice(-3));

/* ── forwards ────────────────────────────────────────────── */

export const rememberForward = (waMessageId, contactId, question = null) => {
  if (!waMessageId) return;
  db.prepare(
    'INSERT OR REPLACE INTO forwards (wa_message_id, contact_id, question, created_at) VALUES (?, ?, ?, ?)'
  ).run(waMessageId, contactId, question, now());
};

/** Which conversation was this forward about? */
export const forwardTarget = (waMessageId) => {
  if (!waMessageId) return null;
  const row = db.prepare('SELECT contact_id, question FROM forwards WHERE wa_message_id = ?').get(waMessageId);
  if (!row) return null;
  const c = getContact(row.contact_id);
  return c ? { ...c, forwardedQuestion: row.question } : null;
};

/** The most recent one, for when he replies without quoting anything. */
export const lastForward = () => {
  const row = db.prepare('SELECT contact_id, question FROM forwards ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return null;
  const c = getContact(row.contact_id);
  return c ? { ...c, forwardedQuestion: row.question } : null;
};

/* ── live settings ───────────────────────────────────────── */

export function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export const setSetting = (key, value) =>
  db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, now());

/* ── numbers ─────────────────────────────────────────────── */

export function stats() {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const since = now() - 86400000;
  return {
    contacts: one('SELECT COUNT(*) n FROM contacts').n,
    students: one("SELECT COUNT(*) n FROM contacts WHERE kind = 'student'").n,
    enquiries: one("SELECT COUNT(*) n FROM contacts WHERE kind = 'enquiry'").n,
    paused: one('SELECT COUNT(*) n FROM contacts WHERE bot_enabled = 0').n,
    in24h: one("SELECT COUNT(*) n FROM messages WHERE direction = 'in' AND created_at > ?", since).n,
    // System notes are not replies, and counting them makes a broken day
    // look like a busy one.
    out24h: one(
      "SELECT COUNT(*) n FROM messages WHERE direction = 'out' AND sender != 'system' AND created_at > ?",
      since
    ).n,
    newToday: one('SELECT COUNT(*) n FROM contacts WHERE created_at > ?', since).n,
  };
}
