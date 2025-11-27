/**
 * Parallel Processing Service
 * Process multiple providers simultaneously dengan efisien
 */

const { executeScraper } = require('./provider_manager');
const { DataAggregationService } = require('./data_processor');
const { ParseError } = require('../helper/error_handler');

/**
 * Parallel Processor Service
 */
class ParallelProcessor {
  /**
   * Process multiple providers in parallel
   * @param {Array} providers - Array of provider IDs
   * @param {string} functionName - Scraper function name
   * @param {Array} args - Function arguments
   * @param {object} options - Processing options
   * @returns {Promise<object>} Aggregated results
   */
  static async processProviders(providers, functionName, args = [], options = {}) {
    const {
      timeout = 30000,
      stopOnError = false,
      aggregate = true,
      aggregateOptions = {}
    } = options;

    const results = [];
    const errors = [];

    // Create promises for each provider
    const promises = providers.map(async (providerId) => {
      try {
        const result = await Promise.race([
          executeScraper(providerId, functionName, ...args),
          new Promise((_, reject) => 
            setTimeout(() => reject(new ParseError(`Timeout for provider ${providerId}`)), timeout)
          )
        ]);

        return {
          provider: providerId,
          success: true,
          data: result
        };
      } catch (error) {
        if (stopOnError) {
          throw error;
        }
        return {
          provider: providerId,
          success: false,
          error: error.message
        };
      }
    });

    // Wait for all promises
    const settled = await Promise.allSettled(promises);

    // Process results
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          results.push(result.value);
        } else {
          errors.push({
            provider: providers[index],
            error: result.value.error
          });
        }
      } else {
        errors.push({
          provider: providers[index],
          error: result.reason.message
        });
      }
    });

    // Aggregate results if requested
    if (aggregate && results.length > 0) {
      const aggregated = DataAggregationService.aggregateComics(
        results.map(r => ({ provider: r.provider, data: r.data })),
        aggregateOptions
      );

      return {
        success: true,
        providers: results.map(r => r.provider),
        data: aggregated,
        errors: errors.length > 0 ? errors : undefined,
        metadata: {
          totalProviders: providers.length,
          successful: results.length,
          failed: errors.length,
          aggregated: aggregated.length
        }
      };
    }

    return {
      success: results.length > 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
      metadata: {
        totalProviders: providers.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  /**
   * Process with fallback strategy
   * Try providers in order until one succeeds
   * @param {Array} providers - Array of provider IDs (in priority order)
   * @param {string} functionName - Scraper function name
   * @param {Array} args - Function arguments
   * @param {object} options - Processing options
   * @returns {Promise<object>} First successful result
   */
  static async processWithFallback(providers, functionName, args = [], options = {}) {
    const { timeout = 30000 } = options;

    for (const providerId of providers) {
      try {
        const result = await Promise.race([
          executeScraper(providerId, functionName, ...args),
          new Promise((_, reject) => 
            setTimeout(() => reject(new ParseError(`Timeout for provider ${providerId}`)), timeout)
          )
        ]);

        return {
          success: true,
          provider: providerId,
          data: result,
          fallback: providers.indexOf(providerId) > 0
        };
      } catch (error) {
        // Try next provider
        continue;
      }
    }

    throw new ParseError(`All providers failed: ${providers.join(', ')}`);
  }

  /**
   * Process with race strategy
   * Return first successful result immediately when any provider succeeds
   * @param {Array} providers - Array of provider IDs
   * @param {string} functionName - Scraper function name
   * @param {Array} args - Function arguments
   * @param {object} options - Processing options
   * @returns {Promise<object>} First successful result
   */
  static async processWithRace(providers, functionName, args = [], options = {}) {
    const { timeout = 30000 } = options;

    return new Promise((resolve, reject) => {
      let resolved = false;
      let completedCount = 0;
      const errors = [];

      providers.forEach((providerId) => {
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            errors.push({ provider: providerId, error: 'Timeout' });
            completedCount++;
            checkAllFailed();
          }
        }, timeout);

        executeScraper(providerId, functionName, ...args)
          .then((result) => {
            clearTimeout(timeoutId);
            if (!resolved) {
              resolved = true;
              resolve({
                success: true,
                provider: providerId,
                data: result
              });
            }
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            if (!resolved) {
              errors.push({ provider: providerId, error: error.message });
              completedCount++;
              checkAllFailed();
            }
          });
      });

      function checkAllFailed() {
        if (!resolved && completedCount >= providers.length) {
          reject(new ParseError(`All providers failed: ${providers.join(', ')}`));
        }
      }
    });
  }
}

module.exports = ParallelProcessor;

