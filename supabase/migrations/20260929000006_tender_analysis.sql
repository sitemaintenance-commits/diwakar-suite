-- Private analysis history. Only the Edge Function writes job results.
create table public.tender_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  tender_id uuid references public.tenders(id) on delete cascade,
  files jsonb not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tender_analysis_jobs enable row level security;
grant select on public.tender_analysis_jobs to authenticated;
grant all on public.tender_analysis_jobs to service_role;
create policy tender_analysis_read on public.tender_analysis_jobs for select to authenticated
using (created_by = auth.uid() and (public.has_permission('crm.tenders', 'create') or public.has_permission('crm.tenders', 'edit')));
create index tender_analysis_owner on public.tender_analysis_jobs(created_by, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('tender-analysis', 'tender-analysis', false, 50000000, array['application/pdf'])
on conflict(id) do nothing;
create policy tender_analysis_files_read on storage.objects for select to authenticated
using (bucket_id = 'tender-analysis' and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_permission('crm.tenders', 'create') or public.has_permission('crm.tenders', 'edit')));
create policy tender_analysis_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'tender-analysis' and (storage.foldername(name))[1] = auth.uid()::text
  and (public.has_permission('crm.tenders', 'create') or public.has_permission('crm.tenders', 'edit')));
create policy tender_analysis_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'tender-analysis' and (storage.foldername(name))[1] = auth.uid()::text);
update storage.buckets set file_size_limit = greatest(file_size_limit, 50000000) where id = 'documents';
