"use client";

import { useState, useRef, useEffect } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import type { LayerEntity } from "@/lib/physics/types";
import { layerEntityLocked } from "@/lib/physics/entityLock";

function entityIcon(entity: LayerEntity): string {
  if (entity.type === "markup") {
    if (entity.data.kind === "text") return "T";
    if (entity.data.kind === "measure") return "↔";
    return "→";
  }
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
      className={`inspector-list-item group w-full ${
        selected ? "inspector-list-item--selected" : ""
      } ${hovered && !selected ? "bg-white/[0.03]" : ""} ${!visible ? "inspector-list-item--dim" : ""}`}
    >
      <span className="w-3 shrink-0 text-center text-[10px] text-white/28" title={layerEntityLocked(entity) ? "Locked" : undefined}>
        {layerEntityLocked(entity) ? "🔒" : entityIcon(entity)}
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
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{entityName(entity)}</span>
      )}
      <button
        type="button"
        title={visible ? "Hide" : "Show"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
        className="shrink-0 rounded p-0.5 text-[10px] text-white/30 opacity-0 transition hover:text-white/55 group-hover:opacity-100"
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
    <div
      className={`flex min-h-0 flex-col ${bare ? "min-h-[120px] flex-1" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) clearSelection();
      }}
    >
      <div className={`inspector-list flux-scroll min-h-0 flex-1 overflow-y-auto ${bare ? "pb-2" : ""}`}>
        {layers.length === 0 ? (
          <p className="inspector-muted px-3 py-4">No entities</p>
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
    </div>
  );
}
