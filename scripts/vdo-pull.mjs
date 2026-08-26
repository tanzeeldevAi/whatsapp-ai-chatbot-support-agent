#!/usr/bin/env node
/**
 * Pull lecture transcripts out of VdoCipher.
 *
 *   node scripts/vdo-pull.mjs            write notes/ from whatever is available
 *   node scripts/vdo-pull.mjs --report   just say what exists, write nothing
 *
 * The lectures are Urdu, hosted on VdoCipher with DRM. The video itself is
 * sealed — `encryption_type: cbcs` — and the original file is refused with
 * "Original download not enabled" until that is switched on in the account.
 *
 * But a transcript is already sitting there for some of them. VdoCipher ran
 * its own speech-to-text at upload time and stored the result as a WebVTT
 * subtitle track, machine-translated into English. That file is downloadable
 * with nothing more than the API key, and it is the same words the lecture
 * says. So this takes the free path first and reports what it could not get.
 *
 * English is not a compromise here. Every term that decides whether a chunk
 * is the right chunk — Meta Title, niche research, citations, anchor text —
 * is an English term in the original Urdu lecture too. See the note at the
 * top of knowledge-base.js: the English words are what the search matches on.
 *
 * Batch 2 only. data/lms-videos.json is the list of what Batch 2 actually
 * contains, so it is the authority — the VdoCipher account also holds Batch 1
 * and one-off recordings, and those are not to be taught from.
 */

import fs from 'node:fs';
import path from 'node:path';

const envFile = process.env.ENV_FILE || path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const KEY = process.env.VDOCIPHER_KEY;
if (!KEY) {
  console.error('\n  VDOCIPHER_KEY is not set in .env\n');
  process.exit(1);
}

const REPORT_ONLY = process.argv.includes('--report');
/**
 * `--others` pulls the transcripts that are in the account but not in the
 * Batch 2 lesson list — Batch 1, mostly, plus a few one-off recordings.
 *
 * Kept behind a flag and written to a different folder because it is indexed
 * as `notes_old`, which ranks below Batch 2 and only answers where Batch 2 is
 * silent. See the header of knowledge-base.js for why that matters: 21 of the
 * 36 Batch 2 lectures have no transcript yet and they are the core modules,
 * so without this the bot has nothing to say about niche research, keyword
 * research, WordPress, content writing, on page or off page.
 */
const OTHERS = process.argv.includes('--others');
const LESSONS = './data/lms-videos.json';
const OUT = OTHERS ? './notes-batch1' : './notes';

const api = async (p) => {
  const r = await fetch(`https://dev.vdocipher.com/api${p}`, {
    headers: { Authorization: `Apisecret ${KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

/* ── VTT to prose ────────────────────────────────────────────
   A subtitle file is one sentence sliced across cues on timing, not on
   meaning, so a cue on its own is half a thought. Joining everything back
   into continuous text and then re-breaking it on sentence ends gives the
   indexer real paragraphs to chunk, and a retrieved chunk that reads as a
   whole explanation rather than a fragment. */

function vttToProse(vtt) {
  const text = vtt
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^WEBVTT/i.test(t)) return false;
      if (/-->/.test(t)) return false;
      if (/^\d+$/.test(t)) return false;
      if (/^(NOTE|STYLE|REGION)\b/.test(t)) return false;
      return true;
    })
    .join(' ')
    .replace(/<[^>]+>/g, '')       // cue tags
    .replace(/\s+/g, ' ')
    .trim();

  // Re-break into paragraphs of roughly 110 words, always on a sentence end.
  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) || [text];
  const paras = [];
  let buf = [];
  let words = 0;
  for (const s of sentences) {
    buf.push(s.trim());
    words += s.split(/\s+/).length;
    if (words >= 110) {
      paras.push(buf.join(' '));
      buf = [];
      words = 0;
    }
  }
  if (buf.length) paras.push(buf.join(' '));
  return paras.join('\n\n');
}

const slug = (s) =>
  s.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '');

/* ── go ──────────────────────────────────────────────────── */

const batch2 = JSON.parse(fs.readFileSync(LESSONS, 'utf8')).filter((l) => l.vdoId);

let lessons = batch2;
if (OTHERS) {
  // Everything in the account that Batch 2 does not already claim.
  const claimed = new Set(batch2.map((l) => l.vdoId));
  const all = [];
  for (let page = 1; ; page += 1) {
    const d = await api(`/videos?page=${page}&limit=40`);
    all.push(...d.rows);
    if (all.length >= d.count) break;
  }
  lessons = all
    .filter((v) => !claimed.has(v.id) && v.length > 600) // a real lecture, not a clip
    .map((v) => ({ id: v.id.slice(0, 8), topic: v.title, title: v.title, vdoId: v.id }));
}

console.log(
  `\n  ${lessons.length} ${OTHERS ? 'other recordings in the account' : 'Batch 2 lectures have a video'}\n`
);

fs.mkdirSync(OUT, { recursive: true });

const ready = [];
const missing = [];
let written = 0;
let totalWords = 0;

for (const lesson of lessons) {
  const label = (lesson.title || lesson.topic || lesson.vdoId).slice(0, 52).padEnd(53);

  let files;
  try {
    files = await api(`/videos/${lesson.vdoId}/files`);
  } catch (err) {
    console.log(`  !  ${label} ${err.message.slice(0, 40)}`);
    missing.push({ ...lesson, why: 'not in the account' });
    continue;
  }

  const sub = files.find((f) => f.format === 'vtt' && (f.size || 0) > 0);
  if (!sub) {
    console.log(`  -  ${label} no transcript`);
    missing.push({ ...lesson, why: 'no subtitle track' });
    continue;
  }

  ready.push(lesson);
  if (REPORT_ONLY) {
    console.log(`  ok ${label} transcript available`);
    continue;
  }

  try {
    const { redirect } = await api(`/videos/${lesson.vdoId}/files/${sub.id}?redirect=false`);
    const vtt = await (await fetch(redirect)).text();
    if (vtt.startsWith('<?xml') || !/-->/.test(vtt)) {
      // The API lists a track that is not actually in storage. Seen on
      // several videos, always with size 0, but check anyway.
      console.log(`  -  ${label} subtitle listed but not stored`);
      missing.push({ ...lesson, why: 'subtitle missing from storage' });
      ready.pop();
      continue;
    }

    const prose = vttToProse(vtt);
    const words = prose.split(/\s+/).length;
    const name = `lecture-${lesson.id}-${slug(lesson.title || lesson.topic)}.md`;
    fs.writeFileSync(
      path.join(OUT, name),
      `# ${lesson.title || lesson.topic}\n\n` +
        `Local SEO ${OTHERS ? 'lecture from an earlier run of the course' : 'Batch 2 lecture'}. ` +
        `Transcribed from the recording.\n\n${prose}\n`,
      'utf8'
    );
    written += 1;
    totalWords += words;
    console.log(`  ok ${label} ${String(words).padStart(6)} words`);
  } catch (err) {
    console.log(`  !  ${label} ${err.message.slice(0, 40)}`);
    missing.push({ ...lesson, why: err.message.slice(0, 60) });
    ready.pop();
  }
}

console.log(`\n  ${ready.length} with a transcript, ${missing.length} without`);
if (written) console.log(`  wrote ${written} files, ${totalWords.toLocaleString()} words into ${OUT}`);

if (missing.length) {
  console.log(`\n  No transcript yet:\n`);
  for (const m of missing) console.log(`    - ${(m.title || m.topic).slice(0, 60)}`);
  console.log(
    `\n  These have no subtitle track, and the original file is refused while\n` +
      `  "original download" is off in the VdoCipher account. Turn it on at\n` +
      `  vdocipher.com/dashboard/config/advanced and these can be transcribed\n` +
      `  with Whisper instead.\n`
  );
}

console.log(`  Then: npm run index -- ./notes\n`);
