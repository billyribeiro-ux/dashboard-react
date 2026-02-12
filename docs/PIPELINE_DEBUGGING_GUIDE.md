# Pipeline Debugging Guide

## Overview

Debug the data pipeline using built-in telemetry, the PipelineInspector component, and browser dev tools.

## PipelineInspector Component

### Usage

```tsx
import { PipelineInspector } from '@/components/dev/PipelineInspector';

function DevPanel() {
  return (
    <div className="debug-panel">
      <PipelineInspector />
    </div>
  );
}
```

### Displayed Metrics

| Field | Description |
|-------|-------------|
| Mode | Current pipeline mode (wasm/worker-js/main-js) |
| WASM | WASM initialization status |
| Workers | Worker pool readiness |
| Active Jobs | Currently executing jobs |
| Queue Depth | Pending jobs waiting |
| Completed | Total jobs finished |
| Cache Hit Rate | Percentage of cached responses |
| Recent Jobs | Last 10 job history |

## Console Debugging

### Enable Verbose Logging

```typescript
// Set in browser console
localStorage.setItem('PIPELINE_DEBUG', 'true');

// Or in code
import { getPipelineTelemetry } from '@/lib/data-pipeline/telemetry';
getPipelineTelemetry({ sendToConsole: true });
```

### Log Output Examples

```
[Pipeline] Job abc-123 started (wasm)
[Pipeline] Job abc-123 completed in 45ms (10000 rows)
[Pipeline] Fallback: wasm → worker-js (WASM_EXECUTION_ERROR)
[Pipeline] Job def-456 cancelled
[Pipeline] Budget violation: duration 150ms > 100ms threshold
```

## Feature Flags

### Runtime Overrides

```typescript
import { getPipelineDispatcher } from '@/lib/data-pipeline/dispatcher';

const dispatcher = getPipelineDispatcher();

// Force specific mode
dispatcher.setFeatureFlags({
  enableWorkerPipeline: false,
  enableWasmAggregation: false,
  forceMode: 'main-js'
});

// Reset to auto-detect
dispatcher.setFeatureFlags({
  enableWorkerPipeline: true,
  enableWasmAggregation: true,
  forceMode: null
});
```

### URL Parameters

```
https://dashboard.example.com/?pipelineMode=wasm
https://dashboard.example.com/?pipelineMode=worker-js
https://dashboard.example.com/?pipelineMode=main-js
https://dashboard.example.com/?debugPipeline=true
```

## Common Issues

### WASM Not Loading

**Symptoms:**
- Mode always falls back to worker-js or main-js
- "WASM_INIT_FAILED" errors

**Diagnosis:**
```typescript
// Check WASM support
console.log('WebAssembly:', typeof WebAssembly !== 'undefined');

// Check module load
const adapter = new WasmAggregationAdapter();
adapter.initialize().catch(err => console.error('WASM init:', err));
```

**Solutions:**
1. Check WASM file path in Network tab
2. Verify MIME type is `application/wasm`
3. Check CSP headers allow WASM
4. Ensure script is served from same origin

### Workers Not Initializing

**Symptoms:**
- Queue depth always 0
- Jobs never execute
- "WORKER_INIT_FAILED" errors

**Diagnosis:**
```typescript
// Check Worker support
console.log('Workers:', typeof Worker !== 'undefined');

// Check CSP
console.log('CSP:', document.securityPolicy);
```

**Solutions:**
1. Check `worker-src` CSP directive
2. Verify worker script path (404 in Network tab)
3. Check for syntax errors in worker file
4. Ensure workers enabled in browser

### High Queue Depth

**Symptoms:**
- UI feels sluggish
- Queue depth > 5
- Jobs timing out

**Diagnosis:**
```typescript
const status = usePipelineStatus();
console.log('Queue:', status.queueDepth);
console.log('Active:', status.activeJobs);
```

**Solutions:**
1. Increase worker pool size
2. Reduce debounce delay
3. Cancel superseded jobs faster
4. Check for stuck jobs (timeout handling)

### Low Cache Hit Rate

**Symptoms:**
- Cache hit rate < 30%
- Repeated computations for same data

**Diagnosis:**
```typescript
const cache = getPipelineCache();
console.log('Cache stats:', cache.getStats());

// Check key generation
const key = cache.generateKey(datasetId, version, filters, aggs, metrics);
console.log('Cache key:', key);
```

**Solutions:**
1. Verify dataset version stability
2. Check filter object equality
3. Increase cache TTL
4. Review cache key generation

### Memory Issues

**Symptoms:**
- "MEMORY_LIMIT_EXCEEDED" errors
- Browser tab crashes
- WASM out of bounds errors

**Diagnosis:**
```typescript
// Check memory usage
console.log('Heap:', performance.memory?.usedJSHeapSize);

// Monitor WASM memory
if (adapter.memory) {
  console.log('WASM pages:', adapter.memory.buffer.byteLength / 65536);
}
```

**Solutions:**
1. Reduce WASM memory limit
2. Flush cache periodically
3. Reduce dataset chunk size
4. Dispose unused adapters

## Performance Profiling

### Chrome DevTools

1. **Performance Tab:**
   - Record while interacting
   - Look for long tasks (> 50ms)
   - Check frame drops

2. **Memory Tab:**
   - Take heap snapshots
   - Look for retained arrays
   - Check WASM memory growth

3. **Network Tab:**
   - Monitor WASM file load time
   - Check worker script fetch
   - Verify caching headers

### Custom Profiling

```typescript
// Profile specific operations
const start = performance.now();
await pipeline.execute(request, dataset);
const duration = performance.now() - start;
console.log(`Execute took ${duration}ms`);

// Profile with marks
performance.mark('pipeline-start');
await pipeline.execute(request, dataset);
performance.mark('pipeline-end');
performance.measure('pipeline', 'pipeline-start', 'pipeline-end');
const measure = performance.getEntriesByName('pipeline')[0];
console.log(`Total: ${measure.duration}ms`);
```

## Testing Fallbacks

### Force Fallback Chain

```typescript
// 1. Force WASM failure
dispatcher.setFeatureFlags({ enableWasmAggregation: false });
// Expected: wasm → worker-js

// 2. Force Worker failure
dispatcher.setFeatureFlags({ 
  enableWasmAggregation: false,
  enableWorkerPipeline: false 
});
// Expected: main-js only

// 3. Reset
dispatcher.setFeatureFlags({
  enableWasmAggregation: true,
  enableWorkerPipeline: true,
  forceMode: null
});
```

### Simulate Errors

```typescript
// In worker code - simulate crash
if (Math.random() < 0.5) {
  throw new Error('Simulated worker error');
}

// In WASM adapter - simulate OOM
if (dataset.points.length > 1000000) {
  throw new Error('Simulated OOM');
}
```

## Network Debugging

### Check Message Flow

```typescript
// Log all worker messages
const originalPostMessage = Worker.prototype.postMessage;
Worker.prototype.postMessage = function(...args) {
  console.log('Worker postMessage:', args[0]);
  return originalPostMessage.apply(this, args);
};

// Log all received messages
worker.onmessage = (e) => {
  console.log('Worker onmessage:', e.data);
  // ... normal handling
};
```

## Telemetry Analysis

### Export Telemetry

```typescript
const telemetry = getPipelineTelemetry();
const events = telemetry.getRecentEvents(100);
const stats = telemetry.getStats();

console.table(events);
console.table(stats);
```

### Visualize Trends

```typescript
// Collect metrics over time
const metrics: number[] = [];
setInterval(() => {
  const { stats } = usePipelineStatus();
  metrics.push(stats.recentAverageDuration);
  
  if (metrics.length > 60) {
    // 1 minute of data
    console.log('Avg:', 
      metrics.reduce((a, b) => a + b) / metrics.length
    );
    metrics.length = 0;
  }
}, 1000);
```

## Known Limitations

| Issue | Workaround |
|-------|------------|
| Safari WASM memory limits | Use worker-js fallback |
| Incognito mode storage | Cache disabled, expect slower |
| CSP worker-src | Use main-js fallback |
| Large dataset transfer | Use chunked streaming |
