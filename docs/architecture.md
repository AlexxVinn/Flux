# flux Architecture

flux is a collaborative multiplayer physics experimentation platform: shared workspaces, modular engines, authoritative multiplayer, and timeline-first state.

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (apps/web)                                          │
│  Workspace UI · Tools · Canvas renderer · Prediction          │
└──────────────────────────┬──────────────────────────────────┘
                           │ actions ↑  deltas ↓
┌──────────────────────────▼──────────────────────────────────┐
│  SERVER (apps/server)                                       │
│  Room manager · Validation · Authoritative sim · Persistence│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  SIMULATION CORE (packages/sim-core)                        │
│  Orchestrator · WorldState · Event bus · Engine scheduler   │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Mechanics          Thermodynamics      (future: EM, fluids)
```

## Design Principles

| Principle | Rule |
|-----------|------|
| WorldState is data only | Serializable snapshots; no physics logic |
| Engines are isolated | Read/write declared components only |
| Coupling via ports | Cross-engine effects use typed port messages |
| ECS, not inheritance | Entities = ID + component bag |
| Authoritative multiplayer | Server simulates; clients send actions |
| Timeline-ready | Every tick produces an immutable snapshot |

## Monorepo Layout

```
flux/
├── apps/
│   ├── web/                 # React workspace client
│   └── server/              # Node authoritative server
├── packages/
│   ├── shared/              # IDs, actions, wire protocol, math utils
│   ├── sim-core/            # WorldState, ECS, orchestrator, engines
│   └── plugins-api/         # Plugin registration contracts
└── docs/
```

## WorldState

`WorldState` is the single source of truth for **what exists**, not **how it moves**.

- `tick`, `time`, `schemaVersion`
- `entities: Map<EntityId, ComponentBag>` — component data only
- `constraints` — springs, joints (data)
- `metadata` — experiment name, units, tags

Physics integration results (velocities, temperatures after a step) are written back into component fields by engines during `step()`, then committed into the next snapshot for timeline/history.

## ECS Model

```typescript
Entity = EntityId
ComponentBag = { [ComponentKind]: ComponentData }

// Example components (MVP)
TransformComponent      // position, rotation
RigidBodyComponent      // velocity, mass, forces accumulator
ColliderComponent       // shape, restitution, friction
MaterialComponent       // density, specific heat
ThermalComponent        // temperature, heat capacity
SpringConstraintComponent
```

Engines declare:

- `reads: ComponentKind[]`
- `writes: ComponentKind[]`
- `ports: PortDefinition[]`

Query: orchestrator passes entities matching `reads` to each engine.

## Engine Orchestration

Fixed timestep (default 1/60s). Per tick:

1. **Drain action queue** — apply validated client actions to WorldState
2. **Pre-step event bus** — optional hooks
3. **Run engines in scheduler order**:
   - Mechanics (integrate, collisions, constraints, emit friction heat port messages)
   - Thermodynamics (consume port messages, update temperatures)
4. **Commit snapshot** — clone WorldState → timeline ring buffer
5. **Emit delta** — component-level diffs since last broadcast tick

Scheduler order is explicit and configurable per experiment template; coupling rules never call engine internals directly.

## Port / Coupling System

```typescript
// Mechanics → Thermodynamics (MVP)
FrictionHeatMessage {
  entityId: EntityId
  energyJoules: number
  surfaceArea: number
}
```

- Outbound: engine pushes to `PortBus` during step
- Inbound: downstream engine drains relevant port queues at step start
- No shared mutable singletons between engines

## Multiplayer Synchronization

### Client → Server (actions)

- `createEntity`, `deleteEntity`, `setComponent`, `applyForce`, `connectSpring`, …
- Each action: `actionId`, `clientTime`, `payload`
- Server validates (bounds, permissions, schema), applies to queue

### Server → Clients (deltas)

- Not full state every frame
- `StateDelta`: `{ tick, entityPatches: { id → partial components }, removedEntities, constraintPatches }`
- Periodic keyframes (full snapshot every N seconds) for join/late sync

### Join flow

1. Client connects WebSocket → `joinRoom(roomId, userId)`
2. Server sends `Keyframe` + `tick`
3. Client applies keyframe, then streams deltas
4. Client sends actions with monotonic `sequence`; server acks or rejects

### Determinism

- Fixed timestep only on server
- No `Date.now()` inside engines
- Seeded RNG in `WorldMetadata` when randomness is needed
- IEEE float order: document known non-determinism; prefer stable iteration order (sorted entity IDs)

## Rendering (Client)

- **Simulation state** lives in sim-core (shared with server package)
- **Renderer** is client-only: reads WorldState, never mutates it
- MVP: Canvas 2D (`CanvasRenderer`) with clear separation:
  - `SimulationViewModel` — interpolated state for display
  - `CanvasRenderer.draw(world, selection, toolState)`
- Future: WebGL layer behind same `Renderer` interface

## Plugin System (Foundations)

Plugins register via `plugins-api`:

- `components` — schema + defaults
- `systems` — optional `SimulationEngine` implementation
- `tools` — workspace pointer handlers
- `ports` — coupling types

Host loads plugins at startup; orchestrator merges engine list and component registry. MVP uses built-in engines only; API is stable for third-party extensions.

## Timeline / History

From day one:

- `SnapshotStore` — append-only tick snapshots (in-memory MVP; persisted later)
- `scrubTo(tick)` — restore WorldState copy
- Future: branches = fork snapshot ID + divergent action log

## MVP Phases

| Phase | Deliverable |
|-------|-------------|
| **0 — Foundation** (current) | Monorepo, WorldState, ECS, orchestrator, mechanics+thermal stub, protocol, server room skeleton, web shell |
| **1 — Mechanics** | Integration, AABB collisions, drag, springs, friction |
| **2 — Thermal coupling** | Friction → heat, inspector shows temperature |
| **3 — Multiplayer** | WebSocket rooms, action validation, delta broadcast |
| **4 — Workspace UX** | Hierarchy, inspector, toolbar tools, selection |
| **5 — Timeline** | Scrubber, replay, snapshot branches (basic) |
| **6 — Polish** | Prediction, interpolation, keyframes, persistence |

## Technology Choices

- **TypeScript** — shared types client/server
- **pnpm workspaces** — monorepo
- **Zustand** (web) — UI/session state only; sim state in sim-core
- **ws** (server) — WebSockets
- **Vite + React** (web)
