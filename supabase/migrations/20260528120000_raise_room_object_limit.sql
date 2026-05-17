-- Raise per-room scene object cap (bodies + springs + ropes, excluding floor/wall/ropeSegment).

alter table public.rooms
  alter column object_limit set default 1024;

update public.rooms
set object_limit = 1024
where object_limit < 1024;
