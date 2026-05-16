"use client";

import type { CanvasAnnotation } from "@flux/shared";
import { worldToScreen, type SceneCamera } from "@/lib/physics/worldSpace";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useSimulationStore } from "@/store/simulationStore";

function mapPoint(
  p: { x: number; y: number },
  space: CanvasAnnotation["coordinateSpace"],
  w: number,
  h: number,
  cam: SceneCamera,
) {
  if (space === "world") return worldToScreen(p.x, p.y, w, h, cam);
  return p;
}

export function AnnotationLayer({
  width,
  height,
  previewEnd,
}: {
  width: number;
  height: number;
  previewEnd?: { x: number; y: number } | null;
}) {
  const annotations = useCollaborationStore((s) => s.annotations);
  const draft = useCollaborationStore((s) => s.draftAnnotation);
  const tool = useCollaborationStore((s) => s.activeAnnotationTool);
  const camera = useSimulationStore((s) => s.camera);
  const draftPoints =
    draft.length === 1 && previewEnd ? [draft[0]!, previewEnd] : draft;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5]"
      width={width}
      height={height}
      aria-hidden
    >
      {annotations.map((a) => (
        <AnnotationShape key={a.id} annotation={a} width={width} height={height} camera={camera} />
      ))}
      {tool && draftPoints.length > 0 && (
        <DraftPreview
          tool={tool}
          points={draftPoints}
          width={width}
          height={height}
          camera={camera}
        />
      )}
    </svg>
  );
}

function DraftPreview({
  tool,
  points,
  width,
  height,
  camera,
}: {
  tool: NonNullable<ReturnType<typeof useCollaborationStore.getState>["activeAnnotationTool"]>;
  points: { x: number; y: number }[];
  width: number;
  height: number;
  camera: SceneCamera;
}) {
  const mapped = points.map((p) => mapPoint(p, "world", width, height, camera));
  return (
    <g opacity={0.7} stroke="#fbbf24" fill="none" strokeWidth={1.5}>
      {tool === "arrow" && mapped.length >= 2 && (
        <line x1={mapped[0]!.x} y1={mapped[0]!.y} x2={mapped[1]!.x} y2={mapped[1]!.y} />
      )}
      {tool === "measure" && mapped.length >= 2 && (
        <>
          <line
            x1={mapped[0]!.x}
            y1={mapped[0]!.y}
            x2={mapped[1]!.x}
            y2={mapped[1]!.y}
            strokeDasharray="4 3"
          />
          <text
            x={(mapped[0]!.x + mapped[1]!.x) / 2}
            y={(mapped[0]!.y + mapped[1]!.y) / 2 - 6}
            fill="#fbbf24"
            fontSize={10}
            fontFamily="monospace"
            textAnchor="middle"
          >
            {Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y).toFixed(0)} wu
          </text>
        </>
      )}
    </g>
  );
}

function AnnotationShape({
  annotation,
  width,
  height,
  camera,
}: {
  annotation: CanvasAnnotation;
  width: number;
  height: number;
  camera: SceneCamera;
}) {
  const { kind, points, text, authorName, coordinateSpace } = annotation;
  const space = coordinateSpace ?? "screen";
  const color = "rgba(251,191,36,0.9)";
  const unit = space === "world" ? "wu" : "px";

  if (kind === "arrow" && points.length >= 2) {
    const [a, b] = points;
    const sa = mapPoint(a!, space, width, height, camera);
    const sb = mapPoint(b!, space, width, height, camera);
    return (
      <g stroke={color} fill={color} strokeWidth={1.5}>
        <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} />
        <text x={sb.x + 4} y={sb.y - 4} fontSize={9} fill="rgba(255,255,255,0.5)">
          {authorName}
        </text>
      </g>
    );
  }

  if (kind === "measure" && points.length >= 2) {
    const [a, b] = points;
    const sa = mapPoint(a!, space, width, height, camera);
    const sb = mapPoint(b!, space, width, height, camera);
    const dist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
    return (
      <g stroke={color} fill="none" strokeWidth={1.5} strokeDasharray="6 3">
        <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} />
        <text
          x={(sa.x + sb.x) / 2}
          y={(sa.y + sb.y) / 2 - 6}
          fill={color}
          fontSize={10}
          fontFamily="monospace"
          textAnchor="middle"
        >
          {dist.toFixed(0)} {unit}
        </text>
      </g>
    );
  }

  if (kind === "text" && points.length >= 1) {
    const s0 = mapPoint(points[0]!, space, width, height, camera);
    return (
      <text x={s0.x} y={s0.y} fill={color} fontSize={12} fontFamily="system-ui">
        {text ?? "Note"}
      </text>
    );
  }

  return null;
}
