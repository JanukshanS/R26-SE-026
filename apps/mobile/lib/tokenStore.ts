import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "kaduna.accessToken";
const REFRESH_KEY = "kaduna.refreshToken";

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _listeners: Array<(t: string | null) => void> = [];

function notify() {
  _listeners.forEach((fn) => fn(_accessToken));
}

async function persist(key: string, value: string | null) {
  try {
    if (value === null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // SecureStore is unavailable on web / when keychain access fails;
    // the in-memory cache still keeps the session alive for this run.
  }
}

export const tokenStore = {
  getAccessToken(): string | null {
    return _accessToken;
  },

  getRefreshToken(): string | null {
    return _refreshToken;
  },

  async setTokens({
    accessToken,
    refreshToken,
  }: {
    accessToken: string;
    refreshToken: string;
  }): Promise<void> {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    notify();
    await Promise.all([
      persist(ACCESS_KEY, accessToken),
      persist(REFRESH_KEY, refreshToken),
    ]);
  },

  async clear(): Promise<void> {
    _accessToken = null;
    _refreshToken = null;
    notify();
    await Promise.all([persist(ACCESS_KEY, null), persist(REFRESH_KEY, null)]);
  },

  async hydrate(): Promise<void> {
    // If tokens were already set in-memory this session (e.g. the user just
    // logged in on a previous screen), don't clobber them with a SecureStore
    // read — the cache is the source of truth once populated.
    if (_accessToken) {
      notify();
      return;
    }
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      _accessToken = access;
      _refreshToken = refresh;
      notify();
    } catch {
      // No persisted tokens (or SecureStore unavailable) — stay a guest.
    }
  },

  subscribe(fn: (t: string | null) => void): () => void {
    _listeners.push(fn);
    return () => {
      _listeners = _listeners.filter((l) => l !== fn);
    };
  },

  // Legacy single-token accessors kept for backward compatibility with any
  // caller that still reads/writes a bare access token.
  get(): string | null {
    return _accessToken;
  },

  set(token: string | null) {
    _accessToken = token;
    if (token === null) _refreshToken = null;
    notify();
    void persist(ACCESS_KEY, token);
    if (token === null) void persist(REFRESH_KEY, null);
  },
};
