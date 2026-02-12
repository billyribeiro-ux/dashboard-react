/**
 * Data Pipeline Cache
 * Deterministic caching with TTL for analytics results
 */

import type { CacheKey, CacheEntry, AnalyticsResponse } from './types';

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

export interface CacheConfig {
  maxSize: number; // Maximum number of entries
  maxMemoryMB: number; // Maximum memory usage
  defaultTTLSeconds: number;
  cleanupIntervalMs: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 100,
  maxMemoryMB: 50,
  defaultTTLSeconds: 300, // 5 minutes
  cleanupIntervalMs: 60000, // 1 minute
};

// ============================================================================
// CACHE IMPLEMENTATION
// ============================================================================

export class PipelineCache {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.startCleanup();
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  get(key: CacheKey): AnalyticsResponse | null {
    const keyString = this.serializeKey(key);
    const entry = this.cache.get(keyString);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    const now = Date.now();
    const ttlMs = this.config.defaultTTLSeconds * 1000;

    if (now - entry.createdAt > ttlMs) {
      this.cache.delete(keyString);
      this.stats.misses++;
      return null;
    }

    // Update access stats
    entry.accessedAt = now;
    entry.accessCount++;

    this.stats.hits++;
    return entry.response;
  }

  set(key: CacheKey, response: AnalyticsResponse, _ttlSeconds?: number): void {
    const keyString = this.serializeKey(key);

    // Check memory before adding
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const sizeEstimate = this.estimateSize(response);

    const entry: CacheEntry = {
      key,
      response,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      accessCount: 1,
      sizeBytes: sizeEstimate,
    };

    this.cache.set(keyString, entry);
  }

  has(key: CacheKey): boolean {
    const keyString = this.serializeKey(key);
    const entry = this.cache.get(keyString);

    if (!entry) return false;

    // Check TTL
    const now = Date.now();
    const ttlMs = this.config.defaultTTLSeconds * 1000;

    if (now - entry.createdAt > ttlMs) {
      this.cache.delete(keyString);
      return false;
    }

    return true;
  }

  delete(key: CacheKey): boolean {
    const keyString = this.serializeKey(key);
    return this.cache.delete(keyString);
  }

  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
  }

  // ============================================================================
  // KEY GENERATION
  // ============================================================================

  generateKey(
    datasetId: string,
    datasetVersion: string,
    filters: unknown,
    aggregations: unknown,
    metricTypes: string[]
  ): CacheKey {
    // Deterministic hash of request parameters
    const filterSignature = this.hashObject(filters);
    const aggregationSignature = this.hashObject(aggregations);

    return {
      datasetId,
      datasetVersion,
      filterSignature,
      aggregationSignature,
      metricTypes: metricTypes.sort().join(','),
    };
  }

  private serializeKey(key: CacheKey): string {
    return `${key.datasetId}:${key.datasetVersion}:${key.filterSignature}:${key.aggregationSignature}:${key.metricTypes}`;
  }

  private hashObject(obj: unknown): string {
    // Simple hash for cache key generation
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // ============================================================================
  // EVICTION
  // ============================================================================

  private evictLRU(): void {
    let oldest: { key: string; entry: CacheEntry } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldest || entry.accessedAt < oldest.entry.accessedAt) {
        oldest = { key, entry };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
      this.stats.evictions++;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const ttlMs = this.config.defaultTTLSeconds * 1000;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > ttlMs) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  // ============================================================================
  // SIZE ESTIMATION
  // ============================================================================

  private estimateSize(response: AnalyticsResponse): number {
    // Rough estimate based on JSON serialization
    const str = JSON.stringify(response);
    return str.length * 2; // UTF-16 encoding
  }

  // ============================================================================
  // STATS
  // ============================================================================

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      totalMemoryBytes: Array.from(this.cache.values()).reduce(
        (sum, entry) => sum + entry.sizeBytes,
        0
      ),
    };
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let globalCache: PipelineCache | null = null;

export function getPipelineCache(config?: Partial<CacheConfig>): PipelineCache {
  if (!globalCache) {
    globalCache = new PipelineCache(config);
  }
  return globalCache;
}

export function resetPipelineCache(): void {
  if (globalCache) {
    globalCache.destroy();
    globalCache = null;
  }
}

// ============================================================================
// INCREMENTAL COMPUTE HELPERS
// ============================================================================

/**
 * Check if a new request can use partial results from a cached request
 */
export function canUseIncrementalCompute(
  cachedKey: CacheKey,
  newKey: CacheKey
): boolean {
  // Same dataset and version required
  if (
    cachedKey.datasetId !== newKey.datasetId ||
    cachedKey.datasetVersion !== newKey.datasetVersion
  ) {
    return false;
  }

  // Same metric types required
  if (cachedKey.metricTypes !== newKey.metricTypes) {
    return false;
  }

  // Same aggregations required
  if (cachedKey.aggregationSignature !== newKey.aggregationSignature) {
    return false;
  }

  // Filters must be compatible (superset/subset relationship)
  // This is a simplified check - in production, you'd analyze filter compatibility
  return cachedKey.filterSignature === newKey.filterSignature;
}
