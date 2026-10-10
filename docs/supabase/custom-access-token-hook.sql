-- Copies public.profiles.role into the access token as app_metadata.role,
-- which geo-intelligence reads for its ops-only routes (GEO_ROLE_CLAIM).
-- Applied to the kaduna project on 2026-10-09. It has no effect until it is
-- enabled under Authentication > Hooks > Customize Access Token (JWT) Claims.
-- Once tokens carry the role, set GEO_ENFORCE_ROLES=true on geo-intelligence.
-- On any error the token is returned unchanged, so a fault never blocks login.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_role text;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);
  select role into user_role from public.profiles where id = (event->>'user_id')::uuid;
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    coalesce(claims->'app_metadata', '{}'::jsonb) || jsonb_build_object('role', coalesce(user_role, 'driver'))
  );
  return jsonb_set(event, '{claims}', claims);
exception when others then
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;
drop policy if exists "auth admin reads roles" on public.profiles;
create policy "auth admin reads roles" on public.profiles for select to supabase_auth_admin using (true);
