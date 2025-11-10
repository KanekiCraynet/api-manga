/**
 * Aqua Reader Scraper Service
 * Scraping logic khusus untuk Aqua Reader (https://aquareader.net/)
 * Menggunakan HTML scraping dengan Cheerio
 */

const cheerio = require('cheerio');
const { AxiosService } = require('../helper/axios_service');
const { ParseError, NotFoundError } = require('../helper/error_handler');
const {
  normalizeComicItem,
  normalizeChapterItem,
  normalizeUrl,
  normalizeRating,
  normalizePagination
} = require('../helper/data_validator');

const BASE_URL = 'https://aquareader.net';

/**
 * Extract pagination info from element
 * @param {object} $ - Cheerio instance
 * @param {object} element - Cheerio element
 * @returns {object} Pagination info
 */
const extractPagination = ($, element) => {
  let currentPage = 1;
  let lengthPage = 1;

  // Try to find pagination
  const paginationLinks = element.find('.pagination a, .page-numbers, .pagination .page');
  if (paginationLinks.length > 0) {
    // Find current page
    const currentEl = element.find('.pagination .current, .page-numbers.current, .pagination .active');
    if (currentEl.length) {
      currentPage = parseInt(currentEl.text().trim()) || 1;
    }

    // Find last page
    const lastPageEl = element.find('.pagination a:last-child, .page-numbers:last-child').not('.next');
    if (lastPageEl.length) {
      const lastPageText = lastPageEl.text().trim();
      if (lastPageText && !isNaN(lastPageText)) {
        lengthPage = parseInt(lastPageText);
      }
    }
  }

  return {
    current_page: currentPage,
    length_page: lengthPage || 1
  };
};

/**
 * Extract comic item from list element
 * @param {object} $ - Cheerio instance
 * @param {object} element - Cheerio element
 * @param {string} baseSelector - Base selector for items
 * @returns {Array} Array of comic items
 */
const extractComicList = ($, element, baseSelector) => {
  const comics = [];

  // First try Aqua Reader specific selectors
  element.find('.slider__item, .item__wrap, .post-item, .manga-item').each((i, data) => {
    try {
      const $item = $(data);
      
      // Aqua Reader structure: .slider__item > .item__wrap > .slider__content > .slider__content_item > .post-title > h4 > a
      let title = $item.find('h4 a, .post-title h4 a, h4').first().text().trim() ||
                 $item.find('a h4, a .post-title').first().text().trim() ||
                 $item.find('.post-title').first().text().trim();
      
      // Try multiple selector patterns for href
      let href = $item.find('h4 a, .post-title a, a[href*="/manga/"]').first().attr('href') || 
                $item.find('a').first().attr('href') || '';
      
      // Try multiple selector patterns for thumbnail
      let thumbnail = $item.find('img').first().attr('src') || 
                     $item.find('img').first().attr('data-src') ||
                     $item.find('img').first().attr('data-lazy-src') ||
                     $item.find('img').first().attr('data-url') || '';
      
      // Try to extract chapter info - look for text like "Ch. 778" or "Chapter 778"
      const itemText = $item.text();
      const chapterMatch = itemText.match(/Ch\.?\s*(\d+)|Chapter\s*(\d+)/i);
      const chapterText = chapterMatch ? (chapterMatch[1] || chapterMatch[2] || chapterMatch[0]) : '';
      
      // Try to extract rating - look for numbers with stars or ratings
      const ratingMatch = itemText.match(/(\d+\.?\d*)\s*(?:star|rating|score)/i) || 
                         $item.find('.rating, .score, .rate, [class*="rating"]').text().match(/(\d+\.?\d*)/);
      const rating = ratingMatch ? ratingMatch[1] : '';
      
      // Try to extract type (Manhwa, Manhua, Manga) from URL or text
      let type = '';
      if (href) {
        if (href.includes('/manhwa/') || href.includes('manhwa')) type = 'Manhwa';
        else if (href.includes('/manhua/') || href.includes('manhua')) type = 'Manhua';
        else if (href.includes('/manga/') || href.includes('manga')) type = 'Manga';
      }
      
      // Try to extract date
      const dateMatch = itemText.match(/(\w+\s+\d{1,2},\s+\d{4})|(\d{1,2}\/\d{1,2}\/\d{4})/);
      const date = dateMatch ? dateMatch[0] : 
                  $item.find('.date, .updated, .time, [class*="date"]').text().trim() || '';

      if (title && href && !comics.find(c => c.href === normalizeUrl(href, BASE_URL))) {
        comics.push(normalizeComicItem({
          title,
          href: normalizeUrl(href, BASE_URL),
          thumbnail: normalizeUrl(thumbnail, BASE_URL),
          type,
          chapter: chapterText ? `Chapter ${chapterText}` : '',
          rating,
          date
        }, BASE_URL));
      }
    } catch (error) {
      console.error('Error extracting comic item:', error);
    }
  });

  // If no items found with specific selectors, try generic selectors
  if (comics.length === 0 && baseSelector) {
    element.find(baseSelector).each((i, data) => {
      try {
        const $item = $(data);
        
        // Try multiple selector patterns for title
        const title = $item.find('h4, h3, h2, .title, a h4, a h3, a h2, .comic-title, .post-title').first().text().trim() ||
                     $item.find('a').first().attr('title') || 
                     $item.find('a').first().text().trim();
        
        // Try multiple selector patterns for href
        const href = $item.find('a[href*="/manga/"], a[href*="/series/"], a').first().attr('href') || '';
        
        // Try multiple selector patterns for thumbnail
        const thumbnail = $item.find('img').first().attr('src') || 
                         $item.find('img').first().attr('data-src') ||
                         $item.find('img').first().attr('data-lazy-src') || '';
        
        // Try to extract chapter info
        const itemText = $item.text();
        const chapterMatch = itemText.match(/Ch\.?\s*(\d+)|Chapter\s*(\d+)/i);
        const chapterText = chapterMatch ? (chapterMatch[1] || chapterMatch[2] || chapterMatch[0]) : '';
        
        // Try to extract rating
        const ratingMatch = itemText.match(/(\d+\.?\d*)\s*(?:star|rating|score)/i);
        const rating = ratingMatch ? ratingMatch[1] : '';

        if (title && href && href.includes('/manga/') && !comics.find(c => c.href === normalizeUrl(href, BASE_URL))) {
          comics.push(normalizeComicItem({
            title,
            href: normalizeUrl(href, BASE_URL),
            thumbnail: normalizeUrl(thumbnail, BASE_URL),
            chapter: chapterText ? `Chapter ${chapterText}` : '',
            rating
          }, BASE_URL));
        }
      } catch (error) {
        console.error('Error extracting comic item:', error);
      }
    });
  }

  return comics;
};

/**
 * Get latest comics
 * @param {number} page - Page number
 * @returns {Promise<object>} Latest comics with pagination
 */
const getLatestComics = async (page = 1) => {
  try {
    // Try different URL patterns for latest comics
    const url = page > 1 
      ? `${BASE_URL}/page/${page}` 
      : BASE_URL;
    
    const response = await AxiosService(url);
    
    if (response.status !== 200) {
      throw new ParseError('Failed to fetch latest comics');
    }

    const $ = cheerio.load(response.data);
    
    // Aqua Reader uses .slider__item for comic items
    let container = $('body');
    
    // Extract comics using Aqua Reader specific selectors
    let comics = extractComicList($, container, '.slider__item, .item__wrap, .post-item');
    
    // If still no comics, try finding all h4 with links to /manga/
    if (comics.length === 0) {
      $('h4 a[href*="/manga/"]').each((i, el) => {
        try {
          const $el = $(el);
          const $parent = $el.closest('.slider__item, .item__wrap, .post-item, article, .item');
          const title = $el.text().trim();
          const href = $el.attr('href') || '';
          const thumbnail = $parent.find('img').first().attr('src') || 
                           $el.closest('a').find('img').attr('src') || '';
          
          if (title && href && href.includes('/manga/') && !comics.find(c => c.href === normalizeUrl(href, BASE_URL))) {
            // Try to find chapter info in nearby elements
            const parentText = $parent.text();
            const chapterMatch = parentText.match(/Ch\.?\s*(\d+)|Chapter\s*(\d+)/i);
            const chapterText = chapterMatch ? (chapterMatch[1] || chapterMatch[2] || chapterMatch[0]) : '';
            
            comics.push(normalizeComicItem({
              title,
              href: normalizeUrl(href, BASE_URL),
              thumbnail: normalizeUrl(thumbnail, BASE_URL),
              chapter: chapterText ? `Chapter ${chapterText}` : ''
            }, BASE_URL));
          }
        } catch (error) {
          console.error('Error extracting comic from h4:', error);
        }
      });
    }

    const pagination = extractPagination($, container);

    return {
      current_page: page,
      length_page: pagination.length_page || 1,
      has_next: page < (pagination.length_page || 1),
      has_prev: page > 1,
      data: comics.slice(0, 50) // Limit to 50 items per page
    };
  } catch (error) {
    throw new ParseError(`Error scraping latest comics: ${error.message}`, error);
  }
};

/**
 * Get comics by genre
 * @param {string} genreUrl - Genre URL slug
 * @param {number} page - Page number
 * @returns {Promise<object>} Comics by genre with pagination
 */
const getComicsByGenre = async (genreUrl, page = 1) => {
  try {
    const url = page > 1 
      ? `${BASE_URL}/genre/${genreUrl}/page/${page}`
      : `${BASE_URL}/genre/${genreUrl}`;
    
    const response = await AxiosService(url);
    
    if (response.status !== 200) {
      throw new ParseError('Failed to fetch comics by genre');
    }

    const $ = cheerio.load(response.data);
    
    let container = $('main, #main, .main-content, .content, #content, .comic-list');
    if (container.length === 0) {
      container = $('body');
    }

    const comics = extractComicList($, container, '.comic-item, .manga-item, article, .post, .item');
    const pagination = extractPagination($, container);

    return {
      current_page: page,
      length_page: pagination.length_page || 1,
      has_next: page < (pagination.length_page || 1),
      has_prev: page > 1,
      data: comics
    };
  } catch (error) {
    throw new ParseError(`Error scraping comics by genre: ${error.message}`, error);
  }
};

/**
 * Get all genres
 * @returns {Promise<Array>} Array of genres
 */
const getGenres = async () => {
  try {
    const response = await AxiosService(BASE_URL);
    
    if (response.status !== 200) {
      throw new ParseError('Failed to fetch genres');
    }

    const $ = cheerio.load(response.data);
    const genres = [];
    const seenHrefs = new Set();

    // Aqua Reader uses /manga-genre/ for genre links
    // Look for links that contain /manga-genre/ or /genre/
    $('a[href*="/manga-genre/"], a[href*="/genre/"]').each((i, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const href = $el.attr('href') || '';
      
      // Filter out non-genre links and get clean genre names
      if (title && href && (href.includes('/manga-genre/') || href.includes('/genre/')) && 
          !href.includes('/manga/') && title.length > 1 && title.length < 50) {
        const normalizedHref = normalizeUrl(href, BASE_URL);
        
        if (!seenHrefs.has(normalizedHref) && !title.toLowerCase().includes('all')) {
          seenHrefs.add(normalizedHref);
          genres.push({
            title: title.replace(/[:\-]/g, '').trim(),
            href: normalizedHref
          });
        }
      }
    });

    // Also check navigation menus
    $('nav a, .menu a, .navigation a').each((i, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const href = $el.attr('href') || '';
      
      if (title && href && (href.includes('/manga-genre/') || href.includes('/genre/')) &&
          !seenHrefs.has(normalizeUrl(href, BASE_URL))) {
        const normalizedHref = normalizeUrl(href, BASE_URL);
        seenHrefs.add(normalizedHref);
        genres.push({
          title: title.replace(/[:\-]/g, '').trim(),
          href: normalizedHref
        });
      }
    });

    // Remove duplicates and sort
    const uniqueGenres = [];
    const titleSet = new Set();
    genres.forEach(genre => {
      if (!titleSet.has(genre.title.toLowerCase())) {
        titleSet.add(genre.title.toLowerCase());
        uniqueGenres.push(genre);
      }
    });

    return uniqueGenres.sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    throw new ParseError(`Error scraping genres: ${error.message}`, error);
  }
};

/**
 * Get comic detail
 * @param {string} url - Comic URL slug
 * @returns {Promise<object>} Comic detail
 */
const getComicDetail = async (url) => {
  try {
    // Clean URL - remove leading/trailing slashes and ensure it's a valid path
    const cleanUrl = url.replace(/^\/+|\/+$/g, '');
    const comicUrl = `${BASE_URL}/${cleanUrl}`;
    
    const response = await AxiosService(comicUrl);
    
    if (response.status !== 200) {
      throw new NotFoundError('Comic not found');
    }

    const $ = cheerio.load(response.data);
    
    // Try multiple selectors for title
    const title = $('h1, .title, .comic-title, .series-title, header h1').first().text().trim() || '';
    
    // Try multiple selectors for thumbnail
    const thumbnail = $('.cover img, .thumbnail img, .poster img, .comic-cover img, img[src*="cover"], img[src*="poster"]').first().attr('src') ||
                     $('.cover img, .thumbnail img, .poster img, .comic-cover img').first().attr('data-src') || '';
    
    // Try multiple selectors for description
    const description = $('.description, .synopsis, .summary, .content p, .about p').first().text().trim() || 
                       $('meta[name="description"]').attr('content') || '';
    
    // Try to extract metadata
    const metaText = $('.meta, .info, .details, .series-info').text();
    const ratingMatch = metaText.match(/rating[:\s]*([\d.]+)/i) || 
                       $('.rating, .score').text().match(/([\d.]+)/);
    const rating = ratingMatch ? ratingMatch[1] : '';
    
    const authorMatch = metaText.match(/author[:\s]*([^\n]+)/i);
    const author = authorMatch ? authorMatch[1].trim() : 
                  $('.author, [class*="author"]').text().trim() || '';
    
    const statusMatch = metaText.match(/status[:\s]*([^\n]+)/i);
    const status = statusMatch ? statusMatch[1].trim() :
                  $('.status, [class*="status"]').text().trim() || '';
    
    const typeMatch = metaText.match(/type[:\s]*(manhwa|manhua|manga)/i);
    const type = typeMatch ? typeMatch[1] :
                $('.type, [class*="type"]').text().trim() || '';
    
    const releasedMatch = metaText.match(/released[:\s]*([^\n]+)/i);
    const released = releasedMatch ? releasedMatch[1].trim() :
                    $('.released, .year, [class*="released"]').text().trim() || '';

    // Extract chapters
    const chapters = [];
    const chapterSelectors = [
      '.chapters a, .chapter-list a',
      '.chapter-item a, .chapter-link',
      'a[href*="/chapter/"], a[href*="/read/"]',
      '.episodes a, .episode-list a'
    ];

    for (const selector of chapterSelectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        const chapterTitle = $el.text().trim();
        const chapterHref = $el.attr('href') || '';
        const chapterDate = $el.closest('li, .item').find('.date, .time').text().trim() || '';
        
        if (chapterTitle && chapterHref) {
          chapters.push(normalizeChapterItem({
            title: chapterTitle,
            href: normalizeUrl(chapterHref, BASE_URL),
            date: chapterDate
          }, BASE_URL));
        }
      });
      
      if (chapters.length > 0) break;
    }

    // Extract genres - Aqua Reader specific
    const genres = [];
    const seenGenres = new Set();
    
    // Try multiple selectors for genres
    const genreSelectors = [
      '.genres a, .genre a, .tags a',
      'a[href*="/manga-genre/"]',
      '.manga-genres a, .wp-manga-genres a',
      '[class*="genre"] a[href*="/manga-genre/"]'
    ];
    
    for (const selector of genreSelectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        const genreTitle = $el.text().trim();
        const genreHref = $el.attr('href') || '';
        
        // Only include if it's a genre link and not already seen
        if (genreTitle && genreHref && 
            (genreHref.includes('/manga-genre/') || genreHref.includes('/genre/')) &&
            genreTitle.length > 1 && genreTitle.length < 50 &&
            !seenGenres.has(genreTitle.toLowerCase())) {
          seenGenres.add(genreTitle.toLowerCase());
          genres.push({
            title: genreTitle,
            href: normalizeUrl(genreHref, BASE_URL)
          });
        }
      });
      
      // Limit to reasonable number of genres (usually 5-15)
      if (genres.length > 0 && genres.length < 20) {
        break;
      }
    }

    if (!title) {
      throw new NotFoundError('Comic not found');
    }

    return {
      title,
      rating: normalizeRating(rating),
      status: status || 'Unknown',
      type: type || '',
      released: released || '',
      author: author || '',
      genre: genres,
      description: description || '',
      thumbnail: normalizeUrl(thumbnail, BASE_URL),
      chapter: chapters
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    throw new ParseError(`Error scraping comic detail: ${error.message}`, error);
  }
};

/**
 * Read chapter (get images)
 * @param {string} url - Chapter URL
 * @returns {Promise<object>} Chapter data with images
 */
const readChapter = async (url) => {
  try {
    // Clean URL
    const cleanUrl = url.replace(/^\/+|\/+$/g, '');
    const chapterUrl = `${BASE_URL}/${cleanUrl}`;
    
    const response = await AxiosService(chapterUrl);
    
    if (response.status !== 200) {
      throw new NotFoundError('Chapter not found');
    }

    const $ = cheerio.load(response.data);
    
    // Try multiple selectors for chapter title
    const title = $('h1, .title, .chapter-title, .episode-title').first().text().trim() || '';
    
    // Try multiple selectors for images
    const panels = [];
    const imageSelectors = [
      '.reading-content img, .chapter-content img',
      '.comic-images img, .manga-images img',
      '.panel img, .page img',
      '.reader img, .viewer img',
      'img[src*="chapter"], img[src*="page"], img[src*="image"]'
    ];

    for (const selector of imageSelectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || 
                   $el.attr('data-src') || 
                   $el.attr('data-lazy-src') ||
                   $el.attr('data-url') || '';
        
        if (src && !src.includes('logo') && !src.includes('avatar') && !src.includes('icon')) {
          const fullUrl = normalizeUrl(src, BASE_URL);
          if (!panels.includes(fullUrl)) {
            panels.push(fullUrl);
          }
        }
      });
      
      if (panels.length > 0) break;
    }

    if (panels.length === 0) {
      throw new NotFoundError('No images found in chapter');
    }

    return {
      title: title || 'Chapter',
      panel: panels
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    throw new ParseError(`Error scraping chapter: ${error.message}`, error);
  }
};

/**
 * Search comics
 * @param {string} keyword - Search keyword
 * @returns {Promise<Array>} Array of search results
 */
const searchComics = async (keyword) => {
  try {
    // Try different search URL patterns
    const searchUrls = [
      `${BASE_URL}/?s=${encodeURIComponent(keyword)}`,
      `${BASE_URL}/search?q=${encodeURIComponent(keyword)}`,
      `${BASE_URL}/search/${encodeURIComponent(keyword)}`
    ];

    let response = null;
    for (const url of searchUrls) {
      try {
        response = await AxiosService(url);
        if (response.status === 200) break;
      } catch (e) {
        continue;
      }
    }

    if (!response || response.status !== 200) {
      throw new ParseError('Failed to search comics');
    }

    const $ = cheerio.load(response.data);
    
    let container = $('main, #main, .main-content, .content, #content, .search-results, .results');
    if (container.length === 0) {
      container = $('body');
    }

    const comics = extractComicList($, container, '.comic-item, .manga-item, article, .post, .item, .search-item');

    return comics;
  } catch (error) {
    throw new ParseError(`Error searching comics: ${error.message}`, error);
  }
};

/**
 * Get popular comics
 * @returns {Promise<Array>} Array of popular comics
 */
const getPopularComics = async () => {
  try {
    const response = await AxiosService(BASE_URL);
    
    if (response.status !== 200) {
      throw new ParseError('Failed to fetch popular comics');
    }

    const $ = cheerio.load(response.data);
    
    // Aqua Reader popular section - look for sections with "Hot" or "Popular" headings
    let container = $('body');
    let comics = [];

    // Find sections marked as "Hot" or "Popular"
    $('h2, h3, h4').each((i, el) => {
      const $el = $(el);
      const text = $el.text().toLowerCase();
      if (text.includes('popular') || text.includes('hot') || text.includes('trending')) {
        // Get the parent container and find slider items within it
        const section = $el.closest('.widget, .section, .container, .wrap').length ? 
                       $el.closest('.widget, .section, .container, .wrap') : 
                       $el.parent().nextAll().addBack().parent();
        const sectionComics = extractComicList($, section, '.slider__item, .item__wrap, .post-item');
        comics.push(...sectionComics);
      }
    });

    // If no comics found in specific sections, extract from all slider items
    if (comics.length === 0) {
      comics = extractComicList($, container, '.slider__item, .item__wrap, .post-item');
    }
    
    // Remove duplicates
    const uniqueComics = [];
    const seenHrefs = new Set();
    comics.forEach(comic => {
      if (!seenHrefs.has(comic.href)) {
        seenHrefs.add(comic.href);
        uniqueComics.push(comic);
      }
    });

    return uniqueComics.slice(0, 50); // Limit to 50 items
  } catch (error) {
    throw new ParseError(`Error scraping popular comics: ${error.message}`, error);
  }
};

/**
 * Get recommended comics
 * @returns {Promise<Array>} Array of recommended comics
 */
const getRecommendedComics = async () => {
  try {
    const response = await AxiosService(BASE_URL);
    
    if (response.status !== 200) {
      throw new ParseError('Failed to fetch recommended comics');
    }

    const $ = cheerio.load(response.data);
    
    // Aqua Reader recommended section - similar to popular
    let container = $('body');
    let comics = [];

    // Extract from all slider items (recommended are usually in the main sections)
    comics = extractComicList($, container, '.slider__item, .item__wrap, .post-item');
    
    // Remove duplicates
    const uniqueComics = [];
    const seenHrefs = new Set();
    comics.forEach(comic => {
      if (!seenHrefs.has(comic.href)) {
        seenHrefs.add(comic.href);
        uniqueComics.push(comic);
      }
    });

    return uniqueComics.slice(0, 50); // Limit to 50 items
  } catch (error) {
    throw new ParseError(`Error scraping recommended comics: ${error.message}`, error);
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
  BASE_URL
};

