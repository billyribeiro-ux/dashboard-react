# Hybrid Interaction Parity

## Overview

All rendering tiers (SVG, Canvas, WebGL) must support equivalent core interactions to ensure a consistent user experience regardless of data density.

## Core Interactions (Required)

### 1. Hover / Tooltip

**Requirement:** Show tooltip on mouse hover over data points

**Implementation Status:**
- ✅ SVG: Native D3 event handling
- ✅ Canvas: Spatial indexing for O(1) hit testing
- ✅ WebGL: Distance calculation in world coordinates

**Behavior:**
- Hover radius: 10 pixels (configurable)
- Debounce: 16ms (one frame)
- Show nearest point within radius
- Trigger tooltip callback

### 2. Click Selection

**Requirement:** Select/deselect data points on click

**Implementation Status:**
- ✅ SVG: Click events on DOM elements
- ✅ Canvas: Hit test on click coordinates
- ✅ WebGL: Same hit test as hover with larger radius

**Behavior:**
- Selection radius: 15 pixels
- Toggle selection state
- Trigger onClick callback

### 3. Brush / Region Selection

**Requirement:** Drag to select multiple points in a region

**Implementation Status:**
- ✅ SVG: D3 brush behavior
- ✅ Canvas: Rectangle hit testing
- ✅ WebGL: Spatial range query

**Behavior:**
- Drag creates selection rectangle
- All points inside selected
- Callback receives selected points

### 4. Zoom / Pan

**Requirement:** Zoom and pan the view

**Implementation Status:**
- ⚠️ SVG: Via D3 zoom (external)
- ⚠️ Canvas: Via scale transformation (external)
- ⚠️ WebGL: Via camera movement (external)

**Note:** Zoom is primarily handled by D3 scales outside the renderer

### 5. Crosshair Sync

**Requirement:** Sync cursor position across multiple charts

**Implementation Status:**
- ✅ SVG: Emit mouse position events
- ✅ Canvas: Same event emission
- ✅ WebGL: Same event emission

### 6. Keyboard Navigation

**Requirement:** Navigate data points using keyboard

**Implementation Status:**
- ✅ SVG: Tab focus, arrow keys
- ✅ Canvas: Tab focus, arrow keys
- ✅ WebGL: Tab focus, arrow keys

**Keyboard Shortcuts:**
- `ArrowLeft` / `ArrowRight`: Navigate points
- `ArrowUp` / `ArrowDown`: Change series
- `Enter`: Select current point
- `Escape`: Clear selection

## Interaction Bridge

The `InteractionBridge` provides consistent interaction handling across all renderers:

```typescript
const bridge = createInteractionBridge({
  hoverRadius: 10,
  selectionRadius: 15,
  hoverDebounceMs: 16,
  enableKeyboardNavigation: true,
});

// Attach to any renderer
bridge.attach(container, renderer, context);

// Set up callbacks
bridge.onHover((result, x, y) => {
  console.log('Hover:', result?.point);
});

bridge.onClick((result, x, y) => {
  console.log('Click:', result?.point);
});

bridge.onSelection((points, region) => {
  console.log('Selected:', points.length, 'points');
});
```

## Hit Testing Implementation

### SVG Renderer

Uses native DOM hit testing:

```typescript
hitTest(x, y, radius) {
  // Convert to data coordinates
  const dataX = x - margin.left;
  const dataY = y - margin.top;

  // Iterate all points (acceptable for small datasets)
  for (const series of data) {
    for (const point of series.data) {
      const px = xScale(point.x);
      const py = yScale(point.y);
      const distance = Math.sqrt((px - dataX)**2 + (py - dataY)**2);

      if (distance < radius && distance < minDistance) {
        return { point, series: series.id, distance, x: px, y: py };
      }
    }
  }
  return null;
}
```

Time complexity: O(n) where n = total points

### Canvas Renderer

Uses spatial indexing for O(1) lookup:

```typescript
// Build spatial index during render
buildSpatialIndex(data, xScale, yScale) {
  const cellSize = hitTestRadius * 2;

  for (const point of allPoints) {
    const x = xScale(point.x);
    const y = yScale(point.y);
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const key = `${cellX},${cellY}`;

    if (!spatialIndex.has(key)) {
      spatialIndex.set(key, []);
    }
    spatialIndex.get(key).push(point);
  }
}

// Query only neighboring cells
hitTest(x, y, radius) {
  const cellX = Math.floor(x / cellSize);
  const cellY = Math.floor(y / cellSize);

  // Check 3x3 grid of cells
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cellX + dx},${cellY + dy}`;
      const points = spatialIndex.get(key);
      if (points) {
        // Check points in this cell
        for (const point of points) {
          // ... distance calculation
        }
      }
    }
  }
}
```

Average time complexity: O(1) per query

### WebGL Renderer

Uses same spatial indexing approach as Canvas:

```typescript
// World-space hit testing
hitTest(screenX, screenY, radius) {
  // Convert screen to world coordinates
  const worldX = screenX - margin.left;
  const worldY = height - (screenY - margin.top); // Flip Y

  // Same spatial indexing as Canvas
  // ...
}
```

## Reduced Capability Documentation

Some interactions have tier-specific limitations:

### Tooltip Precision

| Tier | Precision | Notes |
|------|-----------|-------|
| SVG | Exact | Matches DOM element exactly |
| Canvas | ~2px | Depends on spatial index cell size |
| WebGL | ~2px | Depends on spatial index cell size |

### Brush Performance

| Tier | Max Points | Notes |
|------|------------|-------|
| SVG | 5,000 | Slows down DOM manipulation |
| Canvas | 500,000 | Spatial indexing keeps fast |
| WebGL | Unlimited | GPU handles large datasets |

### Selection State

All tiers properly maintain selection state across renderer switches.

## Testing Interaction Parity

### E2E Test Scenarios

1. **Hover Test**
   ```
   Given: Chart with 1000 points
   When: Mouse hovers over point at (100, 200)
   Then: Tooltip shows at all tiers with same data
   ```

2. **Click Test**
   ```
   Given: Chart in Canvas mode
   When: Click on point at (100, 200)
   Then: Point selected, selection state updated
   When: Renderer switches to WebGL
   Then: Selection preserved
   ```

3. **Brush Test**
   ```
   Given: Chart in WebGL mode with 50k points
   When: Drag brush from (0,0) to (100,100)
   Then: Correct number of points selected
   When: Renderer switches to Canvas
   Then: Same points remain selected
   ```

### Manual Verification

1. Load dataset (e.g., 10k points)
2. Note current renderer tier (should be Canvas)
3. Perform interactions:
   - Hover over points
   - Click to select
   - Drag to brush
   - Use keyboard navigation
4. Force renderer to WebGL via URL param (`?renderer=webgl`)
5. Verify same interactions work identically
6. Force renderer to SVG
7. Verify interactions work (may be slower)

## Accessibility Considerations

All interactions must work with assistive technologies:

### Screen Readers
- Announce hover focus changes
- Announce selection changes
- Provide data summaries

### Keyboard Only
- All interactions accessible via keyboard
- Visible focus indicators
- Logical tab order

### Reduced Motion
- Disable animations when `prefers-reduced-motion`
- Instant state changes instead of transitions

## Known Limitations

### WebGL
- Hit testing requires CPU-side spatial index (can't read GPU pixels synchronously)
- Text rendering less crisp than Canvas/SVG at small sizes
- No native DOM for screen reader support (requires ARIA workarounds)

### Canvas
- No native DOM events on individual points
- Text accessibility requires fallback table
- Hit testing accuracy limited by cell size

### SVG
- Performance degrades with >5k DOM elements
- Memory usage scales with element count
- Slower hit testing for large datasets

## Best Practices

1. **Always use InteractionBridge** - Ensures consistent behavior
2. **Test all three tiers** - Don't assume Canvas/WebGL work the same
3. **Handle tier switch events** - Update UI state appropriately
4. **Provide keyboard alternatives** - Never require mouse for interaction
5. **Test with screen reader** - Verify all interactions are announced

## Troubleshooting

### Hit Testing Not Working

**Symptom:** Hover not detecting points

**Causes:**
1. Margin not accounted for in coordinates
2. Scale domain/range mismatch
3. Spatial index not rebuilt after zoom

**Solution:**
```typescript
// Ensure scales are updated
const { xScale, yScale } = calculateScales();
context.xScale = xScale;
context.yScale = yScale;
renderer.render(data, context);
// Spatial index will be rebuilt
```

### Selection Lost on Tier Switch

**Symptom:** Selected points disappear when renderer changes

**Cause:** Selection stored in renderer, not in shared state

**Solution:** Store selection in parent component state:
```typescript
const [selection, setSelection] = useState([]);

bridge.onClick((result) => {
  if (result) {
    setSelection([...selection, result.point]);
  }
});
```

## API Reference

### `InteractionBridge.onHover(callback)`

**Parameters:**
- `callback`: `(result: HitTestResult | null, x: number, y: number) => void`

**Called:** When mouse hovers over a point

### `InteractionBridge.onClick(callback)`

**Parameters:**
- `callback`: `(result: HitTestResult | null, x: number, y: number) => void`

**Called:** When user clicks on the chart

### `InteractionBridge.onSelection(callback)`

**Parameters:**
- `callback`: `(points: DataPoint[], region: {x1, y1, x2, y2}) => void`

**Called:** When brush selection completes

### `InteractionBridge.startBrush(x, y)`

Start brush drag at coordinates.

### `InteractionBridge.endBrush()`

End brush drag, returns selected points.

### `Renderer.hitTest(x, y, radius?)`

**Returns:** `HitTestResult | null`

Must be implemented by all renderers.

### `Renderer.getPointsInRegion(x1, y1, x2, y2)`

**Returns:** `DataPoint[]`

Must be implemented by all renderers.
