#!/usr/bin/env node
/**
 * The rules that must hold whatever the model returns.
 *
 * No API key needed and no network. These test the deterministic half of the
 * system: the stripper, the language detector, the routing, and the reminder
 * cooldown. The model's own writing is judged by eye in `npm run chat`.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DB_PATH = './data/test.db';
process.env.STUDENTS_CSV = './data/test-students.csv';
process.env.LOG_WHATSAPP_TO = '';
fs.rmSync('./data/test.db', { force: true });
fs.rmSync('./data/test.db-wal', { force: true });
fs.rmSync('./data/test.db-shm', { force: true });
fs.writeFileSync('./data/test-students.csv', 'number,name,batch\n03001234567,Ahmed,Batch 2\n');

const { humanize, bubbles, typingDelayMs, waitFor, opener } = await import('../src/humanize.js');
const { detectLang, resolveLang } = await import('../src/lang.js');
const { _internals } = await import('../src/brain.js');
const { normalize, lookupStudent } = await import('../src/students.js');
const { config } = await import('../src/config.js');

const { classify, reminderDue } = _internals;

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

/* ── the stripper ────────────────────────────────────────── */

test('em dashes never survive', () => {
  assert.ok(!humanize('Yes — the batch starts soon').includes('—'));
  assert.ok(!humanize('Batch – September').includes('–'));
});

test('bullet lists become sentences', () => {
  const out = humanize('Do this:\n- open wp admin\n- click plugins');
  assert.ok(!/^\s*[-*•]/m.test(out), out);
});

test('numbered lists lose their numbers', () => {
  const out = humanize('1. login\n2. go to settings');
  assert.ok(!/^\s*\d+[.)]/m.test(out), out);
});

test('markdown bold is removed', () => {
  assert.equal(humanize('The **title tag** matters'), 'The title tag matters');
});

test('assistant filler is removed, English', () => {
  const out = humanize('Great question! The batch starts in September. I hope this helps!');
  assert.ok(!/great question/i.test(out), out);
  assert.ok(!/hope this helps/i.test(out), out);
  assert.ok(/september/i.test(out), out);
});

test('assistant filler is removed, Roman Urdu', () => {
  const out = humanize('Batch September me start hoga. Koi aur sawal ho to zaroor poochiye.');
  assert.ok(!/koi aur sawal/i.test(out), out);
  assert.ok(/september/i.test(out), out);
});

test('it never admits to being a bot', () => {
  const out = humanize('As an AI, I cannot confirm. The batch starts in September.');
  assert.ok(!/as an ai/i.test(out), out);
});

test('at most one emoji, and never in front', () => {
  const out = humanize('😊 Theek hai 👍 ho jaye ga 🙌');
  const emojis = out.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  assert.ok(emojis.length <= 1, out);
  assert.ok(!/^[\u{1F300}-\u{1FAFF}]/u.test(out), out);
});

test('a long reply is cut at the word limit', () => {
  const long = Array.from({ length: 200 }, () => 'word').join(' ');
  assert.ok(humanize(long).split(/\s+/).length <= config.maxWords);
});

test('nothing is left starting with punctuation', () => {
  const out = humanize('Certainly! Aap ka website theek ho jaye ga.');
  assert.ok(/^[A-Za-z؀-ۿ]/.test(out), out);
});

/* ── bubbles and timing ──────────────────────────────────── */

test('a short reply stays one bubble', () => {
  assert.equal(bubbles('Ji September me start ho ga.').length, 1);
});

test('a long reply splits into two at most', () => {
  const text =
    'Meta description title ke neeche aati hai aur usme 150 characters tak likh sakte hain. ' +
    'Yoast plugin me wo option snippet edit ke andar milta hai, wahan se change kar lein.';
  assert.ok(bubbles(text).length <= 2);
});

test('the pause is never instant and never absurd', () => {
  for (const t of ['ok', 'a '.repeat(60)]) {
    const ms = typingDelayMs(t);
    assert.ok(ms >= 3000, `${ms}`);
    assert.ok(ms <= config.maxDelayMs, `${ms}`);
  }
});

test('the opener is captured so it can be varied', () => {
  assert.equal(opener('Ji bilkul, ho jaye ga'), 'ji');
});

/* ── language ────────────────────────────────────────────── */

test('Roman Urdu is detected', () => {
  assert.equal(detectLang('batch kab start hoga sir'), 'roman_urdu');
  assert.equal(detectLang('mujhe website ka masla hai'), 'roman_urdu');
  assert.equal(detectLang('aap ka course kaisa hai'), 'roman_urdu');
});

test('English is detected', () => {
  assert.equal(detectLang('when does the next batch start'), 'english');
  assert.equal(detectLang('what is the fee for this course'), 'english');
});

test('Urdu script is detected', () => {
  assert.equal(detectLang('بیچ کب شروع ہوگا'), 'urdu_script');
});

test('a one word message keeps the language we already knew', () => {
  assert.equal(detectLang('ok'), null);
  assert.equal(resolveLang('ok', 'english'), 'english');
  assert.equal(resolveLang('ok', 'roman_urdu'), 'roman_urdu');
});

/* ── numbers ─────────────────────────────────────────────── */

test('the same Pakistani number in any form is one person', () => {
  const forms = ['03001234567', '+92 300 1234567', '923001234567', '0092 300 1234567'];
  const all = new Set(forms.map(normalize));
  assert.equal(all.size, 1, [...all].join(' '));
  assert.equal([...all][0], '923001234567');
});

test('the roster is read and matched', () => {
  assert.ok(lookupStudent('923001234567'));
  assert.equal(lookupStudent('923001234567').name, 'Ahmed');
  assert.equal(lookupStudent('923009999999'), null);
});

/* ── routing ─────────────────────────────────────────────── */

const contact = (over = {}) => ({ wa_id: '920000000009', kind: 'unknown', ...over });

test('a number on the roster is a student, and cannot be reclassified', () => {
  const r = classify(contact({ wa_id: '923001234567' }), 'salam sir');
  assert.equal(r.audience, 'student');
  assert.equal(r.locked, true);
});

test('a course question from a stranger is treated as a student', () => {
  assert.equal(classify(contact(), 'sir on page seo me title tag kahan lagta hai').audience, 'student');
  assert.equal(classify(contact(), 'my wordpress site is showing 404').audience, 'student');
  assert.equal(classify(contact(), 'google business profile verify nahi ho raha').audience, 'student');
});

test('a batch question is a new enquiry', () => {
  assert.equal(classify(contact(), 'sir new batch kab start hoga').audience, 'enquiry');
  assert.equal(classify(contact(), 'what is the fee for the course').audience, 'enquiry');
  assert.equal(classify(contact(), 'admission kaise leni hai').audience, 'enquiry');
});

test('a student asking about the next batch gets the batch answer', () => {
  assert.equal(classify(contact({ kind: 'student' }), 'sir agla batch kab hai').audience, 'enquiry');
});

test('a student asking a course question stays a student', () => {
  assert.equal(classify(contact({ kind: 'student' }), 'backlink kaise banaye').audience, 'student');
});

test('a bare greeting decides nothing on its own', () => {
  assert.equal(classify(contact(), 'assalam o alaikum').audience, 'unknown');
});

test('money and complaints are escalated', () => {
  for (const t of ['mene fees pay ki thi refund chahiye', 'I want a refund', 'certificate nahi mila']) {
    assert.ok(_internals.ESCALATE.test(t), t);
  }
});

test('asking for the owner hands over too, by the other route', () => {
  // Money and complaints go through ESCALATE; wanting a person goes through
  // WANTS_HUMAN. Different reasons, same outcome: the bot stops and you are
  // told. Split apart so that neither can quietly swallow the other.
  const { ESCALATE, WANTS_HUMAN } = _internals;
  for (const t of ['sir se baat karni hai', 'owner se baat karwa dein']) {
    assert.ok(ESCALATE.test(t) || WANTS_HUMAN.test(t), t);
  }
});

/* ── the reminder ────────────────────────────────────────── */

// Support is open to everyone now, so nobody is ever sent to a group.
// The machinery is kept behind GROUP_REMINDER in case that changes back.

test('nobody is told support has ended, whatever they ask', () => {
  assert.equal(config.groupReminder, false, 'GROUP_REMINDER should default to off');
  for (const [kind, text] of [
    ['student', 'on page seo ka masla hai'],
    ['student', 'backlink kaise banaye'],
    ['enquiry', 'batch kab start hoga'],
    ['student', 'shukriya sir'],
  ]) {
    assert.equal(reminderDue(contact({ kind }), kind, text), false, `${kind}: ${text}`);
  }
});

test('a group line is stripped even if the model volunteers one', () => {
  const { stripGroupLine } = _internals;
  const out = stripGroupLine(
    'Backlink guest post se banta hai. Waise ab yahan support nahi rahi, FB group me pooch lein.'
  );
  assert.ok(/backlink/i.test(out), out);
  assert.ok(!/group/i.test(out), out);
});

test('the reminder wording is still there and still varied, if it is ever turned back on', async () => {
  const { reminderLine, _variants } = await import('../src/reminders.js');
  assert.ok(_variants.roman_urdu.length >= 5);
  assert.ok(_variants.english.length >= 5);
  const avoid = _variants.roman_urdu[0];
  for (let i = 0; i < 20; i += 1) {
    assert.notEqual(reminderLine('roman_urdu', '', avoid), avoid);
  }
});

test('a group sentence is cut out, and the answer survives', () => {
  const { stripGroupLine } = _internals;
  const out = stripGroupLine(
    'Backlink guest post se banta hai. Waise WhatsApp support ab band ho chuki hai, ' +
      'Facebook group me pooch lein.'
  );
  assert.ok(/backlink/i.test(out), out);
  assert.ok(!/facebook/i.test(out), out);
});

/* This test used to assert the opposite — that a reply which is nothing but a
   group referral survives stripping rather than coming back empty. That was
   right while the referral was true and the worst case was repeating it.

   It is what sent a student to the Facebook group after he asked whether
   paying meant he could ask questions once the lectures started. Support is
   open here to everyone now, so an empty result is the correct answer: there
   is nothing left worth sending, and brain.js forwards it to the owner. */
test('a reply that is only a group referral comes back empty so it is never sent', () => {
  const only = 'Facebook group me pooch lein, WhatsApp support ab band hai.';
  assert.equal(_internals.stripGroupLine(only), '');
});

test('list steps are joined with commas, not left as a run-on', () => {
  const out = humanize('Ye karein:\n1. wp admin kholein\n2. plugins pe jayen\n3. Yoast install karein');
  assert.ok(!out.includes('\n'), out);
  assert.ok(out.split(',').length >= 3, out);
});

test('a stranded emoji never becomes its own bubble', () => {
  const out = humanize('Theek hai ho jaye ga.\n😊');
  assert.equal(bubbles(out).length, 1, JSON.stringify(out));
});

/* ── the pause is measured from their message ────────────── */

test('time already spent bundling and thinking comes out of the pause', () => {
  const text = 'Ji September me start ho ga.';
  const fresh = waitFor(text, Date.now());
  const stale = waitFor(text, Date.now() - 5000);
  assert.ok(stale.sleep < fresh.sleep, `${stale.sleep} vs ${fresh.sleep}`);
});

test('a slow model still never produces an instant reply', () => {
  const { sleep } = waitFor('Ji theek hai.', Date.now() - 120000);
  assert.ok(sleep >= config.minDelayMs, `${sleep}`);
});

test('the whole gap lands in the range a person would take', () => {
  // Typical case: 4s bundling, ~1.5s of model, then the remaining pause.
  const reply = 'Ji September ke mid ya end me start hoga, thora delay ho gaya hai.';
  const spent = 5500;
  const total = spent + waitFor(reply, Date.now() - spent).sleep;
  assert.ok(total >= 5000 && total <= config.maxDelayMs + 2000, `${total}ms`);
});

/* ── knowing when to say nothing, and when to ask ────────── */

test('"ok" and "thank you" get no reply at all', () => {
  const { JUST_ACKNOWLEDGING, EMOJI_ONLY } = _internals;
  for (const t of ['Ok', 'ok.', 'Thank you', 'thanks!', 'shukriya', 'theek hai', 'got it', 'done', 'hmm']) {
    assert.ok(JUST_ACKNOWLEDGING.test(t), t);
  }
  for (const t of ['👍', '🙏 ', '😊😊']) assert.ok(EMOJI_ONLY.test(t), t);
});

test('a real question is never mistaken for a sign-off', () => {
  const { JUST_ACKNOWLEDGING } = _internals;
  for (const t of ['ok sir backlink kaise banaun', 'thanks, ab GBP ka btayen', 'theek hai lekin site slow hy']) {
    assert.equal(JUST_ACKNOWLEDGING.test(t), false, t);
  }
});

test('a price we do not have is asked about, never invented', () => {
  const { ASKS_PRICE, BATCH_ENQUIRY } = _internals;
  // The real message. It used to hit BATCH_ENQUIRY on the word "charges" and
  // come back with the scripted course-fee line.
  assert.equal(BATCH_ENQUIRY.test('Sir hosting charges?'), false);
  assert.ok(ASKS_PRICE.test('Sir hosting charges?'));

  for (const t of ['domain kitne ka aata hy', 'semrush ka price kia hy', 'theme ka cost']) {
    assert.equal(BATCH_ENQUIRY.test(t), false, `${t} is not a course fee question`);
    assert.ok(ASKS_PRICE.test(t), t);
  }
});

test('the course fee is still answered as the course fee', () => {
  const { BATCH_ENQUIRY } = _internals;
  for (const t of [
    'fees kitni hy',
    'course ki fees',
    'what is the fee for the course',
    'how much is the course',
    'admission kaise leni hai',
  ]) {
    assert.ok(BATCH_ENQUIRY.test(t), t);
  }
});

/* ── "kitna" is not a money word ─────────────────────────── */

test('a price question is a price question', () => {
  const { ASKS_PRICE } = _internals;
  for (const t of ['sir hosting charges kitne hain', 'hostinger ka plan kitne ka aata hy', 'semrush ki price kia hy']) {
    assert.ok(ASKS_PRICE.test(t), t);
  }
});

test('"kitna" about time, pages or counts is not a price question', () => {
  // "citations kitne time me juice pass krty hain" was forwarded to the owner
  // as a price question, because a bare `kitna` was in the pattern. It is
  // how you ask how much of anything in Urdu.
  const { ASKS_PRICE } = _internals;
  for (const t of [
    'citations kitne time me juice pass krty hain',
    'kitne pages banane chahye',
    'kitni der lagti hy indexing me',
    'kitne backlinks chahye',
    'KD kitna hona chahye',
    'volume kitna hona chahye',
  ]) {
    assert.equal(ASKS_PRICE.test(t), false, t);
  }
});

test('course admin questions go to the owner, course questions do not', () => {
  const { IS_COURSE_ADMIN } = _internals;
  for (const t of ['sir LMS access nahi mil raha', 'fee pay kr di hy lkn submission ni ho rahi', 'class kab hai', 'group me add nahi kiya', 'Sir any update ...???']) {
    assert.ok(IS_COURSE_ADMIN.test(t), t);
  }
  for (const t of ['backlink kaise banaun', 'gbp verify nahi ho rha', 'niche research me KD kitna']) {
    assert.equal(IS_COURSE_ADMIN.test(t), false, t);
  }
});

/* ── it must never claim to be a person ──────────────────── */

test('asking for a person, however it is spelled, fetches one', () => {
  const { WANTS_HUMAN } = _internals;
  for (const t of [
    'ap kon ho real ho na Q k mjhy real perosn s ehelp chaiye', // the real message, typo and all
    'ni mjhy sir wali se baat krni hy un ka number dy dain',
    'are you a bot?',
    'ap real person ho?',
    'sir mujhe kisi se baat karni hy',
  ]) {
    assert.ok(WANTS_HUMAN.test(t), t);
  }
});

test('ordinary questions are not mistaken for wanting a person', () => {
  const { WANTS_HUMAN } = _internals;
  for (const t of [
    'sir backlink kaise banaun',
    'gbp verify nahi ho rha',
    'mera number change ho gaya hy',
    'real estate client ke liye keyword research',
  ]) {
    assert.equal(WANTS_HUMAN.test(t), false, t);
  }
});

test('any claim of being human is caught, not just the obvious phrasing', () => {
  const { CLAIMS_HUMAN } = _internals;
  for (const t of [
    'Haan main real person hun, apko madad chahye',
    'Ji main hamari team se ek human supporter hoon', // what it actually said
    'Yes I am a real person',
    'main bot nahi hun',
  ]) {
    assert.ok(CLAIMS_HUMAN.test(t), t);
  }
  for (const t of [
    'Ji main dekh ke btata hun',
    'Ji ap Semrush use krein KD 30 se neeche',
    'Ji main abhi baat karwa deta hun, thori dair me reply aa jaye ga.',
  ]) {
    assert.equal(CLAIMS_HUMAN.test(t), false, t);
  }
});

/* ── what is not ours to answer ──────────────────────────── */

test('company pitches, spam and job hunters are forwarded, not answered', () => {
  const { NOT_OURS } = _internals;
  for (const t of [
    'Hello sir, we are a digital marketing agency from India. We can provide white label SEO',
    'kya ap graphic designer hire kr rhe hain? mera portfolio dekh lein',
    'we offer smm panel cheap rates',
    'Dear sir, business proposal for collaboration',
  ]) {
    assert.ok(NOT_OURS.test(t), t);
  }
});

test('a real student question is never mistaken for spam', () => {
  const { NOT_OURS } = _internals;
  for (const t of [
    'sir mera site updating hy phir bhi slow chal rha',
    'sir backlink kaise banaun',
    'gbp verify nahi ho rha',
    'sir mujhe client hunting me issue hy',
    'content writing ka module dobara samjha dein',
    'sir new batch kb start ho ga',
  ]) {
    assert.equal(NOT_OURS.test(t), false, t);
  }
});

test('every module has notes, and only the asked-about one is sent', async () => {
  const { MODULES, syllabusBlock, moduleFor } = await import('../src/syllabus.js');
  assert.ok(MODULES.length >= 8);
  for (const m of MODULES) assert.ok(m.taught.length > 200, `${m.key} needs real notes`);

  assert.equal(moduleFor('gbp verify nahi ho rha'), 'gbp');
  assert.equal(moduleFor('wordpress site slow hy'), 'wordpress');
  assert.equal(moduleFor('backlink kaise banaun'), 'offpage');
  assert.equal(moduleFor('niche research me competition aur volume kaise dekhun'), 'research');
  assert.equal(moduleFor('location page har city ke liye alag likhna zaruri hy'), 'content');

  const focused = syllabusBlock('gbp');
  const everything = MODULES.map((m) => m.taught).join(' ');
  assert.ok(focused.length < everything.length / 2, 'a focused block must be much smaller');
  assert.ok(/Google Business Profile/.test(focused));
  assert.ok(!/HARO/.test(focused), 'off-page notes should not ride along with a GBP question');
});

test('when the topic is unclear, every module is sent rather than a summary', async () => {
  const { MODULES, syllabusBlock } = await import('../src/syllabus.js');
  const block = syllabusBlock(null);
  // Answering with less context than we have is what produced "har city ke
  // liye alag page zaruri nahi", the opposite of what was taught.
  for (const m of MODULES) {
    assert.ok(block.includes(m.name), `${m.name} missing from the fallback block`);
  }
  assert.ok(block.length > MODULES.map((m) => m.taught).join('').length * 0.8);
});

test('the tools they were taught on are always named', async () => {
  const { TOOLS, syllabusBlock } = await import('../src/syllabus.js');
  assert.equal(TOOLS.primary, 'Semrush');
  for (const focus of ['research', 'gbp', null]) {
    assert.ok(
      syllabusBlock(focus).includes(TOOLS.primary),
      `${focus || 'fallback'} block must name ${TOOLS.primary}`
    );
  }
});

/* ── the link: what it refuses to touch ──────────────────── */

const link = await import('../src/link.js');

test('groups are never answered', () => {
  assert.equal(link.ignorable('120363012345678901@g.us'), true);
});

test('status and broadcast lists are never answered', () => {
  assert.equal(link.ignorable('status@broadcast'), true);
  assert.equal(link.ignorable('1234567890@broadcast'), true);
});

test('a normal one to one chat is answered', () => {
  assert.equal(link.ignorable('923001234567@s.whatsapp.net'), false);
});

test('a number turns into a jid and back unchanged', () => {
  assert.equal(link.toJid('923001234567'), '923001234567@s.whatsapp.net');
  assert.equal(link.toJid('+92 300 1234567'), '923001234567@s.whatsapp.net');
  assert.equal(link.toNumber('923001234567@s.whatsapp.net'), '923001234567');
  assert.equal(link.toNumber('923001234567:12@s.whatsapp.net'), '923001234567');
});

test('text is found whatever shape the message is', () => {
  const cases = [
    [{ message: { conversation: 'salam' } }, 'salam'],
    [{ message: { extendedTextMessage: { text: 'batch kab' } } }, 'batch kab'],
    [{ message: { imageMessage: { caption: 'ye dekhein' } } }, 'ye dekhein'],
    [{ message: { ephemeralMessage: { message: { conversation: 'disappearing' } } } }, 'disappearing'],
  ];
  for (const [msg, want] of cases) assert.equal(link.textOf(msg), want);
});

test('reactions, edits and poll votes are not questions', () => {
  assert.equal(link.noise({ reactionMessage: { text: '👍' } }), true);
  assert.equal(link.noise({ protocolMessage: { type: 0 } }), true);
  assert.equal(link.noise({ messageContextInfo: {} }), true);
  assert.equal(link.noise({ conversation: 'batch kab hai' }), false);
  assert.equal(link.noise({ conversation: 'hi', messageContextInfo: {} }), false);
});

test('a voice note is recognised as audio', () => {
  assert.equal(link.kindOf({ message: { audioMessage: { mimetype: 'audio/ogg' } } }), 'audio');
  assert.equal(link.kindOf({ message: { conversation: 'hi' } }), 'text');
});

/* ── report ──────────────────────────────────────────────── */

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
for (const f of fails) console.log(`  ✗ ${f}\n`);
fs.rmSync('./data/test-students.csv', { force: true });
process.exit(fails.length ? 1 : 0);
