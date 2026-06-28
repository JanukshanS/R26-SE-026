import { Platform } from "react-native";

const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:3002" : "http://localhost:3002");

export const AUTH_BASE_URL = DEFAULT_BASE_URL;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  providerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: AuthUser;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string | null;
  details?: unknown;
  timestamp: string;
}

export class AuthApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Hermes (RN's default JS engine on Android) doesn't ship `AbortSignal.timeout`,
 * so we polyfill via AbortController + setTimeout — same pattern as dispatchApi.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const url = `${AUTH_BASE_URL}${path}`;
  const { signal, cancel } = timeoutSignal(10_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal });
  } finally {
    cancel();
  }

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // non-JSON response
  }

  if (!res.ok || !body?.success) {
    throw new AuthApiError(
      res.status,
      body?.error ?? `HTTP ${res.status}`,
      body?.details
    );
  }

  return body.data as T;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role?: string;
}

export function register(input: RegisterInput): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(email: string, password: string): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>("/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function me(accessToken: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("/api/auth/me", {}, accessToken);
}

export interface UpdateMeInput {
  providerId?: string | null;
  name?: string;
  phone?: string;
}

export function updateMe(
  input: UpdateMeInput,
  accessToken: string
): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>(
    "/api/auth/me",
    { method: "PATCH", body: JSON.stringify(input) },
    accessToken
  );
}

export function logout(accessToken: string, refreshToken: string): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>(
    "/api/auth/logout",
    { method: "POST", body: JSON.stringify({ refreshToken }) },
    accessToken
  );
}
