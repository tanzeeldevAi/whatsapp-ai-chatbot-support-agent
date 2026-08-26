/**
 * Things the bot may not say it has done.
 *
 * A prospective student asked to be told when the batch opens and was
 * answered "Haan, apka name aur city note kr liya hy" — three times, without
 * ever having given a name or a city. Then he sent them, and was told
 * "we already have your name and city noted".
 *
 * The bot has no way to note anything down beyond what is in the contact
 * record, so the claim was invented. That is worse than an unhelpful answer:
 * somebody is now waiting for a message that was never going to come.
 *
 * The prompt asks it not to. This makes sure, the same way `CLAIMS_HUMAN`
 * does — by checking the words on the way out, against what we actually hold.
 */

const CLAIMED = [
  // Roman Urdu
  /\b(note|save|likh|add|record)\w*\s+(kar|kr)\s?(li|liya|liye|di|diya|dia|dein)\w*/i,
  /\b(naam|name|city|shehar|shahar)[^.!?]{0,30}\b(note|save|likh|add)\w*/i,
  /\blist\s+(me|mein|main)\s+(daal|add|shamil)\w*\s+(kar|kr)\s?(li|diya|dia)\w*/i,
  // English
  /\bi\s+have\s+(noted|saved|recorded|added|got)\b/i,
  /\b(we|i)\s+(already\s+)?have\s+(your|the)\s+(name|details|number|city)\b/i,
  /\byour\s+(name|details)[^.!?]{0,25}\b(noted|saved|recorded|added)\b/i,
  /\b(noted|saved|added)\s+(your|the)\s+(name|details|city)\b/i,
];

/** Does this reply claim we hold something? */
export const claimsRecorded = (text) => CLAIMED.some((rx) => rx.test(String(text || '')));

/**
 * Cut the claim out and leave the rest of the reply standing.
 *
 * Only the sentence carrying it goes. "Ji zaroor, announcement ke saath apko
 * bta denge" is a true and useful sentence that often sits right next to the
 * invented one, and there is no reason to lose it.
 */
export function stripClaim(text) {
  const sentences = String(text || '').match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const kept = sentences.filter((s) => !claimsRecorded(s));
  return kept.join('').replace(/\s+/g, ' ').trim();
}

/**
 * What to say instead.
 *
 * Replacing rather than deleting, because the invented claim and the true
 * part usually sit in one sentence — "apka name note kr liya hy, announcement
 * ke saath inform kr denge" — and cutting the clause takes the useful half
 * with it. This keeps the promise we can actually keep and asks for the thing
 * we would need in order to keep it.
 */
const INSTEAD = {
  roman_urdu:
    'Ji zaroor, announcement hote hi apko bta denge. Apna naam aur city bhej dein to list me daal deta hun.',
  english:
    'Of course, you will be told as soon as it is announced. Send me your name and city and I will put you on the list.',
  urdu_script:
    'جی ضرور، اعلان ہوتے ہی آپ کو بتا دیں گے۔ اپنا نام اور شہر بھیج دیں تو لسٹ میں ڈال دوں گا۔',
};

/**
 * @param {string} reply
 * @param {{name?: string|null, city?: string|null}} contact  what we really hold
 * @param {'roman_urdu'|'english'|'urdu_script'} lang
 * @returns {string} the reply, with any untrue claim dealt with
 */
export function honest(reply, contact = {}, lang = 'roman_urdu') {
  if (!claimsRecorded(reply)) return reply;

  // If we genuinely have both, the claim is true and may stand.
  if (contact.name && contact.city) return reply;

  console.warn('[claims] replaced a claim we could not back up');

  // Keep anything true that survives on its own; otherwise say the true thing.
  const cleaned = stripClaim(reply);
  const keptEnough = cleaned.split(/\s+/).filter(Boolean).length >= 6;
  return keptEnough ? cleaned : INSTEAD[lang] || INSTEAD.roman_urdu;
}

export const _internals = { CLAIMED };
