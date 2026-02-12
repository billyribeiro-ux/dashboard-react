/**
 * Canvas 2D Renderer (Tier 2)
 * High-performance renderer for medium-density datasets
 * Uses native Canvas 2D API with D3 scales for layout
 */

import {
  RendererTier,
  type Renderer,
  type SeriesData,
  type RenderContext,
  type RendererState,
  type FrameMetrics,
  type HitTestResult,
  type DataPoint,
} from './types';

// ============================================================================
// CANVAS RENDERER CLASS
// ============================================================================

export class CanvasRenderer implements Renderer {
  readonly tier = RendererTier.CANVAS;

  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private currentData: SeriesData[] = [];
  private currentContext: RenderContext | null = null;
  private isDestroyed = false;

  // Spatial index for hit testing
  private spatialIndex: Map<string, DataPoint[]> = new Map();
  private hitTestRadius = 10;

  private _state: RendererState = {
    tier: RendererTier.CANVAS,
    isActive: false,
    isReady: false,
    lastFrameTime: 0,
    averageFrameTime: 0,
    droppedFrames: 0,
    pointCount: 0,
    memoryUsageMB: 0,
  };

  private resizeObserver: ResizeObserver | null = null;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async initialize(container: HTMLElement, context: RenderContext): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Renderer has been destroyed');
    }

    this.container = container;
    this.currentContext = context;

    // Clear container
    container.innerHTML = '';

    // Create canvas element
    const { width, height } = context;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * context.pixelRatio;
    this.canvas.height = height * context.pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.display = 'block';

    // Get 2D context
    const ctx = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    });

    if (!ctx) {
      throw new Error('Could not create Canvas 2D context');
    }

    this.ctx = ctx;
    this.ctx.scale(context.pixelRatio, context.pixelRatio);

    container.appendChild(this.canvas);

    // Set up resize observer
    this.setupResizeObserver();

    this._state.isReady = true;
    this._state.isActive = true;
  }

  private setupResizeObserver(): void {
    if (!this.container || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });

    this.resizeObserver.observe(this.container);
  }

  resize(width: number, height: number): void {
    if (!this.canvas || !this.ctx || !this.currentContext) return;

    this.currentContext = {
      ...this.currentContext,
      width,
      height,
    };

    // Resize canvas
    this.canvas.width = width * this.currentContext.pixelRatio;
    this.canvas.height = height * this.currentContext.pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Reset scale
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.currentContext.pixelRatio, this.currentContext.pixelRatio);

    // Re-render if we have data
    if (this.currentData.length > 0) {
      this.render(this.currentData, this.currentContext);
    }
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  render(data: SeriesData[], context: RenderContext): void {
    const startTime = performance.now();

    if (!this.ctx) {
      throw new Error('Renderer not initialized');
    }

    this.currentData = data;
    this.currentContext = context;

    const { width, height, margin, xScale, yScale } = context;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Update state
    const totalPoints = data.reduce((sum, s) => sum + s.data.length, 0);
    this._state.pointCount = totalPoints;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Save context
    this.ctx.save();

    // Apply margin transform
    this.ctx.translate(margin.left, margin.top);

    // Render axes
    this.renderAxes(xScale, yScale, innerWidth, innerHeight);

    // Build spatial index for hit testing
    this.buildSpatialIndex(data, xScale, yScale);

    // Render data series
    this.renderSeries(data, xScale, yScale, innerWidth, innerHeight);

    // Restore context
    this.ctx.restore();

    // Update frame metrics
    const endTime = performance.now();
    this._state.lastFrameTime = endTime - startTime;
    this.updateAverageFrameTime();
  }

  private renderAxes(
    xScale: RenderContext['xScale'],
    yScale: RenderContext['yScale'],
    width: number,
    height: number
  ): void {
    if (!this.ctx) return;

    const ctx = this.ctx;

    // Grid lines style
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;

    // Y axis grid lines
    const yTicks = yScale.ticks(5);
    ctx.beginPath();
    for (const tick of yTicks) {
      const y = yScale(tick);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // X axis grid lines
    const xTicks = xScale.ticks(5);
    ctx.beginPath();
    for (const tick of xTicks) {
      const x = xScale(tick as number);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    // Axis lines
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    // X axis
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // X labels
    for (const tick of xTicks) {
      const x = xScale(tick as number);
      const label = typeof tick === 'object' && tick instanceof Date
        ? tick.toLocaleDateString()
        : String(tick);
      ctx.fillText(label, x, height + 5);
    }

    // Y labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of yTicks) {
      const y = yScale(tick);
      ctx.fillText(String(tick), -5, y);
    }
  }

  private buildSpatialIndex(
    data: SeriesData[],
    xScale: RenderContext['xScale'],
    yScale: RenderContext['yScale']
  ): void {
    this.spatialIndex.clear();

    const cellSize = this.hitTestRadius * 2;

    for (const series of data) {
      if (!series.visible && series.visible !== undefined) continue;

      for (const point of series.data) {
        const x = xScale(point.x as number);
        const y = yScale(point.y);

        // Determine which cell this point belongs to
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        const cellKey = `${cellX},${cellY}`;

        if (!this.spatialIndex.has(cellKey)) {
          this.spatialIndex.set(cellKey, []);
        }
        this.spatialIndex.get(cellKey)!.push(point);
      }
    }
  }

  private renderSeries(
    data: SeriesData[],
    xScale: RenderContext['xScale'],
    yScale: RenderContext['yScale'],
    width: number,
    height: number
  ): void {
    if (!this.ctx) return;

    const ctx = this.ctx;

    for (const series of data) {
      if (!series.visible && series.visible !== undefined) continue;
      if (series.data.length === 0) continue;

      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw line path
      ctx.beginPath();

      let first = true;
      for (const point of series.data) {
        const x = xScale(point.x as number);
        const y = yScale(point.y);

        if (isNaN(y)) {
          first = true;
          continue;
        }

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      // Draw points for smaller datasets
      if (series.data.length <= 200) {
        ctx.fillStyle = series.color;

        for (const point of series.data) {
          const x = xScale(point.x as number);
          const y = yScale(point.y);

          if (isNaN(y)) continue;

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();

          // White border
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.strokeStyle = series.color;
          ctx.lineWidth = 2;
        }
      }
    }
  }

  // ============================================================================
  // INTERACTION
  // ============================================================================

  hitTest(x: number, y: number, radius: number = 10): HitTestResult | null {
    if (!this.currentContext || this.currentData.length === 0) {
      return null;
    }

    const { xScale, yScale, margin } = this.currentContext;

    // Convert to data coordinates
    const dataX = x - margin.left;
    const dataY = y - margin.top;

    // Use spatial index for efficient lookup
    const cellSize = this.hitTestRadius * 2;
    const cellX = Math.floor(dataX / cellSize);
    const cellY = Math.floor(dataY / cellSize);

    // Check neighboring cells
    let closest: HitTestResult | null = null;
    let minDistance = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cellKey = `${cellX + dx},${cellY + dy}`;
        const points = this.spatialIndex.get(cellKey);

        if (!points) continue;

        for (const point of points) {
          const px = xScale(point.x as number);
          const py = yScale(point.y);

          const distance = Math.sqrt((px - dataX) ** 2 + (py - dataY) ** 2);

          if (distance < radius && distance < minDistance) {
            minDistance = distance;

            // Find which series this point belongs to
            const series = this.currentData.find((s) =>
              s.data.some((p) => p.x === point.x && p.y === point.y)
            );

            closest = {
              point,
              series: series?.id,
              distance,
              x: px,
              y: py,
            };
          }
        }
      }
    }

    return closest;
  }

  getPointsInRegion(x1: number, y1: number, x2: number, y2: number): DataPoint[] {
    if (!this.currentContext) return [];

    const { xScale, yScale, margin } = this.currentContext;
    const minX = Math.min(x1, x2) - margin.left;
    const maxX = Math.max(x1, x2) - margin.left;
    const minY = Math.min(y1, y2) - margin.top;
    const maxY = Math.max(y1, y2) - margin.top;

    const points: DataPoint[] = [];

    // Use spatial index for efficient region query
    const cellSize = this.hitTestRadius * 2;
    const startCellX = Math.floor(minX / cellSize);
    const endCellX = Math.floor(maxX / cellSize);
    const startCellY = Math.floor(minY / cellSize);
    const endCellY = Math.floor(maxY / cellSize);

    for (let cx = startCellX; cx <= endCellX; cx++) {
      for (let cy = startCellY; cy <= endCellY; cy++) {
        const cellKey = `${cx},${cy}`;
        const cellPoints = this.spatialIndex.get(cellKey);

        if (!cellPoints) continue;

        for (const point of cellPoints) {
          const px = xScale(point.x as number);
          const py = yScale(point.y);

          if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
            points.push(point);
          }
        }
      }
    }

    return points;
  }

  // ============================================================================
  // STATE & METRICS
  // ============================================================================

  get state(): RendererState {
    return { ...this._state };
  }

  getMetrics(): FrameMetrics {
    return {
      timestamp: performance.now(),
      frameTime: this._state.lastFrameTime,
      renderTime: this._state.lastFrameTime,
      pointCount: this._state.pointCount,
      tier: this.tier,
      dropped: this._state.lastFrameTime > 33.33,
    };
  }

  private updateAverageFrameTime(): void {
    const alpha = 0.1;
    this._state.averageFrameTime =
      alpha * this._state.lastFrameTime + (1 - alpha) * this._state.averageFrameTime;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  destroy(): void {
    this.isDestroyed = true;
    this._state.isActive = false;
    this._state.isReady = false;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.currentData = [];
    this.currentContext = null;
    this.spatialIndex.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createCanvasRenderer(): CanvasRenderer {
  return new CanvasRenderer();
}
