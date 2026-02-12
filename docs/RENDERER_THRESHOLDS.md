# Renderer Thresholds

## Overview

Renderer thresholds determine when the hybrid rendering system automatically switches between SVG, Canvas, and WebGL renderers. These thresholds are deterministic, configurable, and device-aware.

## Default Thresholds

### Point Count Thresholds

| Transition | Default Value | Description |
|------------|---------------|-------------|
| SVG → Canvas | 5,000 points | Switch to Canvas when dataset exceeds 5k points |
| Canvas → WebGL | 50,000 points | Switch to WebGL when dataset exceeds 50k points |

### Points Per Pixel Thresholds

Alternative metric for responsive charts:

| Tier | Points Per Pixel | Use Case |
|------|------------------|----------|
| SVG | 0.5 | Low density, plenty of pixels per point |
| Canvas | 5 | Medium density, points getting crowded |
| WebGL | 50 | High density, overlapping points |

**Calculation:**
```
pointsPerPixel = totalPoints / (chartWidth × chartHeight)
```

Example: 1000 points on 800×400 chart = 1000/320000 = 0.003 points/pixel → SVG

## Device-Specific Thresholds

### Mobile Devices
Lower thresholds due to lower GPU power and smaller screens:

| Transition | Threshold | Reason |
|------------|-----------|--------|
| SVG → Canvas | 2,000 points | Reduced processing power |
| Canvas → WebGL | 20,000 points | Lower GPU capabilities |

### Low-Power Devices
For older laptops and budget devices:

| Transition | Threshold | Reason |
|------------|-----------|--------|
| SVG → Canvas | 3,000 points | Limited CPU/GPU resources |
| Canvas → WebGL | 30,000 points | Conservative WebGL usage |

### High-Performance Devices
For workstations and gaming PCs:

| Transition | Threshold | Reason |
|------------|-----------|--------|
| SVG → Canvas | 10,000 points | Can handle more SVG elements |
| Canvas → WebGL | 100,000 points | Powerful GPU for WebGL |

## Configuration

### Programmatic Configuration

```typescript
import { createHybridEngine, setRuntimeThresholds } from '@/lib/viz/hybrid';

// Configure at engine creation
const engine = createHybridEngine({
  thresholds: {
    svgToCanvas: 3000,      // Lower threshold
    canvasToWebGL: 25000,   // Earlier WebGL
    pointsPerPixelSVG: 0.3,
    pointsPerPixelCanvas: 3,
    pointsPerPixelWebGL: 30,
    autoDetect: true,         // Use device detection
  }
});

// Or update at runtime
setRuntimeThresholds({
  svgToCanvas: 1000,
  canvasToWebGL: 10000,
});
```

### URL Parameter Override

For testing and debugging:

```
https://dashboard.example.com/?renderer=canvas
```

Valid values:
- `?renderer=svg` - Force SVG
- `?renderer=canvas` - Force Canvas
- `?renderer=webgl` - Force WebGL

### Session Storage Persistence

Runtime thresholds are stored in sessionStorage:

```typescript
// Thresholds persist across reloads
setRuntimeThresholds({ svgToCanvas: 1000 });
// ... user reloads page ...
getRuntimeThresholds(); // Returns { svgToCanvas: 1000, ... }

// Reset to defaults
resetThresholds();
```

## Auto-Detection Logic

```typescript
function getThresholdsForDevice(): ThresholdConfig {
  // Check for URL override first
  const urlParams = new URLSearchParams(window.location.search);
  const forceRenderer = urlParams.get('renderer');
  if (forceRenderer) {
    return { ...DEFAULTS, forceRenderer };
  }

  // Check for stored runtime thresholds
  const stored = sessionStorage.getItem('hybrid-renderer-thresholds');
  if (stored) {
    return JSON.parse(stored);
  }

  // Detect device characteristics
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLowPower = navigator.hardwareConcurrency <= 2;
  const isHighPerf = navigator.hardwareConcurrency >= 8;

  if (isMobile) return MOBILE_THRESHOLDS;
  if (isLowPower) return LOW_POWER_THRESHOLDS;
  if (isHighPerf) return HIGH_PERFORMANCE_THRESHOLDS;

  return DEFAULT_THRESHOLDS;
}
```

## Tier Selection Algorithm

```
function selectRenderer(data, width, height, thresholds):
  // 1. Check for forced renderer
  if thresholds.forceRenderer:
    return thresholds.forceRenderer

  // 2. Calculate metrics
  totalPoints = sum(data.map(s => s.data.length))
  pointsPerPixel = totalPoints / (width * height)

  // 3. Apply point count thresholds
  if totalPoints >= thresholds.canvasToWebGL:
    return WEBGL
  if totalPoints >= thresholds.svgToCanvas:
    return CANVAS

  // 4. Apply density thresholds
  if pointsPerPixel >= thresholds.pointsPerPixelWebGL:
    return WEBGL
  if pointsPerPixel >= thresholds.pointsPerPixelCanvas:
    return CANVAS

  // 5. Default to SVG
  return SVG
```

## Performance-Based Degradation

Even with thresholds configured, the system monitors performance:

```typescript
// If frame time exceeds budget consistently
if (frameTime > maxFrameTime for 10 consecutive frames) {
  // Step down one tier
  if (currentTier === WEBGL) switchTo(CANVAS);
  if (currentTier === CANVAS) switchTo(SVG);
}
```

This ensures smooth interaction even if threshold calculations are off.

## Threshold Tuning Guide

### When to Lower Thresholds (Earlier Tier Switch)

- Smaller screens (mobile, embedded)
- Battery-constrained devices
- Charts with complex visual encodings
- When accessibility is prioritized

### When to Raise Thresholds (Later Tier Switch)

- High-end workstations
- Simple visualizations (just lines, no points)
- Read-only dashboards (no interaction)
- When DOM manipulation is acceptable

### Recommended Settings

**Mobile Dashboard:**
```typescript
{
  svgToCanvas: 1000,
  canvasToWebGL: 5000,
  autoDegrade: true,
}
```

**Analytics Workstation:**
```typescript
{
  svgToCanvas: 10000,
  canvasToWebGL: 100000,
  autoDegrade: false,  // Trust the thresholds
}
```

**Mixed Audience:**
```typescript
{
  autoDetect: true,    // Let the system decide
  autoDegrade: true,   // Safety net
}
```

## Troubleshooting

### Renderer Switching Too Often

**Symptom:** Flickering between Canvas and WebGL

**Cause:** Data fluctuating around threshold boundary

**Solution:** Add hysteresis (not yet implemented) or widen gap:
```typescript
{
  svgToCanvas: 4000,
  canvasToWebGL: 6000,  // Larger gap
}
```

### Never Switching to WebGL

**Symptom:** Large datasets (>100k) still using Canvas

**Causes:**
1. WebGL not supported → Check browser console
2. Force renderer set → Check URL params
3. `autoDetect: false` with low thresholds

**Solution:**
```typescript
// Force WebGL and check for errors
setRuntimeThresholds({
  forceRenderer: 'webgl'
});
```

### Switching Too Late (Poor Performance)

**Symptom:** SVG choking on 3k points

**Cause:** Threshold too high for specific visualization complexity

**Solution:** Lower threshold:
```typescript
{
  svgToCanvas: 2000,  // Earlier switch
}
```

## API Reference

### `setRuntimeThresholds(overrides)`

Temporarily override thresholds for current session.

**Parameters:**
- `overrides`: Partial<ThresholdConfig>

**Returns:** ThresholdConfig (merged with defaults)

### `getRuntimeThresholds()`

Get current runtime thresholds.

**Returns:** ThresholdConfig

### `resetThresholds()`

Reset to device-detected defaults.

**Returns:** ThresholdConfig

### `calculatePointDensity(points, width, height)`

Calculate points per pixel metric.

**Returns:** number

## Validation

Threshold configuration is validated to ensure sanity:

```typescript
function validateThresholds(config):
  // Ensure positive values
  config.svgToCanvas = max(100, config.svgToCanvas)
  config.canvasToWebGL = max(config.svgToCanvas, config.canvasToWebGL)

  // Ensure proper ordering
  assert(config.svgToCanvas < config.canvasToWebGL)
```

Invalid configurations are corrected automatically.
