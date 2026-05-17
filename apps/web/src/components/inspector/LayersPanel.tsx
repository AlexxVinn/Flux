"use client";

import { useState, useRef, useEffect } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import type { LayerEntity } from "@/lib/physics/types";

function entityIcon(entity: LayerEntity): string {
  if (entity.type === "spring") return "⌇";
  if (entity.type === "rope") return "⎯";
  const k = entity.data.entityKind;
  if (k === "circle") return "○";
  if (k === "wall") return "▢";
  if (k === "floor") return "▬";
  if (k === "collisionBounds") return "⎕";
  return "□";
}

function entityId(entity: LayerEntity): string {
  return entity.type === "body" ? entity.data.id : entity.data.id;
}

function entityName(entity: LayerEntity): string {
  return entity.data.displayName;
}

function entityVisible(entity: LayerEntity): boolean {
  return entity.data.visible;
}

function LayerRow({
  entity,
  selected,
  hovered,
  onSelect,
  onHover,
  onRename,
  onToggleVisible,
}: {
  entity: LayerEntity;
  selected: boolean;
  hovered: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onHover: (enter: boolean) => void;
  onRename: (name: string) => void;
  onToggleVisible: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entityName(entity));
  const inputRef = useRef<HTMLInputElement>(null);
  const id = entityId(entity);
  const visible = entityVisible(entity);

  useEffect(() => {
    if (!editing) setDraft(entityName(entity));
  }, [entity, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== entityName(entity)) onRename(t);
    else setDraft(entityName(entity));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(e as unknown as React.MouseEvent);
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
        selected
          ? "bg-white/12 text-flux-text ring-1 ring-white/20"
          : hovered
            ? "bg-white/6 text-flux-text"
            : "text-flux-muted hover:bg-white/4 hover:text-flux-text"
      } ${!visible ? "opacity-45" : ""}`}
    >
      <span className="w-3 shrink-0 text-center text-[10px] text-flux-muted">
        {entityIcon(entity)}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(entityName(entity));
              setEditing(false);
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-flux-focus bg-flux-bg px-1 py-0 font-mono text-[10px] text-flux-text outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono">{entityName(entity)}</span>
      )}
      <button
        type="button"
        title={visible ? "Hide" : "Show"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
        className="shrink-0 rounded p-0.5 text-[10px] text-flux-muted opacity-0 hover:bg-white/10 hover:text-flux-text group-hover:opacity-100"
        aria-label={visible ? `Hide ${id}` : `Show ${id}`}
      >
        {visible ? "◉" : "◎"}
      </button>
    </div>
  );
}

export function LayersPanel({ bare = false }: { bare?: boolean }) {
  const layers = useSimulationStore((s) => s.layers);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const hoveredId = useSimulationStore((s) => s.hoveredId);
  const selectEntity = useSimulationStore((s) => s.selectEntity);
  const setHovered = useSimulationStore((s) => s.setHovered);
  const renameEntity = useSimulationStore((s) => s.renameEntity);
  const setEntityVisible = useSimulationStore((s) => s.setEntityVisible);
  const clearSelection = useSimulationStore((s) => s.clearSelection);

  const selectedSet = new Set(selectedIds);

  return (
    <section className={bare ? "flex min-h-0 flex-col" : "flex min-h-0 flex-col border-b border-flux-border"}>
      {!bare && (
        <div className="flex items-center justify-between px-2 py-1.5">
          <h3 className="text-[9px] font-semibold uppercase tracking-widest text-flux-muted">
            Layers
          </h3>
          <span className="font-mono text-[9px] text-flux-muted">{layers.length}</span>
        </div>
      )}
      <div
        className={`flux-scroll overflow-y-auto px-1 pb-2 ${bare ? "max-h-52" : "max-h-44"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) clearSelection();
        }}
      >
        {layers.length === 0 ? (
          <p className="px-2 py-2 text-[10px] text-flux-muted">No entities</p>
        ) : (
          layers.map((entity) => {
            const id = entityId(entity);
            return (
              <LayerRow
                key={id}
                entity={entity}
                selected={selectedSet.has(id)}
                hovered={hoveredId === id}
                onSelect={(e) => {
                  selectEntity(id, {
                    additive: (e.shiftKey || e.metaKey) && !e.ctrlKey,
                    subtract: e.ctrlKey,
                  });
                }}
                onHover={(enter) => setHovered(enter ? id : null)}
                onRename={(name) => renameEntity(id, name)}
                onToggleVisible={() =>
                  setEntityVisible(id, !entityVisible(entity))
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
