FROM node:20-alpine
WORKDIR /app

# nur package files für Cache
COPY package*.json ./
RUN npm ci --omit=dev

# App-Code
COPY src ./src
COPY initial-data.json ./

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
