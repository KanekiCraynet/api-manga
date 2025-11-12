/**
 * Dashboard Main Controller
 * Handles SSE client, chart updates, and browser-based data processing
 */

const Dashboard = {
  eventSource: null,
  charts: {},
  statsData: null,
  realtimeData: [],
  maxRealtimePoints: 50,
  sortState: {
    column: null,
    direction: 'asc'
  },
  chartUpdatePending: false,
  lastChartUpdate: 0,
  chartUpdateThrottle: 1000, // Update charts max once per second

  /**
   * Initialize dashboard
   */
  init() {
    this.setupTheme();
    this.setupEventListeners();
    this.initializeCharts();
    this.loadInitialData();
    this.connectRealtime();
  },

  /**
   * Setup theme toggle
   */
  setupTheme() {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcon(savedTheme);

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('dashboard-theme', newTheme);
        this.updateThemeIcon(newTheme);
      });
    }
  },

  /**
   * Update theme icon
   */
  updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Endpoint filter
    const endpointFilter = document.getElementById('endpoint-filter');
    if (endpointFilter) {
      endpointFilter.addEventListener('input', (e) => {
        this.filterEndpoints(e.target.value);
      });
    }

    // Period select
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.loadAnalytics(e.target.value);
      });
    }

    // Refresh analytics
    const refreshAnalytics = document.getElementById('refresh-analytics');
    if (refreshAnalytics) {
      refreshAnalytics.addEventListener('click', () => {
        const period = document.getElementById('period-select')?.value || '1h';
        this.loadAnalytics(period);
      });
    }

    // Table sorting
    const tableHeaders = document.querySelectorAll('#endpoints-table th[data-sort]');
    tableHeaders.forEach(header => {
      header.addEventListener('click', () => {
        const column = header.getAttribute('data-sort');
        this.sortEndpoints(column);
      });
    });
  },

  /**
   * Initialize Chart.js charts
   */
  initializeCharts() {
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0 // Disable animations for better performance
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          }
          },
        y: {
          display: true,
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          }
        }
      }
    };

    // Response Time Chart
    const responseTimeCtx = document.getElementById('response-time-chart');
    if (responseTimeCtx) {
      this.charts.responseTime = new Chart(responseTimeCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Response Time (ms)',
            data: [],
            borderColor: 'rgb(66, 153, 225)',
            backgroundColor: 'rgba(66, 153, 225, 0.1)',
            tension: 0.4
          }]
        },
        options: chartOptions
      });
    }

    // Request Rate Chart
    const requestRateCtx = document.getElementById('request-rate-chart');
    if (requestRateCtx) {
      this.charts.requestRate = new Chart(requestRateCtx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Requests',
            data: [],
            backgroundColor: 'rgba(72, 187, 120, 0.6)',
            borderColor: 'rgb(72, 187, 120)',
            borderWidth: 1
          }]
        },
        options: chartOptions
      });
    }

    // Error Rate Chart
    const errorRateCtx = document.getElementById('error-rate-chart');
    if (errorRateCtx) {
      this.charts.errorRate = new Chart(errorRateCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Error Rate (%)',
            data: [],
            borderColor: 'rgb(245, 101, 101)',
            backgroundColor: 'rgba(245, 101, 101, 0.1)',
            tension: 0.4
          }]
        },
        options: chartOptions
      });
    }
  },

  /**
   * Load initial dashboard data
   */
  async loadInitialData() {
    await Promise.all([
      this.loadStats(),
      this.loadAnalytics('1h'),
      this.loadProviders()
    ]);
  },

  /**
   * Load dashboard statistics
   */
  async loadStats() {
    try {
      const response = await fetch('/api/dashboard/stats');
      const result = await response.json();

      if (result.status === 'success') {
        this.statsData = result.data;
        this.updateOverviewCards(result.data);
        this.updateEndpointsTable(result.data.endpoints || {});
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  },

  /**
   * Load analytics data
   */
  async loadAnalytics(period = '1h') {
    try {
      const response = await fetch(`/api/dashboard/analytics?period=${period}`);
      const result = await response.json();

      if (result.status === 'success' && result.data.timeSeries) {
        this.updateCharts(result.data.timeSeries);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    }
  },

  /**
   * Load providers data
   */
  async loadProviders() {
    try {
      const response = await fetch('/providers');
      const result = await response.json();

      if (result.status === 'success' && result.data) {
        this.updateProvidersGrid(result.data);
      }
    } catch (error) {
      console.error('Error loading providers:', error);
    }
  },

  /**
   * Update overview cards
   */
  updateOverviewCards(data) {
    const perf = data.performance || {};
    const cache = data.cache || {};

    // Uptime
    const uptimeEl = document.getElementById('uptime-value');
    if (uptimeEl) {
      uptimeEl.textContent = this.formatUptime(perf.uptime || 0);
    }

    // Total Requests
    const requestsEl = document.getElementById('requests-value');
    if (requestsEl) {
      requestsEl.textContent = (perf.totalRequests || 0).toLocaleString();
    }

    // Avg Response Time
    const responseTimeEl = document.getElementById('response-time-value');
    if (responseTimeEl) {
      responseTimeEl.textContent = `${perf.avgResponseTime || 0}ms`;
    }

    // Cache Hit Rate
    const cacheHitRateEl = document.getElementById('cache-hit-rate-value');
    if (cacheHitRateEl) {
      const hitRate = perf.cacheHitRate || 0;
      cacheHitRateEl.textContent = `${hitRate.toFixed(1)}%`;
    }
  },

  /**
   * Update endpoints table
   */
  updateEndpointsTable(endpoints) {
    const tbody = document.getElementById('endpoints-tbody');
    if (!tbody) return;

    const endpointArray = Object.entries(endpoints).map(([endpoint, stats]) => ({
      endpoint,
      ...stats
    }));

    if (endpointArray.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No endpoint data available</td></tr>';
      return;
    }

    // Apply sorting if active
    if (this.sortState.column) {
      endpointArray.sort((a, b) => {
        const aVal = a[this.sortState.column] || 0;
        const bVal = b[this.sortState.column] || 0;
        return this.sortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    tbody.innerHTML = endpointArray.map(endpoint => `
      <tr>
        <td>${endpoint.endpoint}</td>
        <td>${(endpoint.requestCount || 0).toLocaleString()}</td>
        <td>${endpoint.avgResponseTime || 0}ms</td>
        <td>${(endpoint.cacheHitRate || 0).toFixed(1)}%</td>
        <td>${(endpoint.errorRate || 0).toFixed(1)}%</td>
      </tr>
    `).join('');

    // Update sort indicators
    this.updateSortIndicators();
  },

  /**
   * Sort endpoints table
   */
  sortEndpoints(column) {
    if (this.sortState.column === column) {
      this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortState.column = column;
      this.sortState.direction = 'asc';
    }

    if (this.statsData && this.statsData.endpoints) {
      this.updateEndpointsTable(this.statsData.endpoints);
    }
  },

  /**
   * Update sort indicators
   */
  updateSortIndicators() {
    const headers = document.querySelectorAll('#endpoints-table th[data-sort]');
    headers.forEach(header => {
      header.classList.remove('sorted', 'asc', 'desc');
      if (header.getAttribute('data-sort') === this.sortState.column) {
        header.classList.add('sorted', this.sortState.direction);
      }
    });
  },

  /**
   * Filter endpoints (browser-based)
   */
  filterEndpoints(filterText) {
    const tbody = document.getElementById('endpoints-tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    const filter = filterText.toLowerCase();

    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(filter) ? '' : 'none';
    });
  },

  /**
   * Update charts with time-series data
   */
  updateCharts(timeSeriesData) {
    if (!timeSeriesData || timeSeriesData.length === 0) return;

    // Throttle chart updates to avoid performance issues
    const now = Date.now();
    if (now - this.lastChartUpdate < this.chartUpdateThrottle) {
      return;
    }
    this.lastChartUpdate = now;

    const labels = timeSeriesData.map(point => {
      const date = new Date(point.timestamp);
      return date.toLocaleTimeString();
    });

    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
      // Response Time Chart
      if (this.charts.responseTime) {
        this.charts.responseTime.data.labels = labels;
        this.charts.responseTime.data.datasets[0].data = timeSeriesData.map(p => p.avgResponseTime);
        this.charts.responseTime.update('none');
      }

      // Request Rate Chart
      if (this.charts.requestRate) {
        this.charts.requestRate.data.labels = labels;
        this.charts.requestRate.data.datasets[0].data = timeSeriesData.map(p => p.requestCount);
        this.charts.requestRate.update('none');
      }

      // Error Rate Chart
      if (this.charts.errorRate) {
        this.charts.errorRate.data.labels = labels;
        this.charts.errorRate.data.datasets[0].data = timeSeriesData.map(p => p.errorRate);
        this.charts.errorRate.update('none');
      }
    });
  },

  /**
   * Update providers grid
   */
  updateProvidersGrid(providers) {
    const grid = document.getElementById('providers-grid');
    if (!grid) return;

    if (!providers || providers.length === 0) {
      grid.innerHTML = '<div class="loading">No providers available</div>';
      return;
    }

    grid.innerHTML = providers.map(provider => `
      <div class="provider-card">
        <h3>${provider.name}</h3>
        <p><strong>ID:</strong> ${provider.id}</p>
        <p><strong>Base URL:</strong> ${provider.baseUrl || 'N/A'}</p>
        <span class="provider-status ${provider.enabled ? 'enabled' : 'disabled'}">
          ${provider.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    `).join('');
  },

  /**
   * Connect to real-time SSE stream
   */
  connectRealtime() {
    try {
      this.eventSource = new EventSource('/api/dashboard/realtime');
      this.updateConnectionStatus('connecting');

      this.eventSource.onopen = () => {
        this.updateConnectionStatus('connected');
      };

      this.eventSource.onmessage = (event) => {
        // Use requestAnimationFrame to batch updates and avoid blocking
        if (!this.chartUpdatePending) {
          this.chartUpdatePending = true;
          requestAnimationFrame(() => {
            try {
              const data = JSON.parse(event.data);
              
              if (data.type === 'connected') {
                this.updateConnectionStatus('connected');
              } else if (data.type === 'metrics') {
                this.handleRealtimeMetrics(data);
              } else if (data.type === 'error') {
                console.error('SSE error:', data.message);
                this.updateConnectionStatus('error');
              }
            } catch (error) {
              console.error('Error parsing SSE data:', error);
            } finally {
              this.chartUpdatePending = false;
            }
          });
        }
      };

      this.eventSource.onerror = () => {
        this.updateConnectionStatus('disconnected');
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
            this.connectRealtime();
          }
        }, 5000);
      };
    } catch (error) {
      console.error('Error connecting to SSE:', error);
      this.updateConnectionStatus('error');
    }
  },

  /**
   * Handle real-time metrics
   */
  handleRealtimeMetrics(data) {
    // Add to realtime data array (browser-based processing)
    this.realtimeData.push({
      timestamp: data.timestamp,
      responseTime: data.performance?.recentResponseTime || 0,
      requestCount: data.performance?.totalRequests || 0,
      errorRate: data.performance?.errorRate || 0
    });

    // Keep only last N points
    if (this.realtimeData.length > this.maxRealtimePoints) {
      this.realtimeData.shift();
    }

    // Throttle chart updates - only update every second
    const now = Date.now();
    if (now - this.lastChartUpdate >= this.chartUpdateThrottle) {
      // Update charts with real-time data (throttled)
      if (this.realtimeData.length > 1) {
        const labels = this.realtimeData.map(d => {
          const date = new Date(d.timestamp);
          return date.toLocaleTimeString();
        });

        requestAnimationFrame(() => {
          if (this.charts.responseTime) {
            this.charts.responseTime.data.labels = labels;
            this.charts.responseTime.data.datasets[0].data = this.realtimeData.map(d => d.responseTime);
            this.charts.responseTime.update('none');
          }
        });
      }
      this.lastChartUpdate = now;
    }

    // Update overview cards with latest data (always update, lightweight)
    if (data.performance) {
      const responseTimeEl = document.getElementById('response-time-value');
      if (responseTimeEl && data.performance.recentResponseTime) {
        responseTimeEl.textContent = `${data.performance.recentResponseTime}ms`;
      }
    }
  },

  /**
   * Update connection status indicator
   */
  updateConnectionStatus(status) {
    const statusIndicator = document.getElementById('connection-status');
    if (!statusIndicator) return;

    const dot = statusIndicator.querySelector('.status-dot');
    const text = statusIndicator.querySelector('.status-text');

    statusIndicator.className = 'status-indicator';
    dot.className = 'status-dot';

    switch (status) {
      case 'connected':
        dot.classList.add('connected');
        text.textContent = 'Connected';
        break;
      case 'connecting':
        text.textContent = 'Connecting...';
        break;
      case 'disconnected':
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
        break;
      case 'error':
        dot.classList.add('disconnected');
        text.textContent = 'Error';
        break;
    }
  },

  /**
   * Format uptime in human-readable format
   */
  formatUptime(seconds) {
    if (!seconds) return '0s';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  },

  /**
   * Cleanup on page unload
   */
  cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Destroy charts
    Object.values(this.charts).forEach(chart => {
      if (chart && chart.destroy) {
        chart.destroy();
      }
    });
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Dashboard.init());
} else {
  Dashboard.init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => Dashboard.cleanup());

