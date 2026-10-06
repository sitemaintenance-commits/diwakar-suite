// Tasks, approvals, materials, vendor bills and client payments across every
// project, each its own page under Projects -- as the old Project CRM had
// them. A site filter narrows to one project; the tables and forms are the
// project page's own tabs.
import { useState, type ReactNode } from 'react';
import { Blocks, FileText, ListChecks, ScrollText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useTemplates } from '@/features/projects/api';
import { stageOf } from '@/features/projects/shared';
import { ALL_PROJECTS, useProjectList } from '@/features/projects/portfolio';
import { ApprovalsTab, BillsTab, MaterialsTab, PaymentsTab, PlanTab } from '@/features/projects/ProjectDetailPage';

function PortfolioPage({ icon, title, description, children, extra }: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: (projectId: string) => ReactNode;
  extra?: ReactNode;
}) {
  const projects = useProjectList();
  const [site, setSite] = useState(ALL_PROJECTS);
  return (
    <>
      <PageHeader
        icon={icon}
        title={title}
        description={description}
        actions={
          <div className="w-60">
            <FilterSelect value={site} onChange={setSite}
              options={[[ALL_PROJECTS, 'All sites'], ...(projects.data ?? []).map((p) => [p.id, p.name] as [string, string])]} />
          </div>
        }
      />
      {/* key: a different site starts the tab afresh (its add form, its picker). */}
      <div key={site}>{children(site)}</div>
      {extra}
    </>
  );
}

export function ProjectTasksPage() {
  return (
    <PortfolioPage icon={ListChecks} title="Tasks & Templates"
      description="Every project's execution plan, and the plan templates that create it."
      extra={<TemplatesCard />}>
      {(id) => <PlanTab projectId={id} />}
    </PortfolioPage>
  );
}

export function ProjectApprovalsPage() {
  return (
    <PortfolioPage icon={ShieldCheck} title="Project Approvals"
      description="DISCOM, CEIG, net metering, subsidy and the rest — reference numbers and expected dates for every site.">
      {(id) => <ApprovalsTab projectId={id} />}
    </PortfolioPage>
  );
}

export function MaterialsPage() {
  return (
    <PortfolioPage icon={Blocks} title="Materials"
      description="Modules, inverters, BOS and the rest: dispatched, received and short, for every site.">
      {(id) => <MaterialsTab projectId={id} />}
    </PortfolioPage>
  );
}

export function VendorBillsPage() {
  return (
    <PortfolioPage icon={FileText} title="Vendor Payment Approval"
      description="Vendor bills: verification, project-manager approval, accounts approval and payment.">
      {(id) => <BillsTab projectId={id} />}
    </PortfolioPage>
  );
}

export function ClientPaymentsPage() {
  return (
    <PortfolioPage icon={ScrollText} title="Client Payments"
      description="Client milestones, invoices, what has arrived and what is still outstanding.">
      {(id) => <PaymentsTab projectId={id} />}
    </PortfolioPage>
  );
}

/** The plan templates: which tasks, in which stage, how many days after the start. */
function TemplatesCard() {
  const templates = useTemplates();
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      {(templates.data ?? []).map((t) => {
        const tasks = [...(t.project_template_tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        return (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle>{t.name}</CardTitle>
              <CardDescription>
                Template · {tasks.length} tasks · {tasks.length ? Math.max(...tasks.map((x) => x.day_offset)) : 0} days
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Day</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="text-sm">{x.title}</TableCell>
                      <TableCell><Badge variant={stageOf(x.stage).tone}>{stageOf(x.stage).label}</Badge></TableCell>
                      <TableCell className="tabular text-right text-sm">{x.day_offset}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
