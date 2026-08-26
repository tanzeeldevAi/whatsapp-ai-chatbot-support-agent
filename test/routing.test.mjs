#!/usr/bin/env node
/**
 * Which section a question is sent to.
 *
 * This used to be first-match-wins over a hand-ordered list, so the answer
 * depended on the order the list happened to be written in rather than on the
 * question. "wordpress me schema kaise lagaun" went to WordPress because
 * WordPress was tested first; "backlink ke liye content kaise likhun" went to
 * Off Page for the same reason. Both got the wrong notes in front of them.
 *
 * Now every module is scored and the strongest wins, with both sent when a
 * question honestly spans two.
 */

import assert from 'node:assert/strict';
import { moduleFor, focusModules, scoreModules, syllabusBlock } from '../src/syllabus.js';
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

test('each question reaches its own section', () => {
  const cases = [
    ['niche research me KD kitna hona chahye', 'research'],
    ['gbp me reviews kaise laun', 'gbp'],
    ['site slow hy speed kaise theek krun', 'wordpress'],
    ['location page har city ke liye alag likhna zaruri hy', 'content'],
    ['title tag kitne characters ka hona chahye', 'onpage'],
    ['anchor text kaisa rakhna chahye', 'offpage'],
    ['client ko pehla message kia bhejun', 'clients'],
    ['rank and rent model kaise kaam krta hy', 'rankrent'],
    ['ringba me tracking number kaise set krun', 'tracking'],
    ['chatgpt se content likhwaun to kia dhyan rakhun', 'ai'],
  ];
  for (const [text, want] of cases) {
    assert.equal(moduleFor(text), want, `${text} -> ${JSON.stringify(scoreModules(text).slice(0, 2))}`);
  }
});

test('the order the list is written in no longer decides', () => {
  // Both of these used to go to whichever module was tested first.
  assert.equal(moduleFor('backlink ke liye content kaise likhun'), 'offpage');
  assert.ok(focusModules('wordpress me schema kaise lagaun').includes('onpage'));
});

test('a question spanning two sections gets both', () => {
  const both = focusModules('wordpress me schema kaise lagaun');
  assert.equal(both.length, 2, JSON.stringify(both));
  const block = syllabusBlock(both);
  assert.match(block, /## On Page SEO/);
  assert.match(block, /## WordPress/);
});

test('a clear question gets one section, not two', () => {
  assert.equal(focusModules('ringba me tracking number kaise set krun').length, 1);
  assert.equal(focusModules('title tag kitne characters').length, 1);
});

test('nothing recognised means every module, never a guess', () => {
  assert.equal(moduleFor('sir aik baat poochni thi'), null);
  const block = syllabusBlock(focusModules('sir aik baat poochni thi'));
  assert.match(block, /WHAT THE COURSE COVERED, IN DETAIL/);
});

test('the three segments still split correctly', () => {
  const { classify } = _internals;
  const c = { wa_id: '9200', kind: 'unknown' };
  assert.equal(classify(c, 'sir new batch kab start hoga').audience, 'enquiry');
  assert.equal(classify(c, 'I want to learn Local SEO').audience, 'enquiry');
  assert.equal(classify(c, 'gbp verify nahi ho rha').audience, 'student');
  assert.equal(classify(c, 'assalam o alaikum').audience, 'unknown');
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
