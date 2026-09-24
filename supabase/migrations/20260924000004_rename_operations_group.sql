-- The centralized suite now fully replaces the legacy Diwakar Solar CRM.
-- Make the replacement explicit in the main navigation.
update public.module_groups
set label = 'O&M'
where key = 'operations';
