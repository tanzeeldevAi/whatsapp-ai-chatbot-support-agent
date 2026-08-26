#!/usr/bin/env node
/**
 * Which models does this key actually have?
 *
 * Free tiers change what they offer without notice, and a model name that
 * worked last month returns a 404 that reads like an auth failure. Run this
 * before assuming the key is broken.
 *
 *   npm run models
 */

import fs from 'node:fs';
import path from 'node:path';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const base = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
const key = process.env.AI_API_KEY;

if (!key) {
  console.error('AI_API_KEY is not set.');
  process.exit(1);
}

const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const { data = [] } = await res.json();
const names = data.map((m) => m.id).sort();

console.log(`\n${names.length} models on this key (${base})\n`);
for (const n of names) console.log(`  ${n}`);

const chat = names.filter((n) => !/whisper|tts|guard|embed/i.test(n));
const audio = names.filter((n) => /whisper/i.test(n));

console.log(`\nCurrent AI_MODEL: ${process.env.AI_MODEL || '(default)'}`);
console.log(`Current AUDIO_MODEL: ${process.env.AUDIO_MODEL || '(default)'}`);
console.log(`\nUsable for replies: ${chat.slice(0, 8).join(', ')}${chat.length > 8 ? ' …' : ''}`);
console.log(`Usable for voice notes: ${audio.join(', ') || 'none on this key'}\n`);
