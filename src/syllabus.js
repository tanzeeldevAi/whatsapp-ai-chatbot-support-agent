/**
 * What the course actually taught, module by module.
 *
 * ============================================================
 * THIS IS AN EXAMPLE, filled in for a Local SEO course so the
 * repo runs and its tests pass. REPLACE IT WITH YOUR OWN.
 * The module `key` values are referenced by test/routing.test.mjs;
 * if you rename them, update that test too.
 * ============================================================
 *
 * This is the difference between a plausible answer and a correct one. A
 * model asked "meta description kahan lagti hai" will always produce
 * something; whether it matches what the student was taught in class is a
 * different question, and that is what this file decides.
 *
 * Two rules when editing:
 *
 *   1. Write what was taught, not what is true in general. If the class used
 *      Rank Math, say Rank Math. A correct answer about Yoast is a wrong
 *      answer to a student who has Rank Math open in front of them.
 *   2. Name things. Tools, menus, tabs, fields, numbers. "Optimise the
 *      listing" helps nobody. "Categories, services, description, photos,
 *      posts" is an answer.
 *
 * Anything not written here, the bot does not know. It is told to say so and
 * offer to confirm, rather than to invent — see NEVER in knowledge.js.
 */

/**
 * The tools the class actually used.
 *
 * Suggesting Ubersuggest to somebody who spent the course inside Semrush is a
 * wrong answer even when it is a true one — they open a tool they do not have
 * and cannot follow along. Name these, in this order, and only reach past
 * them if the question is genuinely about something else.
 *
 * Edit this list when the course changes. It is read into every prompt.
 */
export const TOOLS = {
  primary: 'Semrush',
  research: 'Semrush (Keyword Magic Tool, Keyword Gap, Domain Overview)',
  technical: 'Google Search Console, GTmetrix, PageSpeed Insights, Screaming Frog',
  local: 'Google Business Profile dashboard, Google Maps, BrightLocal style citation checks',
  wordpress: 'Elementor, Rank Math, WP Rocket or LiteSpeed Cache, Smush or ShortPixel',
};

export const MODULES = [
  {
    key: 'research',
    name: 'Keyword and niche research',
    taught: `Done in ${TOOLS.research}. This is where most questions land, so answer it at working level, not beginner level.
Finding a niche: pick a service where local businesses already pay for leads, then check demand and competition before committing. A niche with 20 searches a month and no competition is not an opportunity, it is an empty room.
Keyword Magic Tool: start from a seed like "plumber", filter by country and city, then read three columns together. Volume tells you if anybody is asking. KD tells you what it costs to rank. Intent tells you what page type wins.
Reading KD honestly: under about 30 is realistic for a new site with decent on-page. 30 to 50 needs links and time. Above 50 on a brand new domain is a waste of a quarter.
Local volumes are small by nature. A city service term at 100 to 500 a month is a good keyword, not a weak one, because the intent is to buy. Do not chase national terms because the number looks bigger.
Intent: "plumber near me" and "emergency plumber lahore" are transactional and want a service page. "how to fix a leaking tap" is informational and wants a blog. Matching the page type to the intent matters more than the keyword itself.
SERP analysis, and this is the step people skip: search the term and look at who is actually ranking. Directories and aggregators in the top ten mean a real business page can break in. Ten established local competitors with strong profiles means it is hard. Check whether the ranking pages have a page dedicated to that term or are just ranking on the home page, because a dedicated page beats a general one.
If there is a map pack, the Google Business Profile carries more weight than the website for that term. Plan accordingly.
Keyword Gap: put three or four competitors in and find the terms they rank for and the client does not. That list is the content plan.
Group what you find by page: one page per intent, not one page per keyword.`,
  },
  {
    key: 'gbp',
    name: 'Google Business Profile',
    taught: `Creating a profile from scratch on business.google.com, choosing the right primary category and secondary categories, service area vs physical address, verification (video, postcard, phone, email) and what to do when verification fails or the profile gets suspended.
Managing it after: business description, services and products, working hours and special hours, photos and their naming, Google Posts, Q&A, the booking and website links, UTM tagging those links.
Reviews: asking for them properly, the review link, replying to good and bad ones, why review velocity matters, what to do about fake reviews.
Insights: searches, calls, direction requests, website clicks, and reading them month on month.
Map pack ranking factors: relevance, distance, prominence. NAP consistency, categories, reviews, and on-page signals from the linked website.`,
  },
  {
    key: 'wordpress',
    name: 'WordPress web design',
    taught: `Domain and hosting, connecting nameservers, installing WordPress, SSL, and the basic settings pass (site title, permalinks set to post name, timezone, discourage-search-engines unticked).
Page building with Elementor: sections, columns, containers, responsive breakpoints, global colours and fonts, headers and footers, templates.
Themes: Astra, Hello, GeneratePress, and why a light theme matters.
Core plugins: an SEO plugin, a caching plugin, a backup plugin, a forms plugin, an image optimiser. Keeping the plugin list short on purpose.
Site structure for a local business: home, service pages, location pages, about, contact, blog. Menus, internal linking, and the contact form and click-to-call in the header.
Speed: image compression and WebP, caching, lazy loading, cutting unused plugins, checking with GTmetrix and PageSpeed Insights.
Maintenance: backups, updates, and what to do when a plugin update breaks the site.`,
  },
  {
    key: 'content',
    name: 'Content writing',
    taught: `Writing service pages, location and service-area pages, home page copy, about and contact pages, and blog posts.
Structure: one H1, H2 sections that answer real questions, short paragraphs, bullet lists only where they belong, a clear call to action, phone and form above the fold.
Search intent first: what the person typing that query actually wants, and matching the page type to it.
Keyword placement without stuffing: title, H1, first hundred words, one or two H2s, image alt text, URL.
Local signals in the copy: city and area names used naturally, landmarks, service areas, real details rather than filler.
E-E-A-T: real experience, credentials, photos of real work, no invented reviews or numbers.
Uniqueness: location pages must not be the same page with the city swapped.`,
  },
  {
    key: 'onpage',
    name: 'On Page SEO',
    taught: `Title tags and meta descriptions, their lengths and how they are written for clicks, not just keywords.
Heading structure H1 to H4, one H1 per page.
URL slugs, permalinks, canonical tags.
Internal linking: hub and spoke, anchor text that describes the target, linking service pages to location pages.
Images: file names, alt text, compression, WebP, dimensions.
Schema markup: LocalBusiness, Service, FAQ, Breadcrumb, Review where it is genuinely allowed.
XML sitemap and robots.txt, submitting to Search Console.
Core Web Vitals: LCP, CLS, INP, and the usual causes of each.
Mobile first, since almost all local traffic is mobile.
Fixing the common ones: missing titles, duplicate meta, thin pages, broken links, 404s and redirects, noindex left on by mistake.`,
  },
  {
    key: 'offpage',
    name: 'Off Page SEO',
    taught: `Citations and directories: the big ones first, NAP consistency to the character, cleaning up duplicate and wrong listings.
Backlinks: guest posts, local sponsorships, supplier and partner links, resource pages, HARO-style outreach.
Anchor text: branded, naked URL, partial match, and why exact match everywhere looks unnatural.
Judging a link: relevance first, then traffic, then DA or DR. Why a relevant local link beats a high DR irrelevant one.
Outreach: finding the contact, the first email or message, the follow-up, and what a realistic reply rate looks like.
What to avoid: bought link packages, PBNs, comment spam, and the reason those hurt a local client more than they help.
Tracking: which links were built, which were indexed, and what moved.`,
  },
  {
    key: 'clients',
    name: 'Client hunting',
    taught: `Finding local businesses that visibly need the work: no website, no Google profile, unclaimed listings, bad reviews, slow site, not in the map pack.
Building a short audit as the opening move, and using it as the reason to talk rather than a cold pitch.
Channels: WhatsApp, cold email, LinkedIn, Facebook groups, walk-ins, referrals, Fiverr and Upwork profiles.
The first message: short, specific to their business, one clear ask, no wall of text.
The call: what to ask, how to find the real problem, how to talk about results without promising rankings.
Proposals: what goes in one, and quoting on a call rather than in the first message.
Pricing models: monthly retainer, one-off build, and per-project. Charging for the audit or not.
Follow-up: a fixed sequence rather than chasing at random, and when to stop.`,
  },
  {
    key: 'rankrent',
    name: 'Rank and Rent',
    taught: `Building a local lead generation site for a service in a city, ranking it, and renting it to a business instead of doing the work for a client.
Picking the site: a service with real emergency or high intent demand, a city where the map pack and top ten are weak, and a job worth enough per lead that a business will pay for them. Checked in ${TOOLS.primary} the same way as any other niche, then confirmed by looking at who is actually ranking.
Building it: a proper site with service pages and area pages, a Google Business Profile where one can honestly be created, citations, and content aimed at the terms that convert rather than the ones with the biggest numbers.
Proving the leads, which is the part that gets it rented: call tracking so the calls are counted and recorded, and a form that logs every enquiry. Nobody rents a site on a promise, they rent it on a call log.
Renting it out: approaching businesses in that city once the phone is already ringing, a free trial period of leads, then a fixed monthly rent or a price per lead. The site and the number stay ours.
The risks that were covered: Google profile suspension when the address is not real, the renter going direct to the customers, and putting months into a city where the incumbents are too strong.`,
  },
  {
    key: 'tracking',
    name: 'Call tracking and lead tracking',
    taught: `Set up during the batch with the call-tracking platform rented for the class to use.
Why it exists: a client or a renter needs to see the leads, not be told about them. A tracking number on the site, calls forwarded to their real line, and every call logged with the source.
What is tracked: the number of calls, how long they lasted, which page and which keyword the caller came from, missed calls, and recordings where they are allowed.
One tool handles routing and reporting, the other lead capture and follow up. Both were provided during the batch.
Using the numbers: a monthly report that shows calls and form enquiries against the month before is what renews a retainer, and it is what a Rank and Rent renter is actually paying for.
Watch the NAP: the tracking number goes on the website, and the real business number stays on the Google Business Profile and the citations, or the listing consistency breaks.`,
  },
  {
    key: 'ai',
    name: 'AI in the workflow',
    taught: `Using AI for research and drafting: keyword grouping, outlines, first drafts, meta descriptions, and rewriting for a location page without duplicating.
Writing prompts that produce usable output: giving context, audience, tone, and a real example rather than an adjective.
Editing what it produces: fact checking, removing invented statistics and reviews, and putting the client's real details back in.
Where AI must not be trusted: competitor names, review counts, prices, citations, anything a client would notice was wrong.
AI search: AI Overviews, ChatGPT and Perplexity as places a business can be mentioned, and what makes a page quotable by them.
AI tools that fit the workflow, and where the free tiers stop being enough.`,
  },
];

/**
 * The block the model reads — the notes for the module they asked about, and
 * only the names of the rest.
 *
 * Sending all seven modules every time was correct and unaffordable. It put
 * the prompt over 1,700 tokens, and Groq's free tier allows 12,000 tokens a
 * minute: three students messaging at once exhausted it, and everyone after
 * that got the "main dekh ke btata hun" holding line — the exact vague
 * non-answer this file exists to prevent.
 *
 * One module is all that is ever relevant to one question, so this costs
 * nothing in accuracy and about two thirds of the tokens.
 *
 * @param {string|null} focus  a module key from `moduleFor`, or null for a
 *                             short overview of everything
 */
export function syllabusBlock(focus = null) {
  // One key or several — `focusModules` returns two when a question honestly
  // spans both, and sending both beats guessing between them.
  const keys = (Array.isArray(focus) ? focus : [focus]).filter(Boolean);
  const chosen = MODULES.filter((m) => keys.includes(m.key));
  const picked = chosen[0];

  // Nothing matched, so send everything.
  //
  // A short list used to go here, to save tokens. It cost an answer: asked
  // whether every city needs its own page, the bot said "zaruri nahi", the
  // exact opposite of what was taught, because the content notes were not in
  // front of it. Guessing with less context than we have is not a trade worth
  // making, and the queue in limiter.js now pays for the tokens.
  if (!picked) {
    return `${toolsBlock()}

WHAT THE COURSE COVERED, IN DETAIL
They were taught all of this here, so answer the way it was taught.

${MODULES.map((m) => `## ${m.name}\n${m.taught}`).join('\n\n')}`;
  }

  const others = MODULES.filter((m) => !keys.includes(m.key))
    .map((m) => m.name)
    .join(', ');

  const sections = chosen.map((m) => `## ${m.name}\n${m.taught}`).join('\n\n');

  return `${toolsBlock()}

WHAT THE COURSE COVERED ON THIS TOPIC
They were taught this here, so answer it the way it was taught.

${sections}

The course also covered: ${others}. If the question turns out to be about one of those instead, answer what you can and say you will confirm the rest.`;
}

/** The tools they have open, named so the answer matches their screen. */
export function toolsBlock() {
  return `TOOLS THEY WERE TAUGHT ON
Main tool: ${TOOLS.primary}. Suggest it by name.
Research: ${TOOLS.research}
Technical: ${TOOLS.technical}
Local: ${TOOLS.local}
WordPress: ${TOOLS.wordpress}

Do not send them to a tool the course did not use. They have ${TOOLS.primary} and know their way around it, so name the actual report or filter inside it rather than telling them to "use a tool".`;
}

/**
 * Course admin, which is not a module and never will be.
 *
 * Mining the real history turned up a whole category I had not built for and
 * it is a big one: LMS access, fee submitted but not showing, "class kab hai",
 * not added to the group, "any update?", enrolment forms, login details.
 *
 * The bot has none of those facts and they change every batch, so the right
 * answer is always to put it in front of the owner rather than to guess. This
 * returns true and the caller forwards.
 */
export const IS_COURSE_ADMIN =
  /\b(lms|portal|dashboard|login (details|id)|access (nahi|nhi|de|dein)|approve|approval)\b|\b(fee (pay|submit|jama)|payment (ho gai|kar di|nahi ho)|receipt|screenshot bhej)\b|\b(class (kab|kb|timing|time|link)|lecture (link|kab)|recording (kab|nahi|milegi)|group (me|mein) add|group ka link|zoom link)\b|\b(enroll?ment form|registration form|form fill|any update)\b/i;

/**
 * Which module a question is about.
 *
 * Scored, not first-match-wins. The previous version tested each module in a
 * fixed order and returned the first hit, which meant the answer depended on
 * the order I happened to write the list in rather than on the question:
 * "wordpress me schema kaise lagaun" went to WordPress because WordPress was
 * tested before On Page, and "backlink ke liye content kaise likhun" went to
 * Off Page for the same reason. Both were sent the wrong notes.
 *
 * Now every module is scored against the message and the strongest wins.
 * Words are weighted: a term that only belongs to one module ("ringba",
 * "elementor", "backlink") counts for more than one that floats between them
 * ("content", "page", "review").
 */

/** [pattern, weight]. 3 = only ever means this module. 1 = a weak hint. */
const SIGNALS = {
  research: [
    [/\bniche\b|micro ?niche/g, 3],
    [/\bkd\b|difficulty|keyword gap/g, 3],
    [/keyword|kw research/g, 2],
    [/search volume|\bvolume\b/g, 2],
    [/semrush|ubersuggest|ahrefs/g, 2],
    [/\bserp\b|competition|intent/g, 1],
  ],
  gbp: [
    [/\bgbp\b|\bgmb\b|google business|my business/g, 3],
    [/map ?pack|business profile/g, 3],
    [/verif|suspend/g, 2],
    [/\bnap\b|citation|listing/g, 2],
    [/review/g, 1],
  ],
  wordpress: [
    [/wordpress|\bwp\b|elementor|woocommerce/g, 3],
    [/hosting|domain|\bssl\b|cpanel|backup/g, 2],
    [/plugin|theme|cach/g, 2],
    [/speed|slow|gtmetrix|pagespeed/g, 2],
  ],
  content: [
    [/location page|service page|service area|city page/g, 3],
    [/e-?e-?a-?t|thin content|duplicate content/g, 3],
    [/blog|article|content writ/g, 2],
    [/\bcontent\b|likh|\bwrit/g, 1],
  ],
  onpage: [
    [/schema|sitemap|robots|canonical|permalink/g, 3],
    [/meta ?(title|description|tag)|title tag|\bh1\b|\bslug\b/g, 3],
    [/internal link|alt text|core web|\blcp\b|\bcls\b|\binp\b/g, 3],
    [/on ?page|index/g, 2],
  ],
  offpage: [
    [/backlink|back link|guest post|link building/g, 3],
    [/anchor text|\banchor\b|off ?page/g, 3],
    [/outreach|\bda\b|\bdr\b|directory|directories/g, 2],
  ],
  clients: [
    [/client hunt|cold (email|message|outreach)|proposal|retainer/g, 3],
    [/fiverr|upwork|\bpitch\b/g, 3],
    [/\bclient\b|\blead\b/g, 1],
  ],
  rankrent: [
    [/rank ?(and|n|&) ?rent|rent (site|website)|kiraye pe site|lead ?gen site/g, 4],
  ],
  tracking: [
    [/ringba|lead ?smart|call track|tracking number|call recording/g, 4],
    [/missed call|twilio/g, 2],
  ],
  ai: [
    [/chatgpt|\bgpt\b|perplexity|ai overview|\bprompt/g, 3],
    [/\bai\b/g, 1],
  ],
};

/** Every module with a score, strongest first. */
export function scoreModules(text) {
  const t = String(text || '').toLowerCase();
  const scores = [];

  for (const [key, signals] of Object.entries(SIGNALS)) {
    let score = 0;
    for (const [rx, weight] of signals) {
      const hits = t.match(rx);
      if (hits) score += weight * Math.min(hits.length, 2);
    }
    if (score > 0) scores.push({ key, score });
  }
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * @returns {string|null} the module, or null when nothing scores — in which
 *          case the caller sends every module rather than guessing.
 */
export function moduleFor(text) {
  const [best] = scoreModules(text);
  return best ? best.key : null;
}

/**
 * The modules worth putting in front of the model, up to two.
 *
 * Some questions genuinely sit across two. "wordpress me schema kaise lagaun"
 * is an On Page question asked about a WordPress site and it scores exactly
 * the same for both, so picking one by tie-break is a coin toss that sends
 * the wrong notes half the time. Sending both costs a few hundred tokens,
 * which the queue already pays for.
 */
export function focusModules(text) {
  const scored = scoreModules(text);
  if (!scored.length) return [];
  const [top, second] = scored;
  if (second && second.score >= top.score * 0.8) return [top.key, second.key];
  return [top.key];
}
