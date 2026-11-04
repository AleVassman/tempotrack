#!/usr/bin/env node
/**
 * Post-build fix for the Next.js static export.
 *
 * `next build` writes route prefetch payloads as nested files, e.g.
 *   out/timesheets/__next.timesheets/__PAGE__.txt
 * but the client router requests the flattened name:
 *   /timesheets/__next.timesheets.__PAGE__.txt
 * On a static host that request 404s and client-side navigation falls back to
 * full page loads. This script writes a flattened copy next to each nested file.
 */
import { readdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const outDir = join(process.cwd(), "out");
if (!existsSync(outDir)) {
  console.error("out/ not found: run `next build` first.");
  process.exit(1);
}

let copied = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("__next.")) flatten(dir, full);
      else walk(full);
    }
  }
}

// Copy every file under `nestedRoot` (a "__next.<segment>" folder) to
// `<parent>/__next.<segment>.<sub>.<path>.txt` in the parent folder.
function flatten(parent, nestedRoot) {
  const stack = [nestedRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { stack.push(full); continue; }
      const flatName = relative(parent, full).split(sep).join(".");
      const target = join(parent, flatName);
      if (!existsSync(target)) { copyFileSync(full, target); copied++; }
    }
  }
}

walk(outDir);
console.log(`fix-static-export: wrote ${copied} flattened prefetch file(s).`);
