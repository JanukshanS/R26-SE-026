import type { Claim } from "./types";
import { insurerFetch } from "./api";

export async function fetchClaims(): Promise<Claim[]> {
  const res = await insurerFetch("/claims");
  if (!res.ok) throw new Error(`Failed to load claims: ${res.status}`);
  return res.json() as Promise<Claim[]>;
}
