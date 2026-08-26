import { FACTS } from './knowledge.js';

/**
 * The handful of answers that must never depend on a model being reachable.
 *
 * A lead sent "Hi", then "I want to learn Local SEO", then "When the next
 * batch is starting?" — and got "Assalamo alaikum, hamari team se mulaqat
 * krna chahte hain?" followed by "Let me check this and come back to you."
 * The first is nonsense. The second is a holding line for the single most
 * important question this number receives, whose answer was sitting in
 * `knowledge.js` the whole time. Both models happened to be rate limited.
 *
 * That is not acceptable for a business number, so these three cases are
 * answered from the facts directly:
 *
 *   a greeting        there is no judgement involved in greeting somebody
 *   when is the batch we know this
 *   what is the fee   we know our position on this
 *
 * They are used in two places: as the fallback when the model is unreachable,
 * and — for the greeting — instead of the model entirely. A model adds
 * nothing to "Hi" and, as the transcript shows, can subtract quite a lot.
 *
 * Everything else still goes to the model. This is a floor, not a script.
 */

/* ── greetings ───────────────────────────────────────────── */

const GREETING = {
  roman_urdu: ['Wa alaikum assalam, jee farmayen', 'Wa alaikum assalam, btayen kia madad chahiye'],
  english: ['Hello, how can I help?', 'Hi, what can I help you with?'],
  urdu_script: ['وعلیکم السلام، جی فرمائیں'],
};

/** Did they open with salam specifically, or just "hi"? */
const SALAM = /\b(a?s+alam|salam|slam|assalam|aoa|salaam)\b/i;

export function greetingFor(text, lang) {
  const pool = GREETING[lang] || GREETING.roman_urdu;
  // "Wa alaikum assalam" only makes sense in reply to salam. To a plain "Hi"
  // it reads as a script running rather than a person answering.
  if (lang !== 'english' && !SALAM.test(text)) {
    return 'Jee btayen, kia madad chahiye';
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ── the questions we can answer without help ────────────── */

/**
 * The answer this number exists to give.
 *
 * Three sentences and no more: when, why it moved, and what happens next.
 * Anything longer reads as a brochure; anything shorter leaves them asking a
 * follow-up we would only forward.
 *
 * The hedge is gone. It used to say "most likely mid to end of September",
 * which is two pieces of uncertainty stacked on one date and reads as a
 * business unsure of its own calendar. It is the end of September.
 *
 * The last line is a promise the system can actually keep: anybody who asks
 * this is put on the waiting list, and `launch` messages that list. It is
 * not "let me check" — see the note about holding lines in brain.js.
 */
const batchAnswer = (lang, settings) => {
  const name = settings.name || FACTS.batch.name;
  const when = (settings.batch || FACTS.batch.timing).replace(/^most likely\s+/i, '');
  if (lang === 'english') {
    return (
      `${name} is starting at the ${when}. ` +
      `The course is being updated with new AI modules, which is why it moved a little. ` +
      `Registration opens with the announcement and I will message you the day it does.`
    );
  }
  if (lang === 'urdu_script') {
    return (
      `${name} ستمبر کے آخر میں شروع ہو رہا ہے۔ کورس میں نئے AI ماڈیول شامل کیے جا رہے ہیں ` +
      `اس لیے تھوڑا آگے چلا گیا۔ رجسٹریشن اعلان کے ساتھ کھلے گی اور جس دن کھلے گی میں آپ کو میسج کر دوں گا۔`
    );
  }
  return (
    `${name} ${when} start ho raha hy. Course me naye AI modules add ho rahe hain is liye thora aage chala gaya. ` +
    `Registration announcement ke saath khulegi aur jis din khulegi main apko message kar dunga.`
  );
};

const feeAnswer = (lang, settings) => {
  const fee = settings.fee ?? FACTS.batch.fee;
  if (fee) {
    return lang === 'english' ? `The fee is ${fee}.` : `Fees ${fee} hy.`;
  }
  return lang === 'english'
    ? 'The full details including the fee come with the announcement.'
    : 'Fees samet poori details announcement ke saath share kar denge.';
};

const ASKS_WHEN =
  /\b(when|kab|kb)\b[^?]{0,40}\b(batch|start|shuru|begin)\b|\b(batch|class)\b[^?]{0,25}\b(kab|kb|when)\b|\bnext batch\b|\bnew batch\b/i;

const ASKS_FEE =
  /\b(fees? kitni|fee kitni|course (ki |ka )?fees?|batch (ki |ka )?fees?|how much (is )?(the )?(course|batch|fee))\b/i;

/**
 * @returns {string|null} an answer we are certain of, or null to let the
 *          model handle it as usual.
 */
export function knownAnswer(audience, text, lang, settings = {}) {
  if (audience !== 'enquiry' && audience !== 'unknown') return null;
  if (ASKS_FEE.test(text)) return feeAnswer(lang, settings);
  if (ASKS_WHEN.test(text)) return batchAnswer(lang, settings);
  return null;
}

/** Are they asking when it starts? Used to put them on the waiting list. */
export const asksWhenBatch = (text) => ASKS_WHEN.test(String(text || ''));

export const _internals = { ASKS_WHEN, ASKS_FEE, SALAM };

/**
 * What the waiting list is told on launch day.
 *
 * Written to be forwarded. Somebody who has waited two months for this will
 * send it to a friend, so it has to make sense with no conversation above
 * it: what is starting, when, and what to do next. No "as discussed", no
 * "you asked about this".
 *
 * Overridable at the point of sending — `launch send <your own words>` — so
 * this is a good default, not a rule.
 */
export function launchMessage(settings = {}) {
  const name = settings.name || FACTS.batch.name;
  return (
    `Assalam o alaikum. ${name} ki registration khul gayi hy.\n\n` +
    `Local SEO ka poora course hy, GBP se le kar WordPress, content writing, on page, off page, ` +
    `client hunting aur naye AI modules tak.\n\n` +
    `Apne poocha tha to sab se pehle apko bata raha hun. Seat chahiye to reply kar dein, ` +
    `main details bhej deta hun.`
  );
}
