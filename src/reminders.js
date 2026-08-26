/**
 * The "support has ended, use the group" line, as a guaranteed afterthought.
 *
 * The persona asks the model to add this itself, and sometimes it does. But
 * tested against the real model it dropped it repeatedly — the same prompt
 * also says "one or two short lines", and that instruction wins. Since the
 * reminder is the entire reason old students are being answered on a number
 * where support has ended, "sometimes" is not good enough.
 *
 * So when the model leaves it out, it is sent as a **second message** a few
 * seconds later instead of being glued onto the first.
 *
 * That is not a workaround, it is the better shape. Answer first, then the
 * afterthought, is exactly how a person types this on WhatsApp — and it keeps
 * the reminder out of the sentence that actually helps them.
 *
 * Six phrasings per language, picked at random and never the same one twice
 * in a row for the same person, because one fixed sentence arriving verbatim
 * is what a machine sounds like.
 */

const VARIANTS = {
  roman_urdu: [
    'Waise ab WhatsApp pe support close ho chuki hai, aage koi bhi sawal ho to FB group me daal dein',
    'Ek baat, WhatsApp support to ab band ho gayi hai, next time group me pooch lijiye ga',
    'Aage se group me pooch lein, wahan sab log jawab de dete hain',
    'Ye WhatsApp wala support ab end ho chuka hai, group me post karein to jawab bhi jaldi milta hai',
    'Waise ab yahan support nahi rahi, group me pooch lein to behtar hai',
    'Aage ke sawal FB group me kar lein, main yahan regular nahi dekh pata ab',
  ],
  english: [
    'By the way WhatsApp support has closed now, the Facebook group is where these get answered',
    'One thing, support on WhatsApp has ended, so post the next one in the group',
    'Ask the next one in the student group, everyone answers there',
    'This WhatsApp support is finished now, you will get a faster answer in the group',
    'From now on the group is the place for these, I am not on here much anymore',
    'Just so you know, support here has ended, the Facebook group is the place now',
  ],
  urdu_script: [
    'ویسے اب واٹس ایپ پر سپورٹ بند ہو چکی ہے، آگے کوئی سوال ہو تو گروپ میں پوچھ لیں',
    'ایک بات، واٹس ایپ سپورٹ ختم ہو گئی ہے، اگلی بار گروپ میں پوچھیے گا',
    'آگے سے گروپ میں پوچھ لیں، وہاں سب جواب دیتے ہیں',
    'یہ واٹس ایپ والی سپورٹ اب ختم ہے، گروپ میں پوسٹ کریں تو جواب جلدی ملتا ہے',
    'اب یہاں سپورٹ نہیں رہی، گروپ میں پوچھنا بہتر ہے',
    'آگے کے سوال گروپ میں کر لیں، میں یہاں اب باقاعدہ نہیں دیکھ پاتا',
  ],
};

/**
 * @param {'roman_urdu'|'english'|'urdu_script'} lang
 * @param {string} [groupLink]  appended when one is configured
 * @param {string} [avoid]      the line this person got last time
 */
export function reminderLine(lang, groupLink, avoid) {
  const list = VARIANTS[lang] || VARIANTS.roman_urdu;
  const choices = list.filter((l) => l !== avoid);
  const pick = choices[Math.floor(Math.random() * choices.length)] || list[0];
  return groupLink ? `${pick}\n${groupLink}` : pick;
}

export const _variants = VARIANTS;
