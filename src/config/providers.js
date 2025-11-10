/**
 * Provider Configuration
 * Konfigurasi untuk setiap provider yang didukung
 */

const providers = {
  komikcast: {
    name: 'Komikcast',
    baseUrl: 'https://komikcast03.com',
    enabled: true,
    default: true,
    features: {
      latest: true,
      popular: true,
      recommended: true,
      search: true,
      detail: true,
      read: true,
      genre: true,
      genreList: true
    },
    urlPatterns: {
      latest: '/project-list/page/{page}',
      popular: '/',
      recommended: '/',
      search: '/?s={keyword}',
      detail: '/manga/{slug}',
      read: '/{slug}',
      genre: '/genres/{genre}/page/{page}',
      genreList: '/'
    },
    selectors: {
      latest: {
        container: '#content > .wrapper > .postbody > .bixbox',
        items: '.list-update_items > .list-update_items-wrapper > .list-update_item',
        title: 'a > .list-update_item-info > h3',
        href: 'a',
        thumbnail: 'a > .list-update_item-image > img',
        type: 'a > .list-update_item-image > .type',
        chapter: 'a > .list-update_item-info > .other > .chapter',
        rating: 'a > .list-update_item-info > .other > .rate > .rating > .numscore',
        pagination: '.pagination > .page-numbers.current'
      },
      popular: {
        container: '#content > .wrapper > #sidebar',
        items: '.section > .widget-post > .serieslist.pop > ul > li',
        title: '.leftseries > h2 > a',
        href: '.imgseries > a',
        thumbnail: '.imgseries > a > img',
        genre: '.leftseries > span:nth-child(2)',
        year: '.leftseries > span:nth-child(3)'
      },
      recommended: {
        container: '#content > .wrapper > .bixbox > .listupd > .swiper > .swiper-wrapper',
        items: '.swiper-slide',
        title: 'a > .splide__slide-info > .title',
        href: 'a',
        thumbnail: 'a > .splide__slide-image > img',
        type: 'a > .splide__slide-image > .type',
        chapter: 'a > .splide__slide-info > .other > .chapter',
        rating: 'a > .splide__slide-info > .other > .rate > .rating > .numscore'
      },
      search: {
        container: '#content > .wrapper > .postbody > .dev > #main > .list-update',
        items: '.list-update_items > .list-update_items-wrapper > .list-update_item',
        title: 'a > .list-update_item-info > h3',
        href: 'a',
        thumbnail: 'a > .list-update_item-image > img',
        type: 'a > .list-update_item-image > .type',
        chapter: 'a > .list-update_item-info > .other > .chapter',
        rating: 'a > .list-update_item-info > .other > .rate > .rating > .numscore'
      },
      detail: {
        container: '#content > .wrapper > .komik_info',
        title: '.komik_info-body > .komik_info-content > .komik_info-content-body > h1',
        thumbnail: '.komik_info-cover-box > .komik_info-cover-image > img',
        description: '.komik_info-description-sinopsis > p',
        rating: '.komik_info-body > .komik_info-content > .komik_info-content-rating > .komik_info-content-rating-bungkus > .data-rating > strong',
        released: '.komik_info-body > .komik_info-content > .komik_info-content-body > .komik_info-content-meta > span:nth-child(1)',
        author: '.komik_info-body > .komik_info-content > .komik_info-content-body > .komik_info-content-meta > span:nth-child(2)',
        status: '.komik_info-body > .komik_info-content > .komik_info-content-body > .komik_info-content-meta > span:nth-child(3)',
        type: '.komik_info-body > .komik_info-content > .komik_info-content-body > .komik_info-content-meta > span:nth-child(4)',
        chapters: '.komik_info-body > .komik_info-chapters > ul > li',
        chapterTitle: 'a',
        chapterHref: 'a',
        chapterDate: '.chapter-link-time',
        genres: '.komik_info-body > .komik_info-content > .komik_info-content-body > .komik_info-content-genre > a'
      },
      read: {
        container: '#content > .wrapper',
        title: '.chapter_headpost > h1',
        panels: '.chapter_ > #chapter_body > .main-reading-area > img'
      },
      genre: {
        container: '#content > .wrapper > .postbody > .bixbox',
        items: '.listupd > .list-update_items > .list-update_items-wrapper > .list-update_item',
        title: 'a > .list-update_item-info > h3',
        href: 'a',
        thumbnail: 'a > .list-update_item-image > img',
        type: 'a > .list-update_item-image > .type',
        chapter: 'a > .list-update_item-info > .other > .chapter',
        rating: 'a > .list-update_item-info > .other > .rate > .rating > .numscore',
        pagination: '.listupd > .list-update_items > .pagination > .current'
      },
      genreList: {
        container: '#content > .wrapper',
        items: '#sidebar > .section > ul.genre > li',
        title: 'a',
        href: 'a'
      }
    }
  },
  shinigami: {
    name: 'Shinigami',
    baseUrl: 'https://08.shinigami.asia',
    enabled: true,
    default: false,
    features: {
      latest: true,
      popular: true,
      recommended: true,
      search: true,
      detail: true,
      read: true,
      genre: false, // Shinigami mungkin tidak punya genre list seperti Komikcast
      genreList: false
    },
    urlPatterns: {
      latest: '/search', // Using search as latest since structure is different
      popular: '/',
      recommended: '/',
      search: '/search?q={keyword}',
      detail: '/series/{uuid}',
      read: '/chapter/{uuid}',
      genre: null,
      genreList: null
    },
    selectors: {
      latest: {
        container: 'body',
        items: 'a[href^="/series/"]',
        title: 'h4, heading[level=4]',
        href: 'a',
        thumbnail: 'img',
        type: null, // May need to extract from elsewhere
        chapter: 'generic:contains("CH.")',
        rating: null // May need to extract from views count
      },
      popular: {
        container: 'body',
        items: 'a[href^="/series/"]',
        title: 'h4, heading[level=4]',
        href: 'a',
        thumbnail: 'img'
      },
      recommended: {
        container: 'body',
        items: 'a[href^="/series/"]',
        title: 'h4, heading[level=4]',
        href: 'a',
        thumbnail: 'img'
      },
      search: {
        container: 'body',
        items: 'a[href^="/series/"]',
        title: 'h4, heading[level=4]',
        href: 'a',
        thumbnail: 'img',
        chapter: 'generic:contains("CH.")'
      },
      detail: {
        container: 'body',
        title: 'h1, heading[level=1]',
        thumbnail: 'img',
        description: 'p, paragraph',
        rating: null,
        released: null,
        author: null,
        status: null,
        type: null,
        chapters: 'a[href^="/chapter/"]',
        chapterTitle: 'a',
        chapterHref: 'a',
        chapterDate: null,
        genres: null
      },
      read: {
        container: 'body',
        title: 'h1, heading[level=1]',
        panels: 'img[src*="chapter"], img[src*="image"]'
      }
    }
  },
  aquareader: {
    name: 'Aqua Reader',
    baseUrl: 'https://aquareader.net',
    enabled: true,
    default: false,
    features: {
      latest: true,
      popular: true,
      recommended: true,
      search: true,
      detail: true,
      read: true,
      genre: true,
      genreList: true
    },
    urlPatterns: {
      latest: '/page/{page}',
      popular: '/',
      recommended: '/',
      search: '/?s={keyword}',
      detail: '/{slug}',
      read: '/{slug}',
      genre: '/genre/{genre}/page/{page}',
      genreList: '/'
    },
    selectors: {
      latest: {
        container: 'main, #main, .main-content, .content, body',
        items: '.comic-item, .manga-item, article, .post, .item',
        title: 'h3, h2, .title, a',
        href: 'a',
        thumbnail: 'img',
        type: '.type, [class*="type"]',
        chapter: '.chapter, .ch, .chapter-number',
        rating: '.rating, .score, .rate',
        pagination: '.pagination, .page-numbers'
      },
      popular: {
        container: '.popular, .popular-series, .hot, main, body',
        items: '.comic-item, .manga-item, article, .post, .item',
        title: 'h3, h2, .title, a',
        href: 'a',
        thumbnail: 'img',
        type: '.type, [class*="type"]',
        chapter: '.chapter, .ch',
        rating: '.rating, .score'
      },
      recommended: {
        container: '.recommended, .featured, main, body',
        items: '.comic-item, .manga-item, article, .post, .item',
        title: 'h3, h2, .title, a',
        href: 'a',
        thumbnail: 'img',
        type: '.type, [class*="type"]',
        chapter: '.chapter, .ch',
        rating: '.rating, .score'
      },
      search: {
        container: 'main, #main, .search-results, .results, body',
        items: '.comic-item, .manga-item, article, .post, .item, .search-item',
        title: 'h3, h2, .title, a',
        href: 'a',
        thumbnail: 'img',
        type: '.type, [class*="type"]',
        chapter: '.chapter, .ch',
        rating: '.rating, .score'
      },
      detail: {
        container: 'main, #main, .comic-detail, body',
        title: 'h1, .title, .comic-title',
        thumbnail: '.cover img, .thumbnail img, .poster img',
        description: '.description, .synopsis, .summary, .content p',
        rating: '.rating, .score, .rate',
        released: '.released, .year, [class*="released"]',
        author: '.author, [class*="author"]',
        status: '.status, [class*="status"]',
        type: '.type, [class*="type"]',
        chapters: '.chapters a, .chapter-list a, .chapter-item a',
        chapterTitle: 'a',
        chapterHref: 'a',
        chapterDate: '.date, .time',
        genres: '.genres a, .genre a, .tags a'
      },
      read: {
        container: 'main, #main, .reader, .viewer, body',
        title: 'h1, .title, .chapter-title',
        panels: '.reading-content img, .chapter-content img, .comic-images img, img[src*="chapter"]'
      },
      genre: {
        container: 'main, #main, .genre-page, body',
        items: '.comic-item, .manga-item, article, .post, .item',
        title: 'h3, h2, .title, a',
        href: 'a',
        thumbnail: 'img',
        type: '.type, [class*="type"]',
        chapter: '.chapter, .ch',
        rating: '.rating, .score',
        pagination: '.pagination, .page-numbers'
      },
      genreList: {
        container: 'nav, .sidebar, .genre-list, body',
        items: '.genre-list a, .genres a, nav a[href*="/genre/"]',
        title: 'a',
        href: 'a'
      }
    }
  }
};

/**
 * Get provider configuration
 * @param {string} providerId - Provider ID
 * @returns {object|null} Provider configuration or null if not found
 */
const getProvider = (providerId) => {
  return providers[providerId] || null;
};

/**
 * Get default provider
 * @returns {object} Default provider configuration
 */
const getDefaultProvider = () => {
  return Object.values(providers).find(p => p.default) || providers.komikcast;
};

/**
 * Get all enabled providers
 * @returns {Array} Array of enabled provider configurations
 */
const getEnabledProviders = () => {
  return Object.values(providers).filter(p => p.enabled);
};

/**
 * Check if provider supports a feature
 * @param {string} providerId - Provider ID
 * @param {string} feature - Feature name
 * @returns {boolean} True if feature is supported
 */
const supportsFeature = (providerId, feature) => {
  const provider = getProvider(providerId);
  if (!provider) return false;
  return provider.features[feature] === true;
};

module.exports = {
  providers,
  getProvider,
  getDefaultProvider,
  getEnabledProviders,
  supportsFeature
};

