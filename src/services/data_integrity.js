/**
 * Data Integrity Service
 * Advanced deduplication, hash tracking, and data freshness management
 */

const crypto = require('crypto');

// Detect Vercel environment
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

class DataIntegrityService {
  constructor() {
    // Hash storage for tracking processed data - smaller for serverless
    this.dataHashes = new Map();
    this.hashExpiry = isVercel ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 6h vs 24h
    this.maxHashSize = isVercel ? 500 : 5000; // Cap size for memory

    // Freshness tracking
    this.freshnessMap = new Map();
    this.staleThreshold = isVercel ? 2 * 60 * 1000 : 5 * 60 * 1000; // 2 min vs 5 min

    // Deduplication index
    this.dedupeIndex = new Map();

    // Statistics
    this.stats = {
      duplicatesDetected: 0,
      dataProcessed: 0,
      hashCollisions: 0,
      staleDataRefreshed: 0
    };

    // Only start cleanup interval in non-serverless
    if (!isVercel) {
      this.startCleanup();
    }
  }

  /**
   * Generate content hash for data
   * Uses djb2 for Vercel (faster), MD5 for standard (more accurate)
   * @param {object|Array} data - Data to hash
   * @param {Array} fields - Fields to include in hash
   * @returns {string} Content hash
   */
  generateHash(data, fields = ['title', 'href']) {
    if (!data) return '';

    const content = fields
      .map(field => {
        const value = this.getNestedValue(data, field);
        return value ? String(value).toLowerCase().trim() : '';
      })
      .filter(Boolean)
      .join('|');

    // Use faster djb2 hash for Vercel, MD5 for standard
    if (isVercel) {
      return this.djb2Hash(content);
    }
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Fast djb2 hash function (much faster than MD5)
   * @param {string} str - String to hash
   * @returns {string} Hash string
   */
  djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generate unique ID for comic item
   * @param {object} item - Comic item
   * @returns {string} Unique ID
   */
  generateUniqueId(item) {
    if (!item) return '';

    // Prioritize URL-based ID
    if (item.href) {
      const urlParts = item.href.split('/').filter(Boolean);
      return `comic_${urlParts[urlParts.length - 1] || this.generateHash(item)}`;
    }

    // Fallback to hash-based ID
    return `comic_${this.generateHash(item)}`;
  }

  /**
   * Check if data has been processed (exists in hash map)
   * @param {string} hash - Data hash
   * @param {string} context - Context identifier
   * @returns {boolean} True if already processed
   */
  isProcessed(hash, context = 'default') {
    const key = `${context}:${hash}`;
    const entry = this.dataHashes.get(key);

    if (!entry) return false;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.dataHashes.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Mark data as processed
   * @param {string} hash - Data hash
   * @param {string} context - Context identifier
   * @param {object} metadata - Additional metadata
   */
  markProcessed(hash, context = 'default', metadata = {}) {
    const key = `${context}:${hash}`;

    this.dataHashes.set(key, {
      hash,
      context,
      metadata,
      processedAt: Date.now(),
      expiresAt: Date.now() + this.hashExpiry
    });

    this.stats.dataProcessed++;
  }

  /**
   * Advanced deduplication for array of items
   * @param {Array} items - Items to deduplicate
   * @param {object} options - Deduplication options
   * @returns {object} Deduplicated items with stats
   */
  deduplicate(items, options = {}) {
    if (!Array.isArray(items)) {
      return { items: [], duplicates: [], stats: { total: 0, unique: 0, duplicates: 0 } };
    }

    const {
      fields = ['title', 'href'],
      strategy = 'newest', // 'newest', 'oldest', 'best_quality', 'merge'
      context = 'default',
      mergeFields = ['genre', 'chapter', 'rating', 'description']
    } = options;

    const uniqueMap = new Map();
    const duplicates = [];
    const processOrder = [];

    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;

      const hash = this.generateHash(item, fields);
      const fuzzyKey = this.generateFuzzyKey(item);

      // Check exact hash match
      let existingEntry = uniqueMap.get(hash);

      // Check fuzzy match if no exact match
      if (!existingEntry && fuzzyKey) {
        for (const [key, entry] of uniqueMap.entries()) {
          if (this.isFuzzyMatch(item, entry.item)) {
            existingEntry = entry;
            this.stats.hashCollisions++;
            break;
          }
        }
      }

      if (existingEntry) {
        this.stats.duplicatesDetected++;
        duplicates.push({
          item,
          matchedWith: existingEntry.item,
          hash
        });

        // Handle based on strategy
        if (strategy === 'merge') {
          existingEntry.item = this.mergeItems(existingEntry.item, item, mergeFields);
        } else if (strategy === 'best_quality') {
          if (this.getQualityScore(item) > this.getQualityScore(existingEntry.item)) {
            existingEntry.item = this.mergeItems(item, existingEntry.item, mergeFields);
          }
        } else if (strategy === 'newest') {
          if (index > existingEntry.index) {
            existingEntry.item = this.mergeItems(item, existingEntry.item, mergeFields);
          }
        }
        // 'oldest' strategy: keep existing (do nothing)
      } else {
        // Add unique ID and hash
        const enrichedItem = {
          ...item,
          _id: this.generateUniqueId(item),
          _hash: hash,
          _processedAt: Date.now()
        };

        uniqueMap.set(hash, { item: enrichedItem, index });
        processOrder.push(hash);
      }
    });

    // Maintain original order
    const uniqueItems = processOrder.map(hash => uniqueMap.get(hash).item);

    return {
      items: uniqueItems,
      duplicates,
      stats: {
        total: items.length,
        unique: uniqueItems.length,
        duplicates: duplicates.length,
        duplicateRate: ((duplicates.length / items.length) * 100).toFixed(2) + '%'
      }
    };
  }

  /**
   * Generate fuzzy key for approximate matching
   * @param {object} item - Item to process
   * @returns {string} Fuzzy key
   */
  generateFuzzyKey(item) {
    if (!item || !item.title) return '';

    return item.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);
  }

  /**
   * Check if two items are fuzzy matches
   * @param {object} item1 - First item
   * @param {object} item2 - Second item
   * @returns {boolean} True if fuzzy match
   */
  isFuzzyMatch(item1, item2) {
    if (!item1 || !item2) return false;

    // Title similarity check
    const title1 = (item1.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const title2 = (item2.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!title1 || !title2) return false;

    // Exact match after normalization
    if (title1 === title2) return true;

    // Levenshtein distance for fuzzy matching (simple implementation)
    const similarity = this.calculateSimilarity(title1, title2);
    return similarity > 0.85; // 85% similarity threshold
  }

  /**
   * Calculate string similarity (0-1)
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Similarity score
   */
  calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    // Check if shorter is substring of longer
    if (longer.includes(shorter)) {
      return shorter.length / longer.length;
    }

    // Simple character overlap calculation
    let matches = 0;
    const shorterChars = shorter.split('');
    const longerChars = longer.split('');

    shorterChars.forEach((char, i) => {
      if (longerChars[i] === char) matches++;
    });

    return matches / longer.length;
  }

  /**
   * Calculate quality score for item
   * @param {object} item - Item to score
   * @returns {number} Quality score
   */
  getQualityScore(item) {
    if (!item) return 0;

    let score = 0;

    if (item.title && item.title.length > 0) score += 10;
    if (item.thumbnail && item.thumbnail.length > 10) score += 15;
    if (item.description && item.description.length > 50) score += 15;
    if (item.rating && parseFloat(item.rating) > 0) score += 10;
    if (item.chapter && item.chapter.length > 0) score += 10;
    if (item.genre) {
      const genreCount = Array.isArray(item.genre) ? item.genre.length :
        (typeof item.genre === 'string' ? item.genre.split(',').length : 0);
      score += Math.min(genreCount * 3, 15);
    }
    if (item.author && item.author.length > 0) score += 10;
    if (item.status && item.status.length > 0) score += 5;
    if (item.type && item.type.length > 0) score += 5;
    if (item.href && item.href.length > 0) score += 5;

    return score;
  }

  /**
   * Merge two items
   * @param {object} primary - Primary item
   * @param {object} secondary - Secondary item
   * @param {Array} fields - Fields to merge
   * @returns {object} Merged item
   */
  mergeItems(primary, secondary, fields = []) {
    if (!primary) return secondary;
    if (!secondary) return primary;

    const merged = { ...primary };

    fields.forEach(field => {
      const primaryVal = primary[field];
      const secondaryVal = secondary[field];

      if (!primaryVal && secondaryVal) {
        merged[field] = secondaryVal;
      } else if (Array.isArray(primaryVal) && Array.isArray(secondaryVal)) {
        // Merge arrays
        const combined = [...primaryVal];
        secondaryVal.forEach(item => {
          const exists = combined.some(existing =>
            JSON.stringify(existing) === JSON.stringify(item)
          );
          if (!exists) combined.push(item);
        });
        merged[field] = combined;
      } else if (typeof primaryVal === 'string' && typeof secondaryVal === 'string') {
        // Keep longer string
        if (secondaryVal.length > primaryVal.length) {
          merged[field] = secondaryVal;
        }
      }
    });

    // Track sources
    merged._sources = [
      ...(primary._sources || [primary._source || 'unknown']),
      secondary._source || 'unknown'
    ].filter((v, i, a) => a.indexOf(v) === i);

    return merged;
  }

  /**
   * Check if data is stale (needs refresh)
   * @param {string} key - Data key
   * @param {number} threshold - Stale threshold in ms
   * @returns {boolean} True if data is stale
   */
  isStale(key, threshold = null) {
    const entry = this.freshnessMap.get(key);
    if (!entry) return true;

    const effectiveThreshold = threshold || this.staleThreshold;
    const isStale = Date.now() - entry.timestamp > effectiveThreshold;

    if (isStale) {
      this.stats.staleDataRefreshed++;
    }

    return isStale;
  }

  /**
   * Update freshness timestamp
   * @param {string} key - Data key
   * @param {object} metadata - Additional metadata
   */
  updateFreshness(key, metadata = {}) {
    this.freshnessMap.set(key, {
      timestamp: Date.now(),
      metadata
    });
  }

  /**
   * Get nested value from object
   * @param {object} obj - Source object
   * @param {string} path - Dot-separated path
   * @returns {*} Value at path
   */
  getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  /**
   * Validate data integrity
   * @param {object|Array} data - Data to validate
   * @param {object} schema - Validation schema
   * @returns {object} Validation result
   */
  validateIntegrity(data, schema = {}) {
    const {
      requiredFields = ['title', 'href'],
      minTitleLength = 1,
      minDescriptionLength = 0,
      validateUrls = true
    } = schema;

    const errors = [];
    const warnings = [];

    const items = Array.isArray(data) ? data : [data];

    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        errors.push({ index, message: 'Invalid item: not an object' });
        return;
      }

      // Check required fields
      requiredFields.forEach(field => {
        if (!item[field]) {
          errors.push({ index, field, message: `Missing required field: ${field}` });
        }
      });

      // Validate title
      if (item.title && item.title.length < minTitleLength) {
        warnings.push({ index, field: 'title', message: 'Title too short' });
      }

      // Validate URLs
      if (validateUrls && item.href) {
        if (!item.href.startsWith('/') && !item.href.startsWith('http')) {
          warnings.push({ index, field: 'href', message: 'Invalid URL format' });
        }
      }

      // Validate thumbnail
      if (item.thumbnail && !item.thumbnail.startsWith('http') && !item.thumbnail.startsWith('/')) {
        warnings.push({ index, field: 'thumbnail', message: 'Invalid thumbnail URL' });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        total: items.length,
        valid: items.length - errors.length,
        invalid: errors.length,
        warnings: warnings.length
      }
    };
  }

  /**
   * Detect new items from current vs previous data
   * @param {Array} currentData - Current data
   * @param {string} context - Context key
   * @returns {object} New items detection result
   */
  detectNewItems(currentData, context = 'default') {
    if (!Array.isArray(currentData)) {
      return { newItems: [], existingItems: [], allNew: false };
    }

    const dedupeKey = `dedupe_${context}`;
    const previousHashes = this.dedupeIndex.get(dedupeKey) || new Set();
    const currentHashes = new Set();

    const newItems = [];
    const existingItems = [];

    currentData.forEach(item => {
      const hash = this.generateHash(item);
      currentHashes.add(hash);

      if (previousHashes.has(hash)) {
        existingItems.push(item);
      } else {
        newItems.push({ ...item, _isNew: true });
      }
    });

    // Update index
    this.dedupeIndex.set(dedupeKey, currentHashes);

    return {
      newItems,
      existingItems,
      allNew: existingItems.length === 0 && newItems.length > 0,
      stats: {
        total: currentData.length,
        new: newItems.length,
        existing: existingItems.length,
        newRate: currentData.length > 0
          ? ((newItems.length / currentData.length) * 100).toFixed(2) + '%'
          : '0.00%'
      }
    };
  }

  /**
   * Get statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      hashMapSize: this.dataHashes.size,
      freshnessMapSize: this.freshnessMap.size,
      dedupeIndexSize: this.dedupeIndex.size
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();

    // Cleanup hash map
    for (const [key, entry] of this.dataHashes.entries()) {
      if (now > entry.expiresAt) {
        this.dataHashes.delete(key);
      }
    }

    // Cleanup freshness map (keep entries for 1 hour)
    for (const [key, entry] of this.freshnessMap.entries()) {
      if (now - entry.timestamp > 60 * 60 * 1000) {
        this.freshnessMap.delete(key);
      }
    }
  }

  /**
   * Start cleanup interval
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Clear all data
   */
  clear() {
    this.dataHashes.clear();
    this.freshnessMap.clear();
    this.dedupeIndex.clear();
    this.stats = {
      duplicatesDetected: 0,
      dataProcessed: 0,
      hashCollisions: 0,
      staleDataRefreshed: 0
    };
  }
}

// Singleton instance
const dataIntegrityService = new DataIntegrityService();

module.exports = {
  DataIntegrityService,
  dataIntegrityService
};
