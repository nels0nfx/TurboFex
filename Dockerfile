# TurboFex in Docker.  Build and start:  docker compose up -d --build   (see "Hosting guides" in README.md)
FROM node:22-slim
WORKDIR /app
# git: some WhatsApp library packages are fetched from GitHub. ffmpeg: stickers, audio and video commands.
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
CMD ["node", "index.js"]
