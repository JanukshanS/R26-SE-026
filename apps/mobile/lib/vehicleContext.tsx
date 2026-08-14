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
  updateProfile: (data: { name?: string; phone?: string; location?: string }) => Promise<void>;
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
    setVehiclesLoading(true);
    setVehicleError(null);
    try {
      const list = await vehicleApi.getVehicles();
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
      setVehicleError((err as Error).message ?? "Could not load vehicles");
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  // Single source of truth: react to Supabase auth state. Fires immediately
  // with the restored session on mount (INITIAL_SESSION), then on every
  // sign-in / sign-out / token refresh. Guests simply end up with user=null.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setToken(session?.access_token ?? null);

      if (!session) {
        // Signing out is not an identity switch by itself — it's just the
        // transient gap before whoever signs in next (possibly the same
        // person) is known. Don't touch lastAuthenticatedUserId here: doing
        // so previously made every logout look like "real account → guest",
        // which wiped local claim data (photos, the "already submitted"
        // lock) even when the very same account logged back in right after.
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

      vehicleApi.getMyUser().then(setUser).catch(() => setUser(null));
      void refreshVehicles();
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

  const updateProfile = async (data: { name?: string; phone?: string; location?: string }) => {
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
    clearVehicleInsuranceCache();
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
