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

export type VehicleSearchResult = {
  plateNumber: string;
  vehicleModel: string | null;
  nic: string | null;
  phone: string | null;
};

/** GET /claims/vehicle-search?q=... — typeahead used by the Generate Link
 * form's Vehicle Reg No field. Looks up vehicles across all drivers (an
 * insurer session has none of its own), so selecting a result can auto-fill
 * NIC + phone. See backend/app/api/routes/claims.py::search_vehicles. */
export async function searchVehicles(query: string): Promise<VehicleSearchResult[]> {
  const res = await insurerFetch(`/claims/vehicle-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const rows: { plate_number: string; vehicle_model: string | null; nic: string | null; phone: string | null }[] =
    await res.json();
  return rows.map((r) => ({
    plateNumber: r.plate_number,
    vehicleModel: r.vehicle_model,
    nic: r.nic,
    phone: r.phone,
  }));
}
