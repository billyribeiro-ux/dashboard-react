'use client';

/**
 * Dashboard Page with Hybrid Rendering
 * Demonstrates the hybrid SVG/Canvas/WebGL rendering system
 */

import React, { useState, useMemo } from 'react';
import { HybridChart } from '@/components/HybridChart';
import { SeriesData, HitTestResult } from '@/lib/viz/hybrid';

// Generate sample data
function generateTimeSeriesData(
  seriesId: string,
  name: string,
  color: string,
  pointCount: number,
  startDate: Date = new Date(2024, 0, 1),
  anomalyIndices: number[] = []
): SeriesData {
  const data = [];
  let value = 50;

  for (let i = 0; i < pointCount; i++) {
    const date = new Date(startDate);
    date.setHours(date.getHours() + i);

    // Random walk with trend
    const trend = Math.sin(i / 100) * 20;
    const noise = (Math.random() - 0.5) * 10;
    value += (Math.random() - 0.5) * 5;

    // Add anomaly if specified
    const isAnomaly = anomalyIndices.includes(i);
    const anomalyValue = isAnomaly ? (Math.random() > 0.5 ? 80 : 20) : 0;

    data.push({
      x: date,
      y: Math.max(10, Math.min(90, value + trend + noise + anomalyValue)),
      id: `${seriesId}-${i}`,
    });
  }

  return {
    id: seriesId,
    name,
    color,
    data,
    visible: true,
  };
}

export default function Dashboard() {
  // Data density selector
  const [pointCount, setPointCount] = useState(1000);
  const [showDebug, setShowDebug] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HitTestResult | null>(null);

  // Generate data based on selected density
  const data = useMemo(() => {
    const series1 = generateTimeSeriesData(
      'series-1',
      'Primary Metric',
      '#3b82f6',
      pointCount,
      new Date(2024, 0, 1),
      [100, 250, 500, 750] // Anomalies
    );

    const series2 = generateTimeSeriesData(
      'series-2',
      'Secondary Metric',
      '#10b981',
      pointCount,
      new Date(2024, 0, 1),
      [150, 350, 600]
    );

    return [series1, series2];
  }, [pointCount]);

  const handleHover = (result: HitTestResult | null) => {
    setHoverInfo(result);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Hybrid Rendering Dashboard
        </h1>
        <p className="text-slate-600 max-w-3xl">
          Demonstrates automatic tier switching between SVG, Canvas, and WebGL renderers
          based on data density. The system preserves D3 semantic correctness while enabling
          ultra-high-density visualization.
        </p>
      </header>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-6">
          {/* Data density selector */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Data Points per Series
            </label>
            <select
              value={pointCount}
              onChange={(e) => setPointCount(Number(e.target.value))}
              className="block w-48 rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value={100}>100 points (SVG)</option>
              <option value={1000}>1,000 points (SVG/Canvas)</option>
              <option value={5000}>5,000 points (Canvas)</option>
              <option value={10000}>10,000 points (Canvas/WebGL)</option>
              <option value={50000}>50,000 points (WebGL)</option>
            </select>
          </div>

          {/* Debug toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="debug-toggle"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="debug-toggle" className="ml-2 text-sm text-slate-700">
              Show Debug Panel
            </label>
          </div>

          {/* Current stats */}
          <div className="ml-auto text-sm text-slate-500">
            <span className="font-medium">Total Points:</span>{' '}
            {(pointCount * 2).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Multi-Series Time Series Chart
        </h2>

        <HybridChart
          data={data}
          width={900}
          height={450}
          showDebug={showDebug}
          onHover={handleHover}
          className="mx-auto"
        />

        {/* Hover info */}
        {hoverInfo && (
          <div className="mt-4 p-3 bg-slate-100 rounded text-sm">
            <span className="font-medium">Hover:</span>{' '}
            Series: {hoverInfo.series}, Value:{' '}
            {typeof hoverInfo.point?.y === 'number'
              ? hoverInfo.point.y.toFixed(2)
              : 'N/A'}
            , Time:{' '}
            {hoverInfo.point?.x instanceof Date
              ? hoverInfo.point.x.toLocaleString()
              : String(hoverInfo.point?.x)}
          </div>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <h3 className="font-semibold text-slate-900">SVG Renderer</h3>
          </div>
          <p className="text-sm text-slate-600">
            Default tier for up to 5,000 points. Full DOM interaction, easiest to inspect,
            best for accessibility.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <h3 className="font-semibold text-slate-900">Canvas Renderer</h3>
          </div>
          <p className="text-sm text-slate-600">
            Intermediate tier for 5,000-50,000 points. Hardware-accelerated 2D rendering
            with spatial indexing for hit testing.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-purple-500" />
            <h3 className="font-semibold text-slate-900">WebGL Renderer</h3>
          </div>
          <p className="text-sm text-slate-600">
            High-performance tier for 50,000+ points. GPU-accelerated with Three.js,
            capable of smooth interaction with massive datasets.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-slate-200 text-sm text-slate-500">
        <p>
          Hybrid Rendering System v1.0 | Next.js + React + TypeScript + D3 + Three.js
        </p>
      </footer>
    </div>
  );
}
