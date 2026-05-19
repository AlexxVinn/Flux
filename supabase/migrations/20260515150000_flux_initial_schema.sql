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

-- Room members
create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_members enable row level security;

-- Room messages
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  guest_id text,
  display_name text not null,
  body text not null,
  member_role text,
  created_at timestamptz not null default now()
);

alter table public.room_messages enable row level security;

-- Room annotations
create table if not exists public.room_annotations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  guest_id text,
  author_name text not null,
  kind text not null,
  points jsonb not null default '[]'::jsonb,
  label text,
  persistent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.room_annotations enable row level security;

-- Room actions
create table if not exists public.room_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  guest_id text,
  display_name text not null,
  summary text not null,
  action_type text not null,
  entity_id text,
  tick int,
  created_at timestamptz not null default now()
);

alter table public.room_actions enable row level security;

-- Profiles RLS
alter table public.profiles enable row level security;

-- Rooms RLS
alter table public.rooms enable row level security;
