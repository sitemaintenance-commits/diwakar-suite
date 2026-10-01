-- The Daily Review section is the Department Review: each department's
-- report of the day, reviewed by management. Its first page follows.
update public.module_groups set label = 'Department Review' where key = 'daily_review';
update public.modules set label = 'Department Reports' where key = 'daily.reports';
