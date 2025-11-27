/**
 * MangaDex Scraper Service
 * Uses official MangaDex API v5 (https://api.mangadex.org)
 * No web scraping needed - direct API access
 */

const axios = require('axios');
const { ParseError, NotFoundError, NetworkError } = require('../helper/error_handler');
const {
  normalizeComicItem,
  normalizeChapterItem,
  normalizeRating
} = require('../helper/data_validator');

const BASE_URL = 'https://mangadex.org';
const API_BASE_URL = 'https://api.mangadex.org';
const COVER_BASE_URL = 'https://uploads.mangadex.org/covers';

// Rate limiting configuration
const RATE_LIMIT = {
  requestsPerSecond: 5,
  lastRequestTime: 0,
  minInterval: 200 // ms between requests
};

/**
 * Rate-limited API request
 * @param {string} endpoint - API endpoint
 * @param {object} params - Query parameters
 * @returns {Promise<object>} API response data
 */
const apiRequest = async (endpoint, params = {}) => {
  // Rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT.minInterval) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.minInterval - timeSinceLastRequest));
  }
  RATE_LIMIT.lastRequestTime = Date.now();

  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`, {
      params,
      headers: {
        'User-Agent': 'MangaAPI/2.1.0 (https://github.com/KanekiCraynet/api-manga)',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    if (response.data.result === 'error') {
      throw new ParseError(response.data.errors?.[0]?.detail || 'API error');
    }

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new NotFoundError('Resource not found on MangaDex');
    }
    if (error.response?.status === 429) {
      throw new NetworkError('MangaDex rate limit exceeded. Please try again later.');
    }
    throw new ParseError(`MangaDex API error: ${error.message}`);
  }
};

/**
 * Extract cover URL from manga relationships
 * @param {object} manga - Manga object with relationships
 * @returns {string} Cover URL
 */
const extractCoverUrl = (manga) => {
  const coverArt = manga.relationships?.find(r => r.type === 'cover_art');
  if (coverArt?.attributes?.fileName) {
    return `${COVER_BASE_URL}/${manga.id}/${coverArt.attributes.fileName}.256.jpg`;
  }
  return '';
};

/**
 * Extract author name from manga relationships
 * @param {object} manga - Manga object with relationships
 * @returns {string} Author name
 */
const extractAuthor = (manga) => {
  const author = manga.relationships?.find(r => r.type === 'author');
  return author?.attributes?.name || '';
};

/**
 * Get localized title (prefer English, fallback to other languages)
 * @param {object} attributes - Manga attributes
 * @returns {string} Title
 */
const getLocalizedTitle = (attributes) => {
  if (!attributes) return '';
  
  const title = attributes.title;
  if (!title) return '';
  
  return title.en || title['ja-ro'] || title.ja || Object.values(title)[0] || '';
};

/**
 * Get localized description
 * @param {object} attributes - Manga attributes
 * @returns {string} Description
 */
const getLocalizedDescription = (attributes) => {
  if (!attributes?.description) return '';
  
  const desc = attributes.description;
  return desc.en || desc['ja-ro'] || Object.values(desc)[0] || '';
};

/**
 * Map MangaDex status to standard status
 * @param {string} status - MangaDex status
 * @returns {string} Normalized status
 */
const mapStatus = (status) => {
  const statusMap = {
    'ongoing': 'Ongoing',
    'completed': 'Completed',
    'hiatus': 'Hiatus',
    'cancelled': 'Cancelled'
  };
  return statusMap[status] || status || 'Unknown';
};

/**
 * Transform MangaDex manga to standard format
 * @param {object} manga - MangaDex manga object
 * @returns {object} Normalized comic item
 */
const transformManga = (manga) => {
  const attributes = manga.attributes || {};
  
  return normalizeComicItem({
    title: getLocalizedTitle(attributes),
    href: `/manga/${manga.id}`,
    thumbnail: extractCoverUrl(manga),
    type: attributes.originalLanguage === 'ja' ? 'Manga' : 
          attributes.originalLanguage === 'ko' ? 'Manhwa' : 
          attributes.originalLanguage === 'zh' ? 'Manhua' : 'Comic',
    chapter: attributes.lastChapter ? `Chapter ${attributes.lastChapter}` : '',
    rating: normalizeRating(attributes.rating?.average || 0),
    genre: (attributes.tags || [])
      .filter(tag => tag.attributes?.group === 'genre')
      .map(tag => tag.attributes?.name?.en || tag.attributes?.name?.['ja-ro'] || '')
      .filter(Boolean)
      .join(', '),
    year: attributes.year || '',
    status: mapStatus(attributes.status),
    author: extractAuthor(manga),
    released: attributes.year ? String(attributes.year) : '',
    description: getLocalizedDescription(attributes)
  }, BASE_URL);
};

/**
 * Get latest comics
 * @param {number} page - Page number
 * @returns {Promise<object>} Latest comics with pagination
 */
const getLatestComics = async (page = 1) => {
  try {
    const limit = 24;
    const offset = (page - 1) * limit;

    const data = await apiRequest('/manga', {
      limit,
      offset,
      order: { latestUploadedChapter: 'desc' },
      includes: ['cover_art', 'author'],
      contentRating: ['safe', 'suggestive'],
      hasAvailableChapters: true
    });

    const comics = (data.data || []).map(transformManga);
    const total = data.total || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      current_page: page,
      length_page: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
      data: comics
    };
  } catch (error) {
    throw new ParseError(`Error fetching latest comics from MangaDex: ${error.message}`);
  }
};

/**
 * Get comics by genre/tag
 * @param {string} genreUrl - Genre tag ID or name
 * @param {number} page - Page number
 * @returns {Promise<object>} Comics by genre with pagination
 */
const getComicsByGenre = async (genreUrl, page = 1) => {
  try {
    const limit = 24;
    const offset = (page - 1) * limit;

    // First, try to find the tag ID if genreUrl is a name
    let tagId = genreUrl;
    if (!genreUrl.match(/^[0-9a-f-]{36}$/i)) {
      const tagsResponse = await apiRequest('/manga/tag');
      const tag = tagsResponse.data?.find(t => 
        t.attributes?.name?.en?.toLowerCase() === genreUrl.toLowerCase()
      );
      if (tag) {
        tagId = tag.id;
      }
    }

    const data = await apiRequest('/manga', {
      limit,
      offset,
      includedTags: [tagId],
      order: { followedCount: 'desc' },
      includes: ['cover_art', 'author'],
      contentRating: ['safe', 'suggestive'],
      hasAvailableChapters: true
    });

    const comics = (data.data || []).map(transformManga);
    const total = data.total || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      current_page: page,
      length_page: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
      data: comics
    };
  } catch (error) {
    throw new ParseError(`Error fetching comics by genre from MangaDex: ${error.message}`);
  }
};

/**
 * Get all genres/tags
 * @returns {Promise<Array>} Array of genres
 */
const getGenres = async () => {
  try {
    const data = await apiRequest('/manga/tag');

    const genres = (data.data || [])
      .filter(tag => tag.attributes?.group === 'genre')
      .map(tag => ({
        title: tag.attributes?.name?.en || tag.attributes?.name?.['ja-ro'] || '',
        href: `/genre/${tag.id}`
      }))
      .filter(genre => genre.title)
      .sort((a, b) => a.title.localeCompare(b.title));

    return genres;
  } catch (error) {
    throw new ParseError(`Error fetching genres from MangaDex: ${error.message}`);
  }
};

/**
 * Get comic detail
 * @param {string} url - Manga UUID
 * @returns {Promise<object>} Comic detail
 */
const getComicDetail = async (url) => {
  try {
    // Extract UUID from URL if needed
    const mangaId = url.includes('/') ? url.split('/').pop().replace(/\/$/, '') : url;

    const data = await apiRequest(`/manga/${mangaId}`, {
      includes: ['cover_art', 'author', 'artist']
    });

    const manga = data.data;
    const attributes = manga.attributes || {};

    // Get chapters
    const chaptersData = await apiRequest(`/manga/${mangaId}/feed`, {
      limit: 500,
      order: { chapter: 'desc' },
      translatedLanguage: ['en'],
      includes: ['scanlation_group']
    });

    const chapters = (chaptersData.data || [])
      .filter(ch => ch.attributes?.chapter) // Filter out chapters without numbers
      .reduce((acc, ch) => {
        // Deduplicate by chapter number
        const chNum = ch.attributes.chapter;
        if (!acc.some(existing => existing.attributes?.chapter === chNum)) {
          acc.push(ch);
        }
        return acc;
      }, [])
      .map(ch => normalizeChapterItem({
        title: ch.attributes?.title || `Chapter ${ch.attributes?.chapter || ''}`,
        href: `/chapter/${ch.id}`,
        date: ch.attributes?.publishAt 
          ? new Date(ch.attributes.publishAt).toLocaleDateString()
          : ''
      }, BASE_URL));

    // Extract genres
    const genres = (attributes.tags || [])
      .filter(tag => tag.attributes?.group === 'genre' || tag.attributes?.group === 'theme')
      .map(tag => ({
        title: tag.attributes?.name?.en || '',
        href: `/genre/${tag.id}`
      }))
      .filter(g => g.title);

    return {
      title: getLocalizedTitle(attributes),
      rating: normalizeRating(attributes.rating?.average || 0),
      status: mapStatus(attributes.status),
      type: attributes.originalLanguage === 'ja' ? 'Manga' : 
            attributes.originalLanguage === 'ko' ? 'Manhwa' : 
            attributes.originalLanguage === 'zh' ? 'Manhua' : 'Comic',
      released: attributes.year ? String(attributes.year) : '',
      author: extractAuthor(manga),
      genre: genres,
      description: getLocalizedDescription(attributes),
      thumbnail: extractCoverUrl(manga),
      chapter: chapters
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new ParseError(`Error fetching comic detail from MangaDex: ${error.message}`);
  }
};

/**
 * Read chapter (get images)
 * @param {string} url - Chapter UUID
 * @returns {Promise<object>} Chapter data with images
 */
const readChapter = async (url) => {
  try {
    // Extract UUID from URL if needed
    const chapterId = url.includes('/') ? url.split('/').pop().replace(/\/$/, '') : url;

    // Get chapter info
    const chapterData = await apiRequest(`/chapter/${chapterId}`);
    const chapter = chapterData.data;

    // Get at-home server for images
    const atHomeData = await apiRequest(`/at-home/server/${chapterId}`);
    
    const baseUrl = atHomeData.baseUrl;
    const chapterHash = atHomeData.chapter?.hash;
    const images = atHomeData.chapter?.data || [];

    const panels = images.map(filename => 
      `${baseUrl}/data/${chapterHash}/${filename}`
    );

    return {
      title: chapter.attributes?.title || `Chapter ${chapter.attributes?.chapter || ''}`,
      panel: panels
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new ParseError(`Error reading chapter from MangaDex: ${error.message}`);
  }
};

/**
 * Search comics
 * @param {string} keyword - Search keyword
 * @returns {Promise<Array>} Array of search results
 */
const searchComics = async (keyword) => {
  try {
    const data = await apiRequest('/manga', {
      limit: 50,
      title: keyword,
      order: { relevance: 'desc' },
      includes: ['cover_art', 'author'],
      contentRating: ['safe', 'suggestive']
    });

    const comics = (data.data || []).map(transformManga);
    return comics;
  } catch (error) {
    throw new ParseError(`Error searching comics on MangaDex: ${error.message}`);
  }
};

/**
 * Get popular comics
 * @returns {Promise<Array>} Array of popular comics
 */
const getPopularComics = async () => {
  try {
    const data = await apiRequest('/manga', {
      limit: 50,
      order: { followedCount: 'desc' },
      includes: ['cover_art', 'author'],
      contentRating: ['safe', 'suggestive'],
      hasAvailableChapters: true
    });

    const comics = (data.data || []).map(transformManga);
    return comics;
  } catch (error) {
    throw new ParseError(`Error fetching popular comics from MangaDex: ${error.message}`);
  }
};

/**
 * Get recommended comics (uses highly rated manga)
 * @returns {Promise<Array>} Array of recommended comics
 */
const getRecommendedComics = async () => {
  try {
    const data = await apiRequest('/manga', {
      limit: 50,
      order: { rating: 'desc' },
      includes: ['cover_art', 'author'],
      contentRating: ['safe', 'suggestive'],
      hasAvailableChapters: true
    });

    const comics = (data.data || []).map(transformManga);
    return comics;
  } catch (error) {
    throw new ParseError(`Error fetching recommended comics from MangaDex: ${error.message}`);
  }
};

module.exports = {
  getLatestComics,
  getComicsByGenre,
  getGenres,
  getComicDetail,
  readChapter,
  searchComics,
  getPopularComics,
  getRecommendedComics,
  BASE_URL,
  API_BASE_URL
};
