import { config } from './config.js';
import { shorten } from './spelling.js';

/**
 * The guarantee half of "it must not feel like AI".
 *
 * The persona asks the model to write like a person. This assumes it did not
 * quite manage, and takes the tells out anyway. Every rule below exists
 * because a model produces that thing unprompted, in every language, however
 * firmly it was told otherwise.
 *
 * Nothing here rewrites meaning. It removes packaging.
 */

/* ── phrases no real person types on WhatsApp ────────────── */

const KILL_PHRASES = [
  /^\s*(great|good|excellent|that'?s a great)\s+question[.!,]?\s*/i,
  /^\s*(certainly|sure thing|absolutely|of course)[.!,]\s*/i,
  /\bi hope (this|that) helps[.!]?/gi,
  /\b(please )?(do )?let me know if (you have any|there'?s|there is|you need)[^.!?]*[.!?]/gi,
  /\bfeel free to (ask|reach out|contact)[^.!?]*[.!?]/gi,
  /\bi'?(m| am) (happy|glad) to help[^.!?]*[.!?]/gi,
  /\bis there anything else[^.!?]*[?]/gi,
  /\bas an ai\b[^.!?]*[.!?]/gi,
  /\bi'?(m| am) (an? )?(ai|bot|assistant|language model)\b[^.!?]*[.!?]/gi,
  /\bthank you for (reaching out|your (message|query|question))[^.!?]*[.!?]/gi,
  // "kindly" used to be stripped here as too formal. It is not: he types it
  // 314 times across 21,881 replies, more often than "please". Removing it
  // was making his own writing sound less like him, which is the exact
  // failure this file exists to prevent. Left in deliberately.
  /\brest assured\b[^.!?]*[.!?]/gi,
  /\bplease note that\b/gi,
  /\bdo not hesitate[^.!?]*[.!?]/gi,
  /\bwe (appreciate|value) your\b[^.!?]*[.!?]/gi,
  // Roman Urdu equivalents. Models produce these too, and they read even
  // more like a form letter in Urdu than in English.
  /\bkoi (aur )?sawal ho to (zaroor |zarur )?(poochi?ye|bataye?in|batayen|pooch lein)[^.!?]*[.!?]/gi,
  /\bhum(ari)? (poori )?koshish (karenge|karte hain)[^.!?]*[.!?]/gi,
  /\bap ?ka din acha guzre[^.!?]*[.!?]/gi,
  /\bshukriya rabta karne (ka|ke liye)[^.!?]*[.!?]/gi,
];

/** Words that read as a press release in any language. */
const SWAPS = [
  [/\bhowever\b/gi, 'but'],
  [/\bmoreover\b/gi, 'also'],
  [/\bfurthermore\b/gi, 'also'],
  [/\badditionally\b/gi, 'also'],
  [/\btherefore\b/gi, 'so'],
  [/\bregarding\b/gi, 'about'],
  [/\bin order to\b/gi, 'to'],
  [/\butilize\b/gi, 'use'],
  [/\bcommence\b/gi, 'start'],
  [/\bassist you\b/gi, 'help'],
  [/\bprior to\b/gi, 'before'],
];

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}\u{1F900}-\u{1F9FF}]/gu;

/* ── the stripper ────────────────────────────────────────── */

export function humanize(raw, { maxWords = config.maxWords, lang = null } = {}) {
  let t = String(raw || '').trim();
  if (!t) return '';

  // Markdown. WhatsApp has its own syntax and people rarely use it, but a
  // model reaches for ** and ### constantly.
  t = t.replace(/```[\s\S]*?```/g, (b) => b.replace(/```/g, '').trim());
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/^#{1,6}\s*/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');

  // Lists become sentences. A three-bullet answer on WhatsApp is a machine
  // answering, every time.
  //
  // Stripping the markers is not enough on its own — that leaves the steps
  // stacked as bare lines, which then get joined into one run-on sentence
  // with no punctuation between them. Each item is folded into the line
  // above with a comma, which is how a person types the same instructions.
  {
    const kept = [];
    for (const rawLine of t.split('\n')) {
      const isItem = /^\s*(?:[-*•·]|\d+[.)])\s+/.test(rawLine);
      const line = rawLine.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim();
      if (!line) continue;
      if (isItem && kept.length) {
        const prev = kept[kept.length - 1];
        kept[kept.length - 1] = /[.!?,:;]$/.test(prev) ? `${prev} ${line}` : `${prev}, ${line}`;
      } else {
        kept.push(line);
      }
    }
    t = kept.join('\n');
  }

  // The dash. This one is close to a fingerprint.
  t = t.replace(/\s*[—–]\s*/g, ', ');
  t = t.replace(/\s+-\s+/g, ', ');

  // Smart punctuation nobody types on a phone keyboard.
  t = t.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...');

  for (const rx of KILL_PHRASES) t = t.replace(rx, ' ');
  for (const [rx, to] of SWAPS) t = t.replace(rx, to);

  // At most one emoji, and only if it was not the very first character.
  const emojis = t.match(EMOJI) || [];
  if (emojis.length > 1) {
    let kept = false;
    t = t.replace(EMOJI, (e) => {
      if (kept) return '';
      kept = true;
      return e;
    });
  }
  t = t.replace(/^\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]\s*)+/u, '');

  // A removed sentence can leave its trailing emoji or punctuation stranded
  // on a line of its own, which then arrives as its own message bubble.
  t = t
    .split('\n')
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .join('\n');

  // Whitespace, after everything above has left holes in it.
  t = t
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?]){2,}(?![.])/g, '$1')
    .trim();

  // A reply that opens with a comma or a full stop, because a kill phrase
  // used to be in front of it.
  t = t.replace(/^[,.;:!\s]+/, '').trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);

  // "Kindly apna naam bata dein" loses its first word and becomes a sentence
  // starting in lower case, which reads as a typo rather than as casual.
  t = t.replace(/([.!?]\s+)([a-z])/g, (_, gap, ch) => gap + ch.toUpperCase());

  // Full transliteration is the tell. "batayein" becomes "btayen".
  t = shorten(t, lang);

  t = clampWords(t, maxWords);
  return t;
}

/** Cut at a sentence boundary if there is one, otherwise at the word. */
function clampWords(text, maxWords) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;

  const cut = words.slice(0, maxWords).join(' ');
  const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'));
  if (lastStop > cut.length * 0.5) return cut.slice(0, lastStop + 1);
  return cut.replace(/[,;:]$/, '') + '.';
}

/* ── how long a person would have taken ──────────────────── */

/**
 * How long after their message our reply should land.
 *
 * Base pause plus typing time, because someone answering "haan" does not take
 * as long as someone explaining a meta description, and the same delay on
 * both is noticeable after you have watched a few conversations.
 *
 * This is a target for the whole gap, not a sleep. The caller subtracts what
 * has already been spent bundling and thinking — see `waitFor` below.
 */
export function typingDelayMs(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const jitter = 0.85 + Math.random() * 0.35;
  const ms = (config.replyDelayMs + words * config.msPerWord) * jitter;
  return Math.round(Math.min(config.maxDelayMs, Math.max(3500, ms)));
}

/**
 * The sleep that actually happens, given how long ago they wrote.
 * Always leaves a short gap, so a slow model never produces a reply that
 * lands the instant the person stops typing.
 */
export function waitFor(text, sinceMs) {
  const target = typingDelayMs(text);
  const spent = Number.isFinite(sinceMs) ? Math.max(0, Date.now() - sinceMs) : 0;
  return { target, sleep: Math.max(config.minDelayMs, target - spent) };
}

/**
 * People send the answer, then the afterthought, as two messages. One bubble
 * is the norm; split only when the reply is genuinely long and there is a
 * clean break to split on, otherwise it looks staged.
 */
export function bubbles(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  const byLine = t.split('\n').map((s) => s.trim()).filter(Boolean);
  if (byLine.length === 2 && byLine.every((l) => l.split(/\s+/).length >= 3)) return byLine;
  if (byLine.length > 2) return [byLine.slice(0, -1).join(' '), byLine.at(-1)];

  const words = t.split(/\s+/);
  if (words.length < 28) return [t];

  const sentences = t.match(/[^.!?]+[.!?]*/g) || [t];
  if (sentences.length < 2) return [t];

  const last = sentences.at(-1).trim();
  const head = sentences.slice(0, -1).join(' ').trim();
  if (last.split(/\s+/).length < 3 || head.split(/\s+/).length < 5) return [t];
  return [head, last];
}

/** First word of a reply, so the next one can be told not to reuse it. */
export const opener = (text) =>
  String(text || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}']/gu, '')
    .toLowerCase() || '';
