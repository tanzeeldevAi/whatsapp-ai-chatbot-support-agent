/**
 * How Roman Urdu is actually typed on this number.
 *
 * Every entry below is a count, not an opinion. Measured across 21,881 real
 * replies pulled off the account — see `data/mined/style.md`, regenerate it
 * with `npm run mine`.
 *
 * That matters, because the first version of this file was written from a
 * single screenshot and got five of its rules backwards. It rewrote "karein"
 * to "krein" (he writes karein 1447 times and krein 128), "chahiye" to
 * "chahye" (86 against 6), "zaroori" to "zaruri" (34 against 1), "karke" to
 * "krke" (178 against 1), and "batayein" to "btayen" — a word he has never
 * once typed in the short form. It was making his own writing less like him.
 *
 * So the rule for editing this file is simple: check the counts first. If a
 * pair is not in style.md with a clear winner, leave it out.
 */

// long form → short form. Only where the short form actually wins the count.
const MAP = {
  // 5739 vs 2258
  aap: 'ap',
  aapka: 'apka',
  aapki: 'apki',
  aapko: 'apko',
  aapke: 'apke',
  aapse: 'apse',
  aapne: 'apne',

  // 4245 vs 3612
  hai: 'hy',

  // 1502 vs 776
  nahi: 'nhi',
  nahin: 'nhi',

  // 1171 vs 938
  kya: 'kia',

  // 1199 vs 33
  yeh: 'ye',
  woh: 'wo',

  // 762 vs 397
  karna: 'krna',
  karni: 'krni',
  karne: 'krne',

  // 33 vs 20
  poochh: 'poch',
  poohch: 'poch',
  pooch: 'poch',

  // 15 vs 3
  bataye: 'btaye',

  // 17 vs 3
  kaise: 'kese',
};

/*
 * Deliberately NOT rewritten, because he writes the long form far more often:
 *
 *   karein  1447 : 128   krein
 *   karke    178 :   1   krke
 *   chahiye   86 :   6   chahye
 *   theek    222 :  12   thek
 *   sakte    348 :   0   skte
 *   zaroori   34 :   1   zaruri
 *   bohat     24 :   4   bht
 *   dekhein   22 :   2   dekhen
 *   hain    2834 :1490   hn
 *   batayein   3 :   0   btayen
 *
 * Leaving them alone is the whole point. A rule that "corrects" him into
 * something he never writes is worse than no rule.
 */

/**
 * Hindi vocabulary, which is not the same language.
 *
 * Models trained heavily on Hindi produce Devanagari-derived words in Roman
 * script and they read as obviously foreign to an Urdu speaker: "Batch 3 ki
 * SHURUAT ki TARIKH September ke ANT me". Correct Hindi, wrong for this
 * number.
 *
 * Checked against 2.46 million characters of his own replies with
 * `npm run wordcheck`: every word on the left appears **zero** times. Every
 * replacement on the right is one he actually uses — please 1897, use 988,
 * start 455, option 316, date 184, end 169, sirf 164, pehle 129.
 *
 * That last part is the other half of the instruction. He does not swap Hindi
 * for heavy Urdu, he swaps it for **English**, which is what keeps it sounding
 * professional rather than translated.
 */
const HINDI = {
  shuruat: 'start', shuruaat: 'start', prarambh: 'start',
  tarikh: 'date', dinank: 'date',
  ant: 'end', samapt: 'khatam',
  jankari: 'maloomat', suchna: 'maloomat',
  samasya: 'masla', kathinai: 'mushkil',
  upyog: 'use', prayog: 'use', istemal: 'use',
  adhik: 'zyada', jyada: 'zyada',
  keval: 'sirf', matra: 'sirf',
  prakar: 'tarah',
  uttar: 'jawab',
  prashn: 'sawal',
  aavashyak: 'zaroori', avashyak: 'zaroori', anivarya: 'zaroori',
  sthan: 'jagah',
  vikalp: 'option',
  sahayata: 'madad', sahyog: 'madad',
  dhanyavad: 'shukriya', dhanyavaad: 'shukriya',
  kripya: 'please', krupya: 'please',
  parantu: 'lekin', kintu: 'lekin',
  vartaman: 'mojooda',
  sambandh: 'taluq',
  vishesh: 'khaas',
  sambhav: 'mumkin',
  nishchit: 'pakka',
  uplabdh: 'available',
  samay: 'waqt',
  karan: 'wajah', kaaran: 'wajah',
  uddeshya: 'maqsad',
  anubhav: 'tajurba',
  gyan: 'ilm',
  shiksha: 'taleem',
  abhyas: 'practice',
  vikas: 'development',
  prabhav: 'asar',
  sthiti: 'halat',
  badlav: 'tabdeeli', parivartan: 'tabdeeli',
  chayan: 'selection',
  madhyam: 'zariye',
  yadi: 'agar',
  tatha: 'aur', evam: 'aur',
  athva: 'ya',
  namaste: 'assalam o alaikum',
  swagat: 'khush aamdeed',
};

/**
 * The informal imperative, which is the one tone mistake he named directly:
 * "ap use karein ge, respect dain ge". The model still slips into it —
 * "abhi apke naam aur shahar **bata do**" went out live.
 *
 * These are whole phrases rather than single words, because "do" and "karo"
 * on their own appear inside perfectly fine sentences.
 */
const RESPECT = [
  [/\bbata\s?do\b/gi, 'bta dein'],
  [/\bbatao\b/gi, 'btayen'],
  [/\bbtao\b/gi, 'btayen'],
  [/\bkar\s?do\b/gi, 'kar dein'],
  [/\bkr\s?do\b/gi, 'kr dein'],
  [/\bkaro\b/gi, 'karein'],
  [/\bkro\b/gi, 'karein'],
  [/\bde\s?do\b/gi, 'de dein'],
  [/\bdedo\b/gi, 'de dein'],
  [/\bbhejo\b/gi, 'bhej dein'],
  [/\bdekho\b/gi, 'dekhein'],
  [/\bsuno\b/gi, 'sunein'],
  [/\ble\s?lo\b/gi, 'le lein'],
  [/\blelo\b/gi, 'le lein'],
  [/\bjao\b/gi, 'jayen'],
  [/\baao\b/gi, 'aayen'],
  [/\btum\b/gi, 'ap'],
  [/\btumhara\b/gi, 'apka'],
  [/\btumhein\b/gi, 'apko'],
  [/\btumhe\b/gi, 'apko'],
];

const RULES = Object.entries({ ...MAP, ...HINDI }).map(([from, to]) => [
  new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
  to,
]);

export const _hindi = HINDI;

/** Keep the writer's capitalisation when swapping a word at a sentence start. */
const matchCase = (original, replacement) =>
  original[0] === original[0].toUpperCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;

/**
 * @param {string} text
 * @param {'roman_urdu'|'english'|'urdu_script'} lang
 */
export function shorten(text, lang) {
  if (lang !== 'roman_urdu') return text;
  let out = String(text || '');
  for (const [rx, to] of RULES) out = out.replace(rx, (m) => matchCase(m, to));
  // Respect last, so it also catches anything the swaps above produced.
  for (const [rx, to] of RESPECT) out = out.replace(rx, (m) => matchCase(m, to));
  return out;
}

export const _map = MAP;
