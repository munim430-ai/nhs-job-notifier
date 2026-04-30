/**
 * NHS Jobs direct scraper — no API key, completely free.
 *
 * Approach:
 *   1. GET /candidate/search → grab session cookie + CSRF token
 *   2. POST /candidate/search with keyword + filters → server-rendered HTML with real results
 *   3. Parse job cards using stable data-test selectors
 *   4. Repeat for each keyword in FILTER_KEYWORDS
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios   = require('axios');
const cheerio = require('cheerio');

const BASE    = 'https://www.jobs.nhs.uk';
const SEARCH  = `${BASE}/candidate/search`;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// ── Session ──────────────────────────────────────────────────────────────────

/**
 * Loads the search page, returns the CSRF token and session cookies needed
 * to make authenticated POST requests.
 */
async function getSession() {
  const r       = await axios.get(SEARCH, { headers: { 'User-Agent': UA }, timeout: 20000 });
  const cookies = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const $       = cheerio.load(r.data);
  const csrf    = $('input[name="_csrf"]').val() || '';
  if (!csrf) throw new Error('Could not extract CSRF token from NHS Jobs search page — site structure may have changed.');
  return { cookies, csrf };
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Submits a keyword search to NHS Jobs and returns the raw HTML response.
 */
async function postSearch(keyword, location, csrf, cookies, page = 1) {
  const body = new URLSearchParams({
    _csrf:    csrf,
    keyword:  keyword,
    location: location || '',
    language: 'en',
    sort:     'publicationDateDesc',
    ...(page > 1 ? { page: String(page) } : {}),
  });

  const r = await axios.post(SEARCH, body.toString(), {
    headers: {
      'User-Agent':   UA,
      'Cookie':       cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer':      SEARCH,
    },
    maxRedirects: 5,
    timeout:      20000,
  });

  return r.data;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/** Collapses all whitespace and trims a string. */
const clean = str => String(str || '').replace(/\s+/g, ' ').trim();

/**
 * Parses NHS Jobs search result HTML into structured job objects.
 * Uses the stable data-test attribute selectors discovered from the live site.
 */
function parseResults(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('[data-test="search-result"]').each(function () {
    const card = $(this);

    // Title + URL
    const titleEl   = card.find('[data-test="search-result-job-title"]').first();
    const title     = titleEl.text().trim();
    const href      = titleEl.attr('href') || '';
    // Strip keyword query params from URL to get the clean jobRef
    const cleanHref = href.split('?')[0];
    const refMatch  = cleanHref.match(/jobadvert\/([^/?#]+)/);
    const jobRef    = refMatch ? refMatch[1] : cleanHref;
    const url       = cleanHref.startsWith('http') ? cleanHref : `${BASE}${cleanHref}`;

    // Employer + location (both live inside the location container)
    const locContainer = card.find('[data-test="search-result-location"]').first();
    const employer     = locContainer.find('h3').clone().children().remove().end().text().trim();
    const location     = locContainer.find('.location-font-size').text().trim() ||
                         locContainer.find('h3').text().trim().replace(employer, '').trim();

    // Salary — strip label and collapse whitespace
    const salaryEl  = card.find('[data-test="search-result-salary"]').first();
    const salary    = clean(salaryEl.find('strong').text() || salaryEl.text().replace(/salary\s*:/i, ''));

    // Dates — strip labels and normalise whitespace
    const posted    = clean(card.find('[data-test="search-result-publicationDate"]').text().replace(/^[\s\S]*?:\s*/i, ''));
    const closing   = clean(card.find('[data-test="search-result-closingDate"]').text().replace(/^[\s\S]*?:\s*/i, ''));

    // Contract type + working pattern — strip labels
    const jobType   = clean(card.find('[data-test="search-result-jobType"]').text().replace(/^[\s\S]*?:\s*/i, ''));
    const pattern   = clean(card.find('[data-test="search-result-workingPattern"]').text().replace(/^[\s\S]*?:\s*/i, ''));

    if (title && jobRef) {
      jobs.push({ jobRef, title, employer, location, salary, payBand: '', closingDate: closing, postedDate: posted, contractType: jobType, workingPattern: pattern, url });
    }
  });

  return jobs;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Fetches results for a single keyword (with optional pagination).
 */
async function fetchForKeyword(keyword, location, session, maxPages = 2) {
  const jobs    = [];
  const seenRef = new Set();

  for (let page = 1; page <= maxPages; page++) {
    console.log(`[scraper] "${keyword}" — page ${page}`);
    const html      = await postSearch(keyword, location, session.csrf, session.cookies, page);
    const pageJobs  = parseResults(html);

    if (pageJobs.length === 0) break;

    for (const job of pageJobs) {
      if (!seenRef.has(job.jobRef)) {
        seenRef.add(job.jobRef);
        jobs.push(job);
      }
    }

    // Check if there's a next page
    const $ = cheerio.load(html);
    if (!$('[data-test="search-next-page"]').length) break;

    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[scraper] "${keyword}" → ${jobs.length} jobs`);
  return jobs;
}

/**
 * Main entry — runs all keywords and returns merged, deduplicated jobs.
 */
async function scrapeJobs() {
  const keywords  = process.env.FILTER_KEYWORDS
    ? process.env.FILTER_KEYWORDS.split(',').map(k => k.trim())
    : ['healthcare assistant'];
  const locations = process.env.FILTER_LOCATIONS
    ? process.env.FILTER_LOCATIONS.split(',').map(l => l.trim())
    : [];
  const location  = locations[0] || '';

  const session = await getSession();
  console.log(`[scraper] Session established. Searching ${keywords.length} keyword(s)...`);

  const allJobs  = [];
  const seenRefs = new Set();

  for (const kw of keywords) {
    try {
      const jobs = await fetchForKeyword(kw, location, session);
      for (const job of jobs) {
        if (!seenRefs.has(job.jobRef)) {
          seenRefs.add(job.jobRef);
          allJobs.push(job);
        }
      }
    } catch (err) {
      console.error(`[scraper] Failed to fetch "${kw}":`, err.message);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[scraper] Total unique jobs across all keywords: ${allJobs.length}`);
  return allJobs;
}

// Stub exports — kept for webhook-server.js compatibility
async function fetchDataset() { return scrapeJobs(); }
async function startActorRun() { return 'direct-scrape'; }
async function waitForRunAndFetch() { return scrapeJobs(); }

module.exports = { scrapeJobs, startActorRun, fetchDataset, waitForRunAndFetch };

if (require.main === module) {
  scrapeJobs()
    .then(jobs => {
      if (jobs.length > 0) {
        console.log('\nSample job:');
        console.log(JSON.stringify(jobs[0], null, 2));
      }
      console.log(`\nTotal: ${jobs.length} jobs`);
    })
    .catch(err => { console.error('[scraper]', err.message); process.exit(1); });
}
