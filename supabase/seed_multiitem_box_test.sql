-- Multi-item Box Slip test data
--
-- 1. Replace the zero UUID below with the tenant id you want to test.
-- 2. Run this file in the Supabase SQL editor or with psql.
-- 3. Scan/type TEST-MIB-1001 through TEST-MIB-1006.
--
-- Safe to run repeatedly: the fixed test rows are updated in place.

do $$
declare
  target_tenant uuid := '00000000-0000-0000-0000-000000000000';
  target_column uuid;
begin
  if target_tenant = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Replace target_tenant with your tenant UUID before running';
  end if;

  if not exists (select 1 from public.tenants where id = target_tenant) then
    raise exception 'Tenant % does not exist', target_tenant;
  end if;

  select id
    into target_column
    from public.board_columns
   where tenant_id = target_tenant
   order by position asc, created_at asc
   limit 1;

  if target_column is null then
    raise exception 'Tenant % has no board columns', target_tenant;
  end if;

  insert into public.customers (id, tenant_id, name, email, phone, company)
  values
    (
      '10000000-0000-4000-8000-000000000001',
      target_tenant,
      'Mile High Cure',
      'tyler@milehighcure.example.invalid',
      '+13109720325',
      'Mile High Cure'
    ),
    (
      '10000000-0000-4000-8000-000000000002',
      target_tenant,
      'Acme Coffee Roasters',
      'orders@acmecoffee.example.invalid',
      '+13035550102',
      'Acme Coffee Roasters'
    ),
    (
      '10000000-0000-4000-8000-000000000003',
      target_tenant,
      'Northstar Events',
      'production@northstar.example.invalid',
      '+17205550103',
      'Northstar Events'
    )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    name = excluded.name,
    email = excluded.email,
    phone = excluded.phone,
    company = excluded.company;

  insert into public.orders (
    id,
    tenant_id,
    column_id,
    customer_id,
    title,
    description,
    specs,
    priority,
    due_date,
    position
  )
  values
    (
      '20000000-0000-4000-8000-000000000001',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000001',
      'TEST-MIB-1001',
      'Multi-item box test: first Mile High Cure order',
      jsonb_build_object(
        'webhook_item_title', 'Tincture Cartons',
        'product', 'Folding Cartons',
        'skus', jsonb_build_array(
          jsonb_build_object('id', 'test-1001-a', 'name', '30ml Carton', 'qty', 2)
        )
      ),
      'normal',
      current_date + 7,
      91001
    ),
    (
      '20000000-0000-4000-8000-000000000002',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000001',
      'TEST-MIB-1002',
      'Multi-item box test: same customer, multiple SKU quantities',
      jsonb_build_object(
        'webhook_item_title', 'Sample Pouches',
        'product', 'Pouches',
        'skus', jsonb_build_array(
          jsonb_build_object('id', 'test-1002-a', 'name', 'Blue Pouch', 'qty', 3),
          jsonb_build_object('id', 'test-1002-b', 'name', 'Green Pouch', 'qty', 2)
        )
      ),
      'high',
      current_date + 5,
      91002
    ),
    (
      '20000000-0000-4000-8000-000000000003',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000002',
      'TEST-MIB-1003',
      'Multi-item box test: different customer warning',
      jsonb_build_object(
        'webhook_item_title', 'Coffee Bag Labels',
        'product', 'Roll Labels',
        'skus', jsonb_build_array(
          jsonb_build_object('id', 'test-1003-a', 'name', 'Medium Roast', 'qty', 4)
        )
      ),
      'urgent',
      current_date + 2,
      91003
    ),
    (
      '20000000-0000-4000-8000-000000000004',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000002',
      'TEST-MIB-1004',
      'Multi-item box test: second Acme order',
      jsonb_build_object(
        'webhook_item_title', 'Cold Brew Neck Tags',
        'product', 'Neck Tags',
        'skus', jsonb_build_array(
          jsonb_build_object('id', 'test-1004-a', 'name', 'Original', 'qty', 1)
        )
      ),
      'normal',
      current_date + 9,
      91004
    ),
    (
      '20000000-0000-4000-8000-000000000005',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000003',
      'TEST-MIB-1005',
      'Multi-item box test: customer-only update source',
      jsonb_build_object(
        'webhook_item_title', 'Event Badge Inserts',
        'product', 'Badge Inserts',
        'skus', jsonb_build_array(
          jsonb_build_object('id', 'test-1005-a', 'name', 'VIP', 'qty', 6)
        )
      ),
      'normal',
      current_date + 14,
      91005
    ),
    (
      '20000000-0000-4000-8000-000000000006',
      target_tenant,
      target_column,
      '10000000-0000-4000-8000-000000000003',
      'TEST-MIB-1006',
      'Multi-item box test: quantity defaults to one',
      jsonb_build_object(
        'webhook_item_title', 'Table Number Card',
        'product', 'Table Cards'
      ),
      'low',
      current_date + 21,
      91006
    )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    column_id = excluded.column_id,
    customer_id = excluded.customer_id,
    title = excluded.title,
    description = excluded.description,
    specs = excluded.specs,
    priority = excluded.priority,
    due_date = excluded.due_date,
    position = excluded.position,
    removed_at = null,
    updated_at = now();
end
$$;

-- Optional cleanup:
-- delete from public.orders
--  where id::text like '20000000-0000-4000-8000-00000000000%';
-- delete from public.customers
--  where id::text like '10000000-0000-4000-8000-00000000000%';
