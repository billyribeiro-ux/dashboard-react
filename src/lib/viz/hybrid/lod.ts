/**
 * LOD (Level of Detail) Module
 * Deterministic downsampling with outlier preservation for time-series data
 */

import type { TimeSeriesPoint, LODResult, LODBucket } from './types';

// ============================================================================
// LOD CONFIGURATION
// ============================================================================

export interface LODConfig {
  // Target number of points after downsampling
  targetPoints: number;

  // Outlier detection threshold (standard deviations for z-score)
  outlierThreshold: number;

  // Method for outlier detection
  outlierMethod: 'zscore' | 'iqr' | 'mad';

  // Preserve minimum/maximum in each bucket
  preserveMinMax: boolean;

  // Preserve outliers separately
  preserveOutliers: boolean;

  // Maximum percentage of outliers to preserve (prevent overload)
  maxOutlierPercentage: number;
}

export const DEFAULT_LOD_CONFIG: LODConfig = {
  targetPoints: 1000,
  outlierThreshold: 3,
  outlierMethod: 'zscore',
  preserveMinMax: true,
  preserveOutliers: true,
  maxOutlierPercentage: 10,
};

// ============================================================================
// TEMPORAL BUCKETING
// ============================================================================

/**
 * Calculate appropriate bucket size based on time range and target points
 */
function calculateBucketSize(
  timeRange: [number, number],
  targetPoints: number
): number {
  const [start, end] = timeRange;
  const duration = end - start;

  if (duration === 0 || targetPoints === 0) {
    return 1;
  }

  // Target bucket size in milliseconds
  const bucketMs = duration / targetPoints;

  // Round to nice intervals
  const intervals = [
    1, 5, 10, 50, 100, 500, // milliseconds
    1000, 5000, 10000, 30000, // seconds
    60000, 300000, 600000, // minutes
    3600000, 18000000, 36000000, // hours
    86400000, 604800000, // days, weeks
  ];

  // Find closest nice interval
  let closest = intervals[0];
  let minDiff = Math.abs(bucketMs - closest);

  for (const interval of intervals) {
    const diff = Math.abs(bucketMs - interval);
    if (diff < minDiff) {
      minDiff = diff;
      closest = interval;
    }
  }

  return Math.max(1, closest);
}

/**
 * Group points into temporal buckets
 */
function bucketPoints(
  points: TimeSeriesPoint[],
  bucketSize: number,
  timeRange: [number, number]
): Map<number, TimeSeriesPoint[]> {
  const buckets = new Map<number, TimeSeriesPoint[]>();
  const [start] = timeRange;

  for (const point of points) {
    const time = point.x.getTime();
    const bucketIndex = Math.floor((time - start) / bucketSize);

    if (!buckets.has(bucketIndex)) {
      buckets.set(bucketIndex, []);
    }
    buckets.get(bucketIndex)!.push(point);
  }

  return buckets;
}

// ============================================================================
// OUTLIER DETECTION
// ============================================================================

/**
 * Detect outliers using z-score method
 */
function detectOutliersZScore(
  points: TimeSeriesPoint[],
  threshold: number
): TimeSeriesPoint[] {
  if (points.length < 3) return [];

  const values = points.map((p) => p.y);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);

  if (std === 0) return [];

  return points.filter((p) => Math.abs((p.y - mean) / std) > threshold);
}

/**
 * Detect outliers using IQR (Interquartile Range) method
 */
function detectOutliersIQR(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
  if (points.length < 4) return [];

  const values = points.map((p) => p.y).sort((a, b) => a - b);
  const q1 = values[Math.floor(values.length * 0.25)];
  const q3 = values[Math.floor(values.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return points.filter((p) => p.y < lowerBound || p.y > upperBound);
}

/**
 * Detect outliers using MAD (Median Absolute Deviation) method
 */
function detectOutliersMAD(
  points: TimeSeriesPoint[],
  threshold: number
): TimeSeriesPoint[] {
  if (points.length < 3) return [];

  const values = points.map((p) => p.y).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];

  const deviations = values.map((v) => Math.abs(v - median));
  const mad = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)];

  if (mad === 0) return [];

  return points.filter((p) => Math.abs(p.y - median) / mad > threshold);
}

/**
 * Detect outliers using configured method
 */
function detectOutliers(
  points: TimeSeriesPoint[],
  config: LODConfig
): TimeSeriesPoint[] {
  if (!config.preserveOutliers || points.length < 3) {
    return [];
  }

  switch (config.outlierMethod) {
    case 'zscore':
      return detectOutliersZScore(points, config.outlierThreshold);
    case 'iqr':
      return detectOutliersIQR(points);
    case 'mad':
      return detectOutliersMAD(points, config.outlierThreshold);
    default:
      return detectOutliersZScore(points, config.outlierThreshold);
  }
}

// ============================================================================
// BUCKET AGGREGATION
// ============================================================================

/**
 * Create a representative point from a bucket
 */
function createBucketSummary(
  bucketPoints: TimeSeriesPoint[],
  bucketIndex: number,
  bucketSize: number,
  startTime: number,
  outliers: TimeSeriesPoint[],
  config: LODConfig
): LODBucket {
  const values = bucketPoints.map((p) => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Midpoint of bucket time range
  const bucketStart = startTime + bucketIndex * bucketSize;
  const bucketEnd = bucketStart + bucketSize;
  const midTime = bucketStart + bucketSize / 2;

  // Choose representative point
  // Priority: outlier > min/max (if preserving) > average
  let representative: TimeSeriesPoint;

  if (config.preserveMinMax) {
    // If we have outliers in this bucket, prefer the most extreme
    const bucketOutliers = outliers.filter((o) => {
      const t = o.x.getTime();
      return t >= bucketStart && t < bucketEnd;
    });

    if (bucketOutliers.length > 0) {
      // Use the most extreme outlier
      representative = bucketOutliers.reduce((extreme, current) =>
        Math.abs(current.y - avg) > Math.abs(extreme.y - avg) ? current : extreme
      );
    } else {
      // Use midpoint with average value, or min/max if significant
      const range = max - min;
      if (range > 0 && (avg - min) / range > 0.7) {
        // Near max, use max point
        representative = bucketPoints.find((p) => p.y === max) || bucketPoints[0];
      } else if (range > 0 && (max - avg) / range > 0.7) {
        // Near min, use min point
        representative = bucketPoints.find((p) => p.y === min) || bucketPoints[0];
      } else {
        // Use average
        representative = {
          x: new Date(midTime),
          y: avg,
          id: `bucket-${bucketIndex}-avg`,
        };
      }
    }
  } else {
    representative = {
      x: new Date(midTime),
      y: avg,
      id: `bucket-${bucketIndex}-avg`,
    };
  }

  return {
    startTime: bucketStart,
    endTime: bucketEnd,
    min,
    max,
    avg,
    count: bucketPoints.length,
    outliers: [],
    representative,
  };
}

// ============================================================================
// MAIN LOD FUNCTIONS
// ============================================================================

/**
 * Apply LOD downsampling to time-series data
 * Preserves min/max envelope and outliers
 */
export function applyLOD(
  points: TimeSeriesPoint[],
  targetPoints: number,
  timeRange?: [Date, Date],
  config?: Partial<LODConfig>
): LODResult {
  const fullConfig = { ...DEFAULT_LOD_CONFIG, ...config, targetPoints };

  if (points.length <= targetPoints) {
    // No downsampling needed
    return {
      buckets: points.map((p) => ({
        startTime: p.x.getTime(),
        endTime: p.x.getTime(),
        min: p.y,
        max: p.y,
        avg: p.y,
        count: 1,
        outliers: [],
        representative: p,
      })),
      totalPoints: points.length,
      sampledPoints: points.length,
      compressionRatio: 1,
      level: 4, // FULL
      outlierCount: 0,
    };
  }

  // Determine time range
  let range: [number, number];
  if (timeRange) {
    range = [timeRange[0].getTime(), timeRange[1].getTime()];
  } else {
    const times = points.map((p) => p.x.getTime());
    range = [Math.min(...times), Math.max(...times)];
  }

  // Calculate bucket size
  const bucketSize = calculateBucketSize(range, targetPoints);

  // Group into buckets
  const buckets = bucketPoints(points, bucketSize, range);

  // Detect outliers globally (for reference)
  const allOutliers = detectOutliers(points, fullConfig);

  // Cap outliers to prevent overload
  const maxOutliers = Math.floor(points.length * (fullConfig.maxOutlierPercentage / 100));
  const cappedOutliers = allOutliers.slice(0, maxOutliers);

  // Create bucket summaries
  const bucketSummaries: LODBucket[] = [];
  const sortedIndices = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const index of sortedIndices) {
    const bucketPoints = buckets.get(index)!;

    const summary = createBucketSummary(
      bucketPoints,
      index,
      bucketSize,
      range[0],
      cappedOutliers,
      fullConfig
    );

    bucketSummaries.push(summary);
  }

  // Calculate compression stats
  const sampledPoints = bucketSummaries.length;
  const compressionRatio = points.length / sampledPoints;

  // Determine LOD level
  let level: number;
  if (compressionRatio >= 100) {
    level = 0; // MINIMAL
  } else if (compressionRatio >= 50) {
    level = 1; // LOW
  } else if (compressionRatio >= 10) {
    level = 2; // MEDIUM
  } else if (compressionRatio >= 2) {
    level = 3; // HIGH
  } else {
    level = 4; // FULL
  }

  return {
    buckets: bucketSummaries,
    totalPoints: points.length,
    sampledPoints,
    compressionRatio,
    level,
    outlierCount: cappedOutliers.length,
  };
}

/**
 * Apply LOD with zoom-aware refinement
 */
export function applyLODWithZoom(
  points: TimeSeriesPoint[],
  targetPoints: number,
  zoomDomain: [Date, Date],
  fullDomain: [Date, Date],
  config?: Partial<LODConfig>
): LODResult {
  // Filter points to visible domain first
  const visiblePoints = points.filter((p) => {
    const t = p.x.getTime();
    return t >= zoomDomain[0].getTime() && t <= zoomDomain[1].getTime();
  });

  // Apply LOD to visible subset with higher detail
  // When zoomed in, we can show more points per pixel
  const zoomedTargetPoints = Math.min(targetPoints * 2, visiblePoints.length);

  return applyLOD(visiblePoints, zoomedTargetPoints, zoomDomain, config);
}

/**
 * Create min/max envelope from LOD buckets
 * This represents the full range of values at each time bucket
 */
export function createMinMaxEnvelope(
  buckets: LODBucket[]
): { time: Date; min: number; max: number }[] {
  return buckets.map((b) => ({
    time: new Date((b.startTime + b.endTime) / 2),
    min: b.min,
    max: b.max,
  }));
}

/**
 * Extract representative points from LOD result
 */
export function extractRepresentativePoints(
  lodResult: LODResult
): TimeSeriesPoint[] {
  return lodResult.buckets.map((b) => b.representative);
}

/**
 * Extract all significant points including outliers
 */
export function extractAllSignificantPoints(
  lodResult: LODResult,
  includeOutliers = true
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = lodResult.buckets.map((b) => b.representative);

  if (includeOutliers) {
    for (const bucket of lodResult.buckets) {
      points.push(...bucket.outliers);
    }
  }

  // Sort by time
  return points.sort((a, b) => a.x.getTime() - b.x.getTime());
}

/**
 * Calculate optimal target points based on canvas size
 */
export function calculateOptimalPointCount(
  width: number,
  pixelsPerPoint: number = 3
): number {
  return Math.max(100, Math.floor(width / pixelsPerPoint));
}
