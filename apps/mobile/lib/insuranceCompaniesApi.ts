import { supabase } from '@lib/supabase';

/**
 * Public reference data (no RLS scoping needed — every driver sees the same
 * list). Replaces the old hardcoded lib/insuranceProviders.ts array.
 */
export type InsuranceCompany = {
  companyName: string;
  appName: string;
  phoneTel: string;
};

type InsuranceCompanyRow = {
  company_name: string;
  app_name: string;
  phone_tel: string;
};

function mapCompany(row: InsuranceCompanyRow): InsuranceCompany {
  return {
    companyName: row.company_name,
    appName: row.app_name,
    phoneTel: row.phone_tel,
  };
}

// Public reference data — same list for every driver, no RLS, essentially static
// (admin-managed). Safe to cache for the app's whole session: no per-account
// staleness/leak risk at all, since it isn't scoped to any user in the first place.
let cachedCompanies: InsuranceCompany[] | null = null;

/** Synchronous, cache-only lookup — for seeding a screen's initial state instantly
 * (no spinner) when the list happens to already be warm. Returns undefined (not
 * found in cache — may still exist server-side) vs null (cache warm, genuinely no
 * such company) so callers can tell "haven't checked yet" from "checked, no match". */
export function getCachedInsuranceCompany(companyName: string): InsuranceCompany | null | undefined {
  if (!cachedCompanies) {
    return undefined;
  }
  const trimmed = companyName.trim().toLowerCase();
  return cachedCompanies.find((c) => c.companyName.toLowerCase() === trimmed) ?? null;
}

export async function listInsuranceCompanies(): Promise<InsuranceCompany[]> {
  const { data, error } = await supabase
    .from('insurance_companies')
    .select('*')
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  const list = (data as InsuranceCompanyRow[]).map(mapCompany);
  cachedCompanies = list;
  return list;
}

/** Looks up a single company by its stored name (a vehicle's `insurance_provider`).
 * Case-insensitive. Served instantly from the in-memory list once it's warm, instead
 * of a network round trip every time — this is what the "Need to call X?" button
 * resolves through, and that round trip was the main source of its visible delay. On
 * a cold cache, queries directly for just this one company (same as before) and
 * warms the full list in the background so later lookups this session are instant. */
export async function findInsuranceCompany(companyName: string): Promise<InsuranceCompany | null> {
  const trimmed = companyName.trim();
  if (!trimmed) return null;

  if (cachedCompanies) {
    return cachedCompanies.find((c) => c.companyName.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }

  void listInsuranceCompanies().catch(() => {});

  const { data, error } = await supabase
    .from('insurance_companies')
    .select('*')
    .ilike('company_name', trimmed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCompany(data as InsuranceCompanyRow) : null;
}
