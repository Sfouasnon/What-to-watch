-- Remove direct API execution from trigger-only infrastructure. These
-- functions still run as database triggers, but cannot be invoked through RPC.
alter function public.initialize_profile_settings()
  set search_path = public, pg_temp;

revoke all on function public.initialize_profile_settings() from public;
revoke all on function public.initialize_profile_settings() from anon;
revoke all on function public.initialize_profile_settings() from authenticated;

-- Supabase provisions this event-trigger helper on the project. It should not
-- be callable through the exposed public API by browser roles.
revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;
