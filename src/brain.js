import { config } from './config.js';
import { generate, verifyAnswer } from './ai.js';
import { humanize, opener } from './humanize.js';
import { langLabel, resolveLang } from './lang.js';
import { systemPrompt, userPrompt } from './persona.js';
import { getSettings, joinWaitlist, readOpeners } from './db.js';
import { reminderLine } from './reminders.js';
import { FACTS } from './knowledge.js';
import { lookupStudent } from './students.js';
import { IS_COURSE_ADMIN, focusModules } from './syllabus.js';
import { asksWhenBatch, greetingFor, knownAnswer } from './known-answers.js';
import { alreadyTaught } from './knowledge-base.js';
import { honest } from './claims.js';
import { pickAnswer } from './pick.js';

/**
 * Who is this, what do they need, and what do we say.
 *
 * The order matters and it is deliberate:
 *
 *   certainty first   the student roster, which cannot be wrong
 *   then memory       what this contact already turned out to be
 *   then keywords     cheap, obvious signals
 *   then the model    which only ever gets to decide what nothing else could
 *
 * A model asked to classify from scratch on every message will eventually
 * change its mind mid conversation, and a person who was a "new enquiry" at
 * 2pm and a "student" at 2:05 gets two contradictory answers.
 */

/* ── the cheap signals ───────────────────────────────────── */

const COURSE_TOPIC =
  /\b(on ?page|off ?page|onpage|offpage|seo|backlink|back ?link|guest ?post|citation|keyword|kw ?research|serp|search console|gsc|analytics|ga4|schema|sitemap|robots\.?txt|meta ?(title|description|tag)|h1|permalink|slug|internal link|anchor|domain|hosting|cpanel|ftp|ssl|https?|wordpress|wp[- ]?admin|elementor|plugin|theme|woocommerce|yoast|rank ?math|gbp|gmb|google (business|my business)|business profile|map ?pack|listing|nap|review|website (bana|issue|problem|down|error)|404|redirect|indexing|index nahi|rank nahi|traffic nahi|assignment|recording|lecture|class ka|module|task)\b/i;

/**
 * Note what is deliberately NOT in here: a bare `charges`, `price` or `fees`.
 *
 * They used to be, and "Sir hosting charges?" was therefore read as a question
 * about the course fee and answered with the scripted "details announcement ke
 * saath share karenge" — confidently, and about entirely the wrong thing. A
 * money word only means the course when it says so.
 */
const BATCH_ENQUIRY = new RegExp(
  [
    '\\b(new batch|next batch|naya batch|nya batch|batch kab|kab start|kab shuru|start ?date)\\b',
    '\\b(admission|daakhla|dakhla|registration|register|enroll|enrol|join karna|join krna|seat)\\b',
    // money, but only where it is plainly the course being asked about
    '\\b(fees? kitni|fee kitni|course (ki |ka )?fees?|batch (ki |ka )?fees?|admission fees?)\\b',
    '\\b(fees?|cost|price|charges?) (for|of) (the |this )?(course|batch|class|training)\\b',
    '\\bhow much (is|for|does) (the |this )?(course|batch|class|training)\\b',
    '\\b(course ?(details|info|kya)|course k? bare|timing|schedule)\\b',
    '\\b(kaisay join|how to join|want to learn|sikhna hai|seekhna)\\b',
  ].join('|'),
  'i'
);

/**
 * Somebody asking what something costs, where that something is not ours.
 *
 * We know one price and it is the course fee. Hosting, domains, themes, tools,
 * somebody else's service — those are numbers we do not have, that change
 * constantly, and that are worth getting wrong to nobody. Ask the owner.
 */
/**
 * Somebody who wants to join, however they phrase it.
 *
 * Checked before the topic keywords, because "I want to learn Local SEO" is a
 * lead saying they want in, not a graduate asking a technical question. The
 * word "SEO" in it used to win, which sent a prospective student down the
 * expert branch and got them a holding line.
 */
const WANTS_TO_JOIN =
  /\b(want to (learn|join|enroll|start)|i want to learn|interested in (the )?(course|batch|joining)|sikhna (hy|hai|chahta|chahti)|seekhna (hy|hai)|join (karna|krna) (hy|hai|chahta)|admission (lena|leni)|course (join|start) krna)\b/i;

const ASKS_PRICE_PATTERNS = [
  // an actual money word
  /\b(charges?|pricing|fees?|paisa|paise|paisay|rupees?|\brs\b|\bpkr\b|dollar|\busd\b)\b/i,
  /\b(price|cost|rate)\b/i,
  // "kitne ka hy", "kitni ki hy" — the cost idiom, and only the cost idiom
  /\bkitn[aeiy]+\s+(ka|ki|ke)\b/i,
];

/**
 * Careful with this one.
 *
 * A bare `kitna` used to be in here, and "citations **kitne** time me juice
 * pass krty hain" was forwarded as a price question. `kitna` is how you ask
 * how much of *anything* in Urdu — kitne din, kitne pages, kitni der, kitne
 * backlinks — so on its own it means nothing about money. It needs either a
 * real money word or the "kitne ka" idiom.
 */
const ASKS_PRICE = { test: (t) => ASKS_PRICE_PATTERNS.some((rx) => rx.test(t)) };

/**
 * "Ok", "thanks", a thumbs up. Nothing was asked.
 *
 * The bot answered "Thank you" with "You're all set, feel free to ask if you
 * need anything else" — the exact filler a real person never types, turning a
 * finished conversation into one more notification. Silence is the right
 * reply to gratitude.
 */
/**
 * Note the honorifics on both ends, and why they are not optional decoration.
 *
 * This missed "Ok g" — the single most common way to end a conversation on
 * this number — because it allowed only whitespace and punctuation after the
 * word. "g", "ji", "sir", "bhai" are how politeness is attached in Urdu, and
 * they turn up on nearly every acknowledgement: "ok g", "theek hai ji",
 * "thanks sir", "acha bhai". Without them, a finished conversation looked
 * like a new message, went to the model, and got answered with a fresh salam
 * — so somebody who had said goodbye was greeted again and asked what they
 * needed. Exactly the thing this pattern exists to prevent.
 */
const JUST_ACKNOWLEDGING =
  /^[\s\p{P}]*(?:(?:g|ji|jee|gi|sir|bhai|bro|dear)\b[\s\p{P}]*)*(?:(?:sure|ok(ay|y)?|acha|achha|theek|thk|sahi|right|fine|alright)[\s\p{P}]+)*(sure|ok(ay|y)?|k|thanks?|thank you|thnx|tnx|ty|shukriya|shukria|jazakallah|jzk|acha|achha|theek|theek h(ai|y)|thk|sahi|great|perfect|noted|got it|samajh (gaya|gya)|hmm+|right|done|no problem|welcome)(?:[\s\p{P}]*(?:g|ji|jee|gi|sir|bhai|bro|dear|thanks?|shukriya)\b)*[\s\p{P}]*$/iu;

/** Emoji, and nothing else. */
const EMOJI_ONLY = /^[\s\p{P}\p{Extended_Pictographic}\u{FE0F}\u{200D}]+$/u;

const ESCALATE =
  /\b(refund|paisa wapas|paise wapis|payment ki|maine pay|fees pay|already paid|receipt|invoice|complain|complaint|shikayat|fraud|scam|dhoka|cheat|legal|lawyer|fia|certificate nahi|result galat)\b/i;

/**
 * They want a person, not this.
 *
 * Kept separate from ESCALATE and checked against the reply as well as the
 * question, because this is the one place the bot must not improvise. Asked
 * "ap real ho na", it answered "Haan main real person hun" — a lie, and one
 * that collapses the moment they ask something a person would answer
 * differently, taking everything said before it with it.
 *
 * Someone who asks has already decided. The honest move is to fetch a human.
 */
const WANTS_HUMAN_PATTERNS = [
  // "who am I talking to"
  /\b(ap|aap) k?on (ho|hain|hy)\b|\bwho are you\b|\bkis se baat ho rahi\b/i,
  // "are you real" — deliberately loose about the spelling of "person",
  // because the message that got through said "real perosn" and an exact
  // match let a lie out over one transposed letter.
  /\breal\b[^.!?]{0,20}\b(p[ae]r?s?on|perosn|banda|bnda|insan|insaan|aadmi|admi)\b/i,
  /\b(insan|insaan|human|bot|robot|ai) (ho|hain|hn|hun)\b/i,
  /\b(are|r) (you|u) (a |an )?(human|real|bot|robot|ai|person)\b|\bis this a bot\b/i,
  // "put me through to someone"
  /\b(sir se baat|sir wali|owner se|kisi se baat|banday se baat|baat kar(wa|a) ?d[eo])\b/i,
  /\b(number (dy|de|dey) ?d|number chahye|number bhej|call me|call kar|phone kar)\b/i,
];

const WANTS_HUMAN = { test: (t) => WANTS_HUMAN_PATTERNS.some((rx) => rx.test(t)) };

/**
 * The one thing it must never send. Checked on the way out, not on the way in.
 *
 * Written around the claim rather than around a phrase, because the first
 * version looked for "main real person hun" and the model said "main
 * hamari team se ek human supporter hoon" instead. Any first-person
 * sentence containing human, insan or real person is the same lie.
 */
const CLAIMS_HUMAN_PATTERNS = [
  /\b(main|mein|mai)\b[^.!?]{0,45}\b(human|insaan|insan|real p[ae]r?s?on|asli banda|real banda)\b/i,
  /\bi ?(a|')?m\b[^.!?]{0,30}\b(human|real person|a person|not a bot|no bot)\b/i,
  /\b(yes|haan|han|ji)\b[^.!?]{0,15}\b(human|insaan|insan)\b[^.!?]{0,10}\b(hun|hoon|hain|am)\b/i,
  /\bbot nahi\b|\bnot a bot\b|\brobot nahi\b/i,
];

const CLAIMS_HUMAN = { test: (t) => CLAIMS_HUMAN_PATTERNS.some((rx) => rx.test(t)) };

/**
 * The sales pitch that lives in the mined history.
 *
 * "Hum ap k sath one-on-one meeting krna chahty hy. Is meeting ka maqsad ap
 * ko Local SEO ka proper roadmap dena..." — a real message, sent for a real
 * reason once, and now sitting in the corpus where retrieval can reach it.
 * It went to somebody asking how to pay a vendor from Pakistan.
 *
 * Arranging a meeting commits the owner's time and sets an expectation he did
 * not agree to. If somebody genuinely wants one they will say so, and then
 * it is forwarded to him like any other thing only he can decide.
 */
const OFFERS_MEETING =
  /\b(one[- ]?on[- ]?one|1[- ]?on[- ]?1)\b|\b(meeting|call|session|zoom|consultation)\b[^.!?]{0,30}\b(krna chahty|karna chahte|chahty hy|arrange|schedule|set kar|book kar|rakhte hain|rakhna chahte)\b|\bmeeting ka maqsad\b/i;

/** Unless they asked for one, in which case it is theirs to raise. */
const ASKED_FOR_MEETING =
  /\b(meeting|call|zoom|baat|session|consultation)\b[^.!?]{0,25}\b(ho sakti|ho skti|kar sakte|kr sakty|chahiye|chahye|chahta|chahti|possible|arrange|schedule|book)\b|\bcall me\b|\bmeeting chahiye\b|\bbaat karni hy\b/i;

/**
 * Messages that are plainly not a student. The model decides the subtle
 * cases; these are the ones it should never have to think about.
 *
 * Three separate literals rather than one built from strings. Inside a
 * string, `\b` is a backspace character and the pattern silently matches
 * nothing; inside a literal it is the word boundary it looks like. Both
 * mistakes have already been made here once each, and neither announced
 * itself — the first forwarded nothing, the second would have matched
 * "dating" inside "up-dating" and forwarded a student asking about a site
 * update. The boundaries are load bearing, so they get to be obvious.
 */
const NOT_OURS_PATTERNS = [
  // spam and scams
  /\b(invoice attached|unsubscribe|limited offer|crypto|bitcoin|forex|casino|betting|escort)\b/i,
  // somebody wanting a job from us
  /\b(we are hiring|job opening|apply now|send (your )?cv|resume attached|portfolio dekh|hire kr rhe)\b/i,
  // agencies and resellers pitching
  /\b(our (company|agency|firm)|we are an? [a-z ]{0,20}(agency|company)|we (can |also )?(provide|offer|deliver)|we speciali[sz]e|white ?label|business proposal|collaboration opportunity|partnership opportunity|sponsored post|guest post opportunity|link building service|buy backlinks|smm panel)\b/i,
  /* A partnership pitch, dressed as a long formal business letter.
     One arrived about "combining our command of this specialized field",
     a "90-day pilot" and "monetization through our digital platforms". None
     of the phrases above appear in it, so it reached the model — which
     answered as "a niche-based agency in US, Canada", offered a meeting, and
     then invented a recruitment service to find them a candidate. Every word
     of that was made up.
     These are words a student asking about their homework does not use. */
  /\b(moneti[sz]ation|moneti[sz]e|joint venture|equity|revenue share|revenue sharing|profit share|our ecosystem|our platform|our clients are|our network|strategic partner|partner with us|team up with us|onboard(ing)? partners?|pilot program|90[- ]day pilot)\b/i,
  /\b(let us|lets|we should|shall we|can we)\b[^.!?]{0,25}\b(collaborate|partner|work together|team up)\b/i,
  /\b(looking for|need)\b[^.!?]{0,25}\b(someone|somebody|a person|a candidate|an expert|expertise)\b[^.!?]{0,30}\b(who can|to (structure|build|manage|run|scale|moneti[sz]e))\b/i,
];

const NOT_OURS = { test: (text) => NOT_OURS_PATTERNS.some((rx) => rx.test(text)) };


/**
 * A commitment the bot has no business making.
 *
 * It told a student "I'll be there at 6:30 Saudi time". It has no calendar,
 * cannot attend anything, and nobody had agreed a meeting — it invented the
 * promise while trying to be helpful. That person would have waited.
 *
 * A wrong SEO answer can be corrected the next day. A missed meeting cannot,
 * and it is the owner's name on it. So this is checked on the way OUT, like
 * CLAIMS_HUMAN: whatever the model wrote, if it commits to a time, a call or
 * being somewhere, it is not sent. He decides those.
 */
const PROMISES_MEETING_PATTERNS = [
  // being somewhere, or turning up
  /\bi(\s?'?ll| will| am going to| can)\b[^.!?]{0,30}\b(be there|join|attend|come|available|online|present)\b/i,
  /\b(main|mein)\b[^.!?]{0,30}\b(aa ?jaunga|aa ?jaon|hazir|available|online|hounga|hunga|join kar ?lunga)\b/i,
  // agreeing a time or a date
  /\b(at|by|around)\s*\d{1,2}(:\d{2})?\s*(am|pm|baje|bje)?\b[^.!?]{0,25}\b(meeting|call|zoom|session|time)\b/i,
  /\b(meeting|call|zoom|session)\b[^.!?]{0,30}\b(at|by|around|per|pe)\s*\d{1,2}(:\d{2})?\s*(am|pm|baje|bje)\b/i,
  /\b(kal|aaj|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[^.!?]{0,25}\b(meeting|call|zoom|milte|baat karte)\b/i,
  // scheduling on his behalf
  // "let me" as well as "I will" — the offer is the same commitment either way
  /\b(i|we|let me|let us)\b[^.!?]{0,20}\b(schedule|arrange|set up|book|fix)\b[^.!?]{0,20}\b(meeting|call|zoom|session|time)\b/i,
  /\b(meeting|call)\b[^.!?]{0,20}\b(fix|set|schedule|arrange)\b[^.!?]{0,15}\b(kar ?d|kr ?d|karta|krta)\w*/i,
  // promising to phone them
  /\b(i(\s?'?ll| will)\s*(give you a |)call|call you|phone you|ring you)\b/i,
  /\b(call|phone)\b[^.!?]{0,15}\b(kar ?lunga|krunga|karunga|kr lunga)\b/i,
];

const PROMISES_MEETING = { test: (t) => PROMISES_MEETING_PATTERNS.some((rx) => rx.test(t)) };

/**
 * Somebody who wants to hire us, not learn from us.
 *
 * NOT_OURS already catches an agency pitching at us. This is the other
 * direction and it was missed entirely: a business owner asking us to do
 * their SEO. "Meri website rank karwani hai, charges kya hain" is a sales
 * conversation worth real money, and the bot was answering it as though they
 * were a student — giving the work away for free and losing the client in
 * the same message. It goes to the owner.
 *
 * Deliberately not triggered by a student saying "my client", which is what
 * half the course is about. It needs them wanting the work done FOR them.
 */
const WANTS_SERVICE_PATTERNS = [
  /\b(mer[ia]|meri|hamari|apni)\b[^.!?]{0,25}\b(website|site|business|shop|store|clinic|restaurant)\b[^.!?]{0,30}\b(rank|seo|promote|market|design|bana|banwa)\w*\s*(karwa|krwa|karna hai|krna hai|karwani|krwani|karwana|krwana)/i,
  /\b(can|could|will) you\b[^.!?]{0,25}\b(do|handle|manage|run|rank|optimi[sz]e|build)\b[^.!?]{0,20}\b(my|our)\b[^.!?]{0,15}\b(seo|website|site|business|gmb|gbp|ads)\b/i,
  /\b(seo|website|gmb|gbp)\b[^.!?]{0,20}\b(service|services|package|packages)\b[^.!?]{0,25}\b(chahiye|chahye|chaiye|want|need|de sakte|dete)\b/i,
  /\bi (want|need) (you|someone) to\b[^.!?]{0,25}\b(rank|do seo|build|design|manage|handle)\b/i,
  /\b(hire|hiring)\b[^.!?]{0,20}\b(you|your service|for my)\b/i,
  /\b(kitna|kitne|how much)\b[^.!?]{0,25}\b(charge|charges|lete|logy|logay|loge|fee)\b[^.!?]{0,30}\b(website|seo|ranking|gmb|project)\b/i,
];

const WANTS_SERVICE = { test: (t) => WANTS_SERVICE_PATTERNS.some((rx) => rx.test(t)) };

const GREETING_ONLY =
  /^\s*(a?s+alam.{0,20}|salam|slam|hi+|hello+|hey+|ji|yes|hy|hlo|good (morning|evening|afternoon))[\s!.?]*$/i;

/**
 * A salam at the top of a reply, two minutes into a conversation.
 *
 * Somebody said "Ok g" to close things off and got "AOA, apko kis cheez ki
 * information chahiye?" — greeted a second time, and asked what he wanted
 * after he had already asked and been answered. Nobody restarts a chat they
 * are in the middle of.
 *
 * Greeting back is right exactly once, at the start, and that case is handled
 * before the model is ever called. Anything after that is the model opening a
 * letter, so the opening comes off.
 */
const OPENS_WITH_GREETING =
  /^\s*(a\.?o\.?a\.?|as+alam\s*o?\s*al[ae]i?kum|wa?\s*al[ae]i?kum\s*(as+alam)?|salam|slam|hello+|hi+|hey+|good (morning|evening|afternoon))\b[\s,!.?-]*/i;

/* ── decide the audience ─────────────────────────────────── */

function classify(contact, text) {
  // 1. The roster, if one is loaded. Certain, and it beats everything.
  const known = lookupStudent(contact.wa_id);
  if (known) return { audience: 'student', locked: true, student: known };

  /* 2. Somebody who wants to JOIN is a lead, even when they name the subject.
        "I want to learn Local SEO, when is the next batch?" was read as a
        student's technical question purely because it contains the word
        "SEO" — which loaded the whole syllabus into the prompt, blew past
        the fallback model's limit, and got them a holding line to the most
        basic question we have. Wanting in beats naming the topic. */
  if (WANTS_TO_JOIN.test(text)) return { audience: 'enquiry', locked: true };

  if (BATCH_ENQUIRY.test(text) && !COURSE_TOPIC.test(text)) {
    return { audience: 'enquiry', locked: true };
  }

  // 3. Obviously a course question.
  if (COURSE_TOPIC.test(text)) return { audience: 'student', locked: true };

  // 4. "g btain", "ok", "acha", "shukriya". Not a new subject, a
  //    continuation — so stay in whatever the conversation already was.
  const words = text.trim().split(/\s+/).length;
  if (GREETING_ONLY.test(text) || words <= 3) {
    return { audience: contact.kind && contact.kind !== 'unknown' ? contact.kind : 'unknown', locked: true };
  }

  // 5. Anything else is somebody who needs help. Answer it properly.
  //
  //    This used to fall through to the model, which sent a real question
  //    about niche research down the "new enquiry" path and got a two line
  //    brush-off. Support is open to everyone now, so helping is the default
  //    and a keyword list no longer has to be exhaustive to be safe.
  return { audience: 'student', locked: true };
}

/**
 * The reminder is due only when all three are true. Each one exists because
 * without it the bot nags:
 *   - they are a student, not a stranger being told about a group they
 *     have no reason to join
 *   - they actually asked a course question, not "thank you"
 *   - we have not already said it this week
 */
function reminderDue(contact, audience, text) {
  // Support is given to everyone here, so by default there is nothing to
  // send anybody to a group for.
  if (!config.groupReminder) return false;
  if (audience !== 'student') return false;
  if (!COURSE_TOPIC.test(text) && !contact.reminder_sent_at) {
    // First contact from a roster student that is not obviously a course
    // question. Answer it, say nothing about the group yet.
    return false;
  }
  if (!COURSE_TOPIC.test(text)) return false;
  if (!contact.reminder_sent_at) return true;
  return Date.now() - contact.reminder_sent_at > config.reminderCooldownMs;
}

/** Did it actually mention the group, or did it forget? */
const mentionedGroup = (text) => /\b(f\.?b\.?|facebook|grup|group|groupe)\b/i.test(text);

/**
 * The other half of the cooldown, and the half that matters.
 *
 * Being told "support has ended, go to the group" on every single message is
 * the fastest way to make someone stop asking and stop trusting the number.
 * The prompt asks the model not to repeat it; this makes sure. Only the
 * sentence carrying the reminder is dropped, so the actual answer survives.
 *
 * This used to end `return out || text` — if stripping removed everything,
 * send the original. That made sense when the group reminder was a real
 * thing and a repeated reminder was the worst case. It is not any more.
 * Somebody asked whether he would get support after paying, and the whole
 * reply was "issues facebook group main post krain wahan response kia jay
 * ga" — so stripping emptied it and the fallback sent that exact sentence,
 * which is now false. Support is here. An empty result now means the reply
 * was nothing but a referral, and the caller forwards instead of sending it.
 */
function stripGroupLine(text) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const kept = sentences.filter(
    (s) => !(mentionedGroup(s) && /support|whatsapp|yahan|ab\b|post k(ar|r)|puch|poch|pooch|ask/i.test(s))
  );
  return kept.join('').replace(/\s+/g, ' ').trim();
}

/* ── there is no holding line, anywhere ──────────────────────
   There used to be one — "Ji main dekh ke abhi btata hun" — sent whenever
   the model was unreachable, and separately produced by the model itself
   because the prompt asked for it on every handover. So it went out
   alongside forwards: the question reached the owner and the person had
   already been told somebody was looking into it.

   He was explicit, twice. The bot does not say it will check and come back.
   A promise like that depends on somebody remembering, and the person who
   was told it waits. Silence costs nothing and is honest: they get exactly
   one message about it, the one he writes.

   So every path that used to end in a holding line now forwards in silence.
   `silent()` builds that, and it is the only thing left. */

const silent = (why, audience, lang) => ({
  forward: true,
  why,
  text: null,
  audience,
  handoff: false,
  lang,
  reminderSent: false,
  updates: { lang },
  viaAI: false,
});

/**
 * Try again shortly, and tell nobody.
 *
 * There are two different reasons a reply does not happen, and only one of
 * them is the owner's problem.
 *
 *   the question needs him    fees, LMS access, what other courses we run
 *   the bot failed            rate limited, or it answered the wrong thing
 *
 * Both used to reach his phone as "[forwarded, not answered]", so his log
 * number filled up with things he could only look at and think "the bot
 * should have handled this". He was explicit: only send him what genuinely
 * needs him.
 *
 * A model that is rate limited is not a question. Neither is an answer that
 * failed its own check — the next attempt usually passes, because the model
 * is sampling and the retrieved material shifts. So these wait and go round
 * again. Only when it keeps failing does he hear about it.
 */
const retry = (why, audience, lang) => ({
  retry: true,
  why,
  text: null,
  audience,
  handoff: false,
  lang,
  reminderSent: false,
  updates: { lang },
  viaAI: false,
});

/**
 * Somebody telling us what they will do later. Nothing was asked.
 *
 * "Sir ma laptop sy pic ly k ap ko send kro gi sham ko or phir btao gi" got
 * "Ji main dekh ke abhi btata hun" — checking on what, when she had not
 * asked anything yet. She said she would send a picture in the evening. The
 * only sensible responses are nothing at all, or "theek hai", and nothing is
 * safer than a sentence that makes no sense.
 *
 * Narrow on purpose: it needs a first person future action AND no question
 * anywhere in the message, so "kal tak rank ho jayega?" is still a question.
 */
const TELLING_US_LATER_PATTERNS = [
  /\b(bhej|send|share|kar|kr|bta|batao?|btao?|dikha|show)\w*\s*(d[eiu]n?|do|dun)?\s*(g[ia]|ga|gi|gy|ge|hun|hoon)\b/i,
  /\b(sham|shaam|raat|subah|kal|parso|baad me|baad mein|thori der|thodi der|later|evening|tonight|tomorrow)\b/i,
];

/**
 * Something wrong with the LMS itself, rather than with the subject.
 *
 * Narrower than IS_COURSE_ADMIN on purpose. That one covers everything only
 * the owner knows — fees, class links, group access — and forwards it in
 * silence. This one is the subset where a picture settles it in seconds:
 * a login that fails, a video that will not play, a course that has vanished
 * from the dashboard. Those are screens, and screens are worth photographing.
 *
 * "lecture" and "recording" are deliberately left out: "kal wali lecture ka
 * link" is a question about a link, not a broken screen, and asking that
 * person for a screenshot of nothing would be absurd.
 */
/**
 * The same dangerous questions, written in Urdu script.
 *
 * Every guard in this file is Latin-only, so a message in Urdu script slipped
 * under all of them — LMS, price, "are you human", company pitches — and went
 * straight to the model with nothing standing in its way.
 *
 * It invented freely. Asked "سر میری آئی ڈی کو اپروو کر دیں", it replied with
 * a made-up approval procedure and told the student to log in to "ہوٹسسٹر",
 * which does not exist. Three messages of it. Somebody was going to go and
 * try that.
 *
 * These are the words where being wrong costs something: an account, a
 * payment, or somebody's afternoon. Matched in Urdu script, they take the
 * same route their Roman equivalents already take — to the owner.
 */
const URDU_DANGER =
  /(آئی\s*ڈی|اپروو|تصدیق|منظور|لاگ\s*ان|لاگ‌ان|پاس\s*ورڈ|پورٹل|ڈیش\s*بورڈ|ایل\s*ای\s*ایم|فیس|قیمت|پیسے|رقم|ادائیگی|ری\s*فنڈ|واپس|اکاؤنٹ|رسائی|داخلہ|رجسٹریشن)/;

/** Is this written in Urdu script at all? */
const URDU_SCRIPT = /[؀-ۿ]/;

const IS_LMS_ROMAN =
  /\b(lms|portal|dashboard)\b|\b(login|log ?in|sign ?in|password)\b[^.!?]{0,25}\b(nahi|nhi|ni|issue|problem|error|galat|wrong|fail)\b|\b(nahi|nhi|ni)\b[^.!?]{0,15}\b(login|log ?in)\b|\b(course|video|lecture|class)\b[^.!?]{0,20}\b(open|play|chal|khul|load)\w*\s*(nahi|nhi|ni)\b|\b(video|course)\b[^.!?]{0,15}\b(nahi chal|nahi khul|buffer)\w*/i;

/* Either script. The Roman pattern above, or an Urdu-script message using
   any of the words where guessing costs somebody something. */
const IS_LMS = { test: (t) => IS_LMS_ROMAN.test(t) || (URDU_SCRIPT.test(t) && URDU_DANGER.test(t)) };

/** Not "main dekh ke btata hun" — just the one thing that actually helps. */
const ASK_SCREENSHOT = {
  roman_urdu: 'Zara us ka screenshot bhej dein.',
  english: 'Can you send a screenshot of it?',
  urdu_script: 'ذرا اس کا اسکرین شاٹ بھیج دیں۔',
};

const tellingUsLater = (text) => {
  if (/[?？]/.test(text)) return false;
  if (/\b(kaise|kese|kya|kia|kyun|kyu|kahan|kab|kitna|kitni|kitne|how|what|why|where|when|which)\b/i.test(text)) {
    return false;
  }
  // Both halves: a future action of theirs, and a time they mean to do it.
  return TELLING_US_LATER_PATTERNS.every((rx) => rx.test(text));
};

/**
 * @returns {Promise<{
 *   text: string, audience: string, handoff: boolean, lang: string,
 *   reminderSent: boolean, updates: object, viaAI: boolean
 * } | null>} null only when there was nothing to answer.
 */
export async function think(contact, incoming, history) {
  const text = String(incoming || '').trim();
  if (!text) return null;

  /* One language for everybody, when it is set. See config.replyLang. */
  const lang = config.replyLang || resolveLang(text, contact.lang);

  /* "Ok". "Thank you". A thumbs up. Nothing was asked, so nothing is said.
     The exception is when our own last message ended in a question — then a
     one word reply is an answer to it, not a sign-off. */
  if (JUST_ACKNOWLEDGING.test(text) || EMOJI_ONLY.test(text)) {
    const lastOut = [...history].reverse().find((m) => m.direction === 'out');
    if (!lastOut || !/\?\s*$/.test(String(lastOut.body || '').trim())) {
      console.log(`[brain] "${text.slice(0, 20)}" needs no reply`);
      return null;
    }
  }

  /* They are telling us they will do something later, not asking anything.
     See tellingUsLater — this is the "pic bhej kr sham ko btao gi" case. */
  if (tellingUsLater(text)) {
    console.log(`[brain] "${text.slice(0, 30)}" is them saying what they will do later`);
    return null;
  }

  const routed = classify(contact, text);

  /* Anybody asking when it starts goes on the waiting list, whatever else
     happens to their message afterwards. The answer they are about to get
     ends with "jis din registration khulegi main apko message kar dunga",
     and a promise nobody wrote down is a promise nobody keeps. Marked here
     rather than in the reply path so it still happens when the question is
     forwarded, or answered from the facts because no model was reachable. */
  if (asksWhenBatch(text) || WANTS_TO_JOIN.test(text) || BATCH_ENQUIRY.test(text)) {
    if (joinWaitlist(contact.id)) {
      console.log(`[waitlist] +${contact.wa_id} added, asked when the batch starts`);
    }
  }

  /* A bare greeting is answered without a model. There is no judgement in
     saying hello back, and the model's attempt was "Assalamo alaikum,
     hamari team se mulaqat krna chahte hain?" — which is not a sentence
     anybody would send. Only when this is genuinely the start of things:
     mid-conversation, a greeting is small talk and the model handles it. */
  if (GREETING_ONLY.test(text) && !contact.last_outbound_at) {
    return {
      text: greetingFor(text, lang),
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }
  const wantsReminder = reminderDue(contact, routed.audience, text);
  const mustEscalate = ESCALATE.test(text);
  const wantsHuman = WANTS_HUMAN.test(text);
  const obviouslyNotOurs = NOT_OURS.test(text);

  /* A price we do not have. Checked after BATCH_ENQUIRY has had its say, so
     the course fee still answers itself; anything else is a number nobody
     benefits from us inventing. Ask, do not guess. */
  /* LMS access, a fee that has not shown up, when the class is, being added
     to the group. Real questions, asked constantly, and the bot has none of
     the facts — they change every batch. Forward rather than guess. */
  /* Unless he has already answered this exact kind of thing. Then it is
     knowledge, not an unknown, and forwarding it again would be asking him
     the same question twice. */
  const taught = alreadyTaught(text);

  /* An LMS problem. Ask for the picture, then carry it to him.
     the owner can read an LMS error screen and know the fix; nothing here can.
     So the bot's whole job on these is to get the screenshot in front of him
     — see the image branch in server.js, which forwards it and says nothing.

     Asked once only. If they answer with more words instead of a picture the
     question is forwarded as it stands, because asking twice for something
     somebody has already declined to send is how a person gets annoyed and
     leaves. */
  if (IS_LMS.test(text) && !taught) {
    const askedAlready = [...history]
      .reverse()
      .slice(0, 4)
      .some((m) => m.direction === 'out' && /screenshot/i.test(String(m.body || '')));

    if (askedAlready) return silent('LMS issue, no screenshot came', routed.audience, lang);

    console.log(`[brain] LMS issue from +${contact.wa_id}, asking for a screenshot`);
    return {
      text: ASK_SCREENSHOT[lang] || ASK_SCREENSHOT.roman_urdu,
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }

  if (IS_COURSE_ADMIN.test(text) && !taught) {
    return {
      forward: true,
      why: 'course admin: access, fee, class or group',
      text: null,
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }

  const unknownPrice = routed.audience !== 'enquiry' && ASKS_PRICE.test(text) && !taught;
  if (unknownPrice) {
    return {
      forward: true,
      why: 'a price we do not have',
      text: null,
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }

  /* They asked for a person, or asked what this is. Do not send that to the
     model at all: there is exactly one right answer and it is not one the
     model should be improvising, since the tempting improvisation is a lie. */
  /* They want to hire us, not learn from us. the owner's conversation. */
  if (WANTS_SERVICE.test(text)) {
    console.log(`[brain] +${contact.wa_id} wants SEO work done, sending it to you`);
    return silent('wants us to do their SEO, this is a client not a student', routed.audience, lang);
  }

  if (wantsHuman) {
    return {
      forward: true,
      why: 'they want to speak to a person',
      text: null,
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }

  /* THE ANSWER BANK.
     Everything above this line is a deterministic rule that has already had
     its say — greetings, acknowledgements, LMS, prices, people wanting a
     human, service enquiries. What is left is a real question, and this is
     where it used to be handed to a model with five thousand tokens of
     context and permission to write whatever it liked. That permission is
     what produced "DFAA", "hotsster" and a meeting nobody agreed to.

     Now the model only chooses. See answer-bank.js for the reasoning. */
  if (config.answerBankOnly) {
    const picked = await pickAnswer(text);
    if (picked) {
      return {
        text: picked.text,
        audience: routed.audience,
        handoff: false,
        lang,
        reminderSent: false,
        updates: { lang, kind: routed.audience },
        viaAI: false,
      };
    }
    return silent('nothing in the answer bank fits this', routed.audience, lang);
  }

  const system = systemPrompt(routed.audience, {
    reminder: wantsReminder,
    overrides: getSettings(),
    // Only the module they asked about goes in the prompt. See syllabus.js.
    focus: focusModules(text),
    // The question itself, so the real course material can be looked up.
    incoming: text,
  });
  /* Yesterday's subject is not today's. Past the gap the transcript is left
     out entirely, so the bot cannot answer "hi" with the topic they were on
     the last time they spoke. */
  // Measured from our last reply, not from the last message in the history —
  // the history already contains the message being answered right now, so
  // that gap is always zero and the check never fired. Our last outbound is
  // where the previous conversation actually ended.
  const lastAt = contact.last_outbound_at || 0;
  const fresh = Boolean(lastAt) && Date.now() - lastAt > config.freshAfterMs;

  const user = userPrompt({
    contact,
    history,
    incoming: text,
    langHint: langLabel(lang),
    lastOpeners: readOpeners(contact),
    fresh,
  });

  const raw = await generate(system, user);

  /* Every provider failed — and for the questions we already know the answer
     to, that must not turn into "let me check and come back to you".
     A lead asked "When the next batch is starting?", which is the single most
     important question this number gets and one whose answer is sitting in
     knowledge.js, and got a holding line because both models were rate
     limited. A fact we hold should never depend on a model being reachable. */
  if (!raw) {
    const known = knownAnswer(routed.audience, text, lang, getSettings());
    if (known) {
      console.warn('[brain] model unreachable, answered from the facts instead');
      return {
        text: known,
        audience: routed.audience,
        handoff: false,
        lang,
        reminderSent: false,
        updates: { lang, kind: routed.audience },
        viaAI: false,
      };
    }
  }

  /* Nothing we know either, and no model to ask. Forward it and say nothing.
     This used to send the holding line, on the reasoning that two blue ticks
     and silence is worse. It is not: the holding line says somebody is
     looking at it, which is only true if somebody is, and the owner gets the
     message either way. Silence and a real answer beats a promise and a wait. */
  if (!raw) {
    return retry('every model was unreachable', routed.audience, lang);
  }

  /* Not a student, not a prospective one. Say nothing and put it in front of
     the owner with the number attached. A polite brush-off from a number that
     does not know who you are is worse than silence, and a company pitch
     answered by a bot is worse than either. */
  if (obviouslyNotOurs || raw.forward === true) {
    return {
      forward: true,
      why: String(raw.why || (obviouslyNotOurs ? 'looks like a pitch or spam' : 'off topic')).slice(0, 80),
      text: null,
      audience: 'other',
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: true,
    };
  }

  /* It handed over, or this is money or a complaint. Nothing goes out.
     The reply is dropped here rather than sent, which is the whole point:
     `forward` used to be set at the very bottom, next to `text: reply`, so
     a handover sent the model's holding line AND forwarded the question.
     the owner saw it arrive on the log number with the person already told
     "g main dekh k btata hon". Whatever the model wrote here, it was written
     to fill a silence that is supposed to stay silent. */
  if (raw.handoff === true || mustEscalate) {
    return silent(
      mustEscalate ? 'money or a complaint' : String(raw.why || 'the model was not sure').slice(0, 80),
      routed.audience,
      lang
    );
  }

  // A course answer gets room to be a real answer; a batch reply stays short.
  const opts = {
    lang,
    maxWords: routed.audience === 'student' ? config.maxWordsAnswer : config.maxWords,
  };
  let reply = humanize(raw.reply, opts);

  /* Do not greet somebody twice in the same conversation. Only when there is
     genuinely something left after the salam — if the whole reply was a
     greeting, that is a different problem and the lines below deal with it. */
  if (!fresh && contact.last_outbound_at && OPENS_WITH_GREETING.test(reply)) {
    const withoutHello = reply.replace(OPENS_WITH_GREETING, '').trim();
    if (withoutHello.split(/\s+/).filter(Boolean).length >= 3) reply = withoutHello;
  }

  /* It may not say it has noted a name or a city it does not have. See
     claims.js — this was told to three people in one conversation. */
  reply = honest(
    reply,
    {
      name: contact.name || (raw.name ? String(raw.name) : null),
      city: contact.city || (raw.city ? String(raw.city) : null),
    },
    lang
  );

  // It was told not to mention the group this time. Models comply most of the
  // time, and "most of the time" is not good enough for the one sentence that
  // makes a person feel brushed off — or, now, that would tell somebody
  // support has ended when it has not.
  if (!wantsReminder && mentionedGroup(reply)) {
    const stripped = stripGroupLine(reply);
    if (stripped.split(/\s+/).filter(Boolean).length < 4) {
      /* The referral was the entire reply, so there is no answer left to
         send. This is the one that reached a real person: he asked whether
         paying meant he could ask questions after the lectures, and was
         told to go and post in the group. Forward it rather than invent a
         replacement — the question was about what he gets for his money and
         that is the owner's to answer, not something to guess at. */
      console.warn('[brain] the reply was only a group referral, forwarded instead');
      return {
        forward: true,
        why: 'the answer was only a referral to the group, which is no longer true',
        text: null,
        audience: routed.audience,
        handoff: false,
        lang,
        reminderSent: false,
        updates: { lang },
        viaAI: false,
      };
    }
    reply = humanize(stripped, opts);
  }

  /* An offer nobody asked for.
     "Hum ap k sath one-on-one meeting krna chahty hy, Local SEO ka proper
     roadmap dena..." went to a student who had asked how to pay a vendor
     site from Pakistan without PayPal. It is a real message from the mined
     history, retrieved and copied wholesale.

     Offering a meeting is a business decision and it is not the bot's to
     make. Deterministic rather than left to the check below, because this
     one has already happened and a judge that is rate limited would let it
     through again. */
  if (OFFERS_MEETING.test(reply) && !ASKED_FOR_MEETING.test(text)) {
    console.warn('[brain] it offered a meeting nobody asked for, dropped and forwarded');
    return retry('it tried to pitch a meeting', routed.audience, lang);
  }

  /* Does this answer the question that was asked?
     Every other guard here names one specific mistake. This one is the
     general case, and it is the case that reached a student: fluent, polite,
     rule-abiding, and about something else entirely. See verifyAnswer. */
  const check = await verifyAnswer(text, reply);
  if (!check.ok) {
    console.warn(`[brain] the reply did not answer the question (${check.why}), forwarded instead`);
    return retry(`the answer did not match the question: ${check.why}`, routed.audience, lang);
  }

  /* Last line of defence. If it claimed to be a person anyway, that message
     does not go out — a human is fetched instead. */
  /* It agreed to a meeting, a call or a time. Nothing is sent. */
  if (PROMISES_MEETING.test(reply)) {
    console.warn('[brain] the reply promised a meeting or a time, dropped and forwarded');
    return silent('it was about to commit to a meeting or a time', routed.audience, lang);
  }

  if (CLAIMS_HUMAN.test(reply)) {
    console.warn('[brain] the model claimed to be human, message dropped and forwarded');
    return {
      forward: true,
      why: 'it was about to claim to be a person, so nothing was sent',
      text: null,
      audience: routed.audience,
      handoff: false,
      lang,
      reminderSent: false,
      updates: { lang },
      viaAI: false,
    };
  }

  if (!reply) {
    return retry('the model returned nothing usable', routed.audience, lang);
  }

  // The roster is not overridable by the model. Otherwise take its reading,
  // since it saw the sentence and the keyword lists did not.
  let audience = routed.audience;
  if (!routed.locked && ['student', 'enquiry', 'unknown'].includes(raw.audience)) {
    audience = raw.audience;
  }

  const updates = {
    lang,
    kind: audience,
    openers: null, // filled by the worker, which knows what was actually sent
  };
  if (routed.student?.name && !contact.name) updates.name = routed.student.name;
  if (routed.student?.batch && !contact.batch) updates.batch = routed.student.batch;
  if (raw.name && !contact.name) updates.name = String(raw.name).slice(0, 60);
  if (raw.city && !contact.city) updates.city = String(raw.city).slice(0, 60);
  if (/\b(name|naam)\b/i.test(reply) && reply.includes('?')) updates.asked_name = 1;

  /* The reminder, guaranteed.
     Asking the model was not enough — tested against the real model it
     dropped the line repeatedly, because the same prompt also insists on one
     or two short lines and that instruction wins. When it leaves the reminder
     out, one is sent as a separate afterthought a few seconds later, which is
     how a person types it anyway. */
  let afterthought = null;
  if (wantsReminder && !mentionedGroup(reply)) {
    afterthought = reminderLine(lang, getSettings().group || FACTS.support.groupLink, contact.last_reminder_line);
  }
  const reminderSent = wantsReminder && (Boolean(afterthought) || mentionedGroup(reply));

  return {
    text: reply,
    afterthought,
    audience,
    /* Not forwarded. Anything that had to reach the owner already returned
       above, with no text — that is the only way a forward happens now.
       This used to set `forward` here, beside `text: reply`, which is how
       one message ended up doing both: sent to the person and forwarded to
       him. Reaching this point means there is a real answer and it is the
       only thing that goes out. */
    handoff: false,
    lang,
    reminderSent,
    updates,
    viaAI: true,
    firstWord: opener(reply),
  };
}

export const _internals = {
  COURSE_TOPIC, BATCH_ENQUIRY, ESCALATE, GREETING_ONLY, OPENS_WITH_GREETING,
  classify, reminderDue, stripGroupLine, mentionedGroup, NOT_OURS, WANTS_HUMAN, CLAIMS_HUMAN,
  IS_COURSE_ADMIN, ASKS_PRICE, JUST_ACKNOWLEDGING, EMOJI_ONLY, tellingUsLater, silent, IS_LMS,
  PROMISES_MEETING, WANTS_SERVICE, OFFERS_MEETING, ASKED_FOR_MEETING,
};
