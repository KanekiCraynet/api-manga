# Manga API

[![CI/CD](https://github.com/KanekiCraynet/api-manga/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/KanekiCraynet/api-manga/actions/workflows/ci-cd.yml)
[![Deploy](https://img.shields.io/badge/Vercel-Deployed-black?logo=vercel)](https://api-manga-five.vercel.app)

Multi-source manga scraping API with advanced data processing, Cloudflare protection, and intelligent caching. Supports MangaDex (Official API), Komikcast, Shinigami, and Aqua Reader providers.

## Features

- **Multi-Provider Support** - 4 manga sources with automatic fallback
- **MangaDex Integration** - Official API access to the largest manga database
- **Cloudflare Protection** - Automatic detection and bypass for blocked requests
- **Smart Caching** - Multi-level caching (L1 fast + L2 compressed) with configurable TTL
- **Data Deduplication** - Hash-based content tracking to prevent duplicates
- **Request Queue** - Rate limiting and concurrent request management
- **Real-time Dashboard** - Browser-based monitoring with SSE updates
- **Performance Analytics** - Response time, cache hit rate, error rate tracking

## Quick Start

```bash
# Clone repository
git clone https://github.com/KanekiCraynet/api-manga.git
cd api-manga

# Install dependencies
npm install

# Start server
npm start
```

Server runs at `http://localhost:3000`

**Production URL:** `https://api-manga-five.vercel.app`

## Providers

| Provider | Method | URL Format | Genre Support | Rate Limit |
|----------|--------|------------|---------------|------------|
| **MangaDex** | Official API | UUID | Yes | 5 req/sec |
| **Komikcast** | HTML Scraping | Slug | Yes | - |
| **Shinigami** | Internal API | UUID | No | - |
| **Aquareader** | HTML Scraping | Slug | Yes | - |

### Provider Selection

Add `?provider=<name>` to any endpoint:

```bash
# MangaDex (largest database, official API)
curl "http://localhost:3000/search?keyword=solo&provider=mangadex"

# Komikcast (default)
curl "http://localhost:3000/search?keyword=solo"

# Shinigami
curl "http://localhost:3000/search?keyword=solo&provider=shinigami"

# Aquareader
curl "http://localhost:3000/search?keyword=solo&provider=aquareader"
```

## API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/terbaru?page=1` | GET | Latest comics with pagination |
| `/popular` | GET | Popular comics |
| `/recommended` | GET | Recommended comics |
| `/search?keyword=<query>` | GET | Search comics |
| `/detail/:url` | GET | Comic detail with chapters |
| `/read/:url` | GET | Chapter images |
| `/genre` | GET | Genre list |
| `/genre/:url?page=1` | GET | Comics by genre |

### System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info |
| `/health` | GET | Health check and stats |
| `/providers` | GET | Available providers |
| `/provider/:id` | GET | Provider details |
| `/api/system/stats` | GET | Scraping system statistics |
| `/dashboard` | GET | Web dashboard |

### Advanced Parameters

**Latest Comics (`/terbaru`)**:
- `page` - Page number (required)
- `provider` - Provider name
- `forceRefresh` - Skip cache (`true`/`false`)
- `getAllPages` - Fetch all pages (`true`/`false`)
- `maxPages` - Maximum pages to fetch
- `genre` - Filter by genre
- `type` - Filter by type (Manga, Manhwa, Manhua)
- `status` - Filter by status (Ongoing, Completed)
- `minRating` - Minimum rating (0-10)
- `sortBy` - Sort field (title, rating, date, author)
- `sortOrder` - Sort order (asc, desc)

## Usage Examples

### Basic Workflow

```bash
# 1. Search for a comic
curl "http://localhost:3000/search?keyword=solo%20leveling"

# 2. Get comic detail (use href from search result)
curl "http://localhost:3000/detail/solo-leveling"

# 3. Read chapter (use chapter href from detail)
curl "http://localhost:3000/read/solo-leveling-chapter-200"
```

### Using MangaDex

```bash
# Search on MangaDex
curl "http://localhost:3000/search?keyword=one%20piece&provider=mangadex"

# Get detail (MangaDex uses UUID)
curl "http://localhost:3000/detail/a1c7c817-4e59-43b7-9365-09675a149a6f?provider=mangadex"

# Read chapter
curl "http://localhost:3000/read/chapter-uuid-here?provider=mangadex"
```

### Advanced Scraping

```bash
# Force refresh cache
curl "http://localhost:3000/terbaru?page=1&forceRefresh=true"

# Get all pages (up to limit)
curl "http://localhost:3000/terbaru?page=1&getAllPages=true&maxPages=5"

# Filter and sort
curl "http://localhost:3000/terbaru?page=1&genre=action&minRating=8&sortBy=rating&sortOrder=desc"
```

## Response Format

### Success Response

```json
{
  "status": "success",
  "data": [...],
  "metadata": {
    "fromCache": false,
    "newItems": 24,
    "source": "komikcast",
    "providerErrors": []
  }
}
```

### Pagination Response

```json
{
  "status": "success",
  "current_page": 1,
  "length_page": 10,
  "has_next": true,
  "has_prev": false,
  "data": [...]
}
```

### Error Response

```json
{
  "status": "error",
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## System Architecture

### Data Processing Pipeline

```
Request → Rate Limiter → Cache Check → Scrape Orchestrator
                              ↓
                    Provider Selection
                              ↓
              Request Queue (concurrent limit: 5)
                              ↓
            Cloudflare Detection & Verification
                              ↓
                   Data Integrity Check
                        (hash-based)
                              ↓
                     Deduplication
                   (85% similarity)
                              ↓
                   Cache Storage
                    (L1 + L2)
                              ↓
                      Response
```

### Services

| Service | Description |
|---------|-------------|
| `request_queue.js` | Concurrent request management, rate limiting |
| `data_integrity.js` | Hash generation, deduplication, quality scoring |
| `scrape_orchestrator.js` | Multi-provider coordination, pagination |
| `cache_service.js` | Multi-level caching with TTL |
| `axios_service.js` | HTTP client with Cloudflare protection |

### Cloudflare Protection

The API includes automatic Cloudflare detection and bypass:

- **Pattern Detection** - Identifies Cloudflare challenge pages
- **Response Verification** - Validates scraped data integrity
- **User-Agent Rotation** - Rotates browser user agents
- **Retry Mechanism** - Exponential backoff with 3 retries
- **Stats Tracking** - Monitors block rate and success rate

```bash
# Check verification stats
curl "http://localhost:3000/api/system/stats"
```

### System Statistics

```json
{
  "requestQueue": {
    "totalProcessed": 1500,
    "avgProcessingTime": 250,
    "currentQueueSize": 0
  },
  "dataIntegrity": {
    "totalHashes": 5000,
    "duplicatesDetected": 150
  },
  "orchestrator": {
    "totalOperations": 500,
    "healthyProviders": ["mangadex", "komikcast", "shinigami"],
    "unhealthyProviders": []
  },
  "verification": {
    "totalChecks": 1500,
    "blockedCount": 5,
    "passedCount": 1495,
    "blockRate": 0.33
  }
}
```

## Dashboard

Access the monitoring dashboard at `/dashboard`:

- **Real-time Metrics** - Live performance charts via SSE
- **Cache Management** - View, filter, and clear cache entries
- **Endpoint Analytics** - Per-endpoint statistics
- **Provider Status** - Health monitoring for all providers
- **Theme Support** - Dark/Light mode

### Dashboard Endpoints

```bash
# Get dashboard stats
curl "http://localhost:3000/api/dashboard/stats"

# Get analytics (1h, 24h, 7d, 30d)
curl "http://localhost:3000/api/dashboard/analytics?period=24h"

# Manage cache
curl "http://localhost:3000/api/dashboard/cache/manage"

# Clear cache
curl -X DELETE "http://localhost:3000/api/dashboard/cache/manage?pattern=*"
```

## Configuration

### Environment Variables

```env
PORT=3000
```

### Cache TTL (default)

| Content Type | TTL |
|-------------|-----|
| Latest Comics | 5 minutes |
| Search Results | 10 minutes |
| Comic Detail | 15 minutes |
| Chapter Images | 30 minutes |

## Project Structure

```
api-manga/
├── src/
│   ├── config/
│   │   └── providers.js          # Provider configuration
│   ├── helper/
│   │   ├── axios_service.js      # HTTP client + Cloudflare protection
│   │   ├── cache_service.js      # Multi-level caching
│   │   ├── data_validator.js     # Data normalization
│   │   └── error_handler.js      # Custom error classes
│   ├── services/
│   │   ├── api_service.js        # Main API service
│   │   ├── scraper_service.js    # Komikcast scraper
│   │   ├── shinigami_scraper.js  # Shinigami scraper
│   │   ├── aquareader_scraper.js # Aquareader scraper
│   │   ├── mangadex_scraper.js   # MangaDex API client
│   │   ├── provider_manager.js   # Provider routing
│   │   ├── request_queue.js      # Request queue management
│   │   ├── data_integrity.js     # Deduplication service
│   │   └── scrape_orchestrator.js# Scraping orchestration
│   ├── middleware/
│   │   ├── rate_limiter.js       # Rate limiting
│   │   └── performance_tracker.js# Performance monitoring
│   ├── router.js                 # API routes
│   └── server.js                 # Express server
├── public/
│   └── dashboard/                # Web dashboard
├── package.json
└── vercel.json                   # Vercel deployment
```

### Vercel (Recommended)

This project is optimized for Vercel serverless deployment with automatic CI/CD.

```bash
# Manual deploy
npx vercel --prod

# Or push to main branch for auto-deploy
git push origin main
```

**Features:**
- Auto-deploy on push to main/master
- Syntax check before deploy
- GitHub Actions CI/CD pipeline

### GitHub Actions CI/CD

CI/CD is pre-configured in `.github/workflows/ci-cd.yml`.

**Required GitHub Secrets:**
| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_ORG_ID` | Organization ID |
| `VERCEL_PROJECT_ID` | Project ID |

See [docs/CI_CD_SETUP.md](docs/CI_CD_SETUP.md) for detailed setup.

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## Vercel Performance Optimizations

This API is optimized for Vercel's serverless environment:

| Optimization | Standard | Vercel |
|--------------|----------|--------|
| Request Timeout | 30s | 8s |
| Retry Attempts | 3 | 1 |
| Cache Size | 1000 | 200 |
| Hash Algorithm | MD5 | djb2 (faster) |
| HTTP Keep-Alive | Enabled | Disabled |
| Compression | JSON | gzip |

All optimizations are **automatic** when deployed to Vercel.

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid input parameters |
| `NOT_FOUND` | Resource not found |
| `PARSE_ERROR` | Failed to parse scraped data |
| `NETWORK_ERROR` | Network request failed |
| `RATE_LIMIT_ERROR` | Rate limit exceeded |
| `PROVIDER_ERROR` | Provider-specific error |

## Rate Limiting

- **Default**: 100 requests per 15 minutes per IP
- **MangaDex**: 5 requests per second (API limit)
- **Scraping Providers**: Internal rate limiting via request queue

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/new-feature`)
3. Commit changes (`git commit -m 'Add new feature'`)
4. Push to branch (`git push origin feature/new-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [MangaDex](https://mangadex.org) for providing the official API
- [Cheerio](https://cheerio.js.org) for HTML parsing
- [Axios](https://axios-http.com) for HTTP requests
- [Chart.js](https://chartjs.org) for dashboard charts

---

**Version**: 2.3.0 | **Author**: [KanekiCraynet](https://github.com/KanekiCraynet)
