-- =====================================================================
-- Diwakar Solar Management Suite — foundation
-- Extensions, private "app" schema, enums and shared trigger helpers.
-- =====================================================================

create extension if not exists citext;
create extension if not exists pg_trgm;

-- Private schema for authorization helpers. It is NOT exposed through the
-- Data API; RLS policies call these functions internally.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums (all phases; created once so later migrations only add tables)
-- ---------------------------------------------------------------------
create type public.perm_action as enum ('view','create','edit','delete','export','approve','assign');
create type public.perm_scope  as enum ('own','team','all');           -- ordered: own < team < all
create type public.user_status as enum ('invited','active','inactive');
create type public.record_status as enum ('active','inactive');
create type public.lead_status as enum ('new','contacted','interested','quoted','converted','lost');
create type public.quotation_status as enum ('draft','sent','under_discussion','approved','rejected','expired');
create type public.followup_status as enum ('scheduled','done','missed','cancelled');
create type public.project_status as enum ('planning','active','on_hold','completed','cancelled');
create type public.ticket_status as enum ('open','assigned','in_progress','resolved','closed');
create type public.priority as enum ('low','medium','high','critical');
create type public.task_status as enum ('todo','in_progress','blocked','done','cancelled');
create type public.task_module as enum ('crm','projects','om','hr','daily_review','general');
create type public.attendance_status as enum ('present','absent','half_day','leave','holiday','week_off');
create type public.leave_status as enum ('pending','approved','rejected','cancelled');
create type public.review_status as enum ('draft','self_review','manager_review','completed');
create type public.daily_report_status as enum ('draft','submitted','reviewed','returned');
create type public.daily_health as enum ('on_track','needs_attention','critical');

-- ---------------------------------------------------------------------
-- Row touch trigger: maintains updated_at/updated_by and keeps
-- created_at/created_by immutable on UPDATE.
-- ---------------------------------------------------------------------
create or replace function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_j jsonb := to_jsonb(old);
  patch jsonb := jsonb_build_object('updated_at', now());
begin
  if old_j ? 'created_at' then
    patch := patch || jsonb_build_object('created_at', old_j->'created_at');
  end if;
  if old_j ? 'created_by' then
    patch := patch || jsonb_build_object('created_by', old_j->'created_by');
  end if;
  if old_j ? 'updated_by' then
    patch := patch || jsonb_build_object('updated_by', auth.uid());
  end if;
  return jsonb_populate_record(new, patch);
end;
$$;
