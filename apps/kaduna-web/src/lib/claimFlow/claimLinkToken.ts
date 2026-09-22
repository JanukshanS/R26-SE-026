import type { ClaimLinkIdentity } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_INSURER_API_URL ?? "http://localhost:8080/api";

/** GET /claims/claim-links/{token} — public, no auth. The token is HS256-signed
 * with a server-only secret (backend/app/services/auth.py), so it can't be
 * decoded in the browser; this just asks the backend to do it. */
export async function resolveClaimLinkToken(token: string): Promise<ClaimLinkIdentity | null> {
  try {
    const res = await fetch(`${API_BASE}/claims/claim-links/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.nic !== "string" || typeof data.plateNumber !== "string") return null;
    return { nic: data.nic, plateNumber: data.plateNumber };
  } catch {
    return null;
  }
}
