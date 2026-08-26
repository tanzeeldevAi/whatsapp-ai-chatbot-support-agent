#!/usr/bin/env node
/**
 * Load WhatsApp's own chat exports into the archive.
 *
 *   node scripts/import-exports.mjs ./exports
 *   node scripts/import-exports.mjs ./exports --db /tmp/sh.db --commit
 *
 * On the phone: open a chat, ⋮ → More → Export chat → Without media. It
 * produces a .txt. Drop as many as you like into one folder and point this
 * at it.
 *
 * Why this exists alongside the live capture: asking WhatsApp for history
 * over the protocol depends on the phone choosing to send it, and twice it
 * did not. This path depends on nothing — the file is already on disk, in
 * plain text, and it either parses or it does not. Twenty exported chats are
 * enough to learn a writing style from.
 *
 * It writes into the same `archive` table the live capture uses, so
 * `mine.mjs` works on either source, or both together.
 *
 * Dry run by default. Nothing is written until you pass --commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true)
  || './exports';
const dbPath = argOf('--db', process.env.DB_PATH || './data/sh.db');
const commit = args.includes('--commit');
const meName = argOf('--me', null);

if (!fs.existsSync(dir)) {
  console.error(`No folder at ${dir}`);
  console.error('Put the exported .txt files in one folder and pass its path.');
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.txt'))
  .map((f) => path.join(dir, f));

if (!files.length) {
  console.error(`No .txt files in ${dir}`);
  process.exit(1);
}

/* ── parsing ─────────────────────────────────────────────────
   WhatsApp writes a different first line depending on the phone and the
   locale, so both common shapes are accepted rather than one guessed at:

     Android  07/08/2026, 15:07 - Name: text
     iOS      [07/08/2026, 3:07:21 PM] Name: text

   A line that does not start with a timestamp is a continuation of the one
   before it, which is how multi-line messages survive. */

const ANDROID =
  /^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([ap]\.?m\.?)?\s*[-–]\s*([^:]{1,60}?):\s?([\s\S]*)$/i;
const IOS =
  /^\[(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([ap]\.?m\.?)?\]\s*([^:]{1,60}?):\s?([\s\S]*)$/i;

/** Day-first, which is what every export in this project has used. */
function toTs(date, time, ampm) {
  const [a, b, cRaw] = date.split(/[/.]/).map(Number);
  const year = cRaw < 100 ? 2000 + cRaw : cRaw;
  const [h, m, s = 0] = time.split(':').map(Number);
  let hour = h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  // Day first unless that is impossible, in which case it was month first.
  const day = a > 12 ? a : a;
  const month = a > 12 ? b : b;
  const d = new Date(year, month - 1, day, hour, m, s);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

const SYSTEM_LINE =
  /(Messages and calls are end-to-end encrypted|created group|added you|changed the subject|joined using|left$|deleted this message|You deleted|<Media omitted>|null|image omitted|video omitted|audio omitted|sticker omitted|document omitted|This message was deleted|Missed voice call|Missed video call)/i;

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/‎|‏/g, '');
  const out = [];
  let current = null;

  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(IOS) || line.match(ANDROID);
    if (m) {
      if (current) out.push(current);
      const [, date, time, ampm, sender, text] = m;
      current = { ts: toTs(date, time, ampm), sender: sender.trim(), body: text };
    } else if (current) {
      current.body += `\n${line}`;
    }
  }
  if (current) out.push(current);

  return out
    .filter((m) => m.ts && m.body.trim() && !SYSTEM_LINE.test(m.body))
    .map((m) => ({ ...m, body: m.body.trim() }));
}

/* ── which name is him ───────────────────────────────────────
   Whoever appears in every file. Each export is a different person's chat,
   and the only name in all of them is the account owner's. Beats asking,
   and beats guessing from the filename. */

const parsed = files.map((f) => ({ file: f, messages: parse(f) }));

const senderSets = parsed.map((p) => new Set(p.messages.map((m) => m.sender)));
const everywhere = [...(senderSets[0] || [])].filter((name) =>
  senderSets.every((s) => s.has(name))
);

let me = meName;
if (!me) {
  if (senderSets.length < 2) {
    console.error('With only one export I cannot work out which name is yours.');
    console.error('Either export a few more chats, or pass --me "Your Name".');
    process.exit(1);
  }
  if (everywhere.length !== 1) {
    console.error(`Could not identify you. Names common to every file: ${everywhere.join(', ') || 'none'}`);
    console.error('Pass --me "Your Name" to say which one you are.');
    process.exit(1);
  }
  [me] = everywhere;
}

console.log(`\n  You are "${me}" · ${files.length} exports\n`);

/* ── write ───────────────────────────────────────────────── */

const db = new Database(dbPath);
db.exec(`
CREATE TABLE IF NOT EXISTS archive (
  msg_id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, wa_id TEXT,
  from_me INTEGER NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_chat ON archive(chat_jid, ts);
`);

const insert = db.prepare(
  `INSERT OR IGNORE INTO archive (msg_id, chat_jid, wa_id, from_me, body, ts, saved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let total = 0;
let written = 0;
const now = Date.now();

for (const { file, messages } of parsed) {
  const other = [...new Set(messages.map((m) => m.sender))].filter((s) => s !== me);
  // The chat is identified by the other person. A phone number in the export
  // is used as-is; a saved contact name is used as a stable stand-in.
  const digits = (other[0] || '').replace(/[^\d]/g, '');
  const chatKey = digits.length >= 10 ? `${digits}@s.whatsapp.net` : `export:${other[0] || path.basename(file)}`;

  for (const [i, m] of messages.entries()) {
    total += 1;
    if (!commit) continue;
    const id = `exp:${chatKey}:${m.ts}:${i}`;
    const info = insert.run(
      id,
      chatKey,
      digits || null,
      m.sender === me ? 1 : 0,
      m.body,
      m.ts,
      now
    );
    written += info.changes;
  }

  const mine = messages.filter((m) => m.sender === me).length;
  const oldest = messages[0]?.ts;
  console.log(
    `  ${path.basename(file).slice(0, 45).padEnd(46)} ${String(messages.length).padStart(5)} msgs` +
      ` · ${String(mine).padStart(4)} yours · from ${oldest ? new Date(oldest).toISOString().slice(0, 10) : '?'}`
  );
}

console.log(
  `\n  ${total} messages parsed` + (commit ? `, ${written} new rows written to ${dbPath}` : '')
);
if (!commit) console.log('  Dry run. Add --commit to write.\n');
else console.log('  Now run: node scripts/mine.mjs\n');
