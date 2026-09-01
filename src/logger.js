const fs = require('fs');
const path = require('path');

const logFile = (process.env.LOG_FILE || '').trim();

function write(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;

  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  if (logFile) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, line + '\n');
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [ERROR] Log faylga yozib bo'lmadi (${logFile}): ${err.message}`);
    }
  }
}

module.exports = {
  info: (msg) => write('INFO', msg),
  error: (msg) => write('ERROR', msg),
};
