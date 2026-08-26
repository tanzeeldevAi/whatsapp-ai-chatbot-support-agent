import fs from 'node:fs';
import path from 'node:path';

/**
 * Read .env when one is sitting next to the project, with no dependency.
 *
 * In Docker the values already arrive through `env_file`, and this fills in
 * nothing because every key is already set. It exists so the thing can be run
 * and tuned on a laptop without a container.
 */
(() => {
  const file = process.env.ENV_FILE || path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const numberList = (v) =>
  String(v || '')
    .split(',')
    .map((n) => n.replace(/[^\d]/g, ''))
    .filter(Boolean);

export const config = {
  dbPath: process.env.DB_PATH || './data/sh.db',
  healthPort: num(process.env.HEALTH_PORT, 3000),

  /* A secret path segment that turns on the live QR page for linking.
     While it is set the health server listens on all interfaces, so clear
     it the moment the phone has scanned: anyone who can reach that page can
     attach their own device to the account. */
  linkToken: (process.env.LINK_TOKEN || '').replace(/[^A-Za-z0-9_-]/g, ''),

  /* ── the link ─────────────────────────────────────────────
     The bot joins the account the same way WhatsApp Web does, as a
     linked device. The number never leaves the WhatsApp Business app
     on the phone, replies land in the real chat threads, and there is
     no separate inbox to check.                                       */
  link: {
    // Full international form, no plus: 923001234567. Only used by the
    // pairing-code path, which requires it to match the account exactly.
    phone: String(process.env.LINK_PHONE || '').replace(/[^\d]/g, ''),
    // 'qr' (default, reliable) or 'code' (8 characters, needs LINK_PHONE).
    // The pairing code is bound to the live socket, so if the connection
    // blips before it is typed the code is already dead — which is exactly
    // what happened on the first two attempts.
    mode: (process.env.LINK_MODE || 'qr').toLowerCase(),
    authDir: process.env.AUTH_DIR || './data/auth',
    // Shown under Linked Devices on the phone. Keep it a stock browser
    // name: WhatsApp validates this when issuing a pairing code, and an
    // unusual one fails as "Couldn't link device" with nothing in the log.
    deviceName: process.env.DEVICE_NAME || 'Chrome',
    // Nothing is answered for this long after connecting. WhatsApp
    // replays history to a device that has just linked or reconnected,
    // and answering six months of old messages would be unrecoverable.
    warmupMs: num(process.env.WARMUP_SECONDS, 25) * 1000,
    // A second guard on the same problem: anything older than this when
    // it reaches us is history, not a live message.
    maxAgeMs: num(process.env.MAX_MESSAGE_AGE_MINUTES, 10) * 60000,
  },

  /* ── the model ────────────────────────────────────────────
     Groq is the known-good free option on this account. Google's free
     Gemini tier returned `limit: 0` for the GYL project, so it is the
     fallback here, not the primary. See HANDOFF section 2.            */
  ai: {
    provider: process.env.AI_PROVIDER || 'openai',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    baseUrl: process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 14000),
    temperature: num(process.env.AI_TEMPERATURE, 0.75),
    tokensPerMinute: num(process.env.AI_TPM, 8000),
    requestsPerMinute: num(process.env.AI_RPM, 30),
  },
  ai2: {
    provider: process.env.AI2_PROVIDER || '',
    apiKey: process.env.AI2_API_KEY || '',
    model: process.env.AI2_MODEL || 'gemini-2.0-flash',
    baseUrl: process.env.AI2_BASE_URL || '',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 14000),
    temperature: num(process.env.AI_TEMPERATURE, 0.75),
    tokensPerMinute: num(process.env.AI2_TPM, 6000),
    requestsPerMinute: num(process.env.AI2_RPM, 30),
  },

  /* ── the queue in front of the model ──────────────────────
     The free tier's ceiling, per model, per minute. Requests line up
     and wait for room rather than being answered badly to fit. Groq's
     on-demand tier is 12,000 tokens and 30 requests a minute for the
     70b model; raise these if the plan changes.

     A student who waits ninety seconds and gets the right answer is
     better served than one who gets a holding line in seven. */
  aiTokensPerMinute: num(process.env.AI_TPM, 8000),
  aiRequestsPerMinute: num(process.env.AI_RPM, 30),
  /* The fallback has its own, smaller allowance and it is not optional to
     know that: llama-3.1-8b-instant is 6,000 tokens a minute, and while the
     limiter used the 70b's 12,000 for both, every fallback attempt came back
     413 "request too large" and the person got a holding line. */
  ai2TokensPerMinute: num(process.env.AI2_TPM, 6000),
  ai2RequestsPerMinute: num(process.env.AI2_RPM, 30),
  // Past this, give up and send the holding line rather than leaving
  // somebody on blue ticks indefinitely.
  aiMaxQueueMs: num(process.env.AI_MAX_QUEUE_SECONDS, 180) * 1000,

  /* ── the one-off history grab ─────────────────────────────
     Pulls the last few months of real conversations off the account so
     the persona can be built from what the owner actually writes rather
     than from my description of it. A job, not a feature: switch it on,
     let it finish, switch it off again. */
  archive: {
    enabled: bool(process.env.ARCHIVE_HISTORY, false),
    months: num(process.env.ARCHIVE_MONTHS, 4),
    pageSize: num(process.env.ARCHIVE_PAGE, 50),
    // Deliberately unhurried. This is somebody's phone digging through
    // months of messages, and nothing is gained by rushing it.
    intervalMs: num(process.env.ARCHIVE_INTERVAL_SECONDS, 12) * 1000,
    retryMs: num(process.env.ARCHIVE_RETRY_SECONDS, 25) * 1000,
  },

  // Voice notes are normal here, so they are transcribed rather than refused.
  audio: {
    enabled: bool(process.env.AUDIO_TRANSCRIBE, true),
    model: process.env.AUDIO_MODEL || 'whisper-large-v3-turbo',
    baseUrl: process.env.AUDIO_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey: process.env.AUDIO_API_KEY || process.env.AI_API_KEY || '',
    maxBytes: num(process.env.AUDIO_MAX_BYTES, 16 * 1024 * 1024),
  },

  /* Screenshots. Not read, only carried straight to the owner — see the LMS
     rule in brain.js. The cap is generous because a phone screenshot of an
     LMS error is usually under a megabyte and refusing one costs more than
     the bytes do. */
  /* Force every reply into one language, ignoring what they wrote in.
     Empty means mirror them, which is the normal behaviour and the one the
     whole voice is built around. the owner switched this to english while the
     Urdu-script guards are being finished — an Urdu reply the bot invented
     is worse than an English one it got right. Live: setenv.sh REPLY_LANG english */
  /* The model chooses an approved answer instead of writing one.
     See answer-bank.js. Off returns to the old behaviour, where it composes
     the reply itself — which is where every invented fact came from.
     Live: setenv.sh ANSWER_BANK_ONLY false */
  answerBankOnly: bool(process.env.ANSWER_BANK_ONLY, true),

  replyLang: (process.env.REPLY_LANG || '').trim().toLowerCase(),

  media: {
    maxBytes: num(process.env.MEDIA_MAX_BYTES, 12 * 1024 * 1024),
  },

  /* The second pass that checks a reply is about the question that was
     asked. On by default: the failure it catches — a fluent answer to a
     different question — is the one a student notices and the one that
     costs trust. Turn it off with VERIFY_ANSWERS=false if the extra call
     ever becomes a rate-limit problem. */
  verify: bool(process.env.VERIFY_ANSWERS, true),

  /* ── the human feel ───────────────────────────────────────
     Two separate numbers, and confusing them is what makes a bot feel
     slow. `bundleMs` is how long we wait to see whether more messages
     are coming — three quick lines are one thought, and answering each
     separately is both robotic and usually wrong. `replyDelayMs` is the
     target gap between their last message and our reply.

     The gap is measured from their message, not from when we started
     typing, so the bundling wait and the model's own thinking time are
     spent out of the same budget rather than stacked on top of it.
     Otherwise 4s of bundling plus 2s of model plus 7s of "typing" adds
     up to 13 seconds, which is not a person, it is a queue.            */
  bundleMs: num(process.env.BUNDLE_SECONDS, 4) * 1000,
  replyDelayMs: num(process.env.REPLY_DELAY_SECONDS, 5) * 1000,
  msPerWord: num(process.env.MS_PER_WORD, 90),
  maxDelayMs: num(process.env.MAX_DELAY_SECONDS, 12) * 1000,
  minDelayMs: num(process.env.MIN_DELAY_MS, 1200),
  readReceiptMs: num(process.env.READ_RECEIPT_MS, 1600),
  bubbleGapMs: num(process.env.BUBBLE_GAP_MS, 2600),
  tickMs: num(process.env.WORKER_TICK_MS, 1500),
  // Two ceilings, because the two kinds of question are not alike. A batch
  // enquiry has little to say. A course question has to actually be answered,
  // and the first live test failed exactly here: a 55 word cap turned real
  // answers into "main apko btaunga" and nothing else.
  maxWords: num(process.env.MAX_WORDS, 55),
  maxWordsAnswer: num(process.env.MAX_WORDS_ANSWER, 60),

  /* ── the "go to the group" line ───────────────────────────
     Off. Support is given to everyone, right here on WhatsApp, so
     telling somebody it has ended would contradict what we actually do.
     The machinery is kept because the decision could change: set
     GROUP_REMINDER=true and it comes back, once per person per cooldown.
     While it is off, brain.js also strips the line if the model
     volunteers it on its own.                                         */
  groupReminder: bool(process.env.GROUP_REMINDER, false),
  reminderCooldownMs: num(process.env.REMINDER_COOLDOWN_DAYS, 7) * 86400000,

  /* ── when yesterday stops being today ─────────────────────
     A student asked about niche research one afternoon, said "hi" the
     next day, and was answered "apko niche research me help chahye?" —
     dragging a finished conversation into a new one.

     Past this gap, measured from our last reply, the old transcript is
     left out of the prompt altogether. Telling a model to ignore
     something it can still see does not work; not showing it does. */
  freshAfterMs: num(process.env.FRESH_AFTER_HOURS, 8) * 3600000,

  /* ── the course material ──────────────────────────────────
     Lecture notes and past real answers, searched per question and
     dropped into the prompt. See knowledge-base.js for why this is
     keyword search and not embeddings.

     `maxWords` is the real control: it is the slice of the token
     budget this is allowed to spend, and the queue pays for it. */
  kb: {
    enabled: bool(process.env.KB_ENABLED, true),
    path: process.env.KB_PATH || './data/kb.db',
    chunks: num(process.env.KB_CHUNKS, 5),
    maxWords: num(process.env.KB_MAX_WORDS, 220),
    /* Whether the 9,179 mined past replies are searched at all.
       They are real answers in his own voice, but they are also months old
       and full of things that are no longer true. Off leaves only the
       lectures and what he has taught directly. Live: setenv.sh KB_USE_ANSWERS false */
    useAnswers: bool(process.env.KB_USE_ANSWERS, true),
  },

  // Chasing a silent new-batch enquiry. Students are never chased.
  followupHours: String(process.env.FOLLOWUP_HOURS || '20,72')
    .split(',')
    .map((h) => Number(h))
    .filter((h) => Number.isFinite(h) && h > 0),

  botEnabled: bool(process.env.BOT_ENABLED, true),

  // Quiet hours. Outside them the reply is held until morning, because a
  // 4 AM answer from a "person" is the loudest tell there is.
  quietHours: bool(process.env.QUIET_HOURS, true),
  dayStart: num(process.env.DAY_START_HOUR, 9),
  dayEnd: num(process.env.DAY_END_HOUR, 23),

  /* ── running it ───────────────────────────────────────────
     Commands work from two places. Your own "Message yourself" chat is
     the private one and needs no second phone. Any number listed here
     also works, which is how a second person can run it.              */
  controlNumbers: numberList(process.env.CONTROL_NUMBERS),
  // Where the activity feed goes. Usually your own chat, so leave blank
  // and it uses "Message yourself".
  logTo: numberList(process.env.LOG_TO),
  // all = every exchange · events = new contacts, handovers, failures only
  logLevel: process.env.LOG_LEVEL || 'events',

  brand: process.env.BRAND_NAME || 'Your Business',
  ownerName: process.env.OWNER_NAME || 'the owner',
  timezone: process.env.TIMEZONE || 'Asia/Karachi',
};

export function assertConfig() {
  const missing = [];
  if (!config.ai.apiKey) missing.push('AI_API_KEY (no key = the bot only sends holding lines)');
  if (config.link.mode === 'code' && !config.link.phone) {
    console.warn('[config] LINK_MODE=code needs LINK_PHONE, falling back to a QR');
    config.link.mode = 'qr';
  }
  if (missing.length) console.warn(`[config] missing env: ${missing.join(', ')}`);
  return missing;
}
