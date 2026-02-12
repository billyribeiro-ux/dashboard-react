/**
 * Worker Pool
 * Manages a pool of web workers with job queue and cancellation
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

// ============================================================================
// WORKER POOL CONFIGURATION
// ============================================================================

export interface WorkerPoolConfig {
  poolSize: number;
  jobTimeoutMs: number;
  scriptPath: string;
}

export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  poolSize: 2,
  jobTimeoutMs: 30000, // 30 seconds
  scriptPath: '/workers/analytics.worker.js',
};

// ============================================================================
// JOB DEFINITION
// ============================================================================

interface Job {
  id: string;
  request: AnalyticsRequest;
  dataset: Dataset;
  useWasm: boolean;
  resolve: (response: AnalyticsResponse) => void;
  reject: (error: Error) => void;
  startTime: number;
  cancelled: boolean;
}

// ============================================================================
// WORKER WRAPPER
// ============================================================================

class WorkerWrapper {
  worker: Worker;
  busy = false;
  currentJobId: string | null = null;

  constructor(scriptPath: string) {
    this.worker = new Worker(scriptPath);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

// ============================================================================
// WORKER POOL
// ============================================================================

export class WorkerPool {
  private config: WorkerPoolConfig;
  private workers: WorkerWrapper[] = [];
  private queue: Job[] = [];
  private isInitialized = false;

  // Stats
  private stats = {
    jobsCompleted: 0,
    jobsCancelled: 0,
    totalWaitTime: 0,
    totalJobTime: 0,
  };

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Check if workers are supported
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers not supported in this environment');
    }

    // Create worker pool
    for (let i = 0; i < this.config.poolSize; i++) {
      const worker = new WorkerWrapper(this.config.scriptPath);

      worker.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        this.handleMessage(worker, event.data);
      };

      worker.worker.onerror = (error) => {
        this.handleWorkerError(worker, error);
      };

      this.workers.push(worker);
    }

    this.isInitialized = true;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  // ============================================================================
  // JOB EXECUTION
  // ============================================================================

  execute(
    request: AnalyticsRequest,
    dataset: Dataset,
    useWasm: boolean = false
  ): Promise<AnalyticsResponse> {
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: `${request.requestId}-${Date.now()}`,
        request,
        dataset,
        useWasm,
        resolve,
        reject,
        startTime: performance.now(),
        cancelled: false,
      };

      this.queue.push(job);
      this.processQueue();
    });
  }

  cancel(jobId: string): boolean {
    // Check queue
    const queueIndex = this.queue.findIndex((job) => job.id === jobId);
    if (queueIndex !== -1) {
      const job = this.queue[queueIndex];
      job.cancelled = true;
      this.queue.splice(queueIndex, 1);

      // Reject with cancellation error
      const error: PipelineError = {
        code: 'CANCELLED',
        message: 'Job was cancelled',
        retryable: true,
      };

      job.reject(new Error(error.message));
      this.stats.jobsCancelled++;
      return true;
    }

    // Check active workers
    for (const worker of this.workers) {
      if (worker.currentJobId === jobId) {
        // Send cancel message to worker
        const cancelMessage: WorkerMessage = {
          type: 'CANCEL',
          jobId,
          timestamp: Date.now(),
        };
        worker.worker.postMessage(cancelMessage);
        return true;
      }
    }

    return false;
  }

  // Cancel all jobs matching a request ID pattern
  cancelAll(requestIdPattern: string): number {
    let cancelled = 0;

    // Cancel queued jobs
    const toRemove = this.queue.filter((job) =>
      job.request.requestId.startsWith(requestIdPattern)
    );

    for (const job of toRemove) {
      job.cancelled = true;
      const index = this.queue.indexOf(job);
      if (index > -1) {
        this.queue.splice(index, 1);
      }

      const error: PipelineError = {
        code: 'CANCELLED',
        message: 'Job was cancelled by newer request',
        retryable: true,
      };

      job.reject(new Error(error.message));
      cancelled++;
    }

    this.stats.jobsCancelled += cancelled;
    return cancelled;
  }

  // ============================================================================
  // QUEUE PROCESSING
  // ============================================================================

  private processQueue(): void {
    // Find available worker
    const availableWorker = this.workers.find((w) => !w.busy);
    if (!availableWorker) return; // All workers busy

    // Get next job
    const job = this.queue.shift();
    if (!job) return; // No jobs in queue

    if (job.cancelled) {
      // Skip cancelled jobs
      this.processQueue();
      return;
    }

    // Assign job to worker
    availableWorker.busy = true;
    availableWorker.currentJobId = job.id;

    // Calculate queue wait time
    const queueWaitMs = performance.now() - job.startTime;
    this.stats.totalWaitTime += queueWaitMs;

    // Send job to worker
    const message: WorkerExecuteMessage = {
      type: 'EXECUTE',
      jobId: job.id,
      timestamp: Date.now(),
      payload: {
        request: job.request,
        dataset: job.dataset,
        useWasm: job.useWasm,
      },
    };

    // Use Transferable for large datasets
    const datasetBuffer = this.serializeDataset(job.dataset);
    availableWorker.worker.postMessage(message, [datasetBuffer]);

    // Set timeout
    const timeoutId = setTimeout(() => {
      this.handleJobTimeout(availableWorker, job);
    }, this.config.jobTimeoutMs);

    // Store timeout for cleanup
    (job as unknown as { timeoutId: ReturnType<typeof setTimeout> }).timeoutId = timeoutId;
  }

  private serializeDataset(dataset: Dataset): ArrayBuffer {
    // Serialize dataset to ArrayBuffer for transfer
    const json = JSON.stringify(dataset);
    const encoder = new TextEncoder();
    const buffer = encoder.encode(json);
    return buffer.buffer;
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  private handleMessage(worker: WorkerWrapper, message: WorkerMessage): void {
    switch (message.type) {
      case 'RESULT':
        this.handleResult(worker, message as WorkerResultMessage);
        break;
      case 'ERROR':
        this.handleError(worker, message as WorkerErrorMessage);
        break;
      case 'PROGRESS':
        // Progress updates can be handled here if needed
        break;
    }
  }

  private handleResult(worker: WorkerWrapper, message: WorkerResultMessage): void {
    const jobId = message.jobId;
    const job = this.findJob(jobId);

    if (!job || job.cancelled) {
      this.cleanupWorker(worker);
      return;
    }

    // Clear timeout
    const timeoutId = (job as unknown as { timeoutId: number }).timeoutId;
    if (timeoutId) clearTimeout(timeoutId);

    // Update stats
    const jobTime = performance.now() - job.startTime;
    this.stats.totalJobTime += jobTime;
    this.stats.jobsCompleted++;

    // Resolve with result
    job.resolve(message.payload);

    // Cleanup and process next
    this.cleanupWorker(worker);
    this.processQueue();
  }

  private handleError(worker: WorkerWrapper, message: WorkerErrorMessage): void {
    const jobId = message.jobId;
    const job = this.findJob(jobId);

    if (!job || job.cancelled) {
      this.cleanupWorker(worker);
      return;
    }

    // Clear timeout
    const timeoutId = (job as unknown as { timeoutId: number }).timeoutId;
    if (timeoutId) clearTimeout(timeoutId);

    // Reject with error
    const error = new Error(
      `${message.payload.code}: ${message.payload.message}`
    );
    job.reject(error);

    // Cleanup and process next
    this.cleanupWorker(worker);
    this.processQueue();
  }

  private handleWorkerError(worker: WorkerWrapper, error: ErrorEvent): void {
    console.error('[WorkerPool] Worker error:', error);

    // Find job associated with this worker
    const jobId = worker.currentJobId;
    if (jobId) {
      const job = this.findJob(jobId);
      if (job && !job.cancelled) {
        const pipelineError: PipelineError = {
          code: 'WORKER_EXECUTION_ERROR',
          message: error.message || 'Worker execution failed',
          retryable: true,
        };
        job.reject(new Error(pipelineError.message));
      }
    }

    // Terminate and recreate worker
    worker.terminate();
    const newWorker = new WorkerWrapper(this.config.scriptPath);
    newWorker.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.handleMessage(newWorker, event.data);
    };
    newWorker.worker.onerror = (err) => {
      this.handleWorkerError(newWorker, err);
    };

    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers[index] = newWorker;
    }

    this.processQueue();
  }

  private handleJobTimeout(worker: WorkerWrapper, job: Job): void {
    console.warn(`[WorkerPool] Job ${job.id} timed out`);

    if (!job.cancelled) {
      const error: PipelineError = {
        code: 'TIMEOUT_EXCEEDED',
        message: `Job exceeded ${this.config.jobTimeoutMs}ms timeout`,
        retryable: true,
      };
      job.reject(new Error(error.message));
    }

    // Terminate worker (it's stuck)
    worker.terminate();

    // Recreate worker
    const newWorker = new WorkerWrapper(this.config.scriptPath);
    newWorker.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.handleMessage(newWorker, event.data);
    };
    newWorker.worker.onerror = (err) => {
      this.handleWorkerError(newWorker, err);
    };

    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers[index] = newWorker;
    }

    this.processQueue();
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private findJob(jobId: string): Job | undefined {
    // Check active jobs on workers
    for (const worker of this.workers) {
      if (worker.currentJobId === jobId) {
        // Job is being processed
        return { id: jobId } as Job; // Simplified - in real impl, track active jobs
      }
    }
    return undefined;
  }

  private cleanupWorker(worker: WorkerWrapper): void {
    worker.busy = false;
    worker.currentJobId = null;
  }

  // ============================================================================
  // STATS
  // ============================================================================

  getStats() {
    const totalJobs = this.stats.jobsCompleted + this.stats.jobsCancelled;
    return {
      ...this.stats,
      averageWaitTimeMs:
        this.stats.jobsCompleted > 0
          ? this.stats.totalWaitTime / this.stats.jobsCompleted
          : 0,
      averageJobTimeMs:
        this.stats.jobsCompleted > 0
          ? this.stats.totalJobTime / this.stats.jobsCompleted
          : 0,
      queueDepth: this.queue.length,
      activeJobs: this.workers.filter((w) => w.busy).length,
      totalJobs,
    };
  }

  getActiveCount(): number {
    return this.workers.filter((w) => w.busy).length;
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  destroy(): void {
    // Cancel all queued jobs
    for (const job of this.queue) {
      job.cancelled = true;
      const error: PipelineError = {
        code: 'WORKER_TERMINATED',
        message: 'Worker pool destroyed',
        retryable: false,
      };
      job.reject(new Error(error.message));
    }
    this.queue = [];

    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];

    this.isInitialized = false;
  }
}
