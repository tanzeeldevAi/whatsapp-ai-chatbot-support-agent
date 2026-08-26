#!/usr/bin/env node
/**
 * One real conversation, two separate failures, both from the same cause:
 * the bot trusting the past over the rules.
 *
 *   them  "Kindly Sir wali sy bat kr k btye ga agr ap fee ly k mjy support
 *          dy da ju koi question bi ma lecture leny k bd pochna cahahu ga
 *          ma course start kia h ub ap ka"
 *   bot   "Sorry. Ap support k liye jo bhi issues hon facebook group main
 *          post krain wahan response kia jay ga"
 *   them  "Ok g"
 *   bot   "AOA, apko kis cheez ki information chahiye?"
 *
 * The first reply is a sentence from the mined history, retrieved and copied
 * — it was true months ago and support is open here now. The second is a
 * greeting sent two minutes into a conversation, because "Ok g" did not
 * count as an acknowledgement and went to the model as a fresh question.
 */

import assert from 'node:assert/strict';
import { _internals } from '../src/brain.js';

const { JUST_ACKNOWLEDGING, stripGroupLine, mentionedGroup, OPENS_WITH_GREETING } = _internals;

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

test('"Ok g" is somebody signing off, not a new question', () => {
  for (const t of ['Ok g', 'ok g', 'Ok ji', 'theek hai ji', 'thanks sir', 'acha bhai', 'g ok', 'done sir', 'ok g.']) {
    assert.ok(JUST_ACKNOWLEDGING.test(t), t);
  }
});

test('a real question that merely starts with ok is still a question', () => {
  for (const t of ['ok sir batayen kaise karun', 'ok g lekin schema kahan lagana hai', 'theek hai but rank nahi ho raha']) {
    assert.ok(!JUST_ACKNOWLEDGING.test(t), t);
  }
});

test('a reply that is nothing but a group referral is left empty, not returned whole', () => {
  const sent = 'Ap support k liye jo bhi issues hon facebook group main post krain wahan response kia jay ga';
  assert.ok(mentionedGroup(sent));
  // It used to come back unchanged here, which is how it reached a student.
  assert.equal(stripGroupLine(sent), '');
});

test('a real answer with a group line tacked on keeps the answer', () => {
  const both =
    'GBP verify karne ke liye postcard method use karein, 14 din lagte hain. Baqi issues facebook group main post krain.';
  const out = stripGroupLine(both);
  assert.ok(out.includes('postcard'), out);
  assert.ok(!/facebook/i.test(out), out);
});

test('a salam mid conversation comes off the front', () => {
  for (const r of [
    'AOA, apko kis cheez ki information chahiye?',
    'Assalam o alaikum, GBP ka issue postcard se hal hoga',
    'Wa alaikum assalam, ji wo setting Yoast me hai',
    'Hello, ye keyword research me dekhna hoga',
  ]) {
    assert.ok(OPENS_WITH_GREETING.test(r), r);
    assert.ok(!/^\s*(aoa|assalam|wa alaikum|hello)/i.test(r.replace(OPENS_WITH_GREETING, '')), r);
  }
});

test('a sentence that merely contains hi or salam is not a greeting', () => {
  for (const r of ['Ye history me check karein', 'Sahi hai, ab index ho jayega', 'Hosting ka issue lagta hai']) {
    assert.ok(!OPENS_WITH_GREETING.test(r), r);
  }
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
