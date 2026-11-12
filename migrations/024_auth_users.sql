-- User accounts and sessions for standard authentication.
-- Roles: admin, employee (job seeker), employer.

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists users (
  id bigserial primary key,
  email text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'employee', 'employer')),
  name text,
  company_name text,
  contact_name text,
  phone text,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists users_email_lower_uidx on users (lower(email));
create index if not exists users_role_idx on users (role);

create table if not exists user_sessions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip_hash text
);

create index if not exists user_sessions_user_id_idx on user_sessions (user_id);
create index if not exists user_sessions_expires_at_idx on user_sessions (expires_at);

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at before update on users
for each row execute function set_updated_at();
