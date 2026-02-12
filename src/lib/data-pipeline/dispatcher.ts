/**
 * Pipeline Dispatcher
 * Orchestrates WASM → Worker → Main thread fallback chain
 */

import type {
  AnalyticsRequest,
  AnalyticsResponse,
  Dataset,
  PipelineMode,
  PipelineConfig,
  PipelineError,
} from './types';
import { validateAnalyticsRequest, validateAnalyticsResponse } from './schema';
import { PipelineCache, getPipelineCache } from './cache';
import { PipelineTelemetryCollector, getPipelineTelemetry } from './telemetry';
import { WorkerPool } from '../workers/worker-pool';
import { WasmAggregationAdapter } from '../wasm/aggregations-adapter';
import { computeAggregationsMainThread } from './main-thread-fallback';

// ============================================================================
// DISPATCHER CONFIGURATION
// ============================================================================

const DEFAULT_DISPATCHER_CONFIG: PipelineConfig = {
  enableWorkerPipeline: true,
  enableWasmAggregation: true,
  maxWorkerPoolSize: 2,
  cacheEnabled: true,
  cacheTTLSeconds: 300,
};

// ============================================================================
// PIPELINE DISPATCHER
// ============================================================================

export class PipelineDispatcher {
  private config: PipelineConfig;
  private cache: PipelineCache;
  private telemetry: PipelineTelemetryCollector;
  private workerPool: WorkerPool | null = null;
  private wasmAdapter: WasmAggregationAdapter | null = null;
  private isClient = false;

  // Feature flags (can be overridden at runtime)
  private flags = {
    enableWorkerPipeline: true,
    enableWasmAggregation: true,
    forceMode: null as PipelineMode | null,
  };

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
    this.cache = getPipelineCache();
    this.telemetry = getPipelineTelemetry();

    // Check if we're in browser (not SSR)
    this.isClient = typeof window !== 'undefined';

    if (this.isClient) {
      this.initialize();
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private async initialize(): Promise<void> {
    if (!this.isClient) return;

    // Initialize worker pool if enabled
    if (this.config.enableWorkerPipeline && this.flags.enableWorkerPipeline) {
      try {
        this.workerPool = new WorkerPool({
          poolSize: this.config.maxWorkerPoolSize,
        });
        await this.workerPool.initialize();
      } catch (err) {
        console.warn('[Pipeline] Worker pool initialization failed:', err);
        this.telemetry.recordJobError('init', {
          code: 'WORKER_INIT_FAILED',
          message: String(err),
          retryable: false,
        });
      }
    }

    // Initialize WASM if enabled
    if (this.config.enableWasmAggregation && this.flags.enableWasmAggregation) {
      try {
        this.wasmAdapter = new WasmAggregationAdapter();
        await this.wasmAdapter.initialize();
      } catch (err) {
        console.warn('[Pipeline] WASM initialization failed:', err);
        this.telemetry.recordJobError('init', {
          code: 'WASM_INIT_FAILED',
          message: String(err),
          retryable: false,
        });
      }
    }
  }

  // ============================================================================
  // MAIN EXECUTE METHOD
  // ============================================================================

  async execute(
    request: AnalyticsRequest,
    dataset: Dataset
  ): Promise<AnalyticsResponse> {
    const jobId = `${request.requestId}-${Date.now()}`;
    const startTime = performance.now();

    // Validate request
    const validation = validateAnalyticsRequest(request);
    if (!validation.success) {
      return this.createErrorResponse(
        request.requestId,
        {
          code: 'INVALID_REQUEST',
          message: `Validation failed: ${validation.error.message}`,
          retryable: false,
        },
        'main-js'
      );
    }

    // Check cache
    if (this.config.cacheEnabled) {
      const cacheKey = this.cache.generateKey(
        request.datasetId,
        request.datasetVersion,
        request.filters,
        request.aggregations,
        request.requestedMetrics
      );

      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.telemetry.recordJobComplete(
          jobId,
          performance.now() - startTime,
          cached.metadata.rowsProcessed,
          true, // cache hit
          cached.metadata.wasmUsed
        );
        return cached;
      }
    }

    // Determine pipeline mode
    const mode = this.determinePipelineMode(request, dataset);

    // Record job start
    this.telemetry.recordJobStart(jobId, request.requestId, mode);

    let response: AnalyticsResponse;

    try {
      // Execute with fallback chain
      response = await this.executeWithFallback(request, dataset, mode);
    } catch (err) {
      // All fallbacks failed
      const error: PipelineError = {
        code: 'COMPUTATION_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
        retryable: false,
      };

      this.telemetry.recordJobError(jobId, error);
      response = this.createErrorResponse(request.requestId, error, 'main-js');
    }

    // Cache successful response
    if (response.success && this.config.cacheEnabled) {
      const cacheKey = this.cache.generateKey(
        request.datasetId,
        request.datasetVersion,
        request.filters,
        request.aggregations,
        request.requestedMetrics
      );
      this.cache.set(cacheKey, response);
    }

    // Record completion
    this.telemetry.recordJobComplete(
      jobId,
      performance.now() - startTime,
      response.metadata.rowsProcessed,
      false, // cache miss
      response.metadata.wasmUsed,
      undefined,
      response.metadata.memoryEstimateMB
    );

    return response;
  }

  // ============================================================================
  // PIPELINE MODE SELECTION
  // ============================================================================

  private determinePipelineMode(
    request: AnalyticsRequest,
    dataset: Dataset
  ): PipelineMode {
    // Force mode override
    if (this.flags.forceMode) {
      return this.flags.forceMode;
    }

    // Check if we can use WASM
    if (
      this.flags.enableWasmAggregation &&
      this.wasmAdapter?.isReady() &&
      this.canUseWasmForRequest(request)
    ) {
      return 'wasm';
    }

    // Check if we can use workers
    if (
      this.flags.enableWorkerPipeline &&
      this.workerPool?.isReady() &&
      dataset.points.length > 1000 // Only use workers for larger datasets
    ) {
      return 'worker-js';
    }

    // Fall back to main thread
    return 'main-js';
  }

  private canUseWasmForRequest(request: AnalyticsRequest): boolean {
    // WASM can only handle certain aggregation functions
    const supportedFunctions = ['sum', 'mean', 'min', 'max', 'std', 'median'];

    return request.aggregations.every((agg) =>
      supportedFunctions.includes(agg.function)
    );
  }

  // ============================================================================
  // EXECUTION WITH FALLBACK
  // ============================================================================

  private async executeWithFallback(
    request: AnalyticsRequest,
    dataset: Dataset,
    preferredMode: PipelineMode
  ): Promise<AnalyticsResponse> {
    const modes = this.getFallbackChain(preferredMode);

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const isFallback = i > 0;

      try {
        let response: AnalyticsResponse;

        switch (mode) {
          case 'wasm':
            response = await this.executeWasm(request, dataset);
            break;
          case 'worker-js':
            response = await this.executeWorker(request, dataset);
            break;
          case 'main-js':
            response = await this.executeMainThread(request, dataset);
            break;
          default:
            throw new Error(`Unknown pipeline mode: ${mode}`);
        }

        // Record fallback if used
        if (isFallback) {
          this.telemetry.recordJobError(
            `${request.requestId}-fallback`,
            {
              code: mode === 'worker-js' ? 'WASM_EXECUTION_ERROR' : 'WORKER_EXECUTION_ERROR',
              message: `Fell back from ${modes[i - 1]} to ${mode}`,
              retryable: false,
            },
            modes[i - 1]
          );
        }

        return response;
      } catch (err) {
        // Log error and continue to next fallback
        console.warn(`[Pipeline] ${mode} execution failed:`, err);

        // If this is the last option, throw
        if (i === modes.length - 1) {
          throw err;
        }
      }
    }

    throw new Error('All pipeline modes failed');
  }

  private getFallbackChain(preferredMode: PipelineMode): PipelineMode[] {
    const chain: PipelineMode[] = [preferredMode];

    if (preferredMode === 'wasm') {
      chain.push('worker-js', 'main-js');
    } else if (preferredMode === 'worker-js') {
      chain.push('main-js');
    }

    return chain;
  }

  // ============================================================================
  // EXECUTION METHODS
  // ============================================================================

  private async executeWasm(
    request: AnalyticsRequest,
    dataset: Dataset
  ): Promise<AnalyticsResponse> {
    if (!this.wasmAdapter?.isReady()) {
      throw new Error('WASM not initialized');
    }

    const startTime = performance.now();
    const data = await this.wasmAdapter.computeAggregations(
      dataset.points,
      request.aggregations
    );

    return {
      requestId: request.requestId,
      success: true,
      data: {
        aggregates: data,
      },
      metadata: {
        durationMs: performance.now() - startTime,
        pipelineMode: 'wasm',
        cacheHit: false,
        rendererHint: this.getRendererHint(dataset.points.length),
        rowsProcessed: dataset.points.length,
        wasmUsed: true,
      },
    };
  }

  private async executeWorker(
    request: AnalyticsRequest,
    dataset: Dataset
  ): Promise<AnalyticsResponse> {
    if (!this.workerPool?.isReady()) {
      throw new Error('Worker pool not initialized');
    }

    const result = await this.workerPool.execute(request, dataset);

    // Validate response
    const validation = validateAnalyticsResponse(result);
    if (!validation.success) {
      throw new Error(`Worker returned invalid response: ${validation.error.message}`);
    }

    return result;
  }

  private async executeMainThread(
    request: AnalyticsRequest,
    dataset: Dataset
  ): Promise<AnalyticsResponse> {
    const startTime = performance.now();

    const data = computeAggregationsMainThread(
      dataset.points,
      request.filters,
      request.groupBy,
      request.aggregations
    );

    return {
      requestId: request.requestId,
      success: true,
      data,
      metadata: {
        durationMs: performance.now() - startTime,
        pipelineMode: 'main-js',
        cacheHit: false,
        rendererHint: this.getRendererHint(dataset.points.length),
        rowsProcessed: dataset.points.length,
        wasmUsed: false,
      },
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private createErrorResponse(
    requestId: string,
    error: PipelineError,
    mode: PipelineMode
  ): AnalyticsResponse {
    return {
      requestId,
      success: false,
      error,
      data: {},
      metadata: {
        durationMs: 0,
        pipelineMode: mode,
        cacheHit: false,
        rendererHint: 'svg',
        rowsProcessed: 0,
        wasmUsed: false,
      },
    };
  }

  private getRendererHint(pointCount: number): 'svg' | 'canvas' | 'webgl' {
    if (pointCount < 5000) return 'svg';
    if (pointCount < 50000) return 'canvas';
    return 'webgl';
  }

  // ============================================================================
  // FEATURE FLAGS
  // ============================================================================

  setFeatureFlags(flags: {
    enableWorkerPipeline?: boolean;
    enableWasmAggregation?: boolean;
    forceMode?: PipelineMode | null;
  }): void {
    this.flags = { ...this.flags, ...flags };
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  getStatus() {
    return {
      mode: this.determinePipelineMode(
        { requestedMetrics: [] } as unknown as AnalyticsRequest,
        { points: [] } as unknown as Dataset
      ),
      initialized: this.isClient,
      wasmReady: this.wasmAdapter?.isReady() ?? false,
      workerPoolReady: this.workerPool?.isReady() ?? false,
      activeJobs: this.workerPool?.getActiveCount() ?? 0,
      queueDepth: this.workerPool?.getQueueDepth() ?? 0,
    };
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  destroy(): void {
    this.workerPool?.destroy();
    this.wasmAdapter?.destroy();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalDispatcher: PipelineDispatcher | null = null;

export function getPipelineDispatcher(
  config?: Partial<PipelineConfig>
): PipelineDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new PipelineDispatcher(config);
  }
  return globalDispatcher;
}

export function resetPipelineDispatcher(): void {
  if (globalDispatcher) {
    globalDispatcher.destroy();
    globalDispatcher = null;
  }
}
