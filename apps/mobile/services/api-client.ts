import Constants from "expo-constants";

const API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(opts: { code: string; status: number; message: string; details?: unknown }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  authToken?: string;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, authToken } = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": uuid(),
    ...headers,
  };
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;

  try {
    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let payload: unknown = undefined;
      try {
        payload = await res.json();
      } catch {
        payload = await res.text();
      }
      const errorBody =
        typeof payload === "object" && payload !== null && "error" in payload
          ? (payload as { error?: { code?: string; message?: string; details?: unknown } }).error
          : undefined;
      throw new ApiError({
        code: errorBody?.code ?? `HTTP_${res.status}`,
        status: res.status,
        message: errorBody?.message ?? res.statusText,
        details: errorBody?.details ?? payload,
      });
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new ApiError({
        code: "TIMEOUT",
        status: 0,
        message: `Request to ${url} timed out after ${timeoutMs}ms`,
      });
    }
    throw new ApiError({
      code: "NETWORK_ERROR",
      status: 0,
      message: (err as Error).message ?? "Network error",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
