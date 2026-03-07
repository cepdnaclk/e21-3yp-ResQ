import db from './client';
// TODO: Add queries for pairing token management
export class PairingTokenRepository {
  // Example: create token
  create(token: any) {
    // INSERT INTO pairing_tokens ...
  }
  // Example: get token
  get(token: string) {
    // SELECT * FROM pairing_tokens WHERE token = ?
  }
  // Example: delete token
  delete(token: string) {
    // DELETE FROM pairing_tokens WHERE token = ?
  }
}