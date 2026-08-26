#!/usr/bin/env node
/**
 * Urdu, not Hindi.
 *
 * Models trained heavily on Hindi produce Devanagari-derived vocabulary in
 * Roman script, and it reads as plainly foreign to an Urdu speaker. The live
 * bot said "Batch 3 ki SHURUAT ki TARIKH September ke ANT me" — correct
 * Hindi, wrong language for this number.
 *
 * Every word tested here appears zero times in 2.46 million characters of
 * real replies from this account (npm run wordcheck), so these are not
 * stylistic preferences, they are errors.
 */

import assert from 'node:assert/strict';
import { shorten, _hindi } from '../src/spelling.js';

let pass = 0;
const fails = [];
const test = (name, fn) => {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fails.push(`${name}\n     ${err.message.split('\n')[0]}`);
  }
};

test('the sentence that actually went out is fixed', () => {
  const before = 'Batch 3 ki shuruat ki tarikh September ke ant me hy';
  const after = shorten(before, 'roman_urdu');
  assert.ok(!/shuruat|tarikh|\bant\b/i.test(after), after);
  assert.ok(/start/i.test(after) && /date/i.test(after) && /end/i.test(after), after);
});

test('no Hindi word survives', () => {
  for (const [hindi] of Object.entries(_hindi)) {
    const out = shorten(`ye ${hindi} hy`, 'roman_urdu');
    assert.ok(!new RegExp(`\\b${hindi}\\b`, 'i').test(out), `${hindi} survived as "${out}"`);
  }
});

test('the replacement is the word he actually uses', () => {
  const checks = [
    ['mujhe jankari nahi hy', /maloomat/i],
    ['is vikalp ka prayog karein', /option/i],
    ['kripya intezar karein', /please/i],
    ['ye samasya hy', /masla/i],
    ['adhik time lagega', /zyada/i],
  ];
  for (const [before, expect] of checks) {
    const after = shorten(before, 'roman_urdu');
    assert.ok(expect.test(after), `"${before}" became "${after}"`);
  }
});

test('capitalisation survives the swap', () => {
  assert.match(shorten('Shuruat kab hogi', 'roman_urdu'), /^Start/);
});

test('English replies are left completely alone', () => {
  const english = 'The start date is not confirmed yet, please wait for the announcement';
  assert.equal(shorten(english, 'english'), english);
});

test('Urdu script is left alone', () => {
  const urdu = 'بیچ کب شروع ہوگا';
  assert.equal(shorten(urdu, 'urdu_script'), urdu);
});

test('words he does use are not "corrected"', () => {
  // "sahi" and "pehla" appear in his own replies; touching them would be the
  // same mistake as the five backwards spelling rules, in a new place.
  for (const w of ['sahi', 'pehla', 'pehle', 'lekin', 'sirf', 'zaroori', 'khaas']) {
    const out = shorten(`ye ${w} hy`, 'roman_urdu');
    assert.ok(new RegExp(`\\b${w}\\b`, 'i').test(out), `${w} was changed to "${out}"`);
  }
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
