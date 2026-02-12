/**
 * Data Pipeline - Main Export
 * Workerized data pipelines with WASM acceleration
 */

// Types
export type {
  PipelineMode,
  PipelineConfig,
  DataPoint,
  Dataset,
  DatasetSchema as DatasetSchemaType,
  DatasetMetadata,
  SchemaField,
  FilterOperator,
  FilterClause,
  FilterGroup,
  TimeRangeFilter,
  AggregationFunction,
  AggregationConfig,
  GroupByConfig,
  TimeBucketConfig,
  CompareModeConfig,
  MetricType,
  RequestOptions,
  RollingWindowConfig,
  AnalyticsRequest,
  AnalyticsResponse,
  AnalyticsData,
  AggregateResult,
  TimeSeriesResult,
  DistributionResult,
  DistributionStatistics,
  AnomalyResult,
  FunnelResult,
  CohortResult,
  SegmentResult,
  SegmentComparison,
  ResponseMetadata,
  PipelineError,
  PipelineErrorCode,
  WorkerMessage,
  WorkerExecuteMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  PipelineTelemetry,
  WorkerPoolTelemetry,
  CacheTelemetry,
  CacheKey,
  CacheEntry,
  PipelineStatus,
} from './types';

// Schema & Validation
export {
  FilterOperatorSchema,
  AggregationFunctionSchema,
  MetricTypeSchema,
  PipelineModeSchema,
  PipelineErrorCodeSchema,
  SchemaFieldSchema,
  DatasetSchemaSchema,
  DatasetMetadataSchema,
  DataPointSchema,
  DatasetSchema,
  FilterClauseSchema,
  FilterGroupSchema,
  TimeRangeFilterSchema,
  AggregationConfigSchema,
  TimeBucketConfigSchema,
  GroupByConfigSchema,
  CompareModeConfigSchema,
  RollingWindowConfigSchema,
  RequestOptionsSchema,
  AnalyticsRequestSchema,
  AggregateResultSchema,
  TimeSeriesResultSchema,
  DistributionStatisticsSchema,
  DistributionResultSchema,
  AnomalyResultSchema,
  FunnelResultSchema,
  CohortResultSchema,
  SegmentComparisonSchema,
  SegmentResultSchema,
  AnalyticsDataSchema,
  ResponseMetadataSchema,
  PipelineErrorSchema,
  AnalyticsResponseSchema,
  validateAnalyticsRequest,
  validateAnalyticsResponse,
  validateDataset,
} from './schema';

// Core Classes
export { PipelineCache, getPipelineCache, resetPipelineCache } from './cache';
export { PipelineTelemetryCollector, getPipelineTelemetry, resetPipelineTelemetry } from './telemetry';
export { PipelineDispatcher, getPipelineDispatcher, resetPipelineDispatcher } from './dispatcher';

// Main Thread Fallback
export {
  applyFilters,
  groupPoints,
  computeAggregation,
  computeAggregationsMainThread,
  computeDistribution,
} from './main-thread-fallback';

// React Hooks
export {
  useAnalyticsPipeline,
  usePipelineStatus,
  usePipelineInspectorData,
  type UseAnalyticsPipelineOptions,
  type UseAnalyticsPipelineResult,
  type UsePipelineStatusResult,
  type PipelineInspectorData,
} from './hooks';

// Worker Pool
export { WorkerPool, type WorkerPoolConfig, DEFAULT_WORKER_POOL_CONFIG } from '../workers/worker-pool';

// WASM Adapter
export {
  WasmAggregationAdapter,
  type WasmAdapterConfig,
  DEFAULT_WASM_CONFIG,
  createStubWasmExports,
} from '../wasm/aggregations-adapter';
