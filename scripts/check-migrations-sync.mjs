// ==========================================================
// check-migrations-sync.mjs — Guard CI: pastikan migrations/ (referensi
// `wrangler d1 execute` versi cloud lama) dan public/migrations/ (yang
// BENERAN dipakai runtime oleh local-db.js lewat fetch) tidak pernah
// saling drift lagi.
//
// Kenapa ada: pernah kejadian betulan — migration 0013 diedit cuma di
// migrations/, public/migrations/ ketinggalan, baru ketahuan lewat sweep
// manual (lihat proses.md). Script ini bikin kejadian itu gagal di CI
// alih-alih ketahuan manual di kemudian hari.
// ==========================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR_A = 'migrations';
const DIR_B = 'public/migrations';

function listSqlFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

const filesA = listSqlFiles(DIR_A);
const filesB = listSqlFiles(DIR_B);

let hasError = false;

const onlyInA = filesA.filter((f) => !filesB.includes(f));
const onlyInB = filesB.filter((f) => !filesA.includes(f));

if (onlyInA.length > 0) {
  hasError = true;
  console.error(`❌ File ada di ${DIR_A}/ tapi TIDAK ada di ${DIR_B}/: ${onlyInA.join(', ')}`);
}
if (onlyInB.length > 0) {
  hasError = true;
  console.error(`❌ File ada di ${DIR_B}/ tapi TIDAK ada di ${DIR_A}/: ${onlyInB.join(', ')}`);
}

for (const file of filesA.filter((f) => filesB.includes(f))) {
  const contentA = readFileSync(join(DIR_A, file), 'utf8');
  const contentB = readFileSync(join(DIR_B, file), 'utf8');
  if (contentA !== contentB) {
    hasError = true;
    console.error(`❌ Isi berbeda antara ${DIR_A}/${file} dan ${DIR_B}/${file} — samakan keduanya (public/migrations/ adalah yang dipakai runtime).`);
  }
}

if (hasError) {
  console.error('\nmigrations/ dan public/migrations/ harus identik. Lihat pesan di atas.');
  process.exit(1);
}

console.log(`✅ ${filesA.length} file migration identik antara ${DIR_A}/ dan ${DIR_B}/.`);
