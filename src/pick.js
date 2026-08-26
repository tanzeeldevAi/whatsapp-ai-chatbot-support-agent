/**
 * Ask the model which approved answer applies — and nothing else.
 *
 * This is the whole of the model's remaining job. It reads the message and
 * returns an id. It never sees the answer text it is choosing between, so
 * there is nothing to paraphrase, improve on, or blend into something new.
 *
 * Cheap as well as safe: the prompt is a short list of intents rather than
 * the whole syllabus, so it runs in a few hundred tokens instead of five
 * thousand. Rate limits stop being the thing that decides whether somebody
 * gets an answer.
 */

import { generate } from './ai.js';
import { choicePrompt, answerFor, SURE_ENOUGH } from './answer-bank.js';
import { taughtAnswers } from './knowledge-base.js';

/**
 * @param {string} text  what they wrote
 * @returns {Promise<{text: string, id: string} | null>} the approved answer,
 *          or null when nothing fits well enough and a person should see it.
 */
export async function pickAnswer(text) {
  const taught = taughtAnswers();

  const raw = await generate(choicePrompt(taught), `Their message:\n${text}\n\nWhich one?`);
  if (!raw) return null;

  /* `generate` returns the parsed object. It is shaped for the old reply
     format, so the id can arrive on any of these depending on how the
     model filled it in. Read them all rather than trusting one. */
  const id = String(raw.id || raw.reply || raw.answer || '').trim().toLowerCase();
  const sure = Number(raw.sure ?? raw.confidence ?? 0);

  if (!id || id === 'none') {
    console.log(`[pick] nothing fits "${text.slice(0, 40)}", sending it to you`);
    return null;
  }

  if (!Number.isFinite(sure) || sure < SURE_ENOUGH) {
    console.log(`[pick] "${id}" but only ${sure}% sure, not sending it`);
    return null;
  }

  const answer = answerFor(id, taught);
  if (!answer) {
    // It invented an id. Rare, and exactly why the text is looked up rather
    // than taken from the model.
    console.warn(`[pick] "${id}" is not an answer we have`);
    return null;
  }

  console.log(`[pick] ${id} (${sure}%)`);
  return { text: answer, id };
}
