# WASM Aggregation Strategy

## Overview

WASM (WebAssembly) provides near-native performance for compute-heavy aggregations, offloading intensive calculations from JavaScript while maintaining numerical consistency.

## When to Use WASM

**Recommended For:**
- Datasets > 10,000 points
- Numeric array operations (sum, mean, min, max)
- Statistical calculations (std, variance, median, quantiles)
- Histogram binning
- Real-time data streams

**Not Needed For:**
- Small datasets (< 1,000 points)
- Simple filters
- String operations
- One-off calculations

## Supported Operations

| Function | WASM | JS Fallback | Tolerance |
|----------|------|-------------|-----------|
| sum | ✓ | ✓ | 1e-10 |
| mean | ✓ | ✓ | 1e-10 |
| min | ✓ | ✓ | 0 |
| max | ✓ | ✓ | 0 |
| std | ✓ | ✓ | 1e-9 |
| variance | ✓ | ✓ | 1e-9 |
| median | ✓ | ✓ | 1e-10 |
| percentile | ✓ | ✓ | 1e-9 |

## Fallback Behavior

```
WASM Requested
      ↓
WASM Available? ──No──→ Use JS Fallback
      ↓ Yes
Compile Module
      ↓
Instantiate Success? ──No──→ Use JS Fallback
      ↓ Yes
Execute WASM
      ↓
Result Valid? ──No──→ Use JS Fallback
      ↓ Yes
Return WASM Result
```

## Numerical Parity

### Tolerance Policy

| Metric | Tolerance | Test |
|--------|-----------|------|
| Integers (count, min, max) | Exact | === |
| Floats (sum, mean) | 1e-10 relative | abs(a-b)/max(abs(a),abs(b)) < 1e-10 |
| Statistical (std, variance) | 1e-9 relative | abs(a-b)/max(abs(a),abs(b)) < 1e-9 |

### Testing Parity

```typescript
// Unit test example
const wasmResult = wasmAdapter.sum(values);
const jsResult = jsFallback.sum(values);

const relativeDiff = Math.abs(wasmResult - jsResult) / 
  Math.max(Math.abs(wasmResult), Math.abs(jsResult));

expect(relativeDiff).toBeLessThan(1e-10);
```

## Memory Management

### WASM Memory Layout
```
┌─────────────────────────────────────┐
│         WASM Memory (64KB pages)     │
├─────────────────────────────────────┤
│  Stack    │  Heap    │  Data Buffer │
│  (fixed)  │  (grows) │  (transfers) │
└─────────────────────────────────────┘
```

### Configuration
```typescript
const adapter = new WasmAggregationAdapter({
  wasmPath: '/wasm/aggregations.wasm',
  memoryInitialMB: 16,  // 256 pages
  memoryMaxMB: 128,       // 2048 pages
});
```

### Data Transfer
```typescript
// Copy JS array to WASM memory
const ptr = adapter.copyToMemory(float64Array);

// Execute
const result = adapter.exports.sum_f64(ptr, length);

// Cleanup
adapter.freeMemory(ptr);
```

## Performance

### Benchmarks (Chrome 120, M1 Mac)

| Operation | 1K points | 10K points | 100K points | 1M points |
|-----------|-----------|------------|-------------|-----------|
| JS Sum | 0.05ms | 0.3ms | 2.5ms | 25ms |
| WASM Sum | 0.02ms | 0.1ms | 0.8ms | 8ms |
| Speedup | 2.5x | 3x | 3.1x | 3.1x |

### Startup Overhead
- WASM compilation: ~10-50ms (one-time)
- Module instantiation: ~5ms
- First call overhead: ~2ms

## Error Handling

### Initialization Errors
```typescript
try {
  await adapter.initialize();
} catch (err) {
  console.warn('WASM init failed, using JS fallback:', err);
  // Automatically falls back to JS
}
```

### Runtime Errors
```typescript
try {
  return adapter.compute(values);
} catch (err) {
  telemetry.record({
    code: 'WASM_EXECUTION_ERROR',
    message: err.message,
    fallback: 'js'
  });
  return jsFallback.compute(values);
}
```

## Browser Support

| Browser | WASM | SIMD | Threads |
|---------|------|------|---------|
| Chrome | ✓ | ✓ | ✓ |
| Firefox | ✓ | ✓ | ✓ |
| Safari | ✓ | ✓ | ✗ |
| Edge | ✓ | ✓ | ✓ |

## Best Practices

1. **Lazy Loading:**
   ```typescript
   // Load WASM only when needed
   const adapter = new WasmAggregationAdapter();
   // ... later when data arrives ...
   await adapter.initialize();
   ```

2. **Memory Reuse:**
   ```typescript
   // Reuse buffer for multiple operations
   const buffer = adapter.allocate(10000);
   for (const batch of batches) {
     adapter.copyToBuffer(buffer, batch);
     results.push(adapter.sum(buffer, batch.length));
   }
   adapter.free(buffer);
   ```

3. **Chunk Large Arrays:**
   ```typescript
   const CHUNK_SIZE = 100000;
   for (let i = 0; i < values.length; i += CHUNK_SIZE) {
     const chunk = values.slice(i, i + CHUNK_SIZE);
     partialSums.push(adapter.sum(chunk));
   }
   return adapter.sum(partialSums);
   ```

## Known Limitations

1. **No DOM Access:** WASM cannot manipulate DOM directly
2. **Memory Limits:** 2GB max in 32-bit WASM
3. **No Exceptions:** Use error codes and return values
4. **Transfer Overhead:** Copying data to/from WASM

## Security

- WASM runs in same-origin sandbox
- No eval or dynamic code execution
- Memory is isolated from JS heap
- CSP: `script-src 'self' 'wasm-unsafe-eval'`

## Debugging

### Chrome DevTools
1. Sources panel → wasm file
2. Set breakpoints in WASM
3. View memory layout
4. Profile performance

### Logging
```typescript
adapter.debug = true; // Enable verbose logging
const result = adapter.sum(values);
// Logs: "WASM sum: ptr=1234, len=10000, result=123456"
```
