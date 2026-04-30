/**
 * Minimal file + console logger. Writes to logs/app.log with timestamps.
 */

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function write(level, ...args) {
  const ts  = new Date().toISOString();
  const msg = `[${ts}] [${level}] ${args.join(' ')}`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
}

module.exports = {
  info:  (...a) => write('INFO',  ...a),
  warn:  (...a) => write('WARN',  ...a),
  error: (...a) => write('ERROR', ...a),
};
