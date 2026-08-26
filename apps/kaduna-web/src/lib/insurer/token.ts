// Module-level token store: keeps the Supabase access token available
// synchronously for all insurer API calls. Updated by TokenSync in the layout.
let _token = "";

export function setInsurerToken(token: string): void {
  _token = token;
}

export function getInsurerToken(): string {
  return _token;
}
