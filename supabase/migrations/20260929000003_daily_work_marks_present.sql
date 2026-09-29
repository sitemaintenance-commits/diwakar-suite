-- =====================================================================
-- FILING THE DAILY WORK SHEET MARKS YOU PRESENT
--
-- Someone who filed their working sheet for a day was at work that day.
-- So a filed sheet (submitted, reviewed or returned -- not a draft) marks
-- the employee present for that date.
--
--   * HR's own marking always wins: an existing attendance row -- absent,
--     leave, half day, holiday, week off, or present marked by hand -- is
--     never changed.
--   * The automatic mark is recognisable: attendance.source = 'daily_work'.
--     If the sheet goes back to draft or is deleted, that automatic mark
--     goes with it; a hand-made mark stays.
--   * Sheets already filed, including the imported PMS history, get the
--     same marks now.
--
-- Scoring note: attendance % is present days / days marked. Days nobody
-- marks do not count as absent, so an employee who files is shown 100%
-- present; the days they did not file still cost them through discipline
-- (days filed / working days).
-- =====================================================================

alter table public.attendance
  add column if not exists source text not null default 'manual';
comment on column public.attendance.source is
  '''manual'' when marked by HR; ''daily_work'' when marked automatically because the employee filed a Daily Work sheet.';

-- Once HR edits an automatic mark (marks the day absent, adds a note), it
-- is HR's record: it becomes 'manual' so the sheet can never remove it.
create or replace function app.attendance_edit_is_manual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is null and old.source = 'daily_work' and new.source = 'daily_work'
     and (new.status is distinct from old.status or new.remarks is distinct from old.remarks
          or new.check_in is distinct from old.check_in or new.check_out is distinct from old.check_out) then
    new.source := 'manual';
  end if;
  return new;
end;
$$;

create trigger attendance_edit_is_manual before update on public.attendance
  for each row execute function app.attendance_edit_is_manual();

create or replace function app.attendance_from_work_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_filed boolean := new.deleted_at is null and new.status <> 'draft';
begin
  if v_filed then
    insert into public.attendance (employee_id, att_date, status, source, remarks, created_by)
    values (new.employee_id, new.log_date, 'present', 'daily_work', 'Marked present: Daily Work sheet filed', auth.uid())
    on conflict (employee_id, att_date) do update
      -- Only a soft-deleted row is brought back; a live one is HR's record.
      set status = 'present', source = 'daily_work', deleted_at = null,
          remarks = 'Marked present: Daily Work sheet filed'
      where public.attendance.deleted_at is not null;
  elsif tg_op = 'UPDATE' then
    delete from public.attendance a
    where a.employee_id = old.employee_id and a.att_date = old.log_date and a.source = 'daily_work';
  end if;

  -- A sheet moved to another date or person takes its automatic mark along.
  if tg_op = 'UPDATE' and (old.log_date <> new.log_date or old.employee_id <> new.employee_id) then
    delete from public.attendance a
    where a.employee_id = old.employee_id and a.att_date = old.log_date and a.source = 'daily_work';
  end if;
  return null;
end;
$$;

create trigger attendance_from_work_log
  after insert or update of status, deleted_at, log_date, employee_id on public.work_logs
  for each row execute function app.attendance_from_work_log();

-- Sheets already filed.
insert into public.attendance (employee_id, att_date, status, source, remarks)
select w.employee_id, w.log_date, 'present', 'daily_work', 'Marked present: Daily Work sheet filed'
from public.work_logs w
where w.deleted_at is null and w.status <> 'draft'
on conflict (employee_id, att_date) do nothing;
