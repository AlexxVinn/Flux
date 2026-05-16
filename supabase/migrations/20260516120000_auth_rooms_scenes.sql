-- Flux: auth profiles, scene catalog, user scenes, rooms with join codes, room members, RPCs

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists default_name_assigned boolean not null default true;

alter table public.profiles
  add column if not exists display_name_lower text;

update public.profiles
set display_name_lower = lower(display_name)
where display_name_lower is null;

alter table public.profiles
  alter column display_name_lower set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_display_name_lower_key'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_lower_key unique (display_name_lower);
  end if;
end $$;

create or replace function public.sync_profile_display_name_lower()
returns trigger
language plpgsql
as $$
begin
  new.display_name_lower := lower(new.display_name);
  return new;
end;
$$;

drop trigger if exists profiles_display_name_lower_sync on public.profiles;
create trigger profiles_display_name_lower_sync
  before insert or update of display_name on public.profiles
  for each row execute function public.sync_profile_display_name_lower();

create or replace function public.generate_default_display_name()
returns text
language plpgsql
as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    candidate := 'U_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    exit when not exists (
      select 1 from public.profiles where display_name_lower = lower(candidate)
    );
    attempts := attempts + 1;
    if attempts > 30 then
      raise exception 'could not generate unique display name';
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := public.generate_default_display_name();
  insert into public.profiles (id, display_name, display_name_lower, avatar_color, default_name_assigned)
  values (
    new.id,
    v_name,
    lower(v_name),
    '#6ee7b7',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Scene catalog & user scenes
-- ---------------------------------------------------------------------------
create table if not exists public.scene_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  module text not null default 'mechanics',
  description text not null default '',
  thumbnail_url text,
  snapshot jsonb not null default '{"bodies":[],"springs":[],"tick":0}'::jsonb,
  sort_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.scene_catalog enable row level security;

create table if not exists public.user_scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  module text not null default 'mechanics',
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_scenes enable row level security;

create or replace function public.enforce_user_scene_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.user_scenes where owner_id = new.owner_id) >= 3 then
    raise exception 'scene_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists user_scenes_limit on public.user_scenes;
create trigger user_scenes_limit
  before insert on public.user_scenes
  for each row execute function public.enforce_user_scene_limit();

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column if not exists join_code char(6),
  add column if not exists owner_id uuid references auth.users (id) on delete set null,
  add column if not exists visibility text not null default 'private',
  add column if not exists origin_catalog_id uuid references public.scene_catalog (id) on delete set null,
  add column if not exists origin_scene_id uuid references public.user_scenes (id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists settings jsonb not null default '{}'::jsonb;

update public.rooms
set visibility = case when is_public then 'public' else 'private' end
where visibility is null or visibility = 'private';

create or replace function public.generate_join_code()
returns char(6)
language plpgsql
as $$
declare
  candidate char(6);
  attempts int := 0;
begin
  loop
    candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from public.rooms
      where join_code = candidate and archived_at is null
    );
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'could not generate join code';
    end if;
  end loop;
  return candidate;
end;
$$;

update public.rooms
set join_code = public.generate_join_code()
where join_code is null;

alter table public.rooms
  alter column join_code set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_visibility_check') then
    alter table public.rooms
      add constraint rooms_visibility_check check (visibility in ('public', 'private'));
  end if;
end $$;

create unique index if not exists rooms_join_code_active_idx
  on public.rooms (join_code)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Room members (extend existing table)
-- ---------------------------------------------------------------------------
alter table public.room_members
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists guest_id text,
  add column if not exists display_name text,
  add column if not exists kicked_at timestamptz,
  add column if not exists removed_by uuid references auth.users (id) on delete set null;

update public.room_members rm
set display_name = coalesce(p.display_name, 'User')
from public.profiles p
where rm.user_id = p.id and rm.display_name is null;

update public.room_members
set display_name = 'User'
where display_name is null;

alter table public.room_members
  alter column display_name set not null;

alter table public.room_members
  alter column id set default gen_random_uuid();

update public.room_members set id = gen_random_uuid() where id is null;

alter table public.room_members
  alter column id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'room_members_pkey' and conrelid = 'public.room_members'::regclass
  ) then
    alter table public.room_members drop constraint room_members_pkey;
  end if;
end $$;

alter table public.room_members add primary key (id);

create unique index if not exists room_members_room_user_uidx
  on public.room_members (room_id, user_id)
  where user_id is not null and kicked_at is null;

create unique index if not exists room_members_room_guest_uidx
  on public.room_members (room_id, guest_id)
  where guest_id is not null and kicked_at is null;

do $$
begin
  alter table public.room_members drop constraint if exists room_members_role_check;
  if not exists (select 1 from pg_constraint where conname = 'room_members_role_check') then
    alter table public.room_members
      add constraint room_members_role_check check (role in ('admin', 'member', 'spectator'));
  end if;
  alter table public.room_members alter column user_id drop not null;
  if not exists (select 1 from pg_constraint where conname = 'room_members_identity_check') then
    alter table public.room_members
      add constraint room_members_identity_check check (
        (user_id is not null and guest_id is null) or (user_id is null and guest_id is not null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_active_room_member(
  p_room_id uuid,
  p_roles text[] default array['admin', 'member', 'spectator']
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = p_room_id
      and rm.kicked_at is null
      and rm.role = any (p_roles)
      and rm.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_room_member(p_room_id, array['admin', 'member']);
$$;

create or replace function public.is_reserved_display_name(p_name text)
returns boolean
language sql
immutable
as $$
  select lower(p_name) in ('admin', 'system', 'flux', 'moderator')
    or (lower(p_name) ~ '^u_[a-z0-9]{5}$' and p_name !~ '^U_');
$$;

-- ---------------------------------------------------------------------------
-- RPC: update display name
-- ---------------------------------------------------------------------------
create or replace function public.update_display_name(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  cleaned := trim(p_display_name);
  if length(cleaned) < 3 or length(cleaned) > 24 then
    raise exception 'invalid_display_name_length';
  end if;
  if cleaned !~ '^[a-zA-Z0-9_-]+$' then
    raise exception 'invalid_display_name_chars';
  end if;
  if public.is_reserved_display_name(cleaned) then
    raise exception 'reserved_display_name';
  end if;
  if lower(cleaned) ~ '^u_[a-z0-9]{5}$' then
    raise exception 'reserved_display_name_format';
  end if;
  if exists (
    select 1 from public.profiles
    where display_name_lower = lower(cleaned) and id <> auth.uid()
  ) then
    raise exception 'display_name_taken';
  end if;

  update public.profiles
  set display_name = cleaned,
      default_name_assigned = false,
      updated_at = now()
  where id = auth.uid()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.update_display_name(text) from public;
grant execute on function public.update_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: create room
-- ---------------------------------------------------------------------------
create or replace function public.create_room(
  p_title text,
  p_module text default 'mechanics',
  p_visibility text default 'private',
  p_catalog_id uuid default null,
  p_user_scene_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_slug text;
  v_member public.room_members;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  select * into v_profile from public.profiles where id = v_uid;

  v_slug := 'room-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.rooms (
    slug, title, module, is_public, visibility, join_code, owner_id,
    origin_catalog_id, origin_scene_id, created_by
  )
  values (
    v_slug,
    coalesce(nullif(trim(p_title), ''), 'Simulation room'),
    coalesce(nullif(trim(p_module), ''), 'mechanics'),
    p_visibility = 'public',
    p_visibility,
    public.generate_join_code(),
    v_uid,
    p_catalog_id,
    p_user_scene_id,
    v_uid
  )
  returning * into v_room;

  insert into public.room_members (room_id, user_id, role, display_name)
  values (v_room.id, v_uid, 'admin', v_profile.display_name)
  returning * into v_member;

  return jsonb_build_object(
    'room_id', v_room.id,
    'slug', v_room.slug,
    'join_code', v_room.join_code,
    'title', v_room.title,
    'module', v_room.module,
    'visibility', v_room.visibility,
    'member_id', v_member.id,
    'role', v_member.role
  );
end;
$$;

revoke all on function public.create_room(text, text, text, uuid, uuid) from public;
grant execute on function public.create_room(text, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: join room
-- ---------------------------------------------------------------------------
create or replace function public.join_room(
  p_join_code text,
  p_guest_id text default null,
  p_guest_display_name text default null,
  p_as_spectator boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_member public.room_members;
  v_profile public.profiles;
  v_role text;
  v_display text;
  v_code char(6);
  v_member_count int;
begin
  v_code := lpad(regexp_replace(coalesce(p_join_code, ''), '\D', '', 'g'), 6, '0');
  if length(trim(v_code)) <> 6 then
    raise exception 'invalid_join_code';
  end if;

  select * into v_room
  from public.rooms
  where join_code = v_code and archived_at is null;

  if not found then
    raise exception 'room_not_found';
  end if;

  if v_uid is not null then
    select * into v_profile from public.profiles where id = v_uid;
    v_display := v_profile.display_name;
    v_role := case when p_as_spectator then 'spectator' else 'member' end;

    select * into v_member
    from public.room_members
    where room_id = v_room.id and user_id = v_uid and kicked_at is null;

    if found then
      return jsonb_build_object(
        'room_id', v_room.id,
        'slug', v_room.slug,
        'title', v_room.title,
        'module', v_room.module,
        'visibility', v_room.visibility,
        'join_code', v_room.join_code,
        'member_id', v_member.id,
        'role', v_member.role,
        'display_name', v_member.display_name
      );
    end if;

    if exists (
      select 1 from public.room_members
      where room_id = v_room.id and user_id = v_uid and kicked_at is not null
    ) then
      raise exception 'kicked_from_room';
    end if;

    select count(*) into v_member_count
    from public.room_members
    where room_id = v_room.id and kicked_at is null;

    insert into public.room_members (room_id, user_id, role, display_name)
    values (v_room.id, v_uid, v_role, v_display)
    returning * into v_member;

    return jsonb_build_object(
      'room_id', v_room.id,
      'slug', v_room.slug,
      'title', v_room.title,
      'module', v_room.module,
      'visibility', v_room.visibility,
      'join_code', v_room.join_code,
      'member_id', v_member.id,
      'role', v_member.role,
      'display_name', v_member.display_name
    );
  end if;

  -- Anonymous guest spectator (public rooms only)
  if p_guest_id is null or length(trim(p_guest_id)) < 4 then
    raise exception 'guest_id_required';
  end if;
  if v_room.visibility <> 'public' then
    raise exception 'private_room_requires_auth';
  end if;

  v_display := coalesce(nullif(trim(p_guest_display_name), ''), 'Guest');
  v_role := 'spectator';

  select * into v_member
  from public.room_members
  where room_id = v_room.id and guest_id = p_guest_id and kicked_at is null;

  if found then
    return jsonb_build_object(
      'room_id', v_room.id,
      'slug', v_room.slug,
      'title', v_room.title,
      'module', v_room.module,
      'visibility', v_room.visibility,
      'join_code', v_room.join_code,
      'member_id', v_member.id,
      'role', v_member.role,
      'display_name', v_member.display_name
    );
  end if;

  insert into public.room_members (room_id, guest_id, role, display_name)
  values (v_room.id, p_guest_id, v_role, v_display)
  returning * into v_member;

  return jsonb_build_object(
    'room_id', v_room.id,
    'slug', v_room.slug,
    'title', v_room.title,
    'module', v_room.module,
    'visibility', v_room.visibility,
    'join_code', v_room.join_code,
    'member_id', v_member.id,
    'role', v_member.role,
    'display_name', v_member.display_name
  );
end;
$$;

revoke all on function public.join_room(text, text, text, boolean) from public;
grant execute on function public.join_room(text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: kick member
-- ---------------------------------------------------------------------------
create or replace function public.kick_room_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.room_members;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_target from public.room_members where id = p_member_id;
  if not found then
    raise exception 'member_not_found';
  end if;

  if not exists (
    select 1 from public.room_members
    where room_id = v_target.room_id
      and user_id = auth.uid()
      and role = 'admin'
      and kicked_at is null
  ) then
    raise exception 'not_room_admin';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'cannot_kick_self';
  end if;
  if v_target.role = 'admin' then
    raise exception 'cannot_kick_admin';
  end if;

  update public.room_members
  set kicked_at = now(), removed_by = auth.uid()
  where id = p_member_id;
end;
$$;

revoke all on function public.kick_room_member(uuid) from public;
grant execute on function public.kick_room_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed catalog + legacy room join code
-- ---------------------------------------------------------------------------
insert into public.scene_catalog (slug, title, module, description, sort_order, snapshot)
values (
  'mechanics-starter',
  'Mechanics Starter Lab',
  'mechanics',
  'Gravity, collisions, and springs — ideal for first experiments.',
  0,
  '{"bodies":[],"springs":[],"tick":0}'::jsonb
)
on conflict (slug) do nothing;

update public.rooms
set visibility = 'public',
    join_code = coalesce(join_code, public.generate_join_code())
where slug = 'mechanics-default';

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists rooms_select_public on public.rooms;
drop policy if exists rooms_insert_auth on public.rooms;
drop policy if exists rooms_update_owner on public.rooms;
drop policy if exists room_members_insert on public.room_members;
drop policy if exists room_members_select on public.room_members;
drop policy if exists room_messages_select on public.room_messages;
drop policy if exists room_messages_insert on public.room_messages;
drop policy if exists room_actions_select on public.room_actions;
drop policy if exists room_actions_insert on public.room_actions;
drop policy if exists room_annotations_select on public.room_annotations;
drop policy if exists room_annotations_insert on public.room_annotations;
drop policy if exists room_annotations_delete on public.room_annotations;

drop policy if exists scene_catalog_select_published on public.scene_catalog;
create policy scene_catalog_select_published on public.scene_catalog
  for select using (is_published = true);

drop policy if exists user_scenes_select_own on public.user_scenes;
create policy user_scenes_select_own on public.user_scenes
  for select using (owner_id = auth.uid());

drop policy if exists user_scenes_insert_own on public.user_scenes;
create policy user_scenes_insert_own on public.user_scenes
  for insert with check (owner_id = auth.uid());

drop policy if exists user_scenes_update_own on public.user_scenes;
create policy user_scenes_update_own on public.user_scenes
  for update using (owner_id = auth.uid());

drop policy if exists user_scenes_delete_own on public.user_scenes;
create policy user_scenes_delete_own on public.user_scenes
  for delete using (owner_id = auth.uid());

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

drop policy if exists rooms_select_public_or_member on public.rooms;
create policy rooms_select_public_or_member on public.rooms
  for select using (
    archived_at is null
    and (
      visibility = 'public'
      or public.is_active_room_member(id)
      or owner_id = auth.uid()
    )
  );

drop policy if exists room_members_select_same_room on public.room_members;
create policy room_members_select_same_room on public.room_members
  for select using (
    public.is_active_room_member(room_id)
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.visibility = 'public' and r.archived_at is null
    )
  );

drop policy if exists room_messages_select on public.room_messages;
create policy room_messages_select on public.room_messages
  for select using (
    exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.archived_at is null
        and (
          r.visibility = 'public'
          or public.is_active_room_member(r.id)
        )
    )
  );

drop policy if exists room_messages_insert on public.room_messages;
create policy room_messages_insert on public.room_messages
  for insert with check (public.can_write_room(room_id));

drop policy if exists room_actions_select on public.room_actions;
create policy room_actions_select on public.room_actions
  for select using (
    exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.archived_at is null
        and (
          r.visibility = 'public'
          or public.is_active_room_member(r.id)
        )
    )
  );

drop policy if exists room_actions_insert on public.room_actions;
create policy room_actions_insert on public.room_actions
  for insert with check (public.can_write_room(room_id));

drop policy if exists room_annotations_select on public.room_annotations;
create policy room_annotations_select on public.room_annotations
  for select using (
    exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.archived_at is null
        and (
          r.visibility = 'public'
          or public.is_active_room_member(r.id)
        )
    )
  );

drop policy if exists room_annotations_insert on public.room_annotations;
create policy room_annotations_insert on public.room_annotations
  for insert with check (public.can_write_room(room_id));
