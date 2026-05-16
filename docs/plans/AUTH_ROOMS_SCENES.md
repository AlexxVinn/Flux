# Flux — Auth, Rooms & Scenes

> **Maintenance rule (read first)**  
> When a section is fully implemented, tested, and merged, **delete it** from this document.

---

## Current baseline

- **DB (Supabase `wngtmxombcivnqxqfmjc`)**: `profiles` (+ `display_name_lower`, default `U_XXXXX` trigger), `scene_catalog`, `user_scenes` (max 3), `rooms` (`join_code`, `visibility`, `owner_id`), `room_members` (guest + kick), RPCs `create_room`, `join_room`, `kick_room_member`, `update_display_name`, RLS for member/spectator write.
- **Legacy public room**: `mechanics-default` → join code in DB (e.g. `983828`), `/workspace/mechanics` auto-joins.
- **Web**: `@supabase/ssr` + middleware; `/auth/login`, `/auth/signup`; home hub (catalog, join code, guest watch); `/workspace/[module]/[roomSlug]` gated by session; admin badge + kick UI; spectators read-only (no toolbar/chat post).
- **Not done yet**: save/load user scenes from workspace, WS auth, join rate limits, full plan test matrix, regenerate strict `database.types` from CLI.

---

## Goals

| Area | Requirement |
|------|-------------|
| Identity | Registered user: unique **display name**, default **`U_XXXXX`**; password **≥ 6** |
| Anonymous | **Spectator only** on **public** rooms |
| Rooms | **6-digit join code**; first joiner = **admin** (chat badge, kick) |
| Scenes | Logged-in: **≤ 3** personal scenes on server |
| Home | Catalog or my scene → create room → invite by code |

## Non-goals (v1)

OAuth, orgs, billing, E2E encrypted rooms, mobile apps.

---

## Phased delivery (remaining)

### Phase 3 — Roles, chat, kick (partial)

- [x] Admin on create; badge in `DiscussionPanel`
- [x] RPC `kick_member`; member list UI for admin
- [ ] Realtime member presence channel (join/leave/kick)
- [ ] WS auth claims (if WS enabled)

### Phase 4 — Anonymous spectator (partial)

- [x] “Watch as guest” on home (public code)
- [x] RLS read-only; UI disables tools/chat for spectators
- [ ] Public room list polish

### Phase 5 — User scenes (3 max)

- [ ] Save scene from workspace (snapshot export)
- [ ] Home: manage 3 scenes (rename, delete, open room)
- [ ] Create room from `user_scenes.id` (RPC wired; UI pending)

### Phase 6 — Hardening

- [ ] Rate limit join RPC
- [ ] Archive room
- [ ] Large snapshots → Storage
- [ ] Security advisor + e2e RLS tests

---

## Shared package (`@flux/shared`)

- [x] `RoomVisibility`, `MemberRole`, `RoomMembership`, `CatalogScene`, `UserScene`
- [x] `ChatMessage.role`, `ChatMessage.isSystem`

---

## Security checklist

- [x] RLS on new tables; no `service_role` in browser
- [ ] Join code brute-force limit
- [x] Kick cannot target self/admin
- [ ] Display name change cooldown (optional)
- [ ] Snapshot JSON schema + size cap on save

---

## Testing matrix

- [ ] Sign up → `U_*` → rename → duplicate rejected
- [ ] Password 5 vs 6 chars
- [ ] Create/join room, admin kick
- [ ] Anonymous public read-only
- [ ] 4th scene rejected
- [ ] Create room from catalog

---

## File map

```
apps/web/src/
  app/page.tsx, auth/login, auth/signup
  app/workspace/[module]/[roomSlug]/page.tsx
  lib/auth/, lib/rooms/api.ts
  store/authStore.ts, roomSessionStore.ts
  components/home/HomeHub.tsx, room/*
supabase/migrations/20260516120000_auth_rooms_scenes.sql
packages/shared/src/rooms.ts
```

---

*Last updated: 2026-05-16*
