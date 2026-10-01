// The Documents button every section's page header carries, and the
// Documents page that lists every section's documents together.
import { useState } from 'react';
import { useInRouterContext, useLocation } from 'react-router';
import { FolderOpen } from 'lucide-react';
import { useAccess } from '@/auth/AccessProvider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/common';
import { DocumentLibrary } from '@/features/documents/DocumentLibrary';
import { useDocumentList } from '@/features/documents/api';

/** The section (module) a path belongs to: the one with the longest matching route. */
function useCurrentSection() {
  const { access, can } = useAccess();
  const { pathname } = useLocation();
  let best: { key: string; label: string; route: string } | null = null;
  for (const m of access?.modules ?? []) {
    if (!m.route || m.route === '/' || m.key === 'documents') continue;
    if (pathname !== m.route && !pathname.startsWith(`${m.route}/`)) continue;
    if (!best || m.route.length > best.route.length) best = { key: m.key, label: m.label, route: m.route };
  }
  return best && can(best.key, 'view') ? best : null;
}

function SectionButton() {
  const section = useCurrentSection();
  const [open, setOpen] = useState(false);
  const count = useDocumentList({ module: section?.key, scope: 'section', limit: 0 }, Boolean(section));
  if (!section) return null;
  const total = count.data?.total ?? 0;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} title={`${section.label} documents`}>
        <FolderOpen /> Documents
        {total > 0 && <span className="rounded-full bg-primary-soft px-1.5 text-xs font-semibold text-primary">{total}</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{section.label} · Documents</DialogTitle>
            <DialogDescription>
              Work documents for this section: reports, photos, bills, certificates, drawings. Everyone who can open
              {` ${section.label} `}can see them and add their own.
            </DialogDescription>
          </DialogHeader>
          <DocumentLibrary moduleKey={section.key} compact />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rendered by PageHeader: nothing outside the router or off a section page. */
export function SectionDocumentsButton() {
  return useInRouterContext() ? <SectionButton /> : null;
}

export function DocumentsPage() {
  return (
    <>
      <PageHeader
        icon={FolderOpen}
        title="Documents"
        description="Every work document from the sections you can open: section libraries and files attached to tenders and other records."
      />
      <DocumentLibrary />
    </>
  );
}
