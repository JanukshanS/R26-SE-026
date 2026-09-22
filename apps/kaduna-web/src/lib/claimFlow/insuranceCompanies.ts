import { supabase } from "@/lib/supabase";

/** Port of apps/mobile/lib/insuranceCompaniesApi.ts — public reference data
 * (insurance_companies has no RLS: every driver, and every anonymous claim-link
 * session, sees the same list). */
export type InsuranceCompany = {
  companyName: string;
  appName: string;
  phoneTel: string;
};

export async function findInsuranceCompany(companyName: string | null): Promise<InsuranceCompany | null> {
  if (!companyName?.trim()) return null;
  const { data, error } = await supabase
    .from("insurance_companies")
    .select("company_name, app_name, phone_tel")
    .ilike("company_name", companyName.trim())
    .maybeSingle();
  if (error || !data) return null;
  return { companyName: data.company_name, appName: data.app_name, phoneTel: data.phone_tel };
}
