import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@lib/supabase";
import * as authApi from "@lib/authApi";
import * as vehicleApi from "@lib/vehicleApi";
import type { User, Vehicle } from "@lib/vehicleApi";
import { clearAllClaimData } from "@lib/clear-claim-data";
import {
  loadLastAuthenticatedUserId,
  saveLastAuthenticatedUserId,
} from "@lib/last-authenticated-user-store";
import { saveSelectedVehicleId } from "@lib/selected-vehicle-store";
import { clearVehicleInsuranceCache } from "@lib/vehicleInsuranceApi";
import { clearCachedClaims, listMyClaims } from "@lib/claims-api";
import { setActiveSessionId, getActiveSessionId } from "@lib/session-guard";

interface ProfilePatch {
  name?: string;
  phone?: string;
  location?: string;
  providerId?: string | null;
  licenceNumber?: string;
  nicNumber?: string;
}

interface VehicleContextValue {
  // auth
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  authLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, phone?: string, role?: string) => Promise<User>;
  loginWithGoogle: () => Promise<void>;
  updateProfile: (data: {
    name?: string; phone?: string; location?: string;
    licenceNumber?: string; nicNumber?: string;
  }) => Promise<void>;
  updateMe: (data: ProfilePatch) => Promise<User>;
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

export function VehicleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  const refreshVehicles = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setVehicles([]);
      setSelectedVehicle(null);
      return;
    }
    // Captured before the fetch: if a slower call from an account that has since
    // logged out resolves after a different account has signed in, its result must
    // not land as that new account's vehicle list — see session-guard.ts.
    const requestedFor = getActiveSessionId();
    setVehiclesLoading(true);
    setVehicleError(null);
    try {
      const list = await vehicleApi.getVehicles();
      if (getActiveSessionId() !== requestedFor) return;
      setVehicles(list);
      setSelectedVehicle((prev) => {
        const next = prev
          ? list.find((v) => v._id === prev._id) ?? list.find((v) => v.isDefault) ?? list[0] ?? null
          : list.find((v) => v.isDefault) ?? list[0] ?? null;
        // Keep the persisted selection in sync even when it's resolved automatically
        // (not via an explicit selectVehicle() tap) — otherwise a stale id from an
        // earlier session/vehicle lingers forever, since only selectVehicle() used to
        // write it. (insurance) screens read this file directly, so a stale value
        // there shows the wrong vehicle's insurer until the user happens to re-select.
        if (next) {
          void saveSelectedVehicleId(next._id);
        }
        return next;
      });
    } catch (err) {
      if (getActiveSessionId() === requestedFor) {
        setVehicleError((err as Error).message ?? "Could not load vehicles");
      }
    } finally {
      if (getActiveSessionId() === requestedFor) {
        setVehiclesLoading(false);
      }
    }
  }, []);

  // Single source of truth: react to Supabase auth state. Fires immediately
  // with the restored session on mount (INITIAL_SESSION), then on every
  // sign-in / sign-out / token refresh. Guests simply end up with user=null.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setToken(session?.access_token ?? null);
      // Stamped synchronously, before any of the async fetches below fire — the
      // single source of truth every cache-writing fetch checks itself against so a
      // straggling response from a since-logged-out account can't land as this (or a
      // later) account's data. See session-guard.ts.
      setActiveSessionId(session?.user.id ?? null);

      if (!session) {
        // Signing out is not an identity switch by itself — it's just the
        // transient gap before whoever signs in next (possibly the same
        // person) is known. Don't touch lastAuthenticatedUserId here: doing
        // so previously made every logout look like "real account → guest",
        // which wiped local claim data (photos, the "already submitted"
        // lock) even when the very same account logged back in right after.
        // Local development escape hatch: stand in a synthetic signed-in user
        // so the flows can be exercised without a real sign-in. Requires
        // EXPO_PUBLIC_DEV_AUTH_BYPASS=1 and a debug build (__DEV__ is
        // compile-time false in release, so this is stripped from a production
        // bundle). Set EXPO_PUBLIC_DEV_PROVIDER_ID to land on the provider side.
        if (__DEV__ && process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS === "1") {
          setUser({
            _id: "dev-local-user",
            email: "dev@localhost",
            name: "Dev Local",
            role: process.env.EXPO_PUBLIC_DEV_PROVIDER_ID ? "provider" : "driver",
            providerId: process.env.EXPO_PUBLIC_DEV_PROVIDER_ID ?? null,
          });
          return;
        }
        setUser(null);
        setVehicles([]);
        setSelectedVehicle(null);
        return;
      }

      // Report Accident's in-progress state (guided capture photos, the
      // "already submitted" lock, etc.) lives in local on-device storage,
      // not scoped to any user id — so it silently carries over to whoever
      // uses the app next. Detect a genuine identity switch — a DIFFERENT
      // account signing in, compared against the last real account that
      // used this device — and wipe it then, the same reset "Start New
      // Claim" already does. Signing out and back into the SAME account
      // must NOT trigger this.
      const currentId = session.user.id;
      void loadLastAuthenticatedUserId().then(async (lastId) => {
        const shouldClear = lastId !== null && lastId !== currentId;
        if (__DEV__) {
          console.log("[auth identity check]", { event, lastId, currentId, shouldClear });
        }
        if (shouldClear) {
          await clearAllClaimData().catch((err) => {
            if (__DEV__) console.log("[auth identity check] clearAllClaimData failed", err);
          });
        }
        await saveLastAuthenticatedUserId(currentId);
      });

      // A live session whose profile row fails to load is still a signed-in
      // user: retry once, then fall back to the identity the session already
      // carries — including the signup role, so a provider is not silently
      // treated as a driver — rather than downgrading them to a guest until
      // the app is restarted. Every write is still guarded against a straggling
      // response from a since-switched account.
      vehicleApi
        .getMyUser()
        .catch(() => vehicleApi.getMyUser())
        .then((u) => {
          if (getActiveSessionId() === currentId) setUser(u);
        })
        .catch(() => {
          if (getActiveSessionId() !== currentId) return;
          setUser({
            _id: session.user.id,
            email: session.user.email ?? "",
            name: (session.user.user_metadata?.name as string) || "",
            role: (session.user.user_metadata?.role as string) || "driver",
          });
        });
      void refreshVehicles();
      // Warms claims-api's cache so Home's Insurance button can read it instantly
      // instead of paying a network round trip on every tap — see claims-api.ts.
      // (listMyClaims() itself checks session-guard before writing its cache, so no
      // extra guard is needed here.)
      void listMyClaims().catch(() => {});
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshVehicles]);

  const login = async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authApi.signInEmail(email.trim(), password);
      const u = await vehicleApi.getMyUser();
      if (u) setUser(u);
      return u as User;
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
      const { needsConfirmation } = await authApi.signUpEmail({
        name,
        email: email.trim(),
        password,
        phone,
        role,
      });
      if (needsConfirmation) {
        throw new Error("Check your email to confirm your account, then sign in.");
      }
      const u = await vehicleApi.getMyUser();
      if (u) setUser(u);
      return u as User;
    } catch (err) {
      setAuthError((err as Error).message ?? "Registration failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authApi.signInWithGoogle();
      // onAuthStateChange loads user + vehicles once the session lands.
    } catch (err) {
      setAuthError((err as Error).message ?? "Google sign-in failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const updateProfile = async (data: {
    name?: string; phone?: string; location?: string;
    licenceNumber?: string; nicNumber?: string;
  }) => {
    const u = await vehicleApi.updateMyProfile(data);
    setUser(u);
  };

  // Persist profile fields the app owns (notably providerId, which links a
  // provider account to its dispatch record).
  const updateMe = async (data: ProfilePatch) => {
    const u = await vehicleApi.updateMyProfile(data);
    setUser(u);
    return u;
  };

  const refreshUser = async () => {
    const u = await vehicleApi.getMyUser();
    setUser(u);
  };

  const logout = async () => {
    await authApi.signOut();
    setUser(null);
    setToken(null);
    setVehicles([]);
    setSelectedVehicle(null);
    setAuthError(null);
    setVehicleError(null);
    // getMyUser() is intentionally not called during sign-out (see the auth-state
    // listener above), so its in-memory cache wouldn't otherwise clear itself —
    // must not let it survive into a different account signing in on this device.
    vehicleApi.clearCachedMyUser();
    vehicleApi.clearCachedVehicles();
    clearVehicleInsuranceCache();
    clearCachedClaims();
  };

  const addVehicle = async (data: Partial<vehicleApi.VehicleInput>) => {
    const vehicle = await vehicleApi.createVehicle(data);
    await refreshVehicles();
    return vehicle;
  };

  const editVehicle = async (id: string, data: Partial<vehicleApi.VehicleInput>) => {
    await vehicleApi.updateVehicle(id, data);
    await refreshVehicles();
  };

  const removeVehicle = async (id: string) => {
    await vehicleApi.deleteVehicle(id);
    await refreshVehicles();
  };

  const setDefault = async (id: string) => {
    await vehicleApi.setDefaultVehicle(id);
    await refreshVehicles();
  };

  // Persisted (not just in-memory) so screens outside VehicleProvider — the
  // (insurance) route group — can read the CURRENT selection instead of a
  // route param snapshot that goes stale once the driver starts a second
  // claim without navigating back through Home.
  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    void saveSelectedVehicleId(vehicle._id);
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
        loginWithGoogle,
        updateProfile,
        updateMe,
        refreshUser,
        logout,
        clearAuthError: () => setAuthError(null),
        vehicles,
        vehiclesLoading,
        vehicleError,
        selectedVehicle,
        selectVehicle,
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

/** Same context, without the throw — for shared components (like
 * BottomNavBar) that render inside route groups both with and without
 * VehicleProvider and only need to degrade gracefully outside it. */
export function useVehicleOptional() {
  return useContext(VehicleContext);
}
