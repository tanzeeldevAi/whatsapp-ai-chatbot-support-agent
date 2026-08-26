import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QR from 'qrcode';
import { config } from './config.js';

/**
 * The connection. The bot is a linked device on the real account, exactly
 * like WhatsApp Web — the number never leaves the WhatsApp Business app on
 * the phone, and every reply lands in the real chat thread.
 *
 * Three things in here are load bearing and none of them are obvious:
 *
 *   1. A device that has just linked or reconnected is replayed history.
 *      Answering six months of old messages is unrecoverable, so nothing is
 *      answered during warmup and anything that arrives already old is
 *      dropped. Two independent guards, because this failure has no undo.
 *
 *   2. Groups, status and channels are ignored outright. the owner is in the
 *      student groups. A bot replying there would be seen by everyone at
 *      once and there is no version of that which goes well.
 *
 *   3. Messages he sends himself arrive here too, with `fromMe` set. That is
 *      not noise, it is the most useful signal the linked device gives us:
 *      it is how the bot knows he has taken a conversation over, without him
 *      having to tell it.
 */

const logger = pino({ level: process.env.BAILEYS_LOG || 'silent' });

let sock = null;
let connectedAt = 0;
// The QR currently on offer, as a data URI. WhatsApp rotates it every twenty
// seconds or so, which is why a screenshot is useless by the time it has been
// sent to anybody — the live page in server.js reads this instead.
let currentQr = null;

export const qrDataUri = () => currentQr;
let handlers = { onMessage: async () => {}, onSelfMessage: async () => {} };

export const socket = () => sock;
export const isReady = () => Boolean(sock?.user) && Date.now() - connectedAt > config.link.warmupMs;
export const myNumber = () =>
  sock?.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0].split(':')[0] : null;

/** 923001234567 → 923001234567@s.whatsapp.net */
export const toJid = (waId) =>
  String(waId).includes('@') ? waId : `${String(waId).replace(/[^\d]/g, '')}@s.whatsapp.net`;

/** 923001234567@s.whatsapp.net → 923001234567 */
export const toNumber = (jid) => jidNormalizedUser(jid || '').split('@')[0].split(':')[0];

/* ── what we refuse to look at ───────────────────────────── */

export function ignorable(jid) {
  if (!jid) return true;
  if (isJidGroup(jid)) return true; // never, ever reply in a group
  if (isJidBroadcast(jid)) return true; // status@broadcast and broadcast lists
  if (typeof isJidNewsletter === 'function' && isJidNewsletter(jid)) return true; // channels
  if (jid === 'status@broadcast') return true;
  return false;
}

/**
 * Who wrote this, and where do we write back?
 *
 * WhatsApp is moving one-to-one chats onto **LID** addressing: the message
 * arrives from `123456@lid` rather than `971501234567@s.whatsapp.net`, and
 * the real phone number rides alongside in `senderPn`.
 *
 * This cost an afternoon. `@lid` was on the ignore list as "a privacy id we
 * cannot reply to", which was true once and is not any more — so every real
 * message was dropped in silence, with the bot showing connected and healthy
 * the whole time. Reply to the address it came from; keep the phone number
 * only as the human-readable identity.
 */
export function addressOf(msg) {
  const jid = msg.key?.remoteJid || '';
  const pn = msg.key?.senderPn || msg.key?.participantPn || null;
  const lid = isLidUser(jid);
  return {
    jid,                                    // where a reply is sent
    waId: toNumber(pn || jid),              // who they are, for the database
    lid: Boolean(lid),
  };
}

const NOISE = [
  'reactionMessage',
  'protocolMessage',
  'pollUpdateMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pinInChatMessage',
  'editedMessage',
];

/** True when the envelope carries no actual message from a person. */
export function noise(message) {
  const keys = Object.keys(message || {}).filter((k) => k !== 'messageContextInfo');
  if (!keys.length) return true;
  return keys.every((k) => NOISE.includes(k));
}

/* ── reading a message ───────────────────────────────────── */

/** Whatever kind of message it is, what did they actually say? */
export function textOf(msg) {
  const m = msg?.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    null
  );
}

/**
 * The id of the message this one is replying to, if any.
 *
 * This is how "reply to the forward on your phone" works: the quoted id is
 * the forward we sent, and that tells us whose conversation the answer
 * belongs to without him having to type a number.
 */
export function quotedId(msg) {
  const m = msg?.message || {};
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.ephemeralMessage?.message?.extendedTextMessage?.contextInfo ||
    null;
  return ctx?.stanzaId || null;
}

export function kindOf(msg) {
  const m = msg?.message || {};
  if (m.audioMessage || m.ephemeralMessage?.message?.audioMessage) return 'audio';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  return 'text';
}

export async function downloadVoice(msg) {
  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );
  if (buffer.length > config.audio.maxBytes) throw new Error(`voice note too large: ${buffer.length}`);
  const mime =
    msg.message?.audioMessage?.mimetype ||
    msg.message?.ephemeralMessage?.message?.audioMessage?.mimetype ||
    'audio/ogg';
  return { buffer, mime };
}

/* ── the connection itself ───────────────────────────────── */

export async function connect(h = {}) {
  handlers = { ...handlers, ...h };
  fs.mkdirSync(config.link.authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.link.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      // Signal keys are read constantly. Caching them is the difference
      // between a responsive link and one that stutters on every message.
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Deliberately a stock browser string rather than a friendly product
    // name. WhatsApp checks this when issuing a pairing code, and an
    // unrecognised one comes back on the phone as "Couldn't link device"
    // with no hint that the name was the problem. Cosmetics lose to linking.
    browser: Browsers.ubuntu(config.link.deviceName),
    // We answer deliberately and slowly. Marking everything online would
    // claim the phone is active when it is not.
    markOnlineOnConnect: false,
    // Asking for the full sync only matters while the archive job is
    // running. The warmup and message-age guards mean the flood it
    // produces can never turn into replies.
    syncFullHistory: config.archive.enabled,
    generateHighQualityLinkPreview: false,
  });

  // Captured now: once the socket has closed, `sock.authState` is not a
  // reliable place to ask whether this was ever a working link.
  const registered = Boolean(sock.authState.creds.registered);

  sock.ev.on('creds.update', saveCreds);

  /* Archived chats are off limits — not read, not answered.
     Archiving a chat is how somebody says "I am done with this one". the owner
     archives a conversation once he has dealt with it himself, so a bot that
     replies there is walking back into a room that was deliberately closed.

     WhatsApp does not put this on the message, only on the chat, so the flag
     has to be collected from the chat events as they arrive and remembered.
     `chats.upsert` carries the whole list on connect; `chats.update` carries
     each later change, including when he archives one while the bot is
     running. Both spellings appear across versions, hence the two reads. */
  const trackArchive = (chats) => {
    for (const c of chats || []) {
      if (!c?.id) continue;
      const flag = c.archived ?? c.archive;
      if (flag === undefined || flag === null) continue;
      if (flag === true || flag === 1 || flag === 'true') archived.add(c.id);
      else archived.delete(c.id);
    }
  };
  sock.ev.on('chats.upsert', trackArchive);
  sock.ev.on('chats.update', trackArchive);
  sock.ev.on('chats.set', ({ chats }) => trackArchive(chats));

  /* The pairing code looks friendlier — eight characters typed on a phone
     rather than a camera pointed at a terminal. It is also the fragile one:
     the code is bound to this exact socket, so if the connection blips
     before it has been typed, the code is already dead and the phone just
     says "Couldn't link device". That happened twice here. QR is the
     default for that reason. */
  if (!sock.authState.creds.registered && config.link.mode === 'code' && config.link.phone) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.link.phone);
        banner(code.match(/.{1,4}/g)?.join('-') || code);
      } catch (err) {
        console.error('[link] could not get a pairing code:', err.message);
        console.error('[link] set LINK_MODE=qr and link by QR instead');
      }
    }, 4000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && config.link.mode !== 'code') {
      console.log('\n  Scan this: WhatsApp Business → Settings → Linked devices\n');
      qrcode.generate(qr, { small: true });

      // Also as a real image. Scanning ASCII art out of an SSH window is
      // miserable, and a PNG can simply be opened on any screen.
      const file = path.join(path.dirname(config.dbPath), 'qr.png');
      QR.toFile(file, qr, { width: 640, margin: 2 })
        .then(() => console.log(`[link] QR image written to ${file}`))
        .catch((err) => console.warn('[link] could not write the QR image:', err.message));

      QR.toDataURL(qr, { width: 520, margin: 2 })
        .then((uri) => {
          currentQr = uri;
        })
        .catch(() => {});
    }

    if (connection === 'open') {
      connectedAt = Date.now();
      currentQr = null; // linked, nothing left to scan
      console.log(`[link] connected as +${myNumber()}`);
      console.log(
        `[link] warming up for ${config.link.warmupMs / 1000}s — history is replayed on connect ` +
          'and must not be answered'
      );
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = status === DisconnectReason.loggedOut;
      console.warn(`[link] disconnected (${status || 'unknown'})${loggedOut ? ', logged out' : ''}`);

      if (loggedOut) {
        // A 401 on a session that was never registered is not "unlinked" —
        // it is a linking attempt that failed or timed out. Leaving the
        // half-written credentials in place poisons every retry after it,
        // which is what turned one expired pairing code into a container
        // that could not produce a working one again. Wipe and retry.
        if (!registered) {
          console.warn('[link] that linking attempt failed, clearing it and starting over');
          // Order matters. Baileys writes credentials asynchronously, so
          // deleting the directory out from under a `saveCreds` already in
          // flight throws ENOENT from inside the library and takes the whole
          // process down — which then restarts, which invalidates whatever
          // pairing code the person is in the middle of typing. Detach the
          // listeners first, and leave the directory in place afterwards.
          try {
            sock.ev.removeAllListeners();
          } catch {
            /* the socket is already gone */
          }
          try {
            fs.rmSync(config.link.authDir, { recursive: true, force: true });
          } catch (err) {
            console.warn('[link] could not clear the session:', err.message);
          }
          fs.mkdirSync(config.link.authDir, { recursive: true });
          setTimeout(
            () => connect(handlers).catch((e) => console.error('[link] retry failed:', e.message)),
            3000
          );
          return;
        }

        // A real link, removed from the phone. Reconnecting with dead
        // credentials loops forever, so stop and say what to do.
        console.error(
          '\n[link] this device was unlinked from the phone.\n' +
            `[link] run "npm run unlink" (or delete ${path.resolve(config.link.authDir)}) to re-link.\n`
        );
        return;
      }
      setTimeout(() => connect(handlers).catch((e) => console.error('[link] reconnect failed:', e.message)), 4000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // 'notify' is a live message. 'append' is history being backfilled, and
    // replying to it is the one mistake with no way back.
    if (type !== 'notify') {
      if (debug) console.log(`[link:debug] ignoring a '${type}' batch of ${messages.length}`);
      return;
    }

    for (const msg of messages) {
      try {
        await route(msg);
      } catch (err) {
        console.error('[link] message handling failed:', err.message);
      }
    }
  });

  return sock;
}

const debug = /^(1|true|yes|on)$/i.test(String(process.env.LINK_DEBUG || ''));
const drop = (why, jid) => {
  if (debug) console.log(`[link:debug] dropped (${why}) from ${jid}`);
};

async function route(msg) {
  const jid = msg.key?.remoteJid;

  if (debug) {
    console.log(
      `[link:debug] in jid=${jid} fromMe=${Boolean(msg.key?.fromMe)} ` +
        `pn=${msg.key?.senderPn || '-'} keys=${Object.keys(msg.message || {}).join(',') || '-'}`
    );
  }

  if (ignorable(jid)) return drop('group/broadcast/channel', jid);
  if (!msg.message) return drop('no message body', jid); // receipts, empty envelopes

  // Reactions, edits, deletes, poll votes and view-once receipts all arrive
  // as messages. None of them is somebody asking a question, and answering a
  // thumbs-up would be memorable for the wrong reason.
  if (noise(msg.message)) return drop('reaction/edit/protocol', jid);

  /* An age guard used to sit here, dropping anything older than ten minutes.
     It cost real leads and it had to go.
     WhatsApp redelivers whatever it could not hand over while the container
     was down. Every rebuild today triggered that, and every time this threw
     the same messages away for being "too old" — so five people who wrote on
     Friday and Saturday asking to enrol, asking about the new batch, and
     asking for an LMS approval were never seen by the bot at all. They sat
     unread on the phone while the bot reported itself healthy.

     Nothing is lost by removing it. Replayed history is already handled
     twice over, and better: `type !== 'notify'` rejects the bulk sync, the
     warmup covers the reconnect, and `alreadySeen(msg.key.id)` in server.js
     means a message can never be answered a second time however often
     WhatsApp resends it. Age was standing in for identity, and we have
     identity.

     The one thing left to it — not answering a genuinely ancient message on
     a fresh link — is what the warmup and the history-type check are for. */

  const who = addressOf(msg);
  const mine = jidNormalizedUser(sock.user.id);
  const isSelfChat =
    jidNormalizedUser(jid) === mine || (who.waId && who.waId === myNumber());

  if (msg.key.fromMe) {
    // Our own reply echoing back, not him. See `ownSends`.
    if (ownSends.has(msg.key.id)) return drop('our own send echoing back', jid);
    // He typed this, on his own phone, in the WhatsApp Business app.
    await handlers.onSelfMessage(msg, { ...who, isSelfChat, quoted: quotedId(msg) });
    return;
  }

  if (!isReady()) {
    console.log(`[link] still warming up, not answering +${who.waId} yet`);
    return;
  }

  await handlers.onMessage(msg, { ...who, quoted: quotedId(msg) });
}

/* ── sending ─────────────────────────────────────────────── */

/**
 * Every message this process sends comes straight back through
 * `messages.upsert` with `fromMe` set, because that is how a linked device
 * learns what the other devices did — and it cannot tell which device wrote
 * it. Without this set, the bot reads its own reply as the owner taking over
 * and switches itself off after every single answer.
 *
 * It also stops the activity feed, which is sent to his own chat, being read
 * back as a command.
 */
/* Chats the owner has archived. See the chat events in connect() for why. */
const archived = new Set();

/** Has this chat been archived? Checked before anything is answered. */
export const isArchived = (jid) => archived.has(jid);

const ownSends = new Set();
export const wasSentByUs = (id) => ownSends.has(id);

export async function sendText(waId, body) {
  if (!sock?.user) throw new Error('not linked yet');
  const out = await sock.sendMessage(toJid(waId), { text: body });
  const id = out?.key?.id || null;
  if (id) {
    ownSends.add(id);
    // Only the recent ones matter — anything older has long since echoed.
    if (ownSends.size > 400) for (const old of [...ownSends].slice(0, 200)) ownSends.delete(old);
  }
  return id;
}

/**
 * Send a picture, with the message as its caption.
 *
 * One message rather than two, and that is the point: the reply relay works
 * by matching the id of the message the owner replies to. If the screenshot and
 * the question arrived separately he could reply to either, and only one of
 * them would route back to the right person.
 */
export async function sendImage(waId, buffer, caption) {
  if (!sock?.user) throw new Error('not linked yet');
  const out = await sock.sendMessage(toJid(waId), { image: buffer, caption });
  const id = out?.key?.id || null;
  if (id) {
    ownSends.add(id);
    if (ownSends.size > 400) for (const old of [...ownSends].slice(0, 200)) ownSends.delete(old);
  }
  return id;
}

/**
 * The picture somebody sent, as bytes.
 *
 * Screenshots of an LMS error are the one thing a text-only bot is worst at
 * and the owner is fastest at: he can read the error and know the fix. So these
 * are not interpreted, they are carried.
 */
export async function downloadImage(msg) {
  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );
  if (buffer.length > config.media.maxBytes) throw new Error(`image too large: ${buffer.length}`);
  return buffer;
}

/** Blue ticks, the same as opening the chat. */
export async function markRead(key) {
  try {
    await sock.readMessages([key]);
  } catch (err) {
    console.warn('[link] read receipt failed:', err.message);
  }
}

/**
 * The "typing…" line under the contact name.
 *
 * WhatsApp expires this after about ten seconds, so a long pause needs it
 * refreshed. Returns a stop function, which is also what clears it if the
 * send fails — leaving a contact staring at "typing…" forever would be worse
 * than a slow reply.
 */
export function startTyping(waId) {
  const jid = toJid(waId);
  const beat = () => {
    sock?.sendPresenceUpdate('composing', jid).catch(() => {});
  };
  sock?.presenceSubscribe(jid).catch(() => {});
  beat();
  const timer = setInterval(beat, 8000);
  return () => {
    clearInterval(timer);
    sock?.sendPresenceUpdate('paused', jid).catch(() => {});
  };
}

function banner(code) {
  const line = '─'.repeat(46);
  console.log(`\n┌${line}┐`);
  console.log('│  Link the bot to WhatsApp Business:'.padEnd(47) + '│');
  console.log('│'.padEnd(47) + '│');
  console.log('│  Settings → Linked devices → Link a device'.padEnd(47) + '│');
  console.log('│  → Link with phone number instead'.padEnd(47) + '│');
  console.log('│'.padEnd(47) + '│');
  console.log(`│      code:  ${code}`.padEnd(47) + '│');
  console.log('│'.padEnd(47) + '│');
  console.log('│  The code expires in a few minutes.'.padEnd(47) + '│');
  console.log(`└${line}┘\n`);
}
