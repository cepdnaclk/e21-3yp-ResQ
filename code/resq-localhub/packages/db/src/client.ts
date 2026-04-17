import Database from "better-sqlite3";

export type SqliteDb = Database.Database;

export const db: SqliteDb = new Database("./data/resq.db");

export default db;