import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Building2, CalendarDays, IdCard, Mail, MapPin, Phone, ShieldCheck, Clock } from 'lucide-react';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, UserAvatar, UserStatusBadge } from '@/components/common';
import { useCan } from '@/auth/AccessProvider';
import { fmtDate, fmtDateTime, fmtRelative, titleCase } from '@/lib/format';
import { useAudit, useUser } from '@/features/admin/api';

export function UserDetailSheet({ userId, onOpenChange }: { userId: string | null; onOpenChange: (o: boolean) => void }) {
  const { data: user, isLoading } = useUser(userId);
  const audit = useCan('admin.audit');
  const activity = useAudit(
    { search: '', actorId: 'all', module: 'all', action: 'all', from: '', to: '', entityId: userId ?? '', page: 0, pageSize: 25 },
    Boolean(userId) && audit.view,
  );

  return (
    <Dialog open={Boolean(userId)} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <DialogPrimitive.Title className="sr-only">User profile</DialogPrimitive.Title>
        {isLoading || !user ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="border-b p-6">
              <div className="flex items-center gap-4">
                <UserAvatar name={user.full_name} path={user.avatar_path} className="h-16 w-16 text-lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{user.full_name}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {user.employees?.designations?.name ?? 'No designation'}
                    {user.employees?.departments?.name ? ` · ${user.employees.departments.name}` : ''}
                  </p>
                  <div className="mt-2">
                    <UserStatusBadge status={user.status} />
                  </div>
                </div>
              </div>
            </div>

            <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
              <div className="px-6 pt-4">
                <TabsList>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="access">Access</TabsTrigger>
                  {audit.view && <TabsTrigger value="activity">Activity</TabsTrigger>}
                </TabsList>
              </div>

              <TabsContent value="profile" className="flex-1 overflow-y-auto px-6 pb-6">
                <dl className="grid gap-4 text-sm">
                  <Row icon={Mail} label="Email" value={user.email} />
                  <Row icon={Phone} label="Phone" value={user.phone} />
                  <Row icon={IdCard} label="Employee ID" value={user.employees?.employee_code} />
                  <Row icon={Building2} label="Department" value={user.employees?.departments?.name} />
                  <Row icon={CalendarDays} label="Joining date" value={fmtDate(user.employees?.joining_date, '')} />
                  <Row icon={CalendarDays} label="Created" value={fmtDateTime(user.created_at)} />
                  <Row icon={Clock} label="Last login" value={user.last_login_at ? `${fmtDateTime(user.last_login_at)} (${fmtRelative(user.last_login_at)})` : 'Never'} />
                </dl>
              </TabsContent>

              <TabsContent value="access" className="flex-1 overflow-y-auto px-6 pb-6">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Roles
                </p>
                <div className="flex flex-wrap gap-2">
                  {user.user_roles.length ? (
                    user.user_roles.map((r) => (
                      <Badge key={r.role_id} variant={r.roles?.is_system ? 'default' : 'secondary'}>
                        {r.roles?.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No roles — this user cannot access any module.</span>
                  )}
                </div>
                <p className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-primary" /> Sites
                </p>
                {user.all_sites ? (
                  <Badge variant="info">All sites (including future sites)</Badge>
                ) : user.user_sites.length ? (
                  <div className="flex flex-wrap gap-2">
                    {user.user_sites.map((s) => (
                      <Badge key={s.site_id} variant="outline">
                        {s.sites?.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No sites assigned.</span>
                )}
              </TabsContent>

              {audit.view && (
                <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 pb-6">
                  {activity.data?.rows.length ? (
                    <ol className="relative space-y-4 border-l pl-5">
                      {activity.data.rows.map((a) => (
                        <li key={a.id} className="text-sm">
                          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/70" />
                          <p className="font-medium">{a.summary ?? titleCase(a.action)}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDateTime(a.occurred_at)} · {a.actor_id === user.id ? 'by this user' : `by ${a.actor_name ?? 'system'}`}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState icon={Clock} title="No activity yet" />
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-medium">{value || '—'}</dd>
      </div>
    </div>
  );
}
