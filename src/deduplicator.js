/**
 * Deduplication engine — tracks which jobs have been seen and filters new ones.
 * Persists state to data/jobs.json so it survives restarts.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/jobs.json');

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { seenJobRefs: [], lastRun: null, totalSent: 0 };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * Extracts a stable unique identifier from a raw Apify job object.
 * The actor may return different field names — we try several in priority order.
 */
function extractJobRef(job) {
  return (
    job.jobRef    ||
    job.id        ||
    job.jobId     ||
    job.reference ||
    job.url       ||    // fallback: URL is usually unique per posting
    null
  );
}

/**
 * Applies keyword, location, and pay-band filters from env vars.
 */
function passesFilters(job) {
  const keywords  = process.env.FILTER_KEYWORDS
    ? process.env.FILTER_KEYWORDS.split(',').map(k => k.trim().toLowerCase())
    : [];
  const locations = process.env.FILTER_LOCATIONS
    ? process.env.FILTER_LOCATIONS.split(',').map(l => l.trim().toLowerCase())
    : [];
  const minBand   = process.env.MIN_PAY_BAND ? parseInt(process.env.MIN_PAY_BAND, 10) : null;

  // The Apify actor uses 'title' (not 'jobTitle') — check both for safety
  const title     = (job.title || job.jobTitle || '').toLowerCase();
  const location  = (job.location || job.city || '').toLowerCase();
  const bandStr   = job.payBand || job.band || '';
  const bandNum   = bandStr ? parseInt(String(bandStr).replace(/\D/g, ''), 10) : null;

  // Keyword filter: at least one keyword must appear in the job title
  if (keywords.length > 0 && !keywords.some(kw => title.includes(kw))) return false;

  // Location filter: if locations are set, the job location must match one
  if (locations.length > 0 && !locations.some(loc => location.includes(loc))) return false;

  // Pay band filter: if set, job band must be >= minimum
  if (minBand !== null && bandNum !== null && bandNum < minBand) return false;

  return true;
}

/**
 * Main function: takes a raw array of jobs, returns only new ones that pass filters.
 * Also persists the new refs so they won't be returned again on next run.
 */
function filterNewJobs(rawJobs) {
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    console.log('[deduplicator] No jobs to filter.');
    return [];
  }

  const db = loadDb();
  const seenSet = new Set(db.seenJobRefs);

  const newJobs = [];
  const skippedDupe   = [];
  const skippedFilter = [];

  for (const job of rawJobs) {
    const ref = extractJobRef(job);

    if (!ref) {
      console.warn('[deduplicator] Job has no identifiable ref, skipping:', job);
      continue;
    }

    if (seenSet.has(ref)) {
      skippedDupe.push(ref);
      continue;
    }

    if (!passesFilters(job)) {
      skippedFilter.push(ref);
      continue;
    }

    newJobs.push(job);
    seenSet.add(ref);
  }

  console.log(
    `[deduplicator] ${rawJobs.length} raw → ${newJobs.length} new ` +
    `(${skippedDupe.length} dupes, ${skippedFilter.length} filtered out)`
  );

  // Persist updated seen list
  db.seenJobRefs = [...seenSet];
  db.lastRun     = new Date().toISOString();
  db.totalSent  += newJobs.length;
  saveDb(db);

  return newJobs;
}

/**
 * Resets the seen-jobs database (useful for testing).
 */
function resetDb() {
  saveDb({ seenJobRefs: [], lastRun: null, totalSent: 0 });
  console.log('[deduplicator] Database reset.');
}

module.exports = { filterNewJobs, extractJobRef, passesFilters, resetDb };
