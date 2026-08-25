-- Multiple die request attachments (up to 5). Legacy file_path / file_name / file_mime stay as the first file.

alter table public.die_requests
  add column if not exists files jsonb not null default '[]'::jsonb;
