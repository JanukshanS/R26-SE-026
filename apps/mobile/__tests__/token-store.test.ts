import { tokenStore } from "@lib/tokenStore";

// In-memory mock of SecureStore so the async persistence has somewhere to go
// without touching a real keychain (unavailable under jest).
jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

describe("tokenStore cache", () => {
  afterEach(async () => {
    await tokenStore.clear();
  });

  it("set → synchronous get → clear", async () => {
    expect(tokenStore.getAccessToken()).toBeNull();
    expect(tokenStore.getRefreshToken()).toBeNull();

    await tokenStore.setTokens({ accessToken: "acc-1", refreshToken: "ref-1" });

    // Reads are synchronous and come straight from the in-memory cache.
    expect(tokenStore.getAccessToken()).toBe("acc-1");
    expect(tokenStore.getRefreshToken()).toBe("ref-1");

    await tokenStore.clear();

    expect(tokenStore.getAccessToken()).toBeNull();
    expect(tokenStore.getRefreshToken()).toBeNull();
  });

  it("hydrate restores tokens from secure storage into the cache", async () => {
    await tokenStore.setTokens({ accessToken: "acc-2", refreshToken: "ref-2" });
    // Simulate a fresh app launch: cache empty, values still in SecureStore.
    await tokenStore.clear();
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync("kaduna.accessToken", "acc-2");
    await SecureStore.setItemAsync("kaduna.refreshToken", "ref-2");

    await tokenStore.hydrate();

    expect(tokenStore.getAccessToken()).toBe("acc-2");
    expect(tokenStore.getRefreshToken()).toBe("ref-2");
  });
});
