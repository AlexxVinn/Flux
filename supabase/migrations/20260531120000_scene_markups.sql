-- Scene markups (arrows, text, rulers) as persisted document entities.

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
      'ropes', coalesce(p_snap->'ropes', '[]'::jsonb),
      'markups', coalesce(p_snap->'markups', '[]'::jsonb),
      'tick', coalesce((p_snap->>'tick')::int, 0),
      'gravityEnabled', coalesce((p_snap->>'gravityEnabled')::boolean, true)
    )
  );
$$;

create or replace function public.flux_apply_scene_op_inner(p_snap jsonb, p_op jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_type text := p_op->>'type';
  v_id text;
  v_body jsonb;
  v_spring jsonb;
  v_rope jsonb;
  v_markup jsonb;
  v_patch jsonb;
  v_bodies jsonb;
  v_springs jsonb;
  v_ropes jsonb;
  v_markups jsonb;
  v_found boolean;
  v_key text;
  v_allowed text[] := array[
    'x','y','angle','width','height','velocityX','velocityY','angularVelocity',
    'mass','density','restitution','friction','frictionStatic','frictionAir',
    'isStatic','visible','showTrajectory','displayName','label','gravityScale','sleepThreshold','isSleeping'
  ];
  v_sp_allowed text[] := array[
    'stiffness','damping','length','elasticConstantNnPerM','visible','displayName'
  ];
  v_rope_allowed text[] := array['linkStiffness','linkDamping','segmentCount','visible','displayName'];
  v_mk_allowed text[] := array['points','text','visible','displayName','measureUnit'];
  v_child jsonb;
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

  elsif v_type = 'entity.add.rope' then
    v_rope := p_op->'rope';
    if v_rope is null or v_rope->>'id' is null then
      raise exception 'invalid_op' using errcode = 'P0001';
    end if;
    v_ropes := p_snap->'ropes' || jsonb_build_array(v_rope);
    return public.flux_normalize_scene(jsonb_set(p_snap, '{ropes}', v_ropes));

  elsif v_type = 'entity.add.markup' then
    v_markup := p_op->'markup';
    if v_markup is null or v_markup->>'id' is null then
      raise exception 'invalid_op' using errcode = 'P0001';
    end if;
    v_markups := p_snap->'markups' || jsonb_build_array(v_markup);
    return public.flux_normalize_scene(jsonb_set(p_snap, '{markups}', v_markups));

  elsif v_type = 'entity.remove' then
    v_id := p_op->>'id';
    if v_id is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select coalesce(jsonb_agg(elem) filter (where elem->>'id' is distinct from v_id), '[]'::jsonb)
    into v_bodies
    from jsonb_array_elements(p_snap->'bodies') elem;
    select coalesce(jsonb_agg(elem) filter (where elem->>'id' is distinct from v_id), '[]'::jsonb)
    into v_springs
    from jsonb_array_elements(p_snap->'springs') elem;
    select coalesce(
      jsonb_agg(elem) filter (
        where elem->>'id' is distinct from v_id
          and elem->>'bodyA' is distinct from v_id
          and elem->>'bodyB' is distinct from v_id
      ),
      '[]'::jsonb
    )
    into v_ropes
    from jsonb_array_elements(p_snap->'ropes') elem;
    select coalesce(jsonb_agg(elem) filter (where elem->>'id' is distinct from v_id), '[]'::jsonb)
    into v_markups
    from jsonb_array_elements(p_snap->'markups') elem;
    return public.flux_normalize_scene(
      jsonb_set(
        jsonb_set(
          jsonb_set(jsonb_set(p_snap, '{bodies}', v_bodies), '{springs}', v_springs),
          '{ropes}',
          v_ropes
        ),
        '{markups}',
        v_markups
      )
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

  elsif v_type = 'entity.patch.rope' then
    v_id := p_op->>'id';
    v_patch := p_op->'patch';
    if v_id is null or v_patch is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select exists (select 1 from jsonb_array_elements(p_snap->'ropes') e where e->>'id' = v_id) into v_found;
    if not v_found then raise exception 'entity_not_found' using errcode = 'P0001'; end if;
    for v_key in select jsonb_object_keys(v_patch)
    loop
      if not v_key = any(v_rope_allowed) then
        raise exception 'invalid_patch_key' using errcode = 'P0001';
      end if;
    end loop;
    select coalesce(
      jsonb_agg(
        case when elem->>'id' = v_id then elem || v_patch else elem end
      ),
      '[]'::jsonb
    )
    into v_ropes
    from jsonb_array_elements(p_snap->'ropes') elem;
    return public.flux_normalize_scene(jsonb_set(p_snap, '{ropes}', v_ropes));

  elsif v_type = 'entity.patch.markup' then
    v_id := p_op->>'id';
    v_patch := p_op->'patch';
    if v_id is null or v_patch is null then raise exception 'invalid_op' using errcode = 'P0001'; end if;
    select exists (select 1 from jsonb_array_elements(p_snap->'markups') e where e->>'id' = v_id) into v_found;
    if not v_found then raise exception 'entity_not_found' using errcode = 'P0001'; end if;
    for v_key in select jsonb_object_keys(v_patch)
    loop
      if not v_key = any(v_mk_allowed) then
        raise exception 'invalid_patch_key' using errcode = 'P0001';
      end if;
    end loop;
    select coalesce(
      jsonb_agg(
        case when elem->>'id' = v_id then elem || v_patch else elem end
      ),
      '[]'::jsonb
    )
    into v_markups
    from jsonb_array_elements(p_snap->'markups') elem;
    return public.flux_normalize_scene(jsonb_set(p_snap, '{markups}', v_markups));

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
