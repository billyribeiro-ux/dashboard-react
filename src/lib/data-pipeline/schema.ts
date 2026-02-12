/**
 * Data Pipeline Schema
 * Zod validation schemas for all pipeline messages
 */

import { z } from 'zod';

// ============================================================================
// BASE SCHEMAS
// ============================================================================

export const FilterOperatorSchema = z.enum([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between', 'contains',
]);

export const AggregationFunctionSchema = z.enum([
  'sum', 'mean', 'median', 'min', 'max', 'count', 'std', 'variance', 'percentile', 'distinct',
]);

export const MetricTypeSchema = z.enum([
  'aggregates', 'timeseries', 'distributions', 'anomalies', 'funnel', 'cohort', 'segments',
]);

export const PipelineModeSchema = z.enum(['wasm', 'worker-js', 'main-js']);

export const PipelineErrorCodeSchema = z.enum([
  'WASM_INIT_FAILED',
  'WASM_EXECUTION_ERROR',
  'WORKER_INIT_FAILED',
  'WORKER_EXECUTION_ERROR',
  'WORKER_TERMINATED',
  'TIMEOUT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'INVALID_REQUEST',
  'DATASET_NOT_FOUND',
  'COMPUTATION_ERROR',
  'CANCELLED',
]);

// ============================================================================
// DATASET SCHEMAS
// ============================================================================

export const SchemaFieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'timestamp', 'boolean', 'category']),
  nullable: z.boolean().optional(),
  description: z.string().optional(),
});

export const DatasetSchemaSchema = z.object({
  fields: z.array(SchemaFieldSchema),
  primaryKey: z.string().optional(),
  timeField: z.string(),
  valueField: z.string(),
});

export const DatasetMetadataSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  timeRange: z.object({
    start: z.number(),
    end: z.number(),
  }),
  categories: z.array(z.string()),
  series: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const DataPointSchema = z.object({
  id: z.string().optional(),
  timestamp: z.number(),
  value: z.number(),
  category: z.string().optional(),
  series: z.string().optional(),
  metadata: z.record(z.unknown().optional()),
});

export const DatasetSchema = z.object({
  id: z.string(),
  version: z.string(),
  schema: DatasetSchemaSchema,
  points: z.array(DataPointSchema),
  metadata: DatasetMetadataSchema,
});

// ============================================================================
// FILTER SCHEMAS
// ============================================================================

export const FilterClauseSchema = z.object({
  field: z.string(),
  operator: FilterOperatorSchema,
  value: z.unknown(),
  value2: z.unknown().optional(),
});

export const FilterGroupSchema = z.object({
  operator: z.enum(['and', 'or']),
  clauses: z.array(FilterClauseSchema),
});

export const TimeRangeFilterSchema = z.object({
  start: z.number(),
  end: z.number(),
  timezone: z.string().optional(),
});

// ============================================================================
// AGGREGATION SCHEMAS
// ============================================================================

export const AggregationConfigSchema = z.object({
  field: z.string(),
  function: AggregationFunctionSchema,
  alias: z.string(),
  percentileValue: z.number().min(0).max(100).optional(),
});

export const TimeBucketConfigSchema = z.object({
  field: z.string(),
  interval: z.enum(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']),
  timezone: z.string().optional(),
});

export const GroupByConfigSchema = z.object({
  fields: z.array(z.string()),
  timeBucket: TimeBucketConfigSchema.optional(),
});

export const CompareModeConfigSchema = z.object({
  enabled: z.boolean(),
  baselineTimeRange: TimeRangeFilterSchema,
  comparisonType: z.enum(['absolute', 'percentage', 'ratio']),
});

export const RollingWindowConfigSchema = z.object({
  type: z.enum(['sma', 'ema', 'cumulative']),
  period: z.number().int().positive(),
});

export const RequestOptionsSchema = z.object({
  includeOutliers: z.boolean().optional(),
  anomalyThreshold: z.number().optional(),
  histogramBins: z.number().int().positive().optional(),
  rollingWindow: RollingWindowConfigSchema.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// ============================================================================
// REQUEST SCHEMA
// ============================================================================

export const AnalyticsRequestSchema = z.object({
  requestId: z.string(),
  datasetId: z.string(),
  datasetVersion: z.string(),
  filters: FilterGroupSchema,
  timeRange: TimeRangeFilterSchema,
  groupBy: GroupByConfigSchema.optional(),
  aggregations: z.array(AggregationConfigSchema),
  compareMode: CompareModeConfigSchema.optional(),
  requestedMetrics: z.array(MetricTypeSchema),
  options: RequestOptionsSchema.optional(),
});

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

export const AggregateResultSchema = z.object({
  groupKey: z.string(),
  groupValues: z.record(z.unknown().optional()),
  metrics: z.record(z.number()),
  count: z.number().int().nonnegative(),
});

export const TimeSeriesResultSchema = z.object({
  timestamp: z.number(),
  values: z.record(z.number()),
  count: z.number().int().nonnegative(),
});

export const DistributionStatisticsSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  median: z.number(),
  std: z.number(),
  q25: z.number(),
  q75: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const DistributionResultSchema = z.object({
  field: z.string(),
  bins: z.array(z.object({
    min: z.number(),
    max: z.number(),
    count: z.number().int().nonnegative(),
    density: z.number(),
  })),
  statistics: DistributionStatisticsSchema,
});

export const AnomalyResultSchema = z.object({
  point: DataPointSchema,
  zScore: z.number(),
  expectedValue: z.number(),
  deviation: z.number(),
  severity: z.enum(['low', 'medium', 'high']),
});

export const FunnelResultSchema = z.object({
  stages: z.array(z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
    previousConversion: z.number(),
    overallConversion: z.number(),
    dropoff: z.number(),
  })),
  totalConversion: z.number(),
  totalDropoff: z.number(),
});

export const CohortResultSchema = z.object({
  cohorts: z.array(z.object({
    cohortDate: z.string(),
    cohortSize: z.number().int().nonnegative(),
    retentionByPeriod: z.array(z.number()),
  })),
  periods: z.array(z.string()),
});

export const SegmentComparisonSchema = z.object({
  baselineValue: z.number(),
  difference: z.number(),
  percentageChange: z.number(),
  significance: z.number(),
});

export const SegmentResultSchema = z.object({
  segmentId: z.string(),
  segmentName: z.string(),
  size: z.number().int().nonnegative(),
  percentage: z.number(),
  aggregates: z.record(z.number()),
  comparison: SegmentComparisonSchema.optional(),
});

export const AnalyticsDataSchema = z.object({
  aggregates: z.array(AggregateResultSchema).optional(),
  timeseries: z.array(TimeSeriesResultSchema).optional(),
  distributions: z.array(DistributionResultSchema).optional(),
  anomalies: z.array(AnomalyResultSchema).optional(),
  funnel: FunnelResultSchema.optional(),
  cohort: CohortResultSchema.optional(),
  segments: z.array(SegmentResultSchema).optional(),
});

export const ResponseMetadataSchema = z.object({
  durationMs: z.number().nonnegative(),
  pipelineMode: PipelineModeSchema,
  cacheHit: z.boolean(),
  rendererHint: z.enum(['svg', 'canvas', 'webgl']),
  rowsProcessed: z.number().int().nonnegative(),
  memoryEstimateMB: z.number().optional(),
  wasmUsed: z.boolean(),
  workerTimeMs: z.number().optional(),
});

export const PipelineErrorSchema = z.object({
  code: PipelineErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown().optional()).optional(),
  fallbackMode: PipelineModeSchema.optional(),
  retryable: z.boolean(),
});

export const AnalyticsResponseSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  error: PipelineErrorSchema.optional(),
  data: AnalyticsDataSchema,
  metadata: ResponseMetadataSchema,
});

// ============================================================================
// WORKER MESSAGE SCHEMAS
// ============================================================================

export const WorkerMessageTypeSchema = z.enum([
  'INIT', 'EXECUTE', 'CANCEL', 'PING', 'RESULT', 'ERROR', 'PROGRESS',
]);

export const BaseWorkerMessageSchema = z.object({
  type: WorkerMessageTypeSchema,
  jobId: z.string(),
  timestamp: z.number(),
  payload: z.unknown().optional(),
});

export const WorkerExecuteMessageSchema = BaseWorkerMessageSchema.extend({
  type: z.literal('EXECUTE'),
  payload: z.object({
    request: AnalyticsRequestSchema,
    dataset: DatasetSchema,
    useWasm: z.boolean(),
  }),
});

export const WorkerResultMessageSchema = BaseWorkerMessageSchema.extend({
  type: z.literal('RESULT'),
  payload: AnalyticsResponseSchema,
});

export const WorkerErrorMessageSchema = BaseWorkerMessageSchema.extend({
  type: z.literal('ERROR'),
  payload: PipelineErrorSchema,
});

export const WorkerCancelMessageSchema = BaseWorkerMessageSchema.extend({
  type: z.literal('CANCEL'),
  payload: z.object({
    reason: z.string().optional(),
  }).optional(),
});

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateAnalyticsRequest(data: unknown) {
  return AnalyticsRequestSchema.safeParse(data);
}

export function validateAnalyticsResponse(data: unknown) {
  return AnalyticsResponseSchema.safeParse(data);
}

export function validateWorkerMessage(data: unknown) {
  return BaseWorkerMessageSchema.safeParse(data);
}

export function validateWorkerExecuteMessage(data: unknown) {
  return WorkerExecuteMessageSchema.safeParse(data);
}

export function validateWorkerResultMessage(data: unknown) {
  return WorkerResultMessageSchema.safeParse(data);
}

export function validateDataset(data: unknown) {
  return DatasetSchema.safeParse(data);
}

// ============================================================================
// TYPE INFERENCE EXPORTS
// ============================================================================

export type ValidatedAnalyticsRequest = z.infer<typeof AnalyticsRequestSchema>;
export type ValidatedAnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;
export type ValidatedWorkerExecuteMessage = z.infer<typeof WorkerExecuteMessageSchema>;
export type ValidatedWorkerResultMessage = z.infer<typeof WorkerResultMessageSchema>;
export type ValidatedDataset = z.infer<typeof DatasetSchema>;
