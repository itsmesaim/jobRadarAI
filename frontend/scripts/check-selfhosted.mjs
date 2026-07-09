#!/usr/bin/env node
/**
 * Fails the build if production output references third-party CDNs.
 * JobRadar serves fonts + JS/CSS from its own origin for GDPR-friendly landing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;

const BLOCKED = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /cdn\.jsdelivr\.net/i,
  /unpkg\.com/i,
  /cdnjs\.cloudflare\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /connect\.facebook\.net/i,
  /hotjar\.com/i,
  /segment\.com/i,
  /bootstrapcdn\.com/i,
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(html|css|js)$/i.test(name)) files.push(path);
  }
  return files;
}

let dist;
try {
  dist = DIST;
  readdirSync(dist);
} catch {
  console.error("check-selfhosted: run `vite build` first — dist/ not found");
  process.exit(1);
}

const hits = [];
for (const file of walk(dist)) {
  const text = readFileSync(file, "utf8");
  for (const pattern of BLOCKED) {
    if (pattern.test(text)) hits.push({ file, pattern: pattern.source });
  }
}

if (hits.length) {
  console.error("check-selfhosted: third-party CDN references found in build output:\n");
  for (const { file, pattern } of hits) {
    console.error(`  ${file}\n    matched: ${pattern}`);
  }
  process.exit(1);
}

console.log("check-selfhosted: OK — no CDN references in dist/");
