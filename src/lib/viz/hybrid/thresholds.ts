/**
 * Threshold Configuration
 * Deterministic thresholds for automatic tier switching
 */

import type { ThresholdConfig } from './types';

// ============================================================================
// DEFAULT THRESHOLD VALUES
// ============================================================================

/**
 * Conservative defaults based on typical browser performance:
 * - SVG: Excellent for < 10k elements with full interactivity
 * - Canvas: Good for 10k-500k points with proper LOD
 * - WebGL: Required for >500k points or real-time streaming
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  // Absolute point count thresholds
  svgToCanvas: 5000,
  canvasToWebGL: 50000,

  // Points per pixel density (alternative metric)
  pointsPerPixelSVG: 0.5,
  pointsPerPixelCanvas: 5,
  pointsPerPixelWebGL: 50,

  // Runtime override (undefined = auto-detect)
  forceRenderer: undefined,

  // Enable automatic detection based on device capabilities
  autoDetect: true,
};

// ============================================================================
// DEVICE-SPECIFIC THRESHOLDS
// ============================================================================

/**
 * Mobile devices have lower thresholds due to:
 * - Lower GPU power
 * - Smaller screens
 * - Touch interactions (different precision needs)
 */
export const MOBILE_THRESHOLDS: ThresholdConfig = {
  svgToCanvas: 2000,
  canvasToWebGL: 20000,

  pointsPerPixelSVG: 0.3,
  pointsPerPixelCanvas: 3,
  pointsPerPixelWebGL: 30,

  forceRenderer: undefined,
  autoDetect: true,
};

/**
 * Low-power device thresholds (older laptops, budget devices)
 */
export const LOW_POWER_THRESHOLDS: ThresholdConfig = {
  svgToCanvas: 3000,
  canvasToWebGL: 30000,

  pointsPerPixelSVG: 0.4,
  pointsPerPixelCanvas: 4,
  pointsPerPixelWebGL: 40,

  forceRenderer: undefined,
  autoDetect: true,
};

/**
 * High-performance device thresholds (workstations, gaming PCs)
 */
export const HIGH_PERFORMANCE_THRESHOLDS: ThresholdConfig = {
  svgToCanvas: 10000,
  canvasToWebGL: 100000,

  pointsPerPixelSVG: 1.0,
  pointsPerPixelCanvas: 10,
  pointsPerPixelWebGL: 100,

  forceRenderer: undefined,
  autoDetect: true,
};

// ============================================================================
// THRESHOLD UTILITIES
// ============================================================================

/**
 * Calculate points per pixel density
 */
export function calculatePointDensity(
  pointCount: number,
  width: number,
  height: number
): number {
  const pixelArea = width * height;
  if (pixelArea === 0) return 0;
  return pointCount / pixelArea;
}

/**
 * Calculate optimal threshold based on device characteristics
 */
export function getThresholdsForDevice(): ThresholdConfig {
  // Check for forced renderer (override)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const forceRenderer = urlParams.get('renderer');
    if (forceRenderer === 'svg' || forceRenderer === 'canvas' || forceRenderer === 'webgl') {
      return {
        ...DEFAULT_THRESHOLDS,
        forceRenderer,
      };
    }
  }

  // Detect device capabilities
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

  const isLowPower = isLowPowerDevice();

  if (isMobile) {
    return MOBILE_THRESHOLDS;
  }

  if (isLowPower) {
    return LOW_POWER_THRESHOLDS;
  }

  // Check for high-performance indicators
  if (isHighPerformanceDevice()) {
    return HIGH_PERFORMANCE_THRESHOLDS;
  }

  return DEFAULT_THRESHOLDS;
}

/**
 * Heuristics for detecting low-power devices
 */
function isLowPowerDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 2) return true;

  // Check device memory (if available)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory && memory <= 4) return true;

  // Check for low-power mode (battery)
  // Note: This is async, so we use a synchronous approximation here
  // The actual battery check would be done at runtime

  return false;
}

/**
 * Heuristics for detecting high-performance devices
 */
function isHighPerformanceDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const cores = navigator.hardwareConcurrency || 4;
  if (cores >= 8) {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (memory && memory >= 16) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// THRESHOLD VALIDATION
// ============================================================================

/**
 * Validate threshold configuration
 */
export function validateThresholds(config: Partial<ThresholdConfig>): ThresholdConfig {
  const base = DEFAULT_THRESHOLDS;

  return {
    svgToCanvas: Math.max(100, config.svgToCanvas ?? base.svgToCanvas),
    canvasToWebGL: Math.max(
      config.svgToCanvas ?? base.svgToCanvas,
      config.canvasToWebGL ?? base.canvasToWebGL
    ),
    pointsPerPixelSVG: Math.max(0.1, config.pointsPerPixelSVG ?? base.pointsPerPixelSVG),
    pointsPerPixelCanvas: Math.max(
      0.1,
      config.pointsPerPixelCanvas ?? base.pointsPerPixelCanvas
    ),
    pointsPerPixelWebGL: Math.max(
      0.1,
      config.pointsPerPixelWebGL ?? base.pointsPerPixelWebGL
    ),
    forceRenderer: config.forceRenderer ?? base.forceRenderer,
    autoDetect: config.autoDetect ?? base.autoDetect,
  };
}

/**
 * Runtime threshold override (for testing/debugging)
 */
export function setRuntimeThresholds(overrides: Partial<ThresholdConfig>): ThresholdConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_THRESHOLDS;
  }

  // Store in sessionStorage for persistence across reloads
  const existing = sessionStorage.getItem('hybrid-renderer-thresholds');
  const current = existing ? (JSON.parse(existing) as ThresholdConfig) : DEFAULT_THRESHOLDS;

  const updated = { ...current, ...overrides };
  sessionStorage.setItem('hybrid-renderer-thresholds', JSON.stringify(updated));

  return updated;
}

/**
 * Get current runtime thresholds
 */
export function getRuntimeThresholds(): ThresholdConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_THRESHOLDS;
  }

  const stored = sessionStorage.getItem('hybrid-renderer-thresholds');
  if (stored) {
    return validateThresholds(JSON.parse(stored));
  }

  return getThresholdsForDevice();
}

/**
 * Reset thresholds to defaults
 */
export function resetThresholds(): ThresholdConfig {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('hybrid-renderer-thresholds');
  }
  return getThresholdsForDevice();
}
