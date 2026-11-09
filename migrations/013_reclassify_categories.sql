-- 013_reclassify_categories.sql
-- Fix known misclassifications (idempotent, targeted). Safe to re-run.
-- Primary case: creative/media/video/graphic roles wrongly bucketed (e.g. Agriculture).
-- Transaction is managed by the migration runner.

-- Creative & design roles (graphic design, brand/visual/UI-UX, motion) -> Creative and Design,
-- unless the posting is genuinely agricultural.
update job_listings
   set category = 'Creative and Design', updated_at = now()
 where (category is distinct from 'Creative and Design')
   and coalesce(title,'') || ' ' || coalesce(description,'') ~* '(graphic[[:space:]_-]*design|ui[[:space:]/-]*ux[[:space:]_-]*design|brand[[:space:]_-]*design|visual[[:space:]_-]*design|digital[[:space:]_-]*design|motion[[:space:]_-]*design|motion[[:space:]_-]*graphic|illustrat(or|ion)[[:space:]]+(specialist|officer|designer)|creative[[:space:]]+(specialist|officer|designer|director))'
   and coalesce(title,'') || ' ' || coalesce(description,'') !~* '(agricultur|agronom|crop[[:space:]]+production|livestock|irrigat|harvest|farmer|seed|fertiliz|dairy|poultry|fishery|forestry)';

-- Video/media production, videography, multimedia, broadcast -> Media and Communication,
-- unless the posting is genuinely agricultural and has no media/creative design lead signal.
update job_listings
   set category = 'Media and Communication', updated_at = now()
 where (category is distinct from 'Media and Communication')
   and coalesce(title,'') || ' ' || coalesce(description,'') ~* '(video[[:space:]_-]*production|video[[:space:]_-]*producer|videograph(er|y)?|multimedia[[:space:]]+(specialist|officer|producer)|broadcast|podcast|film[[:space:]_-]*making)'
   and coalesce(title,'') || ' ' || coalesce(description,'') !~* '(agricultur|agronom|crop[[:space:]]+production|livestock|irrigat|harvest|farmer|seed|fertiliz|dairy|poultry|fishery|forestry)'
   and not (coalesce(title,'') || ' ' || coalesce(description,'') ~* '(graphic[[:space:]_-]*design|brand[[:space:]_-]*design|visual[[:space:]_-]*design|ui[[:space:]/-]*ux)');
