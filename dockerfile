FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY initial-data.json ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
