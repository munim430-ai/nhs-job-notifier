/**
 * Lightweight Express server that receives Apify's webhook callback
 * when a scraper run finishes, then triggers the Telegram notification pipeline.
 *
 * Usage (with ngrok or similar tunnel):
 *   node src/webhook-server.js
 *   npx ngrok http 3000        ← gives you a public URL like https://abc.ngrok.io
 *   Pass that URL when starting a scrape run (see scraper.js startActorRun)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express           = require('express');
const { fetchDataset }  = require('./scraper');
const { filterNewJobs } = require('./deduplicator');
const { notifyJobs }    = require('./telegram');

const app    = express();
const PORT   = parseInt(process.env.WEBHOOK_PORT || '3000', 10);
const SECRET = process.env.WEBHOOK_SECRET || '';

app.use(express.json());

// Health-check — lets Apify (or you) verify the server is alive
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

/**
 * POST /webhook — Apify calls this when a scraper run succeeds or fails.
 * Expected body: { runId, status, datasetId, secret }
 */
app.post('/webhook', async (req, res) => {
  const { runId, status, datasetId, secret } = req.body || {};

  // Reject calls that don't carry the shared secret
  if (SECRET && secret !== SECRET) {
    console.warn('[webhook] Rejected — invalid secret.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[webhook] Received — runId=${runId}, status=${status}`);

  // Respond immediately so Apify doesn't timeout and retry
  res.json({ received: true });

  if (status !== 'ACTOR.RUN.SUCCEEDED') {
    console.warn(`[webhook] Run did not succeed (${status}). Skipping.`);
    return;
  }

  if (!datasetId) {
    console.error('[webhook] No datasetId in payload — cannot fetch results.');
    return;
  }

  try {
    const rawJobs = await fetchDataset(datasetId);
    const newJobs = filterNewJobs(rawJobs);
    await notifyJobs(newJobs);
  } catch (err) {
    console.error('[webhook] Pipeline error:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`[webhook-server] Listening on http://localhost:${PORT}`);
  console.log(`[webhook-server] Health:   http://localhost:${PORT}/health`);
  console.log(`[webhook-server] Endpoint: http://localhost:${PORT}/webhook`);
  console.log(`[webhook-server] Expose:   npx ngrok http ${PORT}`);
});
