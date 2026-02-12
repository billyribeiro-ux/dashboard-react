# Worker Pipeline Architecture

## Overview

The Worker Pipeline moves heavy data transformations off the main thread using Web Workers, maintaining UI responsiveness during intensive computations.

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                  React Components                       │
│         (useAnalyticsPipeline, PipelineInspector)       │
├─────────────────────────────────────────────────────────┤
│                 PipelineDispatcher                       │
│    (Orchestrates WASM → Worker → Main thread)           │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │    WASM     │  │   Worker    │  │    Main     │     │
│  │    Path     │  │   Pool      │  │   Thread    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
├─────────────────────────────────────────────────────────┤
│              PipelineCache + Telemetry                  │
└─────────────────────────────────────────────────────────┘
```

## Pipeline Modes

### 1. WASM Path (`wasm`)

**Use When:**

- Large numeric array operations
- Sum, mean, min, max, std, variance, median
- Browser supports WebAssembly

**Fallbacks To:** Worker JS → Main JS

### 2. Worker Path (`worker-js`)

**Use When:**

- Dataset > 1,000 points
- Complex aggregations not in WASM
- Filtering, grouping, time bucketing

**Fallbacks To:** Main JS

### 3. Main Thread Path (`main-js`)

**Use When:**

- Workers not supported (SSR, old browsers)
- Dataset < 1,000 points
- All other paths fail

## Worker Pool Design

### Pool Configuration

- **Default Size:** 2 workers
- **Queue:** FIFO with cancellation support
- **Transferables:** Large datasets transferred, not copied

### Job Lifecycle

```text
1. Job submitted → Added to queue
2. Worker available → Job assigned
3. Transfer dataset to worker
4. Worker computes result
5. Result posted back
6. Promise resolved
```

### Cancellation

```typescript
// Cancel specific job
workerPool.cancel(jobId);

// Cancel all jobs for request
workerPool.cancelAll(requestIdPattern);
```


## Message Protocol

### Request Message

```typescript
{
  type: 'EXECUTE',
  jobId: string,
  payload: {
    request: AnalyticsRequest,
    dataset: Dataset,
    useWasm: boolean
  }
}
```


### Response Message

```typescript
{
  type: 'RESULT',
  jobId: string,
  payload: AnalyticsResponse
}
```


### Error Message

```typescript
{
  type: 'ERROR',
  jobId: string,
  payload: PipelineError
}
```


## Fallback Chain

```text
Request received
    ↓
Can use WASM? ──Yes──→ Execute WASM ──Error──→
    ↓ No                          ↓
Can use Worker? ──Yes──→ Execute Worker ──Error──→
    ↓ No                          ↓
Execute Main Thread JS ←──────────┘
```


## Caching Strategy

### Cache Key Generation

```typescript
key = hash(datasetId + version + filters + aggregations + metrics)
```


### Cache Behavior

- **Hit:** Return cached result immediately
- **Miss:** Compute and store result
- **TTL:** 5 minutes default
- **LRU Eviction:** When size exceeds 100 entries


## Telemetry

### Tracked Metrics

- Job duration (total, queue wait, compute time)
- Pipeline mode used
- Cache hit/miss rate
- Worker pool stats (active, queue depth)
- Fallback events


### Usage

```typescript
const telemetry = getPipelineTelemetry();
telemetry.subscribe((event) => {
  console.log('Job completed:', event);
});
```


## React Integration

### useAnalyticsPipeline Hook

```typescript
const { data, loading, error, execute, cancel } = useAnalyticsPipeline({
  debounceMs: 100
});

// Execute analysis
execute(request, dataset);
```


### usePipelineStatus Hook

```typescript
const { status, telemetry } = usePipelineStatus();
// status.mode: 'wasm' | 'worker-js' | 'main-js'
// telemetry.stats: { cacheHitRate, jobsCompleted }
```


## Performance Budgets

| Metric         | Target   | Warning  |
| -------------- | -------- | -------- |
| Job Duration   | < 1000ms | > 1000ms |
| Queue Wait     | < 100ms  | > 100ms  |
| Cache Hit Rate | > 50%    | < 30%    |


## Security Considerations

1. **CSP:** Workers require `worker-src 'self'`
2. **CORS:** WASM files served with correct MIME type
3. **No eval:** All code statically bundled


## Browser Support

| Feature       | Chrome | Firefox | Safari | Edge |
| ------------- | ------ | ------- | ------ | ---- |
| Web Workers   | ✓      | ✓       | ✓      | ✓    |
| WASM          | ✓      | ✓       | ✓      | ✓    |
| Transferables | ✓      | ✓       | ✓      | ✓    |


## Best Practices

1. **Always check support:**

   ```typescript
   if (typeof Worker !== 'undefined') { ... }
   ```

2. **Handle fallbacks gracefully:**

   ```typescript
   try {
     return await workerPool.execute(...);
   } catch {
     return mainThreadFallback(...);
   }
   ```

3. **Cancel superseded jobs:**

   ```typescript
   useEffect(() => {
     execute(newRequest, dataset);
     return () => cancel(); // Cleanup
   }, [filters]);
   ```


## Troubleshooting

### Workers not initializing

- Check CSP headers
- Verify worker script path
- Check browser console for errors

### High queue depth

- Increase worker pool size
- Reduce debounce time
- Check for stuck jobs

### Cache misses

- Verify cache key generation
- Check TTL settings
- Monitor cache size
