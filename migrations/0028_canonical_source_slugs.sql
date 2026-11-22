-- 0028_canonical_source_slugs.sql
-- Rewrite legacy source slugs to their canonical values so the runtime alias
-- map is no longer needed. Idempotent: re-running changes nothing once the
-- legacy values are gone. Safe on fresh databases and on databases where the
-- sources table predates these columns.
--
-- Some canonical rows are already seeded by earlier migrations. A legacy row
-- whose canonical slug is taken keeps its slug (the unique constraint must not
-- be broken), but receives the canonical adapter_key so it still resolves at
-- runtime without any alias fallback.

do $$
begin
  if exists (
       select 1
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'job_sources'
     )
     and exists (
       select 1
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'job_sources'
          and column_name = 'slug'
     )
     and exists (
       select 1
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'job_sources'
          and column_name = 'adapter_key'
     )
     and exists (
       select 1
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'job_sources'
          and column_name = 'updated_at'
     ) then

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'etcareers') then slug
                    else 'etcareers'
                  end,
           adapter_key = 'etcareers',
           updated_at = now()
     where slug = 'etcaeers';

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'ethiojobs-net-et') then slug
                    else 'ethiojobs-net-et'
                  end,
           adapter_key = 'ethiojobs-net-et',
           updated_at = now()
     where slug = 'ethiojobs-net';

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'ethiojobs-net-et') then slug
                    else 'ethiojobs-net-et'
                  end,
           adapter_key = 'ethiojobs-net-et',
           updated_at = now()
     where slug = 'ethio-jobs-net-et';

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'ethiopian-reporter') then slug
                    else 'ethiopian-reporter'
                  end,
           adapter_key = 'ethiopian-reporter',
           updated_at = now()
     where slug = 'ethiopianreporterjobs';

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'un-ethiopia') then slug
                    else 'un-ethiopia'
                  end,
           adapter_key = 'un-ethiopia',
           updated_at = now()
     where slug = 'un-ethiopia-jobs';

    update job_sources
       set slug = case
                    when exists (select 1 from job_sources where slug = 'un-careers-ethiopia') then slug
                    else 'un-careers-ethiopia'
                  end,
           adapter_key = 'un-careers-ethiopia',
           updated_at = now()
     where slug = 'un-careers';

  end if;
end $$;
