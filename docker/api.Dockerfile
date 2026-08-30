# LEAFNET Node API + Frontend — Production
# Multi-stage build: installs deps → builds web + api → slim production image.
# In production the API serves the React frontend from the same origin,
# so relative /api paths work without CORS or proxy configuration.

# ── Stage 1: build ──────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Install all workspace dependencies (root + api + web)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# Generate Prisma client (PostgreSQL provider for production)
COPY prisma prisma
RUN npx prisma generate --schema prisma/schema.prisma

# Build the React frontend (Vite → dist/)
COPY apps/web apps/web
RUN npm run build --workspace @mulberry/web

# Build the Express API (TypeScript → dist/)
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build --workspace @mulberry/api

# ── Stage 2: production ─────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

# Production dependencies only
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev

# Prisma schema + generated client (needed at runtime for migrations)
COPY prisma prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# Built API (apps/api/dist/)
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Built frontend (apps/web/dist/) — served as static files by the API
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Runtime environment
ENV NODE_ENV=production \
    API_PORT=4000 \
    UPLOAD_DIRECTORY=/var/data/uploads

RUN mkdir -p /var/data/uploads

EXPOSE 4000

# Run Prisma migrations then start the API server.
# `prisma migrate deploy` is idempotent — safe to run on every start.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/server.js"]
