/**
 * Interaction Bridge
 * Shared interaction logic across all renderer tiers
 * Ensures consistent hover, brush, zoom, and selection behavior
 */

import type {
  Renderer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  RendererTier,
  DataPoint,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SeriesData,
  HitTestResult,
  InteractionState,
  TooltipState,
  RenderContext,
} from './types';

// ============================================================================
// INTERACTION BRIDGE CONFIGURATION
// ============================================================================

export interface InteractionBridgeConfig {
  // Hit testing
  hoverRadius: number;
  selectionRadius: number;

  // Debouncing
  hoverDebounceMs: number;
  zoomDebounceMs: number;

  // Double-click threshold
  doubleClickThresholdMs: number;

  // Keyboard
  enableKeyboardNavigation: boolean;
  keyboardStepSize: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionBridgeConfig = {
  hoverRadius: 10,
  selectionRadius: 15,
  hoverDebounceMs: 16, // One frame at 60fps
  zoomDebounceMs: 50,
  doubleClickThresholdMs: 300,
  enableKeyboardNavigation: true,
  keyboardStepSize: 10,
};

// ============================================================================
// INTERACTION BRIDGE CLASS
// ============================================================================

export class InteractionBridge {
  private config: InteractionBridgeConfig;
  private renderer: Renderer | null = null;
  private container: HTMLElement | null = null;
  private context: RenderContext | null = null;

  private state: InteractionState = {
    selection: [],
  };

  private tooltip: TooltipState = {
    visible: false,
    x: 0,
    y: 0,
  };

  // Event handlers
  private mouseMoveHandler: (e: MouseEvent) => void;
  private mouseLeaveHandler: (e: MouseEvent) => void;
  private clickHandler: (e: MouseEvent) => void;
  private dblClickHandler: (e: MouseEvent) => void;
  private keyDownHandler: (e: KeyboardEvent) => void;
  private wheelHandler: (e: WheelEvent) => void;

  // Debounce timers
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks
  private onHoverCallback?: (result: HitTestResult | null, x: number, y: number) => void;
  private onClickCallback?: (result: HitTestResult | null, x: number, y: number) => void;
  private onSelectionCallback?: (points: DataPoint[], region: { x1: number; y1: number; x2: number; y2: number }) => void;
  private onZoomCallback?: (transform: { k: number; x: number; y: number }) => void;
  private onTooltipCallback?: (tooltip: TooltipState) => void;

  // Brushing state
  private isBrushing = false;
  private brushStart: { x: number; y: number } | null = null;
  private brushCurrent: { x: number; y: number } | null = null;

  // Click tracking for double-click
  private lastClick: { time: number; x: number; y: number } | null = null;

  constructor(config?: Partial<InteractionBridgeConfig>) {
    this.config = { ...DEFAULT_INTERACTION_CONFIG, ...config };

    // Bind handlers
    this.mouseMoveHandler = this.handleMouseMove.bind(this);
    this.mouseLeaveHandler = this.handleMouseLeave.bind(this);
    this.clickHandler = this.handleClick.bind(this);
    this.dblClickHandler = this.handleDoubleClick.bind(this);
    this.keyDownHandler = this.handleKeyDown.bind(this);
    this.wheelHandler = this.handleWheel.bind(this);
  }

  // ============================================================================
  // ATTACH/DETACH
  // ============================================================================

  attach(
    container: HTMLElement,
    renderer: Renderer,
    context: RenderContext
  ): void {
    this.detach(); // Clean up any existing

    this.container = container;
    this.renderer = renderer;
    this.context = context;

    // Attach event listeners
    container.addEventListener('mousemove', this.mouseMoveHandler);
    container.addEventListener('mouseleave', this.mouseLeaveHandler);
    container.addEventListener('click', this.clickHandler);
    container.addEventListener('dblclick', this.dblClickHandler);
    container.addEventListener('wheel', this.wheelHandler, { passive: false });
    container.addEventListener('keydown', this.keyDownHandler);

    // Make container focusable for keyboard
    container.tabIndex = 0;
    container.style.outline = 'none';
  }

  detach(): void {
    if (this.container) {
      this.container.removeEventListener('mousemove', this.mouseMoveHandler);
      this.container.removeEventListener('mouseleave', this.mouseLeaveHandler);
      this.container.removeEventListener('click', this.clickHandler);
      this.container.removeEventListener('dblclick', this.dblClickHandler);
      this.container.removeEventListener('wheel', this.wheelHandler);
      this.container.removeEventListener('keydown', this.keyDownHandler);

      this.container.tabIndex = -1;
    }

    this.clearTimers();
    this.container = null;
    this.renderer = null;
    this.context = null;
  }

  private clearTimers(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.zoomTimer) {
      clearTimeout(this.zoomTimer);
      this.zoomTimer = null;
    }
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  private handleMouseMove(e: MouseEvent): void {
    if (!this.container || !this.renderer) return;

    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Handle brushing
    if (this.isBrushing && this.brushStart) {
      this.brushCurrent = { x, y };
      this.updateBrushOverlay();
      return;
    }

    // Debounced hover
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
    }

    this.hoverTimer = setTimeout(() => {
      this.performHitTest(x, y);
    }, this.config.hoverDebounceMs);
  }

  private handleMouseLeave(): void {
    this.clearHover();
  }

  private handleClick(e: MouseEvent): void {
    if (!this.container || !this.renderer) return;

    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = Date.now();

    // Check for double-click
    if (
      this.lastClick &&
      now - this.lastClick.time < this.config.doubleClickThresholdMs &&
      Math.abs(x - this.lastClick.x) < 5 &&
      Math.abs(y - this.lastClick.y) < 5
    ) {
      // This is a double-click, let dblclick handler handle it
      return;
    }

    this.lastClick = { time: now, x, y };

    // Perform hit test
    const result = this.renderer.hitTest(x, y, this.config.selectionRadius);

    if (result) {
      // Toggle selection
      const existingIndex = this.state.selection.findIndex(
        (p) => p.x === result.point!.x && p.y === result.point!.y
      );

      if (existingIndex >= 0) {
        this.state.selection.splice(existingIndex, 1);
      } else {
        this.state.selection.push(result.point!);
      }
    }

    this.onClickCallback?.(result, x, y);
  }

  private handleDoubleClick(e: MouseEvent): void {
    if (!this.container || !this.renderer) return;

    const rect = this.container.getBoundingClientRect();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _x = e.clientX - rect.left;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _y = e.clientY - rect.top;

    // Reset zoom on double-click
    this.onZoomCallback?.({ k: 1, x: 0, y: 0 });

    // Clear the last click to prevent single-click handling
    this.lastClick = null;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    if (!this.container || !this.renderer) return;

    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

    if (this.zoomTimer) {
      clearTimeout(this.zoomTimer);
    }

    this.zoomTimer = setTimeout(() => {
      this.onZoomCallback?.({ k: zoomFactor, x, y });
    }, this.config.zoomDebounceMs);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.config.enableKeyboardNavigation) return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.navigateByKeyboard(e.key);
        break;
      case 'Escape':
        this.clearSelection();
        break;
      case 'Enter':
        if (this.state.hoverPoint) {
          this.handleEnterOnHover();
        }
        break;
    }
  }

  // ============================================================================
  // HIT TESTING
  // ============================================================================

  private performHitTest(x: number, y: number): void {
    if (!this.renderer) return;

    const result = this.renderer.hitTest(x, y, this.config.hoverRadius);

    this.state.hoverPoint = result?.point;
    this.state.hoverSeries = result?.series;

    // Update tooltip
    this.tooltip = {
      visible: !!result,
      x,
      y,
      point: result?.point,
    };

    this.onTooltipCallback?.(this.tooltip);
    this.onHoverCallback?.(result, x, y);

    // Update cursor
    if (this.container) {
      this.container.style.cursor = result ? 'pointer' : 'default';
    }
  }

  private clearHover(): void {
    this.state.hoverPoint = undefined;
    this.state.hoverSeries = undefined;

    this.tooltip = {
      visible: false,
      x: 0,
      y: 0,
    };

    this.onTooltipCallback?.(this.tooltip);
    this.onHoverCallback?.(null, 0, 0);

    if (this.container) {
      this.container.style.cursor = 'default';
    }
  }

  // ============================================================================
  // BRUSHING
  // ============================================================================

  startBrush(x: number, y: number): void {
    this.isBrushing = true;
    this.brushStart = { x, y };
    this.brushCurrent = { x, y };
  }

  updateBrush(x: number, y: number): void {
    if (!this.isBrushing) return;
    this.brushCurrent = { x, y };
    this.updateBrushOverlay();
  }

  endBrush(): DataPoint[] {
    if (!this.isBrushing || !this.brushStart || !this.brushCurrent || !this.renderer) {
      this.isBrushing = false;
      this.brushStart = null;
      this.brushCurrent = null;
      this.hideBrushOverlay();
      return [];
    }

    const points = this.renderer.getPointsInRegion(
      this.brushStart.x,
      this.brushStart.y,
      this.brushCurrent.x,
      this.brushCurrent.y
    );

    this.state.selection = points;
    this.onSelectionCallback?.(points, {
      x1: this.brushStart.x,
      y1: this.brushStart.y,
      x2: this.brushCurrent.x,
      y2: this.brushCurrent.y,
    });

    this.isBrushing = false;
    this.brushStart = null;
    this.brushCurrent = null;
    this.hideBrushOverlay();

    return points;
  }

  private updateBrushOverlay(): void {
    // In a real implementation, this would render a brush rectangle
    // For now, we just track the state
  }

  private hideBrushOverlay(): void {
    // Hide brush overlay
  }

  // ============================================================================
  // KEYBOARD NAVIGATION
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private navigateByKeyboard(_direction: string): void {
    // In a real implementation, this would navigate between data points
    // For now, it's a placeholder
  }

  private handleEnterOnHover(): void {
    if (this.state.hoverPoint) {
      // Add to selection
      const existingIndex = this.state.selection.findIndex(
        (p) => p.x === this.state.hoverPoint!.x && p.y === this.state.hoverPoint!.y
      );

      if (existingIndex < 0) {
        this.state.selection.push(this.state.hoverPoint);
      }
    }
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  clearSelection(): void {
    this.state.selection = [];
    this.onSelectionCallback?.([], { x1: 0, y1: 0, x2: 0, y2: 0 });
  }

  getSelection(): DataPoint[] {
    return [...this.state.selection];
  }

  setSelection(points: DataPoint[]): void {
    this.state.selection = [...points];
  }

  getHoverState(): { point?: DataPoint; series?: string } {
    return {
      point: this.state.hoverPoint,
      series: this.state.hoverSeries,
    };
  }

  // ============================================================================
  // CALLBACKS
  // ============================================================================

  onHover(callback: (result: HitTestResult | null, x: number, y: number) => void): void {
    this.onHoverCallback = callback;
  }

  onClick(callback: (result: HitTestResult | null, x: number, y: number) => void): void {
    this.onClickCallback = callback;
  }

  onSelection(
    callback: (points: DataPoint[], region: { x1: number; y1: number; x2: number; y2: number }) => void
  ): void {
    this.onSelectionCallback = callback;
  }

  onZoom(callback: (transform: { k: number; x: number; y: number }) => void): void {
    this.onZoomCallback = callback;
  }

  onTooltip(callback: (tooltip: TooltipState) => void): void {
    this.onTooltipCallback = callback;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  destroy(): void {
    this.detach();
    this.onHoverCallback = undefined;
    this.onClickCallback = undefined;
    this.onSelectionCallback = undefined;
    this.onZoomCallback = undefined;
    this.onTooltipCallback = undefined;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createInteractionBridge(
  config?: Partial<InteractionBridgeConfig>
): InteractionBridge {
  return new InteractionBridge(config);
}
