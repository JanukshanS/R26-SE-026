import { insurerFetch } from "./api";

export type ClaimLinkResult = {
  token: string;
  url: string;
  expiresInHours: number;
};

/** POST /claims/claim-links — mints a stateless, no-app-required link for a
 * claimant to report an accident from a plain mobile browser. See
 * backend/app/api/routes/claims.py::create_claim_link. */
export async function createClaimLink(params: {
  nic: string;
  plateNumber: string;
  phone?: string;
}): Promise<ClaimLinkResult> {
  const res = await insurerFetch("/claims/claim-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nic: params.nic,
      plate_number: params.plateNumber,
      phone: params.phone || undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to generate claim link (${res.status})`);
  }
  return res.json();
}
