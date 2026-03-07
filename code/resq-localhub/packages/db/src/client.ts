import Database from 'better-sqlite3';
// TODO: Make DB path configurable
const db = new Database('./data/resq.db');
export default db;// SQLite client setup and connection helper
// TODO: export database instance
