-- Role-based account suite: private profile data and password-reset tokens.
-- Additive only: existing users, job listings and public views are not altered.

create table if not exists user_password_resets (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_password_resets_user_id_idx on user_password_resets (user_id);
create index if not exists user_password_resets_expires_at_idx on user_password_resets (expires_at);

-- PRIVATE account data. This table must never be exposed on public job pages,
-- public job APIs, employer directory views or any unauthenticated endpoint.
create table if not exists user_profiles (
  user_id bigint primary key references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table user_profiles is 'Private account profile data; never expose on public job pages.';
