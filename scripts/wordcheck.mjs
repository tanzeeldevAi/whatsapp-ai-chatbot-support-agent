#!/usr/bin/env node
/**
 * Count how often a word actually appears in his replies.
 *
 *   node scripts/wordcheck.mjs jankari maloomat idea
 *   node scripts/wordcheck.mjs --hindi          the whole Hindi/Urdu list
 *
 * Written as a file rather than an inline one-liner on purpose: a `\b` in a
 * shell heredoc arrives as a backspace character, the pattern then matches
 * nothing, and the answer comes back as a confident zero. That mistake ate
 * an hour in this project already.
 */

import fs from 'node:fs';

const corpusPath = process.env.CORPUS || './data/mined/corpus.jsonl';
if (!fs.existsSync(corpusPath)) {
  console.error(`No corpus at ${corpusPath}. Run npm run mine first.`);
  process.exit(1);
}

const his = fs
  .readFileSync(corpusPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l).a || '';
    } catch {
      return '';
    }
  })
  .join('\n')
  .toLowerCase();

const count = (word) => {
  const rx = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return (his.match(rx) || []).length;
};

/** Hindi word, and what a Roman Urdu writer would use instead. */
const HINDI = [
  ['jankari', 'maloomat'],
  ['shuruat', 'start'],
  ['tarikh', 'date'],
  ['ant', 'end'],
  ['samasya', 'masla'],
  ['upyog', 'use'],
  ['adhik', 'zyada'],
  ['keval', 'sirf'],
  ['prakar', 'tarah'],
  ['uttar', 'jawab'],
  ['prashn', 'sawal'],
  ['aavashyak', 'zaroori'],
  ['sthan', 'jagah'],
  ['vikalp', 'option'],
  ['sahayata', 'madad'],
  ['dhanyavad', 'shukriya'],
  ['kripya', 'please'],
  ['parantu', 'lekin'],
  ['suchna', 'ittila'],
  ['vartaman', 'mojooda'],
  ['sambandh', 'taluq'],
  ['vishesh', 'khaas'],
  ['sambhav', 'mumkin'],
  ['nishchit', 'pakka'],
  ['dhyanpurvak', 'dhyan se'],
  ['sahi', 'sahi'],
  ['pahle', 'pehle'],
  ['pehla', 'pehla'],
];

const words = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (process.argv.includes('--hindi') || !words.length) {
  console.log(`\n  from ${his.length.toLocaleString()} characters of his replies\n`);
  console.log(`  ${'hindi'.padEnd(14)}${'n'.padStart(6)}    ${'urdu / english'.padEnd(16)}n`);
  console.log(`  ${'-'.repeat(14)}${'-'.padStart(6, '-')}    ${'-'.repeat(16)}--`);
  for (const [h, u] of HINDI) {
    const a = count(h);
    const b = count(u);
    const flag = a > 0 ? '  <-- he does use this' : '';
    console.log(`  ${h.padEnd(14)}${String(a).padStart(6)}    ${u.padEnd(16)}${b}${flag}`);
  }
  console.log('');
} else {
  console.log('');
  for (const w of words) console.log(`  ${w.padEnd(18)} ${count(w)}`);
  console.log('');
}
