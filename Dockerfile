# استخدام صورة Node.js الرسمية
FROM node:18-slim

# تثبيت المتطلبات الأساسية و FFmpeg و Python و yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# تثبيت yt-dlp
RUN pip3 install yt-dlp --no-cache-dir

# تعيين مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات package.json أولاً (لتثبيت الاعتماديات بكفاءة)
COPY package*.json ./

# تثبيت اعتماديات Node.js
RUN npm ci --only=production

# نسخ باقي ملفات المشروع
COPY . .

# فتح المنفذ الذي سيستخدمه التطبيق
EXPOSE 3000

# تشغيل التطبيق
CMD ["node", "server.js"]