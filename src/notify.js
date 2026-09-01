const logger = require('./logger');

/**
 * Yagona notify hook. Hozircha faqat log yozadi.
 * Kelajakda shu funksiya ichiga Telegram/email integratsiyasini qo'shish kifoya
 * (masalan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env orqali).
 */
async function notify(event) {
  logger.info(`[notify] ${event.type}: ${event.message}`);
}

async function notifyBackupSuccess({ s3Key, sizeMb, durationSec }) {
  await notify({
    type: 'backup_success',
    message: `Backup muvaffaqiyatli: ${s3Key} (${sizeMb} MB, ${durationSec}s)`,
  });
}

async function notifyBackupFailure(err, { durationSec }) {
  await notify({
    type: 'backup_failure',
    message: `Backup xato bilan tugadi (${durationSec}s): ${err.message}`,
  });
}

module.exports = { notify, notifyBackupSuccess, notifyBackupFailure };
