# Pipeline Contracts

## Overview

Strict request/response contracts validated with Zod ensure type safety across WASM, Worker, and Main thread boundaries.

## Request Contract

### AnalyticsRequest Schema

```typescript
{
  requestId: string;           // Unique request identifier
  datasetId: string;         // Dataset identifier
  datasetVersion: string;      // Dataset version for cache key
  filters: FilterGroup;       // Filter configuration
  timeRange: TimeRangeFilter; // Time bounds
  groupBy?: GroupByConfig;    // Optional grouping
  aggregations: AggregationConfig[]; // Metrics to compute
  compareMode?: CompareModeConfig;   // Comparison settings
  requestedMetrics: MetricType[];    // Output types needed
  options?: RequestOptions;   // Additional options
}
```

### FilterGroup

```typescript
{
  operator: 'and' | 'or';
  clauses: FilterClause[];
}

interface FilterClause {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'between' | 'contains';
  value: unknown;
  value2?: unknown;  // For between operator
}
```

### AggregationConfig

```typescript
{
  field: string;
  function: 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count' | 'std' | 'variance' | 'percentile' | 'distinct';
  alias: string;     // Output field name
  percentileValue?: number;  // For percentile function
}
```

## Response Contract

### AnalyticsResponse Schema

```typescript
{
  requestId: string;
  success: boolean;
  error?: PipelineError;
  data: AnalyticsData;
  metadata: ResponseMetadata;
}
```

### AnalyticsData

```typescript
{
  aggregates?: AggregateResult[];
  timeseries?: TimeSeriesResult[];
  distributions?: DistributionResult[];
  anomalies?: AnomalyResult[];
  funnel?: FunnelResult;
  cohort?: CohortResult;
  segments?: SegmentResult[];
}
```

### ResponseMetadata

```typescript
{
  durationMs: number;           // Total computation time
  pipelineMode: 'wasm' | 'worker-js' | 'main-js';
  cacheHit: boolean;
  rendererHint: 'svg' | 'canvas' | 'webgl';
  rowsProcessed: number;
  memoryEstimateMB?: number;
  wasmUsed: boolean;
  workerTimeMs?: number;
}
```

## Validation

### Request Validation

```typescript
import { validateAnalyticsRequest } from '@/lib/data-pipeline/schema';

const result = validateAnalyticsRequest(unknownData);

if (!result.success) {
  console.error('Invalid request:', result.error.issues);
  throw new Error('Request validation failed');
}

const request = result.data; // Type-safe request
```

### Response Validation

```typescript
import { validateAnalyticsResponse } from '@/lib/data-pipeline/schema';

const result = validateAnalyticsResponse(workerResponse);

if (!result.success) {
  // Worker returned invalid response - use fallback
  return fallbackCompute(request, dataset);
}

return result.data;
```

## Worker Message Contracts

### Execute Message

```typescript
{
  type: 'EXECUTE';
  jobId: string;
  timestamp: number;
  payload: {
    request: AnalyticsRequest;
    dataset: Dataset;
    useWasm: boolean;
  }
}
```

### Result Message

```typescript
{
  type: 'RESULT';
  jobId: string;
  timestamp: number;
  payload: AnalyticsResponse;
}
```

### Error Message

```typescript
{
  type: 'ERROR';
  jobId: string;
  timestamp: number;
  payload: {
    code: PipelineErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
  }
}
```

### Cancel Message

```typescript
{
  type: 'CANCEL';
  jobId: string;
  timestamp: number;
  payload?: { reason?: string }
}
```

## Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| WASM_INIT_FAILED | WASM module failed to load | Yes |
| WASM_EXECUTION_ERROR | WASM computation error | Yes |
| WORKER_INIT_FAILED | Worker failed to initialize | Yes |
| WORKER_EXECUTION_ERROR | Worker computation error | Yes |
| WORKER_TERMINATED | Worker crashed or terminated | Yes |
| TIMEOUT_EXCEEDED | Job exceeded timeout | Yes |
| MEMORY_LIMIT_EXCEEDED | Memory budget exceeded | No |
| INVALID_REQUEST | Request failed validation | No |
| DATASET_NOT_FOUND | Dataset not available | No |
| COMPUTATION_ERROR | General computation error | Yes |
| CANCELLED | Job was cancelled | Yes |

## Contract Evolution

### Versioning Strategy

1. **Backward Compatible Changes:**
   - Add optional fields
   - Add new metric types
   - Add new aggregation functions

2. **Breaking Changes:**
   - Rename required fields
   - Remove metric types
   - Change field types

### Migration Example

```typescript
// Version 1 request
const v1Request = {
  requestId: '123',
  datasetId: 'abc',
  aggregations: [{ field: 'value', function: 'sum', alias: 'total' }],
};

// Version 2 adds optional groupBy
const v2Request = {
  ...v1Request,
  groupBy: { fields: ['category'] },  // New optional field
};
```

## Testing Contracts

### Request Contract Test

```typescript
test('validates correct request', () => {
  const request = createValidRequest();
  const result = validateAnalyticsRequest(request);
  expect(result.success).toBe(true);
});

test('rejects invalid operator', () => {
  const request = createRequest({
    filters: {
      operator: 'and',
      clauses: [{ field: 'x', operator: 'invalid', value: 1 }]
    }
  });
  const result = validateAnalyticsRequest(request);
  expect(result.success).toBe(false);
});
```

### Response Contract Test

```typescript
test('validates worker response', () => {
  const response = createValidResponse();
  const result = validateAnalyticsResponse(response);
  expect(result.success).toBe(true);
});

test('rejects response with missing metadata', () => {
  const response = { requestId: '123', success: true, data: {} };
  const result = validateAnalyticsResponse(response);
  expect(result.success).toBe(false);
});
```

## Type Safety

### Type Inference from Schema

```typescript
import { AnalyticsRequestSchema } from '@/lib/data-pipeline/schema';
import { z } from 'zod';

type AnalyticsRequest = z.infer<typeof AnalyticsRequestSchema>;

// AnalyticsRequest is now fully typed
function processRequest(request: AnalyticsRequest) {
  // request.filters.operator is typed as 'and' | 'or'
  // request.aggregations[0].function is typed as AggregationFunction
}
```

## Best Practices

1. **Always validate at boundaries:**
   - Worker entry/exit
   - API endpoints
   - LocalStorage retrieval

2. **Fail fast:**
   ```typescript
   const result = validateAnalyticsRequest(data);
   if (!result.success) {
     return { success: false, error: result.error };
   }
   // Continue with valid data
   ```

3. **Log validation failures:**
   ```typescript
   if (!result.success) {
     telemetry.record({
       code: 'INVALID_REQUEST',
       details: { issues: result.error.issues }
     });
   }
   ```

4. **Don't trust external data:**
   - Always validate worker responses
   - Always validate API payloads
   - Never cast unknown to typed without validation
