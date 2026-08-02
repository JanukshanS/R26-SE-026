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

/** Looks up a single company by its exact stored name (a vehicle's `insurance_provider`). */
export async function findInsuranceCompany(companyName: string): Promise<InsuranceCompany | null> {
  if (!companyName.trim()) return null;
  const { data, error } = await supabase
    .from('insurance_companies')
    .select('*')
    .eq('company_name', companyName)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCompany(data as InsuranceCompanyRow) : null;
}
