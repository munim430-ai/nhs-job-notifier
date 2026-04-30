/**
 * Self-contained test suite — runs with no real API keys.
 *
 * Tests:
 *   1. extractJobRef — stable ID extraction
 *   2. passesFilters — keyword / location / pay-band filtering
 *   3. filterNewJobs — full deduplication flow
 *   4. filterNewJobs — edge cases (empty, null, no-ref)
 *   5. escape + formatJobMessage — Telegram MarkdownV2 formatting
 *   6. Scraper module shape
 *
 * Run: node src/test.js
 */

// Provide env vars so modules don't error on missing credentials
process.env.FILTER_KEYWORDS    = 'nurse,midwife';
process.env.FILTER_LOCATIONS   = 'London,Birmingham';
process.env.MIN_PAY_BAND       = '5';
process.env.LOOKBACK_DAYS      = '1';
process.env.WEBHOOK_SECRET     = 'test-secret';
process.env.TELEGRAM_BOT_TOKEN = 'dummy';
process.env.TELEGRAM_CHAT_ID   = '12345';
process.env.APIFY_API_TOKEN    = 'dummy';

const { filterNewJobs, resetDb, extractJobRef, passesFilters } = require('./deduplicator');
const { formatJobMessage, escape } = require('./telegram');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeJob = (overrides = {}) => ({
  jobRef:      'REF-001',
  jobTitle:    'Staff Nurse',
  location:    'London',
  payBand:     'Band 5',
  salary:      '£30,000',
  closingDate: '2025-06-01',
  url:         'https://jobs.nhs.uk/job/REF-001',
  ...overrides,
});

// ── Test 1: extractJobRef ─────────────────────────────────────────────────────
console.log('\n[1] extractJobRef');
assert('uses jobRef when present',  extractJobRef(makeJob()) === 'REF-001');
assert('falls back to id',          extractJobRef({ id: 'ID-99' }) === 'ID-99');
assert('falls back to url',         extractJobRef({ url: 'https://x.com' }) === 'https://x.com');
assert('returns null when no ref',  extractJobRef({}) === null);

// ── Test 2: passesFilters ─────────────────────────────────────────────────────
console.log('\n[2] passesFilters');
assert('passes matching job',         passesFilters(makeJob()));
assert('rejects wrong keyword',       !passesFilters(makeJob({ jobTitle: 'Consultant Surgeon' })));
assert('rejects wrong location',      !passesFilters(makeJob({ location: 'Edinburgh' })));
assert('rejects below min band',      !passesFilters(makeJob({ payBand: 'Band 3' })));
assert('passes band above minimum',   passesFilters(makeJob({ payBand: 'Band 7' })));
assert('passes when band not set',    passesFilters(makeJob({ payBand: '' })));

// ── Test 3: filterNewJobs — deduplication ─────────────────────────────────────
console.log('\n[3] filterNewJobs — deduplication');
resetDb();

const jobs1 = [makeJob({ jobRef: 'A1' }), makeJob({ jobRef: 'A2' })];
const result1 = filterNewJobs(jobs1);
assert('first run returns both new jobs',          result1.length === 2);

const result2 = filterNewJobs(jobs1);
assert('second run with same jobs returns 0',      result2.length === 0);

const jobs2 = [makeJob({ jobRef: 'A1' }), makeJob({ jobRef: 'A3' })];
const result3 = filterNewJobs(jobs2);
assert('mixed run returns only the truly new job', result3.length === 1 && result3[0].jobRef === 'A3');

// ── Test 4: filterNewJobs — edge cases ───────────────────────────────────────
console.log('\n[4] filterNewJobs — edge cases');
assert('handles empty array',      filterNewJobs([]).length === 0);
assert('handles null gracefully',  filterNewJobs(null).length === 0);
assert('skips job with no ref',    filterNewJobs([{ jobTitle: 'Ghost Job' }]).length === 0);

// ── Test 5: Telegram formatting ──────────────────────────────────────────────
console.log('\n[5] Telegram formatting');

// escape() must prepend \ to every MarkdownV2 special character
const specials = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\'];
const allEscaped = specials.every(c => escape(c) === '\\' + c);
assert('escape() prepends \\ to every MarkdownV2 special', allEscaped);
assert('escape() leaves plain text untouched', escape('hello world 123') === 'hello world 123');

const msg = formatJobMessage(makeJob(), 1, 3);
assert('message includes job title',       msg.includes('Staff Nurse'));
assert('message includes location',        msg.includes('London'));
assert('message includes band',            msg.includes('Band'));
assert('message includes alert header',    msg.includes('NHS Job Alert'));
assert('message includes index/total',     msg.includes('1/3'));

const msgMissing = formatJobMessage({}, 1, 1);
assert('handles completely missing fields', typeof msgMissing === 'string' && msgMissing.length > 0);

// ── Test 6: Scraper module shape ─────────────────────────────────────────────
console.log('\n[6] Scraper module exports');
const scraper = require('./scraper');
assert('exports scrapeJobs',         typeof scraper.scrapeJobs === 'function');
assert('exports fetchDataset',       typeof scraper.fetchDataset === 'function');
assert('exports startActorRun',      typeof scraper.startActorRun === 'function');
assert('exports waitForRunAndFetch', typeof scraper.waitForRunAndFetch === 'function');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(45)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests failed — see output above.');
  process.exit(1);
} else {
  console.log('All tests passed ✓');
}
