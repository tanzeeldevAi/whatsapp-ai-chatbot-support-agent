import { config } from './config.js';
import { rememberForward } from './db.js';
import { sendText, sendImage } from './link.js';

/**
 * The activity feed, delivered to the owner's own "Message yourself" chat.
 *
 * Fire and forget, always. If this fails, a person's reply must still go out
 * — the log is for him, and he is not the one waiting.
 *
 * There is no 24 hour window to worry about here. On the Cloud API the feed
 * was silently dropped whenever he had not messaged the bot in a day, which
 * looked exactly like the bot being dead. A linked device has no such rule.
 */

const ICON = {
  new_contact: '🆕',
  exchange: '💬',
  needs_you: '⚠️',
  followup: '🔔',
  failed: '❌',
  paused: '⏸️',
  resumed: '▶️',
};

const EVENTS_ONLY = new Set(['exchange']);

let selfNumber = () => null;
export const setSelfNumber = (fn) => {
  selfNumber = fn;
};

/** Where the feed goes: whoever is configured, or his own chat by default. */
function recipients() {
  if (config.logTo.length) return config.logTo;
  const own = selfNumber();
  return own ? [String(own).split('@')[0].split(':')[0]] : [];
}

const who = (c) =>
  [c?.name || c?.profile_name, c?.wa_id ? `+${c.wa_id}` : null].filter(Boolean).join(' ');

export function logEvent({ event, contact, inbound, outbound, note, force = false }) {
  const line = `${ICON[event] || '•'} ${event.replace(/_/g, ' ')}${contact ? ` · ${who(contact)}` : ''}`;
  console.log(`[event] ${line}${note ? ` · ${note}` : ''}`);

  if (!force && config.logLevel !== 'all' && EVENTS_ONLY.has(event)) return;

  const to = recipients();
  if (!to.length) return;

  const body = [
    line,
    contact?.kind ? `(${contact.kind})` : null,
    '',
    inbound ? `Them: ${trim(inbound)}` : null,
    outbound ? `Bot: ${trim(outbound)}` : null,
    note ? `\n${note}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n')
    .trim();

  for (const n of to) {
    sendText(n, body).catch((err) => console.warn(`[notify] ${n}: ${err.message}`));
  }
}

/**
 * Hand a message to the owner instead of answering it.
 *
 * The number goes in the text, not just the metadata, because he reads this
 * on a phone and needs to be able to act without opening anything. Replying
 * to this message on his phone sends whatever he writes straight to them —
 * that is the whole point, and it is why the id is recorded.
 */
export async function forwardToOwner({ contact, body, why, image = null }) {
  const to = recipients();
  if (!to.length) {
    console.warn('[notify] nothing to forward to, set CONTROL_NUMBERS or LOG_TO');
    return;
  }

  const name = contact.profile_name && contact.profile_name !== '.' ? ` (${contact.profile_name})` : '';
  const text = [
    // They have been sent nothing at all — no holding line, no "main poch ke
    // btata hun". The only message they will ever get about this is the one
    // written in reply to this, so the ask has to be unambiguous.
    '📨 Is ka koi jawab nahi bheja gaya. Aap batayen kya kehna hy.',
    '',
    `Se: +${contact.wa_id}${name}`,
    why ? `Wajah: ${why}` : null,
    '',
    `"${trim(body, 700)}"`,
    '',
    'IS message par reply krein, jo likhein ge bilkul wahi un ko chala jaye ga.',
    `Ya likhein: say ${contact.wa_id} <apka jawab>`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  for (const n of to) {
    try {
      /* The screenshot goes as the message, with all of the above as its
         caption. Sending it separately would give him two messages to reply
         to and only one of them routes back — see sendImage. If the picture
         fails for any reason, the text still goes: losing the image is a
         worse answer, losing the question is no answer at all. */
      let id = null;
      if (image) {
        try {
          id = await sendImage(n, image, text);
        } catch (err) {
          console.warn(`[notify] could not send the screenshot, sending text: ${err.message}`);
        }
      }
      if (!id) id = await sendText(n, text);
      rememberForward(id, contact.id, body);
    } catch (err) {
      console.warn(`[notify] forward to ${n} failed: ${err.message}`);
    }
  }
}

const trim = (s, n = 300) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
