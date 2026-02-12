/**
 * Pipeline Telemetry
 * Metrics collection for performance monitoring
 */

import type {
  PipelineTelemetry,
  WorkerPoolTelemetry,
  CacheTelemetry,
  PipelineError,
  PipelineMode,
} from './types';

// ============================================================================
// TELEMETRY CONFIGURATION
// ============================================================================

export interface TelemetryConfig {
  enabled: boolean;
  maxEvents: number;
  sendToConsole: boolean;
  sendToAnalytics: boolean;
  performanceThresholds: {
    maxDurationMs: number;
    maxQueueWaitMs: number;
    maxMemoryMB: number;
  };
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  maxEvents: 100,
  sendToConsole: process.env.NODE_ENV === 'development',
  sendToAnalytics: false,
  performanceThresholds: {
    maxDurationMs: 1000,
    maxQueueWaitMs: 100,
    maxMemoryMB: 100,
  },
};

// ============================================================================
// TELEMETRY COLLECTOR
// ============================================================================

export class PipelineTelemetryCollector {
  private config: TelemetryConfig;
  private events: PipelineTelemetry[] = [];
  private listeners: Set<(event: PipelineTelemetry) => void> = new Set();

  // Stats tracking
  private stats = {
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsCancelled: 0,
    averageDuration: 0,
    cacheHits: 0,
    cacheMisses: 0,
    wasmFallbacks: 0,
    workerFallbacks: 0,
  };

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
  }

  // ============================================================================
  // EVENT RECORDING
  // ============================================================================

  recordJobStart(
    jobId: string,
    requestId: string,
    pipelineMode: PipelineMode,
    queueWaitMs: number = 0
  ): void {
    const event: PipelineTelemetry = {
      jobId,
      requestId,
      pipelineMode,
      startTime: Date.now(),
      cacheHit: false,
      wasmUsed: pipelineMode === 'wasm',
      rowsProcessed: 0,
      queueWaitMs,
    };

    this.events.push(event);
    this.trimEvents();

    if (this.config.sendToConsole) {
      console.log(`[Pipeline] Job ${jobId} started (${pipelineMode})`);
    }
  }

  recordJobComplete(
    jobId: string,
    durationMs: number,
    rowsProcessed: number,
    cacheHit: boolean,
    wasmUsed: boolean,
    workerTimeMs?: number,
    memoryEstimateMB?: number
  ): void {
    const event = this.findEvent(jobId);
    if (!event) return;

    event.endTime = Date.now();
    event.durationMs = durationMs;
    event.rowsProcessed = rowsProcessed;
    event.cacheHit = cacheHit;
    event.wasmUsed = wasmUsed;
    event.workerTimeMs = workerTimeMs;
    event.memoryEstimateMB = memoryEstimateMB;

    this.stats.jobsCompleted++;
    this.updateAverageDuration(durationMs);

    if (cacheHit) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }

    this.checkPerformanceThresholds(event);
    this.notifyListeners(event);

    if (this.config.sendToConsole) {
      console.log(
        `[Pipeline] Job ${jobId} completed in ${durationMs}ms (${rowsProcessed} rows)`
      );
    }
  }

  recordJobError(jobId: string, error: PipelineError, fallbackFrom?: PipelineMode): void {
    const event = this.findEvent(jobId);
    if (!event) return;

    event.endTime = Date.now();
    event.error = error;
    event.fallbackFrom = fallbackFrom;

    this.stats.jobsFailed++;

    if (fallbackFrom === 'wasm') {
      this.stats.wasmFallbacks++;
    } else if (fallbackFrom === 'worker-js') {
      this.stats.workerFallbacks++;
    }

    this.notifyListeners(event);

    if (this.config.sendToConsole) {
      console.error(
        `[Pipeline] Job ${jobId} failed: ${error.code} - ${error.message}`
      );
    }
  }

  recordJobCancel(jobId: string): void {
    const event = this.findEvent(jobId);
    if (!event) return;

    event.endTime = Date.now();
    this.stats.jobsCancelled++;

    if (this.config.sendToConsole) {
      console.log(`[Pipeline] Job ${jobId} cancelled`);
    }
  }

  // ============================================================================
  // STATS GETTERS
  // ============================================================================

  getRecentEvents(count: number = 10): PipelineTelemetry[] {
    return this.events.slice(-count);
  }

  getStats() {
    const totalCache = this.stats.cacheHits + this.stats.cacheMisses;
    const recentEvents = this.getRecentEvents(50);
    const recentDurations = recentEvents
      .filter((e) => e.durationMs)
      .map((e) => e.durationMs!);

    return {
      ...this.stats,
      cacheHitRate: totalCache > 0 ? this.stats.cacheHits / totalCache : 0,
      recentAverageDuration:
        recentDurations.length > 0
          ? recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length
          : 0,
      totalEvents: this.events.length,
    };
  }

  // ============================================================================
  // POOL TELEMETRY
  // ============================================================================

  getPoolTelemetry(
    poolSize: number,
    activeWorkers: number,
    queueDepth: number,
    averageWaitTimeMs: number,
    averageJobDurationMs: number
  ): WorkerPoolTelemetry {
    return {
      poolSize,
      activeWorkers,
      queueDepth,
      jobsCompleted: this.stats.jobsCompleted,
      jobsCancelled: this.stats.jobsCancelled,
      averageWaitTimeMs,
      averageJobDurationMs,
    };
  }

  // ============================================================================
  // CACHE TELEMETRY
  // ============================================================================

  getCacheTelemetry(
    hits: number,
    misses: number,
    evictions: number,
    size: number,
    averageEntrySizeBytes: number
  ): CacheTelemetry {
    const total = hits + misses;
    return {
      hits,
      misses,
      evictions,
      size,
      hitRate: total > 0 ? hits / total : 0,
      averageEntrySizeBytes,
    };
  }

  // ============================================================================
  // SUBSCRIPTION
  // ============================================================================

  subscribe(callback: (event: PipelineTelemetry) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(event: PipelineTelemetry): void {
    this.listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (err) {
        console.error('Telemetry listener error:', err);
      }
    });
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private findEvent(jobId: string): PipelineTelemetry | undefined {
    return this.events.find((e) => e.jobId === jobId);
  }

  private trimEvents(): void {
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }
  }

  private updateAverageDuration(newDuration: number): void {
    const alpha = 0.1; // Exponential moving average
    this.stats.averageDuration =
      alpha * newDuration + (1 - alpha) * this.stats.averageDuration;
  }

  private checkPerformanceThresholds(event: PipelineTelemetry): void {
    const { performanceThresholds } = this.config;

    if (event.durationMs && event.durationMs > performanceThresholds.maxDurationMs) {
      console.warn(
        `[Pipeline] Job ${event.jobId} exceeded duration threshold: ${event.durationMs}ms > ${performanceThresholds.maxDurationMs}ms`
      );
    }

    if (
      event.queueWaitMs &&
      event.queueWaitMs > performanceThresholds.maxQueueWaitMs
    ) {
      console.warn(
        `[Pipeline] Job ${event.jobId} exceeded queue wait threshold: ${event.queueWaitMs}ms > ${performanceThresholds.maxQueueWaitMs}ms`
      );
    }

    if (
      event.memoryEstimateMB &&
      event.memoryEstimateMB > performanceThresholds.maxMemoryMB
    ) {
      console.warn(
        `[Pipeline] Job ${event.jobId} exceeded memory threshold: ${event.memoryEstimateMB}MB > ${performanceThresholds.maxMemoryMB}MB`
      );
    }
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  destroy(): void {
    this.listeners.clear();
    this.events = [];
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalTelemetry: PipelineTelemetryCollector | null = null;

export function getPipelineTelemetry(
  config?: Partial<TelemetryConfig>
): PipelineTelemetryCollector {
  if (!globalTelemetry) {
    globalTelemetry = new PipelineTelemetryCollector(config);
  }
  return globalTelemetry;
}

export function resetPipelineTelemetry(): void {
  if (globalTelemetry) {
    globalTelemetry.destroy();
    globalTelemetry = null;
  }
}
