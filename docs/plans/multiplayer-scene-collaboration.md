# Multiplayer scene collaboration — technical plan

> **Scope**: Shared **initial scene** editing in a room. Physics **runs locally** while playing; only the **paused** scene document is collaboratively edited, synced, and persisted.  
> **Non-goals (v1)**: Server-side physics, deterministic replay sync, CRDT for every property, or merging divergent simulation timelines.

---

## 1. Problem statement

Flux rooms host a physics workspace where multiple users may join. Each client runs Matter.js independently during playback. Collaboration must guarantee:

| Requirement | Implication |
|---------------|-------------|
| One shared scene truth | Server holds authoritative scene JSON + revision |
| Edit only while paused | Global pause lock; UI + API enforce |
| Play locally | No runtime body positions over the network |
| Persist every durable edit | Writes go through server; clients reconcile |
| Object cap per room | Enforced server-side before commit |
| Live awareness | Selection + presence ephemeral, not persisted |
| Identity | Procedural avatar per user, stable in room |

Today the codebase has **room membership**, **chat**, **action log** (`room_actions`), optional **WebSocket presence** (cursor/selection), and **client-side pause gating** (`isPlaying` locks inspector). This plan extends that into a coherent scene-sync model without overbuilding.

---

## 2. Collaboration model

### 2.1 Two modes per room

```
┌─────────────────────────────────────────────────────────────┐
│  PAUSED (collaborative)          │  PLAYING (local-only)     │
├─────────────────────────────────┼───────────────────────────┤
│  Scene doc mutable              │  Scene doc frozen         │
│  Ops → server → broadcast       │  Simulation tick local    │
│  All writers see same entities  │  Positions diverge OK     │
│  Selection/presence active      │  Selection/presence OK    │
│  Inspector/tools enabled*       │  Inspector read-only      │
└─────────────────────────────────┴───────────────────────────┘
  * members/admins only; spectators read-only (existing RLS pattern)
```

**Global pause lock** is a **room property**, not per-user:

- `rooms.playback_state`: `paused` | `playing`
- Optional `rooms.playback_revision` (incremented on each play/pause transition)
- Any member with write role may pause/unpause (v1); server records `paused_by` / `playing_since` for UI

On transition **playing → paused**:

1. Server sets `playback_state = paused`.
2. Clients stop local engine (or freeze at current frame) and load **authoritative scene snapshot** from server (discards local runtime drift for entity set; positions in snapshot are the “layout” truth).
3. Editing resumes.

On transition **paused → playing**:

1. Server sets `playback_state = playing`.
2. Clients seed local engine from current authoritative snapshot once, then run simulation locally.
3. No scene-structure edits until paused again (spawn/delete/property commits rejected).

### 2.2 Scene document vs simulation state

**Persisted (collaborative)** — `SimulationSnapshot` subset:

- Bodies: id, kind, transform (x, y, angle), dimensions, material flags, static, visibility, displayName, layer order
- Springs: endpoints, stiffness, damping, length
- Global scene settings needed to reproduce layout: gravity on/off, bounds size reference (width/height at save time)
- Metadata: `revision`, `objectCount`, `schemaVersion`

**Not persisted (ephemeral / local)**:

- Live positions/velocities during play
- Tick counter during play
- Local history/scrub buffer
- Peer cursors, selections, annotations (optional persist for annotations already exists)

### 2.3 Edit transport: ordered scene operations (recommended v1)

Avoid shipping full snapshots on every drag. Use a small **operation log** with idempotent application:

| Op type | Payload (conceptual) |
|---------|----------------------|
| `entity.add` | full body or spring record + temp client id |
| `entity.remove` | entity id |
| `entity.patch` | id + partial fields |
| `scene.settings` | gravity, etc. |
| `batch` | ordered list (for multi-select delete) |

**Flow (pause only)**:

1. Client applies op **optimistically** to local scene store (preview during scrub already exists).
2. Client sends `apply_scene_op(room_id, base_revision, op)` to server (RPC or REST).
3. Server validates: paused, member role, object limit, schema, entity exists.
4. Server assigns `seq`, increments `scene_revision`, persists op row + updates materialized snapshot (or snapshot on checkpoint only).
5. Server broadcasts `scene_op` (+ new revision) on Realtime channel `room:{id}:scene`.
6. All clients apply op if `seq > lastAppliedSeq`; if `base_revision` stale, client fetches full snapshot.

**Why ops over CRDT**: Low complexity, matches “Canva-like” discrete edits, easy audit trail, reuses `room_actions` spirit. CRDT is unnecessary until offline/multi-tab becomes a requirement.

**Checkpoint**: Every N ops or T seconds, server writes `rooms.scene_snapshot` jsonb + `scene_revision` for fast join and recovery.

### 2.4 Join & catch-up

```
Client                          Server
  │ join room (auth)               │
  │──────────────────────────────►│ load membership + room row
  │◄──────────────────────────────│ snapshot + revision + playback_state
  │ subscribe scene + presence     │
  │ apply snapshot → local engine    │
  │ if playing: run local sim        │
  │ if paused: wait for ops          │
```

Late joiners never apply other users’ in-flight drags—only committed ops (commit on mouse-up / Enter already matches this).

---

## 3. State management: server vs client

| Concern | Server (authoritative) | Client |
|---------|------------------------|--------|
| Scene structure & revision | Stores snapshot + op log; validates writes | Holds working copy; optimistic UI |
| Playback state (pause/play) | `rooms.playback_state` | `isPlaying` mirrors server; disables edits |
| Physics integration | None at runtime | Matter engine, tick, history |
| Who can edit | RLS + RPC role checks | `canWriteInRoom`; hide tools if spectator |
| Presence (cursor, selection) | Relay via Realtime or WS | Publish throttled; render overlays |
| Chat / activity log | Postgres + Realtime INSERT | Append-only UI |
| Avatars | `profiles.avatar_seed` or hash(user_id) | Render from seed |
| Object limit | Count in snapshot before accept op | Pre-check UX; disable spawn at cap |

**Single writer rule for playback**: Server serializes play/pause RPCs so two users cannot race “play” and “pause” without a single resulting state.

**Client simulation store** (`simulationStore`) remains the runtime source during play. **Scene store** (new or extended) holds authoritative paused document and sync cursor (`lastSeq`, `revision`). On pause, scene store → `initEngine(seed from snapshot)`.

---

## 4. Conflict prevention

### 4.1 Primary: pause gate (hard)

- All mutating RPCs check `playback_state = 'paused'`.
- Clients set `locked = isPlaying || !canWrite` (already in PropertyInspector).
- Server is source of truth; client-only edits impossible for members without bypass.

### 4.2 Secondary: revision + monotonic sequence (soft)

- Client sends `base_revision` with each op.
- If `base_revision < server.revision`, server still applies op (last-writer on field level is dangerous) **or** returns `409 STALE` with fresh snapshot.

**Recommended v1 policy**:

- **Structural ops** (add/remove): require `base_revision === server.revision` or reject.
- **Property patches** on existing ids: allow if entity still exists; server merges; broadcast wins by `seq` order (total order on server).

This avoids two users deleting the same body producing ghosts.

### 4.3 Tertiary: entity-scoped presence (UX, not security)

- Broadcast `selection: { entityIds[], tool }` at 10–20 Hz max.
- Renderer draws **ownership tint** on entities selected by others (see §6).
- Optional soft lock: if peer has entity X selected, show warning but still allow edit (v1); hard lock is optional v2.

### 4.4 Simultaneous edit scenarios

| Scenario | Resolution |
|----------|------------|
| Two users move same body while paused | Both send patches; server orders by `seq`; final position = last committed patch |
| User A deletes, User B patches | Delete at higher seq wins; patch RPC returns `entity_not_found`; B refreshes |
| User plays while other edits | Play RPC rejected if pending ops (or auto-pause first); edits rejected while playing |
| Stale client after tab sleep | On focus, `GET snapshot` if `revision` drift |

No OT/CRDT in v1—acceptable because edits are infrequent and pause-bound.

---

## 5. Selection + presence system

### 5.1 Channels (minimal)

Use **one Realtime channel per room** (or extend existing WS protocol in `@flux/shared`):

| Event | Payload | Persisted |
|-------|---------|-----------|
| `presence.sync` | full peer list | No |
| `presence.update` | cursor, selection, activeTool, avatarSeed | No |
| `playback.changed` | state, revision, actor | No (state in DB) |
| `scene.op` | seq, op, revision | Yes (ops table) |

**Throttle**: cursor 20 Hz max; selection on change only.

### 5.2 Selection model

```ts
interface PeerPresence {
  userId: string;
  displayName: string;
  avatarSeed: string;
  color: string;           // derived from seed for quick use
  cursor?: { x, y };
  selectedIds: string[];   // entity ids in scene doc
  focusedEntityId?: string; // primary for inspector mirror (optional)
  lastSeen: number;
}
```

Client publishes local `selectedIds` whenever selection changes (already wired via `sendSelection` in WS path; extend Supabase Realtime broadcast similarly).

### 5.3 Visual ownership (canvas + layers)

For each entity id, compute `selectors = peers.filter(p => p.selectedIds.includes(id))`.

| UI element | Behavior |
|------------|----------|
| Canvas outline | Dashed halo in peer color; 2+ selectors → split stripe or “contested” glyph |
| Label chip | Small tag near AABB: avatar glyph + short name |
| Layers row | Tint row background; show avatar dot |
| Inspector | If selection includes others’ exclusive focus, show read-only banner |

**No selection persistence**—refresh clears peers until they reselect.

### 5.4 Spectators

- Receive presence + scene ops + chat (read).
- Do not publish selection (or publish view-only cursor optional).
- Cannot call scene op RPCs (RLS).

---

## 6. Room persistence & update flow

### 6.1 Data model (additions)

Extend existing Postgres schema minimally:

```text
rooms
  scene_snapshot      jsonb not null
  scene_revision      bigint not null default 0
  playback_state      text not null default 'paused'
  playback_revision   bigint not null default 0
  object_limit        int not null default 64   -- or tier-based
  max_snapshot_bytes  int not null default 524288

room_scene_ops        -- append-only
  id                  uuid
  room_id             uuid fk
  seq                 bigint                  -- per-room monotonic
  actor_id            uuid
  base_revision       bigint
  op                  jsonb
  created_at          timestamptz

-- room_actions remains human-readable audit; optional mirror of op summaries
```

Indexes: `(room_id, seq)`, GIN on snapshot only if querying internals (avoid).

### 6.2 RPCs

| RPC | Purpose |
|-----|---------|
| `apply_scene_op(room_id, base_revision, op)` | Validate + append + bump revision |
| `set_playback_state(room_id, state)` | Pause/play; members only |
| `get_room_scene(room_id)` | Snapshot + revision + playback (join) |
| `checkpoint_room_scene(room_id)` | Internal/cron: compact ops → snapshot |

RLS: members insert ops; spectators select only; only service role or trigger writes snapshot materialization.

### 6.3 Persistence cadence

| Trigger | Action |
|---------|--------|
| Every committed op | Insert `room_scene_ops`; increment revision |
| Every 50 ops or 5 min idle | Update `rooms.scene_snapshot` checkpoint |
| Room empty 30 min | Final checkpoint (edge function optional) |
| Room create | Seed from catalog / `user_scenes` / test bench |

### 6.4 Client commit alignment

Map existing patterns:

- Property scrub: preview local → `commit: true` → `apply_scene_op` + `logLocalAction` summary
- Spawn/delete: single op per action
- Reset layout while paused: `scene.replace` op (admin only) or full snapshot RPC

While **playing**, `logLocalAction` may still record “user pressed play” but **must not** emit scene ops.

---

## 7. Object limit enforcement

### 7.1 Definition

**Object count** = `|bodies excluding walls/floor| + |springs|` (or include static platforms—document in schema; recommend exclude boundary walls auto-created by engine).

Default **room limit**: 64 (configurable per room or plan tier).

### 7.2 Enforcement layers

| Layer | Mechanism |
|-------|-----------|
| **Server (authoritative)** | Before `entity.add`, compute count from materialized snapshot; reject with `object_limit_reached` |
| **RPC batch** | `entity.add` with array still checks total |
| **Client UX** | Subscribe to `objectCount` + `objectLimit`; disable spawn tools at cap; toast on reject |
| **DB constraint (optional)** | Generated column `object_count` + check constraint—heavy for jsonb; prefer RPC logic v1 |

### 7.3 Deletes & limit

Removing entities frees capacity immediately on server; broadcast op updates count for all clients.

### 7.4 Import / duplicate

Duplicating selection counts as +N adds; server validates sum before apply.

---

## 8. Procedural avatar system (conceptual)

**Goals**: Recognizable at glance, no external images, stable per user, compact on wire.

### 8.1 Seed

```
avatarSeed = hash(profile.id || room.id)   // stable in room context
// or persist profiles.avatar_seed integer
```

### 8.2 Generation pipeline (deterministic)

1. **Palette**: Map seed → hue (0–360), fixed saturation/lightness bands for dark UI (e.g. HSL 75%, 55%).
2. **Glyph**: 3×3 bitmask pattern from seed bits (symmetric vertically for face-like icons) → 9-dot “constellation” or simple geometric mask.
3. **Shape variant**: `seed % 4` picks circle / rounded square / hex / diamond clip.
4. **Initials**: Optional 1–2 chars from `displayName` under glyph for accessibility.

Render via **SVG or canvas** in:

- Cursor label (PresenceOverlay)
- Layers list row
- Chat bubble prefix
- Member roster in sidebar

### 8.3 Wire format

```ts
interface AvatarDescriptor {
  seed: number;        // uint32
  hue: number;
  pattern: number;     // 9-bit
  shape: 0 | 1 | 2 | 3;
}
```

Peers can recompute locally from `seed`; no image URLs.

### 8.4 Color collision

If two peers hash to similar hues, shift second by golden-angle offset based on join order—purely visual.

---

## 9. Infrastructure map (use what exists)

| Capability | v1 choice |
|------------|-----------|
| Auth + roles | Supabase `room_members` (admin/member/guest) — **keep** |
| Scene persistence | Postgres jsonb + op log — **add** |
| Realtime broadcast | Supabase Realtime on `room_scene_ops` + presence channel — **extend** |
| Low-latency cursors | Optional `NEXT_PUBLIC_FLUX_WS_URL` — **keep as enhancement** |
| Audit trail | `room_actions` + op log — **parallel** |
| Client engine | Local Matter — **unchanged** |

Avoid new frameworks (no Yjs, no custom game server). One RPC + one Realtime channel pattern scales to hundreds of rooms on Supabase tier with snapshot checkpoints.

---

## 10. Phased delivery

### Phase A — Pause authority & snapshot (foundation)

- [ ] `playback_state` on room; `set_playback_state` RPC
- [ ] `scene_snapshot` + `scene_revision` on room
- [ ] Join loads snapshot; pause/play syncs globally
- [ ] Reject edits client-side when playing (complete server mirror)

### Phase B — Scene ops

- [ ] `room_scene_ops` + `apply_scene_op` RPC
- [ ] Realtime broadcast; client applier + stale recovery
- [ ] Wire spawn/patch/delete to ops
- [ ] Checkpoint job

### Phase C — Presence & selection polish

- [ ] Supabase presence for selection (not only WS)
- [ ] Canvas/Layers ownership UI
- [ ] Procedural avatar component from seed

### Phase D — Limits & hardening

- [ ] Object limit server enforcement + UI
- [ ] Snapshot size cap; rate limit ops/user
- [ ] Spectator/read-only paths tested

---

## 11. Failure modes & recovery

| Failure | Behavior |
|---------|----------|
| Op lost over network | Client retry with same idempotency key; server dedupes by `client_op_id` optional field |
| Realtime disconnect | Poll `get_room_scene` every N s while paused; merge by revision |
| Server reject (limit) | Roll back optimistic op; toast |
| Play during disconnect | Local play only until reconnect; on reconnect server state wins → snap back if still “paused” globally |

---

## 12. Security summary

- RLS: only members apply ops; guests read snapshot + presence.
- Validate op schema server-side (allowlist fields, max string lengths).
- Cap snapshot bytes and op rate per user.
- No trust of client object count or playback state.
- Kick/ban removes member channel subscriptions (existing kick RPC).

---

## 13. Open decisions (defaults chosen above)

| Question | Recommendation |
|----------|----------------|
| Per-user vs global pause | **Global** (simpler, matches “scene editor” mental model) |
| Full snapshot vs ops | **Ops + periodic snapshot** |
| Hard lock on selected entities | **Soft v1** (visual only) |
| Sync runtime positions | **No** (explicit non-goal) |
| Default object limit | **64** (tune per room tier) |

---

## 14. Relation to current codebase

| Existing piece | Plan alignment |
|----------------|----------------|
| `isPlaying` + inspector lock | Becomes client mirror of `rooms.playback_state` |
| `room_actions` / `logLocalAction` | Activity feed; optionally reference `scene_op.seq` |
| `collaborationStore` peers + `sendSelection` | Extend to Supabase presence; add ownership rendering |
| `profiles.avatar_color` | Migrate toward `avatar_seed` + derived hue |
| `user_scenes` / `scene_catalog` snapshots | Same jsonb schema as `rooms.scene_snapshot` |
| WebSocket protocol types in `@flux/shared` | Add `scene.op`, `playback.changed` message variants |

This document is architecture-only; implementation tasks should be split into PRs following Phase A→D.
