-- Expand published catalog projects and refresh starter copy.
-- Scene geometry for empty JSON rows is supplied client-side via catalogSnapshotForSlug (slug-keyed presets).

insert into public.scene_catalog (slug, title, module, description, sort_order, snapshot)
values
  (
    'mechanics-free-fall',
    'Free fall & mass',
    'mechanics',
    'Paired drops with different inertia — compare how weight and contact differ.',
    1,
    '{"bodies":[],"springs":[],"tick":0}'::jsonb
  ),
  (
    'mechanics-collision-lab',
    'Collision lab',
    'mechanics',
    'Single glider into a responsive block — tune restitution with the inspector.',
    2,
    '{"bodies":[],"springs":[],"tick":0}'::jsonb
  ),
  (
    'mechanics-spring-studio',
    'Spring studio',
    'mechanics',
    'One anchor and a hanging mass — isolate Hooke response before larger rigs.',
    3,
    '{"bodies":[],"springs":[],"tick":0}'::jsonb
  )
on conflict (slug) do update set
  title = excluded.title,
  module = excluded.module,
  description = excluded.description,
  sort_order = excluded.sort_order;

update public.scene_catalog
set
  title = 'Mechanics overview',
  description = 'Platform, dual masses, and an anchor spring — baseline room for teaching workflows.'
where slug = 'mechanics-starter';
