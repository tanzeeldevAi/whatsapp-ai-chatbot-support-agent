#!/usr/bin/env node
/**
 * Forget the link and start over.
 *
 *   npm run unlink
 *
 * Use this when the phone shows the device as unlinked, when the bot loops on
 * "logged out", or when moving it to a different number. It deletes only the
 * session keys — the conversations, the roster and everything the bot has
 * learned about people are in the database and are left alone.
 *
 * After running it, start the bot again and link it from the phone as if it
 * were the first time.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const dir = path.resolve(process.env.AUTH_DIR || './data/auth');

if (!fs.existsSync(dir)) {
  console.log(`Nothing to remove, ${dir} does not exist. The bot is not linked.`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Delete the WhatsApp session at ${dir}? [y/N] `);
rl.close();

if (!/^y(es)?$/i.test(answer.trim())) {
  console.log('Left alone.');
  process.exit(0);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
console.log('Also remove the old entry on the phone: Settings, Linked devices, tap it, Log out.');
console.log('Then start the bot again to link it fresh.');
