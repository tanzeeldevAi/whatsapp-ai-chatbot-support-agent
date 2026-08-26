import { config } from './config.js';
import { createLimiter, estimateTokens } from './limiter.js';

/**
 * One function the rest of the app calls, two providers behind it.
 *
 * The second slot is not redundancy theatre. A free tier is a rate limit
 * wearing a friendly name, and the moment it trips, every waiting person
 * gets silence. The fallback turns that into a slightly slower reply.
 *
 * Provider shapes supported:
 *   'openai'  anything OpenAI-compatible — Groq, OpenRouter, xAI, DeepSeek
 *   'gemini'  Google's generativelanguage endpoint
 */

/**
 * One queue per model, because the allowance is per model. When the 70b
 * model's minute is full, the smaller fallback still has its own room — which
 * is what makes the second slot useful rather than decorative.
 */
const limiters = new Map();
const limiterFor = (slot) => {
  const key = `${slot.baseUrl || slot.provider}|${slot.model}`;
  if (!limiters.has(key)) {
    limiters.set(
      key,
      createLimiter({
        tokensPerMinute: slot.tokensPerMinute,
        requestsPerMinute: slot.requestsPerMinute,
        maxWaitMs: config.aiMaxQueueMs,
        onWait: (ms, waited) => {
          if (waited === 0) {
            console.log(`[ai] ${slot.model} minute is full, queued (about ${Math.round(ms / 1000)}s)`);
          }
        },
      })
    );
  }
  return limiters.get(key);
};

class RateLimited extends Error {
  constructor(retryAfterMs) {
    super('rate limited');
    this.retryAfterMs = retryAfterMs;
  }
}

async function askOpenAICompatible(slot, system, user) {
  const res = await fetch(`${slot.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${slot.apiKey}`,
    },
    body: JSON.stringify({
      model: slot.model,
      temperature: slot.temperature,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(slot.timeoutMs),
  });
  if (res.status === 429) {
    // Free tiers are generous until three people message at once. The header
    // usually says how long, and it is usually a couple of seconds — well
    // inside the pause we were going to take anyway, so waiting beats
    // falling through to a holding line.
    const after = Number(res.headers.get('retry-after')) * 1000;
    throw new RateLimited(Number.isFinite(after) && after > 0 ? after : 2000);
  }
  if (!res.ok) throw new Error(`${slot.model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data?.choices?.[0]?.message?.content || '',
    tokens: data?.usage?.total_tokens || 0,
  };
}

async function askGemini(slot, system, user) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${slot.model}:generateContent` +
    `?key=${slot.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: slot.temperature,
        // Generous, because the flash models spend tokens thinking before
        // they answer and a tight cap arrives as half-written JSON.
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(slot.timeoutMs),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
    tokens: data?.usageMetadata?.totalTokenCount || 0,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(slot, system, user) {
  const call = () =>
    slot.provider === 'gemini' ? askGemini(slot, system, user) : askOpenAICompatible(slot, system, user);

  // Prompt plus the room the answer is allowed to take. Wait for that much
  // to be genuinely free before spending it.
  const estimate = estimateTokens(system, user) + 400;

  // A single request bigger than the whole minute can never succeed, however
  // long it queues. Say so and let the caller try the next slot instead of
  // waiting three minutes to be told 413.
  if (estimate > slot.tokensPerMinute) {
    throw new Error(
      `${slot.model} allows ${slot.tokensPerMinute} tokens a minute and this needs about ${estimate}`
    );
  }

  const settle = await limiterFor(slot).reserve(estimate);

  try {
    const out = await call();
    settle(out.tokens);
    return out.text;
  } catch (err) {
    // The window said there was room and the API disagreed. Its answer wins:
    // charge the estimate anyway so the next decision is conservative, then
    // wait as long as it asked and try once more.
    if (!(err instanceof RateLimited)) {
      settle(estimate);
      throw err;
    }
    settle(estimate);
    const wait = Math.min(err.retryAfterMs, 10_000);
    console.warn(`[ai] ${slot.model} said 429 anyway, waiting ${wait}ms and retrying once`);
    await sleep(wait);
    const retrySettle = await limiterFor(slot).reserve(estimate);
    try {
      const out = await call();
      retrySettle(out.tokens);
      return out.text;
    } catch (again) {
      retrySettle(estimate);
      throw again;
    }
  }
}

/**
 * Models return JSON most of the time. This handles the rest of the time.
 * Anything that cannot be understood is thrown away rather than sent — a
 * fragment of JSON arriving in someone's chat is unrecoverable.
 */
function parseJson(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }

  // A bare sentence with no JSON at all. Usable, but not trusted enough to
  // let the bot keep driving afterwards.
  const looksLikeBrokenJson = cleaned.includes('"reply"') || cleaned.startsWith('{');
  if (!looksLikeBrokenJson && cleaned.length < 400) return { reply: cleaned, handoff: true };
  return null;
}

/**
 * @returns {Promise<null | {reply: string, audience?: string, handoff?: boolean,
 *                           name?: string|null, city?: string|null}>}
 *          null means every provider failed and the caller must fall back.
 */
export async function generate(system, user) {
  const slots = [config.ai, config.ai2].filter((s) => s.apiKey && (s.baseUrl || s.provider === 'gemini'));
  if (!slots.length) {
    console.warn('[ai] no provider configured, staying silent');
    return null;
  }

  for (const [i, slot] of slots.entries()) {
    try {
      const parsed = parseJson(await ask(slot, system, user));
      // A decision to forward carries no reply text by design. Requiring one
      // here made every correctly-refused company pitch look like a model
      // failure, and it got a holding line instead of being handed over.
      if (parsed?.reply || parsed?.forward === true) {
        if (i > 0) console.warn(`[ai] answered by fallback slot (${slot.model})`);
        return parsed;
      }
      console.warn(`[ai] ${slot.model} returned nothing usable`);
    } catch (err) {
      console.warn(`[ai] ${slot.provider}/${slot.model} failed: ${err.message}`);
    }
  }
  return null;
}

/**
 * Read the question, read the answer, and say whether one is about the other.
 *
 * A student wrote that he had a US client, was writing local content and
 * guest posts, and could not pay vendor sites from Pakistan because PayPal
 * is unavailable and he only has Payoneer — what should he do? He was sent
 * "Hum ap k sath one-on-one meeting krna chahty hy... Local SEO ka proper
 * roadmap dena", a sales message lifted out of the retrieved history. Every
 * word of it was fluent, and it had nothing to do with what he asked.
 *
 * Nothing in the pipeline could catch that. The guards check for specific
 * mistakes — claiming to be human, claiming to have noted a name, sending
 * somebody to a group — and each one exists because that exact thing
 * happened. This is the general case: the reply is well formed, breaks no
 * rule, and answers a different question.
 *
 * So it is checked by a second pass that sees only the question and the
 * answer, with none of the retrieved material that caused the problem. It is
 * asked to fail things, because the failure mode being guarded against is a
 * confident wrong answer and a lenient judge is no judge.
 *
 * Cheap on purpose: a few hundred tokens, no history, no syllabus. It runs
 * on the primary model — an 8b judging a 70b is the wrong way round.
 *
 * @returns {Promise<{ok: boolean, why: string}>} ok:true when it cannot be
 *          shown to be wrong. A judge that is unreachable must not silence
 *          the bot, so an error here passes.
 */
export async function verifyAnswer(question, reply) {
  const slot = [config.ai, config.ai2].find((s) => s.apiKey && (s.baseUrl || s.provider === 'gemini'));
  if (!slot || !config.verify) return { ok: true, why: 'not checked' };

  const system = `You check whether a reply answers the message it is replying to. You are strict.

Answer NO when:
- the reply is about a different subject than the message
- the message asks how to do something and the reply talks about something else
- the reply offers a meeting, a call or a roadmap that the person did not ask for
- the reply answers a question the person did not ask

Answer YES when the reply addresses what was actually asked, even if it is short, even if it says the answer will be confirmed later. "I will check this and confirm" is a valid answer to a hard question.

The messages are Roman Urdu mixed with English. Judge the meaning, not the spelling.

Reply with JSON only: {"answers": true or false, "why": "six words"}`;

  const user = `MESSAGE FROM THE STUDENT:\n${String(question).slice(0, 700)}\n\nTHE REPLY WE ARE ABOUT TO SEND:\n${String(reply).slice(0, 700)}`;

  try {
    const parsed = parseJson(await ask(slot, system, user));
    if (typeof parsed?.answers !== 'boolean') return { ok: true, why: 'judge unclear' };
    return { ok: parsed.answers, why: String(parsed.why || '').slice(0, 60) };
  } catch (err) {
    console.warn('[verify] check failed, letting it through:', err.message);
    return { ok: true, why: 'judge unreachable' };
  }
}

/* ── voice notes ─────────────────────────────────────────────
   Half the messages on a Pakistani support number are voice. Refusing them
   with "please type it out" is the least human thing the bot could do, and
   it costs an answer. Whisper on the same free key handles Urdu well. */

/** Devanagari. Hindi's script, and never something a student typed. */
const DEVANAGARI = /[ऀ-ॿ]/;

async function whisper(buffer, mime, language = null) {
  const ext = (mime || '').includes('mp4') ? 'mp4' : (mime || '').includes('mpeg') ? 'mp3' : 'ogg';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'audio/ogg' }), `note.${ext}`);
  form.append('model', config.audio.model);
  if (language) form.append('language', language);
  form.append('response_format', 'json');

  const res = await fetch(`${config.audio.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.audio.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return String((await res.json())?.text || '').trim();
}

/**
 * A voice note, as words.
 *
 * The language is left for it to detect, because these arrive in Urdu, in
 * English, and in both at once, and forcing one produces confident nonsense
 * on the other.
 *
 * But Urdu and Hindi are the same spoken language written in two scripts, so
 * "detect" regularly lands on Hindi. A real voice note came back as
 * "अच्छा यह नया पे और साधा पे से कौन सा ज्यादा ट्रस्ट…" — the student had said
 * nothing Hindi, that is simply the script Whisper picked. It is useless
 * downstream: the retrieval index holds English and Roman Urdu, so it matches
 * nothing, and the owner has been explicit that no Hindi goes anywhere near
 * this bot.
 *
 * So detection runs first, and only a Devanagari result is asked again with
 * Urdu pinned. English voice notes never reach the second call.
 */
export async function transcribe(buffer, mime) {
  if (!config.audio.enabled || !config.audio.apiKey) return null;

  try {
    let text = await whisper(buffer, mime);

    if (DEVANAGARI.test(text)) {
      console.warn('[voice] came back in Hindi script, asking again in Urdu');
      try {
        const urdu = await whisper(buffer, mime, 'ur');
        if (urdu && !DEVANAGARI.test(urdu)) text = urdu;
      } catch (err) {
        console.warn('[voice] the Urdu retry failed, keeping what we had:', err.message);
      }
    }

    return text || null;
  } catch (err) {
    console.warn('[ai] transcription failed:', err.message);
    return null;
  }
}
