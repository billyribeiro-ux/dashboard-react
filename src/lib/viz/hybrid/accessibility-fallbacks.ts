/**
 * Accessibility Fallbacks
 * Ensures Canvas/WebGL visualizations remain accessible
 */

import type {
  DataPoint,
  SeriesData,
} from './types';

// ============================================================================
// ACCESSIBILITY CONFIGURATION
// ============================================================================

export interface AccessibilityOptions {
  // Screen reader support
  ariaLabel: string;
  ariaDescription: string;

  // Table fallback
  enableTableFallback: boolean;
  maxTableRows: number;

  // Keyboard navigation
  enableKeyboardNav: boolean;

  // Reduced motion
  respectPrefersReducedMotion: boolean;

  // High contrast mode
  highContrastMode: boolean;

  // Focus management
  focusable: boolean;
}

export const DEFAULT_ACCESSIBILITY_OPTIONS: AccessibilityOptions = {
  ariaLabel: 'Data visualization',
  ariaDescription: 'Interactive chart showing data trends over time',
  enableTableFallback: true,
  maxTableRows: 100,
  enableKeyboardNav: true,
  respectPrefersReducedMotion: true,
  highContrastMode: false,
  focusable: true,
};

// ============================================================================
// TABLE FALLBACK
// ============================================================================

export interface TableColumn {
  key: string;
  header: string;
  format?: (value: unknown) => string;
}

export interface TableRow {
  [key: string]: unknown;
}

/**
 * Generate accessible data table from series data
 */
export function generateDataTable(
  data: SeriesData[],
  maxRows: number = 100
): { columns: TableColumn[]; rows: TableRow[]; truncated: boolean } {
  if (data.length === 0) {
    return { columns: [], rows: [], truncated: false };
  }

  // Build columns
  const columns: TableColumn[] = [
    { key: 'series', header: 'Series' },
    { key: 'timestamp', header: 'Time', format: (v) => formatTimestamp(v as Date | number) },
    { key: 'value', header: 'Value', format: (v) => formatNumber(v as number) },
  ];

  // Build rows (limit to maxRows)
  const rows: TableRow[] = [];
  let truncated = false;
  let count = 0;

  for (const series of data) {
    for (const point of series.data) {
      if (count >= maxRows) {
        truncated = true;
        break;
      }

      rows.push({
        series: series.name,
        timestamp: point.x,
        value: point.y,
        id: point.id,
        metadata: point.metadata,
      });

      count++;
    }

    if (truncated) break;
  }

  return { columns, rows, truncated };
}

function formatTimestamp(value: Date | number): string {
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return new Date(value).toLocaleString();
}

function formatNumber(value: number): string {
  if (isNaN(value)) return 'N/A';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  });
}

// ============================================================================
// ARIA ATTRIBUTES
// ============================================================================

/**
 * Generate ARIA attributes for chart container
 */
export function generateAriaAttributes(
  options: Partial<AccessibilityOptions>,
  data?: SeriesData[]
): Record<string, string> {
  const opts = { ...DEFAULT_ACCESSIBILITY_OPTIONS, ...options };

  const attributes: Record<string, string> = {
    role: 'img',
    'aria-label': opts.ariaLabel,
  };

  // Add data summary if available
  if (data && data.length > 0) {
    const totalPoints = data.reduce((sum, s) => sum + s.data.length, 0);
    const seriesNames = data.map((s) => s.name).join(', ');
    attributes['aria-description'] = `${opts.ariaDescription}. Contains ${data.length} data series (${seriesNames}) with ${totalPoints} total data points.`;
  } else {
    attributes['aria-description'] = opts.ariaDescription;
  }

  if (opts.focusable) {
    attributes.tabindex = '0';
  }

  return attributes;
}

// ============================================================================
// SUMMARY GENERATION
// ============================================================================

export interface DataSummary {
  seriesCount: number;
  totalPoints: number;
  timeRange: { start: Date; end: Date } | null;
  valueRange: { min: number; max: number };
  anomalies: Array<{ series: string; point: DataPoint; description: string }>;
  trends: Array<{ series: string; direction: 'up' | 'down' | 'stable'; strength: number }>;
}

/**
 * Generate text summary of data for screen readers
 */
export function generateDataSummary(data: SeriesData[]): DataSummary {
  if (data.length === 0) {
    return {
      seriesCount: 0,
      totalPoints: 0,
      timeRange: null,
      valueRange: { min: 0, max: 0 },
      anomalies: [],
      trends: [],
    };
  }

  let totalPoints = 0;
  let globalMin = Infinity;
  let globalMax = -Infinity;
  let timeMin: Date | null = null;
  let timeMax: Date | null = null;
  const anomalies: DataSummary['anomalies'] = [];
  const trends: DataSummary['trends'] = [];

  for (const series of data) {
    totalPoints += series.data.length;

    if (series.data.length === 0) continue;

    // Calculate series statistics
    const values = series.data.map((p) => p.y);
    const seriesMin = Math.min(...values);
    const seriesMax = Math.max(...values);
    const seriesAvg = values.reduce((a, b) => a + b, 0) / values.length;

    globalMin = Math.min(globalMin, seriesMin);
    globalMax = Math.max(globalMax, seriesMax);

    // Time range
    const times = series.data.map((p) => (p.x instanceof Date ? p.x : new Date(p.x)));
    const seriesTimeMin = new Date(Math.min(...times.map((t) => t.getTime())));
    const seriesTimeMax = new Date(Math.max(...times.map((t) => t.getTime())));

    if (!timeMin || seriesTimeMin < timeMin) timeMin = seriesTimeMin;
    if (!timeMax || seriesTimeMax > timeMax) timeMax = seriesTimeMax;

    // Detect anomalies (values > 3 std dev from mean)
    const std = Math.sqrt(
      values.reduce((acc, v) => acc + Math.pow(v - seriesAvg, 2), 0) / values.length
    );

    for (const point of series.data) {
      if (Math.abs(point.y - seriesAvg) > 3 * std) {
        anomalies.push({
          series: series.name,
          point,
          description: `Anomalous value ${point.y} detected in ${series.name}`,
        });
      }
    }

    // Detect trend
    if (series.data.length >= 2) {
      const first = series.data[0].y;
      const last = series.data[series.data.length - 1].y;
      const change = last - first;
      const strength = Math.abs(change) / (seriesMax - seriesMin || 1);

      let direction: 'up' | 'down' | 'stable';
      if (Math.abs(change) < 0.01 * seriesAvg) {
        direction = 'stable';
      } else if (change > 0) {
        direction = 'up';
      } else {
        direction = 'down';
      }

      trends.push({
        series: series.name,
        direction,
        strength: Math.min(strength, 1),
      });
    }
  }

  return {
    seriesCount: data.length,
    totalPoints,
    timeRange: timeMin && timeMax ? { start: timeMin, end: timeMax } : null,
    valueRange: { min: globalMin, max: globalMax },
    anomalies: anomalies.slice(0, 10), // Limit to 10 anomalies
    trends,
  };
}

/**
 * Generate plain text summary for screen readers
 */
export function generateTextSummary(summary: DataSummary): string {
  let text = '';

  text += `Chart contains ${summary.seriesCount} data series with ${summary.totalPoints} total data points. `;

  if (summary.timeRange) {
    text += `Time range: ${summary.timeRange.start.toLocaleDateString()} to ${summary.timeRange.end.toLocaleDateString()}. `;
  }

  text += `Value range: ${summary.valueRange.min.toFixed(2)} to ${summary.valueRange.max.toFixed(2)}. `;

  if (summary.anomalies.length > 0) {
    text += `Found ${summary.anomalies.length} anomalous data points. `;
  }

  for (const trend of summary.trends) {
    const strength = trend.strength > 0.5 ? 'strong' : 'moderate';
    text += `${trend.series} shows ${strength} ${trend.direction}ward trend. `;
  }

  return text;
}

// ============================================================================
// REDUCED MOTION
// ============================================================================

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get animation duration based on user preference
 */
export function getAnimationDuration(defaultMs: number): number {
  if (prefersReducedMotion()) {
    return 0;
  }
  return defaultMs;
}

// ============================================================================
// HIGH CONTRAST MODE
// ============================================================================

/**
 * Check if high contrast mode is active
 */
export function isHighContrastMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-contrast: high)').matches;
}

/**
 * Get contrast-adjusted colors
 */
export function getContrastColors(
  baseColors: string[]
): { colors: string[]; lineWidth: number } {
  if (isHighContrastMode()) {
    // Use high contrast palette
    return {
      colors: ['#000000', '#ffffff', '#ffff00', '#00ffff', '#ff00ff'],
      lineWidth: 3,
    };
  }

  return { colors: baseColors, lineWidth: 2 };
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

export const KEYBOARD_SHORTCUTS = {
  // Navigation
  ArrowLeft: 'Move to previous data point',
  ArrowRight: 'Move to next data point',
  ArrowUp: 'Move to series above',
  ArrowDown: 'Move to series below',

  // Selection
  Enter: 'Select current data point',
  Space: 'Toggle selection of current data point',
  Escape: 'Clear selection',

  // Zoom
  Plus: 'Zoom in',
  Minus: 'Zoom out',
  Zero: 'Reset zoom',

  // Data
  T: 'Toggle table view',
  S: 'Announce summary',
} as const;

/**
 * Generate keyboard shortcuts help text
 */
export function generateKeyboardHelp(): string {
  let help = 'Keyboard shortcuts: ';
  const shortcuts: string[] = [];

  for (const [key, description] of Object.entries(KEYBOARD_SHORTCUTS)) {
    shortcuts.push(`${key}: ${description}`);
  }

  help += shortcuts.join('. ');
  return help;
}
