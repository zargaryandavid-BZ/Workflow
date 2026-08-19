-- A completed approval decision closes every request that existed at that time.
-- This prevents old links from remaining actionable and removes stale "Waiting"
-- statuses from communication history.
update public.job_notifications as open_request
set status = 'expired'
where open_request.type = 'customer_approval'
  and open_request.status in ('pending', 'sent')
  and exists (
    select 1
    from public.job_notifications as decision
    where decision.order_id = open_request.order_id
      and decision.type = 'customer_approval'
      and decision.status = 'responded'
      and decision.customer_response in ('approved', 'changes_requested')
      and coalesce(decision.responded_at, decision.created_at)
        >= open_request.created_at
  );
