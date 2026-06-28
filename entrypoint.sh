#!/bin/sh
# PaaS platforms (Railway, Koyeb) may inject HOME=/data (read-only).
# Override to /app/data which is writable and owned by node.
export HOME=/app/data
export OPENCLAW_HOME=/app/data
export OPENCLAW_STATE_DIR=/app/data

# Map Koyeb/Railway PORT env var to OpenClaw's gateway port setting.
# PORT always wins — the Dockerfile sets OPENCLAW_GATEWAY_PORT=18789 as a
# build-time default, so the old [ -z ] guard would never fire on Koyeb.
if [ -n "$PORT" ]; then
  export OPENCLAW_GATEWAY_PORT="$PORT"
fi

# Ensure writable directories exist.
mkdir -p /app/data/agents/main/agent 2>/dev/null || true

# Always write the default openclaw.json so model/provider config stays current.
if [ -f /app/config/openclaw.default.json ]; then
  cp /app/config/openclaw.default.json /app/data/openclaw.json
fi

# Remove any stale auth config before writing the current one.
rm -f /app/data/agents/main/agent/auth-profiles.json 2>/dev/null || true

# Write auth-profiles.json for the main agent using the OPENAI_API_KEY env var.
# Runs every start so the key stays in sync with the Koyeb Variable.
if [ -n "$OPENAI_API_KEY" ]; then
  cat > /app/data/agents/main/agent/auth-profiles.json << AUTHEOF
{
  "version": 1,
  "profiles": {
    "openai-1": {
      "type": "api_key",
      "provider": "openai",
      "key": "$OPENAI_API_KEY"
    }
  }
}
AUTHEOF
fi

exec "$@"
