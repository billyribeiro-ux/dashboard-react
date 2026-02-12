/**
 * Data Pipeline Types
 * Core type definitions for workerized data processing
 */

import type { z } from 'zod';

// ============================================================================
// PIPELINE MODE
// ============================================================================

export type PipelineMode = 'wasm' | 'worker-js' | 'main-js';

export interface PipelineConfig {
  enableWorkerPipeline: boolean;
  enableWasmAggregation: boolean;
  forcePipelineMode?: PipelineMode;
  maxWorkerPoolSize: number;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  wasmPath?: string;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enableWorkerPipeline: true,
  enableWasmAggregation: true,
  maxWorkerPoolSize: 2,
  cacheEnabled: true,
  cacheTTLSeconds: 300, // 5 minutes
};

// ============================================================================
// DATASET TYPES
// ============================================================================

export interface DataPoint {
  id?: string;
  timestamp: number; // Unix ms
  value: number;
  category?: string;
  series?: string;
  metadata?: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  version: string;
  schema: DatasetSchema;
  points: DataPoint[];
  metadata: DatasetMetadata;
}

export interface DatasetSchema {
  fields: SchemaField[];
  primaryKey?: string;
  timeField: string;
  valueField: string;
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'timestamp' | 'boolean' | 'category';
  nullable?: boolean;
  description?: string;
}

export interface DatasetMetadata {
  totalRows: number;
  timeRange: { start: number; end: number };
  categories: string[];
  series: string[];
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// FILTER TYPES
// ============================================================================

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'between'
  | 'contains';

export interface FilterClause {
  field: string;
  operator: FilterOperator;
  value: unknown;
  value2?: unknown; // For between operator
}

export interface FilterGroup {
  operator: 'and' | 'or';
  clauses: FilterClause[];
}

export interface TimeRangeFilter {
  start: number; // Unix ms
  end: number; // Unix ms
  timezone?: string;
}

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

export type AggregationFunction =
  | 'sum'
  | 'mean'
  | 'median'
  | 'min'
  | 'max'
  | 'count'
  | 'std'
  | 'variance'
  | 'percentile'
  | 'distinct';

export interface AggregationConfig {
  field: string;
  function: AggregationFunction;
  alias: string;
  percentileValue?: number; // For percentile function (0-100)
}

export interface GroupByConfig {
  fields: string[];
  timeBucket?: TimeBucketConfig;
}

export interface TimeBucketConfig {
  field: string;
  interval: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  timezone?: string;
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface AnalyticsRequest {
  requestId: string;
  datasetId: string;
  datasetVersion: string;
  filters: FilterGroup;
  timeRange: TimeRangeFilter;
  groupBy?: GroupByConfig;
  aggregations: AggregationConfig[];
  compareMode?: CompareModeConfig;
  requestedMetrics: MetricType[];
  options?: RequestOptions;
}

export interface CompareModeConfig {
  enabled: boolean;
  baselineTimeRange: TimeRangeFilter;
  comparisonType: 'absolute' | 'percentage' | 'ratio';
}

export type MetricType =
  | 'aggregates'
  | 'timeseries'
  | 'distributions'
  | 'anomalies'
  | 'funnel'
  | 'cohort'
  | 'segments';

export interface RequestOptions {
  includeOutliers?: boolean;
  anomalyThreshold?: number;
  histogramBins?: number;
  rollingWindow?: RollingWindowConfig;
  limit?: number;
  offset?: number;
}

export interface RollingWindowConfig {
  type: 'sma' | 'ema' | 'cumulative';
  period: number;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface AnalyticsResponse {
  requestId: string;
  success: boolean;
  error?: PipelineError;
  data: AnalyticsData;
  metadata: ResponseMetadata;
}

export interface AnalyticsData {
  aggregates?: AggregateResult[];
  timeseries?: TimeSeriesResult[];
  distributions?: DistributionResult[];
  anomalies?: AnomalyResult[];
  funnel?: FunnelResult;
  cohort?: CohortResult;
  segments?: SegmentResult[];
}

export interface AggregateResult {
  groupKey: string;
  groupValues: Record<string, unknown>;
  metrics: Record<string, number>;
  count: number;
}

export interface TimeSeriesResult {
  timestamp: number;
  values: Record<string, number>;
  count: number;
}

export interface DistributionResult {
  field: string;
  bins: Array<{ min: number; max: number; count: number; density: number }>;
  statistics: DistributionStatistics;
}

export interface DistributionStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  std: number;
  q25: number;
  q75: number;
  p95: number;
  p99: number;
}

export interface AnomalyResult {
  point: DataPoint;
  zScore: number;
  expectedValue: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high';
}

export interface FunnelResult {
  stages: Array<{
    name: string;
    count: number;
    previousConversion: number;
    overallConversion: number;
    dropoff: number;
  }>;
  totalConversion: number;
  totalDropoff: number;
}

export interface CohortResult {
  cohorts: Array<{
    cohortDate: string;
    cohortSize: number;
    retentionByPeriod: number[];
  }>;
  periods: string[];
}

export interface SegmentResult {
  segmentId: string;
  segmentName: string;
  size: number;
  percentage: number;
  aggregates: Record<string, number>;
  comparison?: SegmentComparison;
}

export interface SegmentComparison {
  baselineValue: number;
  difference: number;
  percentageChange: number;
  significance: number;
}

export interface ResponseMetadata {
  durationMs: number;
  pipelineMode: PipelineMode;
  cacheHit: boolean;
  rendererHint: 'svg' | 'canvas' | 'webgl';
  rowsProcessed: number;
  memoryEstimateMB?: number;
  wasmUsed: boolean;
  workerTimeMs?: number;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface PipelineError {
  code: PipelineErrorCode;
  message: string;
  details?: Record<string, unknown>;
  fallbackMode?: PipelineMode;
  retryable: boolean;
}

export type PipelineErrorCode =
  | 'WASM_INIT_FAILED'
  | 'WASM_EXECUTION_ERROR'
  | 'WORKER_INIT_FAILED'
  | 'WORKER_EXECUTION_ERROR'
  | 'WORKER_TERMINATED'
  | 'TIMEOUT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'DATASET_NOT_FOUND'
  | 'COMPUTATION_ERROR'
  | 'CANCELLED';

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

export type WorkerMessageType =
  | 'INIT'
  | 'EXECUTE'
  | 'CANCEL'
  | 'PING'
  | 'RESULT'
  | 'ERROR'
  | 'PROGRESS';

export interface WorkerMessage {
  type: WorkerMessageType;
  jobId: string;
  timestamp: number;
  payload?: unknown;
}

export interface WorkerExecuteMessage extends WorkerMessage {
  type: 'EXECUTE';
  payload: {
    request: AnalyticsRequest;
    dataset: Dataset;
    useWasm: boolean;
  };
}

export interface WorkerResultMessage extends WorkerMessage {
  type: 'RESULT';
  payload: AnalyticsResponse;
}

export interface WorkerErrorMessage extends WorkerMessage {
  type: 'ERROR';
  payload: PipelineError;
}

export interface WorkerCancelMessage extends WorkerMessage {
  type: 'CANCEL';
  payload: {
    reason?: string;
  };
}

// ============================================================================
// TELEMETRY TYPES
// ============================================================================

export interface PipelineTelemetry {
  jobId: string;
  requestId: string;
  pipelineMode: PipelineMode;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  cacheHit: boolean;
  wasmUsed: boolean;
  rowsProcessed: number;
  error?: PipelineError;
  fallbackFrom?: PipelineMode;
  queueWaitMs?: number;
  workerTimeMs?: number;
  memoryEstimateMB?: number;
}

export interface WorkerPoolTelemetry {
  poolSize: number;
  activeWorkers: number;
  queueDepth: number;
  jobsCompleted: number;
  jobsCancelled: number;
  averageWaitTimeMs: number;
  averageJobDurationMs: number;
}

export interface CacheTelemetry {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
  averageEntrySizeBytes: number;
}

// ============================================================================
// WASM TYPES
// ============================================================================

export interface WasmModule {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  exports: WasmExports;
}

export interface WasmExports {
  // Aggregation functions
  sum_f64: (ptr: number, len: number) => number;
  mean_f64: (ptr: number, len: number) => number;
  min_f64: (ptr: number, len: number) => number;
  max_f64: (ptr: number, len: number) => number;
  std_f64: (ptr: number, len: number) => number;
  quantile_f64: (ptr: number, len: number, q: number) => number;

  // Histogram
  histogram_f64: (
    ptr: number,
    len: number,
    binPtr: number,
    binCount: number,
    min: number,
    max: number
  ) => void;

  // Rolling windows
  sma_f64: (
    srcPtr: number,
    dstPtr: number,
    len: number,
    period: number
  ) => void;

  // Memory management
  malloc: (size: number) => number;
  free: (ptr: number) => void;
}

export interface WasmLoadResult {
  success: boolean;
  module?: WasmModule;
  error?: string;
  loadTimeMs: number;
}

// ============================================================================
// CACHE KEY TYPES
// ============================================================================

export interface CacheKey {
  datasetId: string;
  datasetVersion: string;
  filterSignature: string;
  aggregationSignature: string;
  metricTypes: string;
}

export interface CacheEntry {
  key: CacheKey;
  response: AnalyticsResponse;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  sizeBytes: number;
}

// ============================================================================
// STATUS/STATE TYPES
// ============================================================================

export interface PipelineStatus {
  mode: PipelineMode;
  initialized: boolean;
  wasmReady: boolean;
  workerPoolReady: boolean;
  activeJobs: number;
  queueDepth: number;
  lastError?: PipelineError;
  lastJobDuration?: number;
  totalJobsCompleted: number;
  cacheHitRate: number;
}

export interface PipelineInspectorData {
  status: PipelineStatus;
  telemetry: {
    recentJobs: PipelineTelemetry[];
    workerPool: WorkerPoolTelemetry;
    cache: CacheTelemetry;
  };
  featureFlags: {
    enableWorkerPipeline: boolean;
    enableWasmAggregation: boolean;
    forcePipelineMode?: PipelineMode;
  };
}
