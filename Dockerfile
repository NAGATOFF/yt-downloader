FROM node:18-slim

# تثبيت المتطلبات الأساسية
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# ✅ تثبيت Deno (JavaScript Runtime المطلوب لـ yt-dlp)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:$PATH"

# ✅ تثبيت yt-dlp
RUN pip3 install yt-dlp --no-cache-dir --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]