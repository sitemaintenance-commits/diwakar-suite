// The project tabs (plan, approvals, materials, bills, client money) also
// run across every project, as their own pages under Projects -- the way the
// old Project CRM listed them. In that mode a tab shows a Site column and
// asks which site a new row belongs to.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';

/** Pass as projectId to show every project. */
export const ALL_PROJECTS = '*';

export function useProjectList(enabled = true) {
  return useQuery({
    queryKey: ['project-list'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').is('deleted_at', null).order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export function usePortfolio(projectId: string) {
  const all = projectId === ALL_PROJECTS;
  const projects = useProjectList(all);
  const [pick, setPick] = useState('');
  const list = projects.data ?? [];
  return {
    all,
    /** The project a new row goes to. */
    target: all ? pick : projectId,
    pick,
    setPick,
    projects: list,
    name: (id: string) => list.find((p) => p.id === id)?.name ?? '—',
  };
}
export type Portfolio = ReturnType<typeof usePortfolio>;

/** The Site field of an add dialog; nothing on a single project's page. */
export function SitePicker({ portfolio, className = 'sm:col-span-2' }: { portfolio: Portfolio; className?: string }) {
  if (!portfolio.all) return null;
  return (
    <Field label="Site" required className={className}>
      <FilterSelect value={portfolio.pick} onChange={portfolio.setPick} placeholder="Choose the site"
        options={portfolio.projects.map((p) => [p.id, p.name] as [string, string])} />
    </Field>
  );
}
