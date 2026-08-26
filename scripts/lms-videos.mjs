#!/usr/bin/env node
/**
 * List every lesson in the 2026 course and where its video actually lives.
 *
 *   node scripts/lms-videos.mjs
 *
 * Reads TUTOR_KEY and TUTOR_SECRET from .env. Writes data/lms-videos.json,
 * which is the input for whatever transcribes them.
 *
 * The chain, established the hard way:
 *   wp/v2/lesson              content empty, no video meta
 *   tutor/v1/course-contents  topics and lesson ids, still no video
 *   tutor/v1/lessons?topic_id=X   ← the video, and only with a topic id
 *
 * The videos turned out to be VdoCipher shortcodes, `[vdo id="..."]`, which
 * is a DRM platform. The id here is not a file you can fetch; pulling the
 * audio needs VdoCipher's own API credentials on top of these.
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
const COURSE = process.env.TUTOR_COURSE || '2453'; // Batch 2, the 2026 course
const auth =
  'Basic ' + Buffer.from(`${process.env.TUTOR_KEY}:${process.env.TUTOR_SECRET}`).toString('base64');

if (!process.env.TUTOR_KEY || !process.env.TUTOR_SECRET) {
  console.error('TUTOR_KEY and TUTOR_SECRET must be in .env');
  process.exit(1);
}

const get = async (p) => {
  const res = await fetch(`${BASE}/wp-json/tutor/v1/${p}`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
};

const contents = await get(`course-contents/${COURSE}`);
const topics = contents.data || [];
console.log(`\n  course ${COURSE} · ${topics.length} topics\n`);

const out = [];
for (const t of topics) {
  let lessons = [];
  try {
    lessons = (await get(`lessons?topic_id=${t.id}`)).data || [];
  } catch (err) {
    console.warn(`  ! topic ${t.id}: ${err.message}`);
    continue;
  }

  for (const l of lessons) {
    const v = Array.isArray(l.video) ? l.video[0] || {} : l.video || {};
    const shortcode = v.source_shortcode || '';
    const vdo = shortcode.match(/id=["']([a-f0-9]{16,})["']/i);

    out.push({
      topic: t.title,
      topicId: t.id,
      id: l.ID,
      title: l.post_title,
      hasText: Boolean((l.post_content || '').trim()),
      words: (l.post_content || '').split(/\s+/).filter(Boolean).length,
      videoSource: v.source || 'none',
      vdoId: vdo ? vdo[1] : null,
      externalUrl: v.source_external_url || v.source_html5 || '',
      attachments: (l.attachments || []).length,
    });
  }
  process.stdout.write('.');
}

fs.mkdirSync('./data', { recursive: true });
fs.writeFileSync('./data/lms-videos.json', JSON.stringify(out, null, 2));

const bySource = {};
for (const l of out) bySource[l.videoSource] = (bySource[l.videoSource] || 0) + 1;

console.log(`\n\n  ${out.length} lessons`);
console.log(`  video source: ${JSON.stringify(bySource)}`);
console.log(`  with VdoCipher id: ${out.filter((l) => l.vdoId).length}`);
console.log(`  with text content: ${out.filter((l) => l.hasText).length}`);
console.log(`  with attachments : ${out.filter((l) => l.attachments).length}`);
console.log('\n  written to data/lms-videos.json\n');
