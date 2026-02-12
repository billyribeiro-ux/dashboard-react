/**
 * Analytics Web Worker
 * Executes data processing off the main thread
 */

import type {
  AnalyticsRequest,
  AnalyticsResponse,
  Dataset,
  WorkerMessage,
  WorkerExecuteMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
  PipelineError,
} from '../data-pipeline/types';
import {
  validateAnalyticsRequest,
  validateAnalyticsResponse,
} from '../data-pipeline/schema';
import { computeAggregationsMainThread } from '../data-pipeline/main-thread-fallback';

// ============================================================================
// WORKER STATE
// ============================================================================

let currentJobId: string | null = null;
let isCancelled = false;

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

self.onmessage = function (event: MessageEvent<WorkerMessage>) {
  const message = event.data;

  switch (message.type) {
    case 'EXECUTE':
      handleExecute(message as WorkerExecuteMessage);
      break;
    case 'CANCEL':
      handleCancel(message);
      break;
    case 'PING':
      handlePing(message);
      break;
    default:
      console.warn('[Worker] Unknown message type:', message.type);
  }
};

// ============================================================================
// EXECUTE HANDLER
// ============================================================================

async function handleExecute(message: WorkerExecuteMessage): Promise<void> {
  const { jobId, payload } = message;
  const { request, dataset, useWasm } = payload;

  // Set current job
  currentJobId = jobId;
  isCancelled = false;

  try {
    // Validate request
    const validation = validateAnalyticsRequest(request);
    if (!validation.success) {
      throw new Error(`Invalid request: ${validation.error.message}`);
    }

    // Check cancellation
    if (isCancelled) {
      sendError(jobId, {
        code: 'CANCELLED',
        message: 'Job was cancelled before execution',
        retryable: true,
      });
      return;
    }

    // Execute computation
    const startTime = performance.now();

    let data;
    if (useWasm) {
      // Try WASM first, fall back to JS
      try {
        data = await executeWithWasm(request, dataset);
      } catch (err) {
        console.warn('[Worker] WASM failed, falling back to JS:', err);
        data = executeWithJs(request, dataset);
      }
    } else {
      data = executeWithJs(request, dataset);
    }

    // Check cancellation again
    if (isCancelled) {
      sendError(jobId, {
        code: 'CANCELLED',
        message: 'Job was cancelled during execution',
        retryable: true,
      });
      return;
    }

    const durationMs = performance.now() - startTime;

    // Build response
    const response: AnalyticsResponse = {
      requestId: request.requestId,
      success: true,
      data,
      metadata: {
        durationMs,
        pipelineMode: useWasm ? 'wasm' : 'worker-js',
        cacheHit: false,
        rendererHint: getRendererHint(dataset.points.length),
        rowsProcessed: dataset.points.length,
        wasmUsed: useWasm,
      },
    };

    // Validate response
    const responseValidation = validateAnalyticsResponse(response);
    if (!responseValidation.success) {
      throw new Error(
        `Invalid response generated: ${responseValidation.error.message}`
      );
    }

    // Send result
    sendResult(jobId, response);
  } catch (err) {
    console.error('[Worker] Execution error:', err);

    const error: PipelineError = {
      code: 'COMPUTATION_ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
      retryable: true,
    };

    sendError(jobId, error);
  } finally {
    currentJobId = null;
    isCancelled = false;
  }
}

// ============================================================================
// COMPUTATION METHODS
// ============================================================================

function executeWithJs(request: AnalyticsRequest, dataset: Dataset) {
  return computeAggregationsMainThread(
    dataset.points,
    request.filters,
    request.groupBy,
    request.aggregations
  );
}

async function executeWithWasm(request: AnalyticsRequest, dataset: Dataset) {
  // WASM execution stub - would dynamically import WASM module
  // For now, fall back to JS
  console.log('[Worker] WASM execution requested but not implemented');
  return executeWithJs(request, dataset);
}

// ============================================================================
// CANCEL HANDLER
// ============================================================================

function handleCancel(message: WorkerMessage): void {
  if (message.jobId === currentJobId) {
    isCancelled = true;
    console.log('[Worker] Job cancelled:', message.jobId);
  }
}

// ============================================================================
// PING HANDLER
// ============================================================================

function handlePing(message: WorkerMessage): void {
  const response: WorkerMessage = {
    type: 'PING',
    jobId: message.jobId,
    timestamp: Date.now(),
  };
  self.postMessage(response);
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

function sendResult(jobId: string, payload: AnalyticsResponse): void {
  const message: WorkerResultMessage = {
    type: 'RESULT',
    jobId,
    timestamp: Date.now(),
    payload,
  };
  self.postMessage(message);
}

function sendError(jobId: string, error: PipelineError): void {
  const message: WorkerErrorMessage = {
    type: 'ERROR',
    jobId,
    timestamp: Date.now(),
    payload: error,
  };
  self.postMessage(message);
}

// ============================================================================
// UTILITIES
// ============================================================================

function getRendererHint(pointCount: number): 'svg' | 'canvas' | 'webgl' {
  if (pointCount < 5000) return 'svg';
  if (pointCount < 50000) return 'canvas';
  return 'webgl';
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

self.onerror = function (error) {
  console.error('[Worker] Uncaught error:', error);

  if (currentJobId) {
    sendError(currentJobId, {
      code: 'WORKER_EXECUTION_ERROR',
      message: error instanceof ErrorEvent ? error.message : 'Worker error',
      retryable: true,
    });
  }
};

// Signal ready
console.log('[Worker] Analytics worker initialized');
