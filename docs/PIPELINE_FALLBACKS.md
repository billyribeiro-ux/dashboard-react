# Pipeline Fallbacks

## Overview

The fallback system ensures the UI remains functional even when WASM or Web Workers fail. The pipeline gracefully degrades from high-performance paths to the reliable main-thread JavaScript implementation.

## Fallback Chain

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    WASM     │ ──► │   Worker    │ ──► │    Main     │
│    Path     │     │    JS       │     │   Thread    │
└─────────────┘     └─────────────┘     └─────────────┘
   Preferred           Secondary           Guaranteed
   (fastest)            (reliable)         (always works)
```

## Trigger Conditions

### WASM → Worker JS
- WASM module fails to load
- Browser doesn't support WebAssembly
- WASM execution throws error
- Memory allocation fails in WASM

### Worker JS → Main JS
- Worker instantiation fails
- CSP blocks worker creation
- Worker script 404s
- Worker crashes/terminates
- Message timeout
- Response validation fails

### Main JS Emergency
- All paths exhausted
- Returns error response with fallback info
- UI shows degraded state
- Telemetry logs failure

## Implementation

### Dispatcher Logic

```typescript
class PipelineDispatcher {
  async execute(request, dataset) {
    const modes = this.getFallbackChain(preferredMode);
    
    for (let i = 0; i < modes.length; i++) {
      try {
        return await this.executeMode(modes[i], request, dataset);
      } catch (err) {
        // Log fallback
        this.telemetry.recordFallback(modes[i], modes[i + 1], err);
        
        // Continue to next mode
        if (i === modes.length - 1) throw err;
      }
    }
  }
  
  getFallbackChain(preferred) {
    if (preferred === 'wasm') return ['wasm', 'worker-js', 'main-js'];
    if (preferred === 'worker-js') return ['worker-js', 'main-js'];
    return ['main-js'];
  }
}
```

### Mode Selection

```typescript
function determinePipelineMode(request, dataset) {
  // 1. Force mode override (dev/debug)
  if (forceMode) return forceMode;
  
  // 2. WASM available and suitable?
  if (wasmReady && canUseWasmFor(request)) {
    return 'wasm';
  }
  
  // 3. Workers available?
  if (workerPoolReady && dataset.points.length > 1000) {
    return 'worker-js';
  }
  
  // 4. Fall back to main thread
  return 'main-js';
}
```

## Error Telemetry

### Fallback Events

```typescript
{
  jobId: '123',
  fromMode: 'wasm',
  toMode: 'worker-js',
  error: {
    code: 'WASM_EXECUTION_ERROR',
    message: 'Out of bounds memory access'
  },
  timestamp: Date.now()
}
```

### Dashboard Metrics

| Metric | Target | Alert |
|--------|--------|-------|
| WASM Fallback Rate | < 5% | > 10% |
| Worker Fallback Rate | < 2% | > 5% |
| Main Thread Rate | < 10% | > 20% |

## User Experience

### Visual Indicators

**Normal Mode (WASM/Worker):**
- No indicator
- Fast response

**Fallback Mode (Main Thread):**
- Subtle "Computing..." indicator
- Slight delay acceptable

**Error State:**
- Warning icon with tooltip
- "Using fallback mode - performance reduced"
- Still functional

### Feature Degradation

| Feature | WASM/Worker | Main Thread |
|---------|-------------|-------------|
| Aggregations | All | All (slower) |
| Real-time | Yes | Debounced |
| Large datasets | 1M+ points | 100K+ points |
| Interactive | Immediate | Delayed |

## Testing Fallbacks

### Simulated Failures

```typescript
// Force WASM failure
dispatcher.setFeatureFlags({ enableWasmAggregation: false });

// Force Worker failure  
dispatcher.setFeatureFlags({ enableWorkerPipeline: false });

// Both disabled = main thread only
```

### E2E Test Scenarios

1. **WASM Unavailable:**
   ```
   Load page in WASM-disabled browser
   Expect: worker-js or main-js mode
   ```

2. **Workers Blocked:**
   ```
   Set CSP: worker-src 'none'
   Expect: main-js mode with warning
   ```

3. **Worker Crash:**
   ```
   Send invalid data to trigger worker error
   Expect: fallback to main-js
   ```

4. **Timeout:**
   ```
   Set very short timeout
   Expect: timeout error → main-js
   ```

## Recovery

### Automatic Retry

```typescript
if (error.retryable) {
  await delay(100);
  return executeWithFallback(request, dataset, nextMode);
}
```

### Mode Healing

```typescript
// Try to reinitialize failed mode
if (mode === 'wasm' && !wasmAdapter.isReady()) {
  try {
    await wasmAdapter.initialize();
  } catch {
    // Still failed, continue with fallback
  }
}
```

## Best Practices

1. **Always implement main-thread fallback:**
   ```typescript
   const modes = getFallbackChain();
   if (modes.length === 1) {
     throw new Error('No fallback available');
   }
   ```

2. **Preserve state across fallbacks:**
   ```typescript
   // User selection survives mode switch
   response.data.selectedPoints = previousSelection;
   ```

3. **Notify on significant degradation:**
   ```typescript
   if (mode === 'main-js' && datasetSize > 10000) {
     showWarning('Large dataset - processing may be slow');
   }
   ```

4. **Log for debugging:**
   ```typescript
   console.warn(
     `[Pipeline] Fallback: ${from} → ${to}`,
     `Reason: ${error.code}`
   );
   ```

## Known Limitations

| Scenario | Behavior |
|----------|----------|
| WASM OOM | Falls back to worker, then main |
| Worker CSP violation | Immediate main thread fallback |
| iOS Safari | WASM may fail silently |
| Incognito mode | Storage limits may affect caching |
