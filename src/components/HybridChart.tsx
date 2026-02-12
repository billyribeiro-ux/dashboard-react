'use client';

/**
 * Hybrid Chart Component
 * A React component that uses the hybrid rendering system
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { scaleLinear, scaleTime } from 'd3-scale';
import { extent } from 'd3-array';
import {
  HybridEngine,
  RendererTier,
  type SeriesData,
  type RenderContext,
  type HybridRendererConfig,
  createSVGRenderer,
  createCanvasRenderer,
  createWebGLRenderer,
  createInteractionBridge,
  InteractionBridge,
  generateDataSummary,
  generateTextSummary,
  type HitTestResult,
} from '@/lib/viz/hybrid';
import { DebugPanel } from '@/lib/viz/hybrid/debug-panel';

interface HybridChartProps {
  data: SeriesData[];
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  config?: Partial<HybridRendererConfig>;
  showDebug?: boolean;
  onHover?: (result: HitTestResult | null) => void;
  onClick?: (result: HitTestResult | null) => void;
  className?: string;
}

export const HybridChart: React.FC<HybridChartProps> = ({
  data,
  width = 800,
  height = 400,
  margin = { top: 20, right: 30, bottom: 40, left: 50 },
  config,
  showDebug = false,
  onHover,
  onClick,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HybridEngine | null>(null);
  const bridgeRef = useRef<InteractionBridge | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [activeTier, setActiveTier] = useState<RendererTier>(RendererTier.SVG);
  const [summary, setSummary] = useState<string>('');
  const [engineForDebug, setEngineForDebug] = useState<HybridEngine | null>(null);

  const calculateScales = useCallback(() => {
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const allX = data.flatMap((s) => s.data.map((d) => d.x));
    const allY = data.flatMap((s) => s.data.map((d) => d.y));
    const isTimeSeries = allX[0] instanceof Date;

    let xScale: RenderContext['xScale'];
    if (isTimeSeries) {
      const [xMin, xMax] = extent(allX as Date[]) as [Date, Date];
      xScale = scaleTime().domain([xMin, xMax]).range([0, innerWidth]);
    } else {
      const [xMin, xMax] = extent(allX as number[]) as [number, number];
      xScale = scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
    }

    const [yMin, yMax] = extent(allY) as [number, number];
    const yScale = scaleLinear().domain([yMin, yMax]).range([innerHeight, 0]);

    return { xScale, yScale, innerWidth, innerHeight };
  }, [data, width, height, margin]);

  // Initialize engine and renderers
  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new HybridEngine({
      debug: {
        enableDebugPanel: showDebug,
        showRendererTier: true,
        showFPS: true,
        showFrameTime: true,
        showPointCount: true,
        showDroppedFrames: true,
        logRendererSwitches: true,
        logLODDecisions: false,
        logInteractionMetrics: false,
      },
      ...config,
    });

    const svgRenderer = createSVGRenderer();
    const canvasRenderer = createCanvasRenderer();
    const webglRenderer = createWebGLRenderer();

    engine.registerRenderer(RendererTier.SVG, svgRenderer);
    engine.registerRenderer(RendererTier.CANVAS, canvasRenderer);
    engine.registerRenderer(RendererTier.WEBGL, webglRenderer);

    const { xScale, yScale } = calculateScales();
    const context: RenderContext = {
      width,
      height,
      margin,
      xScale,
      yScale,
      pixelRatio: window.devicePixelRatio || 1,
    };

    const tier = engine.getCurrentTier();
    const renderer = engine.getCurrentRenderer();

    if (renderer) {
      renderer.initialize(containerRef.current, context)
        .then(() => {
          setIsInitialized(true);
          setActiveTier(tier);

          const bridge = createInteractionBridge();
          bridge.attach(containerRef.current!, renderer, context);
          bridge.onHover((result) => onHover?.(result));
          bridge.onClick((result) => onClick?.(result));
          bridgeRef.current = bridge;
        })
        .catch((err) => console.error('Failed to initialize renderer:', err));
    }

    engine.onEvent((event) => {
      if (event.type === 'tierSwitch') {
        setActiveTier(engine.getCurrentTier());
      }
    });

    engineRef.current = engine;
    setEngineForDebug(engine);

    const dataSummary = generateDataSummary(data);
    setSummary(generateTextSummary(dataSummary));

    return () => {
      engine.destroy();
      bridgeRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render data when it changes
  useEffect(() => {
    if (!engineRef.current || !isInitialized) return;

    const engine = engineRef.current;
    const { xScale, yScale } = calculateScales();

    const context: RenderContext = {
      width,
      height,
      margin,
      xScale,
      yScale,
      pixelRatio: window.devicePixelRatio || 1,
    };

    engine.evaluateTierChange(data, width, height);
    engine.render(data, context);

    if (bridgeRef.current) {
      bridgeRef.current.detach();
      const renderer = engine.getCurrentRenderer();
      if (renderer && containerRef.current) {
        bridgeRef.current.attach(containerRef.current, renderer, context);
      }
    }
  }, [data, width, height, margin, isInitialized, calculateScales]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        style={{ width, height }}
        className="border border-slate-200 rounded-lg bg-white"
        role="img"
        aria-label="Data visualization chart"
        tabIndex={0}
      />

      <div id="chart-summary" className="sr-only">
        {summary}
      </div>

      {showDebug && engineForDebug && (
        <div className="absolute top-2 right-2 z-10">
          <DebugPanel engine={engineForDebug} />
        </div>
      )}

      <div className="absolute bottom-2 left-2 z-10">
        <div className="flex items-center gap-2 bg-slate-900 text-white text-xs px-2 py-1 rounded">
          <span className="text-slate-400">Renderer:</span>
          <span className={
            activeTier === RendererTier.SVG ? 'text-blue-400' :
              activeTier === RendererTier.CANVAS ? 'text-green-400' :
                'text-purple-400'
          }>
            {activeTier.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        Chart rendered with {activeTier} renderer. {summary}
      </div>
    </div>
  );
};

export default HybridChart;
