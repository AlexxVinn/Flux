-- Multiplayer scene: authoritative snapshot on rooms, op log, global pause, object limits.

-- ---------------------------------------------------------------------------
-- Rooms: collaborative scene + playback
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column if not exists scene_snapshot jsonb not null default jsonb_build_object(
    'schemaVersion', 1,
    'bodies', '[]'::jsonb,
    'springs', '[]'::jsonb,
    'tick', 0,
    'gravityEnabled', true
  ),
  add column if not exists scene_revision bigint not null default 0,
  add column if not exists playback_state text not null default 'paused',
  add column if not exists playback_revision bigint not null default 0,
  add column if not exists object_limit int not null default 64,
  add column if not exists max_snapshot_bytes int not null default 524288;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_playback_state_check'
  ) then
    alter table public.rooms
      add constraint rooms_playback_state_check
      check (playback_state in ('paused', 'playing'));
  end if;
end $$;

update public.rooms r
set scene_snapshot = coalesce(
  r.scene_snapshot,
  jsonb_build_object(
    'schemaVersion', 1,
    'bodies', '[]'::jsonb,
    'springs', '[]'::jsonb,
    'tick', 0,
    'gravityEnabled', true
  )
)
where scene_snapshot is null;

-- ---------------------------------------------------------------------------
-- Scene ops (append-only; Realtime INSERT notifies clients)
-- ---------------------------------------------------------------------------
create table if not exists public.room_scene_ops (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq bigint not null,
  actor_id uuid references auth.users (id) on delete set null,
  base_revision bigint not null,
  op jsonb not null,
  client_op_id text,
  created_at timestamptz not null default now(),
  unique (room_id, seq),
  unique (room_id, client_op_id)
);

create index if not exists room_scene_ops_room_seq_idx
  on public.room_scene_ops (room_id, seq desc);

alter table public.room_scene_ops enable row level security;

drop policy if exists room_scene_ops_select on public.room_scene_ops;
create policy room_scene_ops_select on public.room_scene_ops
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

-- Inserts only via RPC (SECURITY DEFINER); block direct client inserts
drop policy if exists room_scene_ops_insert on public.room_scene_ops;
create policy room_scene_ops_insert on public.room_scene_ops
  for insert with check (false);

-- ---------------------------------------------------------------------------
-- Helpers: object count & snapshot bytes
-- ---------------------------------------------------------------------------
create or replace function public.flux_scene_object_count(p_snap jsonb)
returns int
language plpgsql
immutable
as $$
declare
  body_count int := 0;
  spring_count int := 0;
  elem jsonb;
begin
  if p_snap is null then return 0; end if;
  for elem in select * from jsonb_array_elements(coalesce(p_snap->'bodies', '[]'::jsonb))
  loop
    if coalesce(elem->>'entityKind', '') not in ('wall', 'floor') then
      body_count := body_count + 1;
    end if;
  end loop;
  spring_count := jsonb_array_length(coalesce(p_snap->'springs', '[]'::jsonb));
  return body_count + spring_count;
end;
$$;

create or replace function public.flux_normalize_scene(p_snap jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'schemaVersion', coalesce((p_snap->>'schemaVersion')::int, 1),
      'bodies', coalesce(p_snap->'bodies', '[]'::jsonb),
      'springs', coalesce(p_snap->'springs', '[]'::jsonb),
      'tick', coalesce((p_snap->>'tick')::int, 0),
      'gravityEnabled', coalesce((p_snap->>'gravityEnabled')::boolean, true)
    )
  );
$$;

-- Apply one op; raises on invalid input. Structural ops must be pre-checked for revision.
create or replace function public.flux_apply_scene_op_inner(p_snap jsonb, p_op jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_type text := p_op->>'type';
  v_id text;
  v_body jsonb;
  v_spring jsonb;
  v_patch jsonb;
  v_bodies jsonb;
  v_springs jsonb;
  v_elem jsonb;
  v_found boolean;
  v_key text;
  v_allowed text[] := array[
    'x','y','angle','width','height','velocityX','velocityY','angularVelocity',
    'mass','density','restitution','friction','frictionStatic','frictionAir',
    'isStatic','visible','displayName','label','gravityScale','sleepThreshold','isSleeping'
  ];
  v_sp_allowed text[] := array['stiffness','damping','length','visible','displayName'];
  v_child jsonb;
  v_i int;
begin
  p_snap := public.flux_normalize_scene(p_snap);

  if v_type = 'entity.add.body' then
    v_body := p_op->'body';
    if v_body is null or v_body->>'id' is null then
      raise exception 'invalid_op' using errcode = 'P0001';
    end if;
    v_bodies := p_snap->'bodies' || jsonb_build_array(v_body);
    return public.flux_normalize_scene(jsonb_set(p_snap, '{bodies}', v_bodies));

  elsif v_type = 'entity.add.spring' then
    v_spring := p_op->'spring';
    if v_spring is null or v_spring->>'id' is null then
      raise exception 'invalid_op' using errcode = 'P0001';
    end if;
    v_springs := p_snap->'springs' || jsonb_build_array(v_spring);
    return public.flux_normalize_scene(jsonb_set(p_snap, '{springs}', v_springs));

  elsif v_type = 'entity.remove' then
    v_id := p_op->>'id';
    if v_id is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select coalesce(jsonb_agg(elem) filter (where elem->>'id' is distinct from v_id), '[]'::jsonb)
    into v_bodies
    from jsonb_array_elements(p_snap->'bodies') elem;
    select coalesce(jsonb_agg(elem) filter (where elem->>'id' is distinct from v_id), '[]'::jsonb)
    into v_springs
    from jsonb_array_elements(p_snap->'springs') elem;
    return public.flux_normalize_scene(
      jsonb_set(jsonb_set(p_snap, '{bodies}', v_bodies), '{springs}', v_springs)
    );

  elsif v_type = 'entity.patch.body' then
    v_id := p_op->>'id';
    v_patch := p_op->'patch';
    if v_id is null or v_patch is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select exists (select 1 from jsonb_array_elements(p_snap->'bodies') e where e->>'id' = v_id) into v_found;
    if not v_found then raise exception 'entity_not_found' using errcode = 'P0001'; end if;
    for v_key in select jsonb_object_keys(v_patch)
    loop
      if not v_key = any(v_allowed) then
        raise exception 'invalid_patch_key' using errcode = 'P0001';
      end if;
    end loop;
    select coalesce(
      jsonb_agg(
        case when elem->>'id' = v_id then elem || v_patch else elem end
      ),
      '[]'::jsonb
    )
    into v_bodies
    from jsonb_array_elements(p_snap->'bodies') elem;
    return public.flux_normalize_scene(jsonb_set(p_snap, '{bodies}', v_bodies));

  elsif v_type = 'entity.patch.spring' then
    v_id := p_op->>'id';
    v_patch := p_op->'patch';
    if v_id is null or v_patch is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select exists (select 1 from jsonb_array_elements(p_snap->'springs') e where e->>'id' = v_id) into v_found;
    if not v_found then raise exception 'entity_not_found' using errcode = 'P0001'; end if;
    for v_key in select jsonb_object_keys(v_patch)
    loop
      if not v_key = any(v_sp_allowed) then
        raise exception 'invalid_patch_key' using errcode = 'P0001';
      end if;
    end loop;
    select coalesce(
      jsonb_agg(
        case when elem->>'id' = v_id then elem || v_patch else elem end
      ),
      '[]'::jsonb
    )
    into v_springs
    from jsonb_array_elements(p_snap->'springs') elem;
    return public.flux_normalize_scene(jsonb_set(p_snap, '{springs}', v_springs));

  elsif v_type = 'scene.gravity' then
    if p_op->'gravityEnabled' is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    return public.flux_normalize_scene(
      jsonb_set(p_snap, '{gravityEnabled}', p_op->'gravityEnabled')
    );

  elsif v_type = 'scene.replace' then
    if p_op->'snapshot' is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    return public.flux_normalize_scene(p_op->'snapshot');

  elsif v_type = 'batch' then
    v_bodies := p_snap;
    v_i := 0;
    for v_child in select * from jsonb_array_elements(coalesce(p_op->'ops', '[]'::jsonb))
    loop
      v_bodies := public.flux_apply_scene_op_inner(v_bodies, v_child);
    end loop;
    return v_bodies;

  else
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.flux_op_is_structural(p_op jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_type text := p_op->>'type';
  v_child jsonb;
begin
  if v_type is null then return false; end if;
  if v_type in ('entity.add.body', 'entity.add.spring', 'entity.remove', 'scene.replace') then
    return true;
  end if;
  if v_type = 'batch' then
    for v_child in select * from jsonb_array_elements(coalesce(p_op->'ops', '[]'::jsonb))
    loop
      if public.flux_op_is_structural(v_child) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: apply_scene_op
-- ---------------------------------------------------------------------------
create or replace function public.apply_scene_op(
  p_room_id uuid,
  p_base_revision bigint,
  p_op jsonb,
  p_client_op_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_next_seq bigint;
  v_new_snap jsonb;
  v_new_count int;
  v_structural boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.can_write_room(p_room_id) then raise exception 'forbidden'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'room_not_found'; end if;
  if v_room.archived_at is not null then raise exception 'room_archived'; end if;

  if v_room.playback_state <> 'paused' then
    raise exception 'not_paused' using errcode = 'P0001';
  end if;

  if p_client_op_id is not null then
    if exists (
      select 1 from public.room_scene_ops o
      where o.room_id = p_room_id and o.client_op_id = p_client_op_id
    ) then
      return jsonb_build_object(
        'duplicate', true,
        'scene_revision', v_room.scene_revision,
        'snapshot', public.flux_normalize_scene(v_room.scene_snapshot)
      );
    end if;
  end if;

  v_structural := public.flux_op_is_structural(p_op);

  if v_structural and p_base_revision is distinct from v_room.scene_revision then
    raise exception 'stale_revision' using errcode = 'P0001';
  end if;

  begin
    v_new_snap := public.flux_apply_scene_op_inner(v_room.scene_snapshot, p_op);
  exception when others then
    raise;
  end;

  v_new_count := public.flux_scene_object_count(v_new_snap);
  if v_new_count > v_room.object_limit then
    raise exception 'object_limit_reached' using errcode = 'P0001';
  end if;

  if octet_length(v_new_snap::text) > v_room.max_snapshot_bytes then
    raise exception 'snapshot_too_large' using errcode = 'P0001';
  end if;

  select coalesce(max(seq), 0) + 1 into v_next_seq from public.room_scene_ops where room_id = p_room_id;

  insert into public.room_scene_ops (room_id, seq, actor_id, base_revision, op, client_op_id)
  values (p_room_id, v_next_seq, v_uid, p_base_revision, p_op, nullif(trim(p_client_op_id), ''));

  update public.rooms
  set
    scene_snapshot = v_new_snap,
    scene_revision = scene_revision + 1,
    updated_at = now()
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'seq', v_next_seq,
    'scene_revision', v_room.scene_revision,
    'snapshot', public.flux_normalize_scene(v_room.scene_snapshot),
    'object_count', v_new_count
  );
end;
$$;

grant execute on function public.apply_scene_op(uuid, bigint, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_playback_state
-- ---------------------------------------------------------------------------
create or replace function public.set_playback_state(
  p_room_id uuid,
  p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.can_write_room(p_room_id) then raise exception 'forbidden'; end if;
  if p_state not in ('paused', 'playing') then raise exception 'invalid_state'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'room_not_found'; end if;

  update public.rooms
  set
    playback_state = p_state,
    playback_revision = playback_revision + 1,
    updated_at = now()
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'playback_state', v_room.playback_state,
    'playback_revision', v_room.playback_revision,
    'scene_revision', v_room.scene_revision,
    'snapshot', public.flux_normalize_scene(v_room.scene_snapshot)
  );
end;
$$;

grant execute on function public.set_playback_state(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_room_scene
-- ---------------------------------------------------------------------------
create or replace function public.get_room_scene(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'room_not_found'; end if;

  if v_room.archived_at is not null then raise exception 'room_archived'; end if;

  if not (
    v_room.visibility = 'public'
    or public.is_active_room_member(p_room_id)
    or v_room.owner_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'scene_revision', v_room.scene_revision,
    'playback_state', v_room.playback_state,
    'playback_revision', v_room.playback_revision,
    'object_limit', v_room.object_limit,
    'snapshot', public.flux_normalize_scene(v_room.scene_snapshot),
    'object_count', public.flux_scene_object_count(v_room.scene_snapshot)
  );
end;
$$;

grant execute on function public.get_room_scene(uuid) to authenticated;

comment on table public.room_scene_ops is 'Append-only collaborative scene edits; subscribe via Realtime for op stream.';
comment on column public.rooms.scene_snapshot is 'Authoritative paused scene (bodies, springs, tick, gravityEnabled).';
comment on column public.rooms.playback_state is 'Global pause: paused = collaborative edits allowed.';
