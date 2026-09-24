-- Auto-move orders when a client selects their shipping option on the portal.
alter type public.automation_trigger add value if not exists 'on_shipping_opt_selected';
