-- Dedicated parent for Final production folders (sibling of job folders).

alter table public.gdrive_settings
  add column if not exists final_root_folder_id text;
