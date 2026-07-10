-- Add 'ready_to_ship' to the column_kind and notification_type enums.
-- PostgreSQL enums require ALTER TYPE ... ADD VALUE (cannot use CHECK constraints).

alter type public.column_kind add value if not exists 'ready_to_ship';

alter type public.notification_type add value if not exists 'ready_to_ship';
