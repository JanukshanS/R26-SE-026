-- Lets a garage check, when ordering a part for a job, whether the car's owner
-- has a Kaduna account the pickup can be sent to. Used by the garage-management
-- service (src/services/kadunaVehicles.ts) for the "vehicle owner collects"
-- option.
--
-- It answers yes or no only: never who owns the plate, so it can't be used to
-- look people up. Plates are compared on letters and digits only, because the
-- app stores "WP-CAB-1234" and a garage may have typed "WPCAB1234".
--
-- Optional: without it the garage-management service treats every plate as
-- "can't check" and still lets the garage choose the vehicle owner. Run it
-- for the "no Kaduna account has this plate" warning.
--
-- Safe to re-run. Run in Supabase Studio -> SQL Editor.

create or replace function public.plate_is_registered(p_plate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vehicles v
    where regexp_replace(upper(v.plate_number), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(coalesce(p_plate, '')), '[^A-Z0-9]', '', 'g')
      and length(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g')) >= 4
  );
$$;

-- Signed-in accounts only (garage owners call it with their own token).
revoke all on function public.plate_is_registered(text) from public, anon;
grant execute on function public.plate_is_registered(text) to authenticated;
