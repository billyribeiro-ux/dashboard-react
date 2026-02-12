/**
 * Hybrid Rendering System - Main Export
 * Ultra-high-density visualization with progressive SVG/Canvas/WebGL rendering
 */

// Core types
export {
  RendererTier,
  type Renderer,
  type RendererType,
  type DataPoint,
  type TimeSeriesPoint,
  type SeriesData,
  type TimeSeriesData,
  type RenderContext,
  type TimeSeriesRenderContext,
  type HybridRendererConfig,
  type ThresholdConfig,
  type PerformanceBudgetConfig,
  type LODPolicyConfig,
  type AccessibilityConfig,
  type DebugConfig,
  type RendererState,
  type FrameMetrics,
  type InteractionMetrics,
  type InteractionState,
  type HitTestResult,
  type TooltipState,
  type LODLevel,
  type LODBucket,
  type LODResult,
  type EngineState,
  type TierSwitchEvent,
  type EngineEvent,
  type EngineEventType,
  type EngineEventHandler,
} from './types';

// Thresholds
export {
  DEFAULT_THRESHOLDS,
  MOBILE_THRESHOLDS,
  LOW_POWER_THRESHOLDS,
  HIGH_PERFORMANCE_THRESHOLDS,
  calculatePointDensity,
  getThresholdsForDevice,
  validateThresholds,
  setRuntimeThresholds,
  getRuntimeThresholds,
  resetThresholds,
} from './thresholds';

// Detection
export {
  calculateDensityMetrics,
  detectOptimalTier,
  detectWebGLCapabilities,
  detectDeviceCapabilities,
  isTierAvailable,
  getFallbackTier,
  getAvailableTiers,
  recordPerformance,
  getPerformanceHistory,
  getAverageFrameTime,
  countPerformanceViolations,
  shouldDegradeTier,
  getTierRecommendation,
  type DensityMetrics,
  type DeviceCapabilities,
  type PerformanceSnapshot,
  type TierRecommendation,
} from './detection';

// LOD
export {
  applyLOD,
  applyLODWithZoom,
  createMinMaxEnvelope,
  extractRepresentativePoints,
  extractAllSignificantPoints,
  calculateOptimalPointCount,
  DEFAULT_LOD_CONFIG,
  type LODConfig,
} from './lod';

// Engine
export {
  HybridEngine,
  createHybridEngine,
  DEFAULT_CONFIG,
} from './engine';

// Renderers
export { SVGRenderer, createSVGRenderer } from './renderer-svg';
export { CanvasRenderer, createCanvasRenderer } from './renderer-canvas';
export { WebGLRenderer, createWebGLRenderer } from './renderer-webgl';

// Interaction Bridge
export {
  InteractionBridge,
  createInteractionBridge,
  DEFAULT_INTERACTION_CONFIG,
  type InteractionBridgeConfig,
} from './interaction-bridge';

// Accessibility
export {
  generateDataTable,
  generateAriaAttributes,
  generateDataSummary,
  generateTextSummary,
  prefersReducedMotion,
  getAnimationDuration,
  isHighContrastMode,
  getContrastColors,
  generateKeyboardHelp,
  DEFAULT_ACCESSIBILITY_OPTIONS,
  KEYBOARD_SHORTCUTS,
  type AccessibilityOptions,
  type TableColumn,
  type TableRow,
  type DataSummary,
} from './accessibility-fallbacks';

// Debug Panel
export { DebugPanel } from './debug-panel';
