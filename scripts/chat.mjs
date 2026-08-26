#!/usr/bin/env node
/**
 * Talk to the bot from your keyboard. No WhatsApp, no Meta, no deploy.
 *
 *   npm run chat                    as a stranger asking about the batch
 *   npm run chat 923001234567       as that number, so the roster applies
 *
 * This is where the persona gets tuned. Every edit to persona.js or
 * knowledge.js should be tried here first: the loop is five seconds instead
 * of a redeploy, and a bad reply costs nothing.
 *
 * It prints what the model returned and what would actually be sent, so you
 * can see exactly what the humanizer took out and how long the pause was.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/* Load .env by hand — no dependency, and this script must run before the
   container is ever built. */
const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// A scratch database, so playing here never touches real conversations.
process.env.DB_PATH = process.env.CHAT_DB || './data/sandbox.db';

const { think } = await import('../src/brain.js');
const { bubbles, typingDelayMs } = await import('../src/humanize.js');
const { detectLang } = await import('../src/lang.js');
const db = await import('../src/db.js');
const { config } = await import('../src/config.js');

const waId = (process.argv[2] || '920000000001').replace(/[^\d]/g, '');
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

db.upsertContact(waId, { profileName: 'Test' });

if (!config.ai.apiKey) {
  console.log(yellow('\nNo AI_API_KEY set. Put one in .env first, or the bot has nothing to think with.\n'));
}

console.log(`\n  Chatting as ${green('+' + waId)}  ${dim('(reset: delete data/sandbox.db)')}`);
console.log(dim('  Ctrl+C to stop. Type /who to see what the bot has worked out.\n'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = () => rl.question('you › ', handle);

async function handle(line) {
  const text = line.trim();
  if (!text) return ask();

  const contact = db.getContactByWaId(waId);

  if (text === '/who') {
    console.log(dim(JSON.stringify({
      kind: contact.kind, name: contact.name, city: contact.city, lang: contact.lang,
      reminderSent: contact.reminder_sent_at ? new Date(contact.reminder_sent_at).toISOString() : null,
      botEnabled: Boolean(contact.bot_enabled),
    }, null, 2)));
    return ask();
  }

  db.addMessage(contact.id, { direction: 'in', sender: 'them', body: text });

  const started = Date.now();
  const decision = await think(contact, text, db.getMessages(contact.id, 24));
  const took = Date.now() - started;

  if (!decision) {
    console.log(dim('  (nothing to answer)\n'));
    return ask();
  }

  const parts = bubbles(decision.text);
  const delay = typingDelayMs(parts[0]);

  console.log(
    dim(
      `  ${decision.audience} · ${decision.lang} · detected ${detectLang(text) || 'unclear'}` +
        `${decision.reminderSent ? ' · reminder included' : ''}` +
        `${decision.handoff ? ' · HANDOFF, bot would stop here' : ''}` +
        ` · model ${took}ms · would wait ${(delay / 1000).toFixed(1)}s`
    )
  );

  for (const part of parts) {
    console.log(`bot › ${green(part)}`);
    db.addMessage(contact.id, { direction: 'out', sender: 'bot', body: part });
  }

  const fields = { ...decision.updates };
  delete fields.openers;
  if (decision.firstWord) fields.openers = db.pushOpener(contact, decision.firstWord);
  if (decision.reminderSent) fields.reminder_sent_at = Date.now();
  db.updateContact(contact.id, fields);

  console.log('');
  ask();
}

ask();
