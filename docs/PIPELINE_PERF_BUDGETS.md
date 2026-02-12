# Pipeline Performance Budgets

## Overview

Performance budgets define acceptable limits for computation time, memory usage, and queue latency. Exceeding budgets triggers adaptive behaviors to maintain UI responsiveness.

## Budget Definitions

### Main Thread Blocking

| Budget | Threshold | Action |
|--------|-----------|--------|
| Target | 16ms (1 frame) | Ideal - no frame drop |
| Warning | 33ms (2 frames) | Log warning |
| Critical | 100ms (6 frames) | Degrade quality |
| Unacceptable | > 1s | Emergency fallback |

### Pipeline Response Time

| Dataset Size | Target | Warning | Critical |
|--------------|--------|---------|----------|
| < 1K points | 50ms | 100ms | 500ms |
| 1K - 10K | 100ms | 250ms | 1000ms |
| 10K - 100K | 250ms | 500ms | 2000ms |
| > 100K | 500ms | 1000ms | 5000ms |

### Worker Queue

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Queue Depth | 0-2 | 3-5 | > 5 |
| Wait Time | < 50ms | 50-200ms | > 200ms |
| Job Duration | See above | 2x target | 5x target |

## Adaptive Behaviors

### When Budgets Exceeded

**Duration > Warning Threshold:**
1. Enable more aggressive caching
2. Increase LOD (Level of Detail)
3. Log telemetry event

**Duration > Critical Threshold:**
1. Force lower pipeline mode (WASM → Worker → Main)
2. Reduce data points via sampling
3. Defer secondary metrics
4. Show loading indicator

**Memory > Budget:**
1. Flush cache
2. Reduce worker pool size
3. Lower LOD
4. Stream instead of batch

**Queue Depth > Critical:**
1. Cancel oldest pending jobs
2. Increase debounce time
3. Batch rapid changes
4. Show "Processing..." state

## Configuration

```typescript
const dispatcher = new PipelineDispatcher({
  performanceBudgets: {
    // Main thread blocking (ms)
    maxMainThreadBlockMs: 16,
    
    // Pipeline response by dataset size
    responseTimeBudgets: {
      small: { target: 50, warning: 100, critical: 500 },    // < 1K
      medium: { target: 100, warning: 250, critical: 1000 }, // 1K - 10K
      large: { target: 250, warning: 500, critical: 2000 },   // 10K - 100K
      xlarge: { target: 500, warning: 1000, critical: 5000 }, // > 100K
    },
    
    // Worker queue
    maxQueueDepth: 5,
    maxQueueWaitMs: 200,
    maxJobDurationMs: 5000,
    
    // Memory
    maxCacheSizeMB: 50,
    maxWasmMemoryMB: 128,
    
    // Adaptive triggers
    autoDegrade: true,
    cancelOnSupersede: true,
  }
});
```

## Monitoring

### Telemetry Events

```typescript
// Budget violation
{
  type: 'BUDGET_VIOLATION',
  budgetType: 'duration' | 'memory' | 'queue',
  severity: 'warning' | 'critical',
  actualValue: 150,
  budgetValue: 100,
  datasetSize: 5000,
  pipelineMode: 'worker-js',
}

// Adaptive action taken
{
  type: 'ADAPTIVE_ACTION',
  action: 'increase_lod' | 'reduce_workers' | 'force_fallback',
  trigger: 'duration_critical',
  result: 'success' | 'partial' | 'failed',
}
```

### Real-time Metrics

```typescript
const status = usePipelineStatus();

// Check budget status
if (status.telemetry.recentAverageDuration > 250) {
  showPerformanceWarning();
}

if (status.cacheHitRate < 0.3) {
  suggestEnableCache();
}
```

## Testing Budgets

### Load Testing

```typescript
async function testBudgets() {
  const sizes = [100, 1000, 5000, 10000, 50000];
  
  for (const size of sizes) {
    const data = generateData(size);
    const start = performance.now();
    
    await pipeline.execute(createRequest(), data);
    
    const duration = performance.now() - start;
    console.log(`${size} points: ${duration}ms`);
    
    // Assert budget
    const budget = getBudgetForSize(size);
    expect(duration).toBeLessThan(budget.critical);
  }
}
```

### Stress Testing

```typescript
async function testQueueBehavior() {
  // Submit 20 rapid requests
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(pipeline.execute(createRequest(i), dataset));
  }
  
  // Most should complete, oldest may be cancelled
  const results = await Promise.allSettled(promises);
  const cancelled = results.filter(r => r.reason?.code === 'CANCELLED');
  
  expect(cancelled.length).toBeGreaterThan(0);
}
```

## Optimization Strategies

### For Small Datasets (< 1K)

- Use main-thread JS (no worker overhead)
- Disable LOD
- Aggressive caching

### For Medium Datasets (1K - 10K)

- Use worker pool
- Light LOD if needed
- Spatial indexing for interactions

### For Large Datasets (> 10K)

- WASM for aggregations
- Aggressive LOD
- Virtual scrolling
- Progressive rendering

## SLOs (Service Level Objectives)

| SLO | Target | Measurement |
|-----|--------|-------------|
| P95 Response Time | < 250ms | 95th percentile over 7 days |
| Cache Hit Rate | > 50% | Daily average |
| Fallback Rate | < 5% | Daily percentage |
| Error Rate | < 0.1% | Failed jobs / total jobs |

## Alerting

### Warning Alerts

- P95 response time > 500ms for 5 minutes
- Cache hit rate < 30% for 10 minutes
- Queue depth > 3 for 1 minute

### Critical Alerts

- P95 response time > 2000ms
- Error rate > 1%
- 100% fallback to main thread

## Dashboard Integration

```typescript
function PerformancePanel() {
  const { status, telemetry } = usePipelineStatus();
  
  return (
    <div>
      <Metric 
        label="Avg Response Time"
        value={`${telemetry.stats.recentAverageDuration.toFixed(0)}ms`}
        status={telemetry.stats.recentAverageDuration < 250 ? 'good' : 'warning'}
      />
      <Metric
        label="Cache Hit Rate"
        value={`${(telemetry.stats.cacheHitRate * 100).toFixed(1)}%`}
        status={telemetry.stats.cacheHitRate > 0.5 ? 'good' : 'warning'}
      />
    </div>
  );
}
```
