-- Contact person on die manufacturers.

alter table public.die_manufacturers
  add column if not exists contact_name text;
