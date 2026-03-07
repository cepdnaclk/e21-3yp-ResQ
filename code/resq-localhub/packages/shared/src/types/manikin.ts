export interface Manikin {
  id: string;
  mac: string;
  name: string;
  paired: boolean;
  lastSeen?: Date;
}// definitions for manikin entities
// TODO: add properties such as id, model, status
