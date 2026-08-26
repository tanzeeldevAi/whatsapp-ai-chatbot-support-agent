<div align="center">

# WhatsApp AI Support Agent

**An AI that answers your customers on WhatsApp from inside the WhatsApp Business app you already
use — as a linked device, like WhatsApp Web. No Cloud API, no separate dashboard, no migration.**

It replies in **Roman Urdu, Urdu script or plain English**, matching whatever the person wrote in.
It waits a few seconds like a human would, sends a read receipt, types, and answers in one message
instead of five. When it doesn't know something, it forwards the question to you instead of
inventing an answer.

[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-linked%20device-25D366?logo=whatsapp&logoColor=white)](#why-a-linked-device-and-not-the-cloud-api)
[![Tests](https://img.shields.io/badge/tests-104%20passing-brightgreen)](#step-3--prove-it-works-before-linking-anything)
[![Developed by Tanzeel](https://img.shields.io/badge/Developed%20by-Tanzeel-6C3EF5)](https://github.com/tanzeeldevAi)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

---

## What is this?

You run a small business on WhatsApp. The same twenty questions arrive every day — *when does the
next batch start, what does it cost, my login isn't working, do you do this for clients too* — and
you answer them at 11pm because nobody else can.

This answers them. Properly, in the customer's own language and in your voice, and it knows the
difference between a question it can answer and one only you can.

```
their message  ──►  bundle 4s  ──►  classify  ──►  answer or forward
                                                        │
                                     you get the ones only you can answer
```

Three kinds of people message a business number, and they need different things:

| | |
|---|---|
| 🎓 **Existing customers** | Get real answers from your own notes and course material |
| 💬 **New enquiries** | Get the facts you've written down — dates, what's included, what happens next. Never an invented price |
| ❓ **Unknown numbers** | Get nothing at all, on purpose. A polite brush-off from an unknown number is worse than silence |

---

## What makes it not sound like a bot

This is most of the work, and it's why the file comments are worth reading:

| | |
|---|---|
| ⏳ **Message bundling** | Three quick lines are one thought. It waits ~4 seconds and answers the whole thing once, instead of firing three replies |
| ⌨️ **Human timing** | Read receipt, typing indicator, then a reply timed from *their* message — about 6–7 seconds, scaled by length. Not instant, which is what gives a bot away |
| 🗣️ **Language matching** | Roman Urdu in, Roman Urdu out. Urdu script in, Urdu script out. It detects Hindi-isms and corrects them, because "SHURUAT ki TARIKH" is not how anyone actually types |
| ✍️ **Your voice, from your own replies** | It learns tone from real answers you've sent, typos and all — not from a style adjective in a prompt |
| 🌙 **Quiet hours** | Overnight messages are held until morning rather than answered at 3am |
| 📵 **Silence is an answer** | No "let me check and get back to you" holding lines. If it can't answer, it forwards to you and says nothing |
| 🔁 **Follow-ups** | A silent enquiry gets chased once at 20 hours and again at 72 |
| 🎙️ **Voice notes** | Transcribed and answered like any other message |

## What keeps it honest

| | |
|---|---|
| 🚫 **Never invents a record** | A fee, a date, a discount, who paid, what someone was promised — those are yours. It forwards rather than guesses |
| 📋 **Answers from facts you wrote** | One file, editable with no code knowledge. Anything not in it does not exist as far as the bot is concerned |
| 🛡️ **Known answers survive an outage** | The greeting, the start date and the fee are answered from the facts directly, so a rate-limited model can't turn the most important question into a holding line |
| 🔒 **Never asks for card, bank or ID details** | Hard rule, and it never shares one person's details with another |
| ⏱️ **Warm-up guard** | WhatsApp replays history to a newly linked device. It stays silent for 25 seconds after connecting and ignores anything older than 10 minutes, so it can never answer months of old messages |
| 🧪 **104 offline tests** | Routing, language detection, silence rules, group handling, known answers, rate limiting |

---

## Why a linked device, and not the Cloud API?

Because moving a number to Meta's Cloud API takes it **out of the WhatsApp Business app for good**.
No more replying from your phone, no more app, everything through a dashboard forever.

If you want the bot to help while you still use WhatsApp normally, it has to join the account the
way WhatsApp Web does — as one of the linked devices under **Settings → Linked devices**.

That's what this is. You keep your app. You can jump into any chat at any time and the bot backs
off. Nothing is migrated and nothing is irreversible: unlink it and it's gone.

> ⚠️ **The honest trade-off:** this is not an official Meta integration. It uses
> [Baileys](https://github.com/WhiskeySockets/Baileys), the same protocol WhatsApp Web speaks.
> WhatsApp does not formally support this and could break it or act on the account. Use it on a
> number you can afford to lose, keep the pacing defaults, and don't point it at cold outreach.
> The rate limits in this repo exist for that reason — don't raise them.

---

## Requirements

Before you start, make sure you have:

- **[Node.js 20 or newer](https://nodejs.org)**
- **A WhatsApp Business number** you're willing to link a device to
- **A free [Groq](https://console.groq.com) API key** — no card required

That's the whole list. There's no Meta developer account, no webhook, no HTTPS certificate and no
domain, because the bot connects *outward* to WhatsApp.

---

## Install — step by step

It takes about **15 minutes**.

### Step 1 — Download and install

```bash
git clone https://github.com/tanzeeldevAi/whatsapp-ai-chatbot-support-agent.git
cd whatsapp-ai-chatbot-support-agent
npm install
```

No git? Click the green **Code** button above → **Download ZIP** → unzip it.

### Step 2 — Set your keys

```bash
copy .env.example .env      # Windows
cp   .env.example .env      # macOS / Linux
```

Open `.env` and fill in **two lines**:

```ini
LINK_PHONE=923001234567          # your number, international form, NO plus sign
AI_API_KEY=gsk_your_groq_key     # from https://console.groq.com/keys
```

Everything else has a working default.

> ⚠️ **`.env` holds the key to your bot and your number.** It is already in `.gitignore`. Never
> commit it, never paste it in a screenshot, never open it while screen-sharing.

### Step 3 — Prove it works before linking anything

```bash
npm test
```

**104 checks, completely offline.** No WhatsApp, no model calls, nothing sent. It exercises the
language detection, the routing, the silence rules, group handling, the known-answer fallbacks and
the rate limiter.

Run this before every deploy. It is much cheaper than finding out on a live number.

### Step 4 — Tell it about your business

Two files, both editable without knowing how to code:

**`src/knowledge.js`** — the facts. Your brand, what you sell, when the next intake starts, what
you will and won't quote. Anything not written here, the bot does not know, and it is told to say
so rather than guess.

**`src/syllabus.js`** — what you actually teach or do, section by section. This is the difference
between a plausible answer and a correct one. It ships filled in with a **Local SEO course as an
example** — replace it with yours.

> **Do not skip this.** With the example content left in, the bot will confidently answer questions
> about somebody else's course.

Optionally, **`src/voice-examples.js`** holds real replies that teach the bot your tone. It ships
with an example set. Once you've been running a while, `npm run mine` reads your own exported chat
history and suggests candidates from it. Ten to twenty is plenty.

### Step 5 — Link it to WhatsApp

```bash
npm start
```

Because `LINK_PHONE` is set, the log prints an **8-character code**. On your phone:

**WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead**

Type the code. That's the link.

> If you left `LINK_PHONE` blank, a QR code is printed to the terminal instead — scan it from the
> same screen.

### Step 6 — Watch it for the first hour

Nothing is answered for the first 25 seconds, and anything older than 10 minutes is ignored. That
is the warm-up guard, and it's what stops a newly linked device answering months of replayed
history.

Message the number from another phone and watch the log.

**That's it — you're running.** 🎉

---

## Running it

Every command works from your own **"Message yourself"** chat in WhatsApp — no setup, no second
number, nothing to install.

| Command | What it does |
|---|---|
| `off` · `on` | Stop and start the bot entirely |
| `off 923001234567` | Stop it for one person, so you can take over that chat |
| `who 923001234567` | What the bot knows about that person |
| `say 923001234567 <message>` | Send a message as yourself |
| `set batch <text>` | Change the start date live, no redeploy |
| `set fee <text>` | Change the fee line live |
| `waitlist` | Who is waiting to be told about the next intake |
| `help` | The full list |

The activity feed goes to your own chat too. `LOG_LEVEL=events` gives you new contacts, handovers
and failures only; `LOG_LEVEL=all` gives you every exchange.

---

## Running it on a server

```bash
cp .env.example .env      # fill in LINK_PHONE and AI_API_KEY
docker compose up -d --build
```

Nothing is exposed and no domain is needed — the bot opens an outbound connection, so there's no
webhook for Meta to reach.

To link from a server with no screen, set a random `LINK_TOKEN` in `.env`, then open
`http://127.0.0.1:3111/qr?t=<your token>` through an SSH tunnel.

> ⚠️ **Clear `LINK_TOKEN` once the phone has linked.** While it's set, anyone who learns the token
> can link themselves to your WhatsApp account.

The Docker volume holds the database **and the WhatsApp session**. Delete it and the phone has to
link again.

---

## Troubleshooting

<details>
<summary><b>It linked, then went offline after a few minutes</b></summary>

Almost always the clock. The link needs an accurate system time — a container drifting by minutes
produces decryption failures that look like randomly dropped messages. Check `TZ` and the host
clock.
</details>

<details>
<summary><b>It answered a load of old messages</b></summary>

Someone lowered `WARMUP_SECONDS` or `MAX_MESSAGE_AGE_MINUTES`. Those two exist precisely to stop
this, and it cannot be undone once the messages are sent. Put them back to `25` and `10`.
</details>

<details>
<summary><b>It replies in the wrong language</b></summary>

Roman Urdu and Hindi share a lot of vocabulary. `src/lang.js` holds the detection and
`src/spelling.js` the Hindi-ism corrections. Add the word that gave it away and re-run
`npm test` — `test/hindi.test.mjs` covers this.
</details>

<details>
<summary><b>Everything gets forwarded to me and nothing is answered</b></summary>

`src/knowledge.js` and `src/syllabus.js` are still mostly empty or still hold the example content
for a topic your customers aren't asking about. The bot forwards rather than guesses — that's the
design working, but it means those two files are the entire job.
</details>

<details>
<summary><b>Replies stopped and the log shows rate limits</b></summary>

Groq's free tier has a per-minute token cap. Fill in the `AI2_*` slot with a second provider as a
fallback. Even without one, the greeting, batch date and fee questions still answer from
`src/known-answers.js` — that's what it's for.
</details>

<details>
<summary><b>It answered in a group chat</b></summary>

It shouldn't — groups, status and channels are ignored outright. `test/group.test.mjs` covers this.
If you've seen otherwise, please open an issue with the log line.
</details>

<details>
<summary><b>I want to take over a conversation</b></summary>

`off 923001234567` in your own chat. It stops replying to that person until you send
`on 923001234567`.
</details>

---

## Layout

```
src/
  server.js         entry point, health endpoint, the QR/link page
  wa.js             the WhatsApp connection (Baileys)
  worker.js         the loop: bundling, pacing, sending
  brain.js          classification and routing. The biggest file, and the core
  persona.js        who the bot is and what it must never do
  knowledge.js      THE FACTS. Edit this one first
  syllabus.js       what you teach, section by section. Edit this one second
  voice-examples.js real replies that teach it your tone
  known-answers.js  answers that must survive a model outage
  knowledge-base.js retrieval over your own notes folder
  lang.js           language detection
  spelling.js       Hindi-ism correction
  humanize.js       delays, read receipts, typing
  limiter.js        rate limiting across both model slots
  students.js       who is a customer, from a CSV
  commands.js       the WhatsApp control commands
  db.js             SQLite store and live settings
scripts/            chat mining, notes indexing, LMS pulls, archiving
test/               104 offline tests
```

---

## Please use this responsibly

This answers real people who think they're talking to a business. Two rules that shouldn't need
saying: it should never claim to be human when asked directly, and it should never be pointed at
people who didn't message you first.

Automating outbound messages to strangers on WhatsApp is how numbers get banned, and deservedly so.

## Contributing

Issues and pull requests are welcome — especially more languages, better Roman-script detection,
and alternative model providers.

## License

[MIT](LICENSE) — free to use, change and share. If it helps you, a ⭐ on the repo is appreciated.

---

<div align="center">

**Built by [@tanzeeldevAi](https://github.com/tanzeeldevAi)**

*whatsapp bot · whatsapp ai chatbot · customer support automation · baileys · whatsapp automation
AI agent · Groq · llama · Node.js · SQLite · Docker · roman urdu · urdu nlp · multilingual chatbot
whatsapp business · linked device · customer service AI · lead response*

</div>
