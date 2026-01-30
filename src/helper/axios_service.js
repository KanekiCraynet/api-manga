const axios = require('axios');
const { NetworkError, NotFoundError, retryWithBackoff } = require('./error_handler');

// Detect Vercel environment
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

// User agents for rotation (updated with latest browser versions)
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

let userAgentIndex = 0;

// Cloudflare detection patterns
const CLOUDFLARE_PATTERNS = {
  titles: ['Just a moment...', 'Attention Required!', 'Please Wait...', 'Checking your browser'],
  bodyTexts: ['cf-browser-verification', 'cf_chl_opt', 'challenge-platform', 'ray id', 'cloudflare'],
  statusCodes: [403, 503, 520, 521, 522, 523, 524, 525, 526]
};

// Request verification statistics
const verificationStats = {
  totalRequests: 0,
  successfulRequests: 0,
  blockedRequests: 0,
  cloudflareBlocks: 0,
  retrySuccesses: 0,
  lastBlockedAt: null,
  blockedUrls: new Map()
};

/**
 * Get next user agent in rotation
 * @returns {string} User agent string
 */
const getNextUserAgent = () => {
  const userAgent = userAgents[userAgentIndex];
  userAgentIndex = (userAgentIndex + 1) % userAgents.length;
  return userAgent;
};

/**
 * Detect if response is blocked by Cloudflare
 * @param {object} response - Axios response
 * @returns {object} Detection result
 */
const detectCloudflareBlock = (response) => {
  const result = {
    isBlocked: false,
    blockType: null,
    confidence: 0,
    details: {}
  };

  if (!response) return result;

  const { status, data, headers } = response;
  const contentType = headers?.['content-type'] || '';
  const isHtml = contentType.includes('text/html');

  // Check status codes
  if (CLOUDFLARE_PATTERNS.statusCodes.includes(status)) {
    result.confidence += 30;
    result.details.statusCode = status;
  }

  // Check Cloudflare headers
  if (headers?.['cf-ray'] || headers?.['cf-cache-status'] || headers?.['server']?.toLowerCase().includes('cloudflare')) {
    result.confidence += 20;
    result.details.cloudflareHeaders = true;
  }

  // Check HTML content for Cloudflare patterns
  if (isHtml && typeof data === 'string') {
    const dataLower = data.toLowerCase();

    // Check title patterns
    for (const title of CLOUDFLARE_PATTERNS.titles) {
      if (dataLower.includes(title.toLowerCase())) {
        result.confidence += 25;
        result.blockType = 'challenge';
        result.details.matchedTitle = title;
        break;
      }
    }

    // Check body text patterns
    for (const pattern of CLOUDFLARE_PATTERNS.bodyTexts) {
      if (dataLower.includes(pattern.toLowerCase())) {
        result.confidence += 15;
        result.details.matchedPattern = pattern;
      }
    }

    // Check for CAPTCHA
    if (dataLower.includes('captcha') || dataLower.includes('hcaptcha') || dataLower.includes('recaptcha')) {
      result.confidence += 30;
      result.blockType = 'captcha';
      result.details.captchaDetected = true;
    }
  }

  // Determine if blocked based on confidence
  result.isBlocked = result.confidence >= 50;

  if (result.isBlocked && !result.blockType) {
    result.blockType = status === 403 ? 'forbidden' : 'challenge';
  }

  return result;
};

/**
 * Verify response data validity
 * @param {object} response - Axios response
 * @param {object} options - Verification options
 * @returns {object} Verification result
 */
const verifyResponse = (response, options = {}) => {
  const {
    expectJson = false,
    expectHtml = false,
    minContentLength = 100,
    requiredFields = [],
    validateContent = null
  } = options;

  const result = {
    isValid: true,
    issues: [],
    warnings: []
  };

  if (!response || !response.data) {
    result.isValid = false;
    result.issues.push('No response data');
    return result;
  }

  const { data, status, headers } = response;
  const contentType = headers?.['content-type'] || '';

  // Check status
  if (status >= 400) {
    result.isValid = false;
    result.issues.push(`HTTP error: ${status}`);
  }

  // Verify content type
  if (expectJson && !contentType.includes('application/json')) {
    result.warnings.push('Expected JSON but got different content type');
  }
  if (expectHtml && !contentType.includes('text/html')) {
    result.warnings.push('Expected HTML but got different content type');
  }

  // Check content length
  const contentLength = typeof data === 'string' ? data.length : JSON.stringify(data).length;
  if (contentLength < minContentLength) {
    result.warnings.push(`Content length (${contentLength}) below minimum (${minContentLength})`);
  }

  // Check for empty/error responses
  if (typeof data === 'string') {
    const dataLower = data.toLowerCase();
    if (dataLower.includes('error') && dataLower.includes('not found')) {
      result.issues.push('Response indicates not found error');
    }
    if (data.trim() === '' || data.trim() === '{}' || data.trim() === '[]') {
      result.warnings.push('Empty response body');
    }
  }

  // Check required fields for JSON
  if (expectJson && typeof data === 'object' && requiredFields.length > 0) {
    for (const field of requiredFields) {
      if (!(field in data)) {
        result.issues.push(`Missing required field: ${field}`);
      }
    }
  }

  // Custom validation
  if (validateContent && typeof validateContent === 'function') {
    try {
      const customResult = validateContent(data);
      if (!customResult.valid) {
        result.issues.push(...(customResult.issues || ['Custom validation failed']));
      }
    } catch (error) {
      result.warnings.push(`Custom validation error: ${error.message}`);
    }
  }

  // Check Cloudflare block
  const cloudflareCheck = detectCloudflareBlock(response);
  if (cloudflareCheck.isBlocked) {
    result.isValid = false;
    result.issues.push(`Cloudflare ${cloudflareCheck.blockType} detected`);
    result.cloudflareBlock = cloudflareCheck;
  }

  result.isValid = result.isValid && result.issues.length === 0;
  return result;
};

/**
 * Get verification statistics
 * @returns {object} Statistics
 */
const getVerificationStats = () => ({
  ...verificationStats,
  blockedUrls: Array.from(verificationStats.blockedUrls.entries()).slice(-10),
  successRate: verificationStats.totalRequests > 0
    ? ((verificationStats.successfulRequests / verificationStats.totalRequests) * 100).toFixed(2) + '%'
    : 'N/A'
});

/**
 * Reset verification statistics
 */
const resetVerificationStats = () => {
  verificationStats.totalRequests = 0;
  verificationStats.successfulRequests = 0;
  verificationStats.blockedRequests = 0;
  verificationStats.cloudflareBlocks = 0;
  verificationStats.retrySuccesses = 0;
  verificationStats.lastBlockedAt = null;
  verificationStats.blockedUrls.clear();
};

// HTTP agents - only use for non-serverless (keep-alive doesn't help in serverless)
const httpAgent = !isVercel ? new (require('http').Agent)({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10
}) : undefined;

const httpsAgent = !isVercel ? new (require('https').Agent)({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  rejectUnauthorized: true
}) : undefined;

// Create axios instance with Vercel-optimized configuration
const axiosInstance = axios.create({
  timeout: isVercel ? 6000 : 30000, // 6s for Vercel (leaves buffer for processing)
  headers: {
    'User-Agent': getNextUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': isVercel ? 'close' : 'keep-alive', // Close for serverless
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  },
  maxRedirects: isVercel ? 3 : 5, // Fewer redirects for faster response
  validateStatus: (status) => status >= 200 && status < 500, // Don't throw on 4xx
  httpAgent,
  httpsAgent
});

/**
 * Enhanced Axios Service with retry, timeout, verification, and Cloudflare detection
 * @param {string} url - URL to fetch
 * @param {object} options - Additional options
 * @param {number} options.timeout - Request timeout in milliseconds
 * @param {number} options.retries - Number of retries
 * @param {boolean} options.rotateUserAgent - Whether to rotate user agent
 * @param {boolean} options.verify - Enable response verification (default: true)
 * @param {object} options.verifyOptions - Verification options
 * @returns {Promise} Axios response
 */
const AxiosService = async (url, options = {}) => {
  const {
    timeout = isVercel ? 6000 : 30000, // Vercel-optimized default
    retries = isVercel ? 1 : 3,        // Minimal retries for serverless
    rotateUserAgent = true,
    verify = true,
    verifyOptions = {}
  } = options;

  verificationStats.totalRequests++;

  // Validate URL
  if (!url || typeof url !== 'string') {
    throw new NetworkError('Invalid URL provided');
  }

  // Encode URL
  const encodedUrl = encodeURI(url);

  // Create request config
  const config = {
    timeout,
    headers: {}
  };

  // Rotate user agent if enabled
  if (rotateUserAgent) {
    config.headers['User-Agent'] = getNextUserAgent();
  }

  // Add additional headers to avoid detection
  config.headers['Accept'] = options.acceptJson
    ? 'application/json, text/plain, */*'
    : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  config.headers['Accept-Language'] = 'en-US,en;q=0.9,id;q=0.8';
  config.headers['Cache-Control'] = 'no-cache';
  config.headers['Pragma'] = 'no-cache';

  // Merge with options config
  if (options.headers) {
    config.headers = { ...config.headers, ...options.headers };
  }

  let lastError = null;
  let lastResponse = null;

  try {
    // Retry with exponential backoff and Cloudflare handling
    const response = await retryWithBackoff(
      async () => {
        // Rotate user agent on each retry
        if (rotateUserAgent) {
          config.headers['User-Agent'] = getNextUserAgent();
        }

        const res = await axiosInstance.get(encodedUrl, config);
        lastResponse = res;

        // Check for Cloudflare block
        const cloudflareCheck = detectCloudflareBlock(res);
        if (cloudflareCheck.isBlocked) {
          verificationStats.cloudflareBlocks++;
          verificationStats.lastBlockedAt = Date.now();
          verificationStats.blockedUrls.set(url, {
            timestamp: Date.now(),
            blockType: cloudflareCheck.blockType
          });
          throw new NetworkError(`Cloudflare ${cloudflareCheck.blockType} detected - URL may be temporarily blocked`);
        }

        // Check if response is successful
        if (res.status === 404) {
          throw new NotFoundError('Resource not found');
        } else if (res.status >= 400) {
          throw new NetworkError(`Request failed with status code ${res.status}`);
        }

        // Verify response if enabled
        if (verify) {
          const verification = verifyResponse(res, verifyOptions);
          if (!verification.isValid) {
            const issues = verification.issues.join(', ');
            throw new NetworkError(`Response verification failed: ${issues}`);
          }
        }

        return res;
      },
      retries,
      1500 // Increased initial delay for better Cloudflare handling
    );

    verificationStats.successfulRequests++;
    return response;

  } catch (error) {
    verificationStats.blockedRequests++;
    lastError = error;

    // Handle different error types
    if (error instanceof NetworkError || error instanceof NotFoundError) {
      throw error;
    }

    if (error.response) {
      const status = error.response.status;
      const message = error.response.statusText || 'Request failed';

      // Check for Cloudflare on error response
      const cloudflareCheck = detectCloudflareBlock(error.response);
      if (cloudflareCheck.isBlocked) {
        verificationStats.cloudflareBlocks++;
        throw new NetworkError(`Cloudflare protection active - ${cloudflareCheck.blockType}`);
      }

      if (status === 404) {
        throw new NotFoundError('Resource not found');
      } else if (status >= 500) {
        throw new NetworkError('Server error');
      } else {
        throw new NetworkError(message);
      }
    } else if (error.request) {
      throw new NetworkError('No response received from server');
    } else if (error.code === 'ECONNABORTED') {
      throw new NetworkError('Request timeout');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new NetworkError('Connection failed');
    } else {
      throw new NetworkError(error.message || 'Unknown error occurred');
    }
  }
};

/**
 * Batch request multiple URLs
 * @param {string[]} urls - Array of URLs to fetch
 * @param {object} options - Additional options
 * @param {number} options.concurrent - Number of concurrent requests
 * @returns {Promise<Array>} Array of responses
 */
const batchRequest = async (urls, options = {}) => {
  const { concurrent = 5 } = options;
  const results = [];

  for (let i = 0; i < urls.length; i += concurrent) {
    const batch = urls.slice(i, i + concurrent);
    const batchResults = await Promise.allSettled(
      batch.map(url => AxiosService(url, options))
    );

    results.push(...batchResults.map((result, index) => ({
      url: batch[index],
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    })));
  }

  return results;
};

module.exports = {
  AxiosService,
  batchRequest,
  axiosInstance,
  detectCloudflareBlock,
  verifyResponse,
  getVerificationStats,
  resetVerificationStats
};
