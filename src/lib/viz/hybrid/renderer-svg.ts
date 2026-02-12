/**
 * SVG Renderer (Tier 1)
 * Baseline renderer for small/medium datasets
 * Full D3 compatibility with complete interaction support
 */

import { select, Selection } from 'd3-selection';
import { line, curveMonotoneX } from 'd3-shape';
import { axisBottom, axisLeft } from 'd3-axis';
import { ZoomTransform, zoomIdentity } from 'd3-zoom';
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
// SVG RENDERER CLASS
// ============================================================================

export class SVGRenderer implements Renderer {
  readonly tier = RendererTier.SVG;

  private container: HTMLElement | null = null;
  private svg: Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private mainGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private dataGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private axisGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private overlayGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;

  private currentData: SeriesData[] = [];
  private currentContext: RenderContext | null = null;
  private transform: ZoomTransform = zoomIdentity;
  private isDestroyed = false;

  // Internal state - use _state to avoid conflict with getter
  private _state: RendererState = {
    tier: RendererTier.SVG,
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

    // Create SVG element
    const { width, height, margin } = context;

    this.svg = select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('display', 'block');

    // Create main group with margin
    this.mainGroup = this.svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create layer groups
    this.dataGroup = this.mainGroup.append('g').attr('class', 'data-layer');
    this.axisGroup = this.mainGroup.append('g').attr('class', 'axis-layer');
    this.overlayGroup = this.mainGroup.append('g').attr('class', 'overlay-layer');

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
    if (!this.svg || !this.currentContext) return;

    this.currentContext = {
      ...this.currentContext,
      width,
      height,
    };

    this.svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

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

    if (!this.svg || !this.mainGroup) {
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

    // Clear previous content
    this.dataGroup?.selectAll('*').remove();
    this.axisGroup?.selectAll('*').remove();

    // Render axes
    this.renderAxes(xScale, yScale, innerWidth, innerHeight);

    // Render data series
    this.renderSeries(data, xScale, yScale, innerWidth, innerHeight);

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
    if (!this.axisGroup) return;

    // X axis
    const xAxis = axisBottom(xScale).tickSizeOuter(0);
    this.axisGroup
      .append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis as unknown as (selection: Selection<SVGGElement, unknown, null, undefined>) => void)
      .attr('class', 'x-axis');

    // Y axis
    const yAxis = axisLeft(yScale).tickSizeOuter(0);
    this.axisGroup.append('g').call(yAxis as unknown as (selection: Selection<SVGGElement, unknown, null, undefined>) => void).attr('class', 'y-axis');

    // Style axes
    this.axisGroup
      .selectAll('.domain')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1);
    this.axisGroup
      .selectAll('.tick line')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 0.5);
    this.axisGroup
      .selectAll('.tick text')
      .attr('fill', '#64748b')
      .attr('font-size', '11px');
  }

  private renderSeries(
    data: SeriesData[],
    xScale: RenderContext['xScale'],
    yScale: RenderContext['yScale'],
    _width: number,
    _height: number
  ): void {
    if (!this.dataGroup) return;

    // Create line generator
    const lineGenerator = line<DataPoint>()
      .x((d) => xScale(d.x as number))
      .y((d) => yScale(d.y))
      .curve(curveMonotoneX)
      .defined((d) => !isNaN(d.y));

    // Render each series
    data.forEach((series) => {
      if (!series.visible && series.visible !== undefined) return;

      const seriesGroup = this.dataGroup!
        .append('g')
        .attr('class', `series-${series.id}`)
        .attr('data-series-id', series.id);

      // Render line path
      seriesGroup
        .append('path')
        .datum(series.data)
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('d', lineGenerator as (data: DataPoint[]) => string)
        .attr('class', 'series-line');

      // Render points for smaller datasets
      if (series.data.length <= 500) {
        seriesGroup
          .selectAll('.data-point')
          .data(series.data)
          .enter()
          .append('circle')
          .attr('class', 'data-point')
          .attr('cx', (d) => xScale(d.x as number))
          .attr('cy', (d) => yScale(d.y))
          .attr('r', 3)
          .attr('fill', series.color)
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1)
          .attr('opacity', 0.8);
      }
    });
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

    // Find closest point
    let closest: HitTestResult | null = null;
    let minDistance = Infinity;

    for (const series of this.currentData) {
      if (!series.visible && series.visible !== undefined) continue;

      for (const point of series.data) {
        const px = xScale(point.x as number);
        const py = yScale(point.y);

        const dx = px - dataX;
        const dy = py - dataY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < radius && distance < minDistance) {
          minDistance = distance;
          closest = {
            point,
            series: series.id,
            distance,
            x: px,
            y: py,
          };
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

    for (const series of this.currentData) {
      if (!series.visible && series.visible !== undefined) continue;

      for (const point of series.data) {
        const px = xScale(point.x as number);
        const py = yScale(point.y);

        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          points.push(point);
        }
      }
    }

    return points;
  }

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

    if (this.svg) {
      this.svg.remove();
      this.svg = null;
    }

    this.mainGroup = null;
    this.dataGroup = null;
    this.axisGroup = null;
    this.overlayGroup = null;
    this.container = null;
    this.currentData = [];
    this.currentContext = null;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSVGRenderer(): SVGRenderer {
  return new SVGRenderer();
}
