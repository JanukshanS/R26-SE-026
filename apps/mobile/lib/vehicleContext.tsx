import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as vehicleApi from "@lib/vehicleApi";
import * as authApi from "@lib/authApi";
import { AuthApiError, type AuthUser } from "@lib/authApi";
import { tokenStore } from "@lib/tokenStore";
import type { User, Vehicle } from "@lib/vehicleApi";

interface VehicleContextValue {
  // auth
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  authLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, phone?: string, role?: string) => Promise<User>;
  updateProfile: (data: { name?: string; phone?: string; location?: string }) => Promise<void>;
  updateMe: (data: authApi.UpdateMeInput) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  // vehicles
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  vehicleError: string | null;
  selectedVehicle: Vehicle | null;
  selectVehicle: (vehicle: Vehicle) => void;
  refreshVehicles: () => Promise<void>;
  addVehicle: (data: Partial<vehicleApi.VehicleInput>) => Promise<Vehicle>;
  editVehicle: (id: string, data: Partial<vehicleApi.VehicleInput>) => Promise<void>;
  removeVehicle: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
}

const VehicleContext = createContext<VehicleContextValue | null>(null);

/** Map the auth backend's user shape onto the mobile `User` (`id` → `_id`). */
function toMobileUser(u: AuthUser): User {
  return {
    _id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone ?? undefined,
    providerId: u.providerId ?? null,
  };
}

/**
 * Run an authenticated call, and if it fails with a 401, rotate the refresh
 * token once and retry. Any other failure (or a failed refresh) propagates.
 * A guest with no refresh token gets the original error untouched.
 */
async function withRefreshRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof AuthApiError) || err.status !== 401) throw err;
    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) throw err;
    const tokens = await authApi.refresh(refreshToken);
    await tokenStore.setTokens(tokens);
    return fn();
  }
}

export function VehicleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(tokenStore.getAccessToken());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Hydrate persisted tokens on mount, then restore the session via /me.
  // Guests (no token, or an expired/invalid one) simply end up with user=null,
  // which is a fully valid state — nothing here blocks rendering.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      await tokenStore.hydrate();
      setTokenState(tokenStore.getAccessToken());
      const access = tokenStore.getAccessToken();
      if (!access) return;
      try {
        const { user: u } = await withRefreshRetry(() =>
          authApi.me(tokenStore.getAccessToken() as string)
        );
        setUser(toMobileUser(u));
        setTokenState(tokenStore.getAccessToken());
      } catch {
        await tokenStore.clear();
        setTokenState(null);
        setUser(null);
      }
    })();
  }, []);

  const refreshVehicles = useCallback(async () => {
    if (!tokenStore.getAccessToken()) return;
    setVehiclesLoading(true);
    setVehicleError(null);
    try {
      const list = await withRefreshRetry(() => vehicleApi.getVehicles());
      setVehicles(list);
      setSelectedVehicle((prev) => {
        if (prev) {
          const updated = list.find((v) => v._id === prev._id);
          return updated ?? list.find((v) => v.isDefault) ?? list[0] ?? null;
        }
        return list.find((v) => v.isDefault) ?? list[0] ?? null;
      });
    } catch (err) {
      setVehicleError((err as Error).message ?? "Could not load vehicles");
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) refreshVehicles();
    else {
      setVehicles([]);
      setSelectedVehicle(null);
    }
  }, [token, refreshVehicles]);

  const login = async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await authApi.login(email, password);
      await tokenStore.setTokens({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      const mapped = toMobileUser(res.user);
      setUser(mapped);
      setTokenState(res.accessToken);
      return mapped;
    } catch (err) {
      setAuthError((err as Error).message ?? "Login failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const register = async (
    name: string,
    email: string,
    password: string,
    phone?: string,
    role?: string
  ) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await authApi.register({ name, email, password, phone, role });
      await tokenStore.setTokens({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      const mapped = toMobileUser(res.user);
      setUser(mapped);
      setTokenState(res.accessToken);
      return mapped;
    } catch (err) {
      setAuthError((err as Error).message ?? "Registration failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  // The auth backend exposes no profile-update endpoint, so this updates the
  // locally cached user only (keeps the profile screen functional).
  const updateProfile = async (data: { name?: string; phone?: string; location?: string }) => {
    setUser((prev) => (prev ? { ...prev, ...data } : prev));
  };

  // Persist user fields the backend DOES own (notably `providerId`, which
  // links a provider account to its dispatch record). Server-side, so the
  // link survives across devices — any device that re-runs /me sees it.
  const updateMe = async (data: authApi.UpdateMeInput) => {
    const token = tokenStore.getAccessToken();
    if (!token) throw new Error("Not authenticated");
    const { user: updated } = await withRefreshRetry(() =>
      authApi.updateMe(data, tokenStore.getAccessToken() as string)
    );
    const mapped = toMobileUser(updated);
    setUser(mapped);
    return mapped;
  };

  // Re-fetch the current user from /me and refresh the cached copy. Used to
  // pick up server-side changes (e.g. a providerId linked on another device).
  const refreshUser = async () => {
    if (!tokenStore.getAccessToken()) return;
    const { user: u } = await withRefreshRetry(() =>
      authApi.me(tokenStore.getAccessToken() as string)
    );
    setUser(toMobileUser(u));
  };

  const logout = async () => {
    const access = tokenStore.getAccessToken();
    const refreshToken = tokenStore.getRefreshToken();
    if (access && refreshToken) {
      try {
        await authApi.logout(access, refreshToken);
      } catch {
        // Revocation is best-effort; we clear local state regardless.
      }
    }
    await tokenStore.clear();
    setTokenState(null);
    setUser(null);
    setVehicles([]);
    setSelectedVehicle(null);
    setAuthError(null);
    setVehicleError(null);
  };

  const addVehicle = async (data: Partial<vehicleApi.VehicleInput>) => {
    const vehicle = await withRefreshRetry(() => vehicleApi.createVehicle(data));
    await refreshVehicles();
    return vehicle;
  };

  const editVehicle = async (id: string, data: Partial<vehicleApi.VehicleInput>) => {
    await withRefreshRetry(() => vehicleApi.updateVehicle(id, data));
    await refreshVehicles();
  };

  const removeVehicle = async (id: string) => {
    await withRefreshRetry(() => vehicleApi.deleteVehicle(id));
    await refreshVehicles();
  };

  const setDefault = async (id: string) => {
    await withRefreshRetry(() => vehicleApi.setDefaultVehicle(id));
    await refreshVehicles();
  };

  return (
    <VehicleContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        token,
        authLoading,
        authError,
        login,
        register,
        updateProfile,
        updateMe,
        refreshUser,
        logout,
        clearAuthError: () => setAuthError(null),
        vehicles,
        vehiclesLoading,
        vehicleError,
        selectedVehicle,
        selectVehicle: setSelectedVehicle,
        refreshVehicles,
        addVehicle,
        editVehicle,
        removeVehicle,
        setDefault,
      }}
    >
      {children}
    </VehicleContext.Provider>
  );
}

export function useVehicle() {
  const ctx = useContext(VehicleContext);
  if (!ctx) throw new Error("useVehicle must be used inside <VehicleProvider>");
  return ctx;
}
