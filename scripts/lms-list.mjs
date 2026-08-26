#!/usr/bin/env node
/**
 * Find the lectures on the Tutor LMS site and where their video lives.
 *
 *   node scripts/lms-list.mjs                 what is there
 *   node scripts/lms-list.mjs --course 123    the lessons inside one course
 *   node scripts/lms-list.mjs --json out.json save the full plan
 *
 * Reads LMS_URL, LMS_USER and LMS_APP_PASSWORD from .env.
 *
 * Tutor LMS keeps lessons as a `lesson` post type with the video source in
 * post meta (`_video`). Which meta is exposed over REST varies by version, so
 * this looks in several places and reports what it actually found rather than
 * assuming a shape.
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

if (!BASE || !PASS) {
  console.error('LMS_URL and LMS_APP_PASSWORD must be set in .env');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function api(pathname, params = {}) {
  const url = new URL(`${BASE}/wp-json${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${text.slice(0, 200)}`);
  try {
    return { data: JSON.parse(text), total: Number(res.headers.get('x-wp-totalpages') || 1) };
  } catch {
    throw new Error(`${pathname} did not return JSON`);
  }
}

async function all(pathname, params = {}) {
  const out = [];
  let page = 1;
  for (;;) {
    const { data, total } = await api(pathname, { ...params, per_page: 100, page });
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data);
    if (page >= total) break;
    page += 1;
  }
  return out;
}

/* ── what post types exist ───────────────────────────────── */

const types = (await api('/wp/v2/types')).data;
const tutorTypes = Object.entries(types)
  .filter(([slug]) => /course|lesson|topic|tutor|quiz|assignment/i.test(slug))
  .map(([slug, t]) => ({ slug, name: t.name, rest: t.rest_base, ns: t.rest_namespace }));

console.log('\n  Tutor-ish post types the API exposes:');
for (const t of tutorTypes) {
  console.log(`    ${t.slug.padEnd(22)} ${String(t.name).padEnd(20)} /${t.ns}/${t.rest}`);
}
if (!tutorTypes.length) console.log('    none — the types may not be public in REST');

/* ── courses ─────────────────────────────────────────────── */

const courseType = tutorTypes.find((t) => /^courses?$/i.test(t.slug));
if (!courseType) {
  console.log('\n  No course type over REST. Everything below will be empty.');
  console.log('  Fix: in WordPress, the post type needs show_in_rest. Or use a plugin/WP-CLI.');
  process.exit(0);
}

const courses = await all(`/${courseType.ns}/${courseType.rest}`, { status: 'publish,private,draft' });
console.log(`\n  ${courses.length} courses\n`);
for (const c of courses) {
  console.log(`    ${String(c.id).padEnd(7)} ${String(c.title?.rendered || '').replace(/&#\d+;/g, "'").slice(0, 70)}`);
}

/* ── lessons ─────────────────────────────────────────────── */

const lessonType = tutorTypes.find((t) => /lesson/i.test(t.slug));
if (!lessonType) {
  console.log('\n  No lesson type over REST — cannot list lectures.');
  process.exit(0);
}

const lessons = await all(`/${lessonType.ns}/${lessonType.rest}`, { status: 'publish,private,draft' });
console.log(`\n  ${lessons.length} lessons in total\n`);

/** Where does the video live? Tutor stores it several ways. */
function videoOf(lesson) {
  const meta = lesson.meta || {};
  const raw = meta._video || meta.video || null;
  if (raw && typeof raw === 'object') {
    return { source: raw.source || '?', url: raw.source_external_url || raw.source_video_id || raw.source_youtube || raw.source_vimeo || '' };
  }
  // Fall back to whatever URL is sitting in the content.
  const html = lesson.content?.rendered || '';
  const m =
    html.match(/https?:\/\/[^\s"'<>]+\.(mp4|m4v|webm|mov)/i) ||
    html.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i) ||
    html.match(/https?:\/\/(?:player\.)?vimeo\.com\/[^\s"'<>]+/i);
  return m ? { source: 'in content', url: m[0] } : { source: 'none found', url: '' };
}

const plan = lessons.map((l) => {
  const v = videoOf(l);
  return {
    id: l.id,
    title: String(l.title?.rendered || '').replace(/&#\d+;/g, "'").replace(/<[^>]+>/g, '').trim(),
    date: (l.date || '').slice(0, 10),
    parent: l.parent || l.post_parent || null,
    videoSource: v.source,
    videoUrl: v.url,
    link: l.link,
  };
});

const withVideo = plan.filter((p) => p.videoUrl);
console.log(`  ${withVideo.length} of ${plan.length} lessons have a video URL the API will show us\n`);

const bySource = {};
for (const p of plan) bySource[p.videoSource] = (bySource[p.videoSource] || 0) + 1;
console.log('  where the video lives:', JSON.stringify(bySource));

console.log('\n  first 25 lessons, newest first:\n');
for (const p of [...plan].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25)) {
  console.log(`    ${p.date}  ${String(p.id).padEnd(7)} ${p.title.slice(0, 58).padEnd(59)} ${p.videoSource}`);
}

const outFile = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : './data/lms-lessons.json';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ courses, plan }, null, 2));
console.log(`\n  full list written to ${outFile}\n`);
