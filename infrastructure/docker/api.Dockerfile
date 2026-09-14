# syntax=docker/dockerfile:1
# Engora API image: one image, three binaries (server, worker, migrate).
# Build context: apps/api

FROM golang:1.25-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata wget \
 && addgroup -S engora && adduser -S engora -G engora \
 && mkdir -p /app/var/storage && chown -R engora:engora /app

WORKDIR /app
COPY --from=build /out/ /app/
USER engora

ENV APP_ENV=production \
    APP_PORT=8000 \
    LOG_FORMAT=json

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8000/health/live >/dev/null || exit 1

ENTRYPOINT ["/app/server"]
