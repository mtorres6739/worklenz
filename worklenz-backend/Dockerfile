# --- Stage 1: Build ---
FROM node:20-slim AS builder

ARG RELEASE_VERSION
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    postgresql-server-dev-all \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

RUN echo "$RELEASE_VERSION" > release

# --- Stage 2: Production Image ---
FROM node:20-slim

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends libpq5 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/release ./release
COPY --from=builder /usr/src/app/worklenz-email-templates ./worklenz-email-templates
COPY --from=builder /usr/src/app/database ./database
COPY --from=builder /usr/src/app/scripts ./scripts

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "build/bin/www"]
