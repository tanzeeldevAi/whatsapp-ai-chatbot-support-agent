/**
 * Chasing a silent new-batch enquiry.
 *
 * Written by hand, not generated. A chase is the one message where sounding
 * eager costs you, and the model has no way of knowing that this person has
 * ignored you once already. Fixed words also mean the same person never gets
 * the same sentence twice.
 *
 * Students are never chased. They asked a question, they were answered, and
 * they were pointed at the group. Following that up would be strange.
 */

export const FOLLOWUPS = {
  roman_urdu: [
    'Ji batch ki update aa gayi to sab se pehle aap ko bata dunga. Koi aur sawal ho to poch lein.',
    'Bas confirm karne ke liye, aap ko next batch me interest hai na? Naam list me daal dun?',
  ],
  english: [
    'I will let you know as soon as the batch dates are confirmed. Anything else you wanted to ask?',
    'Just checking, are you still interested in the next batch? I can put your name down.',
  ],
  urdu_script: [
    'بیچ کی اپ ڈیٹ آتے ہی سب سے پہلے آپ کو بتا دوں گا۔ کوئی اور سوال ہو تو پوچھ لیں۔',
    'بس کنفرم کرنے کے لیے، اگلے بیچ میں دلچسپی ہے نا؟ نام لکھ لوں؟',
  ],
};

export function followupText(lang, index) {
  const list = FOLLOWUPS[lang] || FOLLOWUPS.roman_urdu;
  return list[index] || null;
}
