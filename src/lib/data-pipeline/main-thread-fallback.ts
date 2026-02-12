/**
 * Main Thread Fallback
 * JavaScript implementations for when WASM and Workers are unavailable
 */

import type {
   
  DataPoint,
   
  FilterGroup,
   
  GroupByConfig,
   
  AggregationConfig,
   
  AnalyticsData,
   
  AggregateResult,
   
  TimeSeriesResult,
   
  DistributionResult,
} from './types';

// ============================================================================
// FILTERING
// ============================================================================

export function applyFilters(points: DataPoint[], filters: FilterGroup): DataPoint[] {
  return points.filter((point) => {
    const clauseResults = filters.clauses.map((clause) => {
      const value = (point as unknown as Record<string, unknown>)[clause.field];

      switch (clause.operator) {
        case 'eq':
          return value === clause.value;
        case 'ne':
          return value !== clause.value;
        case 'gt':
          return Number(value) > Number(clause.value);
        case 'gte':
          return Number(value) >= Number(clause.value);
        case 'lt':
          return Number(value) < Number(clause.value);
        case 'lte':
          return Number(value) <= Number(clause.value);
        case 'in':
          return Array.isArray(clause.value) && clause.value.includes(value);
        case 'nin':
          return Array.isArray(clause.value) && !clause.value.includes(value);
        case 'between':
          const num = Number(value);
          return num >= Number(clause.value) && num <= Number(clause.value2);
        case 'contains':
          return String(value).includes(String(clause.value));
        default:
          return true;
      }
    });

    return filters.operator === 'and'
      ? clauseResults.every(Boolean)
      : clauseResults.some(Boolean);
  });
}

// ============================================================================
// GROUPING
// ============================================================================

export function groupPoints(
  points: DataPoint[],
  groupBy?: GroupByConfig
): Map<string, DataPoint[]> {
  if (!groupBy || groupBy.fields.length === 0) {
    return new Map([['all', points]]);
  }

  const groups = new Map<string, DataPoint[]>();

  for (const point of points) {
    const keyParts = groupBy.fields.map((field) => {
      const value = (point as unknown as Record<string, unknown>)[field];
      return String(value ?? 'null');
    });

    const key = keyParts.join('|');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(point);
  }

  return groups;
}

// ============================================================================
// AGGREGATIONS
// ============================================================================

export function computeAggregation(
  values: number[],
  config: AggregationConfig
): number {
  if (values.length === 0) return 0;

  switch (config.function) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'count':
      return values.length;
    case 'std':
      return computeStd(values);
    case 'variance':
      return computeVariance(values);
    case 'median':
      return computeMedian(values);
    case 'percentile':
      return computePercentile(values, config.percentileValue ?? 50);
    case 'distinct':
      return new Set(values).size;
    default:
      return 0;
  }
}

function computeStd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computeVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// ============================================================================
// MAIN COMPUTE FUNCTION
// ============================================================================

export function computeAggregationsMainThread(
  points: DataPoint[],
  filters: FilterGroup,
  groupBy?: GroupByConfig,
  aggregations: AggregationConfig[] = []
): AnalyticsData {
  // Apply filters
  const filtered = applyFilters(points, filters);

  // Group data
  const groups = groupPoints(filtered, groupBy);

  // Compute aggregates for each group
  const aggregateResults: AggregateResult[] = [];

  for (const [groupKey, groupPoints] of groups.entries()) {
    const groupValues: Record<string, unknown> = {};

    // Parse group key into values
    if (groupBy) {
      const keyParts = groupKey.split('|');
      groupBy.fields.forEach((field, i) => {
        groupValues[field] = keyParts[i];
      });
    }

    const metrics: Record<string, number> = {};

    for (const agg of aggregations) {
      const values = groupPoints.map((p) => p.value);
      metrics[agg.alias] = computeAggregation(values, agg);
    }

    aggregateResults.push({
      groupKey,
      groupValues,
      metrics,
      count: groupPoints.length,
    });
  }

  // Build time series if time grouping
  let timeSeries: TimeSeriesResult[] | undefined;
  if (groupBy?.timeBucket) {
    timeSeries = aggregateResults.map((agg) => ({
      timestamp: parseInt(agg.groupKey),
      values: agg.metrics,
      count: agg.count,
    }));
  }

  return {
    aggregates: aggregateResults,
    timeseries: timeSeries,
  };
}

// ============================================================================
// DISTRIBUTIONS
// ============================================================================

export function computeDistribution(
  values: number[],
  binCount: number = 20
): DistributionResult {
  if (values.length === 0) {
    return {
      field: 'value',
      bins: [],
      statistics: {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        std: 0,
        q25: 0,
        q75: 0,
        p95: 0,
        p99: 0,
      },
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const binWidth = range / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    count: 0,
    density: 0,
  }));

  for (const value of values) {
    const binIndex = Math.min(
      Math.floor((value - min) / binWidth),
      binCount - 1
    );
    bins[binIndex].count++;
  }

  // Normalize densities
  const totalCount = values.length;
  for (const bin of bins) {
    bin.density = bin.count / totalCount;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    field: 'value',
    bins,
    statistics: {
      min,
      max,
      mean,
      median: computeMedian(values),
      std: computeStd(values),
      q25: computePercentile(values, 25),
      q75: computePercentile(values, 75),
      p95: computePercentile(values, 95),
      p99: computePercentile(values, 99),
    },
  };
}
