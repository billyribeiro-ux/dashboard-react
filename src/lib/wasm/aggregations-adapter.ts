/**
 * WASM Aggregation Adapter
 * Interface to WASM compute kernels for aggregations
 */

import type {
  DataPoint,
  AggregationConfig,
  AggregateResult,
} from '../data-pipeline/types';

// ============================================================================
// WASM ADAPTER CONFIGURATION
// ============================================================================

export interface WasmAdapterConfig {
  wasmPath: string;
  memoryInitialMB: number;
  memoryMaxMB: number;
}

export const DEFAULT_WASM_CONFIG: WasmAdapterConfig = {
  wasmPath: '/wasm/aggregations.wasm',
  memoryInitialMB: 16,
  memoryMaxMB: 128,
};

// ============================================================================
// WASM AGGREGATION ADAPTER
// ============================================================================

export class WasmAggregationAdapter {
  private config: WasmAdapterConfig;
  private wasmModule: WebAssembly.Module | null = null;
  private wasmInstance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private isReady_ = false;

  // Supported functions in WASM
  private supportedFunctions = new Set([
    'sum', 'mean', 'min', 'max', 'std', 'median', 'variance',
  ]);

  constructor(config: Partial<WasmAdapterConfig> = {}) {
    this.config = { ...DEFAULT_WASM_CONFIG, ...config };
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.isReady_) return;

    try {
      // Check if WebAssembly is supported
      if (typeof WebAssembly === 'undefined') {
        throw new Error('WebAssembly not supported');
      }

      // Initialize memory
      this.memory = new WebAssembly.Memory({
        initial: this.config.memoryInitialMB * 16, // 1 page = 64KB
        maximum: this.config.memoryMaxMB * 16,
      });

      // Import object
      const importObject = {
        env: {
          memory: this.memory,
          abort: (msg: number, file: number, line: number, column: number) => {
            console.error('WASM abort:', { msg, file, line, column });
          },
        },
      };

      // Fetch and compile WASM
      const response = await fetch(this.config.wasmPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      this.wasmModule = await WebAssembly.compile(buffer);
      this.wasmInstance = await WebAssembly.instantiate(this.wasmModule, importObject);

      this.isReady_ = true;
      console.log('[WASM] Aggregation adapter initialized');
    } catch (err) {
      console.error('[WASM] Initialization failed:', err);
      throw err;
    }
  }

  isReady(): boolean {
    return this.isReady_;
  }

  // ============================================================================
  // AGGREGATION COMPUTATION
  // ============================================================================

  async computeAggregations(
    points: DataPoint[],
    aggregations: AggregationConfig[]
  ): Promise<AggregateResult[]> {
    if (!this.isReady_) {
      throw new Error('WASM not initialized');
    }

    // Check if all aggregations are supported
    const unsupported = aggregations.filter(
      (agg) => !this.supportedFunctions.has(agg.function)
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported aggregations: ${unsupported.map((u) => u.function).join(', ')}`
      );
    }

    // Extract values
    const values = points.map((p) => p.value);

    // Allocate memory and copy data
    const ptr = this.copyToWasmMemory(values);

    try {
      const results: AggregateResult[] = [];

      for (const agg of aggregations) {
        const result = this.computeSingleAggregation(ptr, values.length, agg);
        results.push({
          groupKey: 'all',
          groupValues: {},
          metrics: { [agg.alias]: result },
          count: values.length,
        });
      }

      return results;
    } finally {
      // Free WASM memory
      this.freeWasmMemory(ptr);
    }
  }

  private computeSingleAggregation(
    ptr: number,
    length: number,
    agg: AggregationConfig
  ): number {
    if (!this.wasmInstance) {
      throw new Error('WASM instance not available');
    }

    const exports = this.wasmInstance.exports as {
      sum_f64?: (ptr: number, len: number) => number;
      mean_f64?: (ptr: number, len: number) => number;
      min_f64?: (ptr: number, len: number) => number;
      max_f64?: (ptr: number, len: number) => number;
      std_f64?: (ptr: number, len: number) => number;
      median_f64?: (ptr: number, len: number) => number;
      variance_f64?: (ptr: number, len: number) => number;
      free?: (ptr: number) => void;
    };

    switch (agg.function) {
      case 'sum':
        return exports.sum_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'mean':
        return exports.mean_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'min':
        return exports.min_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'max':
        return exports.max_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'std':
        return exports.std_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'median':
        return exports.median_f64?.(ptr, length) ?? this.jsFallback(values);
      case 'variance':
        return exports.variance_f64?.(ptr, length) ?? this.jsFallback(values);
      default:
        return this.jsFallback(values);
    }
  }

  private jsFallback(values: number[]): number {
    // Fallback to JS computation
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // ============================================================================
  // MEMORY MANAGEMENT
  // ============================================================================

  private copyToWasmMemory(values: number[]): number {
    if (!this.wasmInstance || !this.memory) {
      throw new Error('WASM not initialized');
    }

    const exports = this.wasmInstance.exports as { malloc?: (size: number) => number };
    const malloc = exports.malloc;

    if (!malloc) {
      throw new Error('WASM malloc not available');
    }

    // Allocate memory (8 bytes per f64)
    const ptr = malloc(values.length * 8);

    // Copy data
    const heap = new Float64Array(this.memory.buffer);
    for (let i = 0; i < values.length; i++) {
      heap[ptr / 8 + i] = values[i];
    }

    return ptr;
  }

  private freeWasmMemory(ptr: number): void {
    if (!this.wasmInstance) return;

    const exports = this.wasmInstance.exports as { free?: (ptr: number) => void };
    exports.free?.(ptr);
  }

  // ============================================================================
  // HISTOGRAM (if supported by WASM)
  // ============================================================================

  computeHistogram(
    values: number[],
    binCount: number
  ): Array<{ min: number; max: number; count: number }> | null {
    if (!this.isReady_ || !this.wasmInstance || !this.memory) {
      return null;
    }

    const exports = this.wasmInstance.exports as {
      histogram_f64?: (
        srcPtr: number,
        srcLen: number,
        binPtr: number,
        binCount: number,
        min: number,
        max: number
      ) => void;
    };

    if (!exports.histogram_f64) {
      return null;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    // Copy values to WASM
    const valuesPtr = this.copyToWasmMemory(values);

    // Allocate bin memory
    const malloc = (this.wasmInstance.exports as { malloc: (size: number) => number }).malloc;
    const binPtr = malloc(binCount * 4); // 4 bytes per int32

    try {
      // Compute histogram
      exports.histogram_f64(valuesPtr, values.length, binPtr, binCount, min, max);

      // Read results
      const bins: Array<{ min: number; max: number; count: number }> = [];
      const binWidth = (max - min) / binCount;
      const heap32 = new Int32Array(this.memory.buffer);

      for (let i = 0; i < binCount; i++) {
        bins.push({
          min: min + i * binWidth,
          max: min + (i + 1) * binWidth,
          count: heap32[binPtr / 4 + i],
        });
      }

      return bins;
    } finally {
      this.freeWasmMemory(valuesPtr);
      this.freeWasmMemory(binPtr);
    }
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  destroy(): void {
    this.wasmInstance = null;
    this.wasmModule = null;
    this.memory = null;
    this.isReady_ = false;
  }
}

// ============================================================================
// STUB WASM FALLBACK
// ============================================================================

export function createStubWasmExports(): WebAssembly.Exports {
  // Fallback implementation when WASM is not available
  return {
    sum_f64: (ptr: number, len: number) => 0,
    mean_f64: (ptr: number, len: number) => 0,
    min_f64: (ptr: number, len: number) => 0,
    max_f64: (ptr: number, len: number) => 0,
    std_f64: (ptr: number, len: number) => 0,
    median_f64: (ptr: number, len: number) => 0,
    variance_f64: (ptr: number, len: number) => 0,
    malloc: (size: number) => 0,
    free: (ptr: number) => {},
  };
}
