#!/usr/bin/env node
/**
 * LMS problems are carried, not answered.
 *
 * The owner can read a screenshot of an LMS error and know the fix; nothing
 * here can. So the bot's whole job on these is to get the picture in front
 * of him and stay quiet until he replies. His words then go back verbatim
 * and are learned, so the next person asking the same thing is answered
 * rather than sent to his phone again.
 *
 * The picture itself cannot be matched against the next one, which is why
 * the question stored against his answer is their own words, not the image.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _internals } from '../src/brain.js';

const { IS_LMS } = _internals;

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

test('a broken screen is an LMS problem', () => {
  for (const t of [
    'lms me login nahi ho raha',
    'sir dashboard open nahi ho raha',
    'portal ka password galat bata raha',
    'course dashboard me nahi dikh raha',
    'video play nahi ho rahi',
    'lecture khul nahi raha',
    'sign in issue aa raha hai',
  ]) {
    assert.ok(IS_LMS.test(t), t);
  }
});

test('a question about the course is not a broken screen', () => {
  /* These would otherwise get "zara screenshot bhej dein" for a question
     with nothing to photograph. "lecture" and "recording" on their own are
     deliberately not LMS signals. */
  for (const t of [
    'kal wali lecture ka link bhej dein',
    'recording kab milegi',
    'class kab hai',
    'gbp verify nahi ho raha',
    'meta title kitne characters',
    'video me sir ne kya btaya tha',
  ]) {
    assert.ok(!IS_LMS.test(t), t);
  }
});

test('a screenshot is forwarded and never answered', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const branch = server.slice(server.indexOf("if (kind === 'image')"), server.indexOf("if (kind === 'document'"));
  assert.ok(branch.includes('forwardToOwner'), 'an image no longer reaches the owner');
  assert.ok(branch.includes('image: picture'), 'the picture itself is not attached');
  assert.ok(!branch.includes('apologise'), 'it still replies to a screenshot');
  // This is what it used to say instead of forwarding.
  assert.ok(!/Zara likh dein exactly kya masla/.test(branch));
});

test('the screenshot ask is not a promise to come back', () => {
  const brain = fs.readFileSync(new URL('../src/brain.js', import.meta.url), 'utf8');
  const ask = brain.slice(brain.indexOf('const ASK_SCREENSHOT'), brain.indexOf('const tellingUsLater'));
  assert.match(ask, /screenshot bhej dein/i);
  assert.ok(!/btata hun|btaunga|check kar/i.test(ask), 'the ask smuggled a holding line back in');
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
