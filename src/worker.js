import { config } from './config.js';
import {
  addMessage,
  contactsDueForFollowup,
  contactsDueForReply,
  getMessages,
  getSettings,
  pushOpener,
  replyTo,
  unansweredInbound,
  updateContact,
} from './db.js';
import { think } from './brain.js';
import { bubbles, waitFor } from './humanize.js';
import { followupText } from './followups.js';
import { forwardToOwner, logEvent } from './notify.js';

/* How many times we have failed to answer this contact, in memory only.
   A restart clears it, which is the right default: after a restart the
   thing that was failing is usually the thing that was restarted. */
const attempts = new Map();
import { sendText, startTyping } from './wa.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The global switch, checked on every reply rather than cached at boot, so
 * `off` sent from your phone takes effect on the very next message instead of
 * after a restart.
 */
const botIsOn = () => config.botEnabled && getSettings().bot !== 'off';

/* ── the clock ───────────────────────────────────────────── */

const hourIn = (ts) =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: config.timezone,
    }).format(new Date(ts))
  );

const isDaytime = (ts = Date.now()) => {
  const h = hourIn(ts);
  return h >= config.dayStart && h < config.dayEnd;
};

/**
 * A reply that lands at 4 AM is the loudest tell there is — no human runs a
 * support number at that hour, and everyone who gets one knows it. So the
 * message waits for morning, with a random spread so twenty people are not
 * all answered at 09:00:00.
 */
function nextMorning() {
  for (let i = 1; i <= 24; i++) {
    const t = Date.now() + i * 3600000;
    if (hourIn(t) === config.dayStart) {
      return t - new Date(t).getMinutes() * 60000 + Math.floor(Math.random() * 40 * 60000);
    }
  }
  return Date.now() + 3600000;
}

/* ── sending ─────────────────────────────────────────────── */

/**
 * One reply, delivered the way a person delivers it: a pause while they
 * "type", then the message, then sometimes a short afterthought.
 */
async function deliver(contact, text, { sender = 'bot', since = null, afterthought = null } = {}) {
  const parts = bubbles(text);
  // The support-ended reminder rides as a separate message rather than being
  // glued to the answer. Answer first, afterthought second, is how a person
  // types this — and it keeps the reminder out of the sentence that helps.
  if (afterthought) parts.push(afterthought);
  const { sleep: wait } = waitFor(parts[0], since);

  // Real "typing…" for the whole pause, refreshed under the ten second
  // expiry. `stop` runs even if the send throws, because leaving somebody
  // watching "typing…" forever is worse than a slow reply.
  const stop = startTyping(replyTo(contact));
  try {
    await sleep(wait);
    for (const [i, part] of parts.entries()) {
      if (i > 0) await sleep(config.bubbleGapMs + Math.floor(Math.random() * 1200));
      const waMessageId = await sendText(replyTo(contact), part);
      addMessage(contact.id, { direction: 'out', sender, body: part, waMessageId });
    }
  } finally {
    stop();
  }
}

function pause(contact, reason) {
  updateContact(contact.id, {
    bot_enabled: 0,
    paused_by: 'bot',
    reply_due_at: null,
    next_followup_at: null,
  });
  addMessage(contact.id, { direction: 'out', sender: 'system', body: `[bot paused] ${reason}` });
  logEvent({ event: 'needs_you', contact, note: `Bot stopped here: ${reason}`, force: true });
}

/* ── 1. the delayed reply ────────────────────────────────── */

async function handleDueReply(contact) {
  // Clear the timer before anything slow happens, so a long model call can
  // never let the next tick pick the same person up twice.
  updateContact(contact.id, { reply_due_at: null });

  if (!botIsOn() || !contact.bot_enabled) return;

  if (config.quietHours && !isDaytime()) {
    const at = nextMorning();
    updateContact(contact.id, { reply_due_at: at });
    console.log(`[worker] holding reply to ${contact.wa_id} until ${new Date(at).toISOString()}`);
    return;
  }

  const incoming = unansweredInbound(contact.id);
  if (!incoming.trim()) return;

  const history = getMessages(contact.id, 24);
  const decision = await think(contact, incoming, history);
  if (!decision) return;

  /* Not ours. Nothing is sent to them at all — that is the instruction, and
     it is the right one: an unknown company pitched by a bot is worse than
     an unanswered message. It goes to the owner with the number attached, and
     the bot stays out of that chat until he hands it back. */
  if (decision.forward) {
    updateContact(contact.id, {
      lang: decision.lang,
      // `kind` is left alone. A student who asks one thing we cannot answer
      // is still a student, and relabelling them would send their next
      // question down the wrong branch.
      //
      // paused_by 'bot' rather than 'human': the bot took itself out for this
      // one message, so it comes back on its own the moment they say anything
      // else. Only the owner replying unprompted retires it for good.
      bot_enabled: 0,
      paused_by: 'bot',
      reply_due_at: null,
      next_followup_at: null,
    });
    addMessage(contact.id, {
      direction: 'out',
      sender: 'system',
      body: `[forwarded, not answered] ${decision.why || 'off topic'}`,
    });
    await forwardToOwner({ contact, body: incoming, why: decision.why });
    console.log(`[worker] forwarded +${contact.wa_id} to you (${decision.why})`);
    return;
  }

  /* The bot failed, which is not the same as the question needing the owner.
     Rate limited, or an answer that failed its own check — go round again in
     a couple of minutes rather than putting it on his phone. Only after
     three tries is it his problem, and by then it genuinely is.

     Nothing is sent to the person while this happens. They see blue ticks
     and then, shortly, a real answer. See `retry` in brain.js. */
  if (decision.retry) {
    const tries = (attempts.get(contact.id) || 0) + 1;
    if (tries < 3) {
      attempts.set(contact.id, tries);
      updateContact(contact.id, { reply_due_at: Date.now() + 110000, unread: 1 });
      console.log(`[worker] +${contact.wa_id} try ${tries}/3 (${decision.why}), going again shortly`);
      return;
    }
    attempts.delete(contact.id);
    console.warn(`[worker] +${contact.wa_id} failed 3 times, over to you (${decision.why})`);
    updateContact(contact.id, {
      unread: 0, bot_enabled: 0, paused_by: 'bot', reply_due_at: null, next_followup_at: null,
    });
    addMessage(contact.id, {
      direction: 'out', sender: 'system',
      body: `[forwarded after 3 failed tries] ${decision.why}`,
    });
    await forwardToOwner({ contact, body: incoming, why: decision.why });
    return;
  }
  attempts.delete(contact.id);

  try {
    // Measured from their message, so the bundling wait and the model call
    // come out of the same budget instead of stacking on top of it.
    await deliver(contact, decision.text, {
      since: contact.last_inbound_at,
      afterthought: decision.afterthought,
    });
  } catch (err) {
    console.error(`[worker] send failed for ${contact.wa_id}:`, err.message);
    pause(contact, `WhatsApp refused the message: ${err.message}`);
    return;
  }

  const fields = { ...decision.updates };
  delete fields.openers;
  if (decision.firstWord) fields.openers = pushOpener(contact, decision.firstWord);
  if (decision.reminderSent) {
    fields.reminder_sent_at = Date.now();
    // Remembered so this person never gets the same phrasing twice.
    if (decision.afterthought) fields.last_reminder_line = decision.afterthought.split(/\n/)[0];
  }
  fields.unread = 0;

  // Only a new enquiry is worth chasing, and only while the bot still owns
  // the conversation.
  if (decision.audience === 'enquiry' && !decision.handoff) {
    fields.followup_count = 0;
    fields.next_followup_at = Date.now() + config.followupHours[0] * 3600000;
  } else {
    fields.next_followup_at = null;
  }

  if (decision.handoff) {
    fields.bot_enabled = 0;
    // The bot stopped itself, so it is allowed to start again when they come
    // back. Only you replying by hand makes that permanent.
    fields.paused_by = 'bot';
    fields.next_followup_at = null;
  }

  updateContact(contact.id, fields);

  /* A handover is a promise to come back with an answer, so it has to arrive
     somewhere the owner can actually answer it from. The activity feed alone is
     not that: it says what happened and leaves him to open a chat and type a
     number. This puts the question in front of him with the sender attached
     and a reply route straight back into their chat. */
  if (decision.handoff) {
    await forwardToOwner({
      contact,
      body: incoming,
      why: decision.askOwner || 'the bot handed this over',
    }).catch((err) => console.warn('[worker] could not forward the handover:', err.message));
  }

  logEvent({
    event: decision.handoff ? 'needs_you' : 'exchange',
    contact: { ...contact, ...fields },
    inbound: incoming,
    outbound: decision.text,
    note: [
      // Not "a holding line went out" any more — there is no holding line.
      // A reply that did not come from the model came from the known facts,
      // which is a better answer, not a worse one.
      decision.viaAI ? null : 'Answered from the facts, without the model.',
      decision.handoff ? 'Over to you.' : null,
      decision.reminderSent ? 'Group reminder included.' : null,
    ]
      .filter(Boolean)
      .join(' ') || null,
    force: decision.handoff,
  });
}

/* ── 2. the chase ────────────────────────────────────────── */

async function handleFollowup(contact) {
  updateContact(contact.id, { next_followup_at: null });

  if (!botIsOn() || !contact.bot_enabled) return;
  if (contact.kind !== 'enquiry') return;

  // They answered after our last message, so they are not silent.
  if (contact.last_inbound_at && contact.last_outbound_at && contact.last_inbound_at > contact.last_outbound_at) {
    return;
  }

  const index = contact.followup_count ?? 0;
  const body = followupText(contact.lang || 'roman_urdu', index);
  if (!body) return; // sequence finished, stop permanently

  if (config.quietHours && !isDaytime()) {
    updateContact(contact.id, { next_followup_at: nextMorning() });
    return;
  }

  try {
    // No 24 hour window to work around: a linked device can message anyone
    // it has a chat with, whenever it likes.
    await deliver(contact, body);
  } catch (err) {
    console.error(`[worker] follow-up failed for ${contact.wa_id}:`, err.message);
    pause(contact, `follow-up failed: ${err.message}`);
    return;
  }

  const next = index + 1;
  updateContact(contact.id, {
    followup_count: next,
    next_followup_at: config.followupHours[next]
      ? Date.now() + config.followupHours[next] * 3600000
      : null,
  });

  logEvent({
    event: 'followup',
    contact,
    outbound: body,
    note: `Chase ${next} of ${config.followupHours.length}. No reply since our last message.`,
  });
}

/* ── the loop ────────────────────────────────────────────── */

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    for (const c of contactsDueForReply()) await handleDueReply(c);
    for (const c of contactsDueForFollowup()) await handleFollowup(c);
  } catch (err) {
    console.error('[worker] tick error:', err);
  } finally {
    running = false;
  }
}

export function startWorker() {
  setInterval(tick, config.tickMs);
  const s = getSettings();
  console.log(
    `[worker] running · tick ${config.tickMs}ms · base delay ${config.replyDelayMs / 1000}s · ` +
      `quiet hours ${config.quietHours ? `${config.dayStart}-${config.dayEnd} ${config.timezone}` : 'off'}` +
      (s.batch ? ` · batch override: "${s.batch}"` : '')
  );
}

export const _internals = { isDaytime, nextMorning };
