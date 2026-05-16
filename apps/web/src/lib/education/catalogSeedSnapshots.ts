import { FLUX_WORLD } from "@/lib/physics/worldSpace";
import { snapshotForServer, type StoredSceneSnapshot } from "@/lib/scene/storedScene";
import {
  buildCatalogCollisionIntro,
  buildCatalogFreeFall,
  buildCatalogSpringIntro,
  buildCatalogStarterMixed,
} from "@/lib/physics/testLayouts";

const W = FLUX_WORLD.WIDTH;
const H = FLUX_WORLD.HEIGHT;

const PRESETS: Record<string, () => StoredSceneSnapshot> = {
  "mechanics-starter": () => snapshotForServer(buildCatalogStarterMixed(W, H), true),
  "mechanics-free-fall": () => snapshotForServer(buildCatalogFreeFall(W, H), true),
  "mechanics-collision-lab": () => snapshotForServer(buildCatalogCollisionIntro(W, H), true),
  "mechanics-spring-studio": () => snapshotForServer(buildCatalogSpringIntro(W, H), true),
};

/** Authoring snapshot for a catalog slug — used when the DB row has no scene objects yet. */
export function catalogSnapshotForSlug(slug: string): StoredSceneSnapshot | null {
  const fn = PRESETS[slug];
  return fn ? fn() : null;
}
