-- Fix Auth RLS Initialization Plan warnings (Supabase Performance Advisor).
-- Wrap auth.uid() in (select auth.uid()) so Postgres evaluates it once per query
-- instead of once per row.
--
-- Policy bodies match the definitions in prior migrations / setup.sql
-- (0003_rls, 0055_time_tracking, 0060_time_chips, 0063_feedback, 0064_feedback_images).

-- =============================================================================
-- profiles
-- =============================================================================

drop policy if exists "profiles_select_self_or_teammate" on public.profiles;
create policy "profiles_select_self_or_teammate" on public.profiles
  for select using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.memberships me
      join public.memberships them on them.tenant_id = me.tenant_id
      where me.user_id = (select auth.uid()) and them.user_id = profiles.id
    )
  );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = (select auth.uid()));

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = (select auth.uid()));

-- =============================================================================
-- time_entries
-- =============================================================================

drop policy if exists "time_entries_select" on public.time_entries;
create policy "time_entries_select" on public.time_entries
  for select using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  );

drop policy if exists "time_entries_insert" on public.time_entries;
create policy "time_entries_insert" on public.time_entries
  for insert with check (
    public.is_tenant_member(tenant_id)
    and user_id = (select auth.uid())
  );

drop policy if exists "time_entries_update" on public.time_entries;
create policy "time_entries_update" on public.time_entries
  for update using (
    public.is_tenant_member(tenant_id)
    and user_id = (select auth.uid())
  )
  with check (
    public.is_tenant_member(tenant_id)
    and user_id = (select auth.uid())
  );

drop policy if exists "time_entries_delete" on public.time_entries;
create policy "time_entries_delete" on public.time_entries
  for delete using (
    public.is_tenant_member(tenant_id)
    and user_id = (select auth.uid())
  );

-- =============================================================================
-- time_chips
-- =============================================================================

drop policy if exists "time_chips_member_all" on public.time_chips;
create policy "time_chips_member_all" on public.time_chips
  for all using (
    tenant_id in (
      select m.tenant_id from public.memberships m where m.user_id = (select auth.uid())
    )
  )
  with check (
    tenant_id in (
      select m.tenant_id from public.memberships m where m.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- feedback_images
-- =============================================================================

drop policy if exists "feedback_images_insert" on public.feedback_images;
create policy "feedback_images_insert" on public.feedback_images
  for insert with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.feedback f
      where f.id = feedback_id
        and f.tenant_id = tenant_id
        and f.user_id = (select auth.uid())
    )
  );

drop policy if exists "feedback_images_delete" on public.feedback_images;
create policy "feedback_images_delete" on public.feedback_images
  for delete using (
    public.is_tenant_admin(tenant_id)
    or exists (
      select 1 from public.feedback f
      where f.id = feedback_id
        and f.tenant_id = tenant_id
        and f.user_id = (select auth.uid())
    )
  );

-- =============================================================================
-- feedback
-- =============================================================================

drop policy if exists "feedback_insert" on public.feedback;
create policy "feedback_insert" on public.feedback
  for insert with check (
    public.is_tenant_member(tenant_id)
    and user_id = (select auth.uid())
  );

drop policy if exists "feedback_update" on public.feedback;
create policy "feedback_update" on public.feedback
  for update using (
    public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  );
