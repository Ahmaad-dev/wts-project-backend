FROM node:20-alpine

# Create app directory and user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev || npm i --omit=dev

# Copy source code
COPY src ./src
COPY initial-data.json ./

# Create writable directory for SQLite in Azure Arc
RUN mkdir -p /tmp && chown -R nextjs:nodejs /tmp

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Environment and port for Azure Container Apps
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# Health check compatible with Azure Arc
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get({hostname:'localhost',port:8080,path:'/health',timeout:8000}, (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => { process.exit(1) })"

CMD ["node","src/index.js"]
