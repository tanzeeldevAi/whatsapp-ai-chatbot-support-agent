import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

/**
 * Retrieval over the real course material.
 *
 * Early on I argued against this: the knowledge was one page of facts, it fit
 * in the prompt, and retrieval would have been infrastructure solving a
 * problem that did not exist. That was true then and it is not true now.
 * Lecture notes plus 21,881 real answers do not fit in a prompt, and the gap
 * between "sounds right" and "is what was taught in class" is exactly what is
 * left to fix.
 *
 * Deliberately no vector database and no embedding API:
 *
 *   - SQLite's own FTS5 is already in better-sqlite3. No new service, no
 *     key, no monthly bill, and it searches 20,000 chunks in a millisecond.
 *   - The questions are Roman Urdu with the technical terms in English —
 *     "gbp verify nahi ho raha", "KD kitna", "anchor text kaisa". The words
 *     that decide relevance are the English ones, and keyword search matches
 *     those exactly. Embeddings would mostly add cost and latency here.
 *
 * Four sources, ranked differently on purpose:
 *
 *   taught     something the owner answered himself through the forward loop.
 *   notes      Batch 2 lectures. What was actually taught this time round.
 *   notes_old  Batch 1 lectures, from 2025.
 *   answers    past replies from this number. Real and in his voice, but a
 *              quick answer to one person is weaker evidence than a lecture.
 *
 * `notes_old` exists because of a gap, not because more material is better.
 * Only 15 of the 36 Batch 2 lectures have a transcript — the rest are locked
 * behind a VdoCipher setting — and the 21 missing ones are the core modules:
 * niche research, keyword research, WordPress, content writing, on page, off
 * page. Batch 1 covers every one of those and its transcripts are available
 * now. So the bot can either be silent on most of the course, or answer from
 * the year before.
 *
 * It ranks below `notes` deliberately, and that is the whole safety of it.
 * Where Batch 2 taught something, Batch 2 wins and the old material is never
 * seen. Batch 1 only ever speaks into a silence. The risk it carries is real
 * but narrow: menus and screens move between years, so a 2025 lecture can
 * describe a button that has since been renamed. The method it teaches does
 * not move, and that is what people are asking about.
 */

const DB_PATH = config.kb.path;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS chunks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  source   TEXT NOT NULL,          -- notes | answers
  origin   TEXT,                   -- file name, or the date of the exchange
  title    TEXT,
  body     TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  title, body, content='chunks', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
END;
`);

export const insertChunk = db.prepare(
  'INSERT INTO chunks (source, origin, title, body, added_at) VALUES (?, ?, ?, ?, ?)'
);

export const clearSource = (source) => db.prepare('DELETE FROM chunks WHERE source = ?').run(source);

/**
 * Remember an answer the owner gave through the forward loop.
 *
 * Closing the loop is the point. A question the bot could not place is sent to
 * him, he answers it once, and that answer becomes knowledge — so the next
 * person asking the same thing is answered rather than forwarded again. Left
 * alone, the same handful of questions would be sent to his phone forever.
 *
 * Stored as `taught`, which outranks both the lecture notes and the mined
 * history: he wrote it today, about this, on purpose.
 */
export function learn(question, answer) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  const a = String(answer || '').replace(/\s+/g, ' ').trim();

  // A one-word "ok" or "done" is him acknowledging, not teaching.
  if (q.length < 8 || a.split(/\s+/).length < 4) return false;

  db.prepare(
    'INSERT INTO chunks (source, origin, title, body, added_at) VALUES (?, ?, ?, ?, ?)'
  ).run('taught', 'answered by the owner', null, `Q: ${q.slice(0, 400)}\nA: ${a.slice(0, 800)}`, Date.now());

  console.log(`[kb] learned: "${q.slice(0, 60)}"`);
  return true;
}

/**
 * Has he already answered something like this?
 *
 * Used to stop the deterministic forwards firing a second time. The bar is
 * higher than for ordinary retrieval: this decides whether to answer at all,
 * so it wants a genuinely close match, not the best of a weak field.
 */
export function alreadyTaught(text) {
  const query = toQuery(text);
  if (!query) return false;

  let rows;
  try {
    rows = db
      .prepare(
        `SELECT c.body FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.source = 'taught'
          ORDER BY bm25(chunks_fts) LIMIT 5`
      )
      .all(query);
  } catch {
    return false;
  }
  if (!rows.length) return false;

  /* Word overlap rather than a bm25 threshold.
     bm25 is relative to the whole index, so the same match scores completely
     differently with three taught answers than with three hundred — the first
     version used a fixed cutoff and never fired at all. Counting how many of
     the question's own meaningful words appear in the stored answer means the
     same thing whatever the index size, and it can be read at a glance. */
  const words = query.match(/"([^"]+)"/g)?.map((w) => w.replace(/"/g, '')) || [];
  if (words.length < 2) return false;

  for (const r of rows) {
    const body = r.body.toLowerCase();
    const hits = words.filter((w) => body.includes(w)).length;
    if (hits >= Math.max(2, Math.ceil(words.length * 0.6))) return true;
  }
  return false;
}

export const counts = () => {
  const rows = db.prepare('SELECT source, COUNT(*) n FROM chunks GROUP BY source').all();
  return Object.fromEntries(rows.map((r) => [r.source, r.n]));
};

/* ── turning a message into a query ──────────────────────────
   FTS5 will throw on the punctuation people actually type, and a Roman Urdu
   sentence is mostly filler words that match everything. So the query is
   built from the words that carry meaning, OR-ed together, and ranked. */

const STOP = new Set([
  'sir', 'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has',
  'kia', 'kya', 'hai', 'hy', 'hain', 'nahi', 'nhi', 'ho', 'raha', 'rha', 'rahi', 'ka', 'ki',
  'ke', 'ko', 'se', 'me', 'mein', 'main', 'ap', 'aap', 'mujhe', 'mjhe', 'mera', 'meri', 'kaise',
  'kese', 'kaisay', 'kar', 'kr', 'krna', 'karna', 'krein', 'karein', 'lein', 'dein', 'bta',
  'btayen', 'bataye', 'please', 'plz', 'koi', 'kuch', 'jo', 'wo', 'ye', 'yeh', 'per', 'par',
  'aur', 'or', 'phir', 'fir', 'to', 'tou', 'bhi', 'hoga', 'hogi', 'gi', 'ga', 'assalam',
  'alaikum', 'salam', 'aoa', 'thanks', 'thank', 'shukriya', 'ok', 'okay',
  /* Roman Urdu function words, and the reason they matter more than they look.
     The lecture transcripts are in English; the past answers are in Roman
     Urdu. A question like "keyword research me KD kitna hona chahiye" carries
     five searchable words, three of which — kitna, hona, chahiye — can only
     ever appear in the Roman Urdu answers. bm25 rewards matching more terms,
     so the past answers won on filler and the keyword research lecture, all
     fifteen thousand words of it, never surfaced. These words say nothing
     about the subject in any language, which is what this list is for. */
  'kitna', 'kitne', 'kitni', 'kitnay', 'kitna', 'hona', 'honi', 'hoti', 'hota',
  'chahiye', 'chahye', 'chaiye', 'chahie', 'krne', 'krni', 'karne', 'karni',
  'sakta', 'sakti', 'saktay', 'lagta', 'lagti', 'wala', 'wali', 'walay',
  'kaunsa', 'konsa', 'kaunsi', 'konsi', 'batao', 'btao', 'bata', 'sir',
]);

export function toQuery(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  // Longest first: "verification" tells us more than "video".
  const picked = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 8);
  return picked.map((w) => `"${w}"`).join(' OR ');
}

/**
 * The most relevant material for this question.
 *
 * @param {string} text
 * @param {{limit?: number, maxWords?: number}} opts
 * @returns {{source: string, origin: string, title: string, body: string}[]}
 */
export function search(text, { limit = 6, maxWords = 320 } = {}) {
  const query = toQuery(text);
  if (!query) return [];

  /* Each source is searched on its own, and that is not an optimisation.
     This used to be one query taking the best `limit * 4` rows by raw bm25
     and re-ranking them afterwards — which meant a source could be thrown
     away before the ranking it was supposed to win ever ran. bm25 rewards
     short documents, so a two line question-and-answer pair scores above a
     paragraph of a lecture on the same words, and the lecture transcripts
     lost the first cut every time. Batch 1 material never surfaced at all,
     even on questions nothing else could answer.

     Giving every source its own slots means the boost decides what wins,
     which is the whole point of having one. Four small FTS queries over
     eleven thousand rows cost nothing worth measuring. */
  const perSource = Math.max(4, limit * 2);
  const rows = [];
  const sources = ['taught', 'notes', 'notes_old'];
  if (config.kb.useAnswers) sources.push('answers');
  for (const source of sources) {
    try {
      rows.push(
        ...db
          .prepare(
            `SELECT c.source, c.origin, c.title, c.body,
                    bm25(chunks_fts, 3.0, 1.0) AS score
               FROM chunks_fts
               JOIN chunks c ON c.id = chunks_fts.rowid
              WHERE chunks_fts MATCH ? AND c.source = ?
              ORDER BY score
              LIMIT ?`
          )
          .all(query, source, perSource)
      );
    } catch (err) {
      // A malformed query is not worth failing a reply over.
      console.warn(`[kb] search failed on ${source}:`, err.message);
    }
  }
  if (!rows.length) return [];

  /* Priority, strongest first: something the owner answered himself through the
     forward loop, then this year's lectures, then last year's, then the mined
     history. bm25 is lower-is-better, so the boost is a subtraction.

     The gap between notes and notes_old is what keeps Batch 1 in its place.
     A Batch 2 chunk beats a Batch 1 chunk on the same question even when
     Batch 1 matches the words slightly better, which is the point: the old
     material is a fallback, not a rival. */
  /* The gaps are wide on purpose, and wider than they look.
     bm25 separates these sources by only one to three points, because a two
     line past answer is short and dense and scores well on any question it
     mentions. So small boosts decide nothing: with notes_old at 1, a
     WordPress question returned five past chat replies and not one line of
     the WordPress lecture that exists. A lecture is what was taught, and it
     should beat a quick reply somebody typed once even when the reply
     happens to match the words better. */
  const BOOST = { taught: 6, notes: 4, notes_old: 2.5, answers: 0 };
  const ranked = rows
    .map((r) => ({ ...r, score: r.score - (BOOST[r.source] || 0) }))
    .sort((a, b) => a.score - b.score);

  /* Skip what will not fit, do not stop at it.
     This used to `break`, so one oversized chunk ended the scan and
     everything ranked below it was lost — however good. With the lecture
     transcripts in, that is most of them: a 292 word chunk arriving second
     against a 220 word budget threw away every remaining hit, and the reply
     went out with a single short past answer as its only material. The best
     hit is always kept regardless of size; after that, anything that fits
     still gets its turn. */
  const out = [];
  let words = 0;
  for (const r of ranked) {
    const n = r.body.split(/\s+/).length;
    if (words + n > maxWords && out.length) continue;
    out.push(r);
    words += n;
    if (out.length >= limit) break;
  }
  return out;
}

/** The block that goes into the prompt, or null when nothing matched. */
export function knowledgeBlock(text) {
  if (!config.kb.enabled) return null;
  const hits = search(text, { limit: config.kb.chunks, maxWords: config.kb.maxWords });
  if (!hits.length) return null;

  const taught = hits.filter((h) => h.source === 'taught');
  const notes = hits.filter((h) => h.source === 'notes');
  const older = hits.filter((h) => h.source === 'notes_old');
  const answers = hits.filter((h) => h.source === 'answers');

  return `FROM THE COURSE MATERIAL — use this before anything you think you know

${
    taught.length
      ? `ALREADY ANSWERED BY THE OWNER, THIS IS THE ANSWER\n${taught.map((t) => t.body).join('\n\n')}\n\n`
      : ''
  }${
    notes.length
      ? `LECTURE NOTES\n${notes
          .map((n) => `${n.title ? `[${n.title}] ` : ''}${n.body}`)
          .join('\n\n')}\n`
      : ''
  }${
    older.length
      ? `\nFROM AN EARLIER RUN OF THE SAME COURSE\n${older
          .map((n) => `${n.title ? `[${n.title}] ` : ''}${n.body}`)
          .join('\n\n')}\n\nThe method here is the same and is safe to teach. Screens and menu names may have changed since, so describe what to do rather than promising exactly where a button sits. If the section above already covers the question, use that instead.\n`
      : ''
  }${
    answers.length
      ? `PREVIOUSLY ANSWERED ON THIS NUMBER\n${answers.map((a) => a.body).join('\n\n')}\n`
      : ''
  }
Not all of this carries the same weight, and the difference matters.

ALREADY ANSWERED BY THE OWNER was written by them for exactly this question. Use it, do not improve on it.
LECTURE NOTES are what was taught in class. Where they cover the question, they are the answer.
PREVIOUSLY ANSWERED ON THIS NUMBER is different. Those are replies sent to other people, about other situations, sometimes months ago. They are here to show you how this number sounds — the length, the tone, the way things are explained. They are NOT the answer to this question.

Never copy a past answer unless it is about the same thing this person is asking about. A student asked how to pay a vendor site from Pakistan when PayPal is unavailable, and was sent a past message offering a one-on-one meeting about a Local SEO roadmap — because it was sitting in this block. He asked about payments. Read the question, then decide whether anything here actually addresses it.

If none of it does, answer from the module notes. If you still cannot, say plainly that you will confirm — that is a real answer. A reply that is about a different subject is worse than no reply at all.`;
}

export const kbReady = () => {
  const c = counts();
  return (c.notes || 0) + (c.answers || 0) > 0;
};

export { db as kbDb };

/**
 * the owner's own answers, as candidates for the answer bank.
 *
 * This is how the bank grows without anybody sitting down to write it. He
 * answers a forwarded question once, `learn()` stores it, and from then on
 * it is one of the options the picker can choose — in his words, already
 * approved, because he wrote it.
 */
export function taughtAnswers(limit = 40) {
  const rows = db
    .prepare("SELECT id, body FROM chunks WHERE source = 'taught' ORDER BY id DESC LIMIT ?")
    .all(limit);

  return rows
    .map((r) => {
      const q = /Q:\s*([\s\S]*?)\nA:/.exec(r.body)?.[1]?.trim();
      const a = /\nA:\s*([\s\S]*)$/.exec(r.body)?.[1]?.trim();
      if (!q || !a) return null;
      return { id: `taught-${r.id}`, ask: q.replace(/\s+/g, ' ').slice(0, 120), text: a };
    })
    .filter(Boolean);
}
