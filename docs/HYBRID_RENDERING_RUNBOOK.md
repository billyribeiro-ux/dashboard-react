# Hybrid Rendering Runbook

## Quick Start

### 1. Basic Integration

```tsx
import { HybridChart } from '@/components/HybridChart';

function MyDashboard() {
  const data = [
    {
      id: 'series-1',
      name: 'Revenue',
      color: '#3b82f6',
      data: [
        { x: new Date('2024-01-01'), y: 100 },
        { x: new Date('2024-01-02'), y: 120 },
        // ... more points
      ],
    },
  ];

  return (
    <HybridChart
      data={data}
      width={800}
      height={400}
      showDebug={process.env.NODE_ENV === 'development'}
    />
  );
}
```

### 2. Enable Debug Mode

Add `?renderer=webgl` (or `canvas`, `svg`) to force a specific tier:

```
http://localhost:3000/?renderer=canvas
```

### 3. Monitor Performance

Enable debug panel to see:
- Current renderer tier
- FPS and frame time
- Point count
- Renderer switches

## Troubleshooting Guide

### "Chart is blank / not rendering"

**Check:**
1. Is container ref attached?
2. Any console errors?
3. Is WebGL supported? (check with `?renderer=svg`)

**Solution:**
```tsx
// Force SVG fallback
<HybridChart
  data={data}
  config={{
    thresholds: { forceRenderer: 'svg' }
  }}
/>
```

### "Performance is poor (low FPS)"

**Symptoms:**
- FPS < 30
- Stuttering animations
- High frame time

**Diagnosis:**
1. Check debug panel - which tier is active?
2. Check point count - is it exceeding tier capacity?
3. Check browser console for errors

**Solutions:**

| Issue | Solution |
|-------|----------|
| SVG with >5k points | Lower threshold or increase LOD |
| Canvas with >50k points | Switch to WebGL |
| WebGL still slow | Reduce data or enable LOD |
| Memory errors | Clear caches, reduce history |

```tsx
// Lower tier threshold
<HybridChart
  data={data}
  config={{
    thresholds: {
      svgToCanvas: 2000,  // Earlier switch
      canvasToWebGL: 10000,
    },
    performanceBudgets: {
      autoDegrade: true,
    }
  }}
/>
```

### "Hover/click not working"

**Symptoms:**
- No tooltip on hover
- Click doesn't select points

**Diagnosis:**
1. Check margins - are coordinates being calculated correctly?
2. Check scale domains - do they match data?
3. Is spatial index built? (Canvas/WebGL)

**Solution:**
```tsx
// Ensure scales are calculated from data
const calculateScales = useCallback(() => {
  const allX = data.flatMap(s => s.data.map(d => d.x));
  const allY = data.flatMap(s => s.data.map(d => d.y));

  const xScale = scaleTime()
    .domain(extent(allX) as [Date, Date])
    .range([0, width]);

  const yScale = scaleLinear()
    .domain(extent(allY) as [number, number])
    .range([height, 0]);

  return { xScale, yScale };
}, [data, width, height]);
```

### "Renderer keeps switching"

**Symptoms:**
- Flickering between Canvas and WebGL
- Unstable performance

**Cause:**
- Data fluctuating around threshold boundary

**Solution:**
Widen gap between thresholds:
```tsx
config={{
  thresholds: {
    svgToCanvas: 4000,
    canvasToWebGL: 6000,  // Larger gap
  }
}}
```

### "WebGL context lost"

**Symptoms:**
- Chart disappears
- "WebGL context lost" error

**Cause:**
- GPU memory pressure
- Too many WebGL contexts

**Solution:**
```tsx
// Auto-fallback is built-in
// Engine will automatically switch to Canvas

// To prevent, limit concurrent WebGL charts
// or reduce WebGL memory usage:
config={{
  webgl: {
    maxBufferSize: 8388608,  // 8MB instead of 16MB
  }
}}
```

## Threshold Tuning

### Default Thresholds

| Metric | Value | Use Case |
|--------|-------|----------|
| SVG→Canvas | 5,000 points | Desktop default |
| Canvas→WebGL | 50,000 points | Desktop default |
| Mobile SVG→Canvas | 2,000 points | Mobile devices |
| Mobile Canvas→WebGL | 20,000 points | Mobile devices |

### When to Adjust

**Lower thresholds (earlier tier switch):**
- Mobile devices
- Complex visualizations
- Accessibility prioritized
- Battery-constrained

**Raise thresholds (later tier switch):**
- High-end workstations
- Simple visualizations
- Read-only dashboards
- When DOM manipulation acceptable

### Runtime Override

```typescript
import { setRuntimeThresholds } from '@/lib/viz/hybrid';

// For testing - persists across reloads
setRuntimeThresholds({
  svgToCanvas: 1000,
  canvasToWebGL: 5000,
});

// Reset to defaults
resetThresholds();
```

## Common Operations

### Adding a New Series

```typescript
const newSeries = {
  id: 'series-3',
  name: 'New Metric',
  color: '#f59e0b',
  data: [
    { x: new Date(), y: 50 },
    // ... more points
  ],
  visible: true,
};

setData([...data, newSeries]);
```

### Toggling Series Visibility

```typescript
const toggleSeries = (seriesId: string) => {
  setData(data.map(series =>
    series.id === seriesId
      ? { ...series, visible: !series.visible }
      : series
  ));
};
```

### Handling Zoom

```typescript
// Zoom is handled by D3 scales
// Update scale domain and re-render

const handleZoom = (newDomain: [Date, Date]) => {
  const newXScale = xScale.copy().domain(newDomain);

  engine.render(data, {
    ...context,
    xScale: newXScale,
  });
};
```

### Exporting Data

```typescript
import { generateDataTable } from '@/lib/viz/hybrid';

const handleExport = () => {
  const { rows } = generateDataTable(data, Infinity);

  const csv = [
    ['Series', 'Time', 'Value'].join(','),
    ...rows.map(r => [r.series, r.timestamp, r.value].join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  // Download...
};
```

## Performance Optimization

### 1. Enable LOD (Level of Detail)

```tsx
<HybridChart
  data={data}
  config={{
    lodPolicy: {
      temporalBucketing: true,
      minMaxEnvelope: true,
      outlierPreservation: true,
    }
  }}
/>
```

### 2. Reduce Data for Initial Render

```typescript
// Show subset initially, then load more
const initialData = data.map(series => ({
  ...series,
  data: series.data.slice(0, 1000),  // First 1000 points
}));
```

### 3. Debounce Updates

```typescript
import { debounce } from 'lodash';

const debouncedRender = debounce((newData) => {
  engine.render(newData, context);
}, 100);
```

### 4. Use requestAnimationFrame

```typescript
const updateChart = () => {
  requestAnimationFrame(() => {
    engine.render(data, context);
  });
};
```

## Debugging

### Enable Verbose Logging

```typescript
const engine = createHybridEngine({
  debug: {
    logRendererSwitches: true,
    logLODDecisions: true,
    logInteractionMetrics: true,
  }
});
```

### Check WebGL Support

```typescript
import { detectWebGLCapabilities } from '@/lib/viz/hybrid';

const caps = detectWebGLCapabilities();
console.log({
  supported: caps.supported,
  webgl2: caps.webgl2,
  maxTextureSize: caps.maxTextureSize,
});
```

### Profile Memory Usage

```typescript
// Chrome DevTools Performance tab
// Look for:
// - JS Heap size
// - GPU Memory (in Chrome Task Manager)
// - Number of WebGL contexts
```

## Browser-Specific Issues

### Safari
- WebGL 2.0 support limited
- May need to force Canvas for large datasets

### Firefox
- WebGL performance can vary
- Canvas is usually more consistent

### Edge/IE11
- Limited WebGL support
- Recommend SVG or Canvas only

## Testing Checklist

Before deploying:

- [ ] Test with 100, 1k, 10k, 50k, 100k points
- [ ] Test on mobile device
- [ ] Test with screen reader
- [ ] Test keyboard navigation
- [ ] Verify with `?renderer=svg`
- [ ] Verify with `?renderer=canvas`
- [ ] Verify with `?renderer=webgl`
- [ ] Check memory usage doesn't grow
- [ ] Verify accessibility table fallback
- [ ] Test reduced motion preference

## Emergency Procedures

### Complete Rendering Failure

1. Check console for errors
2. Force SVG mode: `?renderer=svg`
3. If still failing, check data format
4. Verify all dependencies installed

### Memory Leak

1. Check for undestroyed renderers
2. Clear spatial index: `spatialIndex.clear()`
3. Dispose WebGL resources
4. Force garbage collection: `gc()` (if available)

### High CPU Usage

1. Enable LOD: `lodPolicy.temporalBucketing: true`
2. Reduce data points
3. Switch to lower tier
4. Disable debug logging

## Support Contacts

- **GitHub Issues**: For bugs and feature requests
- **Documentation**: See `/docs` for detailed guides
- **API Reference**: See `/src/lib/viz/hybrid/index.ts`
