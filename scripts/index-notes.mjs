#!/usr/bin/env node
/**
 * Build the searchable course knowledge.
 *
 *   node scripts/index-notes.mjs ./notes              lecture material
 *   node scripts/index-notes.mjs --corpus             past real answers
 *   node scripts/index-notes.mjs ./notes --corpus     both
 *
 * Two sources, and the difference between them matters:
 *
 *   notes    whatever is in the folder: .txt .md .html .pdf .docx .vtt .srt
 *            This is what was taught, so it wins at answer time.
 *   corpus   data/mined/corpus.jsonl, the 21,881 real exchanges pulled off
 *            the account. Real answers in his own words, but a quick reply
 *            to one student is weaker evidence than a lecture.
 *
 * Re-running replaces that source cleanly rather than piling up duplicates,
 * so adding a lecture is just: drop the file in, run it again.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const wantCorpus = args.includes('--corpus');
/**
 * `--old <dir>` indexes a folder as `notes_old` instead of `notes`.
 *
 * Same chunking, different rank. Batch 1's lectures go in here so they can
 * answer the modules Batch 2 has no transcript for, without ever outranking
 * Batch 2 where both cover the same ground. The ranking is in
 * knowledge-base.js and the reasoning is in its header.
 */
const oldDir = args.includes('--old') ? args[args.indexOf('--old') + 1] : null;
const corpusPath =
  args[args.indexOf('--corpus-file') + 1] && args.includes('--corpus-file')
    ? args[args.indexOf('--corpus-file') + 1]
    : './data/mined/corpus.jsonl';

if (!dir && !wantCorpus && !oldDir) {
  console.error('Give me a folder of notes, --old <folder>, or --corpus.');
  process.exit(1);
}

const { insertChunk, clearSource, counts, kbDb } = await import('../src/knowledge-base.js');

/* ── reading whatever the notes happen to be ─────────────── */

async function readFile(file) {
  const ext = path.extname(file).toLowerCase();

  if (['.txt', '.md', '.markdown', '.vtt', '.srt', '.csv'].includes(ext)) {
    let text = fs.readFileSync(file, 'utf8');
    // Subtitle files carry timecodes and index numbers that are noise.
    if (ext === '.vtt' || ext === '.srt') {
      text = text
        .split(/\r?\n/)
        .filter((l) => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/i.test(l))
        .join('\n');
    }
    return text;
  }

  if (ext === '.html' || ext === '.htm') {
    return fs
      .readFileSync(file, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }

  if (ext === '.pdf') {
    try {
      const { default: pdf } = await import('pdf-parse/lib/pdf-parse.js');
      return (await pdf(fs.readFileSync(file))).text;
    } catch (err) {
      console.warn(`  ! ${path.basename(file)}: needs pdf-parse (npm i pdf-parse) — ${err.message}`);
      return '';
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ path: file })).value;
    } catch (err) {
      console.warn(`  ! ${path.basename(file)}: needs mammoth (npm i mammoth) — ${err.message}`);
      return '';
    }
  }

  return '';
}

/* ── chunking ────────────────────────────────────────────────
   Paragraph-sized pieces, merged until they are worth retrieving on their
   own. Too small and a hit is a fragment with no context; too big and one
   hit eats the whole prompt budget. 120 to 220 words is the useful band. */

function chunk(text, { min = 120, max = 220 } = {}) {
  const paras = String(text)
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 30);

  const out = [];
  let buf = [];
  let words = 0;

  const flush = () => {
    if (buf.length) out.push(buf.join('\n').trim());
    buf = [];
    words = 0;
  };

  for (const p of paras) {
    const n = p.split(/\s+/).length;
    if (n > max) {
      // One enormous paragraph. Cut it on sentence boundaries.
      flush();
      const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
      let piece = [];
      let pieceWords = 0;
      for (const s of sentences) {
        piece.push(s.trim());
        pieceWords += s.split(/\s+/).length;
        if (pieceWords >= max) {
          out.push(piece.join(' '));
          piece = [];
          pieceWords = 0;
        }
      }
      if (piece.length) out.push(piece.join(' '));
      continue;
    }
    buf.push(p);
    words += n;
    if (words >= min) flush();
  }
  flush();
  return out.filter((c) => c.split(/\s+/).length >= 25);
}

/* ── notes ───────────────────────────────────────────────── */

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) return walk(full);
    if (e.name.startsWith('.') || e.name === 'README.txt') return [];
    return [full];
  });

let notesAdded = 0;

async function indexFolder(folder, source) {
  if (!fs.existsSync(folder)) {
    console.error(`No folder at ${folder}`);
    process.exit(1);
  }
  const files = walk(folder);
  console.log(`\n  ${files.length} files in ${folder} (as ${source})\n`);

  clearSource(source);
  const now = Date.now();

  for (const file of files) {
    const text = await readFile(file);
    if (!text.trim()) {
      console.log(`  -  ${path.basename(file).slice(0, 55).padEnd(56)} nothing readable`);
      continue;
    }
    const pieces = chunk(text);
    const title = path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').slice(0, 80);
    const insertMany = kbDb.transaction((rows) => {
      for (const body of rows) insertChunk.run(source, path.basename(file), title, body, now);
    });
    insertMany(pieces);
    notesAdded += pieces.length;
    console.log(
      `  ok ${path.basename(file).slice(0, 55).padEnd(56)} ${String(pieces.length).padStart(4)} chunks`
    );
  }
}

if (dir) await indexFolder(dir, 'notes');
if (oldDir) await indexFolder(oldDir, 'notes_old');

/* ── the mined corpus ────────────────────────────────────── */

/**
 * Past answers that were true when they were sent and are not true now.
 *
 * Support used to be handed off to the Facebook group, so months of the
 * history say "issues facebook group main post krain" and "support khatam ho
 * gaya hai". Support is open here to everyone now — but retrieval does not
 * know that. It pulled one of those old replies in as PREVIOUSLY ANSWERED ON
 * THIS NUMBER, and since the prompt tells the model that a past answer *is*
 * the answer, it sent it: somebody asking whether paying meant he could ask
 * questions after the lectures was told to go and post in the group.
 *
 * The rule in knowledge.js says never send anybody to a group. Retrieved
 * history outranked it, because history arrives as evidence rather than as
 * instruction. The fix has to be here, at the point where it enters the
 * index — a wrong answer that is never retrieved cannot be copied.
 *
 * Only the group referral goes. Everything else in those conversations is
 * still his voice answering a real question, and that is the whole value of
 * the corpus.
 */
const STALE = [
  /\b(f\.?b\.?|facebook|fb)\b[^.!?]{0,40}\bgrou?p\b/i,
  /\bgrou?p\b[^.!?]{0,35}\b(post|puch|poch|pooch|ask|likh)/i,
  /\bsupport\b[^.!?]{0,35}\b(khatam|khtm|khtam|end(ed)?|band|close)\b/i,
  /\bbatch\b[^.!?]{0,25}\b(khatam|khtm|end(ed)?)\b[^.!?]{0,35}\bsupport\b/i,
];

const isStale = (a) => STALE.some((rx) => rx.test(a));

let corpusAdded = 0;

if (wantCorpus) {
  if (!fs.existsSync(corpusPath)) {
    console.error(`\nNo corpus at ${corpusPath}. Run npm run mine first.`);
  } else {
    clearSource('answers');
    const now = Date.now();
    const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);

    const rows = [];
    let stale = 0;
    for (const line of lines) {
      try {
        const { q, a } = JSON.parse(line);
        // Skip the noise: acknowledgements, one-word replies, anything with
        // no substance to retrieve. A hit on "ok sir" helps nobody.
        if (!q || !a) continue;
        if (a.split(/\s+/).length < 12) continue;
        if (/^\[(image|voice note|document)\]/.test(a)) continue;
        if (isStale(a)) {
          stale += 1;
          continue;
        }
        rows.push([q.slice(0, 400), a.slice(0, 800)]);
      } catch {
        /* a bad line is not worth stopping for */
      }
    }

    const insertMany = kbDb.transaction((pairs) => {
      for (const [q, a] of pairs) {
        insertChunk.run('answers', 'past exchange', null, `Q: ${q}\nA: ${a}`, now);
      }
    });
    insertMany(rows);
    corpusAdded = rows.length;
    console.log(`\n  corpus: ${lines.length} exchanges, ${rows.length} substantial enough to index`);
    if (stale) console.log(`  dropped ${stale} that send people to the group or say support ended`);
  }
}

console.log(`\n  indexed: ${JSON.stringify(counts())}\n`);
if (notesAdded) console.log(`  ${notesAdded} chunks from the notes folder`);
if (corpusAdded) console.log(`  ${corpusAdded} past answers`);
console.log('');
