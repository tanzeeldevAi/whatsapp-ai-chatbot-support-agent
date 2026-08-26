#!/usr/bin/env node
/**
 * Pull the Batch 2 lesson content out of the LMS into ./notes.
 *
 *   node scripts/lms-pull.mjs                 2026 lessons, text only
 *   node scripts/lms-pull.mjs --year 2025     the other batch, if ever wanted
 *   node scripts/lms-pull.mjs --videos        also record where the video is
 *
 * Text first, deliberately. A good share of these lessons are already written
 * out — "Notes", "Resources", "Complete Off-Page SEO Notes" — and that content
 * is free, instant, and exactly what the bot needs. Transcribing video is the
 * expensive half and it can follow.
 *
 * Batch 1 (2025) is excluded on the owner's instruction: only the 2026 course.
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

const BASE = (process.env.LMS_URL || '').replace(/\/+$/, '');
const USER = process.env.LMS_USER || '';
const PASS = process.env.LMS_APP_PASSWORD || '';
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const argOf = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const YEAR = argOf('--year', '2026');
const OUT = argOf('--out', './notes');
const wantVideos = process.argv.includes('--videos');

fs.mkdirSync(OUT, { recursive: true });

async function api(pathname, params = {}) {
  const url = new URL(`${BASE}/wp-json${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`${res.status} ${pathname}`);
  return { data: await res.json(), pages: Number(res.headers.get('x-wp-totalpages') || 1) };
}

async function all(pathname, params = {}) {
  const out = [];
  let page = 1;
  for (;;) {
    const { data, pages } = await api(pathname, { ...params, per_page: 100, page });
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data);
    if (page >= pages) break;
    page += 1;
  }
  return out;
}

/** HTML to something worth indexing. Keeps headings and list items as lines. */
function textOf(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const VIDEO = [
  /https?:\/\/[^\s"'<>]+\.(?:mp4|m4v|webm|mov)/i,
  /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[\w-]+/i,
  /https?:\/\/(?:player\.)?vimeo\.com\/(?:video\/)?\d+/i,
  /https?:\/\/drive\.google\.com\/file\/d\/[\w-]+/i,
];

const lessons = await all('/wp/v2/lesson', { status: 'publish,private,draft' });
const wanted = lessons.filter((l) => (l.date || '').startsWith(YEAR));

console.log(`\n  ${lessons.length} lessons, ${wanted.length} from ${YEAR}\n`);

const videos = [];
let written = 0;
let emptyish = 0;

for (const l of wanted) {
  const title = textOf(l.title?.rendered).slice(0, 90) || `lesson-${l.id}`;
  const body = textOf(l.content?.rendered);

  // A page can carry the video and almost no text. Record the video either way.
  if (wantVideos || true) {
    const raw = l.content?.rendered || '';
    for (const rx of VIDEO) {
      const m = raw.match(rx);
      if (m) {
        videos.push({ id: l.id, title, date: (l.date || '').slice(0, 10), url: m[0] });
        break;
      }
    }
  }

  if (body.split(/\s+/).length < 40) {
    emptyish += 1;
    continue;
  }

  const slug = `${(l.date || '').slice(0, 10)}-${l.id}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55)}.md`;

  fs.writeFileSync(
    path.join(OUT, slug),
    `# ${title}\n\nLesson ${l.id} · ${(l.date || '').slice(0, 10)} · ${l.link}\n\n${body}\n`
  );
  written += 1;
  console.log(`  ok  ${slug.slice(0, 72).padEnd(73)} ${String(body.split(/\s+/).length).padStart(5)} words`);
}

fs.writeFileSync('./data/lms-videos.json', JSON.stringify(videos, null, 2));

console.log(`\n  ${written} lessons written to ${OUT}`);
console.log(`  ${emptyish} had almost no text (video-only, or the body is not in REST)`);
console.log(`  ${videos.length} video links found → data/lms-videos.json\n`);
if (written) console.log('  Next:  npm run index -- ./notes --corpus\n');
