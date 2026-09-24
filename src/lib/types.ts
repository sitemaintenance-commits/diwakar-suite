// Domain types for the Phase 1 schema (supabase/migrations).
// Once a Supabase project is linked these can be complemented by
// `npx supabase gen types typescript --linked > src/lib/database.types.ts`.

export type BadgeTone = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export const PERM_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve', 'assign'] as const;
export type PermAction = (typeof PERM_ACTIONS)[number];
export type PermScope = 'own' | 'team' | 'all';
export type UserStatus = 'invited' | 'active' | 'inactive';
export type RecordStatus = 'active' | 'inactive';

export interface AccessModule {
  key: string;
  label: string;
  route: string | null;
  icon: string | null;
  group: string;
  sort_order: number;
  is_enabled: boolean;
  show_in_nav: boolean;
  phase: number;
}

export interface AccessGroup {
  key: string;
  label: string;
  icon: string | null;
  sort_order: number;
}

export interface MyProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_path: string | null;
  status: UserStatus;
  all_sites: boolean;
  last_login_at: string | null;
  employee_id: string | null;
  employee_code: string | null;
  department: string | null;
  designation: string | null;
}

export interface MyAccess {
  profile: MyProfile | null;
  is_super_admin: boolean;
  roles: { id: string; key: string; name: string }[];
  permissions: Record<string, { actions: PermAction[]; scope: PermScope }>;
  site_ids: string[];
  groups: AccessGroup[];
  modules: AccessModule[];
  settings: Record<string, unknown>;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ModuleRow {
  id: string;
  group_id: string;
  key: string;
  label: string;
  description: string | null;
  route: string | null;
  icon: string | null;
  sort_order: number;
  supported_actions: PermAction[];
  supports_scope: boolean;
  is_site_scoped: boolean;
  show_in_nav: boolean;
  is_enabled: boolean;
  phase: number;
  module_groups?: { key: string; label: string; sort_order: number } | null;
}

export interface RolePermission {
  role_id: string;
  module_id: string;
  action: PermAction;
  scope: PermScope;
}

export interface Site {
  id: string;
  code: string | null;
  name: string;
  location: string | null;
  district: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_kwp: number | string | null;
  status: RecordStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name: string;
  code: string | null;
  color: string;
  status: RecordStatus;
  head_employee_id: string | null;
}

export interface Designation {
  id: string;
  name: string;
  department_id: string | null;
  status: RecordStatus;
}

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  department_id: string | null;
  designation_id: string | null;
  reporting_manager_id: string | null;
  joining_date: string | null;
  status: RecordStatus;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_path: string | null;
  status: UserStatus;
  all_sites: boolean;
  last_login_at: string | null;
  created_at: string;
  employee_id: string | null;
  employees: (Pick<Employee, 'id' | 'employee_code' | 'department_id' | 'designation_id' | 'joining_date' | 'reporting_manager_id'> & {
    departments: { name: string } | null;
    designations: { name: string } | null;
  }) | null;
  user_roles: { role_id: string; roles: { id: string; name: string; key: string; is_system: boolean } | null }[];
  user_sites: { site_id: string; sites: { id: string; name: string } | null }[];
}

export interface AuditLog {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  module_key: string | null;
  entity_table: string | null;
  entity_id: string | null;
  summary: string | null;
  changes: unknown;
  user_agent: string | null;
}

export interface Person {
  id: string;
  full_name: string;
  email: string;
  avatar_path: string | null;
  designation: string | null;
  department: string | null;
}

// ---------------------------------------------------------------- CRM (Phase 2)
export type TenderStatus =
  | 'identified' | 'evaluating' | 'preparing' | 'submitted'
  | 'technical_qualified' | 'technical_disqualified' | 'financial_opened'
  | 'won' | 'lost' | 'cancelled';
export type EmdStatus = 'not_required' | 'pending' | 'submitted' | 'refund_requested' | 'refunded' | 'forfeited';
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'quoted' | 'converted' | 'lost';
export type QuotationStatus = 'draft' | 'sent' | 'under_discussion' | 'approved' | 'rejected' | 'expired';
export type FollowUpStatus = 'scheduled' | 'done' | 'missed' | 'cancelled';
export type FollowUpEntity = 'lead' | 'tender' | 'quotation';

export interface Lead {
  id: string;
  lead_code: string;
  company: string | null;
  contact_person: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  district: string | null;
  state: string | null;
  source: string | null;
  status: LeadStatus;
  requirement: string | null;
  capacity_kwp: number | string | null;
  lead_value: number | string;
  assigned_to: string | null;
  next_follow_up: string | null;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Tender {
  id: string;
  tender_code: string;
  reference_no: string | null;
  title: string;
  authority: string | null;
  portal: string | null;
  portal_url: string | null;
  tender_type: string;
  work_type: string | null;
  state: string | null;
  district: string | null;
  location: string | null;
  site_id: string | null;
  capacity_kwp: number | string | null;
  estimated_value: number | string;
  tender_fee: number | string;
  tender_fee_paid: boolean;
  emd_amount: number | string;
  emd_mode: string | null;
  emd_status: EmdStatus;
  emd_submitted_on: string | null;
  emd_valid_until: string | null;
  emd_refunded_on: string | null;
  published_on: string | null;
  prebid_at: string | null;
  clarification_due: string | null;
  submission_due_at: string | null;
  technical_opening_at: string | null;
  financial_opening_at: string | null;
  status: TenderStatus;
  bid_decision: string | null;
  bid_decision_note: string | null;
  bid_approved_by: string | null;
  bid_approved_at: string | null;
  submitted_at: string | null;
  our_bid_value: number | string | null;
  our_rank: number | null;
  l1_value: number | string | null;
  l1_bidder: string | null;
  total_bidders: number | null;
  result_declared_on: string | null;
  lost_reason: string | null;
  loa_no: string | null;
  loa_date: string | null;
  work_order_no: string | null;
  contract_value: number | string | null;
  completion_days: number | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  sites?: { id: string; name: string } | null;
}

export interface QuotationItem {
  id?: string;
  quotation_id?: string;
  line_no?: number;
  description: string;
  hsn_sac: string | null;
  unit: string | null;
  quantity: number | string;
  rate: number | string;
  tax_rate: number | string;
  amount?: number | string;
}

export interface Quotation {
  id: string;
  quotation_no: string;
  tender_id: string | null;
  lead_id: string | null;
  client_name: string | null;
  client_address: string | null;
  subject: string | null;
  quote_date: string;
  valid_until: string | null;
  status: QuotationStatus;
  subtotal: number | string;
  tax_total: number | string;
  grand_total: number | string;
  terms: string | null;
  notes: string | null;
  revision: number;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  assigned_to: string | null;
  created_at: string;
  created_by: string | null;
  tenders?: { id: string; tender_code: string; title: string } | null;
  leads?: { id: string; lead_code: string; contact_person: string; company: string | null } | null;
  quotation_items?: QuotationItem[];
}

export interface FollowUp {
  id: string;
  entity_type: FollowUpEntity;
  lead_id: string | null;
  tender_id: string | null;
  quotation_id: string | null;
  follow_up_at: string;
  type: string;
  subject: string | null;
  notes: string | null;
  outcome: string | null;
  status: FollowUpStatus;
  next_follow_up_at: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  leads?: { id: string; lead_code: string; contact_person: string; company: string | null } | null;
  tenders?: { id: string; tender_code: string; title: string } | null;
}

export interface DocumentRow {
  id: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  category: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

// ---------------------------------------------------------------- O&M (Phase 4)
export type EquipmentType =
  | 'inverter' | 'module' | 'transformer' | 'scb' | 'acdb' | 'dcdb' | 'ups' | 'meter' | 'cctv' | 'structure' | 'other';
export type TicketStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type MaintenanceType = 'preventive' | 'corrective' | 'cleaning' | 'inspection' | 'calibration';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface SolarSite {
  site_id: string;
  capacity_dc_kwp: number | string;
  capacity_ac_kw: number | string;
  commissioning_date: string | null;
  module_make: string | null;
  module_count: number | null;
  inverter_make: string | null;
  inverter_count: number | null;
  grid_connection: string | null;
  discom: string | null;
  consumer_no: string | null;
  tariff_per_kwh: number | string | null;
  expected_yield: number | string | null;
  monitoring_source: string;
  om_lead_id: string | null;
  om_start_date: string | null;
  om_end_date: string | null;
  notes: string | null;
  sites?: { id: string; name: string; code: string | null; location: string | null; district: string | null; state: string | null; status: string; capacity_kwp: number | string } | null;
}

export interface Equipment {
  id: string;
  site_id: string;
  type: EquipmentType;
  name: string;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  capacity_kw: number | string | null;
  installed_on: string | null;
  warranty_until: string | null;
  status: RecordStatus;
  notes: string | null;
}

export interface GenerationRecord {
  id: string;
  site_id: string;
  gen_date: string;
  generation_kwh: number | string;
  expected_kwh: number | string | null;
  irradiation_kwh_m2: number | string | null;
  grid_outage_hrs: number | string;
  plant_outage_hrs: number | string;
  export_kwh: number | string | null;
  import_kwh: number | string | null;
  source: string;
  remarks: string | null;
  sites?: { id: string; name: string } | null;
}

export interface Ticket {
  id: string;
  ticket_no: string;
  site_id: string;
  equipment_id: string | null;
  title: string;
  issue: string | null;
  category: string | null;
  priority: Priority;
  status: TicketStatus;
  reported_by: string | null;
  reported_at: string;
  assigned_to: string | null;
  started_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  downtime_hours: number | string | null;
  generation_loss_kwh: number | string | null;
  root_cause: string | null;
  resolution: string | null;
  remarks: string | null;
  sites?: { id: string; name: string } | null;
  equipment?: { id: string; name: string; type: string } | null;
}

export interface MaintenanceRecord {
  id: string;
  site_id: string;
  equipment_id: string | null;
  ticket_id: string | null;
  type: MaintenanceType;
  title: string;
  scheduled_date: string | null;
  done_date: string | null;
  performed_by: string | null;
  assigned_to: string | null;
  checklist: unknown;
  findings: string | null;
  status: TaskStatus;
  sites?: { id: string; name: string } | null;
  equipment?: { id: string; name: string } | null;
}

// ---------------------------------------------------------------- HR (Phase 5)
export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'week_off';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ReviewStatus = 'draft' | 'self_review' | 'manager_review' | 'completed';
export type TaskModule = 'crm' | 'projects' | 'om' | 'hr' | 'daily_review' | 'general';

export interface EmployeeRow extends Employee {
  departments?: { id: string; name: string } | null;
  designations?: { id: string; name: string } | null;
}

export interface Attendance {
  id: string;
  employee_id: string;
  att_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  work_hours: number | string | null;
  site_id: string | null;
  remarks: string | null;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  days: number | string;
  reason: string | null;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  employees?: { id: string; full_name: string; employee_code: string } | null;
}

export interface PerformanceReview {
  id: string;
  employee_id: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  reviewer_id: string | null;
  overall_rating: number | string | null;
  manager_comments: string | null;
  employee_comments: string | null;
  status: ReviewStatus;
  completed_at: string | null;
  created_at: string;
  employees?: { id: string; full_name: string; employee_code: string } | null;
}

export interface PerformanceGoal {
  id: string;
  review_id: string;
  sort_order: number;
  title: string;
  kpi: string | null;
  target: string | null;
  actual: string | null;
  weight: number | string;
  self_rating: number | string | null;
  manager_rating: number | string | null;
  comments: string | null;
}

export interface Task {
  id: string;
  task_code: string;
  title: string;
  description: string | null;
  module: TaskModule;
  assigned_to: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  site_id: string | null;
  tender_id: string | null;
  lead_id: string | null;
  ticket_id: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  sites?: { id: string; name: string } | null;
}
