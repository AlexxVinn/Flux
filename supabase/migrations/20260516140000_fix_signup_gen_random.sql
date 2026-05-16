-- Signup failed: gen_random_bytes() was unavailable in the auth trigger transaction.

create extension if not exists pgcrypto with schema extensions;

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
  insert into public.profiles (
    id, display_name, display_name_lower, avatar_color, default_name_assigned
  )
  values (
    new.id, v_name, lower(v_name), '#6ee7b7', true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

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
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    v_name := public.generate_default_display_name();
    insert into public.profiles (id, display_name, display_name_lower, avatar_color, default_name_assigned)
    values (v_uid, v_name, lower(v_name), '#6ee7b7', true)
    returning * into v_profile;
  end if;

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
