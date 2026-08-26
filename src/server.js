import http from 'node:http';
import { assertConfig, config } from './config.js';
import {
  addMessage,
  alreadySeen,
  forwardTarget,
  getContact,
  getMessages,
  getContactByWaId,
  isIgnored,
  replyTo,
  stats,
  updateContact,
  upsertContact,
} from './db.js';
import { transcribe } from './ai.js';
import { handleOwnerCommand } from './commands.js';
import {
  connect, downloadImage, downloadVoice, isArchived, kindOf, markRead, myNumber, qrDataUri,
  sendText, startTyping, textOf, toNumber,
} from './link.js';
import { forwardToOwner, logEvent, setSelfNumber } from './notify.js';
import { learn } from './knowledge-base.js';
import { lookupStudent, normalize, rosterSize } from './students.js';
import { startWorker } from './worker.js';
import { start as startArchive, progress as archiveProgress } from './archive.js';

assertConfig();

/**
 * Stay up.
 *
 * A bot that exits on an unhandled rejection is a bot that is offline until
 * somebody notices. Docker would restart it, but a restart during linking
 * invalidates the code the person is halfway through typing — which is
 * exactly how three linking attempts were lost. Log it and keep running.
 */
process.on('unhandledRejection', (err) =>
  console.error('[fatal-ish] unhandled rejection:', err?.message || err)
);
process.on('uncaughtException', (err) =>
  console.error('[fatal-ish] uncaught exception:', err?.message || err)
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── someone messaged the business ───────────────────────── */

/**
 * the owner answering a forwarded message by replying to it on his phone.
 *
 * This is the whole point of forwarding rather than just logging: he sees
 * "message from +9230…", replies to it the way he replies to anything, and
 * what he wrote goes to that person. No commands, no numbers to copy.
 *
 * @returns {Promise<boolean>} whether it was handled here
 */
async function relayFromControl(text, quoted, from) {
  // Only ever on a real quoted reply to a real forward. Without that anchor
  // a plain "ok" from his own number would be relayed to a stranger instead
  // of being read as a command, which is the kind of mistake that only shows
  // up once it has already happened.
  const target = quoted ? forwardTarget(quoted) : null;
  if (!target) return false;

  const body = String(text || '').trim();
  if (!body) return false;

  try {
    const id = await sendText(replyTo(target), body);
    addMessage(target.id, { direction: 'out', sender: 'human', body, waMessageId: id });

    /* The bot stays ON here, which is the opposite of what happens when he
       answers somebody unprompted.
       The difference is who started it. A reply he types into a chat by
       himself means he has taken that conversation over. A reply to a
       forward is him answering a question the bot asked him — the bot is
       still running the conversation, it just needed one fact. If the next
       message is a different question it gets answered normally, and if it
       is another one the bot cannot place, it forwards again. */
    updateContact(target.id, {
      bot_enabled: 1,
      paused_by: null,
      reply_due_at: null,
      next_followup_at: null,
    });
    /* Learn it. He answered this once; the next person asking the same thing
       should be answered rather than sent to his phone again. */
    const learned = learn(target.forwardedQuestion, body);
    console.log(`[relay] your reply sent to +${target.wa_id}${learned ? ', and learned' : ''}`);
    await sendText(
      from,
      `Bhej diya +${target.wa_id} ko.${learned ? ' Ye jawab yaad bhi kar liya, ab ye sawal dobara nahi bhejunga.' : ''} Bot us chat me chalta rahe ga.`
    ).catch(() => {});
  } catch (err) {
    console.warn('[relay] failed:', err.message);
    await sendText(from, `Nahi bhej saka: ${err.message.slice(0, 120)}`).catch(() => {});
  }
  return true;
}

async function onMessage(msg, { jid, waId, quoted }) {

  // WhatsApp can deliver the same message twice on a flaky link, and a
  // duplicate must not produce a second reply to the same sentence.
  if (alreadySeen(msg.key.id)) return;

  // the owner's own number, running the bot rather than talking to it.
  if (config.controlNumbers.includes(normalize(waId))) {
    const text = (textOf(msg) || '').trim();
    // A reply to a forwarded message is an answer for that person, not a
    // command. Checked first, or "ok bhej dein" would land as a command.
    if (await relayFromControl(text, quoted, jid)) return;
    const reply = await handleOwnerCommand(text);
    if (reply) await sendText(jid, reply).catch((e) => console.warn('[control]', e.message));
    return;
  }

  /* A chat the bot has no business being in: personal, family, a friend,
     anything the owner has archived or told it to leave alone.

     Two sources, because one of them turned out not to work. `isArchived`
     reads WhatsApp's own archive flag, which is free but arrives only when
     Baileys happens to send the chat list — after a fresh link it often
     never does, and it never survived a restart. `isIgnored` is a flag on
     the row, set by him with one message, and it is the reliable half.

     Nothing is read, answered or recorded either way. */
  if (isIgnored(waId) || isArchived(jid)) {
    console.log(`[in] +${waId} is on the ignore list, leaving it alone`);
    return;
  }

  const known = lookupStudent(waId);
  const existing = getContactByWaId(waId);
  const contact = upsertContact(waId, { profileName: msg.pushName || null, jid });

  if (!existing) {
    updateContact(contact.id, {
      kind: known ? 'student' : 'unknown',
      name: known?.name || null,
      batch: known?.batch || null,
    });
    logEvent({
      event: 'new_contact',
      contact: { ...contact, kind: known ? 'student' : 'unknown' },
      note: known ? `On the student roster${known.batch ? ` (${known.batch})` : ''}.` : null,
    });
  }

  // Blue ticks, then "typing…". Fired straight away rather than with the
  // reply, because a person opens the chat before they start typing.
  setTimeout(() => markRead(msg.key), config.readReceiptMs);

  const body = await readable(msg, contact, waId, jid);
  if (!body) return;

  addMessage(contact.id, { direction: 'in', sender: 'them', body, waMessageId: msg.key.id });

  const fresh = getContact(contact.id);

  // A bot that handed over may start again when they come back. One that
  // the owner switched off by replying himself stays off until he says so.
  const resumable = !fresh.bot_enabled && fresh.paused_by === 'bot';

  updateContact(contact.id, {
    unread: 1,
    // Every new message pushes the timer out, so three quick lines become
    // one considered reply. This is only the bundling wait — the human
    // pause is measured from their message and applied by the worker.
    reply_due_at: Date.now() + config.bundleMs,
    ...(resumable ? { bot_enabled: 1, paused_by: null } : {}),
  });

  if (resumable) console.log(`[in] bot resumed for +${waId}`);
}

/* ── the owner typed something himself ──────────────────────── */

/**
 * The best thing a linked device gives us.
 *
 * On the Cloud API there is no way to know he has answered somebody from his
 * phone, because the phone is not in the loop. Here his own messages arrive
 * like any other, so the bot can get out of the way the instant he steps in —
 * with nothing to remember to press.
 *
 * A lead once sent three messages to a bot that had quietly switched itself
 * off hours earlier. The reverse of that, a scripted question landing on top
 * of a real answer he had just written, is worse.
 */
async function onSelfMessage(msg, { jid, waId, isSelfChat, quoted }) {
  if (alreadySeen(msg.key.id)) return;
  const text = (textOf(msg) || '').trim();

  // His own "Message yourself" chat is the control panel. Private, always
  // available, and no second phone needed.
  if (isSelfChat) {
    if (!text) return;
    if (await relayFromControl(text, quoted, jid)) return;
    const reply = await handleOwnerCommand(text, { strict: true });
    if (reply) await sendText(jid, reply).catch((e) => console.warn('[control]', e.message));
    return;
  }

  const contact = getContactByWaId(waId);
  if (!contact) return;

  // The bot's own sends echo back through here too, but the link drops those
  // before we ever see them (see `ownSends` in link.js). What reaches this
  // point was typed by a person on the phone.
  addMessage(contact.id, {
    direction: 'out',
    sender: 'human',
    body: text || `[${kindOf(msg)}]`,
    waMessageId: msg.key.id,
  });

  if (contact.bot_enabled) {
    updateContact(contact.id, {
      bot_enabled: 0,
      paused_by: 'human',
      reply_due_at: null,
      next_followup_at: null,
    });
    console.log(`[in] you replied to +${waId}, bot is off for that chat`);
    logEvent({
      event: 'paused',
      contact,
      note: 'You answered this one yourself, so the bot has stepped out. Send "on ' +
        `${waId}" to hand it back.`,
    });
  } else {
    // Keep the timers clear so a queued reply cannot land after his.
    updateContact(contact.id, { reply_due_at: null, next_followup_at: null });
  }
}

/* ── turning whatever arrived into something readable ────── */

/**
 * The last thing they actually said, for a screenshot to be about.
 *
 * A picture on its own tells the owner what is broken but not who is asking or
 * what they tried, and it tells the learning loop nothing at all — one
 * screenshot cannot be matched against the next. Their own words can, so the
 * question that came before the picture is what gets stored against his
 * answer. Placeholders are skipped: "[screenshot]" is not a question.
 */
function lastQuestion(contact) {
  const recent = getMessages(contact.id, 8) || [];
  for (const m of [...recent].reverse()) {
    if (m.direction !== 'in') continue;
    const body = String(m.body || '').trim();
    if (!body || /^\[.*\]$/.test(body)) continue;
    return body.slice(0, 400);
  }
  return null;
}

async function readable(msg, contact, waId, jid) {
  const text = textOf(msg);
  if (text && text.trim()) return text.trim();

  const kind = kindOf(msg);

  if (kind === 'audio' && config.audio.enabled) {
    try {
      const { buffer, mime } = await downloadVoice(msg);
      const said = await transcribe(buffer, mime);
      if (said) {
        console.log(`[voice] +${waId}: ${said.slice(0, 80)}`);
        return said;
      }
    } catch (err) {
      console.warn('[voice] failed:', err.message);
    }
    await apologise(contact, msg, jid, 'Voice note nahi sun paya, thora sa likh ke bhej dein?');
    return null;
  }

  /* A screenshot goes to the owner, it does not get a reply.
     This used to answer "File mil gayi hai. Zara likh dein exactly kya masla
     aa raha hai?" — asking somebody to type out an error they had already
     photographed, because the bot could not read it. the owner can, in a
     glance, and he asked for exactly this: take the screenshot, send it to
     him, and say nothing until he answers. Almost every picture this number
     receives is a screenshot of something broken. */
  if (kind === 'image') {
    let picture = null;
    try {
      picture = await downloadImage(msg);
    } catch (err) {
      console.warn('[media] could not download the screenshot:', err.message);
    }

    addMessage(contact.id, {
      direction: 'in',
      sender: 'them',
      body: '[screenshot]',
      waMessageId: msg.key.id,
    });

    /* What it is a screenshot OF. They rarely repeat themselves once they
       have sent a picture, so the question is whatever they said just
       before — and it is also what makes his answer learnable, since a
       picture cannot be matched against the next one but words can. */
    const asked = lastQuestion(contact) || 'Screenshot bheja hai, koi text nahi.';

    await forwardToOwner({
      contact,
      body: asked,
      why: 'screenshot, forwarded unanswered',
      image: picture,
    }).catch((err) => console.warn('[media] forward failed:', err.message));

    updateContact(contact.id, { bot_enabled: 0, paused_by: 'bot', unread: 0, reply_due_at: null });
    console.log(`[media] screenshot from +${waId} sent to you, nothing replied`);
    return null;
  }

  if (kind === 'document' || kind === 'video') {
    await apologise(
      contact,
      msg,
      jid,
      'File mil gayi hai. Zara likh dein exactly kya masla aa raha hai?'
    );
    return null;
  }

  return null; // stickers and anything else: nothing to answer
}

/** Say something rather than nothing, and record it so the thread makes sense. */
async function apologise(contact, msg, jid, text) {
  addMessage(contact.id, {
    direction: 'in',
    sender: 'them',
    body: `[${kindOf(msg)} we could not read]`,
    waMessageId: msg.key.id,
  });
  const stop = startTyping(jid);
  try {
    await sleep(3500);
    const id = await sendText(jid, text);
    addMessage(contact.id, { direction: 'out', sender: 'bot', body: text, waMessageId: id });
  } catch (err) {
    console.warn('[voice] could not reply:', err.message);
  } finally {
    stop();
  }
}

/* ── boot ────────────────────────────────────────────────── */

// Nothing needs to be reachable from the internet — the link is an outbound
// connection. This exists only so Docker can tell whether the process is
// healthy, and it is not exposed by the compose file.
http
  .createServer((req, res) => {
    const url = (req.url || '').split('?')[0];

    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, linked: myNumber(), roster: rosterSize(), ...stats() }));
    }

    // The live QR, for linking.
    //
    // WhatsApp rotates the code every twenty seconds, so any screenshot is
    // stale before it can be sent to anybody — three linking attempts were
    // lost to exactly that. This page refreshes itself instead.
    //
    // Behind a secret path because anyone who can see this QR can attach
    // their own device to the account. Unset LINK_TOKEN once linked.
    if (config.linkToken && url === `/qr/${config.linkToken}`) {
      const qr = qrDataUri();
      const linked = myNumber();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(qrPage(qr, linked));
    }

    res.writeHead(404).end();
  })
  .listen(config.healthPort, config.linkToken ? '0.0.0.0' : '127.0.0.1');

function qrPage(qr, linked) {
  const body = linked
    ? `<h1>Linked</h1><p>Connected as +${linked}. Nothing to scan.</p>
       <p class=note>Turn this page off now: <code>./setenv.sh LINK_TOKEN ""</code></p>`
    : qr
      ? `<img src="${qr}" width="320" height="320" alt="WhatsApp QR">
         <p>WhatsApp Business &rarr; Settings &rarr; Linked devices &rarr; Link a device</p>
         <p class=note>Refreshes by itself. Always scan whatever is on screen.</p>`
      : `<h1>Starting&hellip;</h1><p class=note>Waiting for a code. This page reloads by itself.</p>`;

  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Link WhatsApp</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;background:#0b141a;color:#e9edef;
      display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
 .card{text-align:center;padding:32px}
 img{background:#fff;padding:12px;border-radius:12px}
 h1{font-size:20px;margin:0 0 8px}
 p{margin:14px 0 0}
 .note{color:#8696a0;font-size:13px}
 code{background:#202c33;padding:2px 6px;border-radius:4px}
</style>
<div class=card>${body}</div>`;
}

console.log(`[boot] roster: ${rosterSize()} student numbers`);

const sock = await connect({ onMessage, onSelfMessage });
setSelfNumber(() => sock.user?.id);
startWorker();
startArchive(sock);
