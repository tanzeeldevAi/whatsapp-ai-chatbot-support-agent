#!/usr/bin/env node
/**
 * The bot must not say "Ji main dekh ke abhi btata hun".
 *
 * That one sentence caused two separate complaints:
 *
 *   1. It went out beside every forward. The owner got the question on the log
 *      number with the person already told somebody was looking at it — the
 *      exact thing he said must never happen, because the promise depends on
 *      somebody remembering and the person waits either way.
 *
 *   2. It was sent to somebody who had not asked anything. She wrote "Sir ma
 *      laptop sy pic ly k ap ko send kro gi sham ko or phir btao gi" and was
 *      told it would be checked. Checked on what?
 *
 * It came from three places at once: a constant in brain.js for when the
 * model was unreachable, an instruction in persona.js telling the model to
 * write one on every handover, and a `forward` flag set on the same object
 * that carried the reply. All three are gone. These tests are what stops any
 * of them coming back.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
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

/* Both files explain at length why the holding line is gone, and the
   explanations quote it. So the comments have to come out before looking,
   or every one of these passes on its own documentation. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const brain = stripComments(fs.readFileSync(new URL('../src/brain.js', import.meta.url), 'utf8'));
const persona = fs.readFileSync(new URL('../src/persona.js', import.meta.url), 'utf8');
const personaCode = stripComments(persona);

test('no holding line survives anywhere in the code', () => {
  assert.ok(!/dekh ke abhi btata|dekh k btata/i.test(brain), 'brain.js still builds a holding line');
  assert.ok(!/Let me check this and come back/i.test(brain), 'brain.js still builds an English one');
});

test('the prompt asks for an empty reply on a handover, not a holding line', () => {
  assert.ok(/leave reply completely empty/i.test(personaCode), 'persona.js no longer says to leave it empty');
  assert.ok(
    !/reply with one short holding line/i.test(personaCode),
    'persona.js still asks the model for a holding line'
  );
  assert.ok(
    !/say somebody will get back to them/i.test(personaCode),
    'persona.js still asks it to promise a callback'
  );
});

test('every forward carries no text at all', () => {
  /* The property that matters, and the one that broke: a decision may
     forward, or it may carry a reply, never both. That is what put "g main
     dekh k btata hon" in front of the person while the question went to the
     log number. Checked against the source rather than one code path,
     because the next one added by hand is the one that will get it wrong. */
  const spots = [...brain.matchAll(/forward:\s*true/g)];
  assert.ok(spots.length >= 4, `expected several forward paths, found ${spots.length}`);
  for (const m of spots) {
    const near = brain.slice(m.index, m.index + 260);
    assert.ok(/text:\s*null/.test(near), `a forward without text: null near "${near.slice(0, 70)}"`);
  }
});

test('"I will send it in the evening" is not a question', () => {
  const { tellingUsLater } = _internals;
  for (const t of [
    'Sir ma laptop sy pic ly k ap ko send kro gi sham ko or phir btao gi',
    'main kal bhej dun ga',
    'raat ko kar ke bta dun gi',
    'thori der me send krta hun',
  ]) {
    assert.ok(tellingUsLater(t), t);
  }
});

test('a real question that mentions a time is still answered', () => {
  const { tellingUsLater } = _internals;
  for (const t of [
    'kal tak rank ho jayega?',
    'sham ko class hai kya',
    'kitne din me citations juice pass krti hain',
    'sir kal wali class ki recording kahan hai',
    'main kal bhej dun ga ya ab bhejun?',
  ]) {
    assert.ok(!tellingUsLater(t), t);
  }
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
