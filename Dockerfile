# pss-pdf-service — HTML -> PDF via pooled Chromium.
# Playwright base image ships matching Chromium + system deps (multi-arch:
# amd64 for local testing, arm64 for the Orin).
FROM mcr.microsoft.com/playwright:v1.55.0-noble AS base

WORKDIR /app

# Brand font available to Chromium even when callers don't embed it.
COPY fonts/ /usr/local/share/fonts/
RUN fc-cache -f

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm install --no-save typescript @types/express @types/node

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

ENV NODE_ENV=production
ENV PORT=8017
EXPOSE 8017

USER pwuser
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
