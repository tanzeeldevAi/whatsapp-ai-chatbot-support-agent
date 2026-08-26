import {
  addMessage,
  getContactByWaId,
  lastForward,
  replyTo,
  getMessages,
  getSettings,
  listContacts,
  markWaitlistTold,
  setSetting,
  stats,
  updateContact,
  waitlistAll,
  waitlistPending, setIgnored, ignoredList } from './db.js';
import { normalize, rosterSize } from './students.js';
import { sendText } from './wa.js';
import { learn } from './knowledge-base.js';
import { launchMessage } from './known-answers.js';

/**
 * Running the bot from inside WhatsApp.
 *
 * Written because the alternative is SSH. The three facts that change most
 * often — when the batch starts, the fee, the group link — change by text
 * message and take effect on the next reply, with no redeploy and nobody
 * opening a terminal on a phone.
 *
 * Two ways in: the owner's own "Message yourself" chat, which needs no second
 * phone, and any number in CONTROL_NUMBERS. From a control number anything
 * unrecognised gets the help text rather than silence, because silence looks
 * exactly like the bot being broken.
 */

const HELP = `Commands

stats            how many contacts, messages today
off / on         stop or start the bot for everyone
off 923001234567 stop or start it for one person
who 923001234567 what we know about them
last             the 10 most recent conversations
say 923001234567 your message here
reply <text>      answer the last forwarded message
set batch mid October
set name Batch 4
set fee 15000
set group https://facebook.com/groups/...
show             current batch, fee and group text

waitlist         everyone who asked when the batch starts
waitlist drop 923001234567   take someone off that list
launch           show the launch message and who gets it (sends nothing)
launch send      send it to all of them
launch send <your own words>   send that instead

You do not need "say" for a normal reply. Just answer the person in
WhatsApp as you always would, and the bot steps out of that chat by
itself. Send "on <number>" to hand it back.`;

const KNOWN = new Set(['help', '?', 'stats', 'show', 'off', 'on', 'who', 'last', 'say', 'set', 'reply', 'waitlist', 'launch']);

/**
 * @param {string} raw
 * @param {{strict?: boolean}} opts  strict is for the "Message yourself" chat,
 *        which is also where he keeps his own notes. Answering every stray
 *        thought with a help screen would make that chat unusable, so unknown
 *        text is left alone there unless it is a single word or starts with a
 *        slash — both of which read as an attempt at a command.
 */
export async function handleOwnerCommand(raw, { strict = false } = {}) {
  const text = String(raw || '').trim().replace(/^\//, '');
  if (!text) return null;

  const [word, ...rest] = text.split(/\s+/);
  const cmd = word.toLowerCase();
  const arg = rest.join(' ').trim();

  if (strict && !KNOWN.has(cmd)) {
    const looksLikeATry = rest.length === 0 || String(raw).trim().startsWith('/');
    if (!looksLikeATry) return null;
  }

  switch (cmd) {
    /* Leave this chat alone. Personal conversations, family, friends —
       anything that is not a student and never will be.

       This exists because the WhatsApp archive flag turned out to be
       unreliable: it arrives only when Baileys happens to send the chat
       list, which after a fresh link it often never does, and it lived in
       memory so every restart forgot it. One message from him is worth more
       than a signal that works most of the time. */
    case 'ignore':
    case 'stop': {
      const num = String(rest || '').replace(/[^\d]/g, '');
      if (!num) return 'Kis number ko? Likhein: ignore 923001234567';
      setIgnored(num, true);
      return `+${num} ab bot ke liye band hy. Us chat me kuch nahi parhega aur na jawab dega.
Wapas chalu krna ho to: unignore ${num}`;
    }

    case 'unignore':
    case 'resume': {
      const num = String(rest || '').replace(/[^\d]/g, '');
      if (!num) return 'Kis number ko? Likhein: unignore 923001234567';
      setIgnored(num, false);
      return `+${num} par bot dobara jawab dega.`;
    }

    case 'ignored': {
      const list = ignoredList();
      if (!list.length) return 'Abhi koi number ignore par nahi hy.';
      return `Ignore par ${list.length} number:
` + list.map((n) => `+${n}`).join(String.fromCharCode(10));
    }

    case 'help':
    case '?':
      return HELP;

    case 'stats': {
      const s = stats();
      const set = getSettings();
      return [
        `Contacts: ${s.contacts}  (students ${s.students}, enquiries ${s.enquiries})`,
        `New today: ${s.newToday}`,
        `Last 24h: ${s.in24h} in, ${s.out24h} out`,
        `Paused: ${s.paused}`,
        `Roster: ${rosterSize()} known student numbers`,
        `Bot: ${set.bot === 'off' ? 'OFF for everyone' : 'on'}`,
      ].join('\n');
    }

    case 'show': {
      const s = getSettings();
      return [
        `Which batch: ${s.name || '(Batch 3)'}`,
        `Starting: ${s.batch || '(using the text in knowledge.js)'}`,
        `Fee: ${s.fee || '(not quoted on WhatsApp)'}`,
        `Group: ${s.group || '(no link set)'}`,
      ].join('\n');
    }

    case 'off':
    case 'on': {
      const turningOn = cmd === 'on';
      if (!arg) {
        setSetting('bot', turningOn ? 'on' : 'off');
        return turningOn
          ? 'Bot is on for everyone again.'
          : 'Bot is off for everyone. Nothing will be answered until you send "on".';
      }
      const contact = getContactByWaId(normalize(arg));
      if (!contact) return `No conversation with ${normalize(arg)} yet.`;
      updateContact(contact.id, {
        bot_enabled: turningOn ? 1 : 0,
        paused_by: turningOn ? null : 'human',
        reply_due_at: null,
        next_followup_at: null,
      });
      return `Bot ${turningOn ? 'on' : 'off'} for ${contact.name || contact.profile_name || arg}.`;
    }

    /**
     * The launch announcement.
     *
     *   waitlist          who is on it
     *   launch            what would be sent, and to how many. Sends nothing.
     *   launch send       actually send it
     *   launch send <msg> send your own words instead of the default
     *
     * `launch` on its own never sends. This is the one command that writes to
     * dozens of real people at once and cannot be taken back, so seeing the
     * message and the count first is not caution, it is the only way to catch
     * a wrong date before forty people read it.
     *
     * Safe to run twice: `waitlist_told_at` means nobody is messaged about
     * the same launch again, so a broadcast cut short by a dropped link is
     * resumed by running it again.
     */
    case 'waitlist': {
      /* Taking somebody off. The list decides who gets a message they cannot
         un-receive, so being able to correct it has to be as easy as reading
         it — especially for the eight who were added retroactively by
         matching old messages, where a broad pattern caught people who had
         never asked about joining at all. */
      const drop = arg.match(/^(drop|remove)\s+(.+)$/i);
      if (drop) {
        const c = getContactByWaId(normalize(drop[2]));
        if (!c) return `Nothing on ${normalize(drop[2])}.`;
        updateContact(c.id, { waitlist_at: null, waitlist_told_at: null });
        return `Taken +${c.wa_id} off the waiting list. They will not get the launch message.`;
      }

      const all = waitlistAll();
      if (!all.length) return 'Nobody has asked about the next batch yet.';
      const pending = all.filter((c) => !c.waitlist_told_at);
      const line = (c) =>
        `+${c.wa_id}${c.name ? ` · ${c.name}` : c.profile_name && c.profile_name !== '.' ? ` · ${c.profile_name}` : ''}${c.city ? ` (${c.city})` : ''}${c.waitlist_told_at ? ' ✓ told' : ''}`;
      return [
        `${all.length} waiting for the batch announcement, ${pending.length} not told yet.`,
        '',
        ...all.map(line),
        '',
        'Send "launch" to see the message, "launch send" to send it.',
      ].join('\n');
    }

    case 'launch': {
      const pending = waitlistPending();
      const custom = arg.replace(/^send\s*/i, '').trim();
      const message = custom || launchMessage(getSettings());

      if (!/^send\b/i.test(arg)) {
        return [
          `This would go to ${pending.length} ${pending.length === 1 ? 'person' : 'people'}:`,
          '',
          message,
          '',
          pending.length
            ? 'Send "launch send" to send it, or "launch send <your own message>" to change the words.'
            : 'Nobody is waiting to be told.',
        ].join('\n');
      }

      if (!pending.length) return 'Everybody on the list has already been told.';

      /* Sent one at a time with a gap. Forty messages leaving in one second
         from a number that normally sends a few an hour is what gets a
         WhatsApp account limited, and this list is the most valuable thing
         the bot has. */
      let sent = 0;
      const failed = [];
      for (const c of pending) {
        try {
          const id = await sendText(replyTo(c), message);
          addMessage(c.id, { direction: 'out', sender: 'human', body: message, waMessageId: id });
          markWaitlistTold(c.id);
          sent += 1;
          await new Promise((r) => setTimeout(r, 4000));
        } catch (err) {
          failed.push(`+${c.wa_id}: ${err.message.slice(0, 40)}`);
        }
      }
      return [
        `Sent to ${sent} of ${pending.length}.`,
        failed.length ? `Could not send to:\n${failed.join('\n')}` : null,
        failed.length ? 'Run "launch send" again to retry only those.' : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'who': {
      const contact = getContactByWaId(normalize(arg));
      if (!contact) return `Nothing on ${normalize(arg)}.`;
      const last = getMessages(contact.id, 4)
        .map((m) => `${m.direction === 'in' ? '←' : '→'} ${m.body.slice(0, 90)}`)
        .join('\n');
      return [
        `+${contact.wa_id}`,
        `${contact.name || contact.profile_name || 'no name'} · ${contact.kind}`,
        contact.city ? `City: ${contact.city}` : null,
        `Bot: ${contact.bot_enabled ? 'on' : `off (${contact.paused_by || 'unknown'})`}`,
        contact.reminder_sent_at
          ? `Group reminder sent ${days(contact.reminder_sent_at)} days ago`
          : 'Group reminder not sent yet',
        '',
        last,
      ]
        .filter((l) => l !== null)
        .join('\n');
    }

    case 'last': {
      const rows = listContacts(10);
      if (!rows.length) return 'No conversations yet.';
      return rows
        .map(
          (c) =>
            `${c.bot_enabled ? '' : '⏸ '}${c.name || c.profile_name || `+${c.wa_id}`} (${c.kind})\n   ${String(
              c.preview || ''
            )
              .replace(/\s+/g, ' ')
              .slice(0, 70)}`
        )
        .join('\n');
    }

    case 'say': {
      const to = normalize(rest[0] || '');
      const body = rest.slice(1).join(' ').trim();
      if (!to || !body) return 'Use: say 923001234567 your message';
      const contact = getContactByWaId(to);
      try {
        await sendText(to, body);
      } catch (err) {
        return `Could not send: ${err.message.slice(0, 160)}`;
      }
      // Recorded here rather than left to the echo: a message this process
      // sent is on the `ownSends` list, so the link deliberately ignores it
      // coming back and would never see this as a human stepping in.
      if (contact) {
        addMessage(contact.id, { direction: 'out', sender: 'human', body });
        updateContact(contact.id, {
          bot_enabled: 0,
          paused_by: 'human',
          reply_due_at: null,
          next_followup_at: null,
        });
      }
      return `Sent. Bot is now off for that chat, send "on ${to}" to hand it back.`;
    }

    case 'reply': {
      // Replying to the forwarded message itself is the normal way. This is
      // for when quoting on a phone is more trouble than it is worth.
      const target = lastForward();
      if (!target) return 'Koi forwarded message nahi hy.';
      if (!arg) return `Use: reply <apka jawab>  (jaye ga +${target.wa_id} ko)`;
      try {
        await sendText(replyTo(target), arg);
      } catch (err) {
        return `Nahi bhej saka: ${err.message.slice(0, 140)}`;
      }
      addMessage(target.id, { direction: 'out', sender: 'human', body: arg });
      // Answering a forward, so the bot keeps the conversation. Same reasoning
      // as the quoted reply in server.js.
      updateContact(target.id, {
        bot_enabled: 1,
        paused_by: null,
        reply_due_at: null,
        next_followup_at: null,
      });
      const learned = learn(target.forwardedQuestion, arg);
      return `Bhej diya +${target.wa_id} ko.${learned ? ' Yaad bhi kar liya.' : ''}`;
    }

    case 'set': {
      const key = (rest[0] || '').toLowerCase();
      const value = rest.slice(1).join(' ').trim();
      if (!['batch', 'name', 'fee', 'group'].includes(key)) {
        return 'Use: set batch | set name | set fee | set group';
      }
      if (!value) return `Use: set ${key} <value>`;
      setSetting(key, value);
      return `Done. ${key} is now: ${value}`;
    }

    default:
      return HELP;
  }
}

const days = (ts) => Math.max(0, Math.round((Date.now() - ts) / 86400000));
