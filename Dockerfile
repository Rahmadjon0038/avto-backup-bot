FROM node:20-alpine

# docker-cli - postgres16 konteyneriga "docker exec" orqali kirish uchun (faqat shu maqsadda, o'qish uchun)
# tzdata - BACKUP_SCHEDULE'ni Asia/Tashkent kabi mahalliy vaqt zonasida to'g'ri ishga tushirish uchun
RUN apk add --no-cache docker-cli tzdata

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p /app/logs

ENV NODE_ENV=production

ENTRYPOINT ["./entrypoint.sh"]
