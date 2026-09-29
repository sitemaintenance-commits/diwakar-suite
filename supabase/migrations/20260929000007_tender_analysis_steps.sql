-- =====================================================================
-- Tender analysis in steps. A 100-300 page RfS could not be uploaded to
-- Gemini and analysed inside one function run (150 s), so a job now runs
-- as a chain: prepare (upload + Google's processing), then three analysis
-- parts in parallel, each in its own function run with its own budget.
--
--   parts         { synopsis?: {...}, risks?: {...}, decision?: {...} }
--   gemini_files  [{ name, uri, filename }] while the job runs
--   step          'preparing' | 'analysing' (display only)
--
-- Parts finish in any order and at the same moment, so they are merged by
-- one UPDATE in tender_analysis_save_part instead of read-modify-write.
-- Only the Edge Function (service role) may call it.
-- =====================================================================
alter table public.tender_analysis_jobs
  add column if not exists parts        jsonb not null default '{}'::jsonb,
  add column if not exists gemini_files jsonb,
  add column if not exists step         text;

create or replace function public.tender_analysis_save_part(p_job uuid, p_part text, p_value jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update public.tender_analysis_jobs
     set parts = parts || jsonb_build_object(p_part, p_value),
         updated_at = now()
   where id = p_job and status = 'processing'
  returning parts;
$$;

revoke all on function public.tender_analysis_save_part(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tender_analysis_save_part(uuid, text, jsonb) to service_role;
