export { default as db } from './client';
export * from './manikinRepository';
export * from './pairingTokenRepository';
export * from './sessionRepository';
export * from './eventRepository';
export * from './syncQueueRepository';// SQLite schema and repository helpers

export function initializeDatabase(path: string) {
  // TODO: implement migration and connection logic
  console.log(`Initializing SQLite database at ${path}`);
}
