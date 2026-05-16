-- Guest spectators need nullable user_id; roles must match app (admin/member/spectator).

alter table public.room_members alter column user_id drop not null;

alter table public.room_members drop constraint if exists room_members_role_check;
alter table public.room_members
  add constraint room_members_role_check
  check (role in ('admin', 'member', 'spectator'));
