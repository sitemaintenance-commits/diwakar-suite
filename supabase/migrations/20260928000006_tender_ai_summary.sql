-- =====================================================================
-- AI tender lookup: the summary Claude writes from the official notice
-- is kept on the tender, with the links it came from, so the bid team
-- reads it once instead of re-running the lookup.
--
--   ai_summary     { overview, scope[], eligibility[], key_dates[{label,value}],
--                    financials[{label,value}], documents_required[], risks[],
--                    recommendation }
--   ai_sources     [{ url, title }]   official pages / PDFs used
--   ai_summary_from 'pdf' (read from the notice) | 'web' (from portal pages)
-- Written by the browser as the signed-in user, so the existing tender
-- policies (EDIT permission + scope) apply unchanged.
-- =====================================================================
alter table public.tenders
  add column if not exists ai_summary      jsonb,
  add column if not exists ai_sources      jsonb,
  add column if not exists ai_summary_from text check (ai_summary_from is null or ai_summary_from in ('pdf', 'web')),
  add column if not exists ai_summary_at   timestamptz;
