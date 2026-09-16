# avto-backup-bot

`postgres16` konteynerida ishlayotgan PostgreSQL bazasini (`lms`) har kuni avtomatik
`pg_dump` orqali zaxiralab, gzip bilan siqib, S3-mos storage'ga (MinIO yoki AWS S3)
yuklaydigan mustaqil bot.

Bu loyiha asosiy LMS ilovasi (`lms-backend1`) bilan **hech qanday bog'liqligi yo'q**:
o'z Dockerfile'i, o'z docker-compose'i, o'z konteyneri va o'z tarmog'i bilan ishlaydi.
`postgres16` konteyneriga faqat `docker exec ... pg_dump` orqali **o'qish** uchun murojaat
qiladi - uni hech qachon yaratmaydi, o'chirmaydi, restart qilmaydi yoki uning
docker-compose konfiguratsiyasiga tegmaydi.

## Qanday ishlaydi

1. Konteyner ichida `crond` (busybox) `BACKUP_SCHEDULE` jadvali bo'yicha (standart:
   har kuni 23:00, `TZ=Asia/Tashkent`) `node src/backup.js` skriptini ishga tushiradi.
2. Skript `docker exec postgres16 pg_dump -U postgres -d lms` buyrug'ini ishga
   tushiradi, natijani to'g'ridan-to'g'ri gzip orqali siqib, vaqtinchalik faylga yozadi.
3. Fayl S3/MinIO'dagi `S3_BUCKET` bucket'iga `backups/lms_<baza>_<sana_vaqt>.sql.gz`
   nomi bilan yuklanadi.
4. Yuklangandan so'ng vaqtinchalik fayl darhol diskdan o'chiriladi.
5. Har safar `RETENTION_COUNT`dan ortiq backup to'planib qolsa, eng eskilari bucket'dan avtomatik o'chiriladi (har doim faqat so'nggi `RETENTION_COUNT` ta saqlanadi).
6. Har bir urinish haqida konsolga (`docker logs`) va (ixtiyoriy) `LOG_FILE`ga
   log yoziladi.

`postgres16` konteyneriga kirish uchun bot ichiga `docker` CLI o'rnatilgan va
host'ning `/var/run/docker.sock` sokceti ulangan (faqat shu maqsad uchun -
`docker exec` chaqirish uchun; bot boshqa hech qanday docker buyrug'idan
foydalanmaydi). `docker exec` daemon darajasida ishlagani uchun botning
`postgres16` bilan bir xil tarmoqda bo'lishi shart emas - shuning uchun
docker-compose.yml'da hech qanday tashqi tarmoq yoki umumiy volume yo'q.

## O'rnatish

```bash
cd avto-backup-bot
npm install          # faqat lokal (docker-siz) test qilish/lint uchun, shart emas
cp .env.example .env
```

`.env` faylini oching va quyidagilarni to'ldiring:

- `S3_ENDPOINT` - mahalliy MinIO manzili (masalan `http://host.docker.internal:9000`
  yoki agar MinIO ham docker-compose'da bo'lsa, uning konteyner nomi:port)
- `S3_ACCESS_KEY`, `S3_SECRET_KEY` - MinIO/AWS kirish kalitlari
- `S3_BUCKET` - oldindan qo'lda yaratilgan bucket nomi (masalan `lms-backups`)
- `DB_CONTAINER_NAME`, `DB_NAME`, `DB_USER` - kerak bo'lsa standartlarni o'zgartiring

**Muhim:** bucket avtomatik yaratilmaydi. U mavjud bo'lishi shart - aks holda bot
aniq xato bilan to'xtaydi ("S3 bucket ... topilmadi").

## Ishga tushirish

```bash
./deploy.sh
```

Bu `docker compose up -d --build` qiladi (git pull qilmaydi - kod allaqachon
mahalliy diskda bo'lishi kerak).

## Qo'lda test qilish (cron kutmasdan)

Konteyner ishga tushgandan keyin, deploy qilishdan oldin bitta backup'ni qo'lda
sinab ko'rish uchun:

```bash
docker exec avto-backup-bot node src/backup.js --once
```

Muvaffaqiyatli bo'lsa, konsolda shunga o'xshash loglarni ko'rasiz:

```
[...] [INFO] Backup boshlandi: konteyner="postgres16" baza="lms" -> lms_lms_20260826_230000.sql.gz
[...] [INFO] Backup muvaffaqiyatli yakunlandi: backups/lms_lms_20260826_230000.sql.gz (4.32 MB, 2.1s)
```

Loglarni istalgan vaqt ko'rish uchun:

```bash
docker logs -f avto-backup-bot
```

## Muhit o'zgaruvchilari (`.env`)

| O'zgaruvchi | Standart | Tavsif |
|---|---|---|
| `S3_ENDPOINT` | (bo'sh) | MinIO manzili. Bo'sh bo'lsa - haqiqiy AWS S3 endpoint'lari ishlatiladi |
| `S3_ACCESS_KEY` | - | S3/MinIO access key (majburiy) |
| `S3_SECRET_KEY` | - | S3/MinIO secret key (majburiy) |
| `S3_BUCKET` | - | Bucket nomi (majburiy, oldindan mavjud bo'lishi kerak) |
| `S3_REGION` | `us-east-1` | AWS region (MinIO buni e'tiborsiz qoldiradi) |
| `RETENTION_COUNT` | `2` | Har doim faqat so'nggi shuncha ta backup saqlanadi, qolganlari o'chiriladi |
| `BACKUP_SCHEDULE` | `0 23 * * *` | Cron ifodasi |
| `TZ` | `Asia/Tashkent` | Cron va loglar uchun vaqt zonasi |
| `DB_CONTAINER_NAME` | `postgres16` | Backup qilinadigan Postgres konteyner nomi |
| `DB_NAME` | `lms` | Baza nomi |
| `DB_USER` | `postgres` | pg_dump uchun user |
| `DB_PASSWORD` | (bo'sh) | Faqat trust bo'lmagan auth kerak bo'lsa |
| `LOG_FILE` | `/app/logs/backup.log` | Bo'sh qoldirilsa faqat konsolga yoziladi |

## Haqiqiy AWS S3'ga o'tish

Faqat `.env` faylini o'zgartirish kifoya, kodga tegish shart emas:

1. `S3_ENDPOINT=` qatorini butunlay bo'sh qoldiring (yoki o'chirib tashlang).
2. `S3_ACCESS_KEY` / `S3_SECRET_KEY` - AWS IAM kalitlari bilan almashtiring
   (S3'ga faqat kerakli bucket uchun `PutObject`/`ListBucket`/`DeleteObject`/
   `HeadBucket` ruxsatlari bilan cheklangan IAM policy tavsiya etiladi).
3. `S3_BUCKET` - AWS'dagi haqiqiy bucket nomi.
4. `S3_REGION` - bucket joylashgan region (masalan `eu-central-1`).
5. `docker compose up -d --build` bilan konteynerni qayta ishga tushiring
   (yoki `./deploy.sh`).

## Cloudflare R2'ga ulash

R2 - S3-mos storage bo'lgani uchun kodga tegmasdan, faqat `.env` orqali ulanadi:

1. Cloudflare dashboard > R2 > bucket yarating (masalan `backup`).
2. R2 > **Manage R2 API Tokens** > **Create API Token** > ruxsat: "Object Read &
   Write", kerak bo'lsa faqat shu bucket'ga scope qiling. Yaratilgach ko'rsatiladigan
   **Access Key ID** va **Secret Access Key**'ni saqlab qoling (faqat bir marta
   ko'rsatiladi).
3. `.env`ga quyidagilarni yozing:
   - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` - **bucket nomisiz**,
     faqat account-level manzil (bucket dashboard'da ko'rsatilgan
     `.../r2.cloudflarestorage.com/<bucket>` manzilidagi oxirgi qismni olib tashlang,
     aks holda bucket nomi ikki marta qo'shilib xato beradi).
   - `S3_ACCESS_KEY` / `S3_SECRET_KEY` - 2-qadamdagi qiymatlar.
   - `S3_BUCKET` - bucket nomi (masalan `backup`).
   - `S3_REGION=auto` - Cloudflare tavsiyasi (R2 buni e'tiborsiz qoldiradi).
4. `./deploy.sh` bilan qayta ishga tushiring va
   `docker exec avto-backup-bot node src/backup.js --once` bilan sinab ko'ring.

## Xatolarni bildirish (notify hook)

[src/notify.js](src/notify.js) ichida `notify()` funksiyasi bor - hozircha faqat
log yozadi. Kelajakda Telegram/email xabarnoma qo'shish uchun shu funksiya
ichini to'ldirish kifoya (masalan `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` env
orqali) - qolgan kod (`backup.js`) o'zgarishsiz qoladi, chunki muvaffaqiyat va
xato holatlarida `notifyBackupSuccess()`/`notifyBackupFailure()` allaqachon
chaqiriladi.

## Xavfsizlik eslatmalari

- `.env` fayli `.gitignore`da - hech qachon commit qilinmaydi. Faqat
  `.env.example` (placeholder qiymatlar bilan) repoda saqlanadi.
- Kodda hech qanday parol/kalit hardcode qilinmagan.
- `postgres16` konteyneriga faqat `docker exec ... pg_dump` (o'qish) orqali
  murojaat qilinadi - bot hech qachon `docker rm`/`docker stop`/`docker run`
  kabi buyruqlarni ishlatmaydi va `postgres16`ning docker-compose fayliga
  hech qanday aloqasi yo'q.
- `docker-compose.yml`da `lms-backend1` loyihasi bilan to'qnashadigan hech
  qanday konteyner nomi, volume nomi yoki tarmoq nomi ishlatilmagan.
- `/var/run/docker.sock` botga host'dagi docker daemon'ga to'liq kirish
  imkonini beradi (bu yondashuvning tabiiy cheklovi). Agar bundan-da toraytirilgan
  ruxsat kerak bo'lsa, `tecnativa/docker-socket-proxy` kabi vositani qo'shib,
  faqat `exec` operatsiyasiga ruxsat berish mumkin - bu README doirasidan
  tashqarida, lekin kod (`docker` CLI `DOCKER_HOST` orqali ishlaydi) buni
  qo'shimcha o'zgarishlarsiz qo'llab-quvvatlaydi.

## Loyiha tuzilishi

```
avto-backup-bot/
  Dockerfile           # node:20-alpine + docker-cli + tzdata
  docker-compose.yml   # bitta backup-bot xizmati, mustaqil tarmoq
  entrypoint.sh         # crontab'ni sozlaydi va crond'ni foreground'da ishga tushiradi
  deploy.sh             # docker compose up -d --build (git pull qilmaydi)
  .env.example
  package.json
  src/
    backup.js           # asosiy orkestratsiya: dump -> gzip -> upload -> cleanup
    s3.js                # S3/MinIO client (AWS SDK v3)
    logger.js            # konsol + ixtiyoriy fayl logging
    notify.js            # kengaytiriladigan notify hook
```
