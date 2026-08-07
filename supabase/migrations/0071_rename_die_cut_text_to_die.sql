-- Some tenants have both a "Die Cut" checkbox and a "Die Cut" text field.
-- Rename the text field to "Die" so both appear on the order form
-- (Color | Die, then Application | Die Cut checkboxes).
update public.custom_fields as text_die
set name = 'Die'
where text_die.field_type = 'text'
  and lower(text_die.name) = 'die cut'
  and exists (
    select 1
    from public.custom_fields as box_die
    where box_die.tenant_id = text_die.tenant_id
      and lower(box_die.name) = 'die cut'
      and box_die.field_type = 'checkbox'
  )
  and not exists (
    select 1
    from public.custom_fields as existing_die
    where existing_die.tenant_id = text_die.tenant_id
      and lower(existing_die.name) = 'die'
  );
