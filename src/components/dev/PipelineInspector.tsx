'use client';

/**
 * PipelineInspector Component
 * Debug UI for monitoring data pipeline status
 */

import React from 'react';
import { usePipelineInspectorData } from '@/lib/data-pipeline/hooks';

export const PipelineInspector: React.FC = () => {
  const data = usePipelineInspectorData();

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'wasm':
        return 'text-purple-400';
      case 'worker-js':
        return 'text-blue-400';
      case 'main-js':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="font-mono text-xs bg-slate-900 text-slate-300 p-4 rounded-lg">
      <h3 className="text-sm font-bold text-white mb-3">Pipeline Inspector</h3>

      {/* Mode Status */}
      <div className="mb-3">
        <span className="text-slate-500">Mode:</span>
        <span className={`ml-2 font-semibold ${getModeColor(data.mode)}`}>
          {data.mode.toUpperCase()}
        </span>
      </div>

      {/* Feature Flags */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <span className="text-slate-500">WASM:</span>
          <span className={data.wasmReady ? 'text-green-400 ml-2' : 'text-red-400 ml-2'}>
            {data.wasmReady ? 'Ready' : 'Not Ready'}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Workers:</span>
          <span className={data.workerPoolReady ? 'text-green-400 ml-2' : 'text-red-400 ml-2'}>
            {data.workerPoolReady ? 'Ready' : 'Not Ready'}
          </span>
        </div>
      </div>

      {/* Job Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <span className="text-slate-500">Active Jobs:</span>
          <span className="text-white ml-2">{data.activeJobs}</span>
        </div>
        <div>
          <span className="text-slate-500">Queue Depth:</span>
          <span className="text-white ml-2">{data.queueDepth}</span>
        </div>
        <div>
          <span className="text-slate-500">Completed:</span>
          <span className="text-white ml-2">{data.totalJobsCompleted}</span>
        </div>
        <div>
          <span className="text-slate-500">Cache Hit Rate:</span>
          <span className="text-white ml-2">
            {(data.cacheHitRate * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Recent Jobs */}
      {data.recentJobs.length > 0 && (
        <div className="mb-3">
          <h4 className="text-slate-500 mb-1">Recent Jobs:</h4>
          <div className="max-h-32 overflow-y-auto">
            {data.recentJobs.map((job, i) => (
              <div key={i} className="flex gap-2 text-xs py-1 border-b border-slate-800">
                <span className="text-slate-500">
                  {job.durationMs?.toFixed(0)}ms
                </span>
                <span className={getModeColor(job.pipelineMode)}>
                  {job.pipelineMode}
                </span>
                <span className={job.cacheHit ? 'text-green-400' : 'text-slate-500'}>
                  {job.cacheHit ? 'cache' : 'compute'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Duration */}
      {data.lastJobDuration && (
        <div className="text-slate-500">
          Last Job: <span className="text-white">{data.lastJobDuration.toFixed(0)}ms</span>
        </div>
      )}
    </div>
  );
};

export default PipelineInspector;
