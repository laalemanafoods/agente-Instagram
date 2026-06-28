#!/usr/bin/env node
// Pre-installs bundled plugin runtime dependencies into the same external
// install root that the gateway resolves at runtime when OPENCLAW_STATE_DIR
// is set to /app/data.  Running this during the Docker build eliminates the
// "staging bundled runtime deps" npm install that happens on first boot and
// makes the gateway ready in ~2 s instead of ~60 s.
//
// The install root path mirrors the formula in bundled-runtime-deps.ts:
//   <stateDir>/plugin-runtime-deps/openclaw-<version>-<sha256(packageRoot)[0..11]>
//
// This script is intentionally non-fatal: any failure is logged as a warning
// and the process exits 0 so the Docker build is never broken by this step.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");

function sanitize(v) {
  return (v || "unknown").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function readVersion() {
  const raw = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  return sanitize(typeof raw.version === "string" ? raw.version.trim() : "");
}

function computeInstallRoot(stateDir) {
  const version = readVersion();
  const hash = createHash("sha256").update(PACKAGE_ROOT).digest("hex").slice(0, 12);
  return path.join(stateDir, "plugin-runtime-deps", `openclaw-${version}-${hash}`);
}

function collectMissingSpecs(installRoot) {
  const extDir = path.join(PACKAGE_ROOT, "dist", "extensions");
  if (!existsSync(extDir)) return [];

  const seen = new Set();
  const specs = [];

  for (const entry of readdirSync(extDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(extDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    for (const [name, version] of Object.entries(deps)) {
      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sentinel = path.join(installRoot, "node_modules", name, "package.json");
      if (!existsSync(sentinel)) specs.push(key);
    }
  }

  return specs;
}

try {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(PACKAGE_ROOT, "data");
  const installRoot = computeInstallRoot(stateDir);

  console.log(`[prebuild-plugin-deps] install root: ${installRoot}`);
  mkdirSync(installRoot, { recursive: true });

  const specs = collectMissingSpecs(installRoot);
  if (specs.length === 0) {
    console.log("[prebuild-plugin-deps] all plugin deps already present — nothing to install");
    process.exit(0);
  }

  console.log(`[prebuild-plugin-deps] pre-installing ${specs.length} dep(s): ${specs.join(", ")}`);
  try {
    execSync(`npm install --ignore-scripts ${specs.join(" ")}`, {
      cwd: installRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        npm_config_package_lock: "false",
        npm_config_save: "false",
        npm_config_legacy_peer_deps: "true",
      },
    });
    console.log("[prebuild-plugin-deps] done");
  } catch (installErr) {
    console.warn(
      `[prebuild-plugin-deps] npm install failed (non-fatal, gateway will install at first boot): ${installErr.message ?? installErr}`,
    );
  }
} catch (err) {
  console.warn(
    `[prebuild-plugin-deps] unexpected error (non-fatal): ${err.message ?? err}`,
  );
}
