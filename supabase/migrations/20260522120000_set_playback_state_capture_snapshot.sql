-- Pause while playing: optional client snapshot replaces DB scene (ops cannot apply while playing).
-- Replaces 2-arg set_playback_state with 3-arg form (third defaults to null).

drop function if exists public.set_playback_state(uuid, text);

create or replace function public.set_playback_state(
  p_room_id uuid,
  p_state text,
  p_snapshot jsonb default null
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
  v_base_rev bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.can_write_room(p_room_id) then raise exception 'forbidden'; end if;
  if p_state not in ('paused', 'playing') then raise exception 'invalid_state'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'room_not_found'; end if;

  if p_state = 'playing' and p_snapshot is not null then
    raise exception 'invalid_args' using errcode = 'P0001';
  end if;

  if p_state = 'paused' and p_snapshot is not null then
    v_new_snap := public.flux_normalize_scene(p_snapshot);
    v_new_count := public.flux_scene_object_count(v_new_snap);
    if v_new_count > v_room.object_limit then
      raise exception 'object_limit_reached' using errcode = 'P0001';
    end if;
    if octet_length(v_new_snap::text) > v_room.max_snapshot_bytes then
      raise exception 'snapshot_too_large' using errcode = 'P0001';
    end if;

    v_base_rev := v_room.scene_revision;
    select coalesce(max(seq), 0) + 1 into v_next_seq from public.room_scene_ops where room_id = p_room_id;

    insert into public.room_scene_ops (room_id, seq, actor_id, base_revision, op, client_op_id)
    values (
      p_room_id,
      v_next_seq,
      v_uid,
      v_base_rev,
      jsonb_build_object('type', 'scene.replace', 'snapshot', v_new_snap),
      null
    );

    update public.rooms
    set
      scene_snapshot = v_new_snap,
      scene_revision = scene_revision + 1,
      playback_state = 'paused',
      playback_revision = playback_revision + 1,
      updated_at = now()
    where id = p_room_id
    returning * into v_room;
  else
    update public.rooms
    set
      playback_state = p_state,
      playback_revision = playback_revision + 1,
      updated_at = now()
    where id = p_room_id
    returning * into v_room;
  end if;

  return jsonb_build_object(
    'playback_state', v_room.playback_state,
    'playback_revision', v_room.playback_revision,
    'scene_revision', v_room.scene_revision,
    'snapshot', public.flux_normalize_scene(v_room.scene_snapshot)
  );
end;
$$;

grant execute on function public.set_playback_state(uuid, text, jsonb) to authenticated;
