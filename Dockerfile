# syntax=docker/dockerfile:1

# ─── Stage 1: Install dependencies ──────────────────────────────────
FROM oven/bun:1.3-alpine AS deps

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production=false

# ─── Stage 2: Generate Prisma client ────────────────────────────────
FROM deps AS generate

COPY prisma ./prisma
RUN bunx prisma generate

# ─── Stage 3: Production image ──────────────────────────────────────
FROM oven/bun:1.3-alpine AS runner

WORKDIR /app

# Copy node_modules with generated Prisma client
COPY --from=generate /app/node_modules ./node_modules
COPY --from=generate /app/prisma ./prisma
COPY package.json ./
COPY src ./src

# Prisma needs the schema at runtime for migrations
ENV NODE_ENV=production
EXPOSE 4000

# Run migrations then start the server
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run src/index.ts"]
