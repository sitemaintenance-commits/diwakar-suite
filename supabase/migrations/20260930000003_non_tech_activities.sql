-- O&M naming the team uses: the site register is "Non-Tech Activities"
-- (administration, patrol and security, as against the technical work),
-- and its vegetation check is simply "Grass Cutting". Saved register
-- entries point at the checklist item, not its title, so history is kept.
update public.modules
set label = 'Non-Tech Activities'
where key = 'om.operations';

update public.om_checklist_items
set title = 'Grass Cutting'
where section = 'administration' and title = 'Vegetation & Site Cleaning';
