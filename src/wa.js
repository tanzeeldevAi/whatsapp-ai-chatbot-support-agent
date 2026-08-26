/**
 * The transport seam.
 *
 * Everything above this line — the brain, the persona, the humanizer, the
 * routing, the reminder cooldown — never learns how a message actually
 * travels. That is deliberate: this file is the only thing that changes if
 * the account is later moved onto Meta's official Coexistence API, and the
 * conversation logic comes along untouched.
 *
 * Today it is a linked device, so the number stays in the WhatsApp Business
 * app on the phone and replies appear in the real chat threads.
 *
 * One thing worth knowing, because it removes a whole class of bug that the
 * Cloud API version had: **a linked device has no 24 hour messaging window.**
 * There is no `canSendFreeform` check, no template approval, and no
 * follow-up that silently fails because someone went quiet for a day.
 */

export { sendText, markRead, startTyping, downloadVoice, toJid, toNumber, isArchived } from './link.js';
