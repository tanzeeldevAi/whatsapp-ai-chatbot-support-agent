#!/usr/bin/env node
/**
 * Turn the collected chats into something the bot can actually be tuned on.
 *
 *   node scripts/mine.mjs                  reads DB_PATH, writes into data/
 *   node scripts/mine.mjs --db /tmp/sh.db  a copy pulled off the server
 *
 * Produces four files:
 *
 *   corpus.jsonl   every question-and-answer pair, one per line
 *   examples.md    the best exchanges, verbatim, to paste into persona.js
 *   style.md       measured writing habits — the spellings he actually uses,
 *                  how long his replies really are, how he opens them
 *   topics.md      what people actually ask about, by module and by volume
 *
 * `style.md` is the point of the whole exercise. Up to now the persona has
 * been my description of how the owner writes, corrected by him a screenshot at
 * a time. This replaces the description with a count: if he wrote "btayen"
 * ninety times and "batayein" twice, that is not an opinion any more.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const dbPath = argOf('--db', process.env.DB_PATH || './data/sh.db');
const outDir = argOf('--out', './data');
const MONTHS = Number(argOf('--months', 12));

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });

const has = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive'")
  .get();
if (!has) {
  console.error('No `archive` table. Run the bot with ARCHIVE_HISTORY=true first.');
  process.exit(1);
}

const since = Date.now() - MONTHS * 30 * 86400000;
const rows = db
  .prepare('SELECT chat_jid, from_me, body, ts FROM archive WHERE ts > ? ORDER BY chat_jid, ts')
  .all(since);

if (!rows.length) {
  console.error('The archive is empty. Nothing collected yet.');
  process.exit(1);
}

/* ── pair them up ────────────────────────────────────────────
   A run of their messages followed by a run of ours is one exchange. Runs
   rather than single messages, because people send a question across three
   lines and answers come back across two. */

const exchanges = [];
let chat = null;
let asked = [];
let answered = [];

const flush = () => {
  if (asked.length && answered.length) {
    exchanges.push({
      chat,
      q: asked.map((m) => m.body).join('\n').trim(),
      a: answered.map((m) => m.body).join('\n').trim(),
      at: asked.at(-1).ts,
    });
  }
  asked = [];
  answered = [];
};

for (const r of rows) {
  if (r.chat_jid !== chat) {
    flush();
    chat = r.chat_jid;
  }
  const m = { body: String(r.body), ts: r.ts };
  if (r.from_me) {
    answered.push(m);
  } else {
    if (answered.length) flush(); // their next question starts a new exchange
    asked.push(m);
  }
}
flush();

const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const usable = exchanges.filter(
  (e) =>
    e.q.length > 8 &&
    e.a.length > 8 &&
    !/^\[(image|document|voice note)\]$/.test(clean(e.q)) &&
    !/^\[(image|document|voice note)\]$/.test(clean(e.a))
);

/* ── what he actually types ──────────────────────────────── */

const mine = usable.map((e) => e.a);
const theirs = usable.map((e) => e.q);

const count = (text, word) =>
  (text.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')) || []).length;

const allMine = mine.join('\n').toLowerCase();

// The spelling questions the persona currently guesses at.
const SPELLING_PAIRS = [
  ['aap', 'ap'],
  ['hai', 'hy'],
  ['hain', 'hn'],
  ['nahi', 'nhi'],
  ['kya', 'kia'],
  ['yeh', 'ye'],
  ['karein', 'krein'],
  ['karna', 'krna'],
  ['karke', 'krke'],
  ['batayein', 'btayen'],
  ['bataunga', 'btaunga'],
  ['bataye', 'btaye'],
  ['pooch', 'poch'],
  ['chahiye', 'chahye'],
  ['theek', 'thek'],
  ['zaroori', 'zaruri'],
  ['bohat', 'bht'],
  ['sakte', 'skte'],
  ['dekhein', 'dekhen'],
  ['kaise', 'kese'],
];

const spelling = SPELLING_PAIRS.map(([long, short]) => ({
  long,
  short,
  longN: count(allMine, long),
  shortN: count(allMine, short),
})).filter((s) => s.longN + s.shortN > 0);

const words = (s) => clean(s).split(' ').filter(Boolean).length;
const lengths = mine.map(words).sort((a, b) => a - b);
const median = lengths[Math.floor(lengths.length / 2)] || 0;
const pct = (p) => lengths[Math.floor(lengths.length * p)] || 0;

const openers = {};
for (const a of mine) {
  const first = clean(a).split(' ')[0]?.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (first) openers[first] = (openers[first] || 0) + 1;
}
const topOpeners = Object.entries(openers)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

const emojiRx = /[\p{Extended_Pictographic}]/gu;
const withEmoji = mine.filter((a) => emojiRx.test(a)).length;
const withQuestion = mine.filter((a) => a.includes('?')).length;

/* ── what they ask about ─────────────────────────────────── */

// `import()` of an absolute path needs a file:// URL on Windows, and the
// first version swallowed the failure — which quietly reported every single
// question as "unmatched", the one number this report exists to show.
// A broken import must be loud, not conservative.
const { moduleFor } = await import(pathToFileURL(path.resolve('./src/syllabus.js')).href);

const topics = {};
for (const q of theirs) {
  const key = moduleFor(q) || 'unmatched';
  topics[key] = (topics[key] || 0) + 1;
}
const topicRows = Object.entries(topics).sort((a, b) => b[1] - a[1]);

/* ── pick the exchanges worth copying ────────────────────── */

const score = (e) => {
  const aw = words(e.a);
  let s = 0;
  if (aw >= 12 && aw <= 60) s += 3; // a real answer, not a fragment
  if (words(e.q) >= 5) s += 2; // a real question
  if (/[a-z]{3,}/i.test(e.a)) s += 1;
  if (/\d/.test(e.a)) s += 2; // concrete: a number, a threshold
  if (/(semrush|gbp|wordpress|kd|volume|backlink|ringba|rank)/i.test(e.a)) s += 2;
  if (/(thanks|shukriya|welcome|ok)/i.test(e.a) && aw < 8) s -= 4;
  return s;
};

const best = [...usable].sort((a, b) => score(b) - score(a)).slice(0, 120);

/* ── write it out ────────────────────────────────────────── */

const w = (name, body) => {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, body);
  console.log(`  ${p}`);
};

w(
  'corpus.jsonl',
  usable.map((e) => JSON.stringify({ q: clean(e.q), a: clean(e.a), at: e.at })).join('\n')
);

w(
  'style.md',
  `# How the owner actually writes

Measured from ${mine.length} of his replies in ${new Set(usable.map((e) => e.chat)).size} conversations.

## Reply length, in words
median ${median} · 25th ${pct(0.25)} · 75th ${pct(0.75)} · 90th ${pct(0.9)} · longest ${lengths.at(-1)}

The persona currently allows up to ${'`MAX_WORDS_ANSWER`'} 110. If the 90th percentile above is far below that, the cap is too generous and answers will read long.

## Spelling he uses
Left is the full transliteration, right is the short form. Whichever he uses more is the one \`src/spelling.js\` should produce.

| full | count | short | count | he prefers |
|---|---|---|---|---|
${spelling
  .map(
    (s) =>
      `| ${s.long} | ${s.longN} | ${s.short} | ${s.shortN} | **${
        s.shortN > s.longN ? s.short : s.long
      }** |`
  )
  .join('\n')}

## How he opens a reply
${topOpeners.map(([word, n]) => `- ${word} — ${n}`).join('\n')}

## Habits
- emoji in ${withEmoji} of ${mine.length} replies (${Math.round((withEmoji / mine.length) * 100)}%)
- asks something back in ${withQuestion} of ${mine.length} (${Math.round((withQuestion / mine.length) * 100)}%)
`
);

w(
  'topics.md',
  `# What people actually ask about

${theirs.length} questions, matched against the modules in src/syllabus.js.

| module | questions | share |
|---|---|---|
${topicRows
  .map(([k, n]) => `| ${k} | ${n} | ${Math.round((n / theirs.length) * 100)}% |`)
  .join('\n')}

**\`unmatched\` is the number that matters.** Every one of those is a question
\`moduleFor()\` could not place, so the bot answered it with the whole syllabus
in front of it instead of the right part. If that share is large, read the
samples below and widen the patterns.

## A sample of unmatched questions
${theirs
  .filter((q) => !moduleFor(q))
  .slice(0, 60)
  .map((q) => `- ${clean(q).slice(0, 140)}`)
  .join('\n')}
`
);

w(
  'examples.md',
  `# Real exchanges, best first

Copy the ones that read well into \`src/persona.js\`. Fifteen to twenty-five is
plenty — they teach the model the rhythm, which no amount of rules can.

Pick for variety: a short answer, a long one, a correction, a "let me check",
one in English, one where somebody was annoyed. Not twenty of the same shape.

---

${best
  .map(
    (e, i) => `### ${i + 1}
**Them:** ${clean(e.q).slice(0, 400)}
**Him:** ${clean(e.a).slice(0, 500)}
`
  )
  .join('\n')}
`
);

console.log(
  `\n  ${rows.length} messages · ${exchanges.length} exchanges · ${usable.length} usable\n`
);
