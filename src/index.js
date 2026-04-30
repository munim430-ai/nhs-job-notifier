/**
 * Main orchestrator — runs the full pipeline in polling mode.
 * Suitable for scheduled execution (Windows Task Scheduler, cron, etc.)
 *
 * Flow:
 *   1. Trigger Apify scraper
 *   2. Poll until complete
 *   3. Deduplicate against local DB
 *   4. Send Telegram alerts for new jobs
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { scrapeJobs }          = require('./scraper');
const { filterNewJobs }       = require('./deduplicator');
const { notifyJobs, sendMessage } = require('./telegram');
const logger                  = require('./logger');

async function run() {
  logger.info('=== NHS Job Notifier — pipeline start ===');

  let rawJobs;
  try {
    rawJobs = await scrapeJobs();
  } catch (err) {
    logger.error('Scraper failed:', err.message);

    // Fallback: notify via Telegram so the user knows the monitor is down
    try {
      await sendMessage(
        `⚠️ *NHS Job Finder — Error*\n\nThe scraper failed to run\\.\n\n` +
        `Error: ${err.message.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c)}\n\n` +
        `Please check the Apify console or update your filters\\.`
      );
    } catch (notifyErr) {
      logger.error('Could not send error notification:', notifyErr.message);
    }
    process.exit(1);
  }

  if (!rawJobs || rawJobs.length === 0) {
    logger.info('Scraper returned 0 jobs — site may be down or filters too narrow.');
    process.exit(0);
  }

  const newJobs = filterNewJobs(rawJobs);

  if (newJobs.length === 0) {
    logger.info('No new jobs found since last run. Nothing to send.');
    process.exit(0);
  }

  try {
    await notifyJobs(newJobs);
  } catch (err) {
    logger.error('Telegram notification failed:', err.message);
    process.exit(1);
  }

  logger.info(`=== Pipeline complete — ${newJobs.length} alert(s) sent ===`);
}

run();
