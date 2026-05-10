import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "@lib/vehicleApi";
import { tokenStore } from "@lib/tokenStore";
import type { User, Vehicle } from "@lib/vehicleApi";

interface VehicleContextValue {
  // auth
  user: User | null;
  token: string | null;
  authLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  updateProfile: (data: { name?: string; phone?: string; location?: string }) => Promise<void>;
  logout: () => void;
  clearAuthError: () => void;
  // vehicles
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  vehicleError: string | null;
  selectedVehicle: Vehicle | null;
  selectVehicle: (vehicle: Vehicle) => void;
  refreshVehicles: () => Promise<void>;
  addVehicle: (data: Partial<api.VehicleInput>) => Promise<Vehicle>;
  editVehicle: (id: string, data: Partial<api.VehicleInput>) => Promise<void>;
  removeVehicle: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
}

const VehicleContext = createContext<VehicleContextValue | null>(null);

export function VehicleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(tokenStore.get());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // keep tokenStore in sync whenever token state changes
  const setToken = useCallback((t: string | null) => {
    tokenStore.set(t);
    setTokenState(t);
  }, []);

  // restore token & user on mount if tokenStore already has one
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const stored = tokenStore.get();
    if (stored) {
      setTokenState(stored);
      api.getMe(stored)
        .then(setUser)
        .catch(() => tokenStore.set(null)); // token expired
    }
  }, []);

  const refreshVehicles = useCallback(async () => {
    const t = tokenStore.get();
    if (!t) return;
    setVehiclesLoading(true);
    setVehicleError(null);
    try {
      const list = await api.getVehicles(t);
      setVehicles(list);
      setSelectedVehicle((prev) => {
        if (prev) {
          const updated = list.find((v) => v._id === prev._id);
          return updated ?? list.find((v) => v.isDefault) ?? list[0] ?? null;
        }
        return list.find((v) => v.isDefault) ?? list[0] ?? null;
      });
    } catch (err: any) {
      setVehicleError(err.message ?? "Could not load vehicles");
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
      const res = await api.login(email, password);
      setToken(res.token);
      setUser(res.user);
    } catch (err: any) {
      setAuthError(err.message ?? "Login failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const register = async (name: string, email: string, password: string, phone?: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await api.register(name, email, password, phone);
      setToken(res.token);
      setUser(res.user);
    } catch (err: any) {
      setAuthError(err.message ?? "Registration failed");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const updateProfile = async (data: { name?: string; phone?: string; location?: string }) => {
    const t = tokenStore.get();
    if (!t) throw new Error("Not authenticated");
    const updated = await api.updateProfile(t, data);
    setUser(updated);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setVehicles([]);
    setSelectedVehicle(null);
    setAuthError(null);
    setVehicleError(null);
  };

  const addVehicle = async (data: Partial<api.VehicleInput>) => {
    const t = tokenStore.get();
    if (!t) throw new Error("Not authenticated");
    const vehicle = await api.createVehicle(t, data);
    await refreshVehicles();
    return vehicle;
  };

  const editVehicle = async (id: string, data: Partial<api.VehicleInput>) => {
    const t = tokenStore.get();
    if (!t) throw new Error("Not authenticated");
    await api.updateVehicle(t, id, data);
    await refreshVehicles();
  };

  const removeVehicle = async (id: string) => {
    const t = tokenStore.get();
    if (!t) throw new Error("Not authenticated");
    await api.deleteVehicle(t, id);
    await refreshVehicles();
  };

  const setDefault = async (id: string) => {
    const t = tokenStore.get();
    if (!t) throw new Error("Not authenticated");
    await api.setDefaultVehicle(t, id);
    await refreshVehicles();
  };

  return (
    <VehicleContext.Provider
      value={{
        user, token, authLoading, authError, login, register, updateProfile, logout,
        clearAuthError: () => setAuthError(null),
        vehicles, vehiclesLoading, vehicleError, selectedVehicle,
        selectVehicle: setSelectedVehicle,
        refreshVehicles, addVehicle, editVehicle, removeVehicle, setDefault,
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
