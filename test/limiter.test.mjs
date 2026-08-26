#!/usr/bin/env node
/**
 * The queue, tested against the clock.
 *
 * This is the piece that decides whether a busy minute costs quality or time,
 * and it is the kind of code that looks right and is not. So it gets its own
 * file, with real waits — short ones, using a small window scaled down from
 * sixty seconds to keep the run quick.
 *
 *   node test/limiter.test.mjs
 */

import assert from 'node:assert/strict';
import { createLimiter as make, estimateTokens } from '../src/limiter.js';

// A 600ms window instead of a minute, so a real queue forms and drains
// while the test is watching.
const createLimiter = (opts) => make({ windowMs: 600, ...opts });

let pass = 0;
const fails = [];
const test = async (name, fn) => {
  try {
    await fn();
    pass += 1;
  } catch (err) {
    fails.push(`${name}\n     ${err.message.split('\n')[0]}`);
  }
};

const near = (actual, expected, slack, what) =>
  assert.ok(
    Math.abs(actual - expected) <= slack,
    `${what}: ${Math.round(actual)}ms, expected about ${expected}ms`
  );

/* ── the easy case ───────────────────────────────────────── */

await test('nothing waits while there is room', async () => {
  const l = createLimiter({ tokensPerMinute: 10000, requestsPerMinute: 100, maxWaitMs: 6000 });
  const started = Date.now();
  for (let i = 0; i < 5; i += 1) (await l.reserve(500))(500);
  near(Date.now() - started, 0, 120, 'five small calls');
});

/* ── the case this exists for ────────────────────────────── */

await test('a full minute makes the next one wait, it does not fail', async () => {
  // 1000 tokens a minute, 90% headroom = 900 usable.
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 6000 });

  (await l.reserve(800))(800); // fills the window
  const started = Date.now();
  const settle = await l.reserve(800); // must wait for the first to age out
  const waited = Date.now() - started;
  settle(800);

  assert.ok(waited > 200, `should have waited, waited ${waited}ms`);
});

await test('the wait is only as long as it needs to be', async () => {
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 9000 });
  (await l.reserve(800))(800);

  // A small call still fits: 800 + 50 is under the 900 budget.
  const started = Date.now();
  (await l.reserve(50))(50);
  near(Date.now() - started, 0, 120, 'a small call alongside a big one');
});

await test('the request count is a limit too, not just tokens', async () => {
  const l = createLimiter({ tokensPerMinute: 1000000, requestsPerMinute: 2, maxWaitMs: 6000 });
  (await l.reserve(1))(1); // 90% of 2 = 1 request allowed
  const started = Date.now();
  const settle = await l.reserve(1);
  settle(1);
  assert.ok(Date.now() - started > 200, 'the second request should have queued');
});

/* ── fairness and honesty ────────────────────────────────── */

await test('the queue is first come, first served', async () => {
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 6000 });
  const order = [];
  const queue = [1, 2, 3].map((n) =>
    l.reserve(800).then((s) => {
      order.push(n);
      s(800);
    })
  );
  await Promise.all(queue);
  assert.deepEqual(order, [1, 2, 3], `got ${order.join(',')}`);
});

await test('the real usage replaces the guess', async () => {
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 6000 });
  const settle = await l.reserve(800);
  settle(100); // it actually cost far less
  assert.equal(l.state().used, 100);

  // So the next call fits, where against the estimate it would not have.
  const started = Date.now();
  (await l.reserve(700))(700);
  near(Date.now() - started, 0, 120, 'a call that only fits once the truth is known');
});

await test('an impossible wait is refused rather than hidden', async () => {
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 100 });
  (await l.reserve(800))(800);
  await assert.rejects(() => l.reserve(800), /queue would take/);
});

await test('one caller failing does not jam the queue behind it', async () => {
  const l = createLimiter({ tokensPerMinute: 1000, requestsPerMinute: 100, maxWaitMs: 100 });
  (await l.reserve(800))(800);
  await l.reserve(800).catch(() => {}); // refused, as above
  // Small enough to fit right now, and must not be stuck behind the failure.
  const started = Date.now();
  (await l.reserve(50))(50);
  near(Date.now() - started, 0, 200, 'a call after a refused one');
});

/* ── the estimate ────────────────────────────────────────── */

await test('the estimate is in the right ballpark', async () => {
  const words = 'batch kab start hoga '.repeat(50); // ~1050 chars
  const t = estimateTokens(words);
  assert.ok(t > 200 && t < 400, `${t} tokens for ${words.length} chars`);
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
process.exit(fails.length ? 1 : 0);
