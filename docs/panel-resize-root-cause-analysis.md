# Three-Panel Resize UX: Root Cause Analysis and Recommended Model

## Scope
This analysis is based on:
- `/Users/markguo/Github/markagent/apps/web/src/components/layout/Sidebar.tsx`
- `/Users/markguo/Github/markagent/apps/web/src/components/inspector/InspectorPanel.tsx`
- `/Users/markguo/Github/markagent/apps/web/src/pages/ChatPage.tsx`

The current layout is effectively a three-column horizontal split:
- Left: sidebar (resizable)
- Middle: main chat area (flex)
- Right: inspector (resizable)

## 1) Root Cause Analysis

### Issue A: Hard to reach desired width in one drag
Primary causes:
1. Move-time update is gated instead of clamped.
   - Current pattern in both panels:
     - Compute `newWidth`
     - Only call `setWidth(newWidth)` if `newWidth` is already within min/max
   - When pointer crosses beyond a bound, width stops updating rather than saturating at bound. This creates a dead zone and makes precise single-drag targeting harder.

2. Right panel uses viewport-based math (`window.innerWidth - e.clientX`) instead of drag-origin delta math.
   - This ties width to absolute viewport coordinates, not the handle’s drag origin.
   - Any offset changes (left panel width, borders, transforms, zoom rounding) make the mapping feel less predictable.

3. Mouse events without pointer capture.
   - Fast drags can miss move events when cursor leaves the handle/document path, causing perceived jumpiness and requiring additional adjustments.

### Issue B: Right panel max width is too limited
Primary cause:
1. Hard cap is currently low:
   - `MAX_INSPECTOR_WIDTH = 560`
   - If product expectation is a wider inspector, this constant is simply restrictive.

### Issue C: At maxWidth, outward drag still causes slight movement/jitter
Primary causes:
1. No explicit directional lock at bounds.
   - Current logic only says “update when in range,” not “freeze when outward at max.”
   - Around the boundary, small coordinate noise can repeatedly cross threshold and produce tiny visual shifts.

2. Width-only control inside flex layout can still show small positional variance.
   - In flex layouts, siblings are reflowed continuously.
   - If basis/width/min/max are not controlled consistently, tiny rounding artifacts can appear as 1px handle motion.

3. Sub-pixel / device-pixel rounding effects are not normalized.
   - Width updates are continuous from pointer coordinates but rendering snaps to physical pixels.
   - Without quantization to a stable step, edge jitter is more noticeable near constraints.

## 2) Recommended Resize Logic (Move-Time Clamp Model)

### Design goals
- Clamp during pointer move, not after render.
- Saturate to min/max in one drag.
- When at max, outward drag yields exactly zero width change.
- Allow immediate inward drag from max.
- Preserve existing behavior (left grows rightward, right grows leftward).

### Model
Use a per-drag session object:
- `startX`: pointer x at drag start
- `startWidth`: panel width at drag start
- `edge`: `'left' | 'right'` (handle side)
- `min`, `max`

On each move:
1. `dx = clientX - startX`
2. Raw width from drag delta:
   - Left panel (handle on right edge): `raw = startWidth + dx`
   - Right panel (handle on left edge): `raw = startWidth - dx`
3. Clamp immediately: `clamped = clamp(raw, min, max)`
4. Directional lock at bounds:
   - If current width is `max` and pointer is still pushing outward, keep width unchanged.
   - If current width is `min` and pointer is still pushing outward toward smaller, keep width unchanged.
5. Quantize before state update (recommended):
   - `next = roundToDevicePixel(clamped)` (or integer px)
6. Only `setWidth(next)` when `next !== prevWidth`.

### Pseudo-code
```ts
function onPointerDown(e) {
  drag.active = true;
  drag.startX = e.clientX;
  drag.startWidth = width;
  drag.edge = panelEdge; // 'left' for sidebar, 'right' for inspector
  handle.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!drag.active) return;

  const dx = e.clientX - drag.startX;
  const outward = drag.edge === 'left' ? dx > 0 : dx < 0;
  const inward = !outward;

  const raw = drag.edge === 'left'
    ? drag.startWidth + dx
    : drag.startWidth - dx;

  let next = clamp(raw, MIN, MAX);

  // Hard lock behavior at max/min
  if (width >= MAX && outward) next = width;
  if (width <= MIN && !inward) next = width;

  next = quantize(next); // e.g. integer px or 1/devicePixelRatio step

  if (next !== width) setWidth(next);
}

function onPointerUp(e) {
  drag.active = false;
  handle.releasePointerCapture?.(e.pointerId);
}
```

### Flex sizing recommendation
For resizable side panels in a flex row, prefer a single source of truth and consistent constraints:
- `flex: 0 0 <width>px`
- `width: <width>px`
- `min-width: <min>px`
- `max-width: <max>px`

This reduces flex negotiation ambiguity and boundary jitter versus width-only updates.

### Suggested max width for right panel
If product wants a meaningfully wider right panel, increase cap to a larger fixed value (for example `720` or `840`) or use viewport-relative cap:
- `max = min(960, floor(containerWidth * 0.6))`

Use the same move-time clamp model regardless of chosen cap.

## 3) Common Anti-Patterns to Avoid

1. Range-gated updates (`if within range then set`) instead of clamp.
2. Correcting out-of-bounds in `useEffect` after render.
3. Using absolute viewport formulas for resize (`window.innerWidth - clientX`) when drag-delta is available.
4. Not using pointer capture on drag handles.
5. Updating width every move without quantization near bounds.
6. Mixing `width` control with unconstrained flex behavior (`flex: 1`/auto shrink) on the same resizable panel.
7. Allowing CSS transitions during active drag.
8. Applying min/max only in CSS but not in move-time calculation.
9. Maintaining independent left/right constraints that ignore total container space.
10. Persisting fractional widths without normalizing to a stable step.

## Practical mapping to current code
- In `/Users/markguo/Github/markagent/apps/web/src/components/layout/Sidebar.tsx`:
  - Replace in-range gating with clamp + directional lock.
  - Move to pointer events + capture.
- In `/Users/markguo/Github/markagent/apps/web/src/components/inspector/InspectorPanel.tsx`:
  - Replace `window.innerWidth - e.clientX` with drag-origin delta math.
  - Increase `MAX_INSPECTOR_WIDTH` per desired product behavior.
  - Apply same clamp/lock/quantize logic.
