const TOKEN_STORAGE_KEY = "resq.auth.token";

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token === null) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export default {
  get: getStoredToken,
  set: setStoredToken,
};
