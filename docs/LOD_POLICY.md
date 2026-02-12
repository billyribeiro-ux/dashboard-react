# LOD (Level of Detail) Policy

## Overview

The LOD (Level of Detail) system provides deterministic data reduction for large time-series datasets while preserving critical visual information. This prevents misleading visuals and ensures outliers are never discarded silently.

## Core Principles

1. **Never Hide Anomalies**: Outliers must be preserved regardless of compression level
2. **Min/Max Envelope**: Trend integrity requires preserving the full range of values
3. **Temporal Bucketing**: Group nearby points into representative buckets
4. **Zoom-Aware Refinement**: Increase detail when zooming in

## Downsampling Strategies

### 1. Temporal Bucketing

**Algorithm:**
```
Input: points[], targetBucketCount
Output: buckets[]

1. Calculate time range [t_min, t_max]
2. Determine bucket size: (t_max - t_min) / targetBucketCount
3. For each point:
   - Calculate bucket index: floor((t - t_min) / bucket_size)
   - Add point to bucket
4. For each bucket:
   - Calculate statistics: min, max, avg, count
   - Select representative point
   - Identify outliers within bucket
```

**Benefits:**
- O(n) time complexity
- Preserves time-series structure
- Allows trend reconstruction

### 2. Min/Max Envelope Preservation

**Purpose:** Ensure the visual "shape" of the data remains accurate even when compressed.

**Implementation:**
```typescript
interface LODBucket {
  startTime: number
  endTime: number
  min: number        // Minimum value in bucket
  max: number        // Maximum value in bucket
  avg: number        // Average value
  representative: DataPoint  // Point to render
}
```

**Selection Logic:**
- If outliers exist in bucket → use most extreme outlier
- If values near max → use max point
- If values near min → use min point
- Otherwise → use average point

### 3. Outlier Preservation

**Critical Requirement:** Outliers must never be silently discarded.

**Detection Methods:**

1. **Z-Score Method** (Default)
   ```
   outlier_threshold = 3 (standard deviations)
   z_score = |value - mean| / std_dev
   is_outlier = z_score > threshold
   ```

2. **IQR Method** (Interquartile Range)
   ```
   Q1 = 25th percentile
   Q3 = 75th percentile
   IQR = Q3 - Q1
   lower_bound = Q1 - 1.5 * IQR
   upper_bound = Q3 + 1.5 * IQR
   is_outlier = value < lower_bound OR value > upper_bound
   ```

3. **MAD Method** (Median Absolute Deviation)
   ```
   median = median(values)
   MAD = median(|value - median|)
   is_outlier = |value - median| / MAD > threshold
   ```

**Outlier Cap:**
- Maximum 10% of points can be outliers (prevents overload)
- Outliers sorted by severity
- Most extreme outliers preserved first

### 4. Zoom-Aware Refinement

**Behavior:**
- Zoom in → Increase detail level
- Zoom out → Reduce detail safely

**Implementation:**
```typescript
function applyLODWithZoom(
  points: TimeSeriesPoint[],
  targetPoints: number,
  zoomDomain: [Date, Date],      // Visible time range
  fullDomain: [Date, Date],      // Full time range
): LODResult {
  // Filter to visible subset
  visiblePoints = points.filter(p => p.x in zoomDomain)

  // Calculate zoom ratio
  zoomRatio = (zoomDomain.end - zoomDomain.start) /
              (fullDomain.end - fullDomain.start)

  // Increase target points when zoomed in
  adjustedTarget = targetPoints * min(2, 1 / zoomRatio)

  return applyLOD(visiblePoints, adjustedTarget)
}
```

## LOD Levels

| Level | Compression | Use Case |
|-------|-------------|----------|
| MINIMAL (0) | 100x+ | Full dataset overview |
| LOW (1) | 50x-100x | Initial zoom out |
| MEDIUM (2) | 10x-50x | Standard view |
| HIGH (3) | 2x-10x | Zoomed in |
| FULL (4) | 1x-2x | Maximum detail |

## Configuration

```typescript
const lodConfig = {
  // Downsampling strategies
  temporalBucketing: true,
  minMaxEnvelope: true,
  outlierPreservation: true,

  // Zoom-aware refinement
  zoomRefinement: true,
  minZoomDetailLevel: 0,
  maxZoomDetailLevel: 4,

  // Pixel ratio thresholds
  targetPixelsPerPoint: 3,
  minPixelsPerPoint: 1,

  // Outlier detection
  outlierThreshold: 3,  // Standard deviations
  outlierDetectionMethod: 'zscore',  // or 'iqr', 'mad'
}
```

## API Reference

### `applyLOD(points, targetPoints, timeRange?, config?)`

**Parameters:**
- `points`: TimeSeriesPoint[] - Input data points
- `targetPoints`: number - Desired number of output points
- `timeRange`: [Date, Date] - Optional time range constraint
- `config`: Partial<LODConfig> - Optional configuration overrides

**Returns:** `LODResult`
```typescript
interface LODResult {
  buckets: LODBucket[]       // Bucket summaries
  totalPoints: number        // Original point count
  sampledPoints: number      // After downsampling
  compressionRatio: number  // total / sampled
  level: LODLevel           // Determined detail level
  outlierCount: number      // Preserved outliers
}
```

### `applyLODWithZoom(points, targetPoints, zoomDomain, fullDomain, config?)`

Applies LOD with zoom-aware refinement. When zoomed in, shows more detail.

### `createMinMaxEnvelope(buckets)`

Creates envelope data suitable for area/line charts showing range.

### `extractRepresentativePoints(lodResult)`

Gets the primary representative points for rendering.

### `extractAllSignificantPoints(lodResult, includeOutliers?)`

Gets all significant points including outliers, sorted by time.

### `calculateOptimalPointCount(width, pixelsPerPoint?)`

Calculates optimal target point count based on canvas width.

**Example:**
```typescript
const width = 800  // Canvas width
const pixelsPerPoint = 3  // Target 3 pixels per point
const optimalPoints = calculateOptimalPointCount(width, pixelsPerPoint)
// Returns: ~267 points
```

## Quality Guarantees

### 1. Visual Fidelity

Original and downsampled data should produce visually similar charts:
- Same overall trend direction
- Same min/max envelope
- Same major features visible

### 2. Anomaly Preservation

- All statistical outliers preserved
- Outliers visible at any zoom level
- Never silently discard critical values

### 3. Zoom Consistency

- Zooming in always reveals more detail
- No "popping" or sudden visual changes
- Smooth transition between LOD levels

## Testing Requirements

### Unit Tests

1. **Compression Test**
   ```
   Input: 10000 points
   Target: 100 points
   Verify: Result has ~100 points
   ```

2. **Outlier Preservation Test**
   ```
   Input: 1000 points with 10 known outliers
   Target: 100 points
   Verify: All 10 outliers present in result
   ```

3. **Min/Max Test**
   ```
   Input: Dataset with global min=10, max=90
   After LOD: Min and max unchanged
   ```

4. **Zoom Test**
   ```
   Zoom to 10% of domain
   Verify: Point density increases
   ```

### Visual Regression Tests

Compare screenshots of:
- Original data vs LOD data
- Different LOD levels
- Zoom states

## Common Pitfalls

1. **Over-compression**: Setting targetPoints too low obscures trends
   - Solution: Use `calculateOptimalPointCount()`

2. **Missing outliers**: Not using outlier preservation
   - Solution: Always enable `outlierPreservation: true`

3. **Time range issues**: Not providing timeRange for filtered data
   - Solution: Pass zoomDomain when using `applyLODWithZoom()`

4. **Memory issues**: Storing all original points after LOD
   - Solution: Use `extractRepresentativePoints()` for rendering only

## Integration with Hybrid Engine

```typescript
const engine = createHybridEngine({
  lodPolicy: {
    temporalBucketing: true,
    minMaxEnvelope: true,
    outlierPreservation: true,
    zoomRefinement: true,
  }
})

// Engine automatically applies LOD when:
// 1. Data density exceeds threshold
// 2. Zoom level changes
// 3. Canvas size changes
```

## Best Practices

1. **Always preserve outliers** - Critical for anomaly detection
2. **Use zoom-aware refinement** - Better UX when exploring data
3. **Calculate optimal point count** - Prevents over/under-sampling
4. **Test with edge cases** - Single point, all same values, etc.
5. **Profile memory usage** - LOD reduces memory but adds overhead

## Future Enhancements

- **Adaptive LOD**: Machine learning to predict optimal LOD level
- **Multi-resolution**: Store pre-computed LOD levels for fast switching
- **Delta LOD**: Only recompute changed regions
