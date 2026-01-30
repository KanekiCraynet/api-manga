/**
 * Advanced Multi-Level Cache Service with TTL support
 * Provides sophisticated caching functionality for API responses
 * Features: Multi-level caching, cache warming, invalidation strategies, compression
 */

// Detect Vercel environment
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

class CacheService {
  constructor(options = {}) {
    // L1 Cache: Fast in-memory cache
    this.l1Cache = new Map();

    // L2 Cache: Secondary cache (can be extended to Redis/Disk)
    this.l2Cache = new Map();

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      compressions: 0,
      decompressions: 0
    };

    // Configuration - optimized for Vercel serverless
    this.defaultTTL = options.defaultTTL || (isVercel ? 2 * 60 * 1000 : 5 * 60 * 1000);
    this.maxSize = options.maxSize || (isVercel ? 200 : 1000); // Smaller for serverless memory
    this.cleanupInterval = options.cleanupInterval || 60 * 1000; // 1 minute
    this.enableCompression = isVercel ? false : (options.enableCompression !== false); // Disable in Vercel (CPU overhead)
    this.compressionThreshold = options.compressionThreshold || 1024; // 1KB

    // Cache warming queue
    this.warmingQueue = [];
    this.isWarming = false;

    // Only start cleanup interval in non-serverless environments
    if (!isVercel) {
      this.startCleanup();
    }
  }

  /**
   * Generate cache key from URL and query parameters
   * @param {string} url - The URL to cache
   * @param {object} params - Query parameters
   * @returns {string} Cache key
   */
  generateKey(url, params = {}) {
    // Filter out cache-busting parameters
    const cacheParams = { ...params };
    delete cacheParams._t;
    delete cacheParams.timestamp;
    delete cacheParams.nocache;

    const paramsString = Object.keys(cacheParams)
      .sort()
      .filter(key => cacheParams[key] !== undefined && cacheParams[key] !== null)
      .map(key => `${key}=${cacheParams[key]}`)
      .join('&');
    return `${url}${paramsString ? `?${paramsString}` : ''}`;
  }

  /**
   * Hash key for better distribution
   * @param {string} key - Cache key
   * @returns {string} Hashed key
   */
  hashKey(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get cached value (multi-level)
   * @param {string} key - Cache key
   * @returns {object|null} Cached value or null if not found/expired
   */
  get(key) {
    // Try L1 cache first
    let item = this.l1Cache.get(key);
    let cacheLevel = 'L1';

    if (!item || this.isExpired(item)) {
      // Try L2 cache
      item = this.l2Cache.get(key);
      cacheLevel = 'L2';

      if (item && !this.isExpired(item)) {
        // Promote to L1
        this.l1Cache.set(key, item);
      }
    }

    if (!item || this.isExpired(item)) {
      this.stats.misses++;
      if (item && this.isExpired(item)) {
        this.delete(key);
      }
      return null;
    }

    this.stats.hits++;

    // Decompress if needed
    let value = item.value;
    if (item.compressed && this.enableCompression) {
      try {
        value = this.decompress(value);
        this.stats.decompressions++;
      } catch (error) {
        console.error('Cache decompression error:', error);
        this.delete(key);
        return null;
      }
    }

    // Update access time
    item.lastAccessed = Date.now();
    item.accessCount = (item.accessCount || 0) + 1;

    return value;
  }

  /**
   * Check if cache item is expired
   * @param {object} item - Cache item
   * @returns {boolean} Whether item is expired
   */
  isExpired(item) {
    return Date.now() > item.expiresAt;
  }

  /**
   * Set cache value (multi-level)
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   * @param {object} options - Cache options
   */
  set(key, value, ttl = null, options = {}) {
    // Check cache size limit
    if (this.l1Cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    let cacheValue = value;
    let compressed = false;

    // Compress large values
    if (this.enableCompression && options.compress !== false) {
      const valueSize = JSON.stringify(value).length;
      if (valueSize > this.compressionThreshold) {
        try {
          cacheValue = this.compress(value);
          compressed = true;
          this.stats.compressions++;
        } catch (error) {
          console.error('Cache compression error:', error);
          compressed = false;
        }
      }
    }

    const item = {
      value: cacheValue,
      compressed,
      expiresAt,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      level: options.level || 'L1',
      tags: options.tags || []
    };

    // Store in appropriate cache level
    if (options.level === 'L2' || this.l1Cache.size >= this.maxSize * 0.8) {
      this.l2Cache.set(key, item);
    } else {
      this.l1Cache.set(key, item);
    }

    this.stats.sets++;
  }

  /**
   * Serialize value for storage (enables future compression support)
   * @param {*} value - Value to serialize
   * @returns {string} Serialized value
   */
  compress(value) {
    // Currently uses JSON serialization - can be extended with actual compression (e.g., lz-string)
    return JSON.stringify(value);
  }

  /**
   * Deserialize value from storage
   * @param {string} serialized - Serialized value
   * @returns {*} Deserialized value
   */
  decompress(serialized) {
    return JSON.parse(serialized);
  }

  /**
   * Evict Least Recently Used (LRU) items
   */
  evictLRU() {
    if (this.l1Cache.size === 0) return;

    // Find least recently used item
    let lruKey = null;
    let lruTime = Date.now();

    this.l1Cache.forEach((item, key) => {
      if (item.lastAccessed < lruTime) {
        lruTime = item.lastAccessed;
        lruKey = key;
      }
    });

    if (lruKey) {
      // Move to L2 or delete
      const item = this.l1Cache.get(lruKey);
      this.l1Cache.delete(lruKey);

      if (this.l2Cache.size < this.maxSize) {
        this.l2Cache.set(lruKey, { ...item, level: 'L2' });
      }
    }
  }

  /**
   * Delete cache entry (multi-level)
   * @param {string} key - Cache key
   */
  delete(key) {
    const l1Deleted = this.l1Cache.delete(key);
    const l2Deleted = this.l2Cache.delete(key);

    if (l1Deleted || l2Deleted) {
      this.stats.deletes++;
    }

    return l1Deleted || l2Deleted;
  }

  /**
   * Invalidate cache by pattern
   * @param {string} pattern - Pattern to match (supports * wildcard)
   * @returns {number} Number of deleted entries
   */
  invalidatePattern(pattern) {
    let count = 0;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');

    // Invalidate L1
    this.l1Cache.forEach((item, key) => {
      if (regex.test(key)) {
        this.l1Cache.delete(key);
        count++;
      }
    });

    // Invalidate L2
    this.l2Cache.forEach((item, key) => {
      if (regex.test(key)) {
        this.l2Cache.delete(key);
        count++;
      }
    });

    this.stats.deletes += count;
    return count;
  }

  /**
   * Invalidate cache by tags
   * @param {Array} tags - Tags to invalidate
   * @returns {number} Number of deleted entries
   */
  invalidateByTags(tags) {
    let count = 0;
    const tagSet = new Set(tags);

    // Invalidate L1
    this.l1Cache.forEach((item, key) => {
      if (item.tags && item.tags.some(tag => tagSet.has(tag))) {
        this.l1Cache.delete(key);
        count++;
      }
    });

    // Invalidate L2
    this.l2Cache.forEach((item, key) => {
      if (item.tags && item.tags.some(tag => tagSet.has(tag))) {
        this.l2Cache.delete(key);
        count++;
      }
    });

    this.stats.deletes += count;
    return count;
  }

  /**
   * Clear all cache
   */
  clear() {
    this.l1Cache.clear();
    this.l2Cache.clear();
    this.stats.deletes += this.stats.sets;
  }

  /**
   * Warm cache with data
   * @param {Array} items - Array of {key, value, ttl, options}
   */
  async warmCache(items) {
    if (this.isWarming) {
      this.warmingQueue.push(...items);
      return;
    }

    this.isWarming = true;

    try {
      for (const item of items) {
        this.set(item.key, item.value, item.ttl, item.options || {});
      }

      // Process queue
      while (this.warmingQueue.length > 0) {
        const item = this.warmingQueue.shift();
        this.set(item.key, item.value, item.ttl, item.options || {});
      }
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Get cache entries with metadata
   * @param {object} options - Query options
   * @param {number} options.limit - Limit number of entries
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.pattern - Filter by pattern
   * @returns {Array} Cache entries with metadata
   */
  getEntries(options = {}) {
    const { limit = 100, offset = 0, pattern } = options;
    const entries = [];

    // Collect L1 cache entries
    this.l1Cache.forEach((item, key) => {
      if (!pattern || key.includes(pattern)) {
        entries.push({
          key,
          level: 'L1',
          createdAt: item.createdAt,
          expiresAt: item.expiresAt,
          lastAccessed: item.lastAccessed,
          accessCount: item.accessCount || 0,
          expired: this.isExpired(item),
          compressed: item.compressed,
          size: this.getItemSize(item),
          tags: item.tags || []
        });
      }
    });

    // Collect L2 cache entries
    this.l2Cache.forEach((item, key) => {
      if (!pattern || key.includes(pattern)) {
        entries.push({
          key,
          level: 'L2',
          createdAt: item.createdAt,
          expiresAt: item.expiresAt,
          lastAccessed: item.lastAccessed,
          accessCount: item.accessCount || 0,
          expired: this.isExpired(item),
          compressed: item.compressed,
          size: this.getItemSize(item),
          tags: item.tags || []
        });
      }
    });

    // Sort by last accessed (most recent first)
    entries.sort((a, b) => b.lastAccessed - a.lastAccessed);

    // Apply pagination
    return entries.slice(offset, offset + limit);
  }

  /**
   * Get stats for a specific cache entry
   * @param {string} key - Cache key
   * @returns {object|null} Entry stats or null if not found
   */
  getEntryStats(key) {
    let item = this.l1Cache.get(key);
    let level = 'L1';

    if (!item) {
      item = this.l2Cache.get(key);
      level = 'L2';
    }

    if (!item) {
      return null;
    }

    return {
      key,
      level,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      lastAccessed: item.lastAccessed,
      accessCount: item.accessCount || 0,
      expired: this.isExpired(item),
      compressed: item.compressed,
      size: this.getItemSize(item),
      ttl: item.expiresAt - Date.now(),
      tags: item.tags || []
    };
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getStats() {
    const now = Date.now();
    let l1Expired = 0;
    let l2Expired = 0;
    let totalSize = 0;

    this.l1Cache.forEach(item => {
      if (this.isExpired(item)) {
        l1Expired++;
      }
      totalSize += this.getItemSize(item);
    });

    this.l2Cache.forEach(item => {
      if (this.isExpired(item)) {
        l2Expired++;
      }
      totalSize += this.getItemSize(item);
    });

    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      l1: {
        size: this.l1Cache.size,
        expired: l1Expired,
        active: this.l1Cache.size - l1Expired
      },
      l2: {
        size: this.l2Cache.size,
        expired: l2Expired,
        active: this.l2Cache.size - l2Expired
      },
      total: {
        size: this.l1Cache.size + this.l2Cache.size,
        expired: l1Expired + l2Expired,
        active: (this.l1Cache.size + this.l2Cache.size) - (l1Expired + l2Expired),
        estimatedSize: totalSize
      },
      performance: {
        hits: this.stats.hits,
        misses: this.stats.misses,
        hitRate: `${hitRate}%`,
        sets: this.stats.sets,
        deletes: this.stats.deletes,
        compressions: this.stats.compressions,
        decompressions: this.stats.decompressions
      }
    };
  }

  /**
   * Estimate item size in bytes
   * @param {object} item - Cache item
   * @returns {number} Estimated size in bytes
   */
  getItemSize(item) {
    try {
      return JSON.stringify(item.value).length;
    } catch {
      return 0;
    }
  }

  /**
   * Cleanup expired cache entries (multi-level)
   */
  cleanup() {
    const keysToDeleteL1 = [];
    const keysToDeleteL2 = [];

    // Cleanup L1
    this.l1Cache.forEach((item, key) => {
      if (this.isExpired(item)) {
        keysToDeleteL1.push(key);
      }
    });

    // Cleanup L2
    this.l2Cache.forEach((item, key) => {
      if (this.isExpired(item)) {
        keysToDeleteL2.push(key);
      }
    });

    keysToDeleteL1.forEach(key => this.l1Cache.delete(key));
    keysToDeleteL2.forEach(key => this.l2Cache.delete(key));

    // If L1 is getting full, move some items to L2
    if (this.l1Cache.size > this.maxSize * 0.9) {
      this.evictLRU();
    }
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cache middleware for Express
   * @param {number} ttl - Time to live in milliseconds
   * @returns {function} Express middleware
   */
  middleware(ttl = null) {
    const self = this;
    return (req, res, next) => {
      const key = self.generateKey(req.originalUrl, req.query);
      const cached = self.get(key);

      if (cached) {
        res.set('X-Cache', 'HIT');
        // Call res.json through the chain (respecting performance middleware if present)
        return res.json(cached);
      }

      // Store the current json method (might be overridden by performance middleware)
      const currentJson = res.json.bind(res);

      // Override json method to cache response
      res.json = function (data) {
        // Cache the response
        self.set(key, data, ttl);
        res.set('X-Cache', 'MISS');
        // Call the current json method (which may be performance middleware's override)
        return currentJson(data);
      };

      next();
    };
  }
}

// Export singleton instance
const cacheService = new CacheService();

module.exports = cacheService;

