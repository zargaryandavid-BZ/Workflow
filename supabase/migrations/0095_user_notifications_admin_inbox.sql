-- Admins can see (and mark read) every in-app notification in the workspace.

drop policy if exists "user_notifications_select" on public.user_notifications;
create policy "user_notifications_select" on public.user_notifications
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  );

drop policy if exists "user_notifications_update" on public.user_notifications;
create policy "user_notifications_update" on public.user_notifications
  for update using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (
      user_id = auth.uid()
      or public.is_tenant_admin(tenant_id)
    )
  );
