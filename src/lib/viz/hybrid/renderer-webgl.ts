/**
 * WebGL Renderer (Tier 3)
 * Ultra-high-performance renderer for very large datasets
 * Uses Three.js for GPU-accelerated point/line rendering
 */

import * as THREE from 'three';
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
// WEBGL RENDERER CLASS
// ============================================================================

export class WebGLRenderer implements Renderer {
  readonly tier = RendererTier.WEBGL;

  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;

  private currentData: SeriesData[] = [];
  private currentContext: RenderContext | null = null;
  private isDestroyed = false;

  // Series meshes for hit testing
  private seriesMeshes: Map<string, THREE.Points[]> = new Map();

  private _state: RendererState = {
    tier: RendererTier.WEBGL,
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

    const { width, height } = context;

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(context.pixelRatio);
    this.renderer.setClearColor(0xffffff, 0); // Transparent background

    container.appendChild(this.renderer.domElement);

    // Create scene
    this.scene = new THREE.Scene();

    // Create orthographic camera for 2D charting
    const { margin } = context;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    this.camera = new THREE.OrthographicCamera(
      0, innerWidth, innerHeight, 0, 0.1, 1000
    );
    this.camera.position.z = 10;

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
    if (!this.renderer || !this.camera || !this.currentContext) return;

    this.currentContext = {
      ...this.currentContext,
      width,
      height,
    };

    const { margin } = this.currentContext;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Update renderer size
    this.renderer.setSize(width, height);

    // Update camera
    this.camera.left = 0;
    this.camera.right = innerWidth;
    this.camera.top = innerHeight;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();

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

    if (!this.renderer || !this.scene || !this.camera) {
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

    // Clear scene
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0];
      this.scene.remove(child);

      if (child instanceof THREE.Points || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    this.seriesMeshes.clear();

    // Render axes
    this.renderAxes(innerWidth, innerHeight);

    // Render data series
    this.renderSeries(data, xScale, yScale, innerWidth, innerHeight);

    // Render
    this.renderer.render(this.scene, this.camera);

    // Update frame metrics
    const endTime = performance.now();
    this._state.lastFrameTime = endTime - startTime;
    this.updateAverageFrameTime();
  }

  private renderAxes(width: number, height: number): void {
    if (!this.scene) return;

    // Create grid lines material
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.5,
    });

    // X axis grid
    const xGridGeometry = new THREE.BufferGeometry();
    const xGridPositions: number[] = [];

    for (let i = 0; i <= 5; i++) {
      const y = (height / 5) * i;
      xGridPositions.push(0, y, 0);
      xGridPositions.push(width, y, 0);
    }

    xGridGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(xGridPositions, 3)
    );
    const xGrid = new THREE.LineSegments(xGridGeometry, gridMaterial);
    this.scene.add(xGrid);

    // Y axis grid
    const yGridGeometry = new THREE.BufferGeometry();
    const yGridPositions: number[] = [];

    for (let i = 0; i <= 5; i++) {
      const x = (width / 5) * i;
      yGridPositions.push(x, 0, 0);
      yGridPositions.push(x, height, 0);
    }

    yGridGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(yGridPositions, 3)
    );
    const yGrid = new THREE.LineSegments(yGridGeometry, gridMaterial);
    this.scene.add(yGrid);

    // Border
    const borderGeometry = new THREE.BufferGeometry();
    const borderPositions = [
      0, 0, 0,
      width, 0, 0,
      width, height, 0,
      0, height, 0,
      0, 0, 0,
    ];

    borderGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(borderPositions, 3)
    );
    const borderMaterial = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
    const border = new THREE.Line(borderGeometry, borderMaterial);
    this.scene.add(border);
  }

  private renderSeries(
    data: SeriesData[],
    xScale: RenderContext['xScale'],
    yScale: RenderContext['yScale'],
    width: number,
    height: number
  ): void {
    if (!this.scene) return;

    for (const series of data) {
      if (!series.visible && series.visible !== undefined) continue;
      if (series.data.length === 0) continue;

      // Create line geometry
      const lineGeometry = new THREE.BufferGeometry();
      const linePositions: number[] = [];
      const lineColors: number[] = [];

      // Create point geometry for scatter
      const pointGeometry = new THREE.BufferGeometry();
      const pointPositions: number[] = [];
      const pointColors: number[] = [];

      const color = new THREE.Color(series.color);

      for (let i = 0; i < series.data.length; i++) {
        const point = series.data[i];
        const x = xScale(point.x as number);
        const y = height - yScale(point.y); // Flip Y for WebGL

        if (isNaN(x) || isNaN(y)) continue;

        // Add to line
        linePositions.push(x, y, 0);
        lineColors.push(color.r, color.g, color.b);

        // Add to points (for smaller datasets or every Nth point)
        if (series.data.length <= 1000 || i % 10 === 0) {
          pointPositions.push(x, y, 0);
          pointColors.push(color.r, color.g, color.b);
        }
      }

      // Create line mesh
      if (linePositions.length > 0) {
        lineGeometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(linePositions, 3)
        );
        lineGeometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(lineColors, 3)
        );

        const lineMaterial = new THREE.LineBasicMaterial({
          vertexColors: true,
          linewidth: 2,
        });

        const line = new THREE.Line(lineGeometry, lineMaterial);
        this.scene.add(line);
      }

      // Create points mesh
      if (pointPositions.length > 0) {
        pointGeometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(pointPositions, 3)
        );
        pointGeometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(pointColors, 3)
        );

        const pointMaterial = new THREE.PointsMaterial({
          size: 4,
          vertexColors: true,
          sizeAttenuation: false,
        });

        const points = new THREE.Points(pointGeometry, pointMaterial);
        this.scene.add(points);

        // Store for hit testing
        if (!this.seriesMeshes.has(series.id)) {
          this.seriesMeshes.set(series.id, []);
        }
        this.seriesMeshes.get(series.id)!.push(points);
      }
    }
  }

  // ============================================================================
  // INTERACTION
  // ============================================================================

  hitTest(x: number, y: number, radius: number = 10): HitTestResult | null {
    if (!this.currentContext || !this.camera || this.currentData.length === 0) {
      return null;
    }

    const { xScale, yScale, margin, height } = this.currentContext;

    // Convert screen coordinates to WebGL world coordinates
    const worldX = x - margin.left;
    const worldY = (height || 0) - (y - margin.top); // Flip Y

    // Find closest point
    let closest: HitTestResult | null = null;
    let minDistance = Infinity;

    for (const series of this.currentData) {
      if (!series.visible && series.visible !== undefined) continue;

      for (const point of series.data) {
        const px = xScale(point.x as number);
        const py = (height || 0) - yScale(point.y);

        const dx = px - worldX;
        const dy = py - worldY;
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

    const { xScale, yScale, margin, height } = this.currentContext;
    const minX = Math.min(x1, x2) - margin.left;
    const maxX = Math.max(x1, x2) - margin.left;
    const minY = Math.min(y1, y2) - margin.top;
    const maxY = Math.max(y1, y2) - margin.top;

    const points: DataPoint[] = [];

    for (const series of this.currentData) {
      if (!series.visible && series.visible !== undefined) continue;

      for (const point of series.data) {
        const px = xScale(point.x as number);
        // Flip Y for comparison
        const py = (height || 0) - yScale(point.y) - margin.top;

        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          points.push(point);
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

    // Dispose of Three.js resources
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }

    if (this.scene) {
      // Dispose all geometries and materials
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m.dispose());
          } else if (object.material) {
            object.material.dispose();
          }
        }
      });
    }

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.container = null;
    this.currentData = [];
    this.currentContext = null;
    this.seriesMeshes.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createWebGLRenderer(): WebGLRenderer {
  return new WebGLRenderer();
}
