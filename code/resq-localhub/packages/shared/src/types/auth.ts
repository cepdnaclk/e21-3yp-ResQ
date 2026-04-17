export interface LocalAuthRequest {
  jwt: string;
}

export interface LocalAuthResponse {
  hubSessionToken: string;
  expiresAt: number;
  traineeId: string;
}