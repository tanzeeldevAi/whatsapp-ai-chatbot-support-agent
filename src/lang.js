/**
 * Which language did they actually write in?
 *
 * This is a hint for the model, not a decision it has to obey — the persona
 * tells it to mirror the person regardless. The hint matters because a very
 * short message ("ok", "thanks") carries no signal at all, and without a
 * remembered preference the bot would flip languages mid conversation, which
 * no human does.
 */

const URDU_SCRIPT = /[؀-ۿݐ-ݿ]/;

/**
 * Words that appear in Roman Urdu and essentially never in English.
 * Deliberately excludes ambiguous short tokens: "me", "hi", "so", "ka" as an
 * initialism, and anything that is also an English word.
 */
const URDU_WORDS = new Set([
  'kya', 'kia', 'kyu', 'kyun', 'kiun', 'kese', 'kaise', 'kaisay', 'kab', 'kb', 'kahan', 'kahaan',
  'hai', 'hy', 'hain', 'hein', 'ha', 'han', 'haan', 'nahi', 'nhi', 'nai', 'nahin',
  'aap', 'ap', 'apka', 'apki', 'apko', 'mera', 'meri', 'mere', 'mujhe', 'mujhy', 'muje',
  'humara', 'hamara', 'hamari', 'tum', 'unka', 'iska', 'uska',
  'krna', 'karna', 'kro', 'karo', 'karein', 'krein', 'kar', 'kiya', 'kar_rha', 'krta', 'karta',
  'raha', 'rha', 'rhi', 'rahi', 'gaya', 'gya', 'gyi', 'hoga', 'hogi', 'hoge', 'hojaye', 'jaye',
  'batao', 'bta', 'btao', 'bataye', 'batayen', 'batadein', 'sunain', 'sunye',
  'acha', 'achha', 'theek', 'thek', 'thk', 'sahi', 'bilkul', 'zaroor', 'zarur',
  'thora', 'thora_sa', 'zyada', 'ziada', 'bohat', 'bhut', 'bahut', 'buhat',
  'chahiye', 'chahiyay', 'chaiye', 'chahye', 'lekin', 'magar', 'phir', 'fir', 'abhi', 'abi',
  'sirf', 'bhi', 'bhai', 'yar', 'yaar', 'ji', 'shukriya', 'jazakallah',
  'samajh', 'samjh', 'seekh', 'sikha', 'sikhna', 'padh', 'parh', 'likh',
  'kaam', 'kam_krna', 'baat', 'bat', 'masla', 'maslay', 'mushkil', 'pareshan',
  'wala', 'wali', 'walay', 'wale', 'jab', 'tab', 'agar', 'warna', 'kuch', 'koi', 'kisi',
  'batch', 'daakhla', 'dakhla', 'fees', 'shuru', 'start_hoga',
  'salam', 'assalam', 'assalamualaikum', 'walaikum', 'walaikumsalam', 'aoa',
]);

/** Very common English function words, used only as a counterweight. */
const ENGLISH_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'what', 'when', 'where',
  'how', 'why', 'can', 'could', 'would', 'should', 'will', 'have', 'has', 'had', 'does', 'did',
  'you', 'your', 'my', 'our', 'their', 'and', 'but', 'for', 'with', 'from', 'about', 'please',
  'want', 'need', 'know', 'tell', 'help', 'start', 'starting', 'question', 'thanks', 'thank',
]);

export const LANGS = {
  roman_urdu: 'Roman Urdu',
  urdu_script: 'Urdu script',
  english: 'simple English',
};

/**
 * @returns {'roman_urdu'|'urdu_script'|'english'|null} null when the message
 *          is too short or too neutral to tell, so the caller keeps the
 *          language it already knows for this contact.
 */
/**
 * A bare greeting is short enough to fall through every other rule, and the
 * language it is in is not in doubt. "Hi" was getting a Roman Urdu reply
 * because it is two letters and matched nothing.
 */
const ENGLISH_GREETING = /^[\s\p{P}]*(hi+|hello+|hey+|good (morning|evening|afternoon))[\s\p{P}]*$/iu;
const URDU_GREETING = /^[\s\p{P}]*(a?s+alam[a-z ]*|salam|slam|aoa|salaam|walaikum[a-z ]*)[\s\p{P}]*$/iu;

export function detectLang(text) {
  const raw = String(text || '');
  if (URDU_SCRIPT.test(raw)) return 'urdu_script';
  if (ENGLISH_GREETING.test(raw)) return 'english';
  if (URDU_GREETING.test(raw)) return 'roman_urdu';

  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return null;

  let urdu = 0;
  let english = 0;
  for (const w of words) {
    if (URDU_WORDS.has(w)) urdu += 1;
    else if (ENGLISH_WORDS.has(w)) english += 1;
  }

  // One unmistakable Urdu word beats several shared ones. "sir kab start hoga"
  // is Roman Urdu even though "sir" and "start" are English spellings.
  if (urdu > 0 && urdu >= english) return 'roman_urdu';
  if (english >= 2) return 'english';
  if (urdu > 0) return 'roman_urdu';

  // Two or three neutral words. Not enough to decide.
  return words.length >= 4 ? 'english' : null;
}

/** The sticky version: this message if it is clear, otherwise what we knew. */
export function resolveLang(text, remembered) {
  return detectLang(text) || remembered || 'roman_urdu';
}

export const langLabel = (key) => LANGS[key] || LANGS.roman_urdu;
