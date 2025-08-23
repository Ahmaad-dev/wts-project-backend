FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY src ./src
COPY initial-data.json ./
ENV PORT=8080
EXPOSE 8080
CMD ["node","src/index.js"]
