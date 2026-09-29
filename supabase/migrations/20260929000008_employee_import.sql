-- =====================================================================
-- IMPORT THE HR SYSTEM'S EMPLOYEE MASTER
--
-- HR keeps the official employee list in its HR system and exports it as
-- "Employee Master Details" (Employee Bulk Mail.xlsx): employee number,
-- name, e-mail, date of birth, gender, mobile, location, legal entity,
-- department, job title, date joined, employment status and exit date.
--
-- The file is uploaded on the Employees page; nothing personal is kept in
-- this repository. import_employees() previews first (p_apply = false)
-- and writes only when HR confirms.
--
--   * Matched by employee number, then by name (or a known alias).
--   * An existing employee only has BLANKS filled. The suite's department
--     and designation come from the PMS forms people file every day, so
--     where the HR sheet says something else it is reported, not changed.
--   * Someone new is added, with the sheet's department and job title
--     mapped onto the suite's departments (its spellings vary: "Opreation
--     & Maintenance", "Opretion and Maintenace" ...).
--   * A different spelling of a name is kept as an alias, so imported
--     forms keep matching.
--   * An exit date, or a status other than Working, makes them inactive.
--   * Date of birth and gender are private HR data: written only with
--     hr.employees_private EDIT.
-- =====================================================================

alter table public.employees
  add column if not exists work_location text,
  add column if not exists legal_entity text;
comment on column public.employees.work_location is 'Where the employee works: Head Office or a plant, as the HR system records it.';
comment on column public.employees.legal_entity is 'The company that employs them, as the HR system records it.';

alter table public.employee_private
  add column if not exists gender text;

/** A job title as the HR sheet types it, tidied: spacing and the common misspellings. */
create or replace function app.clean_job_title(p_title text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'),
      'Procrument', 'Procurement', 'gi'),
      'Logiscitcs', 'Logistics', 'gi'),
      '\mPoject\M', 'Project', 'gi'),
      '\mSenieor\M', 'Senior', 'gi'),
      'Maintenace', 'Maintenance', 'gi'),
      -- "Technician Bassi": the plant belongs in the location, not the title.
      '^Technician\s+[A-Z][a-z]+$', 'Technician')), '');
$$;

/** The suite department for the HR sheet's department and job title. */
create or replace function app.hr_sheet_department(p_department text, p_title text)
returns uuid
language sql stable
set search_path = ''
as $$
  with k as (select lower(coalesce(p_department, '')) as d, lower(coalesce(p_title, '')) as t)
  select d.id from public.departments d, k
  where d.name = case
    when k.t ~ '\m(hr|human)' or k.d ~ '^hr\M' then 'HR'
    when k.t ~ 'security' then 'Security'
    when k.t ~ 'tender' then 'Tender'
    when k.t ~ 'social media' then 'Marketing & Social Media'
    when k.t ~ 'land|legal' or k.d ~ 'land|legal' then 'Land & Legal'
    when k.t ~ 'design' then 'Design & Engineering'
    when k.t ~ 'procur|procrum|logist' or k.d ~ 'procur|procrum' then 'Procurement & Stores'
    when k.t ~ 'account|cfo|finance' or k.d ~ 'account|finance' then 'Accounts & Finance'
    when k.t ~ 'o&m|maint|mis' or k.d ~ 'op(r|e)|maint' then 'O&M / Service'
    when k.d ~ 'project' then 'Projects & Installation'
    else 'Admin'
  end
  limit 1;
$$;

create or replace function public.import_employees(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_private boolean := app.has_perm('hr.employees_private', 'edit');
  r jsonb;
  e public.employees;
  p public.employee_private;
  v_code text; v_name text; v_email text; v_phone text; v_location text; v_entity text;
  v_title text; v_joined date; v_dob date; v_gender text; v_active boolean;
  v_dept uuid; v_desig uuid; v_digits text;
  v_fields text[];
  v_added jsonb := '[]'; v_updated jsonb := '[]'; v_diff jsonb := '[]'; v_skipped jsonb := '[]';
  v_unchanged int := 0;
begin
  if not (app.has_perm('hr.employees', 'create') and app.has_perm('hr.employees', 'edit')) then
    raise exception 'Access denied: hr.employees CREATE and EDIT permission required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Rows must be a list.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := nullif(upper(btrim(r->>'code')), '');
    v_name := nullif(initcap(regexp_replace(btrim(coalesce(r->>'name', '')), '\s+', ' ', 'g')), '');
    if v_code is null or v_name is null then
      v_skipped := v_skipped || jsonb_build_object('code', v_code, 'name', v_name, 'reason', 'No employee number or name');
      continue;
    end if;
    v_email := nullif(lower(btrim(r->>'email')), '');
    v_digits := regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g');
    v_phone := case when length(v_digits) = 12 and v_digits like '91%' then '+91 ' || right(v_digits, 10)
                    when length(v_digits) = 10 then '+91 ' || v_digits
                    else nullif(btrim(r->>'phone'), '') end;
    v_location := nullif(regexp_replace(btrim(coalesce(r->>'location', '')), '[\s,]*(Project)?[\s,]*$', '', 'i'), '');
    v_entity := nullif(btrim(r->>'legal_entity'), '');
    v_title := app.clean_job_title(r->>'job_title');
    v_joined := nullif(r->>'joined', '')::date;
    v_dob := nullif(r->>'dob', '')::date;
    v_gender := nullif(initcap(btrim(r->>'gender')), '');
    v_active := nullif(r->>'exit_date', '') is null
                and coalesce(nullif(lower(btrim(r->>'status')), ''), 'working') = 'working';

    select * into e from public.employees x where x.deleted_at is null and upper(x.employee_code) = v_code;
    if not found then
      select * into e from public.employees x where x.id = app.employee_by_name(v_name);
      if found and e.employee_code not like 'DS-%' then
        -- The same name under another real employee number: HR must decide.
        v_skipped := v_skipped || jsonb_build_object('code', v_code, 'name', v_name,
          'reason', format('%s already has this name as %s', e.full_name, e.employee_code));
        continue;
      end if;
    end if;

    if e.id is null then
      -- ------------------------------------------------------ new employee
      v_dept := app.hr_sheet_department(r->>'department', v_title);
      select id into v_desig from public.designations where lower(name) = lower(v_title);
      if p_apply then
        if v_desig is null and v_title is not null then
          insert into public.designations (name, department_id) values (v_title, v_dept)
          on conflict (name) do nothing;
          select id into v_desig from public.designations where lower(name) = lower(v_title);
        end if;
        insert into public.employees (employee_code, full_name, email, phone, department_id, designation_id,
                                      joining_date, work_location, legal_entity, status)
        values (v_code, v_name, v_email, v_phone, v_dept, v_desig, v_joined, v_location, v_entity,
                case when v_active then 'active' else 'inactive' end::public.record_status)
        returning * into e;
        if v_private and (v_dob is not null or v_gender is not null) then
          insert into public.employee_private (employee_id, date_of_birth, gender) values (e.id, v_dob, v_gender)
          on conflict (employee_id) do nothing;
        end if;
      end if;
      v_added := v_added || jsonb_build_object('code', v_code, 'name', v_name,
        'department', (select name from public.departments where id = v_dept),
        'designation', v_title, 'location', v_location);
      e := null;
      continue;
    end if;

    -- -------------------------------------------------- existing employee
    v_fields := '{}';
    if e.employee_code like 'DS-%' and e.employee_code <> v_code then v_fields := array_append(v_fields, 'employee number'); end if;
    if e.email is null and v_email is not null then v_fields := array_append(v_fields, 'email'); end if;
    if e.phone is null and v_phone is not null then v_fields := array_append(v_fields, 'mobile'); end if;
    if e.joining_date is null and v_joined is not null then v_fields := array_append(v_fields, 'date joined'); end if;
    if e.work_location is null and v_location is not null then v_fields := array_append(v_fields, 'location'); end if;
    if e.legal_entity is null and v_entity is not null then v_fields := array_append(v_fields, 'legal entity'); end if;
    if e.department_id is null then v_fields := array_append(v_fields, 'department'); end if;
    if e.designation_id is null and v_title is not null then v_fields := array_append(v_fields, 'designation'); end if;
    if e.status = 'active' and not v_active then v_fields := array_append(v_fields, 'inactive (left)'); end if;
    if app.name_key(e.full_name) <> app.name_key(v_name)
       and not exists (select 1 from public.employee_aliases a where a.alias_key = app.name_key(v_name)) then
      v_fields := array_append(v_fields, 'name spelling kept as alias');
    end if;
    if v_private then
      select * into p from public.employee_private where employee_id = e.id;
      if (p.date_of_birth is null and v_dob is not null) then v_fields := array_append(v_fields, 'date of birth'); end if;
      if (p.gender is null and v_gender is not null) then v_fields := array_append(v_fields, 'gender'); end if;
    end if;

    -- What the sheet says differently is shown, not written.
    if e.department_id is distinct from app.hr_sheet_department(r->>'department', v_title) and e.department_id is not null then
      v_diff := v_diff || jsonb_build_object('code', e.employee_code, 'name', e.full_name, 'field', 'Department',
        'suite', (select name from public.departments where id = e.department_id),
        'sheet', coalesce((select name from public.departments where id = app.hr_sheet_department(r->>'department', v_title)), r->>'department'));
    end if;
    if e.designation_id is not null and v_title is not null
       and lower(v_title) <> lower(coalesce((select name from public.designations where id = e.designation_id), '')) then
      v_diff := v_diff || jsonb_build_object('code', e.employee_code, 'name', e.full_name, 'field', 'Designation',
        'suite', (select name from public.designations where id = e.designation_id), 'sheet', v_title);
    end if;

    if cardinality(v_fields) = 0 then
      v_unchanged := v_unchanged + 1;
    else
      v_updated := v_updated || jsonb_build_object('code', v_code, 'name', e.full_name, 'fields', to_jsonb(v_fields));
      if p_apply then
        if e.designation_id is null and v_title is not null then
          insert into public.designations (name, department_id)
          values (v_title, coalesce(e.department_id, app.hr_sheet_department(r->>'department', v_title)))
          on conflict (name) do nothing;
        end if;
        update public.employees x set
          employee_code = case when x.employee_code like 'DS-%' then v_code else x.employee_code end,
          email = coalesce(x.email, v_email),
          phone = coalesce(x.phone, v_phone),
          joining_date = coalesce(x.joining_date, v_joined),
          work_location = coalesce(x.work_location, v_location),
          legal_entity = coalesce(x.legal_entity, v_entity),
          department_id = coalesce(x.department_id, app.hr_sheet_department(r->>'department', v_title)),
          designation_id = coalesce(x.designation_id, (select id from public.designations where lower(name) = lower(v_title))),
          status = case when not v_active then 'inactive'::public.record_status else x.status end,
          updated_at = now()
        where x.id = e.id;
        if app.name_key(e.full_name) <> app.name_key(v_name) then
          insert into public.employee_aliases (employee_id, alias) values (e.id, v_name)
          on conflict (alias_key) do nothing;
        end if;
        if v_private and (v_dob is not null or v_gender is not null) then
          insert into public.employee_private (employee_id, date_of_birth, gender) values (e.id, v_dob, v_gender)
          on conflict (employee_id) do update
            set date_of_birth = coalesce(public.employee_private.date_of_birth, excluded.date_of_birth),
                gender = coalesce(public.employee_private.gender, excluded.gender),
                updated_at = now();
        end if;
      end if;
    end if;
    e := null;
  end loop;

  return jsonb_build_object(
    'applied', p_apply,
    'private_fields', v_private,
    'total', jsonb_array_length(p_rows),
    'added', v_added,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'differences', v_diff,
    'skipped', v_skipped);
end;
$$;

grant execute on function public.import_employees(jsonb, boolean) to authenticated;
revoke execute on function public.import_employees(jsonb, boolean) from anon, public;
