/**
 * Provider Manager
 * Manages multiple providers and handles provider selection
 */

const { getProvider, getDefaultProvider, supportsFeature } = require('../config/providers');
const { ValidationError } = require('../helper/error_handler');

/**
 * Provider registry mapping with lazy loading to avoid circular dependencies
 */
const providerRegistry = {
  mangadex: () => require('./mangadex_scraper'),
  komikcast: () => require('./scraper_service'),
  shinigami: () => require('./shinigami_scraper'),
  aquareader: () => require('./aquareader_scraper')
};

/**
 * Get scraper service for provider
 * @param {string} providerId - Provider ID
 * @returns {object} Scraper service instance
 */
const getScraperService = (providerId) => {
  const provider = getProvider(providerId);
  
  if (!provider) {
    throw new ValidationError(`Provider '${providerId}' not found`);
  }
  
  if (!provider.enabled) {
    throw new ValidationError(`Provider '${providerId}' is not enabled`);
  }
  
  const scraperLoader = providerRegistry[providerId];
  
  if (!scraperLoader) {
    throw new ValidationError(`Scraper service for provider '${providerId}' not found`);
  }
  
  // Lazy load the scraper to avoid circular dependencies
  return typeof scraperLoader === 'function' ? scraperLoader() : scraperLoader;
};

/**
 * Resolve provider ID from request
 * @param {string} requestedProvider - Requested provider ID
 * @returns {string} Resolved provider ID
 */
const resolveProvider = (requestedProvider) => {
  if (!requestedProvider) {
    return getDefaultProvider().name.toLowerCase();
  }
  
  const providerId = requestedProvider.toLowerCase();
  const provider = getProvider(providerId);
  
  if (!provider || !provider.enabled) {
    // Fallback to default provider
    const defaultProvider = getDefaultProvider();
    return defaultProvider.name.toLowerCase();
  }
  
  return providerId;
};

/**
 * Check if provider supports a feature
 * @param {string} providerId - Provider ID
 * @param {string} feature - Feature name
 * @returns {boolean} True if supported
 */
const providerSupportsFeature = (providerId, feature) => {
  return supportsFeature(providerId, feature);
};

/**
 * Execute scraper function with provider
 * @param {string} providerId - Provider ID
 * @param {string} functionName - Scraper function name
 * @param {Array} args - Function arguments
 * @returns {Promise} Scraper result
 */
const executeScraper = async (providerId, functionName, ...args) => {
  const scraper = getScraperService(providerId);
  
  if (typeof scraper[functionName] !== 'function') {
    throw new ValidationError(`Function '${functionName}' not found in provider '${providerId}'`);
  }
  
  try {
    return await scraper[functionName](...args);
  } catch (error) {
    // Only fallback if it's a network/parse error, not validation errors
    const defaultProvider = getDefaultProvider();
    const isNetworkError = error.code === 'NETWORK_ERROR' || 
                          error.code === 'PARSE_ERROR' || 
                          error.code === 'NOT_FOUND' ||
                          error.message?.includes('Failed to') ||
                          error.message?.includes('Error scraping');
    
    if (providerId !== defaultProvider.name.toLowerCase() && isNetworkError) {
      console.warn(`Provider '${providerId}' failed with ${error.code || error.message}, falling back to default provider`);
      const defaultScraper = getScraperService(defaultProvider.name.toLowerCase());
      if (typeof defaultScraper[functionName] === 'function') {
        return await defaultScraper[functionName](...args);
      }
    }
    throw error;
  }
};

/**
 * Get provider info
 * @param {string} providerId - Provider ID
 * @returns {object} Provider information
 */
const getProviderInfo = (providerId) => {
  const provider = getProvider(providerId);
  if (!provider) return null;
  
  return {
    id: providerId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    features: provider.features
  };
};

/**
 * List all available providers
 * @returns {Array} Array of provider info
 */
const listProviders = () => {
  return Object.keys(providerRegistry).map(id => getProviderInfo(id)).filter(Boolean);
};

module.exports = {
  getScraperService,
  resolveProvider,
  providerSupportsFeature,
  executeScraper,
  getProviderInfo,
  listProviders
};

