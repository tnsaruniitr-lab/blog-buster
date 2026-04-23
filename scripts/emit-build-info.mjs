#!/usr/bin/env node
// Emits dist/build-info.json with { version, gitSha, builtAt }.
// Run as part of `npm run build` — captures the exact commit the dist was
// compiled from so consumers can diagnose "did this result come from build X?"
// after the fact.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

function git(cmd) {
  try {
    return execSync(`git -C "${repoRoot}" ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const gitSha = git("rev-parse HEAD") ?? "unknown";
const gitShaShort = git("rev-parse --short HEAD") ?? "unknown";
const gitBranch = git("rev-parse --abbrev-ref HEAD") ?? "unknown";
const gitDirty = git("status --porcelain")?.length ? true : false;

const buildInfo = {
  version: pkg.version,
  gitSha,
  gitShaShort,
  gitBranch,
  gitDirty,
  builtAt: new Date().toISOString(),
  nodeVersion: process.version,
};

const distDir = join(repoRoot, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "build-info.json"), JSON.stringify(buildInfo, null, 2), "utf-8");

console.log(
  `[emit-build-info] ${pkg.name}@${pkg.version} sha=${gitShaShort}${gitDirty ? " (dirty)" : ""} built=${buildInfo.builtAt}`,
);
