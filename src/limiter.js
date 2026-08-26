/**
 * A queue in front of the model, so a busy minute costs time instead of
 * quality.
 *
 * The free tier allows a fixed number of tokens per minute. The first way we
 * handled that was to send less — a shorter prompt, fewer turns of history —
 * which kept everybody fast and made everybody's answers worse. That is the
 * wrong trade for a support number: a student who waits ninety seconds and
 * gets the right answer is far better served than one who gets "main dekh ke
 * btata hun" in seven seconds.
 *
 * So nothing is trimmed. Requests line up, first come first served, and each
 * one waits until there is genuinely room in the window for it.
 *
 * How it works: a rolling sixty second log of what has been spent. Before a
 * call we estimate its cost and, if the window is full, sleep exactly long
 * enough for the oldest entry to age out. Afterwards the estimate is
 * corrected with the real figure the API reports, so the next decision is
 * made on facts rather than on arithmetic.
 *
 * Calls are serialised through one promise chain. Two callers each deciding
 * there is room for one more is precisely how a limiter fails.
 */

export function createLimiter({
  tokensPerMinute,
  requestsPerMinute,
  maxWaitMs,
  // A minute in production. Adjustable only so the tests can watch a real
  // queue form and drain in a few hundred milliseconds instead of waiting
  // out a real one — untestable rate limiting is how rate limiting goes
  // wrong quietly.
  windowMs = 60_000,
  // Never spend the last slice of the budget. The API counts tokens its own
  // way and being a few percent out at the boundary means a 429 anyway.
  headroom = 0.9,
  onWait = () => {},
}) {
  const tokenBudget = Math.floor(tokensPerMinute * headroom);
  const requestBudget = Math.floor(requestsPerMinute * headroom);

  /** @type {{at: number, tokens: number}[]} */
  let spent = [];
  let chain = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const prune = (now) => {
    spent = spent.filter((e) => now - e.at < windowMs);
  };

  const used = () => spent.reduce((n, e) => n + e.tokens, 0);

  /** How long until enough of the window has aged out to fit `need`. */
  function waitFor(need, now) {
    if (spent.length + 1 <= requestBudget && used() + need <= tokenBudget) return 0;

    // Walk the log oldest first, working out how much frees up and when.
    let freed = 0;
    for (const [i, entry] of spent.entries()) {
      freed += entry.tokens;
      const requestsLeft = spent.length - (i + 1);
      const fits = used() - freed + need <= tokenBudget && requestsLeft + 1 <= requestBudget;
      if (fits) return Math.max(0, entry.at + windowMs - now);
    }
    // Even an empty window would not fit it. Wait for the whole window.
    return spent.length ? Math.max(0, spent[0].at + windowMs - now) : 0;
  }

  /**
   * Reserve room for a call. Resolves when it may proceed.
   * @returns {Promise<(actualTokens?: number) => void>} call it with the real
   *          usage once the API has answered.
   */
  function reserve(estimate) {
    const run = async () => {
      let waited = 0;
      for (;;) {
        const now = Date.now();
        prune(now);
        const wait = waitFor(estimate, now);
        if (wait <= 0) break;

        if (waited + wait > maxWaitMs) {
          throw new Error(
            `queue would take ${Math.round((waited + wait) / 1000)}s, over the ${Math.round(
              maxWaitMs / 1000
            )}s limit`
          );
        }
        onWait(wait, waited);
        // Re-check periodically rather than sleeping the whole way: an
        // earlier call settling for less than its estimate can free room
        // sooner than the arithmetic predicted.
        const nap = Math.min(wait, Math.max(50, windowMs / 12));
        await sleep(nap);
        waited += nap;
      }

      const entry = { at: Date.now(), tokens: estimate };
      spent.push(entry);
      return (actual) => {
        if (Number.isFinite(actual) && actual > 0) entry.tokens = actual;
      };
    };

    // Serialise. Each caller waits for the one in front to have reserved,
    // which is what makes the accounting trustworthy and the order fair.
    const next = chain.then(run, run);
    chain = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  return {
    reserve,
    /** For logging: how much of this minute is already committed. */
    state: () => {
      prune(Date.now());
      return { used: used(), budget: tokenBudget, queued: spent.length };
    },
  };
}

/** Rough but consistent. Four characters to a token is close enough here. */
export const estimateTokens = (...parts) =>
  Math.ceil(parts.filter(Boolean).join(' ').length / 4);
