import db from './client';
// TODO: Add queries for event management
export class EventRepository {
  // Example: add event
  add(event: any) {
    // INSERT INTO events ...
  }
  // Example: get events for session
  getBySession(sessionId: string) {
    // SELECT * FROM events WHERE session_id = ?
  }
}