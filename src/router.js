const router = require('express')();
const { responseApi } = require('./helper/response_api');
const { asyncHandler, errorHandler } = require('./helper/error_handler');
const cacheService = require('./helper/cache_service');
const { defaultRateLimiter, strictRateLimiter } = require('./middleware/rate_limiter');
const { performanceMiddleware, performanceMonitor } = require('./middleware/performance');
const { validatePage, validateKeyword, validateSort } = require('./middleware/validator');
const { filterItems, sortItems } = require('./helper/data_validator');
const {
  getLatestComics,
  getComicsByGenre,
  getGenres,
  getComicDetail,
  readChapter,
  searchComics,
  getPopularComics,
  getRecommendedComics
} = require('./services/scraper_service');
const { listProviders, getProviderInfo } = require('./services/provider_manager');
const apiService = require('./services/api_service');
const QueryBuilder = require('./services/query_builder');
const dashboardService = require('./services/dashboard_service');

// Apply performance monitoring to all routes
router.use(performanceMiddleware);

// Root endpoint
router.get('/', (req, res) => {
  return res.status(200).json({
    status: 'success',
    message: 'Welcome to Komikcast API. See https://github.com/KanekiCraynet/api-manga for documentation',
    version: '2.1.0'
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  const cacheStats = cacheService.getStats();
  const perfStats = performanceMonitor.getStats();
  
  return res.status(200).json({
    status: 'success',
    data: {
      uptime: perfStats.uptime,
      cache: cacheStats,
      performance: {
        totalRequests: perfStats.totalRequests,
        avgResponseTime: perfStats.avgResponseTime,
        cacheHitRate: perfStats.cacheHitRate,
        errorRate: perfStats.errorRate
      }
    }
  });
});

// Providers list endpoint
router.get('/providers',
  defaultRateLimiter,
  cacheService.middleware(15 * 60 * 1000),
  (req, res) => {
    const providers = listProviders();
    return responseApi(res, 200, 'success', providers);
  }
);

// Provider info endpoint (singular - for backward compatibility)
router.get('/provider',
  defaultRateLimiter,
  cacheService.middleware(15 * 60 * 1000),
  (req, res) => {
    // Redirect to /providers for backward compatibility
    const providers = listProviders();
    return responseApi(res, 200, 'success', providers);
  }
);

// Single provider info endpoint
router.get('/provider/:id',
  defaultRateLimiter,
  cacheService.middleware(15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const provider = getProviderInfo(id.toLowerCase());
    
    if (!provider) {
      return responseApi(res, 404, 'Provider not found');
    }
    
    return responseApi(res, 200, 'success', provider);
  })
);

// Latest comics endpoint with caching (5 minutes) - Enhanced version
router.get('/terbaru',
  defaultRateLimiter,
  cacheService.middleware(5 * 60 * 1000),
  validatePage,
  validateSort,
  asyncHandler(async (req, res) => {
    const { 
      page, 
      sortBy, 
      sortOrder, 
      genre, 
      type, 
      status, 
      minRating, 
      maxRating,
      provider,
      providers, // Multiple providers (comma-separated)
      advanced, // Use advanced processing
      enrich, // Enable data enrichment
      optimize, // Enable response optimization
      forceRefresh, // Force bypass cache
      getAllPages, // Scrape multiple pages
      maxPages // Max pages to scrape (for getAllPages)
    } = req.query;

    // Use advanced processing if requested
    if (advanced === 'true' || advanced === '1') {
      const providersList = providers ? providers.split(',') : null;
      const result = await apiService.getLatestComics({
        page: parseInt(page) || 1,
        provider,
        providers: providersList,
        query: {
          page: parseInt(page) || 1,
          pageSize: parseInt(req.query.pageSize) || parseInt(req.query.limit) || 10,
          sortBy,
          sortOrder,
          genre,
          type,
          status,
          minRating: minRating ? parseFloat(minRating) : undefined,
          maxRating: maxRating ? parseFloat(maxRating) : undefined
        },
        enrich: enrich !== 'false',
        optimize: optimize !== 'false',
        forceRefresh: forceRefresh === 'true' || forceRefresh === '1',
        getAllPages: getAllPages === 'true' || getAllPages === '1',
        maxPages: maxPages ? parseInt(maxPages) : 5
      });

      return res.status(200).json(result);
    }

    // Legacy processing (backward compatibility)
    try {
      const result = await getLatestComics(page || 1, provider);
      
      let comics = result?.data || [];
      
      // Apply filters
      if (genre || type || status || minRating) {
        comics = filterItems(comics, {
          genre,
          type,
          status,
          minRating: minRating ? parseFloat(minRating) : undefined
        });
      }
      
      // Apply sorting
      if (sortBy) {
        comics = sortItems(comics, sortBy, sortOrder);
      }
      
      return res.status(200).json({
        status: 'success',
        current_page: result?.current_page || 1,
        length_page: result?.length_page || 1,
        has_next: (result?.current_page || 1) < (result?.length_page || 1),
        has_prev: (result?.current_page || 1) > 1,
        data: comics || []
      });
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Genre list endpoint with caching (15 minutes)
router.get('/genre',
  defaultRateLimiter,
  cacheService.middleware(15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { provider } = req.query;
    try {
      const genres = await getGenres(provider);
      return responseApi(res, 200, 'success', Array.isArray(genres) ? genres : []);
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Comics by genre endpoint with caching (5 minutes)
router.get('/genre/:url',
  defaultRateLimiter,
  cacheService.middleware(5 * 60 * 1000),
  validatePage,
  asyncHandler(async (req, res) => {
    const { url } = req.params;
    const { page, provider } = req.query;
    try {
      const result = await getComicsByGenre(url, page || 1, provider);
      
      return res.status(200).json({
        status: 'success',
        current_page: result?.current_page || 1,
        length_page: result?.length_page || 1,
        has_next: (result?.current_page || 1) < (result?.length_page || 1),
        has_prev: (result?.current_page || 1) > 1,
        data: result?.data || []
      });
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Comic detail endpoint with caching (10 minutes) - Enhanced version
router.get('/detail/:url',
  defaultRateLimiter,
  cacheService.middleware(10 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { url } = req.params;
    const { 
      provider,
      advanced, // Use advanced processing
      enrich, // Enable data enrichment
      optimize // Enable response optimization
    } = req.query;
    
    // Use advanced processing if requested
    if (advanced === 'true' || advanced === '1') {
      const result = await apiService.getComicDetail({
        url,
        provider,
        enrich: enrich !== 'false',
        optimize: optimize !== 'false'
      });

      return res.status(200).json(result);
    }

    // Legacy processing (backward compatibility)
    try {
      const detail = await getComicDetail(url, provider);
      return responseApi(res, 200, 'success', detail || {});
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Read chapter endpoint with caching (15 minutes)
router.get('/read/:url',
  defaultRateLimiter,
  cacheService.middleware(15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { url } = req.params;
    const { provider } = req.query;
    try {
      const chapter = await readChapter(url, provider);
      return responseApi(res, 200, 'success', chapter ? [chapter] : []);
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Search endpoint with strict rate limiting and caching (2 minutes) - Enhanced version
router.get('/search',
  strictRateLimiter,
  cacheService.middleware(2 * 60 * 1000),
  validateKeyword,
  validateSort,
  asyncHandler(async (req, res) => {
    const { 
      keyword, 
      sortBy, 
      sortOrder, 
      genre, 
      type, 
      status, 
      minRating,
      maxRating,
      provider,
      providers, // Multiple providers (comma-separated)
      advanced, // Use advanced processing
      enrich, // Enable data enrichment
      optimize // Enable response optimization
    } = req.query;
    
    // Use advanced processing if requested
    if (advanced === 'true' || advanced === '1') {
      const providersList = providers ? providers.split(',') : null;
      const result = await apiService.searchComics({
        keyword,
        provider,
        providers: providersList,
        query: {
          sortBy,
          sortOrder,
          genre,
          type,
          status,
          minRating: minRating ? parseFloat(minRating) : undefined,
          maxRating: maxRating ? parseFloat(maxRating) : undefined,
          search: keyword
        },
        enrich: enrich !== 'false',
        optimize: optimize !== 'false'
      });

      return res.status(200).json(result);
    }

    // Legacy processing (backward compatibility)
    try {
      let comics = await searchComics(keyword, provider);
      comics = Array.isArray(comics) ? comics : [];
      
      // Apply filters
      if (genre || type || status || minRating) {
        comics = filterItems(comics, {
          genre,
          type,
          status,
          minRating: minRating ? parseFloat(minRating) : undefined
        });
      }
      
      // Apply sorting
      if (sortBy) {
        comics = sortItems(comics, sortBy, sortOrder);
      }
      
      return responseApi(res, 200, 'success', comics);
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Popular comics endpoint with caching (10 minutes) - Enhanced version
router.get('/popular',
  defaultRateLimiter,
  cacheService.middleware(10 * 60 * 1000),
  validateSort,
  asyncHandler(async (req, res) => {
    const { 
      sortBy, 
      sortOrder, 
      genre, 
      type, 
      minRating,
      maxRating,
      provider,
      providers, // Multiple providers (comma-separated)
      advanced, // Use advanced processing
      enrich, // Enable data enrichment
      optimize // Enable response optimization
    } = req.query;
    
    // Use advanced processing if requested
    if (advanced === 'true' || advanced === '1') {
      const providersList = providers ? providers.split(',') : null;
      const result = await apiService.getPopularComics({
        provider,
        providers: providersList,
        query: {
          sortBy,
          sortOrder,
          genre,
          type,
          minRating: minRating ? parseFloat(minRating) : undefined,
          maxRating: maxRating ? parseFloat(maxRating) : undefined
        },
        enrich: enrich !== 'false',
        optimize: optimize !== 'false'
      });

      return res.status(200).json(result);
    }

    // Legacy processing (backward compatibility)
    try {
      let comics = await getPopularComics(provider);
      comics = Array.isArray(comics) ? comics : [];
      
      // Apply filters
      if (genre || type || minRating) {
        comics = filterItems(comics, {
          genre,
          type,
          minRating: minRating ? parseFloat(minRating) : undefined
        });
      }
      
      // Apply sorting
      if (sortBy) {
        comics = sortItems(comics, sortBy, sortOrder);
      }
      
      return responseApi(res, 200, 'success', comics);
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Recommended comics endpoint with caching (10 minutes)
router.get('/recommended',
  defaultRateLimiter,
  cacheService.middleware(10 * 60 * 1000),
  validateSort,
  asyncHandler(async (req, res) => {
    const { sortBy, sortOrder, genre, type, minRating, provider } = req.query;
    
    try {
      let comics = await getRecommendedComics(provider);
      comics = Array.isArray(comics) ? comics : [];
      
      // Apply filters
      if (genre || type || minRating) {
        comics = filterItems(comics, {
          genre,
          type,
          minRating: minRating ? parseFloat(minRating) : undefined
        });
      }
      
      // Apply sorting
      if (sortBy) {
        comics = sortItems(comics, sortBy, sortOrder);
      }
      
      return responseApi(res, 200, 'success', comics);
    } catch (error) {
      // Error will be handled by errorHandler middleware
      throw error;
    }
  })
);

// Dashboard endpoints
// System stats endpoint (for monitoring data integrity, queue, orchestrator)
router.get('/api/system/stats',
  defaultRateLimiter,
  (req, res) => {
    try {
      const stats = apiService.getSystemStats();
      return responseApi(res, 200, 'success', stats);
    } catch (error) {
      return responseApi(res, 500, 'error', { message: error.message });
    }
  }
);

// Dashboard stats endpoint
router.get('/api/dashboard/stats',
  defaultRateLimiter,
  cacheService.middleware(5 * 60 * 1000), // Cache for 5 minutes
  (req, res) => {
    try {
      const stats = dashboardService.getStats();
      return responseApi(res, 200, 'success', stats);
    } catch (error) {
      return responseApi(res, 500, 'error', { message: error.message });
    }
  }
);

// Dashboard analytics endpoint
router.get('/api/dashboard/analytics',
  defaultRateLimiter,
  cacheService.middleware(2 * 60 * 1000), // Cache for 2 minutes
  asyncHandler(async (req, res) => {
    const { period = '1h', endpoint } = req.query;
    
    try {
      const analytics = dashboardService.getAnalytics({ period, endpoint });
      return responseApi(res, 200, 'success', analytics);
    } catch (error) {
      throw error;
    }
  })
);

// Dashboard real-time endpoint (Server-Sent Events)
router.get('/api/dashboard/realtime',
  defaultRateLimiter,
  (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    
    // Send metrics every 2-3 seconds
    const interval = setInterval(() => {
      try {
        const metrics = dashboardService.getRealtimeMetrics();
        res.write(`data: ${JSON.stringify({ type: 'metrics', ...metrics })}\n\n`);
      } catch (error) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      }
    }, 2500); // 2.5 seconds
    
    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  }
);

// Cache management endpoints
router.get('/api/dashboard/cache/manage',
  defaultRateLimiter,
  (req, res) => {
    try {
      const { limit = 50, offset = 0, pattern } = req.query;
      const entries = cacheService.getEntries({
        limit: parseInt(limit),
        offset: parseInt(offset),
        pattern
      });
      
      const stats = cacheService.getStats();
      
      return responseApi(res, 200, 'success', {
        entries,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: stats.total.size
        }
      });
    } catch (error) {
      return responseApi(res, 500, 'error', { message: error.message });
    }
  }
);

router.delete('/api/dashboard/cache/manage',
  defaultRateLimiter,
  (req, res) => {
    try {
      const { pattern } = req.query;
      
      if (pattern === '*' || !pattern) {
        // Clear all cache
        cacheService.clear();
        return responseApi(res, 200, 'success', { message: 'All cache cleared' });
      } else {
        // Clear by pattern
        const deleted = cacheService.invalidatePattern(pattern);
        return responseApi(res, 200, 'success', { 
          message: `Cache cleared for pattern: ${pattern}`,
          deleted 
        });
      }
    } catch (error) {
      return responseApi(res, 500, 'error', { message: error.message });
    }
  }
);

router.post('/api/dashboard/cache/manage/warm',
  defaultRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      const { keys } = req.body;
      
      if (!Array.isArray(keys) || keys.length === 0) {
        return responseApi(res, 400, 'error', { message: 'Keys array is required' });
      }
      
      // Note: This is a placeholder - actual cache warming would need to fetch data
      // For now, we'll just return success
      return responseApi(res, 200, 'success', { 
        message: `Cache warming requested for ${keys.length} keys`,
        keys: keys.length
      });
    } catch (error) {
      throw error;
    }
  })
);

// 404 handler
router.all('*', (req, res) => {
  return responseApi(res, 404, 'route not found');
});

// Error handler (must be last)
router.use(errorHandler);

module.exports = { router };
