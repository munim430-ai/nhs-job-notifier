# NHS Job Notifier

Monitors NHS Jobs via Apify, deduplicates postings, and sends Telegram alerts for new matching jobs.

## Architecture

```
Apify (crawlerbros/nhs-jobs-scraper)
        │
        │  actor run (polling or webhook)
        ▼
src/scraper.js          — triggers run, polls for completion, fetches dataset
        │
        ▼
src/deduplicator.js     — filters by keyword/location/band, drops already-seen jobs
        │                 persists seen refs → data/jobs.json
        ▼
src/telegram.js         — formats & sends Telegram Bot API messages (free, unlimited)
```

## File Map

| Path | Role |
|------|------|
| `src/index.js` | Entry point — polling-mode orchestrator |
| `src/scraper.js` | Apify API client (start run, poll, fetch dataset) |
| `src/deduplicator.js` | Dedup + env-driven filter logic |
| `src/telegram.js` | Telegram Bot API sender + MarkdownV2 formatter |
| `src/webhook-server.js` | Express server for Apify webhook callbacks |
| `src/logger.js` | Timestamped file + console logger |
| `src/test.js` | Unit tests — no real API keys needed |
| `data/jobs.json` | Local seen-job database (gitignored) |
| `.env.example` | Credential template — copy to `.env` |

## First-Time Setup

```bash
cd nhs-job-notifier
npm install
cp .env.example .env
# Fill in .env (see Credentials section below)
node src/test.js        # verify everything works before going live
```

## Credentials

### 1 — Apify token
- Go to https://console.apify.com/account/integrations
- Copy your **Personal API token** → `APIFY_API_TOKEN`

### 2 — Telegram bot
1. Open Telegram, message **@BotFather** → `/newbot`
2. Follow prompts, copy the token → `TELEGRAM_BOT_TOKEN`
3. Send **any message** to your new bot
4. Run: `node -e "require('./src/telegram').getChatId()"`
5. Copy the printed number → `TELEGRAM_CHAT_ID`

## Running

| Mode | Command | When to use |
|------|---------|-------------|
| One-shot (polling) | `npm start` | Task Scheduler / cron |
| Webhook server | `npm run webhook` | Always-on with ngrok |
| Scraper only | `npm run scrape` | Debug Apify connection |
| Telegram test | `npm run notify` | Debug message formatting |
| Full test suite | `npm test` | After any code change |

## Scheduling on Windows (Task Scheduler)

```
Program:   node
Arguments: "C:\path\to\nhs-job-notifier\src\index.js"
Trigger:   Daily, repeat every 6 hours
```

## Always-On Mode (Webhook)

```bash
# Terminal 1 — start webhook server
npm run webhook

# Terminal 2 — expose publicly
npx ngrok http 3000

# Then set APIFY_WEBHOOK_URL in .env to the https://xxx.ngrok.io/webhook URL
# and trigger scrapes via: npm run scrape
```

## Filter Reference

| Variable | Example value | Effect |
|----------|---------------|--------|
| `FILTER_KEYWORDS` | `nurse,midwife` | Title must contain at least one keyword |
| `FILTER_LOCATIONS` | `London,Birmingham` | Location must match at least one city |
| `MIN_PAY_BAND` | `5` | Skips jobs below Band 5 |
| `LOOKBACK_DAYS` | `1` | Only jobs posted in the last N days |

Leave any filter blank to disable it.

## Free-Tier Limits

| Service | Free allowance | Safe usage |
|---------|---------------|------------|
| Apify | $5/month credit | ~100 scrape runs/month at ~$0.05 each |
| Telegram Bot API | Unlimited messages | No concern |

## Error Handling

- **Scraper fails** → Telegram alert sent to you, process exits 1
- **Job has no ID** → logged and skipped, pipeline continues
- **Telegram API error** → full error body logged, process exits 1
- **NHS site changes** → update `buildActorInput()` field names in `scraper.js`
