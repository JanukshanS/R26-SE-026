import { getInsurerToken } from "./token";

export const API_BASE =
  process.env.NEXT_PUBLIC_INSURER_API_URL ?? "http://localhost:8080/api";

export function authHeaders(): Record<string, string> {
  const token = getInsurerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function insurerFetch(path: string, init?: RequestInit): Promise<Response> {
  const hdrs = authHeaders();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...hdrs,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}
