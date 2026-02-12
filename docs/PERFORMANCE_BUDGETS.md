# Performance Budgets

## Overview

Performance budgets define acceptable limits for rendering performance. The hybrid engine enforces these budgets and automatically degrades quality when they're exceeded.

## Budget Categories

### Frame Time Budgets

Control rendering smoothness:

| Metric | Target | Maximum | Action if Exceeded |
|--------|--------|---------|-------------------|
| Frame Time | 16.67ms (60fps) | 33.33ms (30fps) | Auto-degrade tier |
| Render Time | 10ms | 20ms | Reduce LOD |
| FPS | 60 | 30 | Warn user |

### Interaction Latency Budgets

Control responsiveness:

| Interaction | Max Latency | Notes |
|-------------|-------------|-------|
| Hover | 16ms | Must be immediate |
| Click | 50ms | Perceived as instant |
| Brush | 50ms | Can batch updates |
| Zoom | 100ms | Animate if longer |

### Memory Budgets

Prevent browser crashes:

| Resource | Budget | Warning At |
|----------|--------|------------|
| GPU Memory | 512MB | 400MB |
| JS Memory | 256MB | 200MB |
| Spatial Index | 50MB | 40MB |

## Configuration

```typescript
const engine = createHybridEngine({
  performanceBudgets: {
    // Frame budgets (milliseconds)
    targetFrameTime: 16.67,
    maxFrameTime: 33.33,

    // FPS targets
    targetFPS: 60,
    minAcceptableFPS: 30,

    // Interaction latency (milliseconds)
    maxHoverLatency: 16,
    maxBrushLatency: 50,
    maxZoomLatency: 100,

    // Memory budgets (MB)
    maxGPUMemoryMB: 512,
    maxJSMemoryMB: 256,

    // Auto-degrade settings
    autoDegrade: true,
    degradeFrameThreshold: 10,  // Frames before degradation
  }
});
```

## Monitoring

### Real-time Metrics

The engine tracks these metrics continuously:

```typescript
interface FrameMetrics {
  timestamp: number;      // When frame rendered
  frameTime: number;      // Total frame time (ms)
  renderTime: number;     // Rendering only (ms)
  pointCount: number;     // Points rendered
  tier: RendererTier;     // Active renderer
  dropped: boolean;       // Exceeded budget?
}
```

### Accessing Metrics

```typescript
// Get current FPS
const fps = engine.getCurrentFPS();

// Get average frame time
const avgFrameTime = engine.getAverageFrameTime(1000); // Last 1000ms

// Get frame history
const metrics = engine.getFrameMetrics();

// Get dropped frame count
const dropped = engine.getDroppedFrames();
```

### Debug Panel Display

The debug panel shows:
- Current FPS (color-coded: green ≥55, yellow 30-55, red <30)
- Frame time (last frame + average)
- Dropped frames counter
- Point count
- Active renderer tier

## Auto-Degradation

When performance budgets are exceeded, the system automatically reduces quality:

### Degradation Steps

1. **Frame Time > Max**
   - First violation: Log warning
   - 10 consecutive violations: Step down one renderer tier
   - WebGL → Canvas → SVG

2. **Memory > Budget**
   - Reduce LOD level (increase compression)
   - Clear spatial index cache
   - Force garbage collection hint

3. **Interaction Latency > Max**
   - Increase debounce time
   - Disable expensive effects
   - Simplify hit testing

### Degradation Events

Subscribe to degradation events:

```typescript
engine.onEvent((event) => {
  if (event.type === 'performanceViolation') {
    const metrics = event.payload as FrameMetrics;
    console.warn(
      `Performance violation: ${metrics.frameTime}ms frame time`
    );
  }

  if (event.type === 'tierSwitch') {
    const switchEvent = event.payload as TierSwitchEvent;
    if (switchEvent.reason === 'performance') {
      console.log(
        `Auto-degraded from ${switchEvent.from} to ${switchEvent.to}`
      );
    }
  }
});
```

## Manual Budget Management

For custom behavior, disable auto-degrade and handle manually:

```typescript
const engine = createHybridEngine({
  performanceBudgets: {
    autoDegrade: false,  // Handle manually
  }
});

// Check performance in render loop
setInterval(() => {
  const avgFrameTime = engine.getAverageFrameTime(1000);

  if (avgFrameTime > 33) {
    // Custom degradation logic
    if (currentLODLevel > 0) {
      reduceLOD();
    } else {
      forceLowerRendererTier();
    }
  }
}, 1000);
```

## Performance Profiling

### Chrome DevTools

1. Open Performance tab
2. Click Record
3. Interact with chart
4. Stop recording
5. Analyze:
   - Frame bars (green = good, red = slow)
   - Long tasks
   - GPU activity

### Custom Profiler

```typescript
// Wrap render with timing
const profileRender = () => {
  performance.mark('render-start');

  engine.render(data, context);

  performance.mark('render-end');
  performance.measure('render', 'render-start', 'render-end');

  const entries = performance.getEntriesByName('render');
  const lastEntry = entries[entries.length - 1];

  console.log(`Render took ${lastEntry.duration.toFixed(2)}ms`);
};
```

## Optimization Strategies

### When Frame Budget Exceeded

1. **Reduce Data**
   - Apply more aggressive LOD
   - Filter to visible time range
   - Reduce number of series

2. **Optimize Renderer**
   - Switch to lower tier
   - Disable point rendering (lines only)
   - Reduce canvas pixel ratio

3. **Optimize Code**
   - Batch DOM updates
   - Debounce expensive operations
   - Use requestAnimationFrame

### When Memory Budget Exceeded

1. **Clear Caches**
   - Empty spatial index
   - Clear data cache
   - Dispose WebGL textures

2. **Reduce Memory Footprint**
   - Use Float32Array instead of objects
   - Store only visible data
   - Compress historical data

## Testing Performance

### Load Testing

Test with increasing data sizes:

```typescript
const testSizes = [100, 1000, 5000, 10000, 50000, 100000];

for (const size of testSizes) {
  const data = generateData(size);

  const start = performance.now();
  engine.render(data, context);
  const end = performance.now();

  console.log(`${size} points: ${end - start}ms`);
}
```

### Stress Testing

Test rapid interactions:

```typescript
// Simulate rapid zooming
for (let i = 0; i < 100; i++) {
  zoomTo(randomDomain());
}

// Check if still responsive
const frameTime = engine.getAverageFrameTime();
console.assert(frameTime < 33, 'Should maintain 30fps');
```

## Common Issues

### Slow Frame Times

**Symptoms:** FPS < 30, stuttering animation

**Causes:**
1. Too many points for current renderer
2. Complex visual encodings
3. Expensive hit testing
4. Memory pressure causing GC

**Solutions:**
1. Lower threshold to trigger earlier tier switch
2. Enable LOD with more aggressive settings
3. Reduce hit test radius
4. Monitor memory usage

### Memory Leaks

**Symptoms:** Memory growing over time

**Causes:**
1. Not disposing WebGL resources
2. Accumulating event listeners
3. Storing all historical frames

**Solutions:**
1. Call `renderer.destroy()` on unmount
2. Use `removeEventListener` in cleanup
3. Limit frame metrics history (60 frames max)

### Inconsistent FPS

**Symptoms:** Frame time varies wildly

**Causes:**
1. Garbage collection
2. Background browser activity
3. Uneven workload distribution

**Solutions:**
1. Pre-allocate arrays
2. Use `requestIdleCallback` for non-critical work
3. Smooth workload across frames

## Best Practices

1. **Set realistic budgets** - Don't target 60fps on mobile with 100k points
2. **Monitor real users** - Use analytics to track performance in production
3. **Graceful degradation** - Always have a fallback path
4. **Test on target devices** - Developer workstation ≠ user device
5. **Profile before optimizing** - Measure first, then fix

## Metrics to Track

### Technical Metrics
- Frame time (p50, p95, p99)
- FPS distribution
- Dropped frames count
- Memory usage over time

### User Experience Metrics
- Time to first render
- Interaction latency
- Time to interactive
- Cumulative layout shift

## Alerts and Monitoring

```typescript
// Example: Send to analytics when performance degrades
engine.onEvent((event) => {
  if (event.type === 'performanceViolation') {
    analytics.track('performance_violation', {
      frameTime: event.payload.frameTime,
      pointCount: event.payload.pointCount,
      tier: event.payload.tier,
    });
  }
});
```
