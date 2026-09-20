FROM node:22-bookworm-slim

# Install ffmpeg and required libraries for WebRTC
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Start the bot
CMD ["npm", "start"]
