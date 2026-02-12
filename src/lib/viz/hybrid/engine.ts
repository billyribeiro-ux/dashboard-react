/**
 * Hybrid Rendering Engine
 * Core engine that manages renderer lifecycle, tier switching, and performance monitoring
 */

import {
  RendererTier,
  type Renderer,
  type SeriesData,
  type RenderContext,
  type EngineState,
  type EngineEvent,
  type EngineEventHandler,
  type TierSwitchEvent,
  type HybridRendererConfig,
  type FrameMetrics,
} from './types';
import { DEFAULT_THRESHOLDS } from './thresholds';
import {
  getTierRecommendation,
  recordPerformance,
  shouldDegradeTier,
  isTierAvailable,
  getFallbackTier,
} from './detection';

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_CONFIG: HybridRendererConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  performanceBudgets: {
    targetFrameTime: 16.67, // 60 FPS
    maxFrameTime: 33.33, // 30 FPS
    targetFPS: 60,
    minAcceptableFPS: 30,
    maxHoverLatency: 16,
    maxBrushLatency: 50,
    maxZoomLatency: 100,
    maxGPUMemoryMB: 512,
    maxJSMemoryMB: 256,
    autoDegrade: true,
    degradeFrameThreshold: 10,
  },
  lodPolicy: {
    temporalBucketing: true,
    minMaxEnvelope: true,
    outlierPreservation: true,
    zoomRefinement: true,
    minZoomDetailLevel: 0,
    maxZoomDetailLevel: 4,
    targetPixelsPerPoint: 3,
    minPixelsPerPoint: 1,
    outlierThreshold: 3,
    outlierDetectionMethod: 'zscore',
  },
  svg: {
    antialias: true,
    shapeRendering: 'auto',
    maxElements: 10000,
  },
  canvas: {
    antialias: true,
    alpha: true,
    desynchronized: true,
    imageSmoothingEnabled: true,
    devicePixelRatio: 1,
  },
  webgl: {
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
    maxBufferSize: 16777216, // 16MB
    instancedRendering: true,
  },
  accessibility: {
    enableTableFallback: true,
    enableKeyboardNavigation: true,
    enableScreenReaderAnnouncements: true,
    reducedMotion: 'auto',
    enablePatterns: true,
    enableShapeVariation: true,
    focusVisible: true,
    tabIndex: 0,
  },
  debug: {
    enableDebugPanel: false,
    showRendererTier: true,
    showFPS: true,
    showFrameTime: true,
    showPointCount: true,
    showDroppedFrames: true,
    logRendererSwitches: true,
    logLODDecisions: false,
    logInteractionMetrics: false,
  },
};

// ============================================================================
// ENGINE CLASS
// ============================================================================

export class HybridEngine {
  private config: HybridRendererConfig;
  private state: EngineState;
  private renderers: Map<RendererTier, Renderer> = new Map();
  private currentRenderer: Renderer | null = null;
  private eventHandlers: Set<EngineEventHandler> = new Set();
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private frameCount = 0;
  private droppedFrames = 0;
  private isDestroyed = false;

  // Performance tracking
  private frameMetrics: FrameMetrics[] = [];
  private readonly maxFrameMetrics = 60;

  constructor(config?: Partial<HybridRendererConfig>) {
    this.config = this.mergeConfig(config);
    this.state = this.createInitialState();
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  private mergeConfig(
    override?: Partial<HybridRendererConfig>
  ): HybridRendererConfig {
    return {
      ...DEFAULT_CONFIG,
      ...override,
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...override?.thresholds },
      performanceBudgets: {
        ...DEFAULT_CONFIG.performanceBudgets,
        ...override?.performanceBudgets,
      },
      lodPolicy: { ...DEFAULT_CONFIG.lodPolicy, ...override?.lodPolicy },
      svg: { ...DEFAULT_CONFIG.svg, ...override?.svg },
      canvas: { ...DEFAULT_CONFIG.canvas, ...override?.canvas },
      webgl: { ...DEFAULT_CONFIG.webgl, ...override?.webgl },
      accessibility: { ...DEFAULT_CONFIG.accessibility, ...override?.accessibility },
      debug: { ...DEFAULT_CONFIG.debug, ...override?.debug },
    };
  }

  private createInitialState(): EngineState {
    return {
      currentTier: RendererTier.SVG,
      dataDensity: 0,
      lodLevel: 4, // FULL
      frameMetrics: [],
      interactionMetrics: [],
      performanceViolations: 0,
    };
  }

  public getConfig(): HybridRendererConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<HybridRendererConfig>): void {
    this.config = this.mergeConfig(updates);

    // Re-evaluate tier if thresholds changed
    if (updates.thresholds) {
      this.evaluateTierChange();
    }
  }

  // ============================================================================
  // RENDERER MANAGEMENT
  // ============================================================================

  public registerRenderer(tier: RendererTier, renderer: Renderer): void {
    this.renderers.set(tier, renderer);

    // If this is the first renderer and no current renderer, set it
    if (!this.currentRenderer && tier === this.state.currentTier) {
      this.currentRenderer = renderer;
    }
  }

  public unregisterRenderer(tier: RendererTier): void {
    const renderer = this.renderers.get(tier);
    if (renderer) {
      renderer.destroy();
      this.renderers.delete(tier);

      if (this.currentRenderer === renderer) {
        this.currentRenderer = null;
        // Switch to fallback
        this.switchToFallbackTier();
      }
    }
  }

  public getCurrentRenderer(): Renderer | null {
    return this.currentRenderer;
  }

  public getCurrentTier(): RendererTier {
    return this.state.currentTier;
  }

  // ============================================================================
  // TIER SWITCHING
  // ============================================================================

  /**
   * Evaluate if we should switch to a different renderer tier
   */
  public evaluateTierChange(data?: SeriesData[], width?: number, height?: number): TierSwitchEvent | null {
    // Check if we have a forced renderer
    if (this.config.thresholds.forceRenderer) {
      const forcedTier = this.config.thresholds.forceRenderer as RendererTier;
      if (forcedTier !== this.state.currentTier && isTierAvailable(forcedTier)) {
        return this.switchTier(forcedTier, 'manual');
      }
      return null;
    }

    // Get recommendation based on density
    if (data && width && height) {
      const recommendation = getTierRecommendation(
        data,
        width,
        height,
        this.config.thresholds
      );

      if (recommendation.recommended !== this.state.currentTier) {
        return this.switchTier(recommendation.recommended, recommendation.reason);
      }
    }

    // Check for performance-based degradation
    if (this.config.performanceBudgets.autoDegrade) {
      const degraded = shouldDegradeTier(
        this.state.currentTier,
        this.config.performanceBudgets.targetFrameTime,
        this.config.performanceBudgets.degradeFrameThreshold
      );

      if (degraded) {
        return this.switchTier(degraded, 'performance');
      }
    }

    return null;
  }

  /**
   * Force switch to a specific tier
   */
  public forceSwitchTier(tier: RendererTier): TierSwitchEvent | null {
    if (!isTierAvailable(tier)) {
      const fallback = getFallbackTier(tier);
      return this.switchTier(fallback, 'fallback');
    }

    return this.switchTier(tier, 'manual');
  }

  private switchTier(
    newTier: RendererTier,
    reason: TierSwitchEvent['reason']
  ): TierSwitchEvent | null {
    if (newTier === this.state.currentTier) {
      return null;
    }

    const newRenderer = this.renderers.get(newTier);
    if (!newRenderer) {
      console.warn(`Renderer for tier ${newTier} not registered`);
      return null;
    }

    const event: TierSwitchEvent = {
      from: this.state.currentTier,
      to: newTier,
      reason,
      timestamp: performance.now(),
      density: this.state.dataDensity,
      frameTime: this.getAverageFrameTime(),
    };

    // Update state
    const oldTier = this.state.currentTier;
    this.state.currentTier = newTier;
    this.currentRenderer = newRenderer;

    // Emit event
    this.emitEvent({
      type: 'tierSwitch',
      payload: event,
      timestamp: performance.now(),
    });

    // Log if debug enabled
    if (this.config.debug.logRendererSwitches) {
      console.log(
        `[HybridEngine] Switched from ${oldTier} to ${newTier} (reason: ${reason})`
      );
    }

    return event;
  }

  private switchToFallbackTier(): void {
    const fallback = getFallbackTier(this.state.currentTier);
    this.switchTier(fallback, 'fallback');
  }

  // ============================================================================
  // RENDER LOOP
  // ============================================================================

  public render(data: SeriesData[], context: RenderContext): void {
    if (this.isDestroyed) return;

    const startTime = performance.now();

    // Evaluate tier before rendering if data changed significantly
    if (this.shouldReevaluateTier(data)) {
      this.evaluateTierChange(data, context.width, context.height);
    }

    // Ensure we have a renderer
    if (!this.currentRenderer) {
      this.switchToFallbackTier();
    }

    if (!this.currentRenderer) {
      console.error('[HybridEngine] No renderer available');
      return;
    }

    // Perform render
    this.currentRenderer.render(data, context);

    // Track performance
    const endTime = performance.now();
    const frameTime = endTime - startTime;

    this.recordFrameMetrics(frameTime, data);
  }

  private shouldReevaluateTier(data: SeriesData[]): boolean {
    // Re-evaluate every 30 frames or if point count changed significantly
    this.frameCount++;
    if (this.frameCount % 30 === 0) {
      const totalPoints = data.reduce((sum, s) => sum + s.data.length, 0);
      const densityChanged = Math.abs(totalPoints - this.state.dataDensity) > 1000;
      return densityChanged;
    }
    return false;
  }

  private recordFrameMetrics(frameTime: number, data: SeriesData[]): void {
    const totalPoints = data.reduce((sum, s) => sum + s.data.length, 0);
    const dropped = frameTime > this.config.performanceBudgets.maxFrameTime;

    if (dropped) {
      this.droppedFrames++;
    }

    const metric: FrameMetrics = {
      timestamp: performance.now(),
      frameTime,
      renderTime: frameTime,
      pointCount: totalPoints,
      tier: this.state.currentTier,
      dropped,
    };

    this.frameMetrics.push(metric);
    if (this.frameMetrics.length > this.maxFrameMetrics) {
      this.frameMetrics.shift();
    }

    this.state.dataDensity = totalPoints;

    // Record in detection module for performance monitoring
    recordPerformance({
      timestamp: metric.timestamp,
      frameTime,
      fps: 1000 / frameTime,
      droppedFrames: this.droppedFrames,
      tier: this.state.currentTier,
    });

    // Check for performance violations
    if (frameTime > this.config.performanceBudgets.maxFrameTime) {
      this.state.performanceViolations++;

      if (this.state.performanceViolations >= this.config.performanceBudgets.degradeFrameThreshold) {
        this.emitEvent({
          type: 'performanceViolation',
          payload: metric,
          timestamp: performance.now(),
        });
      }
    }
  }

  // ============================================================================
  // PERFORMANCE METRICS
  // ============================================================================

  public getAverageFrameTime(windowMs: number = 1000): number {
    const now = performance.now();
    const windowStart = now - windowMs;

    const recent = this.frameMetrics.filter((m) => m.timestamp >= windowStart);
    if (recent.length === 0) return 0;

    const sum = recent.reduce((acc, m) => acc + m.frameTime, 0);
    return sum / recent.length;
  }

  public getCurrentFPS(): number {
    const avgFrameTime = this.getAverageFrameTime();
    if (avgFrameTime === 0) return 0;
    return Math.round(1000 / avgFrameTime);
  }

  public getDroppedFrames(): number {
    return this.droppedFrames;
  }

  public getState(): EngineState {
    return { ...this.state };
  }

  public getFrameMetrics(): FrameMetrics[] {
    return [...this.frameMetrics];
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  public onEvent(handler: EngineEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  private emitEvent(event: EngineEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('[HybridEngine] Event handler error:', error);
      }
    });
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  public destroy(): void {
    this.isDestroyed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Destroy all renderers
    this.renderers.forEach((renderer) => {
      try {
        renderer.destroy();
      } catch (error) {
        console.error('[HybridEngine] Error destroying renderer:', error);
      }
    });
    this.renderers.clear();
    this.currentRenderer = null;
    this.eventHandlers.clear();
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createHybridEngine(
  config?: Partial<HybridRendererConfig>
): HybridEngine {
  return new HybridEngine(config);
}
