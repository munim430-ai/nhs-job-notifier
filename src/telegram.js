/**
 * Telegram Bot API helper.
 * Sends formatted NHS job alerts — completely free, no monthly message limits.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 *
 * Setup (one-time, takes 2 minutes):
 *   1. Message @BotFather on Telegram → /newbot → copy the token
 *   2. Message your new bot once, then run:
 *        node -e "require('./src/telegram').getChatId()"
 *      to discover your chat_id.
 *   3. Paste both values into .env
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const https = require('https');

// Prevent MaxListenersExceededWarning when sending many messages in sequence
https.globalAgent.setMaxListeners(100);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Supports one or more comma-separated chat IDs, e.g. "7892901500,9876543210"
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '')
  .split(',').map(id => id.trim()).filter(Boolean);

if (!BOT_TOKEN || CHAT_IDS.length === 0) {
  console.warn(
    '[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. ' +
    'Copy .env.example → .env and fill in your credentials.'
  );
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Sends a raw text message via Telegram (MarkdownV2 parse mode).
 * Special characters in dynamic content must be escaped before calling this.
 */
async function sendMessage(text, chatId = CHAT_IDS[0]) {
  if (!BOT_TOKEN || !chatId) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
  }

  try {
    const { data } = await axios.post(`${API_BASE}/sendMessage`, {
      chat_id:    chatId,
      text:       text,
      parse_mode: 'Markdown',
    });

    if (!data.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`);
    console.log(`[telegram] Sent. messageId=${data.result?.message_id}`);
    return data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[telegram] Failed to send:', JSON.stringify(detail, null, 2));
    throw err;
  }
}

/** Pulls the first https:// URL from a message string (used for inline button). */
function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : 'https://www.jobs.nhs.uk';
}

/**
 * Escapes characters that MarkdownV2 treats as special.
 * Must be applied to any dynamic user-supplied string before embedding in a message.
 */
function escape(str) {
  return String(str || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
}

/**
 * Formats a raw Apify job object into a Telegram MarkdownV2 message.
 */
function formatJobMessage(job, index, total) {
  const title   = job.title       || job.jobTitle || 'Unknown Title';
  const org     = job.employer    || job.trust    || job.organisation || 'Unknown Org';
  const loc     = job.location    || job.city     || 'Unknown Location';
  const band    = job.payBand     || job.band     || 'Not specified';
  const salary  = job.salary      || job.pay      || '';
  const closing = job.closingDate || job.deadline || 'See listing';
  const url     = job.url         || job.jobUrl   || job.link || '';
  const ref     = job.jobRef      || job.id       || '';

  const salaryLine = salary ? `\n💷 *Salary:* ${salary}` : '';
  const refLine    = ref    ? `\n🔖 *Ref:* ${ref}`       : '';
  const urlLine    = url    ? `\n\n🔗 ${url}`             : '';

  return (
    `🏥 *NHS Job Alert [${index}/${total}]*\n\n` +
    `📋 *${title}*\n` +
    `🏢 ${org}\n` +
    `📍 ${loc}\n` +
    `🎯 *Band:* ${band}` +
    salaryLine +
    `\n📅 *Closes:* ${closing}` +
    refLine +
    urlLine
  );
}

/**
 * Sends a Telegram alert for each new job.
 * Includes a summary header, then one message per job.
 */
async function notifyJobs(newJobs) {
  if (!newJobs || newJobs.length === 0) {
    console.log('[telegram] No new jobs to notify about.');
    return;
  }

  console.log(`[telegram] Sending ${newJobs.length} alert(s) to ${CHAT_IDS.length} recipient(s)...`);

  const count  = newJobs.length;
  const plural = count > 1 ? 's' : '';
  const date   = new Date().toLocaleDateString('en-GB', { dateStyle: 'full' });

  const header =
    `👋 *NHS Job Finder*\n` +
    `Found *${count}* new job${plural} matching your criteria.\n` +
    `📅 ${date}`;

  for (const chatId of CHAT_IDS) {
    await sendMessage(header, chatId);
    for (let i = 0; i < newJobs.length; i++) {
      const msg = formatJobMessage(newJobs[i], i + 1, newJobs.length);
      await sendMessage(msg, chatId);
      // 500 ms gap: stays under Telegram's rate limit
      if (i < newJobs.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  console.log('[telegram] All alerts sent.');
}

/**
 * Helper to discover your chat_id — run once after messaging your bot.
 * Usage: node -e "require('./src/telegram').getChatId()"
 */
async function getChatId() {
  if (!BOT_TOKEN) {
    console.error('Set TELEGRAM_BOT_TOKEN in .env first.');
    return;
  }
  const { data } = await axios.get(`${API_BASE}/getUpdates`);
  const updates  = data?.result || [];
  if (updates.length === 0) {
    console.log('No messages received yet. Send any message to your bot first, then re-run.');
    return;
  }
  updates.forEach(u => {
    const chat = u.message?.chat;
    if (chat) console.log(`chat_id: ${chat.id}  (${chat.first_name || chat.title || 'unknown'})`);
  });
}

module.exports = { notifyJobs, sendMessage, formatJobMessage, escape, getChatId };

// Direct test: node src/telegram.js
if (require.main === module) {
  const mockJob = {
    jobTitle:    'Staff Nurse – General Medicine',
    employer:    'Royal Free London NHS Foundation Trust',
    location:    'London, NW3 2QG',
    payBand:     'Band 5',
    salary:      '£30,279 – £33,116 per annum',
    closingDate: '15 May 2025',
    jobRef:      'TEST-001',
    url:         'https://www.jobs.nhs.uk/candidate/jobadvert/TEST-001',
  };

  notifyJobs([mockJob])
    .then(() => console.log('[telegram] Test complete.'))
    .catch(err => console.error('[telegram] Test failed:', err.message));
}
