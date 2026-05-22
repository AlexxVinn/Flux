-- Treat markup adds as structural scene ops (revision check + collab ordering).

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
  if v_type in (
    'entity.add.body',
    'entity.add.spring',
    'entity.add.rope',
    'entity.add.markup',
    'entity.remove',
    'scene.replace'
  ) then
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
