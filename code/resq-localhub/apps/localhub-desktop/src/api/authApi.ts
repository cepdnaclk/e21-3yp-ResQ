/**
 * authApi.ts — V2 auth API.
 * Re-exports from existing lib/authApi.ts to avoid duplication,
 * plus adds thin wrappers using the V2 client style.
 */

// Re-export the fully working implementations from the existing api layer.
// These are already correct and tested.
export {
  fetchAuthBootstrap,
  fetchAuthStatus,
  login,
  logout,
  fetchCurrentUser,
  fetchUsers,
  createUser,
  disableUser,
  enableUser,
  setupFirstAdmin,
  createFirstAdmin,
} from "../lib/authApi";

export type { AuthErrorResponse } from "../lib/authApi";
