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

export async function listInsuranceCompanies(): Promise<InsuranceCompany[]> {
  const { data, error } = await supabase
    .from('insurance_companies')
    .select('*')
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as InsuranceCompanyRow[]).map(mapCompany);
}

/** Looks up a single company by its stored name (a vehicle's `insurance_provider`).
 * Case-insensitive exact match (`ilike` with no wildcards) — the name is always picked from
 * `listInsuranceCompanies()` by both save paths, but this avoids a silent "no insurer found"
 * if a stored value ever differs only in case. */
export async function findInsuranceCompany(companyName: string): Promise<InsuranceCompany | null> {
  const trimmed = companyName.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from('insurance_companies')
    .select('*')
    .ilike('company_name', trimmed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCompany(data as InsuranceCompanyRow) : null;
}
