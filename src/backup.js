require('dotenv').config();

const { spawn } = require('child_process');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');

const logger = require('./logger');
const { notifyBackupSuccess, notifyBackupFailure } = require('./notify');
const { ensureBucketExists, uploadFile, cleanupOldBackups, BACKUP_PREFIX } = require('./s3');

const config = {
  dbContainer: process.env.DB_CONTAINER_NAME || 'postgres16',
  dbName: process.env.DB_NAME || 'lms',
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD || '',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
  bucket: process.env.S3_BUCKET,
};

function validateConfig() {
  const missing = [];
  if (!process.env.S3_BUCKET) missing.push('S3_BUCKET');
  if (!process.env.S3_ACCESS_KEY) missing.push('S3_ACCESS_KEY');
  if (!process.env.S3_SECRET_KEY) missing.push('S3_SECRET_KEY');

  if (missing.length > 0) {
    throw new Error(`Majburiy environment variable(lar) yo'q: ${missing.join(', ')}`);
  }
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

// docker exec <container> pg_dump -U <user> -d <db> | gzip > tmpFile
// Faqat O'QISH: bu funksiya postgres16 konteynerini hech qachon yaratmaydi/o'chirmaydi/restart qilmaydi.
function dumpAndCompress(tmpFilePath) {
  return new Promise((resolve, reject) => {
    const args = ['exec'];
    if (config.dbPassword) args.push('-e', `PGPASSWORD=${config.dbPassword}`);
    args.push(config.dbContainer, 'pg_dump', '-U', config.dbUser, '-d', config.dbName);

    logger.info(`pg_dump ishga tushirilmoqda: docker exec ${config.dbContainer} pg_dump -U ${config.dbUser} -d ${config.dbName}`);

    const dockerProc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const gzip = zlib.createGzip();
    const output = fs.createWriteStream(tmpFilePath);

    let stderrOutput = '';
    let settled = false;
    let exitCode = null;
    let writeFinished = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      dockerProc.kill('SIGTERM');
      reject(err);
    };

    const maybeResolve = () => {
      if (settled) return;
      if (exitCode === 0 && writeFinished) {
        settled = true;
        resolve();
      }
    };

    dockerProc.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    dockerProc.on('error', (err) => {
      fail(new Error(`docker exec ishga tushmadi (docker CLI/socket mavjudmi?): ${err.message}`));
    });

    gzip.on('error', (err) => fail(new Error(`Gzip siqishda xato: ${err.message}`)));
    output.on('error', (err) => fail(new Error(`Faylga yozishda xato: ${err.message}`)));

    dockerProc.stdout.pipe(gzip).pipe(output);

    output.on('finish', () => {
      writeFinished = true;
      maybeResolve();
    });

    dockerProc.on('close', (code) => {
      exitCode = code;
      if (code !== 0) {
        fail(new Error(`pg_dump/docker exec muvaffaqiyatsiz tugadi (exit code ${code}). stderr: ${stderrOutput.trim() || "noma'lum xato"}`));
        return;
      }
      maybeResolve();
    });
  });
}

async function run() {
  const startedAt = Date.now();
  let tmpFilePath = null;

  try {
    validateConfig();
    await ensureBucketExists(config.bucket);

    const timestamp = formatTimestamp(new Date());
    const fileName = `lms_${config.dbName}_${timestamp}.sql.gz`;
    tmpFilePath = path.join(os.tmpdir(), fileName);

    logger.info(`Backup boshlandi: konteyner="${config.dbContainer}" baza="${config.dbName}" -> ${fileName}`);

    await dumpAndCompress(tmpFilePath);

    const stats = fs.statSync(tmpFilePath);
    if (stats.size === 0) {
      throw new Error("Dump fayli bo'sh (0 bayt) - pg_dump hech narsa qaytarmagan bo'lishi mumkin");
    }

    const s3Key = `${BACKUP_PREFIX}${fileName}`;
    await uploadFile(tmpFilePath, s3Key);

    fs.unlinkSync(tmpFilePath);

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    logger.info(`Backup muvaffaqiyatli yakunlandi: ${s3Key} (${sizeMb} MB, ${durationSec}s)`);

    const deletedCount = await cleanupOldBackups(config.retentionDays);
    if (deletedCount > 0) {
      logger.info(`Retention tozalash: ${deletedCount} ta eski backup o'chirildi (${config.retentionDays} kundan eski)`);
    }

    await notifyBackupSuccess({ s3Key, sizeMb, durationSec });
  } catch (err) {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      try { fs.unlinkSync(tmpFilePath); } catch (_) { /* diskni to'ldirmaslik uchun best-effort tozalash */ }
    }

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.error(`Backup muvaffaqiyatsiz tugadi (${durationSec}s): ${err.message}`);
    await notifyBackupFailure(err, { durationSec });
    throw err;
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
