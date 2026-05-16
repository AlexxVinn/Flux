# Flux

**Collaborative Newtonian mechanics** in the browser: shared rooms, Matter.js simulation, Supabase-backed scenes, and a workspace built for instruction and labs.

![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9.15.0-F69220?logo=pnpm&logoColor=white)

---

## Highlights

- **Rooms** — Create or join with a **6-digit code**; roles include admin, member (edit), and spectator (read-only / guest on public rooms).
- **Scene collaboration** — Authoritative scene document with **revisioned** ops (bodies, springs, gravity); realtime sync via Supabase.
- **Mechanics workspace** — Canvas, timeline, layers, inspector, curated **engine benches** (stress-test presets), and **starter labs** from the `scene_catalog`.
- **Auth** — Email/password via **Supabase Auth**; profiles with display names; middleware-aware SSR client.

---

## Monorepo layout

```
apps/web           Next.js 15 app — home hub, auth, workspace UI
apps/server        Optional WebSocket server for live cursors (see env)
packages/shared    Shared TypeScript types & protocols (@flux/shared)
packages/sim-core  Simulation / ECS utilities (evolving)
supabase/migrations Postgres schema, RLS, RPCs for rooms & scenes
docs/plans         Design notes (auth, rooms, scenes roadmap)
```

---

## Prerequisites

- **Node.js** ≥ 20  
- **pnpm** 9.x (see root `packageManager` field)  
- A **Supabase** project if you want auth, rooms, and catalog (local or hosted)

---

## Quick start

```bash
git clone <your-fork-or-repo-url> flux
cd flux
corepack enable
pnpm install
```

### Environment (web)

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` and set your Supabase **project URL** and **anon** or **publishable** key. Optional: `NEXT_PUBLIC_FLUX_WS_URL` for the cursor WebSocket server, and `NEXT_PUBLIC_FLUX_ROOM_SLUG` for the default public room slug.

### Database

Apply migrations to your Supabase database (from repo root, with [Supabase CLI](https://supabase.com/docs/guides/cli) linked to your project):

```bash
supabase db push
# or run SQL migrations in supabase/migrations/ in order via the dashboard SQL editor
```

### Run the web app

```bash
pnpm dev
# same as: pnpm dev:web
```

Open [http://localhost:3000](http://localhost:3000): sign in or join a public room as a guest, open **starter labs** or **engine benches**, then enter `/workspace/[module]/[roomSlug]`.

### Optional: collaboration WebSocket server

```bash
pnpm dev:server
```

Set `NEXT_PUBLIC_FLUX_WS_URL` in `apps/web/.env.local` (e.g. `ws://localhost:3001`) if you run this stack.

---

## Scripts (root)

| Command | Description |
|--------|-------------|
| `pnpm dev` / `pnpm dev:web` | Next.js dev server (`apps/web`) |
| `pnpm dev:server` | Optional WS server (`apps/server`) |
| `pnpm build` | Build all packages that define `build` |
| `pnpm typecheck` | Typecheck all workspaces |

---

## Tech stack

| Area | Choice |
|------|--------|
| UI | Next.js 15, React 19, Tailwind CSS |
| State | Zustand |
| Physics | Matter.js (isolated under `apps/web/src/lib/physics/`) |
| Backend | Supabase (Postgres, Auth, Realtime) |
| Types | `@flux/shared` |

---

## Documentation

- **Auth, rooms, scenes** — [`docs/plans/AUTH_ROOMS_SCENES.md`](docs/plans/AUTH_ROOMS_SCENES.md)

---

## Contributing

Issues and PRs are welcome. Please run `pnpm typecheck` before submitting changes.

---

## License

No license file is bundled in this repository yet. Add a `LICENSE` of your choice before redistributing or clarify terms for contributors.
