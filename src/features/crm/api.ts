// Data access for the CRM modules (leads, tenders, quotations, follow-ups,
// documents). Every query runs with the user's JWT; RLS decides the rows.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cleanSearch } from '@/features/admin/api';
import type { DocumentRow, FollowUp, Lead, Quotation, Tender } from '@/lib/types';

export const crmKeys = {
  leads: (f: unknown) => ['leads', f] as const,
  lead: (id: string) => ['lead', id] as const,
  tenders: (f: unknown) => ['tenders', f] as const,
  tender: (id: string) => ['tender', id] as const,
  quotations: (f: unknown) => ['quotations', f] as const,
  quotation: (id: string) => ['quotation', id] as const,
  followUps: (f: unknown) => ['follow-ups', f] as const,
  documents: (entity: string, id: string) => ['documents', entity, id] as const,
};

// ---------------------------------------------------------------- leads
export interface LeadFilters {
  search: string;
  status: string;
  assignedTo: string;
  page: number;
  pageSize: number;
}

export async function fetchLeads(f: LeadFilters, all = false) {
  let q = supabase.from('leads').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`company.ilike.%${s}%,contact_person.ilike.%${s}%,phone.ilike.%${s}%,lead_code.ilike.%${s}%`);
  if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.assignedTo !== 'all') q = q.eq('assigned_to', f.assignedTo);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as Lead[], total: count ?? 0 };
}

export function useLeads(f: LeadFilters) {
  return useQuery({ queryKey: crmKeys.leads(f), queryFn: () => fetchLeads(f), placeholderData: (p) => p });
}

// ---------------------------------------------------------------- tenders
export interface TenderFilters {
  search: string;
  status: string;
  emd: string;
  authority: string;
  assignedTo: string;
  due: 'all' | 'overdue' | 'next7' | 'next30';
  page: number;
  pageSize: number;
}

export const TENDER_SELECT = '*, sites ( id, name )';

export async function fetchTenders(f: TenderFilters, all = false) {
  let q = supabase.from('tenders').select(TENDER_SELECT, { count: 'exact' }).order('submission_due_at', { ascending: true, nullsFirst: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`title.ilike.%${s}%,authority.ilike.%${s}%,reference_no.ilike.%${s}%,tender_code.ilike.%${s}%`);
  if (f.status === 'live') q = q.in('status', ['identified', 'evaluating', 'preparing']);
  else if (f.status === 'in_bid') q = q.in('status', ['submitted', 'technical_qualified', 'financial_opened']);
  else if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.emd !== 'all') q = q.eq('emd_status', f.emd);
  if (f.authority !== 'all') q = q.eq('authority', f.authority);
  if (f.assignedTo !== 'all') q = q.eq('assigned_to', f.assignedTo);
  const now = new Date();
  if (f.due === 'overdue') q = q.lt('submission_due_at', now.toISOString());
  if (f.due === 'next7' || f.due === 'next30') {
    const end = new Date(now.getTime() + (f.due === 'next7' ? 7 : 30) * 864e5);
    q = q.gte('submission_due_at', now.toISOString()).lte('submission_due_at', end.toISOString());
  }
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Tender[], total: count ?? 0 };
}

export function useTenders(f: TenderFilters) {
  return useQuery({ queryKey: crmKeys.tenders(f), queryFn: () => fetchTenders(f), placeholderData: (p) => p });
}

export function useTender(id: string | undefined) {
  return useQuery({
    queryKey: crmKeys.tender(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select(TENDER_SELECT).eq('id', id!).single();
      if (error) throw error;
      return data as unknown as Tender;
    },
  });
}

/** Distinct authorities, for the filter dropdown and input suggestions. */
export function useAuthorities() {
  return useQuery({
    queryKey: ['tender-authorities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenders').select('authority').not('authority', 'is', null).limit(1000);
      if (error) throw error;
      return [...new Set((data ?? []).map((r: { authority: string }) => r.authority))].sort();
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- quotations
export interface QuotationFilters {
  search: string;
  status: string;
  page: number;
  pageSize: number;
}

const QUOTATION_SELECT = '*, tenders ( id, tender_code, title ), leads ( id, lead_code, contact_person, company )';

export async function fetchQuotations(f: QuotationFilters, all = false) {
  let q = supabase.from('quotations').select(QUOTATION_SELECT, { count: 'exact' }).order('created_at', { ascending: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`quotation_no.ilike.%${s}%,client_name.ilike.%${s}%,subject.ilike.%${s}%`);
  if (f.status !== 'all') q = q.eq('status', f.status);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Quotation[], total: count ?? 0 };
}

export function useQuotations(f: QuotationFilters) {
  return useQuery({ queryKey: crmKeys.quotations(f), queryFn: () => fetchQuotations(f), placeholderData: (p) => p });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: crmKeys.quotation(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotations')
        .select(`${QUOTATION_SELECT}, quotation_items ( * )`)
        .eq('id', id!)
        .single();
      if (error) throw error;
      const q = data as unknown as Quotation;
      q.quotation_items = (q.quotation_items ?? []).slice().sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
      return q;
    },
  });
}

// ---------------------------------------------------------------- follow-ups
export interface FollowUpFilters {
  search: string;
  status: string;
  entity: string;
  assignedTo: string;
  due: 'all' | 'overdue' | 'today' | 'week';
  page: number;
  pageSize: number;
  tenderId?: string;
  leadId?: string;
}

const FOLLOWUP_SELECT = '*, leads ( id, lead_code, contact_person, company ), tenders ( id, tender_code, title )';

export async function fetchFollowUps(f: FollowUpFilters, all = false) {
  let q = supabase.from('follow_ups').select(FOLLOWUP_SELECT, { count: 'exact' }).order('follow_up_at', { ascending: true });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`subject.ilike.%${s}%,notes.ilike.%${s}%`);
  if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.entity !== 'all') q = q.eq('entity_type', f.entity);
  if (f.assignedTo !== 'all') q = q.eq('assigned_to', f.assignedTo);
  if (f.tenderId) q = q.eq('tender_id', f.tenderId);
  if (f.leadId) q = q.eq('lead_id', f.leadId);
  const now = new Date();
  if (f.due === 'overdue') q = q.lt('follow_up_at', now.toISOString()).eq('status', 'scheduled');
  if (f.due === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 864e5);
    q = q.gte('follow_up_at', start.toISOString()).lt('follow_up_at', end.toISOString());
  }
  if (f.due === 'week') q = q.gte('follow_up_at', now.toISOString()).lte('follow_up_at', new Date(now.getTime() + 7 * 864e5).toISOString());
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as FollowUp[], total: count ?? 0 };
}

export function useFollowUps(f: FollowUpFilters, enabled = true) {
  return useQuery({ queryKey: crmKeys.followUps(f), enabled, queryFn: () => fetchFollowUps(f), placeholderData: (p) => p });
}

// ---------------------------------------------------------------- documents
export function useDocuments(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: crmKeys.documents(entityType, entityId ?? ''),
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });
}

/** Uploads to the private documents bucket, then records the row. */
export async function uploadDocument(opts: {
  moduleKey: string;
  entityType: string;
  entityId: string;
  file: File;
  category?: string;
  siteId?: string | null;
}) {
  const safeName = opts.file.name.replace(/[^\w.\-() ]+/g, '_').slice(-120);
  const path = `${opts.moduleKey}/${opts.entityId}/${crypto.randomUUID()}-${safeName}`;
  const up = await supabase.storage.from('documents').upload(path, opts.file, { contentType: opts.file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await supabase.from('documents').insert({
    module_key: opts.moduleKey,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    category: opts.category || null,
    file_name: opts.file.name,
    storage_path: path,
    mime_type: opts.file.type || null,
    size_bytes: opts.file.size,
    site_id: opts.siteId ?? null,
  });
  if (error) {
    await supabase.storage.from('documents').remove([path]); // keep storage and table in step
    throw error;
  }
}

export async function deleteDocument(doc: DocumentRow) {
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  if (error) throw error;
  await supabase.storage.from('documents').remove([doc.storage_path]);
}

export async function downloadDocument(doc: DocumentRow) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 120, { download: doc.file_name });
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}
