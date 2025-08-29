FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY docs/openapi.json ./openapi.json
COPY seed/initial-data.json ./initial-data.json
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

CMD ["node", "src/index.js"]
