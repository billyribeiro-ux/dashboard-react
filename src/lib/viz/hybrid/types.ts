/**
 * Hybrid Rendering Types
 * Core type definitions for the SVG/Canvas/WebGL hybrid rendering system
 */

import type { ScaleLinear, ScaleTime } from 'd3-scale';

// ============================================================================
// RENDERER TIER DEFINITIONS
// ============================================================================

export enum RendererTier {
  SVG = 'svg',
  CANVAS = 'canvas',
  WEBGL = 'webgl',
}

export type RendererType = 'svg' | 'canvas' | 'webgl';

// ============================================================================
// DATA POINT TYPES
// ============================================================================

export interface DataPoint {
  x: number | Date;
  y: number;
  id?: string | number;
  metadata?: Record<string, unknown>;
}

export interface TimeSeriesPoint extends DataPoint {
  x: Date;
  seriesId?: string;
}

export interface SeriesData {
  id: string;
  name: string;
  color: string;
  data: DataPoint[];
  visible?: boolean;
}

export interface TimeSeriesData extends SeriesData {
  data: TimeSeriesPoint[];
}

// ============================================================================
// RENDERER CONFIGURATION
// ============================================================================

export interface HybridRendererConfig {
  // Thresholds for automatic tier switching
  thresholds: ThresholdConfig;

  // Performance budgets
  performanceBudgets: PerformanceBudgetConfig;

  // LOD policies
  lodPolicy: LODPolicyConfig;

  // Renderer-specific options
  svg: SVGRendererConfig;
  canvas: CanvasRendererConfig;
  webgl: WebGLRendererConfig;

  // Accessibility options
  accessibility: AccessibilityConfig;

  // Debug options
  debug: DebugConfig;
}

export interface ThresholdConfig {
  // Number of points at which to switch from SVG to Canvas
  svgToCanvas: number;

  // Number of points at which to switch from Canvas to WebGL
  canvasToWebGL: number;

  // Alternative: points per pixel density thresholds
  pointsPerPixelSVG: number;
  pointsPerPixelCanvas: number;
  pointsPerPixelWebGL: number;

  // Runtime override (for testing)
  forceRenderer?: RendererType;

  // Auto-detect based on device capabilities
  autoDetect: boolean;
}

export interface PerformanceBudgetConfig {
  // Frame time budgets (milliseconds)
  targetFrameTime: number;
  maxFrameTime: number;

  // FPS targets
  targetFPS: number;
  minAcceptableFPS: number;

  // Interaction latency budgets (milliseconds)
  maxHoverLatency: number;
  maxBrushLatency: number;
  maxZoomLatency: number;

  // Memory budgets (MB)
  maxGPUMemoryMB: number;
  maxJSMemoryMB: number;

  // Auto-degrade settings
  autoDegrade: boolean;
  degradeFrameThreshold: number; // Frames before degradation
}

export interface LODPolicyConfig {
  // Downsampling strategies
  temporalBucketing: boolean;
  minMaxEnvelope: boolean;
  outlierPreservation: boolean;

  // Zoom-aware refinement
  zoomRefinement: boolean;
  minZoomDetailLevel: number;
  maxZoomDetailLevel: number;

  // Pixel ratio thresholds
  targetPixelsPerPoint: number;
  minPixelsPerPoint: number;

  // Outlier detection
  outlierThreshold: number; // Standard deviations
  outlierDetectionMethod: 'zscore' | 'iqr' | 'mad';
}

export interface SVGRendererConfig {
  antialias: boolean;
  shapeRendering: 'auto' | 'optimizeSpeed' | 'crispEdges' | 'geometricPrecision';
  maxElements: number;
}

export interface CanvasRendererConfig {
  antialias: boolean;
  alpha: boolean;
  desynchronized: boolean;
  imageSmoothingEnabled: boolean;
  devicePixelRatio: number;
}

export interface WebGLRendererConfig {
  antialias: boolean;
  alpha: boolean;
  preserveDrawingBuffer: boolean;
  powerPreference: 'high-performance' | 'low-power' | 'default';
  failIfMajorPerformanceCaveat: boolean;
  maxBufferSize: number;
  instancedRendering: boolean;
}

export interface AccessibilityConfig {
  // Fallback table for canvas/webgl
  enableTableFallback: boolean;
  enableKeyboardNavigation: boolean;
  enableScreenReaderAnnouncements: boolean;

  // Reduced motion
  reducedMotion: 'auto' | 'always' | 'never';

  // Non-color cues
  enablePatterns: boolean;
  enableShapeVariation: boolean;

  // Focus management
  focusVisible: boolean;
  tabIndex: number;
}

export interface DebugConfig {
  enableDebugPanel: boolean;
  showRendererTier: boolean;
  showFPS: boolean;
  showFrameTime: boolean;
  showPointCount: boolean;
  showDroppedFrames: boolean;
  logRendererSwitches: boolean;
  logLODDecisions: boolean;
  logInteractionMetrics: boolean;
}

// ============================================================================
// RENDERER STATE & METRICS
// ============================================================================

export interface RendererState {
  tier: RendererTier;
  isActive: boolean;
  isReady: boolean;
  error?: string;
  lastFrameTime: number;
  averageFrameTime: number;
  droppedFrames: number;
  pointCount: number;
  memoryUsageMB: number;
}

export interface FrameMetrics {
  timestamp: number;
  frameTime: number;
  renderTime: number;
  pointCount: number;
  tier: RendererTier;
  dropped: boolean;
}

export interface InteractionMetrics {
  type: 'hover' | 'brush' | 'zoom' | 'pan' | 'click';
  latency: number;
  timestamp: number;
  tier: RendererTier;
}

// ============================================================================
// RENDER CONTEXT
// ============================================================================

export interface RenderContext {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  xScale: ScaleLinear<number, number> | ScaleTime<number, number>;
  yScale: ScaleLinear<number, number>;
  pixelRatio: number;
}

export interface TimeSeriesRenderContext extends RenderContext {
  xScale: ScaleTime<number, number>;
  timeRange: [Date, Date];
}

// ============================================================================
// INTERACTION TYPES
// ============================================================================

export interface InteractionState {
  hoverPoint?: DataPoint;
  hoverSeries?: string;
  selection: DataPoint[];
  brushRange?: { x?: [number, number]; y?: [number, number] };
  zoomTransform?: { k: number; x: number; y: number };
}

export interface HitTestResult {
  point?: DataPoint;
  series?: string;
  distance: number;
  x: number;
  y: number;
}

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  point?: DataPoint;
  series?: SeriesData;
}

// ============================================================================
// LOD (LEVEL OF DETAIL) TYPES
// ============================================================================

export enum LODLevel {
  MINIMAL = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  FULL = 4,
}

export interface LODBucket {
  startTime: number;
  endTime: number;
  min: number;
  max: number;
  avg: number;
  count: number;
  outliers: TimeSeriesPoint[];
  representative: TimeSeriesPoint;
}

export interface LODResult {
  buckets: LODBucket[];
  totalPoints: number;
  sampledPoints: number;
  compressionRatio: number;
  level: LODLevel;
  outlierCount: number;
}

// ============================================================================
// RENDERER INTERFACE
// ============================================================================

export interface Renderer {
  readonly tier: RendererTier;
  readonly state: RendererState;

  initialize(container: HTMLElement, context: RenderContext): Promise<void>;
  render(data: SeriesData[], context: RenderContext): void;
  resize(width: number, height: number): void;
  destroy(): void;

  // Interaction methods
  hitTest(x: number, y: number, radius?: number): HitTestResult | null;
  getPointsInRegion(x1: number, y1: number, x2: number, y2: number): DataPoint[];

  // Metrics
  getMetrics(): FrameMetrics;
}

// ============================================================================
// ENGINE TYPES
// ============================================================================

export interface EngineState {
  currentTier: RendererTier;
  dataDensity: number;
  lodLevel: LODLevel;
  frameMetrics: FrameMetrics[];
  interactionMetrics: InteractionMetrics[];
  performanceViolations: number;
}

export interface TierSwitchEvent {
  from: RendererTier;
  to: RendererTier;
  reason: 'density' | 'performance' | 'manual' | 'fallback';
  timestamp: number;
  density: number;
  frameTime?: number;
}

export type EngineEventType = 'tierSwitch' | 'lodChange' | 'performanceViolation' | 'error';

export interface EngineEvent {
  type: EngineEventType;
  payload: TierSwitchEvent | LODResult | FrameMetrics | Error;
  timestamp: number;
}

export type EngineEventHandler = (event: EngineEvent) => void;
