-- Fix Function Search Path Mutable warnings (Supabase Security Advisor).
-- Pin search_path to empty and schema-qualify all references so a hostile
-- schema earlier on the path cannot hijack unqualified names.

-- =============================================================================
-- public.update_updated_at (trigger helper)
-- =============================================================================
create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- =============================================================================
-- public.set_updated_at (trigger helper)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- =============================================================================
-- public.normalize_customer_phone
-- =============================================================================
create or replace function public.normalize_customer_phone(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text;
begin
  if raw is null or pg_catalog.btrim(raw) = '' then
    return null;
  end if;

  digits := pg_catalog.regexp_replace(raw, '[^0-9]', '', 'g');

  if pg_catalog.length(digits) = 10 then
    return '+1' || digits;
  end if;

  if pg_catalog.length(digits) = 11 and pg_catalog.left(digits, 1) = '1' then
    return '+' || digits;
  end if;

  if pg_catalog.left(pg_catalog.btrim(raw), 1) = '+' then
    return '+' || digits;
  end if;

  return '+' || digits;
end;
$$;

-- =============================================================================
-- public.feedback_guard_columns (trigger helper)
-- =============================================================================
create or replace function public.feedback_guard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_tenant_admin(old.tenant_id) then
    if new.status is distinct from old.status
       or new.admin_note is distinct from old.admin_note
       or new.user_id is distinct from old.user_id
       or new.tenant_id is distinct from old.tenant_id
       or new.display_name is distinct from old.display_name
    then
      raise exception 'Not allowed to update protected feedback columns';
    end if;
  end if;
  return new;
end;
$$;
