/**
 * Edge Cache Middleware
 * HTTP cache headers for Vercel Edge and CDN caching
 * Implements Stale-While-Revalidate pattern for optimal performance
 */

// Detect Vercel environment
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

// Cache TTL presets (in seconds)
const CACHE_PRESETS = {
    // Data that changes frequently
    latest: { maxAge: 60, swr: 300 },      // 1 min fresh, 5 min stale
    search: { maxAge: 30, swr: 120 },      // 30s fresh, 2 min stale

    // Data that changes less frequently
    popular: { maxAge: 300, swr: 600 },    // 5 min fresh, 10 min stale
    recommended: { maxAge: 300, swr: 600 },

    // Static-ish data
    detail: { maxAge: 600, swr: 1800 },    // 10 min fresh, 30 min stale
    chapter: { maxAge: 1800, swr: 3600 },  // 30 min fresh, 1 hour stale
    genre: { maxAge: 3600, swr: 7200 },    // 1 hour fresh, 2 hours stale

    // Default fallback
    default: { maxAge: 60, swr: 300 }
};

/**
 * Set cache headers on response
 * @param {Response} res - Express response object
 * @param {object} options - Cache options
 * @param {number} options.maxAge - Max age in seconds
 * @param {number} options.staleWhileRevalidate - SWR time in seconds
 * @param {boolean} options.private - Private cache (user-specific)
 */
const setCacheHeaders = (res, options = {}) => {
    const {
        maxAge = 60,
        staleWhileRevalidate = 300,
        private: isPrivate = false
    } = options;

    const visibility = isPrivate ? 'private' : 'public';

    // Set Cache-Control for CDN/Edge caching
    res.set('Cache-Control',
        `${visibility}, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
    );

    // Set Vercel-specific headers for edge caching
    if (isVercel) {
        res.set('CDN-Cache-Control', `max-age=${maxAge}`);
        res.set('Vercel-CDN-Cache-Control', `max-age=${maxAge}`);
    }
};

/**
 * Apply cache preset
 * @param {Response} res - Express response object
 * @param {string} preset - Preset name (latest, search, detail, etc)
 */
const applyCachePreset = (res, preset) => {
    const settings = CACHE_PRESETS[preset] || CACHE_PRESETS.default;
    setCacheHeaders(res, {
        maxAge: settings.maxAge,
        staleWhileRevalidate: settings.swr
    });
};

/**
 * Cache middleware factory
 * Creates Express middleware with specified cache settings
 * @param {string|object} optionsOrPreset - Preset name or options object
 * @returns {Function} Express middleware
 */
const cacheMiddleware = (optionsOrPreset = 'default') => {
    return (req, res, next) => {
        // Skip cache for non-GET requests
        if (req.method !== 'GET') {
            res.set('Cache-Control', 'no-store');
            return next();
        }

        // Skip cache if explicitly requested
        if (req.query.nocache === '1' || req.headers['cache-control'] === 'no-cache') {
            res.set('Cache-Control', 'no-store');
            return next();
        }

        // Apply cache headers based on options type
        if (typeof optionsOrPreset === 'string') {
            applyCachePreset(res, optionsOrPreset);
        } else {
            setCacheHeaders(res, optionsOrPreset);
        }

        next();
    };
};

/**
 * Add ETag support middleware
 * Enables conditional requests for bandwidth savings
 */
const etagMiddleware = (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to add ETag
    res.json = function (data) {
        // Generate simple ETag from content hash
        const content = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            hash = ((hash << 5) - hash) + content.charCodeAt(i);
            hash = hash & hash;
        }
        const etag = `"${Math.abs(hash).toString(36)}"`;

        // Set ETag header
        res.set('ETag', etag);

        // Check for conditional request
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            return res.status(304).end();
        }

        return originalJson(data);
    };

    next();
};

module.exports = {
    setCacheHeaders,
    applyCachePreset,
    cacheMiddleware,
    etagMiddleware,
    CACHE_PRESETS
};
