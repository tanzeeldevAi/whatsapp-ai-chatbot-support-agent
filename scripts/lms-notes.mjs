#!/usr/bin/env node
/**
 * Download the lecture notes attached to each lesson.
 *
 *   node scripts/lms-notes.mjs
 *
 * These turned out to be the real prize. The lessons themselves are DRM video
 * with empty bodies, but 19 of them carry .docx attachments — "GMB-Class.docx",
 * "3RD-Class-GMB-Practical-Assignment.docx" — which are the written lecture
 * notes, sitting on public upload URLs. No transcription, no VdoCipher key,
 * no waiting.
 *
 * Writes them into ./notes as markdown, ready for:
 *   npm run index -- ./notes --corpus
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

const BASE = (process.env.LMS_URL || 'https://learn.example.com').replace(/\/+$/, '');
const COURSE = process.env.TUTOR_COURSE || '2453';
const OUT = './notes';
const RAW = './data/lms-files';
const auth =
  'Basic ' + Buffer.from(`${process.env.TUTOR_KEY}:${process.env.TUTOR_SECRET}`).toString('base64');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const get = async (p) => {
  const res = await fetch(`${BASE}/wp-json/tutor/v1/${p}`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
};

const topics = (await get(`course-contents/${COURSE}`)).data || [];
console.log(`\n  course ${COURSE} · ${topics.length} topics\n`);

/** .docx to plain text, if mammoth is installed. */
async function docxText(file) {
  try {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ path: file })).value;
  } catch (err) {
    throw new Error(`needs mammoth: npm i mammoth (${err.message})`);
  }
}

let saved = 0;
let failed = 0;

for (const t of topics) {
  let lessons = [];
  try {
    lessons = (await get(`lessons?topic_id=${t.id}`)).data || [];
  } catch {
    continue;
  }

  for (const l of lessons) {
    for (const url of l.attachments || []) {
      const name = decodeURIComponent(path.basename(new URL(url).pathname));
      const local = path.join(RAW, name);

      try {
        if (!fs.existsSync(local)) {
          // The uploads directory is public, but send the key anyway in case
          // this site ever locks it down.
          const res = await fetch(url, {
            headers: { Authorization: auth },
            signal: AbortSignal.timeout(90000),
          });
          if (!res.ok) throw new Error(`${res.status}`);
          fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
        }

        const ext = path.extname(name).toLowerCase();
        let text = '';
        if (ext === '.docx') text = await docxText(local);
        else if (['.txt', '.md'].includes(ext)) text = fs.readFileSync(local, 'utf8');
        else {
          console.log(`  -  ${name.slice(0, 60).padEnd(61)} ${ext} kept, not converted`);
          continue;
        }

        const words = text.split(/\s+/).filter(Boolean).length;
        if (words < 40) {
          console.log(`  -  ${name.slice(0, 60).padEnd(61)} only ${words} words`);
          continue;
        }

        const slug = `${l.ID}-${name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}.md`;
        fs.writeFileSync(
          path.join(OUT, slug),
          `# ${l.post_title}\n\nTopic: ${t.title}\nFile: ${name}\nLesson ${l.ID}\n\n${text.trim()}\n`
        );
        saved += 1;
        console.log(`  ok ${name.slice(0, 60).padEnd(61)} ${String(words).padStart(5)} words`);
      } catch (err) {
        failed += 1;
        console.log(`  !  ${name.slice(0, 60).padEnd(61)} ${err.message}`);
      }
    }
  }
}

console.log(`\n  ${saved} note files written to ${OUT}${failed ? `, ${failed} failed` : ''}`);
console.log('  Next:  npm run index -- ./notes --corpus\n');
