FROM node:18-slim

# ✅ تثبيت FFmpeg و yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ✅ التحقق من تثبيت FFmpeg
RUN ffmpeg -version && yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]