/**
 * Detection Module
 * Automatically detects data density and device capabilities
 * to determine optimal rendering tier
 */

import { RendererTier, type ThresholdConfig } from './types';
import { getRuntimeThresholds, calculatePointDensity } from './thresholds';

// ============================================================================
// DENSITY DETECTION
// ============================================================================

export interface DensityMetrics {
  totalPoints: number;
  pointsPerPixel: number;
  seriesCount: number;
  maxSeriesLength: number;
  estimatedMemoryMB: number;
}

/**
 * Calculate data density metrics for a dataset
 */
export function calculateDensityMetrics(
  data: { data: unknown[]; id: string }[],
  width: number,
  height: number
): DensityMetrics {
  let totalPoints = 0;
  let maxSeriesLength = 0;
  const seriesCount = data.length;

  for (const series of data) {
    const length = series.data.length;
    totalPoints += length;
    maxSeriesLength = Math.max(maxSeriesLength, length);
  }

  const pointsPerPixel = calculatePointDensity(totalPoints, width, height);

  // Rough memory estimate: 8 bytes per point (x, y as float64) + overhead
  const estimatedMemoryMB = (totalPoints * 16) / (1024 * 1024);

  return {
    totalPoints,
    pointsPerPixel,
    seriesCount,
    maxSeriesLength,
    estimatedMemoryMB,
  };
}

/**
 * Determine recommended renderer tier based on data density
 */
export function detectOptimalTier(
  metrics: DensityMetrics,
  thresholds?: ThresholdConfig
): RendererTier {
  const config = thresholds ?? getRuntimeThresholds();

  // Check for forced renderer (testing override)
  if (config.forceRenderer) {
    switch (config.forceRenderer) {
      case 'svg':
        return RendererTier.SVG;
      case 'canvas':
        return RendererTier.CANVAS;
      case 'webgl':
        return RendererTier.WEBGL;
    }
  }

  // Primary metric: total point count
  if (metrics.totalPoints >= config.canvasToWebGL) {
    return RendererTier.WEBGL;
  }

  if (metrics.totalPoints >= config.svgToCanvas) {
    return RendererTier.CANVAS;
  }

  // Secondary metric: points per pixel density
  if (metrics.pointsPerPixel >= config.pointsPerPixelWebGL) {
    return RendererTier.WEBGL;
  }

  if (metrics.pointsPerPixel >= config.pointsPerPixelCanvas) {
    return RendererTier.CANVAS;
  }

  // Default: SVG for small datasets
  return RendererTier.SVG;
}

// ============================================================================
// DEVICE CAPABILITY DETECTION
// ============================================================================

export interface DeviceCapabilities {
  webglSupported: boolean;
  webgl2Supported: boolean;
  maxTextureSize: number;
  maxViewportDims: [number, number];
  hardwareConcurrency: number;
  deviceMemory?: number;
  canvasSupported: boolean;
  svgSupported: boolean;
}

/**
 * Detect WebGL capabilities
 */
export function detectWebGLCapabilities(): {
  supported: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  maxViewportDims: [number, number];
  error?: string;
} {
  if (typeof document === 'undefined') {
    return {
      supported: false,
      webgl2: false,
      maxTextureSize: 0,
      maxViewportDims: [0, 0],
      error: 'Document not available (SSR)',
    };
  }

  const canvas = document.createElement('canvas');

  // Try WebGL2 first
  let gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null;

  let webgl2 = true;

  // Fall back to WebGL1
  if (!gl) {
    gl = (canvas.getContext('webgl', { antialias: true }) ||
      canvas.getContext('experimental-webgl', {
        antialias: true,
      })) as WebGL2RenderingContext | null;
    webgl2 = false;
  }

  if (!gl) {
    return {
      supported: false,
      webgl2: false,
      maxTextureSize: 0,
      maxViewportDims: [0, 0],
      error: 'WebGL not supported',
    };
  }

  try {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as [number, number];

    // Check for major performance caveat
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) {
      // Can lose context, but that's fine for our purposes
    }

    return {
      supported: true,
      webgl2,
      maxTextureSize,
      maxViewportDims,
    };
  } catch (error) {
    return {
      supported: false,
      webgl2: false,
      maxTextureSize: 0,
      maxViewportDims: [0, 0],
      error: error instanceof Error ? error.message : 'WebGL parameter query failed',
    };
  }
}

/**
 * Detect full device capabilities
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  const webglCaps = detectWebGLCapabilities();

  return {
    webglSupported: webglCaps.supported,
    webgl2Supported: webglCaps.webgl2,
    maxTextureSize: webglCaps.maxTextureSize,
    maxViewportDims: webglCaps.maxViewportDims,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    deviceMemory: (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined),
    canvasSupported: typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d'),
    svgSupported: typeof document !== 'undefined' && !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect,
  };
}

// ============================================================================
// TIER VALIDATION
// ============================================================================

/**
 * Validate if a renderer tier is available on this device
 */
export function isTierAvailable(tier: RendererTier): boolean {
  const caps = detectDeviceCapabilities();

  switch (tier) {
    case RendererTier.SVG:
      return caps.svgSupported;
    case RendererTier.CANVAS:
      return caps.canvasSupported;
    case RendererTier.WEBGL:
      return caps.webglSupported;
    default:
      return false;
  }
}

/**
 * Get the best available fallback tier
 */
export function getFallbackTier(preferred: RendererTier): RendererTier {
  const tiers = [RendererTier.WEBGL, RendererTier.CANVAS, RendererTier.SVG];
  const preferredIndex = tiers.indexOf(preferred);

  // Try preferred and all lower tiers
  for (let i = preferredIndex; i < tiers.length; i++) {
    if (isTierAvailable(tiers[i])) {
      return tiers[i];
    }
  }

  // Should always have SVG
  return RendererTier.SVG;
}

/**
 * Get ordered list of available tiers (best to worst)
 */
export function getAvailableTiers(): RendererTier[] {
  const caps = detectDeviceCapabilities();
  const tiers: RendererTier[] = [];

  if (caps.webglSupported) {
    tiers.push(RendererTier.WEBGL);
  }
  if (caps.canvasSupported) {
    tiers.push(RendererTier.CANVAS);
  }
  if (caps.svgSupported) {
    tiers.push(RendererTier.SVG);
  }

  return tiers;
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

export interface PerformanceSnapshot {
  timestamp: number;
  frameTime: number;
  fps: number;
  droppedFrames: number;
  tier: RendererTier;
  memoryUsedMB?: number;
}

const performanceHistory: PerformanceSnapshot[] = [];
const MAX_HISTORY = 60; // 1 second at 60fps

/**
 * Record a performance measurement
 */
export function recordPerformance(snapshot: PerformanceSnapshot): void {
  performanceHistory.push(snapshot);
  if (performanceHistory.length > MAX_HISTORY) {
    performanceHistory.shift();
  }
}

/**
 * Get recent performance history
 */
export function getPerformanceHistory(): PerformanceSnapshot[] {
  return [...performanceHistory];
}

/**
 * Calculate average frame time over recent history
 */
export function getAverageFrameTime(windowMs: number = 1000): number {
  const now = performance.now();
  const windowStart = now - windowMs;

  const recent = performanceHistory.filter((p) => p.timestamp >= windowStart);
  if (recent.length === 0) return 0;

  const sum = recent.reduce((acc, p) => acc + p.frameTime, 0);
  return sum / recent.length;
}

/**
 * Count recent performance violations (frames exceeding budget)
 */
export function countPerformanceViolations(
  budgetMs: number,
  windowMs: number = 1000
): number {
  const now = performance.now();
  const windowStart = now - windowMs;

  return performanceHistory.filter(
    (p) => p.timestamp >= windowStart && p.frameTime > budgetMs
  ).length;
}

/**
 * Detect if we should degrade to a lower tier due to performance issues
 */
export function shouldDegradeTier(
  currentTier: RendererTier,
  budgetMs: number,
  violationThreshold: number = 10,
  windowMs: number = 1000
): RendererTier | null {
  const violations = countPerformanceViolations(budgetMs, windowMs);

  if (violations >= violationThreshold) {
    // Recommend stepping down one tier
    const tiers = [RendererTier.WEBGL, RendererTier.CANVAS, RendererTier.SVG];
    const currentIndex = tiers.indexOf(currentTier);

    if (currentIndex < tiers.length - 1) {
      const nextTier = tiers[currentIndex + 1];
      if (isTierAvailable(nextTier)) {
        return nextTier;
      }
    }
  }

  return null;
}

// ============================================================================
// DYNAMIC TIER RECOMMENDATION
// ============================================================================

export interface TierRecommendation {
  recommended: RendererTier;
  reason: 'density' | 'performance' | 'fallback' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  metrics: DensityMetrics;
  alternative?: RendererTier;
}

/**
 * Get comprehensive tier recommendation including fallback options
 */
export function getTierRecommendation(
  data: { data: unknown[]; id: string }[],
  width: number,
  height: number,
  thresholds?: ThresholdConfig
): TierRecommendation {
  const metrics = calculateDensityMetrics(data, width, height);
  const optimal = detectOptimalTier(metrics, thresholds);

  // Check if optimal tier is available
  if (!isTierAvailable(optimal)) {
    const fallback = getFallbackTier(optimal);
    return {
      recommended: fallback,
      reason: 'fallback',
      confidence: 'high',
      metrics,
      alternative: optimal,
    };
  }

  // Check if we should degrade due to performance
  const budgetMs = 1000 / 60; // Assume 60fps target
  const degraded = shouldDegradeTier(optimal, budgetMs);

  if (degraded && degraded !== optimal) {
    return {
      recommended: degraded,
      reason: 'performance',
      confidence: 'medium',
      metrics,
      alternative: optimal,
    };
  }

  return {
    recommended: optimal,
    reason: 'density',
    confidence: 'high',
    metrics,
  };
}
