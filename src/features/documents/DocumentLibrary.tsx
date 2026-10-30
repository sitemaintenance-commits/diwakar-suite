// A document library: upload (several files at once, drag and drop),
// search, filter, preview, download, correct the details, delete. Used for
// one section (the Documents button in every page header) and for all of
// them (the Documents page).
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Download, Eye, FileArchive, FileImage, FileSpreadsheet, FileText, Folder, FolderOpen, Loader2, Mail, Paperclip, Pencil, Trash2, Upload, X,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportXlsx } from '@/lib/export';
import { fmtDate, fmtNumber, todayIST } from '@/lib/format';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, EmptyState, ErrorState, Field, SearchInput, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import {
  BLOCKED_FILE, DOC_CATEGORIES, MAX_FILE_BYTES, canPreview, createDocumentFolder, docKeys, fetchDocuments, openDocument, removeDocument,
  updateDocument, updateDocumentFolder, uploadSectionDocument, useDocumentList, useFolderOwners, type DocFolder, type LibraryDoc,
} from '@/features/documents/api';
import { SendDocumentDialog } from '@/features/documents/SendDocumentDialog';
import { InsuranceFields, InsuranceTable, insuranceStatus, isInsurance, type InsuranceDetails } from '@/features/documents/insurance';

const ALL = '__all__';
const NONE = '__none__';
const AUTO = '__auto__';
const NEW_FOLDER = '__new_folder__';
const insuranceFolder = (folders: DocFolder[], id: string | null | undefined) =>
  Boolean(id && folders.find((f) => f.id === id && /insur/i.test(`${f.name} ${f.code}`)));
/** Only the filled-in fields, trimmed. */
const cleanDetails = (d: InsuranceDetails): Record<string, string> =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));

/** The folder dropdown, with "+ New folder…" at the end to create one by name. */
function FolderPicker({ value, onChange, folders, first }: {
  value: string;
  onChange: (id: string) => void;
  folders: DocFolder[];
  first: [string, string];
}) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; name: string }[]>([]);
  const all = [...folders, ...made.filter((m) => !folders.some((f) => f.id === m.id))];

  async function create() {
    if (name.trim().length < 2) return toast.error('Give the folder a name.');
    setBusy(true);
    try {
      const f = await createDocumentFolder(name);
      setMade((m) => [...m, { id: f.id, name: f.name }]);
      onChange(f.id);
      toast.success(f.existing ? `“${f.name}” already exists; chosen` : `Folder “${f.name}” created`);
      await qc.invalidateQueries({ queryKey: docKeys.all });
      setAsking(false);
      setName('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FilterSelect value={value} onChange={(v) => (v === NEW_FOLDER ? setAsking(true) : onChange(v))}
        options={[first, ...all.map((f) => [f.id, f.name] as [string, string]), [NEW_FOLDER, '+ New folder…']]} />
      <Dialog open={asking} onOpenChange={(o) => !busy && setAsking(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Everyone with Documents can see the folder and file into it.</DialogDescription>
          </DialogHeader>
          <Field label="Folder name">
            <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} placeholder="e.g. Site photos, Insurance, Land papers" />
          </Field>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void create()}>{busy && <Loader2 className="animate-spin" />} Create folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
const PAGE = 50;
// Sections whose work is tied to a plant: offer the plant on upload.
const PLANT_GROUPS = new Set(['operations', 'portfolio', 'projects']);

function fileIcon(d: Pick<LibraryDoc, 'mime_type' | 'file_name'>) {
  const t = `${d.mime_type ?? ''} ${d.file_name}`.toLowerCase();
  if (/image\/|\.(png|jpe?g|webp|gif|heic)\b/.test(t)) return FileImage;
  if (/sheet|excel|csv|\.(xlsx?|csv)\b/.test(t)) return FileSpreadsheet;
  if (/zip|rar|7z|\.(zip|rar|7z)\b/.test(t)) return FileArchive;
  return FileText;
}

const fmtSize = (b: number | null) =>
  b == null ? '' : b >= 1024 * 1024 ? `${fmtNumber(b / 1024 / 1024, 1)} MB` : `${fmtNumber(Math.max(1, b / 1024))} KB`;

export function DocumentLibrary({ moduleKey, compact = false }: { moduleKey?: string; compact?: boolean }) {
  const { access, can } = useAccess();
  const qc = useQueryClient();
  const docsPerm = useCan('documents');
  const me = useAuth().session?.user.id;
  const folderOwners = useFolderOwners();
  const modules = useMemo(
    () => (access?.modules ?? []).filter((m) => m.route && m.key !== 'dashboard' && m.key !== 'documents' && can(m.key, 'view')),
    [access, can],
  );

  const groups = useMemo(
    () => [...(access?.groups ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((g) => modules.some((m) => m.group === g.key)),
    [access, modules],
  );

  // ------------------------------------------------------------ filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);
  const [section, setSection] = useState(ALL); // a menu category on the Documents page
  const [scope, setScope] = useState<'all' | 'section' | 'records'>(moduleKey ? 'section' : 'all');
  const [mine, setMine] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const filters = {
    module: moduleKey ?? null,
    group: moduleKey || section === ALL ? null : section,
    scope,
    search,
    category: category === ALL ? null : category,
    mine,
    expiring,
    folder,
    limit,
  };
  const list = useDocumentList(filters);

  // ------------------------------------------------------------- upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [target, setTarget] = useState(moduleKey ?? '');
  const [targetGroup, setTargetGroup] = useState('');
  const groupModules = modules.filter((m) => m.group === targetGroup);
  function chooseGroup(g: string) {
    setTargetGroup(g);
    const inGroup = modules.filter((m) => m.group === g);
    setTarget(inGroup.length === 1 ? inGroup[0].key : '');
  }
  const [upCategory, setUpCategory] = useState('');
  const [upNotes, setUpNotes] = useState('');
  const [upValid, setUpValid] = useState('');
  const [upSite, setUpSite] = useState(NONE);
  const [upFolder, setUpFolder] = useState(AUTO);
  const [upIns, setUpIns] = useState<InsuranceDetails>({});
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const targetModule = modules.find((m) => m.key === target);
  const sites = useSites();
  const showPlant = targetModule ? PLANT_GROUPS.has(targetModule.group) : false;

  function addFiles(files: FileList | File[] | null) {
    const picked = Array.from(files ?? []);
    const bad = picked.filter((f) => BLOCKED_FILE.test(f.name));
    const big = picked.filter((f) => f.size > MAX_FILE_BYTES);
    if (bad.length) toast.error(`Not allowed (programs or web pages): ${bad.map((f) => f.name).join(', ')}`);
    if (big.length) toast.error(`Larger than 50 MB: ${big.map((f) => f.name).join(', ')}`);
    const ok = picked.filter((f) => !bad.includes(f) && !big.includes(f));
    setQueue((q) => [...q, ...ok].slice(0, 20));
  }

  const upInsurance = isInsurance(upCategory) || insuranceFolder(list.data?.folders ?? [], upFolder);

  async function uploadAll() {
    if (!target) return toast.error(moduleKey ? 'No section.' : 'Choose the category and section the documents belong to.');
    if (!queue.length) return;
    setUploading({ done: 0, total: queue.length });
    const failed: File[] = [];
    for (const [i, file] of queue.entries()) {
      try {
        await uploadSectionDocument({
          moduleKey: target, file, category: upCategory.trim() || (upInsurance ? 'Insurance' : null), notes: upNotes.trim() || null,
          validUntil: (upInsurance && upIns.end_date) || upValid || null, siteId: showPlant && upSite !== NONE ? upSite : null,
          folderId: upFolder === AUTO ? null : upFolder,
          details: upInsurance ? cleanDetails(upIns) : {},
        });
      } catch (e) {
        failed.push(file);
        toast.error(`${file.name}: ${errorMessage(e)}`);
      }
      setUploading({ done: i + 1, total: queue.length });
    }
    const done = queue.length - failed.length;
    if (done) toast.success(`${done} document${done === 1 ? '' : 's'} uploaded`);
    setQueue(failed);
    if (!failed.length) {
      setUpNotes('');
      setUpValid('');
      setUpIns({});
    }
    setUploading(null);
    await qc.invalidateQueries({ queryKey: docKeys.all });
  }

  // ------------------------------------------------------ edit / delete
  const [editing, setEditing] = useState<LibraryDoc | null>(null);
  const [sending, setSending] = useState<LibraryDoc | null>(null);
  const [removing, setRemoving] = useState<LibraryDoc | null>(null);

  async function onExport() {
    try {
      const all = await fetchDocuments({ ...filters, limit: 5000, offset: 0 });
      await exportXlsx('documents', `documents-${todayIST()}`, all.rows, [
        { header: 'File', value: (r) => r.file_name, width: 40 },
        { header: 'Category', value: (r) => r.group_label, width: 18 },
        { header: 'Section', value: (r) => r.module_label, width: 22 },
        { header: 'Type', value: (r) => r.category ?? '', width: 18 },
        { header: 'Plant', value: (r) => r.site ?? '', width: 16 },
        { header: 'Notes', value: (r) => r.notes ?? '', width: 40 },
        { header: 'Valid until', value: (r) => r.valid_until ?? '', width: 12 },
        { header: 'Uploaded by', value: (r) => r.uploaded_by ?? '', width: 22 },
        { header: 'Uploaded on', value: (r) => fmtDate(r.created_at), width: 14 },
        { header: 'Size (KB)', value: (r) => Math.round((r.size_bytes ?? 0) / 1024), width: 10 },
      ], { sheet: 'Documents', title: ['Documents', `Exported ${fmtDate(new Date())}`] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  // The open folder, and whether this user may rename it: admins any folder, the maker their own.
  const [editingFolder, setEditingFolder] = useState<DocFolder | null>(null);
  const openFolder = (list.data?.folders ?? []).find((f) => f.id === folder) ?? null;
  const owner = folderOwners.data?.find((f) => f.id === folder);
  const canEditFolder = Boolean(openFolder && (docsPerm.edit || (owner?.is_custom && owner.created_by === me)));

  const categories = Array.from(new Set([...(list.data?.categories ?? []), ...DOC_CATEGORIES]));
  const rows = list.data?.rows ?? [];
  const canUpload = moduleKey ? can(moduleKey, 'view') : modules.length > 0;

  return (
    <div className="space-y-4">
      {canUpload && (
        <div
          className={`rounded-lg border-2 border-dashed p-4 transition-colors ${dragging ? 'border-primary bg-primary-soft' : 'border-border'}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="flex-1 text-sm text-muted-foreground">
              Drag files here, or{' '}
              <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => fileRef.current?.click()}>
                choose files
              </button>
              . Up to 20 at a time, 50 MB each: PDF, photos, Word, Excel, drawings, zip.
            </p>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {queue.length > 0 && (
            <div className="mt-4 space-y-3">
              <ul className="flex flex-wrap gap-2">
                {queue.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs">
                    {f.name} · {fmtSize(f.size)}
                    {!uploading && (
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {!moduleKey && (
                  <Field label="Category" required>
                    <FilterSelect value={targetGroup} onChange={chooseGroup} placeholder="O&M, Projects, HR…"
                      options={groups.map((g) => [g.key, g.label] as [string, string])} />
                  </Field>
                )}
                {!moduleKey && groupModules.length > 1 && (
                  <Field label="Section" required>
                    <FilterSelect value={target} onChange={setTarget} placeholder="Choose a section"
                      options={groupModules.map((m) => [m.key, m.label] as [string, string])} />
                  </Field>
                )}
                <Field label="Folder" hint="Automatic files it by its name: LOA, PPA, DPR… or make a new folder">
                  <FolderPicker value={upFolder} onChange={setUpFolder} folders={list.data?.folders ?? []} first={[AUTO, 'Automatic, from the file name']} />
                </Field>
                <Field label="Document type">
                  <Input list="doc-categories" value={upCategory} onChange={(e) => setUpCategory(e.target.value)} placeholder="e.g. Report, Invoice" />
                </Field>
                {showPlant && (
                  <Field label="Plant">
                    <FilterSelect value={upSite} onChange={setUpSite}
                      options={[[NONE, 'Not for one plant'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
                  </Field>
                )}
                <Field label="Valid until" hint="For certificates, insurance, licences">
                  <Input type="date" value={upValid} onChange={(e) => setUpValid(e.target.value)} />
                </Field>
                {upInsurance && <InsuranceFields value={upIns} onChange={setUpIns} sites={sites.data ?? []} />}
                <Field label="Notes" className="sm:col-span-2">
                  <Input value={upNotes} onChange={(e) => setUpNotes(e.target.value)} placeholder="What it is, which work or period it covers" />
                </Field>
              </div>
              <datalist id="doc-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <div className="flex gap-2">
                <Button onClick={() => void uploadAll()} disabled={!!uploading}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  {uploading ? `Uploading ${uploading.done} of ${uploading.total}…` : `Upload ${queue.length} file${queue.length === 1 ? '' : 's'}`}
                </Button>
                <Button variant="ghost" disabled={!!uploading} onClick={() => setQueue([])}>Clear</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ folders */}
      {(list.data?.folders ?? []).some((f) => f.count > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <FolderTile label="All documents" count={null} active={folder === null} onClick={() => { setFolder(null); setLimit(PAGE); }} />
          {(list.data?.folders ?? []).filter((f) => f.count > 0 || !moduleKey).map((f) => (
            <FolderTile key={f.id} code={f.code} label={f.name} count={f.count} active={folder === f.id}
              onClick={() => { setFolder(folder === f.id ? null : f.id); setLimit(PAGE); }} />
          ))}
        </div>
      )}

      {/* ---------------------------------------------- the open folder */}
      {openFolder && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft px-3 py-2">
          <FolderOpen className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{openFolder.code}</p>
            <p className="truncate text-xs text-muted-foreground">{openFolder.name} · {openFolder.count} file{openFolder.count === 1 ? '' : 's'}</p>
          </div>
          {canEditFolder && (
            <Button size="sm" variant="outline" onClick={() => setEditingFolder(openFolder)}><Pencil /> Edit folder</Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Close the folder" title="Show every folder" onClick={() => { setFolder(null); setLimit(PAGE); }}>
            <X />
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------ filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setLimit(PAGE); }} placeholder="Search file name, type or notes…" />
        <div className={`grid flex-1 gap-2 ${moduleKey ? 'grid-cols-1 sm:max-w-xs' : 'grid-cols-1 sm:grid-cols-3'}`}>
          {!moduleKey && (
            <FilterSelect value={section} onChange={(v) => { setSection(v); setLimit(PAGE); }}
              options={[[ALL, 'All categories'], ...groups.map((g) => [g.key, g.label] as [string, string])]} />
          )}
          <FilterSelect value={category} onChange={(v) => { setCategory(v); setLimit(PAGE); }}
            options={[[ALL, 'All types'], ...(list.data?.categories ?? []).map((c) => [c, c] as [string, string])]} />
          {!moduleKey && (
            <FilterSelect value={scope} onChange={(v) => { setScope(v as typeof scope); setLimit(PAGE); }}
              options={[['all', 'Section libraries and attachments'], ['section', 'Section libraries'], ['records', 'Attached to records']]} />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={mine} onCheckedChange={(v) => { setMine(v === true); setLimit(PAGE); }} /> My uploads
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={expiring} onCheckedChange={(v) => { setExpiring(v === true); setLimit(PAGE); }} /> Expiring / expired
        </label>
        {!moduleKey && docsPerm.export && (
          <Button variant="outline" onClick={() => void onExport()}><Download /> Export</Button>
        )}
      </div>

      {/* --------------------------------------------------------- list */}
      {list.isLoading ? (
        <TableSkeleton cols={4} rows={compact ? 3 : 6} />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={Paperclip} title={search || mine || expiring || category !== ALL ? 'No documents match' : 'No documents yet'}
          description={canUpload ? 'Reports, photos, bills, certificates, drawings: add them above so the team can find them.' : undefined} />
      ) : (category !== ALL && isInsurance(category)) || insuranceFolder(list.data?.folders ?? [], folder) ? (
        <>
          <InsuranceTable rows={rows}
            onOpen={(d) => void openDocument(d, !canPreview(d)).catch((e) => toast.error(errorMessage(e)))}
            onDownload={(d) => void openDocument(d, true).catch((e) => toast.error(errorMessage(e)))}
            onSend={setSending} onEdit={setEditing} onDelete={setRemoving} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmtNumber(rows.length)} of {fmtNumber(list.data?.total)} policies</span>
            {rows.length < (list.data?.total ?? 0) && (
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>Show more</Button>
            )}
          </div>
        </>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {rows.map((d) => {
              const Icon = fileIcon(d);
              return (
                <li key={d.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{d.file_name}</p>
                      {d.folder && <Badge variant="default"><Folder className="h-3 w-3" />{d.folder}</Badge>}
                      {d.category && <Badge variant="secondary">{d.category}</Badge>}
                      {d.details?.end_date && (() => { const st = insuranceStatus(d.details.end_date); return st.days != null && st.days >= 0 ? <Badge variant={st.tone}>{st.days === 0 ? 'Ends today' : `${st.days} day${st.days === 1 ? '' : 's'} left`}</Badge> : null; })()}
                      {d.expiry === 'expired' && <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Expired {fmtDate(d.valid_until)}</Badge>}
                      {d.expiry === 'expiring' && <Badge variant="warning">Expires {fmtDate(d.valid_until)}</Badge>}
                      {d.entity_type !== 'section' && <Badge variant="outline">Attached to a {d.entity_type}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!moduleKey && (d.group_label === d.module_label ? `${d.module_label} · ` : `${d.group_label} › ${d.module_label} · `)}
                      {d.site && `${d.site} · `}
                      {d.uploaded_by ?? 'Unknown'} · {fmtDate(d.created_at)}
                      {d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}
                    </p>
                    {d.details?.policy_no && (
                      <p className="mt-0.5 text-xs text-slate-600">Policy {d.details.policy_no}{d.details.insurer ? ` · ${d.details.insurer}` : ''}{d.details.project_name ? ` · ${d.details.project_name}` : ''}</p>
                    )}
                    {d.notes && <p className="mt-0.5 text-xs text-slate-600">{d.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center">
                    {canPreview(d) && (
                      <Button variant="ghost" size="icon-sm" aria-label="Open" title="Open"
                        onClick={() => void openDocument(d, false).catch((e) => toast.error(errorMessage(e)))}>
                        <Eye />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label="Download" title="Download"
                      onClick={() => void openDocument(d, true).catch((e) => toast.error(errorMessage(e)))}>
                      <Download />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Send by email" title="Send by email" onClick={() => setSending(d)}>
                      <Mail />
                    </Button>
                    {d.can_edit && (
                      <Button variant="ghost" size="icon-sm" aria-label="Edit details" title="Edit details" onClick={() => setEditing(d)}>
                        <Pencil />
                      </Button>
                    )}
                    {d.can_delete && (
                      <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Delete" title="Delete" onClick={() => setRemoving(d)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmtNumber(rows.length)} of {fmtNumber(list.data?.total)}</span>
            {rows.length < (list.data?.total ?? 0) && (
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>
                {list.isFetching && <Loader2 className="animate-spin" />} Show more
              </Button>
            )}
          </div>
        </>
      )}

      <EditDocumentDialog doc={editing} categories={categories} folders={list.data?.folders ?? []} onClose={() => setEditing(null)} />
      <SendDocumentDialog doc={sending} onClose={() => setSending(null)} />
      <EditFolderDialog folder={editingFolder} onClose={() => setEditingFolder(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.file_name}?`}
        description="The file is removed for everyone. This cannot be undone."
        confirmLabel="Delete document"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeDocument(removing);
            toast.success('Document deleted');
            await qc.invalidateQueries({ queryKey: docKeys.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

/** One folder in the strip above the list. */
function FolderTile({ code, label, count, active, onClick }: { code?: string; label: string; count: number | null; active: boolean; onClick: () => void }) {
  const Icon = active ? FolderOpen : Folder;
  return (
    <button type="button" onClick={onClick} title={label}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-primary bg-primary-soft' : 'bg-card hover:bg-muted/60'}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-primary text-primary-foreground' : 'bg-orange-50 text-orange-600'}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{code ?? label}</span>
        <span className="block truncate text-xs text-muted-foreground">{code ? label.replace(new RegExp(`\\s*-\\s*${code}$`, 'i'), '') : ''}{count !== null ? `${code ? ' · ' : ''}${count} file${count === 1 ? '' : 's'}` : 'Every folder'}</span>
      </span>
    </button>
  );
}

/** Renames a folder: the short name on its tile and the full name under it. */
function EditFolderDialog({ folder, onClose }: { folder: DocFolder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (folder && loadedFor !== folder.id) {
    setLoadedFor(folder.id);
    setCode(folder.code);
    setName(folder.name);
  }
  const wasInsurance = Boolean(folder && /insur/i.test(`${folder.name} ${folder.code}`));
  const losesInsurance = wasInsurance && !/insur/i.test(`${name} ${code}`);

  function close() {
    setLoadedFor(null);
    onClose();
  }

  async function save() {
    if (!folder) return;
    if (code.trim().length < 2) return toast.error('Give the folder a short name.');
    if (name.trim().length < 2) return toast.error('Give the folder a full name.');
    setBusy(true);
    try {
      await updateDocumentFolder(folder.id, code, name);
      toast.success('Folder saved');
      await qc.invalidateQueries({ queryKey: docKeys.all });
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(folder)} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit folder</DialogTitle>
          <DialogDescription>The {folder?.count ?? 0} file{folder?.count === 1 ? '' : 's'} in it stay where they are.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Short name" required hint="Shown in capitals on the folder tile, e.g. LOA, PPA, INSURANCE DOC">
            <Input autoFocus value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Full name" required hint="Shown under the short name and in the folder lists">
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          </Field>
          {losesInsurance && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Without the word “insurance” in a name, this folder no longer opens the policy table.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDocumentDialog({ doc, categories, folders, onClose }: { doc: LibraryDoc | null; categories: string[]; folders: DocFolder[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState(NONE);
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [valid, setValid] = useState('');
  const [ins, setIns] = useState<InsuranceDetails>({});
  const sites = useSites();
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (doc && loadedFor !== doc.id) {
    setLoadedFor(doc.id);
    setCategory(doc.category ?? '');
    setFolderId(doc.folder_id ?? NONE);
    setNotes(doc.notes ?? '');
    setValid(doc.valid_until ?? '');
    setIns((doc.details ?? {}) as InsuranceDetails);
  }

  async function save() {
    if (!doc) return;
    setBusy(true);
    try {
      const insurance = isInsurance(category) || insuranceFolder(folders, folderId);
      await updateDocument(doc.id, {
        category: category.trim() || (insurance ? 'Insurance' : null), notes: notes.trim() || null,
        valid_until: (insurance && ins.end_date) || valid || null, folder_id: folderId === NONE ? null : folderId,
        details: insurance ? cleanDetails(ins) : {},
      });
      toast.success('Details saved');
      await qc.invalidateQueries({ queryKey: docKeys.all });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => { if (!o && !busy) { setLoadedFor(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document details</DialogTitle>
          <DialogDescription className="truncate">{doc?.file_name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Folder">
            <FolderPicker value={folderId} onChange={setFolderId} folders={folders} first={[NONE, 'No folder']} />
          </Field>
          <Field label="Document type">
            <Input list="doc-categories-edit" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="doc-categories-edit">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          {(isInsurance(category) || insuranceFolder(folders, folderId)) && <InsuranceFields value={ins} onChange={setIns} sites={sites.data ?? []} />}
          <Field label="Valid until" hint="Leave empty if it does not expire">
            <Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
