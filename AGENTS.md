# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Flux is a collaborative Newtonian mechanics physics sandbox — a pnpm monorepo with a Next.js 15 web app, an optional WebSocket server for live cursors, and shared TypeScript packages. Supabase provides the backend (Postgres, Auth, Realtime).

### Prerequisites (already on the VM)

- Node.js >= 20 (via nvm)
- pnpm 9.15.0 (`corepack enable` activates it)
- Docker (required for local Supabase)

### Running the dev environment

1. **Start Docker** (if not running):
   ```
   sudo dockerd &>/tmp/dockerd.log &
   ```
   Wait a few seconds for the daemon to initialize.

2. **Start local Supabase** (first time pulls ~1GB of images; subsequent starts are fast):
   ```
   npx supabase@latest start
   ```
   This runs Postgres + Auth + Realtime + REST locally. Note the API URL (`http://127.0.0.1:54321`) and keys printed at the end.

3. **Create `apps/web/.env.local`** (if missing):
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from supabase status>
   NEXT_PUBLIC_FLUX_ROOM_SLUG=mechanics-default
   ```
   Run `npx supabase@latest status -o env` to get current keys.

4. **Start the web app**:
   ```
   pnpm dev
   ```
   Opens at http://localhost:3000.

### Key commands (documented in root package.json)

| Command | What it does |
|---------|-------------|
| `pnpm dev` / `pnpm dev:web` | Next.js dev server (port 3000) |
| `pnpm dev:server` | Optional WS cursor server (port 3001) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check across all workspaces |

### Non-obvious gotchas

- **Build order matters**: `@flux/shared` must be built before `@flux/sim-core`, and both before `apps/web` or `apps/server` can typecheck. Running `pnpm build` handles this via the `-r` flag, but individual workspace typechecks will fail if dependencies are not built first.
- **Docker socket permissions**: After installing Docker, you may need `sudo chmod 666 /var/run/docker.sock` for non-root access.
- **Docker nested environment**: This VM uses `fuse-overlayfs` storage driver and `iptables-legacy`. The daemon config is at `/etc/docker/daemon.json`.
- **Initial migration was incomplete**: The file `supabase/migrations/20260515150000_flux_initial_schema.sql` was missing table definitions for `room_members`, `room_messages`, `room_annotations`, and `room_actions`. These have been added so that `supabase start` applies all migrations successfully.
- **Supabase stop/start**: If migrations change, run `npx supabase@latest stop` then `npx supabase@latest start` to re-apply from scratch.
- **Email confirmation**: The local Supabase instance auto-confirms emails. Sign up works immediately without checking a mailbox.
- **`apps/web/.env.local` is gitignored**: Each agent session must create it fresh using keys from `npx supabase@latest status -o env`.
