import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildInfo } from "./types.js";

// The build-info.json file is emitted by scripts/emit-build-info.mjs during
// `npm run build`. When running from source via tsx (dev mode), the file may
// not exist; we fall back to a best-effort record so callers never see
// `undefined` fields.
function loadBuildInfo(): BuildInfo {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "build-info.json"), // compiled dist
    join(here, "..", "dist", "build-info.json"), // src tree during dev
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<BuildInfo>;
        return {
          version: raw.version ?? "0.0.0",
          gitSha: raw.gitSha ?? "unknown",
          gitShaShort: raw.gitShaShort ?? "unknown",
          gitBranch: raw.gitBranch ?? "unknown",
          gitDirty: raw.gitDirty ?? false,
          builtAt: raw.builtAt ?? new Date(0).toISOString(),
          nodeVersion: raw.nodeVersion ?? process.version,
        };
      } catch {
        // fall through to dev-mode fallback
      }
    }
  }
  // Dev fallback — reading package.json for a version string.
  try {
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return {
      version: pkg.version ?? "0.0.0-dev",
      gitSha: "dev",
      gitShaShort: "dev",
      gitBranch: "dev",
      gitDirty: true,
      builtAt: "unknown",
      nodeVersion: process.version,
    };
  } catch {
    return {
      version: "0.0.0-dev",
      gitSha: "dev",
      gitShaShort: "dev",
      gitBranch: "dev",
      gitDirty: true,
      builtAt: "unknown",
      nodeVersion: process.version,
    };
  }
}

export const BUILD_INFO: BuildInfo = loadBuildInfo();
export const VERSION: string = BUILD_INFO.version;

export function assertVersion(expected: string): void {
  if (BUILD_INFO.version !== expected) {
    throw new Error(
      `blog-buster version mismatch: expected ${expected}, loaded ${BUILD_INFO.version} (sha=${BUILD_INFO.gitShaShort}, built=${BUILD_INFO.builtAt}). ` +
        `Run: (cd ../blog-buster && git pull && npm run build)`,
    );
  }
}

export function assertAtLeast(minimum: string): void {
  const toInts = (v: string): number[] =>
    v.replace(/[^0-9.]/g, "").split(".").map((n) => parseInt(n, 10) || 0);
  const have = toInts(BUILD_INFO.version);
  const need = toInts(minimum);
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const h = have[i] ?? 0;
    const n = need[i] ?? 0;
    if (h > n) return;
    if (h < n) {
      throw new Error(
        `blog-buster version too old: need >= ${minimum}, loaded ${BUILD_INFO.version} (sha=${BUILD_INFO.gitShaShort}). ` +
          `Run: (cd ../blog-buster && git pull && npm run build)`,
      );
    }
  }
}

export function buildInfoBanner(): string {
  const dirty = BUILD_INFO.gitDirty ? " (dirty)" : "";
  return `blog-buster ${BUILD_INFO.version} sha=${BUILD_INFO.gitShaShort}${dirty} built=${BUILD_INFO.builtAt}`;
}
