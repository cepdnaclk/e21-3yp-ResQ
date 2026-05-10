// This file handles the API calls related to manikin pairing and provisioning.
// "Provisioning" means giving a new manikin its network and identity settings
// so it can join the local hub for the first time.

// This is the shape of data the backend returns when we request a pairing token.
// The backend generates a one-time token tied to this specific deviceId.
export type PairingTokenResponse = {
  deviceId: string;
  token: string;       // the one-time secret the manikin uses to prove its identity
  expiresAt: string;   // ISO date string — the token is only valid until this time
};

// Builds the URL for the pair-request endpoint.
// We use window.location.hostname so this works whether you're on localhost
// or accessing from a phone on the same LAN (e.g. 192.168.1.5).
function getPairRequestUrl(): string {
  return `http://${window.location.hostname}:18080/api/manikins/pair-request`;
}

// Asks the backend to create a pairing request for the given deviceId.
// The backend returns a one-time token that the manikin will use
// to confirm its identity during provisioning.
export async function requestManikinPairing(
  deviceId: string
): Promise<PairingTokenResponse> {
  const response = await fetch(getPairRequestUrl(), {
    method: "POST",
    credentials: "include",   // sends the login session cookie so the backend knows who you are
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deviceId }),
  });

  // If the backend returned an error (like 403 Forbidden or 400 Bad Request),
  // we throw an error with a readable message so the UI can show it to the user.
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.message ?? `Pairing request failed (${response.status})`
    );
  }

  return response.json() as Promise<PairingTokenResponse>;
}