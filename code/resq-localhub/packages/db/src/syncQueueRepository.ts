import db from './client';
// TODO: Add queries for sync queue management
export class SyncQueueRepository {
  // Example: add to queue
  add(item: any) {
    // INSERT INTO sync_queue ...
  }
  // Example: get all queued items
  getAll() {
    // SELECT * FROM sync_queue
  }
  // Example: remove from queue
  remove(id: number) {
    // DELETE FROM sync_queue WHERE id = ?
  }
}