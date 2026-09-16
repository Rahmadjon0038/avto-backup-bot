const fs = require('fs');
const {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const logger = require('./logger');

const BACKUP_PREFIX = 'backups/';

function buildClientConfig() {
  const cfg = {
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    // Cloudflare R2/MinIO kabi S3-mos xizmatlar AWS SDK v3'ning yangi
    // versiyalarida standart yoqilgan "flexible checksum" (aws-chunked trailer)
    // formatini to'liq qo'llab-quvvatlamaydi - shu sozlama bo'lmasa upload
    // tushunarsiz xato bilan muvaffaqiyatsiz tugashi mumkin.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };

  // S3_ENDPOINT bo'sh bo'lsa (haqiqiy AWS S3), endpoint override qilinmaydi -
  // SDK o'zi to'g'ri AWS regional endpoint'ni tanlaydi.
  const endpoint = (process.env.S3_ENDPOINT || '').trim();
  if (endpoint) {
    cfg.endpoint = endpoint;
    cfg.forcePathStyle = true; // MinIO va boshqa S3-mos storage uchun zarur
  }

  return cfg;
}

let client;
function getClient() {
  if (!client) client = new S3Client(buildClientConfig());
  return client;
}

async function ensureBucketExists(bucket) {
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    throw new Error(
      `S3 bucket "${bucket}" topilmadi yoki unga kirish imkoni yo'q (${err.name || err.message}). ` +
      `Avval bucket'ni MinIO/S3'da qo'lda yarating va S3_BUCKET/S3_ENDPOINT/kalitlarni tekshiring.`
    );
  }
}

async function uploadFile(localPath, key) {
  const bucket = process.env.S3_BUCKET;
  const body = fs.createReadStream(localPath);
  try {
    await getClient().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }));
  } catch (err) {
    throw new Error(`S3'ga yuklashda xato (${key}): ${err.message}`);
  }
}

async function listAllBackups() {
  const bucket = process.env.S3_BUCKET;
  const objects = [];
  let continuationToken;

  do {
    const resp = await getClient().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: BACKUP_PREFIX,
      ContinuationToken: continuationToken,
    }));

    objects.push(...(resp.Contents || []));
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

// Har doim faqat eng so'nggi `retentionCount` ta backupni saqlaydi - sanadan
// qat'iy nazar, undan ortiqcha (eskiroq) fayllarni o'chiradi.
async function cleanupOldBackups(retentionCount) {
  const bucket = process.env.S3_BUCKET;
  let deletedCount = 0;

  try {
    const objects = await listAllBackups();
    objects.sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

    const toDelete = objects.slice(Math.max(retentionCount, 0));
    for (const obj of toDelete) {
      await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      deletedCount += 1;
    }
  } catch (err) {
    // Retention tozalashdagi xato butun backup jarayonini muvaffaqiyatsiz qilmasin -
    // dump S3'ga allaqachon muvaffaqiyatli yuklangan bo'ladi.
    logger.error(`Eski backuplarni tozalashda xato: ${err.message}`);
  }

  return deletedCount;
}

module.exports = { BACKUP_PREFIX, ensureBucketExists, uploadFile, cleanupOldBackups };
