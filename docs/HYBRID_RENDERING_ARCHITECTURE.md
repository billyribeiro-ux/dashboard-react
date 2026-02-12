# Hybrid Rendering Architecture

## Overview

The Hybrid Rendering System provides ultra-high-density visualization performance for large datasets while preserving D3 semantic correctness. It uses a progressive rendering strategy that automatically switches between SVG, Canvas 2D, and WebGL based on data density.

## Core Principles

1. **D3 Semantics First**: All rendering tiers use D3 for scales, domains, axes logic, and interaction math
2. **Progressive Enhancement**: Start with SVG (most compatible), escalate to Canvas/WebGL only when needed
3. **Zero Data Loss**: All tiers support equivalent data visualization; no tier hides data silently
4. **Seamless Transitions**: Renderer switching happens transparently without user-visible state loss

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard UI                         │
│              (React Components/Hooks)                   │
├─────────────────────────────────────────────────────────┤
│              HybridChart Component                       │
│         (Manages lifecycle & interactions)              │
├─────────────────────────────────────────────────────────┤
│                   HybridEngine                           │
│    (Tier selection, performance monitoring, LOD)        │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │   SVG    │  │  Canvas  │  │  WebGL   │  Renderers   │
│  │ Renderer │  │ Renderer │  │ Renderer │              │
│  └──────────┘  └──────────┘  └──────────┘              │
├─────────────────────────────────────────────────────────┤
│              InteractionBridge                           │
│    (Shared hover/brush/zoom across all tiers)            │
├─────────────────────────────────────────────────────────┤
│              AccessibilityFallbacks                      │
│    (Table view, screen readers, keyboard nav)           │
└─────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### `engine.ts` - HybridEngine Class

**Responsibilities:**
- Manages renderer lifecycle and registration
- Determines optimal rendering tier based on data density
- Monitors performance and auto-degrades if necessary
- Coordinates LOD (Level of Detail) decisions
- Emits events for tier switches and performance violations

**Key Methods:**
- `registerRenderer(tier, renderer)`: Register a renderer for a specific tier
- `evaluateTierChange(data, width, height)`: Check if tier switch is needed
- `render(data, context)`: Render data using current renderer
- `onEvent(handler)`: Subscribe to engine events

### `types.ts` - Type Definitions

**Core Types:**
- `RendererTier`: Enum for SVG, CANVAS, WEBGL
- `Renderer`: Interface all renderers must implement
- `HybridRendererConfig`: Complete configuration object
- `RenderContext`: D3 scales and dimensions for rendering

### `thresholds.ts` - Threshold Configuration

**Responsibilities:**
- Define deterministic thresholds for automatic tier switching
- Provide device-specific thresholds (mobile, low-power, high-performance)
- Support runtime threshold override for testing

**Default Thresholds:**
- `svgToCanvas`: 5,000 points
- `canvasToWebGL`: 50,000 points

### `detection.ts` - Device & Density Detection

**Responsibilities:**
- Calculate data density metrics
- Detect WebGL capabilities and device performance
- Recommend optimal tier based on data and device
- Track performance history and detect violations

### `lod.ts` - Level of Detail

**Responsibilities:**
- Implement deterministic downsampling policies
- Preserve min/max envelope for trend integrity
- Detect and preserve outliers
- Support zoom-aware refinement

### Renderer Implementations

**`renderer-svg.ts` - SVG Renderer (Tier 1)**
- Uses D3 for DOM-based rendering
- Full interactivity via DOM events
- Best for accessibility and small datasets (< 5k points)

**`renderer-canvas.ts` - Canvas Renderer (Tier 2)**
- Uses Canvas 2D API with D3 scales
- Spatial indexing for efficient hit testing
- Good for medium datasets (5k-50k points)

**`renderer-webgl.ts` - WebGL Renderer (Tier 3)**
- Uses Three.js for GPU-accelerated rendering
- Instanced rendering for massive datasets
- Required for very large datasets (> 50k points)

### `interaction-bridge.ts` - Interaction Bridge

**Responsibilities:**
- Provide consistent interaction across all renderers
- Handle hover, click, brush, zoom, keyboard events
- Debounce expensive operations
- Support region selection

### `accessibility-fallbacks.ts` - Accessibility

**Responsibilities:**
- Generate accessible data tables
- Create ARIA attributes for screen readers
- Provide keyboard navigation support
- Respect `prefers-reduced-motion` and `prefers-contrast`

### `debug-panel.tsx` - Debug UI

**Responsibilities:**
- Display current renderer tier
- Show FPS, frame time, and point count
- Log renderer switches
- Allow threshold tuning

## Data Flow

```
1. Dashboard mounts → HybridChart initializes
2. HybridEngine creates → Registers all renderers
3. Detection module checks data density
4. Engine selects optimal tier
5. Selected renderer initializes
6. InteractionBridge attaches to container
7. Data updates → Engine evaluates tier again
8. Render occurs with appropriate renderer
9. Performance metrics recorded
10. If budget exceeded → Auto-degrade triggered
```

## Tier Selection Algorithm

```typescript
function selectTier(data, width, height, thresholds):
  // 1. Check for manual override
  if thresholds.forceRenderer:
    return thresholds.forceRenderer

  // 2. Calculate data density
  metrics = calculateDensityMetrics(data, width, height)

  // 3. Apply thresholds
  if metrics.totalPoints >= thresholds.canvasToWebGL:
    return WEBGL
  if metrics.totalPoints >= thresholds.svgToCanvas:
    return CANVAS

  // 4. Check points-per-pixel density
  if metrics.pointsPerPixel >= thresholds.pointsPerPixelWebGL:
    return WEBGL
  if metrics.pointsPerPixel >= thresholds.pointsPerPixelCanvas:
    return CANVAS

  // 5. Default to SVG
  return SVG
```

## State Management

All state is managed by `HybridEngine`:

- **Renderer State**: Current tier, active status, error state
- **Performance State**: Frame times, FPS, dropped frames
- **Interaction State**: Selection, hover, brush region
- **LOD State**: Current compression level, outlier count

## Error Handling

1. **WebGL Initialization Failure**: Fall back to Canvas
2. **Canvas Context Failure**: Fall back to SVG
3. **Renderer Crash**: Destroy and recreate
4. **Memory Pressure**: Reduce LOD or switch to lower tier

## Configuration API

```typescript
const engine = createHybridEngine({
  thresholds: {
    svgToCanvas: 5000,
    canvasToWebGL: 50000,
  },
  performanceBudgets: {
    targetFrameTime: 16.67,
    maxFrameTime: 33.33,
    autoDegrade: true,
  },
  lodPolicy: {
    temporalBucketing: true,
    outlierPreservation: true,
  },
  accessibility: {
    enableTableFallback: true,
    reducedMotion: 'auto',
  },
  debug: {
    enableDebugPanel: true,
  },
});
```

## Best Practices

1. **Always register all three renderers** - Even if you only expect small data, this ensures graceful degradation
2. **Use `evaluateTierChange()` on data updates** - Don't rely on initial selection; re-evaluate when data changes
3. **Handle tier switch events** - Update UI when renderer changes (e.g., show current tier to user)
4. **Test with debug panel enabled** - Use the debug panel during development to understand tier selection
5. **Respect accessibility settings** - Always provide table fallback and keyboard navigation

## Performance Considerations

- SVG performs well up to ~5,000 DOM elements
- Canvas is efficient for 5k-50k points with proper LOD
- WebGL is required for >50k points or real-time streaming
- Spatial indexing in Canvas/WebGL makes hit testing O(1) instead of O(n)
- LOD reduces data by 10x-100x while preserving visual accuracy

## Browser Support

- **SVG**: All modern browsers (IE11+)
- **Canvas 2D**: All modern browsers (IE11+)
- **WebGL**: All modern browsers (IE11 with plugin, not recommended)
- **ResizeObserver**: Chrome 64+, Firefox 69+, Safari 13.1+

## File Structure

```
src/lib/viz/hybrid/
├── index.ts              # Main exports
├── types.ts              # Type definitions
├── engine.ts             # HybridEngine class
├── thresholds.ts         # Threshold configuration
├── detection.ts          # Device capability detection
├── lod.ts                # Level of detail algorithms
├── renderer-svg.ts       # SVG renderer implementation
├── renderer-canvas.ts    # Canvas 2D renderer
├── renderer-webgl.ts     # WebGL renderer (Three.js)
├── interaction-bridge.ts # Cross-renderer interactions
├── accessibility-fallbacks.ts # a11y support
└── debug-panel.tsx       # Debug UI component
```
