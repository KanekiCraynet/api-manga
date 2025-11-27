/**
 * Request Queue Service
 * Manages concurrent requests to prevent overload and ensure data integrity
 */

class RequestQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 5;
    this.maxQueueSize = options.maxQueueSize || 100;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.timeout = options.timeout || 30000;
    
    this.queue = [];
    this.running = 0;
    this.completed = 0;
    this.failed = 0;
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      avgProcessingTime: 0,
      lastProcessed: null
    };
    
    // Provider-specific rate limiting
    this.providerLimits = new Map();
    this.providerLastRequest = new Map();
    this.providerMinDelay = options.providerMinDelay || 500; // Min delay between requests to same provider
  }

  /**
   * Add request to queue
   * @param {Function} requestFn - Async function to execute
   * @param {object} options - Request options
   * @returns {Promise} Promise resolving to request result
   */
  async enqueue(requestFn, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        fn: requestFn,
        options,
        resolve,
        reject,
        attempts: 0,
        createdAt: Date.now(),
        providerId: options.providerId || 'default'
      };

      if (this.queue.length >= this.maxQueueSize) {
        // Remove oldest non-priority request if queue is full
        const nonPriorityIndex = this.queue.findIndex(r => !r.options.priority);
        if (nonPriorityIndex !== -1) {
          const removed = this.queue.splice(nonPriorityIndex, 1)[0];
          removed.reject(new Error('Request removed from queue due to overflow'));
        } else {
          reject(new Error('Queue is full'));
          return;
        }
      }

      if (options.priority) {
        this.queue.unshift(request);
      } else {
        this.queue.push(request);
      }

      this.processQueue();
    });
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (this.paused) return;
    
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const request = this.getNextRequest();
      if (!request) break;
      
      this.running++;
      this.processRequest(request);
    }
  }

  /**
   * Get next request respecting provider rate limits
   * @returns {object|null} Next request or null
   */
  getNextRequest() {
    const now = Date.now();
    
    for (let i = 0; i < this.queue.length; i++) {
      const request = this.queue[i];
      const providerId = request.providerId;
      const lastRequest = this.providerLastRequest.get(providerId) || 0;
      
      if (now - lastRequest >= this.providerMinDelay) {
        return this.queue.splice(i, 1)[0];
      }
    }
    
    // If all requests need to wait, schedule next check
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), this.providerMinDelay);
    }
    
    return null;
  }

  /**
   * Process single request with retry logic
   * @param {object} request - Request object
   */
  async processRequest(request) {
    const startTime = Date.now();
    
    try {
      // Update provider last request time
      this.providerLastRequest.set(request.providerId, Date.now());
      
      // Execute with timeout
      const result = await Promise.race([
        request.fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), this.timeout)
        )
      ]);
      
      this.handleSuccess(request, result, startTime);
    } catch (error) {
      this.handleError(request, error, startTime);
    }
  }

  /**
   * Handle successful request
   */
  handleSuccess(request, result, startTime) {
    const processingTime = Date.now() - startTime;
    
    this.running--;
    this.completed++;
    this.stats.totalProcessed++;
    this.stats.lastProcessed = Date.now();
    this.updateAvgProcessingTime(processingTime);
    
    request.resolve(result);
    this.processQueue();
  }

  /**
   * Handle failed request with retry
   */
  async handleError(request, error, startTime) {
    request.attempts++;
    
    if (request.attempts < this.retryAttempts) {
      // Exponential backoff
      const delay = this.retryDelay * Math.pow(2, request.attempts - 1);
      
      console.warn(`Request failed (attempt ${request.attempts}/${this.retryAttempts}), retrying in ${delay}ms:`, error.message);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Re-add to queue with priority
      request.options.priority = true;
      this.queue.unshift(request);
      this.running--;
      this.processQueue();
    } else {
      this.running--;
      this.failed++;
      this.stats.totalFailed++;
      
      request.reject(error);
      this.processQueue();
    }
  }

  /**
   * Update average processing time
   */
  updateAvgProcessingTime(time) {
    const total = this.stats.totalProcessed;
    this.stats.avgProcessingTime = 
      (this.stats.avgProcessingTime * (total - 1) + time) / total;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      ...this.stats
    };
  }

  /**
   * Clear queue
   */
  clear() {
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.paused = true;
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.paused = false;
    this.processQueue();
  }
}

// Singleton instance
const requestQueue = new RequestQueue({
  maxConcurrent: 5,
  maxQueueSize: 100,
  retryAttempts: 3,
  retryDelay: 1000,
  timeout: 30000,
  providerMinDelay: 500
});

module.exports = {
  RequestQueue,
  requestQueue
};
