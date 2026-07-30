-- Fix Multiple Permissive Policies warnings (Supabase Performance Advisor).
--
-- Pattern on each table below:
--   *_select_member  FOR SELECT  (is_tenant_member)
--   *_admin_write    FOR ALL     (is_tenant_admin)
--
-- FOR ALL overlaps SELECT, so Postgres evaluates both policies on every SELECT.
-- Admins are already covered by is_tenant_member for reads, so split admin write
-- into INSERT / UPDATE / DELETE only. SELECT stays on the member policy alone.
--
-- Never drops the select policy (only coverage for non-admin reads).

-- =============================================================================
-- Helper pattern applied per table (drop FOR ALL admin write → recreate as 3)
-- =============================================================================

-- automation_rules -----------------------------------------------------------
drop policy if exists "automation_admin_write" on public.automation_rules;
create policy "automation_admin_insert" on public.automation_rules
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "automation_admin_update" on public.automation_rules
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "automation_admin_delete" on public.automation_rules
  for delete using (public.is_tenant_admin(tenant_id));

-- board_columns --------------------------------------------------------------
drop policy if exists "columns_admin_write" on public.board_columns;
create policy "columns_admin_insert" on public.board_columns
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "columns_admin_update" on public.board_columns
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "columns_admin_delete" on public.board_columns
  for delete using (public.is_tenant_admin(tenant_id));

-- button_automations ---------------------------------------------------------
drop policy if exists "button_automations_admin_write" on public.button_automations;
create policy "button_automations_admin_insert" on public.button_automations
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "button_automations_admin_update" on public.button_automations
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "button_automations_admin_delete" on public.button_automations
  for delete using (public.is_tenant_admin(tenant_id));

-- card_warning_rules ---------------------------------------------------------
drop policy if exists "card_warning_rules_admin_write" on public.card_warning_rules;
create policy "card_warning_rules_admin_insert" on public.card_warning_rules
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "card_warning_rules_admin_update" on public.card_warning_rules
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "card_warning_rules_admin_delete" on public.card_warning_rules
  for delete using (public.is_tenant_admin(tenant_id));

-- custom_fields --------------------------------------------------------------
drop policy if exists "custom_fields_admin_write" on public.custom_fields;
create policy "custom_fields_admin_insert" on public.custom_fields
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "custom_fields_admin_update" on public.custom_fields
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "custom_fields_admin_delete" on public.custom_fields
  for delete using (public.is_tenant_admin(tenant_id));

-- fast_action_buttons --------------------------------------------------------
drop policy if exists "fast_action_buttons_admin_write" on public.fast_action_buttons;
create policy "fast_action_buttons_admin_insert" on public.fast_action_buttons
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "fast_action_buttons_admin_update" on public.fast_action_buttons
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "fast_action_buttons_admin_delete" on public.fast_action_buttons
  for delete using (public.is_tenant_admin(tenant_id));

-- memberships ----------------------------------------------------------------
drop policy if exists "memberships_admin_write" on public.memberships;
create policy "memberships_admin_insert" on public.memberships
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "memberships_admin_update" on public.memberships
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "memberships_admin_delete" on public.memberships
  for delete using (public.is_tenant_admin(tenant_id));

-- message_templates ----------------------------------------------------------
drop policy if exists "message_templates_admin_write" on public.message_templates;
create policy "message_templates_admin_insert" on public.message_templates
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "message_templates_admin_update" on public.message_templates
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "message_templates_admin_delete" on public.message_templates
  for delete using (public.is_tenant_admin(tenant_id));

-- notification_rules ---------------------------------------------------------
drop policy if exists "notification_rules_admin_write" on public.notification_rules;
create policy "notification_rules_admin_insert" on public.notification_rules
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "notification_rules_admin_update" on public.notification_rules
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "notification_rules_admin_delete" on public.notification_rules
  for delete using (public.is_tenant_admin(tenant_id));

-- tags (renamed from categories; policy names may still be categories_*) ----
drop policy if exists "categories_admin_write" on public.tags;
drop policy if exists "tags_admin_write" on public.tags;
create policy "tags_admin_insert" on public.tags
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "tags_admin_update" on public.tags
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "tags_admin_delete" on public.tags
  for delete using (public.is_tenant_admin(tenant_id));

-- webhook_configs ------------------------------------------------------------
drop policy if exists "webhook_configs_admin_write" on public.webhook_configs;
create policy "webhook_configs_admin_insert" on public.webhook_configs
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "webhook_configs_admin_update" on public.webhook_configs
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "webhook_configs_admin_delete" on public.webhook_configs
  for delete using (public.is_tenant_admin(tenant_id));

-- webhook_history ------------------------------------------------------------
drop policy if exists "webhook_history_admin_write" on public.webhook_history;
create policy "webhook_history_admin_insert" on public.webhook_history
  for insert with check (public.is_tenant_admin(tenant_id));
create policy "webhook_history_admin_update" on public.webhook_history
  for update using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
create policy "webhook_history_admin_delete" on public.webhook_history
  for delete using (public.is_tenant_admin(tenant_id));
