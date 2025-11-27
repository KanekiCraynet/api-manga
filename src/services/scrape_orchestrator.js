/**
 * Scrape Orchestrator Service
 * Manages scraping operations with intelligent retry, data integrity, and queue management
 */

const { requestQueue } = require('./request_queue');
const { dataIntegrityService } = require('./data_integrity');
const cacheService = require('../helper/cache_service');
const { executeScraper, listProviders } = require('./provider_manager');

class ScrapeOrchestrator {
  constructor() {
    this.activeOperations = new Map();
    this.operationHistory = [];
    this.maxHistorySize = 100;
    
    // Stale thresholds per data type (in ms)
    this.staleThresholds = {
      latest: 3 * 60 * 1000,     // 3 minutes for latest
      popular: 10 * 60 * 1000,   // 10 minutes for popular
      recommended: 10 * 60 * 1000,
      search: 2 * 60 * 1000,     // 2 minutes for search
      detail: 15 * 60 * 1000,    // 15 minutes for detail
      chapter: 30 * 60 * 1000,   // 30 minutes for chapter
      genre: 15 * 60 * 1000
    };

    // Provider health tracking
    this.providerHealth = new Map();
  }

  /**
   * Scrape with full orchestration
   * @param {object} options - Scrape options
   * @returns {Promise<object>} Scrape result
   */
  async scrape(options = {}) {
    const {
      operation,
      providerId,
      args = [],
      forceRefresh = false,
      priority = false,
      skipCache = false,
      deduplication = true
    } = options;

    const operationKey = this.generateOperationKey(operation, providerId, args);
    const startTime = Date.now();

    try {
      // Check if operation is already running
      if (this.activeOperations.has(operationKey)) {
        return this.activeOperations.get(operationKey);
      }

      // Check cache first (unless skipped or force refresh)
      if (!skipCache && !forceRefresh) {
        const cached = this.getCachedData(operationKey, operation);
        if (cached) {
          return {
            success: true,
            data: cached,
            source: 'cache',
            provider: providerId,
            fromCache: true
          };
        }
      }

      // Check freshness
      const freshnessKey = `${providerId}_${operation}`;
      const threshold = this.staleThresholds[operation] || 5 * 60 * 1000;
      const isStale = dataIntegrityService.isStale(freshnessKey, threshold);

      if (!isStale && !forceRefresh) {
        const cached = this.getCachedData(operationKey, operation);
        if (cached) {
          return {
            success: true,
            data: cached,
            source: 'cache',
            provider: providerId,
            fromCache: true,
            fresh: true
          };
        }
      }

      // Create scrape promise
      const scrapePromise = this.executeScrape({
        operation,
        providerId,
        args,
        priority,
        operationKey
      });

      // Track active operation
      this.activeOperations.set(operationKey, scrapePromise);

      const result = await scrapePromise;

      // Process result with deduplication
      let processedData = result;
      if (deduplication && Array.isArray(result)) {
        const dedupeResult = dataIntegrityService.deduplicate(result, {
          context: operationKey,
          strategy: 'best_quality',
          fields: ['title', 'href']
        });
        processedData = dedupeResult.items;
        
        // Log deduplication stats
        if (dedupeResult.stats.duplicates > 0) {
          console.log(`Deduplication: ${dedupeResult.stats.duplicates} duplicates removed from ${operation}`);
        }
      } else if (result && typeof result === 'object' && result.data && Array.isArray(result.data)) {
        const dedupeResult = dataIntegrityService.deduplicate(result.data, {
          context: operationKey,
          strategy: 'best_quality',
          fields: ['title', 'href']
        });
        processedData = { ...result, data: dedupeResult.items };
      }

      // Validate data integrity
      const validation = dataIntegrityService.validateIntegrity(
        Array.isArray(processedData) ? processedData : processedData?.data || []
      );

      if (!validation.valid) {
        console.warn(`Data integrity warnings for ${operation}:`, validation.warnings);
      }

      // Update freshness
      dataIntegrityService.updateFreshness(freshnessKey, {
        operation,
        provider: providerId,
        itemCount: Array.isArray(processedData) ? processedData.length : 
          (processedData?.data?.length || 0)
      });

      // Cache result
      if (!skipCache) {
        this.cacheResult(operationKey, operation, processedData);
      }

      // Update provider health
      this.updateProviderHealth(providerId, true, Date.now() - startTime);

      // Log to history
      this.logOperation({
        operation,
        providerId,
        success: true,
        duration: Date.now() - startTime,
        itemCount: Array.isArray(processedData) ? processedData.length : 
          (processedData?.data?.length || 0)
      });

      return {
        success: true,
        data: processedData,
        source: 'scrape',
        provider: providerId,
        fromCache: false,
        duration: Date.now() - startTime
      };

    } catch (error) {
      // Update provider health
      this.updateProviderHealth(providerId, false, Date.now() - startTime);

      // Log to history
      this.logOperation({
        operation,
        providerId,
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      });

      throw error;
    } finally {
      this.activeOperations.delete(operationKey);
    }
  }

  /**
   * Execute scrape operation through request queue
   */
  async executeScrape({ operation, providerId, args, priority, operationKey }) {
    return requestQueue.enqueue(
      async () => {
        return executeScraper(providerId, operation, ...args);
      },
      {
        priority,
        providerId,
        operation
      }
    );
  }

  /**
   * Scrape from multiple providers with aggregation
   * @param {object} options - Multi-provider options
   * @returns {Promise<object>} Aggregated result
   */
  async scrapeMultiProvider(options = {}) {
    const {
      operation,
      providers = null,
      args = [],
      aggregateStrategy = 'merge',
      failureThreshold = 0.5, // Allow up to 50% provider failures
      timeout = 30000
    } = options;

    // Get providers list
    let providersList = providers;
    if (!providersList || providersList.length === 0) {
      providersList = listProviders()
        .filter(p => this.isProviderHealthy(p.id))
        .map(p => p.id);
    }

    if (providersList.length === 0) {
      throw new Error('No healthy providers available');
    }

    const startTime = Date.now();
    const results = [];
    const errors = [];

    // Execute scrapes in parallel with individual timeouts
    const promises = providersList.map(async (providerId) => {
      try {
        const result = await Promise.race([
          this.scrape({
            operation,
            providerId,
            args,
            deduplication: false // We'll deduplicate after aggregation
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Provider timeout')), timeout)
          )
        ]);

        return { providerId, success: true, result };
      } catch (error) {
        return { providerId, success: false, error: error.message };
      }
    });

    const settled = await Promise.allSettled(promises);

    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          results.push(result.value);
        } else {
          errors.push(result.value);
        }
      } else {
        errors.push({ success: false, error: result.reason?.message || 'Unknown error' });
      }
    });

    // Check failure threshold
    const failureRate = errors.length / providersList.length;
    if (failureRate > failureThreshold && results.length === 0) {
      throw new Error(`Too many provider failures: ${errors.length}/${providersList.length}`);
    }

    // Aggregate results
    let aggregatedData = this.aggregateResults(results, aggregateStrategy);

    // Apply advanced deduplication
    if (Array.isArray(aggregatedData)) {
      const dedupeResult = dataIntegrityService.deduplicate(aggregatedData, {
        context: `multi_${operation}`,
        strategy: 'best_quality',
        fields: ['title', 'href']
      });
      aggregatedData = dedupeResult.items;
    }

    // Detect new items
    const newItemsResult = dataIntegrityService.detectNewItems(
      aggregatedData,
      `multi_${operation}`
    );

    return {
      success: results.length > 0,
      data: aggregatedData,
      providers: {
        requested: providersList,
        successful: results.map(r => r.providerId),
        failed: errors.map(e => e.providerId).filter(Boolean)
      },
      newItems: newItemsResult.newItems.length,
      duration: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Aggregate results from multiple providers
   */
  aggregateResults(results, strategy) {
    if (results.length === 0) return [];

    let allData = [];

    results.forEach(({ result, providerId }) => {
      if (!result || !result.data) return;

      let data = result.data;
      
      // Handle paginated results
      if (data.data && Array.isArray(data.data)) {
        data = data.data;
      }

      if (Array.isArray(data)) {
        data.forEach(item => {
          if (item && typeof item === 'object') {
            allData.push({
              ...item,
              _source: providerId
            });
          }
        });
      }
    });

    return allData;
  }

  /**
   * Paginated scrape with data integrity
   * @param {object} options - Pagination options
   * @returns {Promise<object>} All pages data
   */
  async scrapePaginated(options = {}) {
    const {
      operation,
      providerId,
      maxPages = 10,
      startPage = 1,
      stopOnEmpty = true,
      stopOnDuplicate = true,
      duplicateThreshold = 0.8 // Stop if 80% duplicates
    } = options;

    const allData = [];
    const pageResults = [];
    let currentPage = startPage;
    let consecutiveEmpty = 0;
    let lastPagination = null;

    while (currentPage <= startPage + maxPages - 1) {
      try {
        const result = await this.scrape({
          operation,
          providerId,
          args: [currentPage],
          deduplication: false,
          skipCache: currentPage > startPage // Only use cache for first page
        });

        let pageData = [];
        let pagination = null;

        if (result.data) {
          if (Array.isArray(result.data)) {
            pageData = result.data;
          } else if (result.data.data && Array.isArray(result.data.data)) {
            pageData = result.data.data;
            pagination = {
              current_page: result.data.current_page,
              length_page: result.data.length_page
            };
          }
        }

        // Check for empty page
        if (pageData.length === 0) {
          consecutiveEmpty++;
          if (stopOnEmpty && consecutiveEmpty >= 2) {
            console.log(`Stopping pagination at page ${currentPage}: empty results`);
            break;
          }
        } else {
          consecutiveEmpty = 0;
        }

        // Check for duplicates
        if (stopOnDuplicate && allData.length > 0 && pageData.length > 0) {
          const dedupeResult = dataIntegrityService.deduplicate(
            [...allData, ...pageData],
            { strategy: 'first', fields: ['title', 'href'] }
          );
          
          const newItems = dedupeResult.items.length - allData.length;
          const duplicateRate = 1 - (newItems / pageData.length);
          
          if (duplicateRate >= duplicateThreshold) {
            console.log(`Stopping pagination at page ${currentPage}: ${(duplicateRate * 100).toFixed(0)}% duplicates`);
            break;
          }
        }

        allData.push(...pageData);
        pageResults.push({
          page: currentPage,
          count: pageData.length,
          success: true
        });

        lastPagination = pagination;

        // Check if we've reached the last page
        if (pagination && currentPage >= pagination.length_page) {
          break;
        }

        currentPage++;

      } catch (error) {
        pageResults.push({
          page: currentPage,
          count: 0,
          success: false,
          error: error.message
        });

        // Stop on error
        if (stopOnEmpty) {
          console.log(`Stopping pagination at page ${currentPage}: ${error.message}`);
          break;
        }
        
        currentPage++;
      }
    }

    // Final deduplication
    const dedupeResult = dataIntegrityService.deduplicate(allData, {
      context: `paginated_${operation}`,
      strategy: 'best_quality',
      fields: ['title', 'href']
    });

    return {
      success: allData.length > 0,
      data: dedupeResult.items,
      pagination: lastPagination,
      pageResults,
      stats: {
        totalPages: pageResults.length,
        successfulPages: pageResults.filter(p => p.success).length,
        totalItems: allData.length,
        uniqueItems: dedupeResult.items.length,
        duplicatesRemoved: dedupeResult.stats.duplicates
      }
    };
  }

  /**
   * Generate operation key for caching/tracking
   */
  generateOperationKey(operation, providerId, args) {
    const argsStr = args.map(a => String(a)).join('_');
    return `${providerId}:${operation}:${argsStr}`;
  }

  /**
   * Get cached data
   */
  getCachedData(key, operation) {
    const cacheKey = `scrape_${key}`;
    return cacheService.get(cacheKey);
  }

  /**
   * Cache result
   */
  cacheResult(key, operation, data) {
    const cacheKey = `scrape_${key}`;
    const ttl = this.staleThresholds[operation] || 5 * 60 * 1000;
    cacheService.set(cacheKey, data, ttl);
  }

  /**
   * Update provider health metrics
   */
  updateProviderHealth(providerId, success, responseTime) {
    let health = this.providerHealth.get(providerId) || {
      successCount: 0,
      failureCount: 0,
      totalResponseTime: 0,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0
    };

    if (success) {
      health.successCount++;
      health.lastSuccess = Date.now();
      health.consecutiveFailures = 0;
      health.totalResponseTime += responseTime;
    } else {
      health.failureCount++;
      health.lastFailure = Date.now();
      health.consecutiveFailures++;
    }

    this.providerHealth.set(providerId, health);
  }

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(providerId) {
    const health = this.providerHealth.get(providerId);
    if (!health) return true; // New provider, assume healthy
    
    // Unhealthy if 5 consecutive failures
    if (health.consecutiveFailures >= 5) return false;
    
    // Unhealthy if failure rate > 50% (min 10 requests)
    const total = health.successCount + health.failureCount;
    if (total >= 10 && health.failureCount / total > 0.5) return false;
    
    return true;
  }

  /**
   * Log operation to history
   */
  logOperation(entry) {
    this.operationHistory.unshift({
      ...entry,
      timestamp: Date.now()
    });

    // Trim history
    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory.pop();
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    const queueStats = requestQueue.getStats();
    const integrityStats = dataIntegrityService.getStats();

    const providerStats = {};
    this.providerHealth.forEach((health, providerId) => {
      const total = health.successCount + health.failureCount;
      providerStats[providerId] = {
        ...health,
        successRate: total > 0 ? ((health.successCount / total) * 100).toFixed(2) + '%' : 'N/A',
        avgResponseTime: health.successCount > 0 ? 
          Math.round(health.totalResponseTime / health.successCount) + 'ms' : 'N/A',
        healthy: this.isProviderHealthy(providerId)
      };
    });

    return {
      queue: queueStats,
      integrity: integrityStats,
      providers: providerStats,
      activeOperations: this.activeOperations.size,
      recentOperations: this.operationHistory.slice(0, 10)
    };
  }
}

// Singleton instance
const scrapeOrchestrator = new ScrapeOrchestrator();

module.exports = {
  ScrapeOrchestrator,
  scrapeOrchestrator
};
