import fs from 'node:fs';
import { loadConfig } from '../app.js';
import { migrate, openDb } from '../lib/db.js';
import { seed, DEMO_PASSWORD } from '../seed.js';

const { dbPath, production } = loadConfig();
if (production && process.argv[2] !== '--yes') {
  console.error('Refusing to wipe a production database without --yes');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
const db = openDb(dbPath);
migrate(db);
const s = seed(db);
console.log(`Reset complete: ${s.students} students, ${s.teachers} teachers, ${s.guardians} guardians. Demo password: ${DEMO_PASSWORD}`);
db.close();
