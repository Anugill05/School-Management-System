import { loadConfig } from '../app.js';
import { migrate, openDb } from '../lib/db.js';

const db = openDb(loadConfig().dbPath);
const ran = migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
db.close();
