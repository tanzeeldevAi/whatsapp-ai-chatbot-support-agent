import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Who is a known student, decided before any model sees the message.
 *
 * The roster is the only certain signal there is. A model reading "kaise ho"
 * cannot tell an old student from a stranger, and getting it wrong in the
 * student direction is the expensive mistake: a new lead who is told support
 * has ended and to go to a group they are not in simply leaves.
 *
 * Everyone not on the roster starts as unknown, and the model may classify
 * them. The roster can only ever add certainty, never remove it.
 */

const file = process.env.STUDENTS_CSV || path.join(process.cwd(), 'data', 'students.csv');

let roster = new Map();
let loadedAt = 0;

const clean = (s) => String(s || '').replace(/[^\d]/g, '');

/**
 * Pakistani numbers get written six ways. 03041394847, +92 304 1394847 and
 * 923041394847 are the same person, and WhatsApp only ever reports the last
 * form, so everything is normalised to it before comparing.
 */
export function normalize(raw) {
  let n = clean(raw);
  if (!n) return '';
  if (n.startsWith('0092')) n = n.slice(2);
  if (n.startsWith('92') && n.length === 12) return n;
  if (n.startsWith('0') && n.length === 11) return `92${n.slice(1)}`;
  if (n.length === 10 && n.startsWith('3')) return `92${n}`;
  return n;
}

export function loadStudents() {
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs === loadedAt) return roster;

    const next = new Map();
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const row = line.trim();
      if (!row || row.startsWith('#')) continue;
      const [rawNumber, name, batch] = row.split(',').map((c) => (c || '').trim());
      if (/^(number|wa_id|phone)$/i.test(rawNumber)) continue; // header
      const wa = normalize(rawNumber);
      if (wa.length >= 10) next.set(wa, { name: name || null, batch: batch || null });
    }
    roster = next;
    loadedAt = stat.mtimeMs;
    console.log(`[students] loaded ${roster.size} numbers from ${file}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[students] could not read roster:', err.message);
    roster = new Map();
  }
  return roster;
}

/** @returns {{name: string|null, batch: string|null} | null} */
export function lookupStudent(waId) {
  loadStudents(); // picks up an edited CSV without a restart
  return roster.get(normalize(waId)) || null;
}

export const rosterSize = () => loadStudents().size;

/** Numbers allowed to run the bot by message. */
export const isControl = (waId) => config.controlNumbers.includes(normalize(waId));
