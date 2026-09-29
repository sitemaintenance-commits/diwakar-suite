-- The HR "Performance" page is the company's employee review: review
-- periods, goals and ratings. Call it that in the menu, so it is not
-- confused with the PMS "Performance Score" sheet.
update public.modules
set label = 'Employee Review',
    description = 'Employee reviews, goals and ratings'
where key = 'hr.performance';
