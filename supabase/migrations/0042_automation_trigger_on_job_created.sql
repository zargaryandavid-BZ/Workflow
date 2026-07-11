-- Allow movement rules that route newly created jobs by product.
alter type public.automation_trigger add value if not exists 'on_job_created';
