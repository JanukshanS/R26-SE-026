/**
 * Reads a job from the dispatch service so it can become a job card.
 *
 * The caller's own bearer token is forwarded, so dispatch applies its own
 * ownership rules; this service never holds credentials for dispatch.
 */
import { config } from '../config';
import { DomainError } from '../utils/http';

export interface DispatchIncident {
  id: string;
  status: string;
  assignedProviderId?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  registrationNo?: string | null;
  description?: string | null;
  triageResponse?: { predictedServiceType?: string | null } | null;
}

export async function fetchIncident(incidentId: string, authorization: string): Promise<DispatchIncident> {
  let response: Response;
  try {
    response = await fetch(`${config.dispatchUrl}/api/v1/incidents/${encodeURIComponent(incidentId)}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new DomainError(502, "Couldn't reach the dispatch service");
  }
  if (response.status === 404) throw new DomainError(404, 'Kaduna job not found');
  if (response.status === 401 || response.status === 403) throw new DomainError(403, "You can't access that Kaduna job");
  if (!response.ok) throw new DomainError(502, `Dispatch service answered ${response.status}`);
  const body = (await response.json()) as { success?: boolean; data?: DispatchIncident };
  if (!body?.success || !body.data) throw new DomainError(502, 'Unexpected answer from the dispatch service');
  return body.data;
}
