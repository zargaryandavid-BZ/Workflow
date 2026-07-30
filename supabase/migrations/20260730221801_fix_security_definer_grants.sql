-- Fix SECURITY DEFINER functions executable by anon (Supabase Security Advisor).
--
-- Postgres grants EXECUTE to PUBLIC by default on new functions, which includes
-- anon. Revoke PUBLIC + anon for internal helpers; keep authenticated where
-- the app / RLS needs them.
--
-- Intentionally NOT revoked (public token-link RPCs):
--   get_approval_by_token, get_notification_by_token, get_shipping_request_by_token

-- create_tenant: internal setup, never public
revoke execute on function public.create_tenant(text, text) from public;
revoke execute on function public.create_tenant(text, text) from anon;
grant execute on function public.create_tenant(text, text) to authenticated;

-- handle_new_user: auth trigger only (runs as privilege of trigger owner, not anon)
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;

-- is_tenant_admin / is_tenant_member: RLS helpers — authenticated only
revoke execute on function public.is_tenant_admin(uuid) from public;
revoke execute on function public.is_tenant_admin(uuid) from anon;
grant execute on function public.is_tenant_admin(uuid) to authenticated;

revoke execute on function public.is_tenant_member(uuid) from public;
revoke execute on function public.is_tenant_member(uuid) from anon;
grant execute on function public.is_tenant_member(uuid) to authenticated;
