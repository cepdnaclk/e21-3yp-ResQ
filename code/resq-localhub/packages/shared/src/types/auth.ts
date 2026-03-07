export interface LocalAuthRequest {
  traineeId: string;
  pin: string;
}
export interface LocalAuthResponse {
  authenticated: boolean;
  traineeId?: string;
}// authentication-related types (user, token)
// TODO: define credentials and roles
