# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2025-11-05

### Added
- **Browser-Based Dashboard** - Dashboard interaktif untuk monitoring dan manajemen API
  - Real-time metrics dengan Server-Sent Events (SSE)
  - Performance analytics dengan Chart.js
  - Cache management interface
  - Endpoint analytics dengan filtering dan sorting
  - Provider status monitoring
  - Dark/Light theme support

- **Dashboard API Endpoints**
  - `GET /api/dashboard/stats` - Statistik lengkap API
  - `GET /api/dashboard/analytics` - Time-series analytics dengan berbagai periode
  - `GET /api/dashboard/realtime` - Real-time metrics stream (SSE)
  - `GET /api/dashboard/cache/manage` - List dan filter cache entries
  - `DELETE /api/dashboard/cache/manage` - Clear cache (all atau by pattern)
  - `POST /api/dashboard/cache/manage/warm` - Cache warm-up request

- **Enhanced Performance Monitoring**
  - Time-series data storage dengan ring buffer
  - Per-endpoint history tracking
  - Percentile calculations (P50, P95, P99)
  - Moving averages computation
  - Anomaly detection

- **Multi-Level Caching**
  - L1 cache (fast, uncompressed)
  - L2 cache (compressed, larger capacity)
  - Cache entry statistics (access count, last accessed, TTL)
  - Cache pattern filtering

- **Browser-Based Computation**
  - Client-side filtering dan sorting
  - Client-side pagination
  - Real-time data processing
  - Analytics computation di browser (percentiles, moving averages)

### Changed
- **Performance Optimizations**
  - Chart.js animations disabled untuk better performance
  - Chart updates throttled (max 1x per second)
  - SSE handler menggunakan requestAnimationFrame untuk batch updates
  - CSP updated untuk allow Chart.js source maps

- **Cache Service**
  - Added `getEntries()` method untuk list cache entries
  - Added `getEntryStats()` method untuk detailed cache entry info
  - Enhanced cache statistics dengan per-level metrics

- **Performance Middleware**
  - Added time-series data collection
  - Added per-endpoint history tracking
  - Enhanced metrics dengan percentile data

### Fixed
- **Content Security Policy (CSP)**
  - Fixed CSP violation untuk Chart.js source map requests
  - Added `https://cdn.jsdelivr.net` ke `connectSrc` directive

- **Performance Issues**
  - Fixed `requestAnimationFrame` handler performance warnings
  - Optimized SSE message handler untuk mengurangi blocking
  - Chart update throttling untuk smooth rendering

### Technical Details
- Dashboard menggunakan Chart.js v4.4.0 untuk visualisasi
- SSE connection dengan auto-reconnect mechanism
- Browser-based computation untuk mengurangi server load
- Responsive design dengan mobile support
- Theme persistence menggunakan localStorage

---

## [2.0.0] - 2025-10-21

### Added
- **Multiple Providers Support**
  - Komikcast provider (HTML scraping)
  - Shinigami provider (API integration)
  - Aqua Reader provider (HTML scraping)
  - Provider selection via query parameter

- **Performance & Reliability**
  - In-Memory Caching dengan TTL (5-15 menit)
  - Retry Mechanism dengan exponential backoff (3 retries)
  - Connection Pooling untuk optimasi HTTP
  - Rate Limiting per IP (100 requests/15 menit default)
  - User-Agent Rotation
  - Request Timeout configuration (30 detik)

- **Enhanced Features**
  - Filtering (genre, type, status, rating)
  - Sorting (title, rating, date, author)
  - Health Check Endpoint (`/health`)
  - Providers List Endpoint (`/providers`)
  - Performance Headers (X-Response-Time, X-Cache, X-Request-ID)

- **Code Quality**
  - Service Layer architecture
  - Modular code structure
  - Custom Error Types
  - Input Validation middleware
  - Performance Monitoring

### Changed
- Restructured project untuk better maintainability
- Improved error handling dengan custom error classes
- Enhanced data validation dan normalization

---

## [1.0.0] - 2025-10-05

### Added
- Initial release
- Basic API endpoints untuk Komikcast
- Caching system
- Rate limiting
- Error handling

---

[2.1.0]: https://github.com/KanekiCraynet/api-manga/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/KanekiCraynet/api-manga/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/KanekiCraynet/api-manga/releases/tag/v1.0.0

