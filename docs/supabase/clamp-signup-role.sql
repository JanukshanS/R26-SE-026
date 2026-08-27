-- Close a privilege-escalation hole in signup: the `handle_new_user` trigger
-- copies `raw_user_meta_data->>'role'` into public.profiles, and signup
-- metadata is fully client-controlled. Anyone holding the public anon key can
-- call auth.signUp with `{ role: "ops" }` and land on the ops dashboards
-- without an operator ever running `admin_set_role`.
--
-- Fix: clamp the role at the profiles table itself with a BEFORE INSERT
-- trigger, so no insert path (present or future) can create a profile with a
-- privileged role. Self-signup may only produce driver/provider; ops is
-- granted exclusively via `admin_set_role` (an UPDATE, unaffected here).
--
-- Safe to re-run. Run in Supabase Studio -> SQL Editor.

create or replace function public.clamp_signup_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is null or new.role not in ('driver', 'provider') then
    new.role := 'driver';
  end if;
  return new;
end;
$$;

drop trigger if exists clamp_signup_role_before_insert on public.profiles;
create trigger clamp_signup_role_before_insert
  before insert on public.profiles
  for each row execute function public.clamp_signup_role();
