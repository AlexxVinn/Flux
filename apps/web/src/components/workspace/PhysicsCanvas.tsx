"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import { buildPeerMarksByEntity } from "@/lib/collaboration/peerSelection";
import { renderSimulation } from "@/lib/physics/canvasRenderer";
import { screenToWorld } from "@/lib/physics/worldSpace";
import { worldRectFromPoints, isDraggableBody } from "@/lib/physics/selectionUtils";
import { isAtSharedSetupFrame } from "@/store/simulationStore";
import { PresenceOverlay } from "@/components/collaboration/PresenceOverlay";
import { AnnotationLayer } from "@/components/collaboration/AnnotationLayer";
import { useRoomSessionStore, useCanWriteInRoom } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import {
  applyCollaborativeSceneFromStore,
  markLocalSceneRevisionApplied,
  pullAndApplyRemoteScene,
} from "@/lib/collaboration/remoteSceneSync";
import { rpcGetRoomScene } from "@/lib/scene/roomSceneApi";

interface PhysicsCanvasProps {
  benchId?: string | null;
}

export function PhysicsCanvas({ benchId = null }: PhysicsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const initEngine = useSimulationStore((s) => s.initEngine);
  const hydrateFromStoredScene = useSimulationStore((s) => s.hydrateFromStoredScene);
  const setPlaying = useSimulationStore((s) => s.setPlaying);
  const resize = useSimulationStore((s) => s.resize);
  const tick = useSimulationStore((s) => s.tick);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const selectEntity = useSimulationStore((s) => s.selectEntity);
  const selectInMarquee = useSimulationStore((s) => s.selectInMarquee);
  const clearSelection = useSimulationStore((s) => s.clearSelection);
  const spawnAt = useSimulationStore((s) => s.spawnAt);
  const pickAt = useSimulationStore((s) => s.pickAt);
  const beginDrag = useSimulationStore((s) => s.beginDrag);
  const dragTo = useSimulationStore((s) => s.dragTo);
  const endDrag = useSimulationStore((s) => s.endDrag);
  const panCameraByScreen = useSimulationStore((s) => s.panCameraByScreen);

  const connect = useCollaborationStore((s) => s.connect);
  const disconnect = useCollaborationStore((s) => s.disconnect);
  const sendCursor = useCollaborationStore((s) => s.sendCursor);
  const sendSelection = useCollaborationStore((s) => s.sendSelection);
  const annotationTool = useCollaborationStore((s) => s.activeAnnotationTool);
  const addDraftPoint = useCollaborationStore((s) => s.addDraftPoint);
  const clearDraft = useCollaborationStore((s) => s.clearDraft);
  const addAnnotation = useCollaborationStore((s) => s.addAnnotation);
  const draftAnnotation = useCollaborationStore((s) => s.draftAnnotation);
  const canWrite = useCanWriteInRoom();
  const [annotationPreview, setAnnotationPreview] = useState<{ x: number; y: number } | null>(
    null,
  );

  const dragTargetRef = useRef<string | null>(null);
  const lastCursorSendRef = useRef(0);
  const isPanningRef = useRef(false);
  const panLastClientRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<{
    startWorld: { x: number; y: number };
    currentWorld: { x: number; y: number };
    startScreen: { x: number; y: number };
    mode: "replace" | "add";
  } | null>(null);

  const MARQUEE_THRESHOLD_PX = 4;

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { width: 800, height: 600 };
    const { width, height } = el.getBoundingClientRect();
    return { width: Math.floor(width), height: Math.floor(height) };
  }, []);

  const membership = useRoomSessionStore((s) => s.membership);
  const supabaseConnected = useCollaborationStore((s) => s.supabaseConnected);
  const collabRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const sceneRevision = useRoomSceneCollaborationStore((s) => s.sceneRevision);

  useEffect(() => {
    if (!membership?.roomId) return;
    connect();
    return () => disconnect();
  }, [membership?.roomId, connect, disconnect]);

  /** Apply remote scene revisions to Matter as soon as the collab store advances. */
  useEffect(() => {
    if (!collabRoomId || collabRoomId !== membership?.roomId) return;
    if (!supabaseConnected) return;
    if (!useSimulationStore.getState().engine) return;
    const applied = applyCollaborativeSceneFromStore(false, false);
    if (!applied) void pullAndApplyRemoteScene({ refitCamera: false });
  }, [sceneRevision, collabRoomId, membership?.roomId, supabaseConnected]);

  useEffect(() => {
    sendSelection(selectedIds);
  }, [selectedIds, sendSelection]);
  const seedLayoutKeyRef = useRef<{ roomId: string | undefined; benchKey: string | null } | null>(
    null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const roomId = membership?.roomId;
    const benchKey = benchId ?? null;
    const prev = seedLayoutKeyRef.current;
    if (prev !== null && (prev.roomId !== roomId || prev.benchKey !== benchKey)) {
      useSimulationStore.getState().tearDownForRoomChange();
    }
    seedLayoutKeyRef.current = { roomId, benchKey };

    let cancelled = false;

    const seedEngine = async (w: number, h: number) => {
      if (w < 8 || h < 8) return;

      const m = membership;
      const expectedRoomId = m?.roomId ?? null;

      if (expectedRoomId && m) {
        useRoomSceneCollaborationStore.getState().rebindToMembershipIfStale(
          m,
          useRoomSessionStore.getState().collabBindingEpoch,
        );
      }

      if (expectedRoomId && supabaseConnected) {
        const raw = await rpcGetRoomScene(expectedRoomId);
        if (cancelled) return;
        if (useRoomSessionStore.getState().membership?.roomId !== expectedRoomId) return;
        if (raw) useRoomSceneCollaborationStore.getState().ingestJoinPayload(raw);
      }

      const collab = useRoomSceneCollaborationStore.getState();
      const snap = collab.lastServerSnapshot;
      const hasServerContent =
        !!snap &&
        (snap.bodies.length > 0 ||
          snap.springs.length > 0 ||
          (snap.ropes?.length ?? 0) > 0 ||
          collab.sceneRevision > 0);

      if (
        expectedRoomId &&
        useRoomSessionStore.getState().membership?.roomId === expectedRoomId &&
        supabaseConnected &&
        hasServerContent &&
        snap
      ) {
        hydrateFromStoredScene(w, h, snap, false);
        markLocalSceneRevisionApplied(collab.sceneRevision, expectedRoomId);
      } else {
        initEngine(w, h, benchId);
        if (expectedRoomId && supabaseConnected) {
          setPlaying(false);
        }
      }
      setSize({ width: w, height: h });
    };

    const ro = new ResizeObserver(() => {
      const { width, height } = measure();
      const hasEngine = useSimulationStore.getState().engine !== null;
      if (!hasEngine) {
        void seedEngine(width, height);
      } else {
        resize(width, height);
        setSize({ width, height });
      }
    });

    ro.observe(el);

    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      const { width, height } = measure();
      if (useSimulationStore.getState().engine === null) {
        await seedEngine(width, height);
      }
    })();

    return () => {
      cancelled = true;
      ro.disconnect();
      useSimulationStore.getState().tearDownForRoomChange();
    };
  }, [
    benchId,
    hydrateFromStoredScene,
    initEngine,
    measure,
    membership?.roomId,
    resize,
    setPlaying,
    supabaseConnected,
  ]);

  useEffect(() => {
    const loop = (now: number) => {
      const dt = lastRef.current ? now - lastRef.current : 16;
      lastRef.current = now;
      tick(dt);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const el = containerRef.current;
      if (!ctx || !canvas || !el) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const { width, height } = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const sim = useSimulationStore.getState();
      const collab = useCollaborationStore.getState();
      const peerMarksByEntity = buildPeerMarksByEntity(
        collab.peers,
        sim.snapshot,
        collab.userId,
      );
      const marquee = marqueeRef.current;
      const selectionMarquee = marquee
        ? worldRectFromPoints(
            marquee.startWorld.x,
            marquee.startWorld.y,
            marquee.currentWorld.x,
            marquee.currentWorld.y,
          )
        : null;

      const previewEnd = sim.springPreviewEnd;
      const linkPlacementPreview = (() => {
        if (!previewEnd) return null;
        if (sim.springPending) {
          return {
            from: { x: sim.springPending.worldX, y: sim.springPending.worldY },
            to: previewEnd,
            kind: "spring" as const,
          };
        }
        if (sim.ropePending) {
          return {
            from: { x: sim.ropePending.worldX, y: sim.ropePending.worldY },
            to: previewEnd,
            kind: "rope" as const,
          };
        }
        return null;
      })();

      renderSimulation(ctx, sim.snapshot, {
        width,
        height,
        camera: sim.camera,
        selectedIds: sim.selectedIds,
        hoveredId: sim.hoveredId,
        debug: sim.debug,
        gravityForBody: sim.getGravityForce,
        collisions: sim.getCollisions(),
        selectionMarquee,
        peerMarksByEntity,
        linkPlacementPreview,
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const factor = ev.deltaY > 0 ? 0.9 : 1.1;
      useSimulationStore.getState().zoomCameraAtScreenPoint(sx, sy, factor);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const canvasPointer = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      vw: rect.width,
      vh: rect.height,
    };
  };

  const pointerToWorld = (
    screen: { x: number; y: number },
    vw: number,
    vh: number,
  ) => {
    const { camera } = useSimulationStore.getState();
    return screenToWorld(screen.x, screen.y, vw, vh, camera);
  };

  const handleAnnotationClick = (pt: { x: number; y: number }) => {
    if (!annotationTool) return false;

    if (annotationTool === "text") {
      const text = window.prompt("Annotation text", "Note") ?? "Note";
      addAnnotation("text", [pt], text, true);
      clearDraft();
      return true;
    }

    if (draftAnnotation.length === 0) {
      addDraftPoint(pt);
      return true;
    }

    const start = draftAnnotation[0]!;
    addAnnotation(annotationTool, [start, pt], undefined, true);
    clearDraft();
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      panLastClientRef.current = { x: e.clientX, y: e.clientY };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const cp = canvasPointer(e);
    if (!cp) return;
    canvasRef.current?.setPointerCapture(e.pointerId);

    const pt = pointerToWorld(cp.screen, cp.vw, cp.vh);

    if (annotationTool) {
      handleAnnotationClick(pt);
      return;
    }

    if (activeTool !== "select") {
      if (canWrite) {
        spawnAt(pt.x, pt.y, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
      }
      return;
    }

    const sim = useSimulationStore.getState();
    const canEdit =
      canWrite &&
      (!membership?.roomId ||
        isAtSharedSetupFrame({
          historyIndex: sim.historyIndex,
          historyLength: sim.historyLength,
        }));

    const subtract = e.ctrlKey;
    const additive = (e.shiftKey || e.metaKey) && !subtract;
    const hit = pickAt(pt.x, pt.y);

    if (!hit) {
      marqueeRef.current = {
        startWorld: pt,
        currentWorld: pt,
        startScreen: cp.screen,
        mode: additive ? "add" : "replace",
      };
      return;
    }

    if (subtract) {
      selectEntity(hit, { subtract: true });
    } else if (additive) {
      selectEntity(hit, { additive: true });
    } else if (!sim.selectedIds.includes(hit)) {
      selectEntity(hit);
    }

    const body = sim.snapshot.bodies.find((b) => b.id === hit);
    if (canEdit && body && isDraggableBody(body)) {
      dragTargetRef.current = hit;
      beginDrag(hit, pt.x, pt.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current && panLastClientRef.current) {
      const prev = panLastClientRef.current;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      panLastClientRef.current = { x: e.clientX, y: e.clientY };
      panCameraByScreen(dx, dy);
      return;
    }

    const cp = canvasPointer(e);
    if (!cp) return;
    const pt = pointerToWorld(cp.screen, cp.vw, cp.vh);
    const now = performance.now();

    if (now - lastCursorSendRef.current > 50) {
      lastCursorSendRef.current = now;
      sendCursor(pt);
    }

    if (annotationTool && draftAnnotation.length === 1) {
      setAnnotationPreview(pt);
      return;
    }

    const marquee = marqueeRef.current;
    if (marquee) {
      marquee.currentWorld = pt;
      return;
    }

    const id = dragTargetRef.current;
    if (id) {
      dragTo(id, pt.x, pt.y);
      return;
    }

    const simState = useSimulationStore.getState();
    if (simState.activeTool === "spring" && simState.springPending) {
      simState.updateSpringPreviewFromPointer(pt.x, pt.y, e.ctrlKey, e.shiftKey);
    } else if (simState.activeTool === "rope" && simState.ropePending) {
      simState.updateRopePreviewFromPointer(pt.x, pt.y, e.ctrlKey, e.shiftKey);
    }

    if (activeTool !== "select") return;
    const hit = pickAt(pt.x, pt.y);
    useSimulationStore.getState().setHovered(hit);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button === 1) {
      isPanningRef.current = false;
      panLastClientRef.current = null;
    }

    const marquee = marqueeRef.current;
    if (marquee) {
      const cp = canvasPointer(e);
      if (cp) {
        const end = pointerToWorld(cp.screen, cp.vw, cp.vh);
        const dx = cp.screen.x - marquee.startScreen.x;
        const dy = cp.screen.y - marquee.startScreen.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= MARQUEE_THRESHOLD_PX) {
          const rect = worldRectFromPoints(
            marquee.startWorld.x,
            marquee.startWorld.y,
            end.x,
            end.y,
          );
          selectInMarquee(rect, marquee.mode);
        } else if (marquee.mode === "replace") {
          clearSelection();
        }
      }
      marqueeRef.current = null;
    }

    dragTargetRef.current = null;
    endDrag();
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerLeave = () => {
    if (!dragTargetRef.current) {
      useSimulationStore.getState().setHovered(null);
    }
  };

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 bg-black">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${
          activeTool === "select" ? "cursor-default" : "cursor-crosshair"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      <AnnotationLayer
        width={size.width}
        height={size.height}
        previewEnd={annotationPreview}
      />
      <PresenceOverlay width={size.width} height={size.height} />
    </div>
  );
}
