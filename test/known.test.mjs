#!/usr/bin/env node
/**
 * The answers that must not depend on a model being reachable.
 *
 * A real lead sent "Hi", "I want to learn Local SEO", "When the next batch is
 * starting?" and got "Assalamo alaikum, hamari team se mulaqat krna chahte
 * hain?" and then "Let me check this and come back to you." Both models were
 * rate limited at that moment, and the answer to the most important question
 * this number receives was sitting in knowledge.js the whole time.
 *
 * These are the floor. Everything else still goes to the model.
 */

import assert from 'node:assert/strict';
import { greetingFor, knownAnswer } from '../src/known-answers.js';
import { _internals } from '../src/brain.js';

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

test('the batch question is answered from the facts, in either language', () => {
  const en = knownAnswer('enquiry', 'When the next batch is starting?', 'english', {});
  assert.ok(/Batch 3/.test(en), en);
  assert.ok(/September/i.test(en), en);
  assert.ok(!/let me check|come back/i.test(en), en);

  const ur = knownAnswer('enquiry', 'next batch kb start ho ga', 'roman_urdu', {});
  assert.ok(/Batch 3/.test(ur) && /September/i.test(ur), ur);
});

/* This used to allow exactly one "most likely" and check there were not two.
   The owner fixed the date — end of September — so there is now
   nothing to hedge about. A business that says "most likely" about its own
   start date sounds like it does not know its own calendar. */
test('it does not hedge about the date at all', () => {
  for (const lang of ['english', 'roman_urdu']) {
    const out = knownAnswer('enquiry', 'when is the next batch', lang, {});
    assert.ok(!/most likely|shayad|ho sakta hy/i.test(out), out);
    assert.match(out, /end of September|September/i);
  }
});

test('a live "set" override wins over the stored fact', () => {
  const out = knownAnswer('enquiry', 'when is the next batch', 'english', {
    name: 'Batch 4',
    batch: 'in October',
  });
  assert.ok(/Batch 4/.test(out) && /October/.test(out), out);
});

test('the fee question has a known answer too', () => {
  assert.ok(/announcement/i.test(knownAnswer('enquiry', 'fees kitni hy', 'roman_urdu', {})));
  assert.match(knownAnswer('enquiry', 'fees kitni hy', 'roman_urdu', { fee: '15000' }), /15000/);
});

test('anything we do not know still returns nothing, so the model handles it', () => {
  assert.equal(knownAnswer('enquiry', 'backlink kaise banaun', 'roman_urdu', {}), null);
  assert.equal(knownAnswer('student', 'when is the next batch', 'roman_urdu', {}), null);
});

test('a greeting is answered without a model, and mirrors the language', () => {
  assert.match(greetingFor('Hi', 'english'), /^(Hello|Hi)/);
  assert.ok(!/assalam/i.test(greetingFor('Hi', 'english')));
  // Salam back only when they actually said salam.
  assert.match(greetingFor('Assalam o alaikum', 'roman_urdu'), /^Wa alaikum assalam/);
  assert.ok(!/^Wa alaikum/.test(greetingFor('hi', 'roman_urdu')));
});

test('somebody who wants to join is a lead, even when they name the topic', () => {
  const { classify } = _internals;
  const c = { wa_id: '9200', kind: 'unknown' };
  // "SEO" in the sentence used to send this down the expert branch, which
  // loaded the whole syllabus and blew past the fallback model's limit.
  for (const t of [
    'I want to learn Local SEO',
    'I want to learn Local SEO. When the next batch is starting?',
    'sikhna hy local seo',
  ]) {
    assert.equal(classify(c, t).audience, 'enquiry', t);
  }
  for (const t of ['backlink kaise banaun', 'gbp verify nahi ho rha']) {
    assert.equal(classify(c, t).audience, 'student', t);
  }
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
