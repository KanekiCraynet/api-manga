/**
 * Advanced API Service
 * Integrates all processing components untuk efficient data handling
 * Enhanced with request queue, data integrity, and scrape orchestration
 */

const { DataProcessor, DataEnrichmentService, BatchProcessor, DataAggregationService } = require('./data_processor');
const QueryBuilder = require('./query_builder');
const ParallelProcessor = require('./parallel_processor');
const ResponseOptimizer = require('./response_optimizer');
const { executeScraper, listProviders } = require('./provider_manager');
const { scrapeOrchestrator } = require('./scrape_orchestrator');
const { dataIntegrityService } = require('./data_integrity');
const { requestQueue } = require('./request_queue');

/**
 * Advanced API Service
 * Main service untuk mengolah data dengan pipeline yang kompleks
 */
class ApiService {
  constructor() {
    this.processor = new DataProcessor();
    this.setupPipeline();
  }

  /**
   * Setup default processing pipeline
   */
  setupPipeline() {
    // Validation stage
    this.processor.addStage('validate', (data, context) => {
      if (!data) {
        throw new Error('No data provided');
      }
      return data;
    });

    // Normalization stage
    this.processor.addStage('normalize', (data, context) => {
      if (Array.isArray(data)) {
        return data.map(item => this.normalizeItem(item));
      }
      return this.normalizeItem(data);
    });

    // Enrichment stage
    this.processor.addStage('enrich', (data, context) => {
      if (Array.isArray(data)) {
        return data.map(item => DataEnrichmentService.enrichComic(item, {
          includeSearchable: true,
          normalize: true,
          includeTimestamps: true
        }));
      }
      return DataEnrichmentService.enrichComic(data, {
        includeSearchable: true,
        normalize: true,
        includeTimestamps: true
      });
    });
  }

  /**
   * Normalize item
   * @param {object} item - Item to normalize
   * @returns {object} Normalized item
   */
  normalizeItem(item) {
    // Basic normalization - can be extended
    return item;
  }

  /**
   * Get latest comics with advanced processing
   * Enhanced with orchestration, data integrity, and smart caching
   * @param {object} options - Query options
   * @returns {Promise<object>} Processed comics
   */
  async getLatestComics(options = {}) {
    const {
      page = 1,
      provider = null,
      providers = null,
      query = {},
      enrich = true,
      optimize = true,
      forceRefresh = false,
      getAllPages = false,
      maxPages = 5
    } = options;

    const context = { page, provider, query };

    // Determine providers to use
    let providersList = [];
    if (providers && Array.isArray(providers)) {
      providersList = providers;
    } else if (provider) {
      providersList = [provider];
    } else {
      const allProviders = listProviders();
      providersList = allProviders.map(p => p.id);
    }

    let result;
    let comics = [];
    let pagination = { current_page: page, length_page: 1 };

    try {
      if (providersList.length > 1) {
        // Multi-provider scraping with orchestration
        result = await scrapeOrchestrator.scrapeMultiProvider({
          operation: 'getLatestComics',
          providers: providersList,
          args: [page],
          aggregateStrategy: 'merge',
          failureThreshold: 0.7
        });

        if (result.success && result.data) {
          comics = Array.isArray(result.data) ? result.data : [];
        }
      } else if (getAllPages) {
        // Paginated scraping for single provider
        result = await scrapeOrchestrator.scrapePaginated({
          operation: 'getLatestComics',
          providerId: providersList[0],
          maxPages,
          startPage: page,
          stopOnEmpty: true,
          stopOnDuplicate: true,
          duplicateThreshold: 0.7
        });

        if (result.success && result.data) {
          comics = result.data;
          pagination = result.pagination || pagination;
        }
      } else {
        // Single provider, single page
        result = await scrapeOrchestrator.scrape({
          operation: 'getLatestComics',
          providerId: providersList[0],
          args: [page],
          forceRefresh,
          deduplication: true
        });

        if (result.success && result.data) {
          if (Array.isArray(result.data)) {
            comics = result.data;
          } else if (result.data.data && Array.isArray(result.data.data)) {
            comics = result.data.data;
            pagination = {
              current_page: result.data.current_page || page,
              length_page: result.data.length_page || 1
            };
          }
        }
      }

      // Detect new items for tracking
      const newItemsDetection = dataIntegrityService.detectNewItems(comics, 'latest_comics');
      context.newItems = newItemsDetection.stats;

    } catch (error) {
      console.error('Scraping error:', error.message);
      result = {
        success: false,
        data: [],
        error: error.message
      };
    }

    // Apply query builder for filtering/sorting
    if (Object.keys(query).length > 0 && comics.length > 0) {
      try {
        const queryBuilder = QueryBuilder.fromQuery(query);
        const queryResult = queryBuilder.execute(comics);
        comics = Array.isArray(queryResult.data) ? queryResult.data : comics;
        context.pagination = {
          current_page: queryResult.page || page,
          length_page: queryResult.totalPages || 1,
          total: queryResult.total || comics.length
        };
      } catch (error) {
        console.error('Query builder error:', error.message);
      }
    }

    // Process through enrichment pipeline
    if (enrich && comics.length > 0) {
      try {
        comics = await this.processor.process(comics, context);
        comics = Array.isArray(comics) ? comics : [];
      } catch (error) {
        console.error('Pipeline processing error:', error.message);
      }
    }

    // Optimize response
    if (optimize && comics.length > 0) {
      try {
        comics = ResponseOptimizer.optimize(comics, {
          removeNulls: true,
          removeEmpty: false
        });
        comics = Array.isArray(comics) ? comics : [];
      } catch (error) {
        console.error('Response optimization error:', error.message);
      }
    }

    return {
      status: 'success',
      data: comics,
      pagination: context.pagination || pagination,
      metadata: {
        providers: result?.providers?.successful || providersList,
        processed: comics.length,
        fromCache: result?.fromCache || false,
        newItems: context.newItems?.new || 0,
        source: result?.source || 'unknown',
        ...(result?.errors?.length > 0 ? { providerErrors: result.errors } : {})
      }
    };
  }

  /**
   * Search comics with advanced processing
   * Enhanced with orchestration and data integrity
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async searchComics(options = {}) {
    const {
      keyword,
      provider = null,
      providers = null,
      query = {},
      enrich = true,
      optimize = true,
      forceRefresh = false
    } = options;

    if (!keyword) {
      throw new Error('Keyword is required');
    }

    const context = { keyword, provider, query };

    // Determine providers
    let providersList = [];
    if (providers && Array.isArray(providers)) {
      providersList = providers;
    } else if (provider) {
      providersList = [provider];
    } else {
      const allProviders = listProviders();
      providersList = allProviders.map(p => p.id);
    }

    let result;
    let comics = [];

    try {
      if (providersList.length > 1) {
        // Multi-provider search
        result = await scrapeOrchestrator.scrapeMultiProvider({
          operation: 'searchComics',
          providers: providersList,
          args: [keyword],
          aggregateStrategy: 'merge',
          failureThreshold: 0.7
        });

        if (result.success && result.data) {
          comics = Array.isArray(result.data) ? result.data : [];
        }
      } else {
        // Single provider search
        result = await scrapeOrchestrator.scrape({
          operation: 'searchComics',
          providerId: providersList[0],
          args: [keyword],
          forceRefresh,
          deduplication: true
        });

        if (result.success && result.data) {
          comics = Array.isArray(result.data) ? result.data : 
            (result.data.data || []);
        }
      }

      // Track search results
      dataIntegrityService.updateFreshness(`search_${keyword}`, {
        keyword,
        resultCount: comics.length
      });

    } catch (error) {
      console.error('Search error:', error.message);
      result = {
        success: false,
        data: [],
        error: error.message
      };
    }

    // Apply query builder for additional filtering
    if (Object.keys(query).length > 0 && comics.length > 0) {
      try {
        const queryBuilder = QueryBuilder.fromQuery({ ...query, search: keyword });
        const queryResult = queryBuilder.execute(comics);
        comics = Array.isArray(queryResult.data) ? queryResult.data : comics;
      } catch (error) {
        console.error('Query builder error:', error.message);
      }
    }

    // Process through enrichment pipeline
    if (enrich && comics.length > 0) {
      try {
        comics = await this.processor.process(comics, context);
        comics = Array.isArray(comics) ? comics : [];
      } catch (error) {
        console.error('Pipeline processing error:', error.message);
      }
    }

    // Optimize response
    if (optimize && comics.length > 0) {
      comics = ResponseOptimizer.optimize(comics, {
        removeNulls: true
      });
    }

    return {
      status: 'success',
      data: comics,
      metadata: {
        keyword,
        providers: result?.providers?.successful || providersList,
        total: comics.length,
        fromCache: result?.fromCache || false,
        source: result?.source || 'unknown',
        ...(result?.errors?.length > 0 ? { providerErrors: result.errors } : {})
      }
    };
  }

  /**
   * Get popular comics with advanced processing
   * Enhanced with orchestration and data integrity
   * @param {object} options - Query options
   * @returns {Promise<object>} Popular comics
   */
  async getPopularComics(options = {}) {
    const {
      provider = null,
      providers = null,
      query = {},
      enrich = true,
      optimize = true,
      forceRefresh = false
    } = options;

    const context = { provider, query };

    // Determine providers
    let providersList = [];
    if (providers && Array.isArray(providers)) {
      providersList = providers;
    } else if (provider) {
      providersList = [provider];
    } else {
      const allProviders = listProviders();
      providersList = allProviders.map(p => p.id);
    }

    let result;
    let comics = [];

    try {
      if (providersList.length > 1) {
        // Multi-provider popular comics
        result = await scrapeOrchestrator.scrapeMultiProvider({
          operation: 'getPopularComics',
          providers: providersList,
          args: [],
          aggregateStrategy: 'merge',
          failureThreshold: 0.7
        });

        if (result.success && result.data) {
          comics = Array.isArray(result.data) ? result.data : [];
        }
      } else {
        // Single provider
        result = await scrapeOrchestrator.scrape({
          operation: 'getPopularComics',
          providerId: providersList[0],
          args: [],
          forceRefresh,
          deduplication: true
        });

        if (result.success && result.data) {
          comics = Array.isArray(result.data) ? result.data : 
            (result.data.data || []);
        }
      }

    } catch (error) {
      console.error('Popular comics error:', error.message);
      result = {
        success: false,
        data: [],
        error: error.message
      };
    }

    // Apply query builder
    if (Object.keys(query).length > 0 && comics.length > 0) {
      try {
        const queryBuilder = QueryBuilder.fromQuery(query);
        const queryResult = queryBuilder.execute(comics);
        comics = Array.isArray(queryResult.data) ? queryResult.data : comics;
      } catch (error) {
        console.error('Query builder error:', error.message);
      }
    }

    // Process through enrichment pipeline
    if (enrich && comics.length > 0) {
      try {
        comics = await this.processor.process(comics, context);
        comics = Array.isArray(comics) ? comics : [];
      } catch (error) {
        console.error('Pipeline processing error:', error.message);
      }
    }

    // Optimize response
    if (optimize && comics.length > 0) {
      try {
        comics = ResponseOptimizer.optimize(comics, {
          removeNulls: true
        });
        comics = Array.isArray(comics) ? comics : [];
      } catch (error) {
        console.error('Response optimization error:', error.message);
      }
    }

    return {
      status: 'success',
      data: comics,
      metadata: {
        providers: result?.providers?.successful || providersList,
        total: comics.length,
        fromCache: result?.fromCache || false,
        source: result?.source || 'unknown',
        ...(result?.errors?.length > 0 ? { providerErrors: result.errors } : {})
      }
    };
  }

  /**
   * Get recommended comics with advanced processing
   * @param {object} options - Query options
   * @returns {Promise<object>} Recommended comics
   */
  async getRecommendedComics(options = {}) {
    return this.getPopularComics({ ...options }); // Similar processing
  }

  /**
   * Get comic detail with advanced processing
   * Enhanced with orchestration and data integrity
   * @param {object} options - Detail options
   * @returns {Promise<object>} Comic detail
   */
  async getComicDetail(options = {}) {
    const {
      url,
      provider = null,
      enrich = true,
      optimize = true,
      forceRefresh = false
    } = options;

    if (!url) {
      throw new Error('URL is required');
    }

    const context = { url, provider };
    const providersList = provider ? [provider] : listProviders().map(p => p.id);
    
    let result;
    let comic = {};

    try {
      // Try single provider or fallback
      for (const providerId of providersList) {
        try {
          result = await scrapeOrchestrator.scrape({
            operation: 'getComicDetail',
            providerId,
            args: [url],
            forceRefresh,
            deduplication: false
          });

          if (result.success && result.data) {
            comic = result.data;
            break;
          }
        } catch (error) {
          console.warn(`Provider ${providerId} failed for detail: ${error.message}`);
          continue;
        }
      }

      if (!comic || Object.keys(comic).length === 0) {
        throw new Error('Failed to get comic detail from any provider');
      }

      // Mark comic as processed with hash
      const comicHash = dataIntegrityService.generateHash(comic, ['title', 'href']);
      dataIntegrityService.markProcessed(comicHash, 'comic_detail', {
        url,
        provider: result?.provider
      });

    } catch (error) {
      console.error('Comic detail error:', error.message);
      throw new Error(`Failed to get comic detail: ${error.message}`);
    }

    // Process through enrichment pipeline
    if (enrich && comic && typeof comic === 'object') {
      try {
        comic = await this.processor.process(comic, context);
        comic = comic && typeof comic === 'object' ? comic : {};
      } catch (error) {
        console.error('Pipeline processing error:', error.message);
      }
    }

    // Enrich and deduplicate chapters
    if (comic && comic.chapter && Array.isArray(comic.chapter)) {
      try {
        // Deduplicate chapters
        const chapterDedupe = dataIntegrityService.deduplicate(comic.chapter, {
          fields: ['title', 'href'],
          strategy: 'first',
          context: `chapters_${url}`
        });

        comic.chapter = chapterDedupe.items.map(ch => {
          if (ch && typeof ch === 'object') {
            return DataEnrichmentService.enrichChapter(ch);
          }
          return ch;
        }).filter(Boolean);

        // Add chapter stats
        comic.chapterStats = {
          total: comic.chapter.length,
          duplicatesRemoved: chapterDedupe.stats.duplicates
        };
      } catch (error) {
        console.error('Chapter enrichment error:', error.message);
      }
    }

    // Optimize response
    if (optimize && comic && typeof comic === 'object') {
      try {
        comic = ResponseOptimizer.optimize(comic, {
          removeNulls: true
        });
        comic = comic && typeof comic === 'object' ? comic : {};
      } catch (error) {
        console.error('Response optimization error:', error.message);
      }
    }

    return {
      status: 'success',
      data: comic,
      metadata: {
        provider: result?.provider || providersList[0],
        fromCache: result?.fromCache || false,
        source: result?.source || 'unknown'
      }
    };
  }

  /**
   * Get orchestrator and integrity statistics
   * @returns {object} System statistics
   */
  getSystemStats() {
    return {
      orchestrator: scrapeOrchestrator.getStats(),
      requestQueue: requestQueue.getStats(),
      dataIntegrity: dataIntegrityService.getStats()
    };
  }
}

// Export singleton instance
const apiService = new ApiService();

module.exports = apiService;
