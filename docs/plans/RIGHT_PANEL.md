# Right panel — UX & implementation plan

> **Maintenance rule**: Delete sections here once shipped and verified in the workspace.

---

## Problem (today)

The right column (`WorkspaceRightPanel`, fixed `w-80`) stacks **Inspector** (layers + properties + debug), **Activity**, and **Discussion** in one vertical flex column with **no resize** and **no collapse**.

| Symptom | Cause |
|--------|--------|
| **Properties effectively invisible** | `DiscussionPanel` uses `flex-1`; layers (`max-h-44`) + debug block consume space; properties sit in the middle with `flex-1` but lose against chat. |
| **No control** | User cannot expand properties or shrink chat. |
| **Flat, cramped UI** | 9px uppercase labels, no region chrome, duplicate headers, no visual hierarchy. |
| **Fixed width** | 320px is wrong for wide monitors (waste) and small laptops (crush). |

---

## Design goals

1. **Properties first** — editing physics must be obvious and reachable in one click.
2. **Regions, not one scroll** — independent collapse + vertical resize between regions.
3. **Panel width** — drag left edge to resize (260–480px), persisted.
4. **Premium Flux feel** — calm contrast, clear headers, subtle depth, accent on active/focused region (not generic admin UI).
5. **Collaboration without crowding** — discussion is important but must not starve the inspector.

---

## Information architecture

```
┌─ Right panel (resizable width) ─────────────────┐
│ ┃← width handle                                  │
│ ┌ Scene ──────────────── [▼] ─────────────────┐ │
│ │  ▸ Layers (sub-collapse)                     │ │
│ │  ▸ Debug overlays (sub-collapse)             │ │
│ └──────────────────═ resize ═─────────────────┘ │
│ ┌ Properties ─────────── [▼] ★ default open ─┐ │
│ │  Transform · Motion · Material · Springs    │ │
│ └──────────────────═ resize ═─────────────────┘ │
│ ┌ Activity ───────────── [▶] default collapsed ┐ │
│ └──────────────────═ resize ═─────────────────┘ │
│ ┌ Discussion ─────────── [▼] flex remainder ──┐ │
│ │  messages + composer                         │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Region defaults

| Region | Default | Min height (open) | Notes |
|--------|---------|-------------------|--------|
| **Scene** | Open, ~200px | 120px | Layers + debug sub-sections |
| **Properties** | Open, ~320px | 200px | Primary work area; never default-collapsed |
| **Activity** | **Collapsed** | 80px | Log is secondary |
| **Discussion** | Open, **flex fill** | 140px | Takes remaining height |

### Persistence (`flux_right_panel` in localStorage)

- `width`
- Per region: `collapsed`, `height` (px, for non-flex regions)
- Sub-section: `layersOpen`, `debugOpen`

---

## Interaction spec

### Region header

- Full-width click toggles collapse (chevron rotates).
- Title + optional count badge (layer count, unread-style dot later).
- Header: `bg-flux-elevated/90`, bottom border, `py-2.5 px-3`.
- Open body: `min-h-0 overflow-y-auto` (scroll **inside** region only).

### Resize handle (between regions)

- 6px hit area, `cursor: row-resize`.
- Hover: subtle accent line (`emerald/20`).
- Drag adjusts **upper** region height; clamp to min; push/flex lower regions.
- Double-click handle: reset pair to default heights.

### Width handle (panel left edge)

- 4px strip on panel border; `cursor: col-resize`.
- Clamp 260–480px.

### Keyboard (v2, optional)

- `Ctrl+1…4` focus/toggle regions — not in v1 unless trivial.

---

## Visual style

- **Panel shell**: `bg-flux-panel`, `border-l border-flux-border`, soft inner shadow optional.
- **Active region** (mousedown in body): left accent `2px #6ee7b7`.
- **Properties empty state**: centered hint + small diagram text, not a single gray line.
- **Spring properties**: editable stiffness/damping sliders (wire to `updateSpringProps`).
- **Typography**: region titles `text-[11px] font-semibold tracking-wide`; field labels stay `11px`; reduce 8–9px labels in properties.

---

## Component map

| File | Role |
|------|------|
| `store/rightPanelStore.ts` | Layout state + persist |
| `components/workspace/right-panel/PanelRegion.tsx` | Header + collapse + body |
| `components/workspace/right-panel/PanelSplitter.tsx` | Horizontal drag between regions |
| `components/workspace/right-panel/PanelWidthHandle.tsx` | Vertical panel resize |
| `components/workspace/right-panel/ResizableRightPanel.tsx` | Composes regions + splitters |
| `WorkspaceRightPanel.tsx` | Thin export wrapper |

### Panel content (`bare` prop)

Remove duplicate `<header>` from `LayersPanel`, `DebugOverlaysPanel`, `ActionHistoryPanel`, `DiscussionPanel` when `bare` — parent `PanelRegion` owns the title.

---

## Implementation phases

### Phase 1 — Layout shell (this PR) ✅ target

- [x] `RIGHT_PANEL.md` (this doc)
- [x] `rightPanelStore` + defaults
- [x] Resizable/collapsible regions
- [x] Properties min height + activity default collapsed
- [x] Width resize
- [x] Style pass on headers/splitters
- [x] `bare` panels

### Phase 2 — Properties depth

- [ ] Spring stiffness/damping sliders
- [ ] Multi-select bulk edit hints
- [ ] Pin region (prevent collapse)

### Phase 3 — Polish

- [ ] Unread badge on Discussion
- [ ] Remember scroll per region
- [ ] Mobile: drawer overlay instead of column

---

## Success criteria

1. On 1080p, opening workspace shows **Properties** with transform fields **without scrolling** the whole column.
2. User can **collapse Discussion** and give Properties ~60% of panel height.
3. Layout survives **refresh** (persist).
4. Panel reads as **intentional Flux UI**, not stacked fragments.

---

## Testing checklist

- [ ] Fresh load: Properties visible with no selection (empty state readable).
- [ ] Select body: edit X/Y; region scrolls internally if window short.
- [ ] Collapse all except Properties; expand Discussion; resize between them.
- [ ] Drag panel width; reload; width restored.
- [ ] Activity collapsed by default; expand shows log.
