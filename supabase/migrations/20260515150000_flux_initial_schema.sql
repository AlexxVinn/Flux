-- Flux collaborative physics sandbox (mirrors remote migration)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_color text not null default '#6ee7b7',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  module text not null default 'mechanics',
  is_public boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- See Supabase dashboard for full migration (profiles, rooms, messages, annotations, actions, RLS, realtime)
