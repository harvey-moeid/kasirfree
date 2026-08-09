#!/usr/bin/env node
// tests/e2e/run.mjs — Jalankan semua file tes e2e di folder ini satu-satu.
// (Terpisah dari node:test karena tiap file mengelola server+browser
// sendiri dan exit code sendiri — lebih simpel daripada dipaksa masuk ke
// harness node:test.)
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = import.meta.dirname;
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = false;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  try {
    execFileSync('node', [path.join(dir, f)], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
