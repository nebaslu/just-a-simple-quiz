const path = require('node:path');
const fs = require('node:fs');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 1024 * 1024);
const LOG_MAX_FILES = Number(process.env.LOG_MAX_FILES || 5);

fs.mkdirSync(LOG_DIR, { recursive: true });

function pruneRotatedLogs() {
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((name) => /^server-\d{8}-\d{6}\.log$/.test(name))
    .sort();

  while (files.length > LOG_MAX_FILES) {
    const oldest = files.shift();
    if (oldest) {
      fs.unlinkSync(path.join(LOG_DIR, oldest));
    }
  }
}

function rotateLogIfNeeded() {
  if (!fs.existsSync(LOG_FILE)) return;

  const size = fs.statSync(LOG_FILE).size;
  if (size < LOG_MAX_BYTES) return;

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rotated = path.join(LOG_DIR, `server-${stamp}.log`);
  fs.renameSync(LOG_FILE, rotated);
  pruneRotatedLogs();
}

function logEvent(event, details = {}) {
  rotateLogIfNeeded();
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details });
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

module.exports = { logEvent };
