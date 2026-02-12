/**
 * React Hooks for Data Pipeline
 * useAnalyticsPipeline and usePipelineStatus hooks
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  AnalyticsRequest,
  AnalyticsResponse,
  Dataset,
  PipelineMode,
  PipelineStatus,
  PipelineTelemetry,
} from './types';
import { getPipelineDispatcher } from './dispatcher';
import { getPipelineTelemetry } from './telemetry';

// ============================================================================
// USE ANALYTICS PIPELINE HOOK
// ============================================================================

export interface UseAnalyticsPipelineOptions {
  autoExecute?: boolean;
  debounceMs?: number;
}

export interface UseAnalyticsPipelineResult {
  data: AnalyticsResponse | null;
  loading: boolean;
  error: Error | null;
  execute: (request: AnalyticsRequest, dataset: Dataset) => Promise<void>;
  cancel: () => void;
  refresh: () => void;
}

export function useAnalyticsPipeline(
  options: UseAnalyticsPipelineOptions = {}
): UseAnalyticsPipelineResult {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { autoExecute = true, debounceMs = 100 } = options;

  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const dispatcher = useMemo(() => getPipelineDispatcher(), []);
  const pendingRequest = useRef<{ request: AnalyticsRequest; dataset: Dataset } | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRequestId = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (currentRequestId.current) {
      // Cancel through dispatcher
      pendingRequest.current = null;
      currentRequestId.current = null;
    }
    setLoading(false);
  }, []);

  const execute = useCallback(
    async (request: AnalyticsRequest, dataset: Dataset) => {
      // Cancel previous debounce
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Store pending request
      pendingRequest.current = { request, dataset };
      currentRequestId.current = request.requestId;

      // Debounced execution
      debounceTimer.current = setTimeout(async () => {
        if (!pendingRequest.current) return;

        const { request, dataset } = pendingRequest.current;
        setLoading(true);
        setError(null);

        try {
          const response = await dispatcher.execute(request, dataset);

          // Only update if this is still the current request
          if (currentRequestId.current === request.requestId) {
            setData(response);
            setError(null);
          }
        } catch (err) {
          if (currentRequestId.current === request.requestId) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
          }
        } finally {
          if (currentRequestId.current === request.requestId) {
            setLoading(false);
          }
        }
      }, debounceMs);
    },
    [debounceMs, dispatcher]
  );

  const refresh = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _request: AnalyticsRequest = {
      requestId: `refresh-${Date.now()}`,
      datasetId: data?.requestId ?? '',
      datasetVersion: 'refresh',
      filters: { operator: 'and', clauses: [] },
      timeRange: { start: 0, end: Date.now() },
      aggregations: [],
      requestedMetrics: [],
    };
  }, [data]);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return {
    data,
    loading,
    error,
    execute,
    cancel,
    refresh,
  };
}

// ============================================================================
// USE PIPELINE STATUS HOOK
// ============================================================================

export interface TelemetryData {
  recentJobs: PipelineTelemetry[];
  stats: {
    cacheHitRate: number;
    recentAverageDuration: number;
    totalEvents: number;
    jobsCompleted: number;
    jobsFailed: number;
    jobsCancelled: number;
    averageDuration: number;
    cacheHits: number;
    cacheMisses: number;
    wasmFallbacks: number;
    workerFallbacks: number;
  };
}

export interface UsePipelineStatusResult {
  status: PipelineStatus;
  telemetry: TelemetryData;
}

export function usePipelineStatus(): UsePipelineStatusResult {
  const [status, setStatus] = useState<PipelineStatus>({
    mode: 'main-js',
    initialized: false,
    wasmReady: false,
    workerPoolReady: false,
    activeJobs: 0,
    queueDepth: 0,
    totalJobsCompleted: 0,
    cacheHitRate: 0,
  });

  const dispatcher = useMemo(() => getPipelineDispatcher(), []);
  const telemetry = useMemo(() => getPipelineTelemetry(), []);

  useEffect(() => {
    const updateStatus = () => {
      setStatus((prev) => ({ ...prev, ...dispatcher.getStatus() }));
    };

    const unsubscribe = telemetry.subscribe(updateStatus);
    const interval = setInterval(updateStatus, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [dispatcher, telemetry]);

  const telemetryData = useMemo(
    () => ({
      recentJobs: telemetry.getRecentEvents(10),
      stats: telemetry.getStats(),
    }),
    [telemetry]
  );

  return {
    status,
    telemetry: telemetryData,
  };
}

// ============================================================================
// USE PIPELINE INSPECTOR DATA HOOK
// ============================================================================

export interface PipelineInspectorData {
  mode: PipelineMode;
  wasmReady: boolean;
  workerPoolReady: boolean;
  activeJobs: number;
  queueDepth: number;
  lastJobDuration?: number;
  totalJobsCompleted: number;
  cacheHitRate: number;
  recentJobs: PipelineTelemetry[];
  featureFlags: {
    enableWorkerPipeline: boolean;
    enableWasmAggregation: boolean;
  };
}

export function usePipelineInspectorData(): PipelineInspectorData {
  const { status, telemetry } = usePipelineStatus();

  const [featureFlags, setFeatureFlags] = useState({
    enableWorkerPipeline: true,
    enableWasmAggregation: true,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setFeatureFlags({
        enableWorkerPipeline: status.workerPoolReady,
        enableWasmAggregation: status.wasmReady,
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  return {
    mode: status.mode,
    wasmReady: status.wasmReady,
    workerPoolReady: status.workerPoolReady,
    activeJobs: status.activeJobs,
    queueDepth: status.queueDepth,
    lastJobDuration: telemetry.recentJobs[0]?.durationMs,
    totalJobsCompleted: status.totalJobsCompleted,
    cacheHitRate: telemetry.stats.cacheHitRate,
    recentJobs: telemetry.recentJobs,
    featureFlags,
  };
}
