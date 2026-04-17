export interface PairingToken {
  token: string;
  mac: string;
  issuedAt: number;
  expiresAt: number;
  usedAt?: number;
  hubId?: string;
}