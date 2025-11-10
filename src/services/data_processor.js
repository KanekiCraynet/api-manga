/**
 * Advanced Data Processing Pipeline
 * Pipeline untuk mengolah data dengan stages yang jelas dan efisien
 */

const { normalizeComicItem, normalizeChapterItem } = require('../helper/data_validator');

/**
 * Data Processing Pipeline
 * Mengolah data melalui berbagai stages dengan alur yang jelas
 */
class DataProcessor {
  constructor() {
    this.stages = [];
    this.middlewares = [];
  }

  /**
   * Add processing stage
   * @param {string} name - Stage name
   * @param {Function} handler - Stage handler function
   * @returns {DataProcessor} Instance for chaining
   */
  addStage(name, handler) {
    this.stages.push({ name, handler });
    return this;
  }

  /**
   * Add middleware (runs before stages)
   * @param {Function} handler - Middleware function
   * @returns {DataProcessor} Instance for chaining
   */
  use(handler) {
    this.middlewares.push(handler);
    return this;
  }

  /**
   * Process data through pipeline
   * @param {*} data - Input data
   * @param {object} context - Processing context
   * @returns {Promise<*>} Processed data
   */
  async process(data, context = {}) {
    let result = data;

    // Run middlewares
    for (const middleware of this.middlewares) {
      result = await middleware(result, context);
    }

    // Run stages
    for (const stage of this.stages) {
      try {
        result = await stage.handler(result, context);
        context[stage.name] = { success: true, timestamp: Date.now() };
      } catch (error) {
        context[stage.name] = { success: false, error: error.message, timestamp: Date.now() };
        // Continue processing or throw based on error severity
        if (context.stopOnError) {
          throw error;
        }
      }
    }

    return result;
  }

  /**
   * Reset pipeline
   */
  reset() {
    this.stages = [];
    this.middlewares = [];
  }
}

/**
 * Data Enrichment Service
 * Menambahkan informasi tambahan ke data
 */
class DataEnrichmentService {
  /**
   * Enrich comic item with additional data
   * @param {object} comic - Comic item
   * @param {object} options - Enrichment options
   * @returns {object} Enriched comic item
   */
  static enrichComic(comic, options = {}) {
    const enriched = { ...comic };

    // Add computed fields
    enriched.metadata = {
      hasThumbnail: !!comic.thumbnail,
      hasDescription: !!comic.description && comic.description.length > 0,
      hasChapters: !!(comic.chapter && comic.chapter.length > 0),
      chapterCount: Array.isArray(comic.chapter) ? comic.chapter.length : 0,
      genreCount: Array.isArray(comic.genre) ? comic.genre.length : 0,
      isRated: comic.rating > 0,
      qualityScore: this.calculateQualityScore(comic),
      processedAt: new Date().toISOString()
    };

    // Add searchable text
    if (options.includeSearchable) {
      enriched.searchable = this.generateSearchableText(comic);
    }

    // Add normalized fields
    if (options.normalize) {
      enriched.normalized = {
        title: this.normalizeText(comic.title),
        author: this.normalizeText(comic.author),
        type: (comic.type || '').toLowerCase(),
        status: (comic.status || '').toLowerCase()
      };
    }

    // Add timestamps
    if (options.includeTimestamps) {
      enriched.timestamps = {
        createdAt: comic.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    return enriched;
  }

  /**
   * Calculate quality score for comic
   * @param {object} comic - Comic item
   * @returns {number} Quality score (0-100)
   */
  static calculateQualityScore(comic) {
    let score = 0;

    // Title (10 points)
    if (comic.title && comic.title.length > 0) score += 10;

    // Thumbnail (20 points)
    if (comic.thumbnail) score += 20;

    // Description (15 points)
    if (comic.description && comic.description.length > 50) score += 15;

    // Rating (15 points)
    if (comic.rating && comic.rating > 0) score += 15;

    // Chapters (20 points)
    if (comic.chapter && comic.chapter.length > 0) score += 20;

    // Genre (10 points)
    if (comic.genre && comic.genre.length > 0) score += 10;

    // Author (10 points)
    if (comic.author && comic.author.length > 0) score += 10;

    return Math.min(100, score);
  }

  /**
   * Generate searchable text from comic
   * @param {object} comic - Comic item
   * @returns {string} Searchable text
   */
  static generateSearchableText(comic) {
    const parts = [
      comic.title,
      comic.author,
      comic.type,
      comic.status,
      comic.description,
      Array.isArray(comic.genre) ? comic.genre.map(g => typeof g === 'string' ? g : g.title).join(' ') : comic.genre
    ].filter(Boolean);

    return parts.join(' ').toLowerCase();
  }

  /**
   * Normalize text for searching
   * @param {string} text - Text to normalize
   * @returns {string} Normalized text
   */
  static normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .trim();
  }

  /**
   * Enrich chapter item
   * @param {object} chapter - Chapter item
   * @returns {object} Enriched chapter item
   */
  static enrichChapter(chapter) {
    const enriched = { ...chapter };

    enriched.metadata = {
      hasImages: !!(chapter.panel && chapter.panel.length > 0),
      imageCount: Array.isArray(chapter.panel) ? chapter.panel.length : 0,
      hasDate: !!chapter.date,
      isNumbered: !!(chapter.number && chapter.number > 0),
      processedAt: new Date().toISOString()
    };

    return enriched;
  }
}

/**
 * Batch Processing Service
 * Process multiple items in batches
 */
class BatchProcessor {
  /**
   * Process array of items in batches
   * @param {Array} items - Items to process
   * @param {Function} processor - Processing function
   * @param {number} batchSize - Batch size
   * @param {object} options - Processing options
   * @returns {Promise<Array>} Processed items
   */
  static async processBatch(items, processor, batchSize = 10, options = {}) {
    const { parallel = false, stopOnError = false } = options;
    const results = [];
    const errors = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      if (parallel) {
        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map(item => processor(item))
        );

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            errors.push({ item: batch[index], error: result.reason });
            if (stopOnError) {
              throw result.reason;
            }
          }
        });
      } else {
        // Process batch sequentially
        for (const item of batch) {
          try {
            const result = await processor(item);
            results.push(result);
          } catch (error) {
            errors.push({ item, error });
            if (stopOnError) {
              throw error;
            }
          }
        }
      }
    }

    return {
      results,
      errors,
      total: items.length,
      processed: results.length,
      failed: errors.length
    };
  }

  /**
   * Process with concurrency control
   * @param {Array} items - Items to process
   * @param {Function} processor - Processing function
   * @param {number} concurrency - Max concurrent operations
   * @returns {Promise<Array>} Processed items
   */
  static async processWithConcurrency(items, processor, concurrency = 5) {
    const results = [];
    const executing = [];

    for (const item of items) {
      const promise = Promise.resolve(processor(item)).then(result => {
        results.push(result);
        executing.splice(executing.indexOf(promise), 1);
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }
}

/**
 * Data Aggregation Service
 * Aggregate data from multiple sources
 */
class DataAggregationService {
  /**
   * Aggregate comics from multiple providers
   * @param {Array} results - Array of results from different providers
   * @param {object} options - Aggregation options
   * @returns {Array} Aggregated comics
   */
  static aggregateComics(results, options = {}) {
    const {
      deduplicate = true,
      mergeStrategy = 'priority', // 'priority', 'merge', 'first'
      priorityOrder = [],
      sortBy = 'qualityScore',
      limit = null
    } = options;

    if (!Array.isArray(results)) {
      return [];
    }

    let aggregated = [];

    // Flatten results
    results.forEach((result, index) => {
      if (!result || typeof result !== 'object') {
        return;
      }
      
      const provider = result.provider || `provider_${index}`;
      let comics = [];
      
      if (Array.isArray(result.data)) {
        comics = result.data;
      } else if (result.data && typeof result.data === 'object' && Array.isArray(result.data.data)) {
        comics = result.data.data;
      } else if (result.data && typeof result.data === 'object') {
        // Single object, wrap in array
        comics = [result.data];
      }

      comics.forEach(comic => {
        if (comic && typeof comic === 'object') {
          aggregated.push({
            ...comic,
            _source: provider,
            _priority: priorityOrder.indexOf(provider) !== -1 
              ? priorityOrder.indexOf(provider) 
              : priorityOrder.length + index
          });
        }
      });
    });

    // Deduplicate if needed
    if (deduplicate) {
      aggregated = this.deduplicateComics(aggregated, mergeStrategy);
    }

    // Sort
    if (sortBy) {
      aggregated = this.sortComics(aggregated, sortBy);
    }

    // Limit
    if (limit && limit > 0) {
      aggregated = aggregated.slice(0, limit);
    }

    return aggregated;
  }

  /**
   * Deduplicate comics
   * @param {Array} comics - Comics array
   * @param {string} strategy - Merge strategy
   * @returns {Array} Deduplicated comics
   */
  static deduplicateComics(comics, strategy = 'priority') {
    const map = new Map();

    comics.forEach(comic => {
      const key = this.getComicKey(comic);
      const existing = map.get(key);

      if (!existing) {
        map.set(key, comic);
      } else {
        // Merge based on strategy
        if (strategy === 'priority') {
          if (comic._priority < existing._priority) {
            map.set(key, comic);
          }
        } else if (strategy === 'merge') {
          map.set(key, this.mergeComics(existing, comic));
        }
        // 'first' strategy: keep existing (do nothing)
      }
    });

    return Array.from(map.values());
  }

  /**
   * Get unique key for comic
   * @param {object} comic - Comic item
   * @returns {string} Unique key
   */
  static getComicKey(comic) {
    if (!comic || typeof comic !== 'object') {
      return '';
    }
    
    // Try to create key from title (normalized)
    const title = (comic.title || '').toLowerCase().trim();
    const href = (comic.href || '').toLowerCase().trim();
    
    // Use href if available, otherwise use title
    return href || title || '';
  }

  /**
   * Merge two comics
   * @param {object} comic1 - First comic
   * @param {object} comic2 - Second comic
   * @returns {object} Merged comic
   */
  static mergeComics(comic1, comic2) {
    if (!comic1 || typeof comic1 !== 'object') return comic2 || {};
    if (!comic2 || typeof comic2 !== 'object') return comic1 || {};
    
    return {
      ...comic1,
      ...comic2,
      // Merge arrays
      genre: this.mergeArrays(comic1.genre, comic2.genre),
      chapter: this.mergeArrays(comic1.chapter, comic2.chapter),
      // Keep better quality data
      thumbnail: comic2.thumbnail || comic1.thumbnail,
      description: comic2.description || comic1.description,
      rating: Math.max(parseFloat(comic1.rating) || 0, parseFloat(comic2.rating) || 0),
      // Track sources
      _sources: [...(Array.isArray(comic1._sources) ? comic1._sources : (comic1._source ? [comic1._source] : [])), comic2._source].filter(Boolean)
    };
  }

  /**
   * Merge two arrays, removing duplicates
   * @param {Array} arr1 - First array
   * @param {Array} arr2 - Second array
   * @returns {Array} Merged array
   */
  static mergeArrays(arr1, arr2) {
    if (!Array.isArray(arr1)) arr1 = [];
    if (!Array.isArray(arr2)) arr2 = [];

    const merged = [...arr1];
    arr2.forEach(item => {
      const exists = merged.some(existing => {
        if (typeof item === 'string' && typeof existing === 'string') {
          return item.toLowerCase() === existing.toLowerCase();
        }
        if (typeof item === 'object' && typeof existing === 'object') {
          return item.title === existing.title || item.href === existing.href;
        }
        return item === existing;
      });

      if (!exists) {
        merged.push(item);
      }
    });

    return merged;
  }

  /**
   * Sort comics
   * @param {Array} comics - Comics array
   * @param {string} sortBy - Sort field
   * @returns {Array} Sorted comics
   */
  static sortComics(comics, sortBy) {
    if (!Array.isArray(comics)) {
      return [];
    }
    
    const sorted = [...comics];

    sorted.sort((a, b) => {
      if (!a || typeof a !== 'object') return 1;
      if (!b || typeof b !== 'object') return -1;
      
      let aVal = a[sortBy];
      if (aVal === undefined && a.metadata) {
        aVal = a.metadata[sortBy];
      }
      aVal = aVal !== undefined && aVal !== null ? aVal : 0;
      
      let bVal = b[sortBy];
      if (bVal === undefined && b.metadata) {
        bVal = b.metadata[sortBy];
      }
      bVal = bVal !== undefined && bVal !== null ? bVal : 0;

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal || '').toString().toLowerCase();
      }

      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });

    return sorted;
  }
}

module.exports = {
  DataProcessor,
  DataEnrichmentService,
  BatchProcessor,
  DataAggregationService
};

