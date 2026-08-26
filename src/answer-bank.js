/**
 * THE ANSWER BANK. Approved text, and the only text that goes out.
 *
 * This is the change that ends the whole class of failure we spent a day
 * chasing. Until now the model wrote the reply, and every time it did not
 * know something it filled the gap: "DFAA" (an acronym that does not exist),
 * "log in to hotsster" (a product that does not exist), "I'll be there at
 * 6:30 Saudi time" (a meeting nobody agreed). Each fix closed one hole in a
 * wall made entirely of holes.
 *
 * So the model's job is cut in half. It keeps the half it is genuinely good
 * at and loses the half that hurts:
 *
 *   UNDERSTANDING   read the message, in any phrasing, any script, from a
 *                   voice note, with typos, and decide WHICH answer applies.
 *   WRITING         never. The words below are written by a person and go
 *                   out unchanged.
 *
 * It is a multiple-choice question, not a blank page. "Course kab start
 * hoga", "when is the new batch", "batch ka kya scene hai" and a voice note
 * asking the same all land on `batch-when`. Full understanding, and nothing
 * invented, because there is nowhere to invent into.
 *
 * The worst outcome becomes picking answer 3 when 7 fitted better — an
 * approved sentence, merely not the best one. Recoverable, and visible.
 * Compare that with being told to log in to a website that does not exist.
 *
 * And it is measurable, which free writing never was: run real messages
 * against it and count. A number can be shown to somebody before go-live.
 *
 * ── growing it ───────────────────────────────────────────────
 * The bank does not have to be complete to be useful. Anything it cannot
 * place goes to the owner, he answers once, and `learn()` stores his words —
 * which then become a candidate here. The bank fills itself from his own
 * replies, in his own voice, and every question only reaches his phone once.
 */

export const ANSWERS = [
  /* ── the next batch ─────────────────────────────────────── */
  {
    id: 'batch-when',
    ask: 'when the next batch / course starts, whether admissions are open, how to join',
    text:
      'Batch 3 is starting at the end of September. The course is being updated with new AI modules, ' +
      'which is why it moved a little. Registration opens with the announcement and I will message you the day it does.',
  },
  {
    id: 'batch-fee',
    ask: 'what the course fee is, the price, instalments, any discount',
    text: 'The full details including the fee come with the announcement.',
  },
  {
    id: 'batch-notify',
    ask: 'asking to be informed / added to a list when the batch opens',
    text: 'Of course. Send me your name and city and I will message you the day registration opens.',
  },

  /* ── what we do and do not run ──────────────────────────── */
  {
    id: 'other-courses',
    ask: 'whether there are other courses, a different course, internships',
    text:
      'Right now Local SEO is the only course we run, and there are no internships at the moment. ' +
      'Agentic AI is planned for later, inshaAllah, but nothing is open for registration yet.',
  },
  {
    id: 'course-covers',
    ask: 'what the course covers, syllabus, modules, what will be taught',
    text:
      'The course covers Google Business Profile from setup to optimisation, WordPress web design, ' +
      'content writing, on page and off page SEO, client hunting, and AI modules. ' +
      'Full details come with the announcement.',
  },
  {
    id: 'course-recordings',
    ask: 'whether recordings are available, can they watch later, are classes live',
    text: 'Classes are live and the recordings stay available in the LMS afterwards.',
  },

  /* ── support ────────────────────────────────────────────── */
  {
    id: 'support-open',
    ask: 'whether support is available, can they ask questions, is anyone there',
    text: 'Yes, support is open here for everyone. Please ask whatever you need.',
  },

  /* ── what ended with Batch 2 ────────────────────────────── */
  {
    id: 'hosting-ended',
    ask: 'about the free hosting from the batch, whether hosting is still free',
    text:
      'The free hosting was for the length of the batch and that has finished. ' +
      'Let me confirm what the options are now and come back to you.',
  },
];

/* ── choosing one ────────────────────────────────────────────
   The prompt the model actually sees. Deliberately a list of intents, not
   the answer text: it decides what is being ASKED, and the wording it would
   otherwise be tempted to copy or improve on is never in front of it. */

export function choicePrompt(taught = []) {
  const rows = [
    ...ANSWERS.map((a) => `${a.id} = ${a.ask}`),
    ...taught.map((t) => `${t.id} = ${t.ask}`),
  ];

  return `You are matching a message to one approved answer. You do not write answers.

THE OPTIONS
${rows.join('\n')}
none = nothing above genuinely fits

HOW TO CHOOSE
Read what they are actually asking, not the words they used. The same question arrives in English, Roman Urdu, Urdu script, in a voice note, with typos and in half sentences — "course kab start hoga", "when is the new batch", "batch ka kya scene hy" are all the same question.

Choose "none" whenever you are not sure. That is not a failure, it is the correct answer for anything outside this list — a technical question, something personal, a complaint, anything about their own site. Those reach a person instead, which is better for them than an answer that nearly fits.

Never invent an option that is not listed.

Reply with JSON only:
{"id": "<one id from the list, or none>", "sure": <0 to 100, how certain you are>}`;
}

/** The approved text for an id, or null. */
export const answerFor = (id, taught = []) =>
  ANSWERS.find((a) => a.id === id)?.text ?? taught.find((t) => t.id === id)?.text ?? null;

/**
 * Below this, nothing goes out.
 *
 * A near miss is the one bad outcome this design still allows, and the
 * threshold is what keeps it rare. Sending an approved answer to a question
 * it does not fit is still a wrong answer.
 */
export const SURE_ENOUGH = 70;
