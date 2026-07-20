-- Allow sending the same notification over email and SMS together.
alter type public.notification_channel add value if not exists 'both';
