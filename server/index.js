import { createApp, loadConfig } from './app.js';
import { migrate, openDb } from './lib/db.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const ran = migrate(db);
if (ran.length) console.log(`[db] applied migrations: ${ran.join(', ')}`);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  console.log('[db] empty database - run "npm run seed" to load synthetic demo data');
}

const app = createApp({ db, config });
const server = app.listen(config.port, () => console.log(`[server] http://localhost:${config.port}  (docs: /api/docs)`));

const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
