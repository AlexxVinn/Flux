import type { SimBodySnapshot } from "./types";

/** Order index for a rope bead (snapshot field or `Name·N` suffix). */
export function ropeSegIndex(body: {
  displayName: string;
  ropeSegIndex?: number;
}): number {
  if (body.ropeSegIndex != null) return body.ropeSegIndex;
  const m = body.displayName.match(/·(\d+)$/);
  return m ? parseInt(m[1]!, 10) : 0;
}

export function compareRopeSegments(
  a: { displayName: string; ropeSegIndex?: number },
  b: { displayName: string; ropeSegIndex?: number },
): number {
  return ropeSegIndex(a) - ropeSegIndex(b);
}

export function ropeSegmentsFor(
  bodies: SimBodySnapshot[],
  ropeId: string,
): SimBodySnapshot[] {
  return bodies
    .filter(
      (b) => b.ropeId === ropeId && b.visible && b.entityKind === "ropeSegment",
    )
    .sort(compareRopeSegments);
}
