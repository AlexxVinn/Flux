-- Public share links for user_scenes (/s/[sceneId])

alter table public.user_scenes
  add column if not exists is_public boolean not null default false;

create index if not exists user_scenes_public_idx
  on public.user_scenes (is_public)
  where is_public = true;

drop policy if exists user_scenes_select_public on public.user_scenes;
create policy user_scenes_select_public on public.user_scenes
  for select
  using (is_public = true);
