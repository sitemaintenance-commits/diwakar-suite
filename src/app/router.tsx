import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { RequireAuth, RequirePermission } from '@/auth/guards';
import type { PermAction } from '@/lib/types';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ForbiddenPage, ModuleFallbackPage } from '@/pages/StatusPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { UsersPage } from '@/features/admin/users/UsersPage';
import { RolesPage } from '@/features/admin/roles/RolesPage';
import { SitesPage } from '@/features/admin/sites/SitesPage';
import { AuditLogPage } from '@/features/admin/audit/AuditLogPage';
import { ModulesPage } from '@/features/admin/modules/ModulesPage';
import { SettingsPage } from '@/features/admin/settings/SettingsPage';
import { ImportPage } from '@/features/admin/import/ImportPage';
import { DepartmentsPage } from '@/features/hr/org/DepartmentsPage';
import { AttendancePage, EmployeesPage, LeavePage, PerformancePage, TasksPage } from '@/features/hr/pages';
import { DailyWorkPage } from '@/features/hr/worklog/DailyWorkPage';
import { ScorecardPage } from '@/features/hr/worklog/ScorecardPage';
import { DailyReportsPage, ManagementReviewPage, ReviewSummaryPage } from '@/features/daily/pages';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { LeadsPage } from '@/features/crm/leads/LeadsPage';
import { TendersPage } from '@/features/crm/tenders/TendersPage';
import { TenderDetailPage } from '@/features/crm/tenders/TenderDetailPage';
import { QuotationsPage } from '@/features/crm/quotations/QuotationsPage';
import { QuotationFormPage } from '@/features/crm/quotations/QuotationFormPage';
import { QuotationDetailPage } from '@/features/crm/quotations/QuotationDetailPage';
import { FollowUpsPage } from '@/features/crm/followups/FollowUpsPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { VendorsPage } from '@/features/projects/VendorsPage';
import { SolarSitesPage } from '@/features/om/sites/SolarSitesPage';
import { DailyEntryPage } from '@/features/om/entry/DailyEntryPage';
import { MonitorPage } from '@/features/om/monitor/MonitorPage';
import { GenerationPage } from '@/features/om/generation/GenerationPage';
import { TicketsPage } from '@/features/om/tickets/TicketsPage';
import { MaintenancePage } from '@/features/om/maintenance/MaintenancePage';
import { SiteOperationsPage } from '@/features/om/operations/SiteOperationsPage';
import { TeamPerformancePage } from '@/features/om/performance/TeamPerformancePage';
import { SiteTeamsPage } from '@/features/om/team/SiteTeamsPage';
import { AnalyticsPage } from '@/features/om/analytics/AnalyticsPage';

/** Wrap a page in its module permission gate. */
const guard = (module: string, element: React.ReactNode, action: PermAction = 'view') => (
  <RequirePermission module={module} action={action}>
    {element}
  </RequirePermission>
);

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/accept-invite', element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: guard('dashboard', <DashboardPage />) },
      { path: 'profile', element: <ProfilePage /> },
      { path: '403', element: <ForbiddenPage /> },

      // CRM & Tenders
      {
        path: 'crm',
        element: <Outlet />,
        children: [
          { path: 'leads', element: guard('crm.leads', <LeadsPage />) },
          { path: 'tenders', element: guard('crm.tenders', <TendersPage />) },
          { path: 'tenders/:id', element: guard('crm.tenders', <TenderDetailPage />) },
          { path: 'quotations', element: guard('crm.quotations', <QuotationsPage />) },
          { path: 'quotations/new', element: guard('crm.quotations', <QuotationFormPage />, 'create') },
          { path: 'quotations/:id', element: guard('crm.quotations', <QuotationDetailPage />) },
          { path: 'quotations/:id/edit', element: guard('crm.quotations', <QuotationFormPage />, 'edit') },
          { path: 'follow-ups', element: guard('crm.followups', <FollowUpsPage />) },
        ],
      },

      // Projects (Phase 3)
      {
        path: 'projects',
        element: <Outlet />,
        children: [
          { index: true, element: guard('projects.projects', <ProjectsPage />) },
          { path: 'vendors', element: guard('projects.vendors', <VendorsPage />) },
          { path: ':id', element: guard('projects.projects', <ProjectDetailPage />) },
        ],
      },

      // Operations (O&M / solar)
      {
        path: 'operations',
        element: <Outlet />,
        children: [
          { index: true, element: <Navigate to="monitor" replace /> },
          { path: 'daily-entry', element: guard('om.daily_entry', <DailyEntryPage />) },
          { path: 'solar-sites', element: guard('om.sites', <SolarSitesPage />) },
          { path: 'monitor', element: guard('om.monitor', <MonitorPage />) },
          { path: 'analytics', element: guard('om.analytics', <AnalyticsPage />) },
          { path: 'generation', element: guard('om.generation', <GenerationPage />) },
          { path: 'maintenance', element: guard('om.maintenance', <MaintenancePage />) },
          { path: 'tickets', element: guard('om.tickets', <TicketsPage />) },
          { path: 'site-operations', element: guard('om.operations', <SiteOperationsPage />) },
          { path: 'team-performance', element: guard('om.performance', <TeamPerformancePage />) },
          { path: 'site-teams', element: guard('om.team', <SiteTeamsPage />) },
        ],
      },

      // Daily Review — its own section: a company-wide round across all
      // six departments, only one of which is HR.
      {
        path: 'daily-review',
        element: <Outlet />,
        children: [
          { index: true, element: <Navigate to="reports" replace /> },
          { path: 'reports', element: guard('daily.reports', <DailyReportsPage />) },
          { path: 'summary', element: guard('daily.summary', <ReviewSummaryPage />) },
          { path: 'management', element: guard('daily.review', <ManagementReviewPage />) },
        ],
      },

      // Analytics
      {
        path: 'reports',
        element: (
          <RequirePermission anyOf={['reports.crm', 'reports.projects', 'reports.om', 'reports.generation', 'reports.hr', 'reports.daily']}>
            <ReportsPage />
          </RequirePermission>
        ),
      },

      // Administration
      {
        path: 'admin',
        element: <Outlet />,
        children: [
          { path: 'users', element: guard('admin.users', <UsersPage />) },
          { path: 'roles', element: guard('admin.roles', <RolesPage />) },
          { path: 'modules', element: guard('admin.modules', <ModulesPage />) },
          { path: 'sites', element: guard('admin.sites', <SitesPage />) },
          { path: 'audit-log', element: guard('admin.audit', <AuditLogPage />) },
          { path: 'settings', element: guard('admin.settings', <SettingsPage />) },
          { path: 'import', element: guard('admin.import', <ImportPage />) },
        ],
      },

      // HR & Performance
      {
        path: 'hr',
        element: <Outlet />,
        children: [
          { path: 'employees', element: guard('hr.employees', <EmployeesPage />) },
          { path: 'daily-work', element: guard('hr.worklog', <DailyWorkPage />) },
          { path: 'attendance', element: guard('hr.attendance', <AttendancePage />) },
          { path: 'scorecard', element: guard('hr.scorecard', <ScorecardPage />) },
          { path: 'performance', element: guard('hr.performance', <PerformancePage />) },
          { path: 'leave', element: guard('hr.leave', <LeavePage />) },
          { path: 'tasks', element: guard('tasks', <TasksPage />) },
          { path: 'departments', element: guard('hr.org', <DepartmentsPage />) },
          // Daily Review moved out of HR; keep the old paths working.
          { path: 'daily-reports', element: <Navigate to="/daily-review/reports" replace /> },
          { path: 'review-summary', element: <Navigate to="/daily-review/summary" replace /> },
          { path: 'management-review', element: <Navigate to="/daily-review/management" replace /> },
        ],
      },

      // Everything else: 403 for known modules without permission,
      // "coming soon" for unreleased modules, otherwise 404.
      { path: '*', element: <ModuleFallbackPage /> },
    ],
  },
]);
