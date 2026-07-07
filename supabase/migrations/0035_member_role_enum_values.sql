-- Add missing role values to the member_role enum.
-- The original schema only had 'admin' and 'member'; designer/account_manager/preprod_owner
-- were added to the app code but never migrated to the database type.
alter type public.member_role add value if not exists 'designer';
alter type public.member_role add value if not exists 'account_manager';
alter type public.member_role add value if not exists 'preprod_owner';
