ARG OPENCLAW_NODE_BOOKWORM_IMAGE="node:24-bookworm@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b"
ARG OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE="node:24-bookworm-slim@sha256:e8e2e91b1378f83c5b2dd15f0247f34110e2fe895f6ca7719dbb780f929368eb"
ARG OPENCLAW_NODE_BOOKWORM_SLIM_DIGEST="sha256:e8e2e91b1378f83c5b2dd15f0247f34110e2fe895f6ca7719dbb780f929368eb"

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS build

# Install Bun (required for build scripts).
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      if curl --retry 5 --retry-all-errors --retry-delay 2 -fsSL https://bun.sh/install | bash; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep $((attempt * 2)); \
    done
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

# Copy dependency manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY openclaw.mjs ./
COPY patches ./patches
COPY ui/package.json ./ui/package.json
COPY scripts/postinstall-bundled-plugins.mjs \
     scripts/preinstall-package-manager-warning.mjs \
     scripts/npm-runner.mjs \
     scripts/windows-cmd-helpers.mjs \
     ./scripts/

# Copy all source files including extensions and conocimiento.
COPY . .

# Install all dependencies.
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm install --prefer-frozen-lockfile

# Build the application.
RUN pnpm canvas:a2ui:bundle || \
    (echo "A2UI bundle: creating stub (non-fatal)" && \
     mkdir -p src/canvas-host/a2ui && \
     echo "/* A2UI bundle unavailable in this build */" > src/canvas-host/a2ui/a2ui.bundle.js && \
     echo "stub" > src/canvas-host/a2ui/.bundle.hash && \
     rm -rf vendor/a2ui apps/shared/OpenClawKit/Tools/CanvasA2UI)
RUN pnpm build:docker
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build
RUN pnpm qa:lab:build

# ── Stage 2: Prune dev deps ─────────────────────────────────────────────────
FROM build AS runtime-assets

RUN CI=true NPM_CONFIG_FROZEN_LOCKFILE=false pnpm prune --prod && \
    node scripts/postinstall-bundled-plugins.mjs && \
    find dist -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete

# Pre-install bundled plugin runtime deps at build time so the gateway
# starts immediately instead of running npm install on first boot.
# Uses the same path formula as bundled-runtime-deps.ts so the runtime
# scan finds them and skips the "staging bundled runtime deps" step.
RUN OPENCLAW_STATE_DIR=/app/data node scripts/prebuild-plugin-deps.mjs || \
    mkdir -p /app/data/plugin-runtime-deps

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM ${OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE} AS runtime

ARG OPENCLAW_NODE_BOOKWORM_SLIM_DIGEST
LABEL org.opencontainers.image.base.name="docker.io/library/node:24-bookworm-slim" \
  org.opencontainers.image.base.digest="${OPENCLAW_NODE_BOOKWORM_SLIM_DIGEST}" \
  org.opencontainers.image.source="https://github.com/laalemanafoods/openclaw" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="OpenClaw — La Alemana Foods"

WORKDIR /app

# Install runtime system utilities (minimal set to avoid build timeouts).
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git openssl && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN chown node:node /app

# Copy built assets from runtime-assets stage.
COPY --from=runtime-assets --chown=node:node /app/dist ./dist
COPY --from=runtime-assets --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-assets --chown=node:node /app/package.json .
COPY --from=runtime-assets --chown=node:node /app/patches ./patches
COPY --from=runtime-assets --chown=node:node /app/openclaw.mjs .
COPY --from=runtime-assets --chown=node:node /app/extensions ./extensions
COPY --from=runtime-assets --chown=node:node /app/skills ./skills
COPY --from=runtime-assets --chown=node:node /app/docs ./docs
COPY --from=runtime-assets --chown=node:node /app/qa ./qa
COPY --from=runtime-assets --chown=node:node /app/conocimiento ./conocimiento
COPY --from=runtime-assets --chown=node:node /app/config ./config
COPY --from=runtime-assets --chown=node:node /app/data/plugin-runtime-deps /app/data/plugin-runtime-deps

# Keep pnpm available in the runtime image.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN install -d -m 0755 "$COREPACK_HOME" && \
    corepack enable && \
    for attempt in 1 2 3 4 5; do \
      if corepack prepare "$(node -p "require('./package.json').packageManager")" --activate; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep $((attempt * 2)); \
    done && \
    chmod -R a+rX "$COREPACK_HOME"

# Expose the CLI binary.
RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw && \
    chmod 755 /app/openclaw.mjs

# Pre-create writable state directory owned by node user.
RUN mkdir -p /app/data/.openclaw && chown -R node:node /app/data

# Entrypoint overrides HOME before Node starts.
COPY --chown=root:root entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
# Default gateway port — Koyeb overrides via its PORT env var (mapped in entrypoint.sh).
ENV OPENCLAW_GATEWAY_PORT=18789

EXPOSE 18789

USER node

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

HEALTHCHECK --interval=3m --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.OPENCLAW_GATEWAY_PORT||18789) + '/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

RUN rm -f /app/data/openclaw.json

CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan"]
