-- =====================================================================
-- EMPLOYEE LIST CLEAN-UP, AND NO MORE DUPLICATES FROM USER MANAGEMENT
--
--   * Shivdatt Singh (DS-1001, from the PMS sheets) and Shiv Dutt Kushwah
--     (DRIPL_1044, from the HR sheet) are removed from the employee list.
--     They are marked removed, not erased: DS-1001's sheets and attendance
--     stay in the database, out of sight.
--   * Rajpal Singh was on the list three times: DRIPL_1093 from the HR sheet
--     (the official record), and DS-1003 / DS-1004 made by creating his
--     login twice in User Management. His login now belongs to DRIPL_1093;
--     DS-1003 and DS-1004 are removed; the spelling used in User Management
--     is kept as an alias.
--   * Why it happened: creating a login always made a new employee. Now a
--     login whose email is already an employee's links to that employee
--     (and User Management can pick the employee outright).
--   * The HR sheet import no longer brings back someone removed here.
--   * employee_logins() gives each person's work location and the plant it
--     names, so a technician's login covers their own plant.
-- =====================================================================

-- ------------------------------------------------------------ Shivdatt
update public.employees
set status = 'inactive', deleted_at = now(), updated_at = now()
where employee_code in ('DS-1001', 'DRIPL_1044') and deleted_at is null;

-- -------------------------------------------------------------- Rajpal
do $$
declare
  v_keep uuid := (select id from public.employees where employee_code = 'DRIPL_1093' and deleted_at is null);
  v_login uuid := (select p.id from public.profiles p join public.employees e on e.id = p.employee_id
                   where e.employee_code in ('DS-1004', 'DS-1003') order by e.employee_code desc limit 1);
begin
  if v_keep is null then
    return;  -- not on this database (tests, a fresh install)
  end if;
  if v_login is not null and not exists (select 1 from public.profiles where employee_id = v_keep) then
    update public.profiles set employee_id = v_keep where id = v_login;
  end if;
  update public.employees
     set status = 'inactive', deleted_at = now(), updated_at = now()
   where employee_code in ('DS-1003', 'DS-1004') and deleted_at is null
     and not exists (select 1 from public.profiles p where p.employee_id = employees.id);
  insert into public.employee_aliases (employee_id, alias)
  values (v_keep, 'Rajpal Singh Shekhawat')
  on conflict (alias_key) do nothing;
end $$;

-- --------------------------------------------------- the HR sheet import
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

    -- Removed in the suite (a duplicate, or someone HR took off the list):
    -- the HR sheet does not bring them back.
    if exists (select 1 from public.employees x where x.deleted_at is not null and upper(x.employee_code) = v_code) then
      v_skipped := v_skipped || jsonb_build_object('code', v_code, 'name', v_name, 'reason', 'Removed from the employee list in the suite');
      continue;
    end if;
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


-- -------------------------------------- logins link to the existing employee
create or replace function public.admin_save_user(p_user_id uuid, p_data jsonb, p_is_new boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_emp uuid;
  v_emp_fields jsonb;
begin
  perform app.require_perm('admin.users', case when p_is_new then 'create' else 'edit' end::public.perm_action);

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  if app.is_super_admin(p_user_id) and not app.is_super_admin() and p_user_id <> auth.uid() then
    raise exception 'Only a Super Admin can modify another Super Admin.' using errcode = '42501';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_data->>'full_name'), ''), full_name),
         phone     = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else phone end
   where id = p_user_id;

  -- Employee record (HR master) — create or update the linked one.
  v_emp_fields := p_data - array['full_name','phone','role_ids','site_ids','all_sites','employee_id'];
  if v_emp_fields <> '{}'::jsonb or v_profile.employee_id is not null or p_is_new then
    v_emp := v_profile.employee_id;
    -- Giving a login to someone already on the employee list links that
    -- record, instead of creating a second one with a new number.
    if v_emp is null and p_is_new and nullif(p_data->>'employee_id', '') is not null then
      select e.id into v_emp from public.employees e
      where e.id = (p_data->>'employee_id')::uuid and e.deleted_at is null;
      if v_emp is null then
        raise exception 'That employee record does not exist.' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.profiles p where p.employee_id = v_emp and p.id <> p_user_id) then
        raise exception 'This employee already has a login.' using errcode = '23505';
      end if;
      update public.profiles set employee_id = v_emp where id = p_user_id;
    end if;
    -- No employee chosen, but the login's email is already an employee's
    -- (from the HR sheet) and they have no login: that is the same person.
    if v_emp is null and p_is_new and nullif(trim(p_data->>'employee_code'), '') is null then
      select e.id into v_emp from public.employees e
      where e.deleted_at is null and lower(e.email::text) = lower(v_profile.email::text)
        and not exists (select 1 from public.profiles p where p.employee_id = e.id)
      order by e.status = 'active' desc, e.created_at
      limit 1;
      if v_emp is not null then
        update public.profiles set employee_id = v_emp where id = p_user_id;
      end if;
    end if;
    if v_emp is null then
      insert into public.employees (employee_code, full_name, email, phone)
      values (coalesce(nullif(trim(p_data->>'employee_code'), ''),
                       'DS-' || nextval('public.employee_code_seq')::text),
              coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name),
              v_profile.email, nullif(trim(p_data->>'phone'), ''))
      returning id into v_emp;
      update public.profiles set employee_id = v_emp where id = p_user_id;
    end if;

    update public.employees e
       set employee_code  = coalesce(nullif(trim(p_data->>'employee_code'), ''), e.employee_code),
           full_name      = coalesce(nullif(trim(p_data->>'full_name'), ''), e.full_name),
           email          = v_profile.email,
           phone          = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else e.phone end,
           department_id  = case when p_data ? 'department_id' then nullif(p_data->>'department_id', '')::uuid else e.department_id end,
           designation_id = case when p_data ? 'designation_id' then nullif(p_data->>'designation_id', '')::uuid else e.designation_id end,
           joining_date   = case when p_data ? 'joining_date' then nullif(p_data->>'joining_date', '')::date else e.joining_date end,
           reporting_manager_id = case when p_data ? 'reporting_manager_id'
                                       then nullif(p_data->>'reporting_manager_id', '')::uuid else e.reporting_manager_id end
     where e.id = v_emp;
  end if;

  if p_data ? 'role_ids' then
    perform public.set_user_roles(p_user_id,
      array(select jsonb_array_elements_text(p_data->'role_ids')::uuid));
  end if;
  if p_data ? 'site_ids' or p_data ? 'all_sites' then
    perform public.set_user_sites(p_user_id,
      case when p_data ? 'site_ids'
           then array(select jsonb_array_elements_text(p_data->'site_ids')::uuid)
           else array(select site_id from public.user_sites where user_id = p_user_id) end,
      case when p_data ? 'all_sites' then (p_data->>'all_sites')::boolean end);
  end if;

  if p_is_new then
    perform app.write_audit('user.create', 'admin.users', 'profiles', p_user_id::text,
      'User created: ' || coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name)
      || ' <' || v_profile.email || '>');
  end if;
end;
$$;


-- --------------------------------------------- logins: work location and plant
create or replace function public.employee_logins()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_perm('admin.users', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
             'email', e.email, 'phone', e.phone, 'department', d.name,
             'work_location', e.work_location,
             -- "Budsu, Nagaur" or "Budhwara Ajmer": the plant the location starts with.
             'site_id', (select s.id from public.sites s
                         where e.work_location is not null and lower(e.work_location) like lower(s.name) || '%'
                         order by length(s.name) desc limit 1),
             'site', (select s.name from public.sites s
                      where e.work_location is not null and lower(e.work_location) like lower(s.name) || '%'
                      order by length(s.name) desc limit 1),
             'user_id', p.id, 'login_email', p.email, 'login_status', p.status,
             'last_sign_in_at', u.last_sign_in_at,
             'roles', coalesce((select jsonb_agg(r.name order by r.name)
                                from public.user_roles ur join public.roles r on r.id = ur.role_id
                                where ur.user_id = p.id), '[]'::jsonb))
           order by e.full_name)
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.profiles p on p.employee_id = e.id
    left join auth.users u on u.id = p.id
    where e.deleted_at is null and e.status = 'active'), '[]'::jsonb);
end;
$$;

