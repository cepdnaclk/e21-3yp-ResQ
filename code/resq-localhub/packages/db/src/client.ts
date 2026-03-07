import Database from 'better-sqlite3';

const db = new Database('./data/resq.db');

export default db;