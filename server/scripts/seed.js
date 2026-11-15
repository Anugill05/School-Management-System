import { loadConfig } from '../app.js';
import { migrate, openDb } from '../lib/db.js';
import { seed, DEMO_PASSWORD } from '../seed.js';

const db = openDb(loadConfig().dbPath);
migrate(db);
if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) {
  console.log('Database already has data. Use "npm run db:reset" to wipe and reseed.');
} else {
  const s = seed(db);
  console.log(`Seeded ${s.students} students, ${s.teachers} teachers, ${s.guardians} guardians (synthetic data).`);
  console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
  console.log('Accounts: admin@school.test | teacher1@school.test | guardian1@school.test');
}
db.close();
