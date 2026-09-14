# syntax=docker/dockerfile:1
# Engora web image (Next.js standalone output).
# Build context: repository root (the web app depends on workspace packages).

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/validation/package.json packages/validation/
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /repo ./
COPY . .
RUN npm run build -w @engora/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
RUN addgroup -S engora && adduser -S engora -G engora
COPY --from=build --chown=engora:engora /repo/apps/web/.next/standalone ./
COPY --from=build --chown=engora:engora /repo/apps/web/.next/static ./apps/web/.next/static
USER engora
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
