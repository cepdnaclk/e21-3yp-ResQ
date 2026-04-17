export type ManikinState =
  | "UNPAIRED"
  | "PENDING"
  | "PAIRED_OFFLINE"
  | "PAIRED_ONLINE";

export interface Manikin {
  mac: string;
  label?: string;
  fw?: string;
  ip?: string;
  rssi?: number;
  battery?: number;
  firstSeen?: number;
  lastSeen?: number;
  pairedBy?: string;
  state: ManikinState;
}