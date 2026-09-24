// Shared vocabulary for the project modules.
import type { BadgeProps } from '@/components/ui/badge';
import type { ApprovalStatus, BillStatus, ClientPayStatus, MaterialStatus, ProjectStage, WorkStatus } from '@/features/projects/api';

export const STAGES: ProjectStage[] = [
  'design', 'approvals', 'procurement', 'installation', 'testing', 'commissioning', 'handover', 'closed',
];

export const STAGE: Record<ProjectStage, { label: string; tone: BadgeProps['variant'] }> = {
  design: { label: 'Design', tone: 'secondary' },
  approvals: { label: 'Approvals', tone: 'info' },
  procurement: { label: 'Procurement', tone: 'info' },
  installation: { label: 'Installation', tone: 'warning' },
  testing: { label: 'Testing', tone: 'warning' },
  commissioning: { label: 'Commissioning', tone: 'success' },
  handover: { label: 'Handover', tone: 'success' },
  closed: { label: 'Closed', tone: 'secondary' },
};

/** Never let an unexpected value blank the page. */
export function stageOf(stage: ProjectStage | string | null | undefined) {
  return STAGE[stage as ProjectStage] ?? { label: String(stage ?? 'Unknown'), tone: 'secondary' as const };
}

export const SEGMENTS: [string, string][] = [
  ['residential', 'Residential'],
  ['commercial', 'Commercial'],
  ['industrial', 'Industrial'],
  ['government', 'Government'],
];

export const PROJECT_TYPES: [string, string][] = [
  ['ground_mount', 'Ground mount'],
  ['rooftop', 'Rooftop'],
  ['carport', 'Carport'],
  ['street_light', 'Street light'],
  ['hybrid', 'Hybrid'],
  ['other', 'Other'],
];

export const APPROVAL: Record<ApprovalStatus, { label: string; tone: BadgeProps['variant'] }> = {
  not_started: { label: 'Not started', tone: 'secondary' },
  applied: { label: 'Applied', tone: 'info' },
  under_review: { label: 'Under review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
};

export const MATERIAL: Record<MaterialStatus, { label: string; tone: BadgeProps['variant'] }> = {
  pending: { label: 'Pending', tone: 'secondary' },
  ordered: { label: 'Ordered', tone: 'info' },
  dispatched: { label: 'Dispatched', tone: 'info' },
  at_site: { label: 'At site', tone: 'success' },
  shortage: { label: 'Shortage', tone: 'destructive' },
  installed: { label: 'Installed', tone: 'success' },
};

export const BILL: Record<BillStatus, { label: string; tone: BadgeProps['variant'] }> = {
  submitted: { label: 'Submitted', tone: 'warning' },
  pm_approved: { label: 'PM approved', tone: 'info' },
  accounts_approved: { label: 'Accounts approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
};

export const CLIENT_PAY: Record<ClientPayStatus, { label: string; tone: BadgeProps['variant'] }> = {
  pending: { label: 'Pending', tone: 'secondary' },
  invoiced: { label: 'Invoiced', tone: 'warning' },
  part_received: { label: 'Part received', tone: 'info' },
  received: { label: 'Received', tone: 'success' },
};

export const WORK: Record<WorkStatus, { label: string; tone: BadgeProps['variant'] }> = {
  not_started: { label: 'Not started', tone: 'secondary' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
};

/** The seven work fronts the site engineer reports on each day. */
export const WORK_FRONTS: [keyof typeof FRONT_LABELS, string][] = [
  ['tl_work', 'TL work'],
  ['gss_bay', 'GSS bay'],
  ['piling', 'Piling'],
  ['panel', 'Panel'],
  ['module_work', 'Module'],
  ['inverter', 'Inverter'],
  ['material', 'Material'],
];

export const FRONT_LABELS = {
  tl_work: 'TL work',
  gss_bay: 'GSS bay',
  piling: 'Piling',
  panel: 'Panel',
  module_work: 'Module',
  inverter: 'Inverter',
  material: 'Material',
};

export const APPROVAL_KINDS = [
  'DISCOM connectivity',
  'CEIG / Electrical inspector',
  'Net metering',
  'Subsidy',
  'Land / revenue',
  'Pollution / environment',
  'Other',
];
