'use client';

/**
 * Debug Panel Component
 * Shows active renderer, performance metrics, and diagnostics
 */

import React, { useState, useEffect, useCallback } from 'react';
import { HybridEngine } from './engine';
import { RendererTier } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface DebugPanelProps {
  engine: HybridEngine;
  className?: string;
}

interface MetricsState {
  currentTier: RendererTier;
  fps: number;
  frameTime: number;
  pointCount: number;
  droppedFrames: number;
  memoryUsage: number;
  rendererSwitches: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const DebugPanel: React.FC<DebugPanelProps> = ({ engine, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [metrics, setMetrics] = useState<MetricsState>({
    currentTier: RendererTier.SVG,
    fps: 0,
    frameTime: 0,
    pointCount: 0,
    droppedFrames: 0,
    memoryUsage: 0,
    rendererSwitches: 0,
  });

  const [switches, setSwitches] = useState<Array<{ from: RendererTier; to: RendererTier; time: number }>>([]);

  // Update metrics
  const updateMetrics = useCallback(() => {
    const state = engine.getState();
    const frameMetrics = engine.getFrameMetrics();

    // Calculate average frame time from recent metrics
    const recentFrameTime = frameMetrics.length > 0
      ? frameMetrics.slice(-10).reduce((sum, m) => sum + m.frameTime, 0) / Math.min(10, frameMetrics.length)
      : 0;

    setMetrics({
      currentTier: state.currentTier,
      fps: engine.getCurrentFPS(),
      frameTime: recentFrameTime,
      pointCount: state.dataDensity,
      droppedFrames: engine.getDroppedFrames(),
      memoryUsage: 0, // Would need actual memory API
      rendererSwitches: switches.length,
    });
  }, [engine, switches.length]);

  // Listen for tier switches
  useEffect(() => {
    const unsubscribe = engine.onEvent((event) => {
      if (event.type === 'tierSwitch') {
        const switchEvent = event.payload as { from: RendererTier; to: RendererTier };
        setSwitches((prev) => [...prev, { ...switchEvent, time: Date.now() }].slice(-10));
      }
    });

    return unsubscribe;
  }, [engine]);

  // Update metrics periodically
  useEffect(() => {
    const interval = setInterval(updateMetrics, 500);
    return () => clearInterval(interval);
  }, [updateMetrics]);

  // Get tier color
  const getTierColor = (tier: RendererTier): string => {
    switch (tier) {
      case RendererTier.SVG:
        return 'bg-blue-500';
      case RendererTier.CANVAS:
        return 'bg-green-500';
      case RendererTier.WEBGL:
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Get tier label
  const getTierLabel = (tier: RendererTier): string => {
    switch (tier) {
      case RendererTier.SVG:
        return 'SVG';
      case RendererTier.CANVAS:
        return 'Canvas';
      case RendererTier.WEBGL:
        return 'WebGL';
      default:
        return tier;
    }
  };

  // Format number with units
  const formatNumber = (n: number, unit: string = ''): string => {
    if (n === 0) return '-';
    return `${Math.round(n).toLocaleString()}${unit}`;
  };

  // Get performance status color
  const getPerformanceStatus = (): { color: string; text: string } => {
    if (metrics.frameTime > 33) {
      return { color: 'text-red-500', text: 'Poor' };
    }
    if (metrics.frameTime > 16) {
      return { color: 'text-yellow-500', text: 'Fair' };
    }
    return { color: 'text-green-500', text: 'Good' };
  };

  const perfStatus = getPerformanceStatus();

  return (
    <div className={`font-mono text-xs ${className}`}>
      {/* Collapsed view - always visible */}
      <div
        className="flex items-center gap-3 bg-slate-900 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Tier indicator */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Renderer:</span>
          <span className={`px-2 py-0.5 rounded text-white font-semibold ${getTierColor(metrics.currentTier)}`}>
            {getTierLabel(metrics.currentTier)}
          </span>
        </div>

        {/* FPS */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">FPS:</span>
          <span className={metrics.fps >= 55 ? 'text-green-400' : metrics.fps >= 30 ? 'text-yellow-400' : 'text-red-400'}>
            {metrics.fps}
          </span>
        </div>

        {/* Frame time */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Frame:</span>
          <span className={perfStatus.color}>
            {Math.round(metrics.frameTime)}ms
          </span>
        </div>

        {/* Expand indicator */}
        <span className="ml-auto text-slate-500">
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <div className="mt-2 bg-slate-900 text-slate-300 px-4 py-3 rounded-lg">
          {/* Performance Metrics */}
          <div className="mb-4">
            <h4 className="text-slate-400 font-semibold mb-2">Performance</h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500">Points:</span>{' '}
                <span className="text-white">{formatNumber(metrics.pointCount)}</span>
              </div>
              <div>
                <span className="text-slate-500">Dropped Frames:</span>{' '}
                <span className={metrics.droppedFrames > 0 ? 'text-red-400' : 'text-green-400'}>
                  {metrics.droppedFrames}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Status:</span>{' '}
                <span className={perfStatus.color}>{perfStatus.text}</span>
              </div>
              <div>
                <span className="text-slate-500">Tier Switches:</span>{' '}
                <span className="text-white">{metrics.rendererSwitches}</span>
              </div>
            </div>
          </div>

          {/* Recent Tier Switches */}
          {switches.length > 0 && (
            <div className="mb-4">
              <h4 className="text-slate-400 font-semibold mb-2">Recent Tier Switches</h4>
              <div className="max-h-32 overflow-y-auto">
                {switches.slice().reverse().map((sw, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    <span className="text-slate-500">
                      {new Date(sw.time).toLocaleTimeString()}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-white ${getTierColor(sw.from)}`}>
                      {getTierLabel(sw.from)}
                    </span>
                    <span>→</span>
                    <span className={`px-1.5 py-0.5 rounded text-white ${getTierColor(sw.to)}`}>
                      {getTierLabel(sw.to)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Configuration */}
          <div>
            <h4 className="text-slate-400 font-semibold mb-2">Configuration</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">SVG→Canvas:</span>{' '}
                <span className="text-white">{engine.getConfig().thresholds.svgToCanvas.toLocaleString()} pts</span>
              </div>
              <div>
                <span className="text-slate-500">Canvas→WebGL:</span>{' '}
                <span className="text-white">{engine.getConfig().thresholds.canvasToWebGL.toLocaleString()} pts</span>
              </div>
              <div>
                <span className="text-slate-500">Target FPS:</span>{' '}
                <span className="text-white">{engine.getConfig().performanceBudgets.targetFPS}</span>
              </div>
              <div>
                <span className="text-slate-500">Auto-degrade:</span>{' '}
                <span className="text-white">{engine.getConfig().performanceBudgets.autoDegrade ? 'On' : 'Off'}</span>
              </div>
            </div>
          </div>

          {/* Help text */}
          <div className="mt-4 pt-3 border-t border-slate-700 text-slate-500 text-xs">
            Click to collapse. Panel updates every 500ms.
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugPanel;
