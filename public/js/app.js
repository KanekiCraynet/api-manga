/**
 * MangaAPI Frontend Application
 * Handles all UI interactions and API calls
 */

// ===== Configuration =====
const API_BASE = window.location.origin;
let currentProvider = 'mangadex';
let currentPage = 1;
let currentManga = null;
let currentChapters = [];
let currentChapterIndex = 0;

// ===== DOM Elements =====
const elements = {
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    providerSelect: document.getElementById('providerSelect'),
    themeToggle: document.getElementById('themeToggle'),
    latestGrid: document.getElementById('latestGrid'),
    popularGrid: document.getElementById('popularGrid'),
    searchGrid: document.getElementById('searchGrid'),
    searchResults: document.getElementById('searchResults'),
    searchQuery: document.getElementById('searchQuery'),
    clearSearch: document.getElementById('clearSearch'),
    refreshLatest: document.getElementById('refreshLatest'),
    latestPagination: document.getElementById('latestPagination'),
    detailModal: document.getElementById('detailModal'),
    detailContent: document.getElementById('detailContent'),
    closeModal: document.getElementById('closeModal'),
    readerModal: document.getElementById('readerModal'),
    readerContent: document.getElementById('readerContent'),
    chapterTitle: document.getElementById('chapterTitle'),
    closeReader: document.getElementById('closeReader'),
    prevChapter: document.getElementById('prevChapter'),
    nextChapter: document.getElementById('nextChapter'),
    cacheHitRate: document.getElementById('cacheHitRate'),
    toast: document.getElementById('toast')
};

// ===== API Functions =====
async function fetchAPI(endpoint, params = {}) {
    const url = new URL(`${API_BASE}${endpoint}`);
    Object.keys(params).forEach(key => {
        if (params[key] !== undefined) url.searchParams.append(key, params[key]);
    });

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'error') {
            throw new Error(data.message || 'API Error');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        showToast(error.message, 'error');
        throw error;
    }
}

async function getLatest(page = 1, forceRefresh = false) {
    return fetchAPI('/terbaru', {
        page,
        provider: currentProvider,
        forceRefresh: forceRefresh ? 'true' : undefined
    });
}

async function getPopular() {
    return fetchAPI('/popular', { provider: currentProvider });
}

async function searchManga(keyword) {
    return fetchAPI('/search', { keyword, provider: currentProvider });
}

async function getMangaDetail(slug) {
    // Remove leading slash and /manga/ prefix if present
    let cleanSlug = slug;
    if (cleanSlug.startsWith('/')) cleanSlug = cleanSlug.substring(1);
    if (cleanSlug.startsWith('manga/')) cleanSlug = cleanSlug.substring(6);

    return fetchAPI(`/detail/${cleanSlug}`, { provider: currentProvider });
}

async function getChapterImages(slug) {
    // Remove leading slash and chapter/ prefix if present
    let cleanSlug = slug;
    if (cleanSlug.startsWith('/')) cleanSlug = cleanSlug.substring(1);
    if (cleanSlug.startsWith('chapter/')) cleanSlug = cleanSlug.substring(8);

    return fetchAPI(`/read/${cleanSlug}`, { provider: currentProvider });
}

async function getHealth() {
    return fetchAPI('/health');
}

// ===== Render Functions =====
function createMangaCard(manga) {
    const card = document.createElement('div');
    card.className = 'manga-card';
    card.dataset.href = manga.href;

    const thumbnail = manga.thumbnail || 'https://via.placeholder.com/180x240?text=No+Image';
    const type = manga.type || 'Manga';
    const status = manga.status || 'Ongoing';
    const title = manga.title || 'Unknown';
    const chapter = manga.chapter || '';
    const rating = manga.rating || 0;

    card.innerHTML = `
    <div class="manga-card-image">
      <img src="${thumbnail}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/180x240?text=No+Image'">
      <span class="manga-type">${type}</span>
      <span class="manga-status ${status.toLowerCase() === 'completed' ? 'completed' : ''}">${status}</span>
    </div>
    <div class="manga-card-content">
      <h3 class="manga-title">${title}</h3>
      ${chapter ? `<p class="manga-chapter">${chapter}</p>` : ''}
      ${rating > 0 ? `<div class="manga-rating">★ ${rating.toFixed(1)}</div>` : ''}
    </div>
  `;

    card.addEventListener('click', () => openMangaDetail(manga.href));

    return card;
}

function renderMangaGrid(container, mangaList) {
    container.innerHTML = '';

    if (!mangaList || mangaList.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); grid-column: 1/-1; padding: 40px;">Tidak ada manga ditemukan</p>';
        return;
    }

    mangaList.forEach(manga => {
        container.appendChild(createMangaCard(manga));
    });
}

function renderPagination(container, currentPage, totalPages, hasNext, hasPrev) {
    container.innerHTML = '';

    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = !hasPrev;
    prevBtn.addEventListener('click', () => loadLatest(currentPage - 1));
    container.appendChild(prevBtn);

    const pageInfo = document.createElement('button');
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    pageInfo.className = 'active';
    container.appendChild(pageInfo);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = !hasNext;
    nextBtn.addEventListener('click', () => loadLatest(currentPage + 1));
    container.appendChild(nextBtn);
}

function renderMangaDetail(detail) {
    // FIX: API returns 'chapter' (singular), not 'chapter_list' or 'chapters'
    const chapters = detail.chapter || detail.chapter_list || detail.chapters || [];
    currentChapters = chapters;

    // Handle genre - can be array or string
    let genreHtml = '';
    if (Array.isArray(detail.genre)) {
        genreHtml = detail.genre.map(g => `<span>${typeof g === 'object' ? g.title : g}</span>`).join('');
    } else if (typeof detail.genre === 'string' && detail.genre) {
        genreHtml = detail.genre.split(',').map(g => `<span>${g.trim()}</span>`).join('');
    }

    elements.detailContent.innerHTML = `
    <div class="detail-header">
      <div class="detail-cover">
        <img src="${detail.thumbnail || 'https://via.placeholder.com/220x320'}" alt="${detail.title}" onerror="this.src='https://via.placeholder.com/220x320?text=No+Image'">
      </div>
      <div class="detail-info">
        <h1>${detail.title || 'Unknown'}</h1>
        <div class="detail-meta">
          <span>📝 ${detail.author || 'Unknown'}</span>
          <span>📊 ${detail.status || 'Ongoing'}</span>
          <span>🏷️ ${detail.type || 'Manga'}</span>
          ${detail.rating ? `<span>★ ${detail.rating}</span>` : ''}
          ${detail.released ? `<span>📅 ${detail.released}</span>` : ''}
        </div>
        <div class="detail-meta genre-tags">
          ${genreHtml}
        </div>
        <p class="detail-description">${detail.synopsis || detail.description || 'No description available.'}</p>
      </div>
    </div>
    <div class="chapters-list">
      <h3>📚 Daftar Chapter (${chapters.length})</h3>
      ${chapters.length > 0 ? chapters.slice(0, 50).map((ch, idx) => `
        <div class="chapter-item" data-href="${ch.href || ch.chapter_endpoint}" data-index="${idx}">
          <span class="chapter-name">${ch.title || ch.chapter_title || ch.name || `Chapter ${idx + 1}`}</span>
          <span class="chapter-date">${ch.date || ch.chapter_date || ''}</span>
        </div>
      `).join('') : '<p style="color: var(--text-muted); padding: 20px;">No chapters available</p>'}
      ${chapters.length > 50 ? `<p style="color: var(--text-muted); text-align: center; padding: 10px;">+ ${chapters.length - 50} more chapters</p>` : ''}
    </div>
  `;

    // Add chapter click handlers
    document.querySelectorAll('.chapter-item').forEach(item => {
        item.addEventListener('click', () => {
            const href = item.dataset.href;
            const index = parseInt(item.dataset.index);
            openChapterReader(href, index);
        });
    });
}

function renderChapterImages(images) {
    elements.readerContent.innerHTML = '';

    if (!images || images.length === 0) {
        elements.readerContent.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No images found</p>';
        return;
    }

    images.forEach((img, idx) => {
        const imgUrl = typeof img === 'string' ? img : img.image_url || img.url;
        const imgEl = document.createElement('img');
        imgEl.src = imgUrl;
        imgEl.alt = `Page ${idx + 1}`;
        imgEl.loading = 'lazy';
        imgEl.onerror = function () { this.src = 'https://via.placeholder.com/800x1200?text=Image+Not+Found'; };
        elements.readerContent.appendChild(imgEl);
    });
}

// ===== Load Functions =====
async function loadLatest(page = 1, forceRefresh = false) {
    currentPage = page;
    elements.latestGrid.innerHTML = '<div class="loading-skeleton"></div>'.repeat(8);

    try {
        const data = await getLatest(page, forceRefresh);
        renderMangaGrid(elements.latestGrid, data.data);
        renderPagination(
            elements.latestPagination,
            data.current_page || page,
            data.length_page || 1,
            data.has_next,
            data.has_prev
        );
    } catch (error) {
        elements.latestGrid.innerHTML = '<p style="color: var(--error); text-align: center; grid-column: 1/-1;">Gagal memuat data</p>';
    }
}

async function loadPopular() {
    elements.popularGrid.innerHTML = '<div class="loading-skeleton"></div>'.repeat(8);

    try {
        const data = await getPopular();
        renderMangaGrid(elements.popularGrid, data.data);
    } catch (error) {
        elements.popularGrid.innerHTML = '<p style="color: var(--error); text-align: center; grid-column: 1/-1;">Gagal memuat data</p>';
    }
}

async function performSearch(keyword) {
    if (!keyword.trim()) return;

    elements.searchQuery.textContent = keyword;
    elements.searchResults.classList.remove('hidden');
    elements.searchGrid.innerHTML = '<div class="loading-skeleton"></div>'.repeat(8);

    // Scroll to results
    elements.searchResults.scrollIntoView({ behavior: 'smooth' });

    try {
        const data = await searchManga(keyword);
        renderMangaGrid(elements.searchGrid, data.data);
    } catch (error) {
        elements.searchGrid.innerHTML = '<p style="color: var(--error); text-align: center; grid-column: 1/-1;">Pencarian gagal</p>';
    }
}

async function openMangaDetail(href) {
    // Show modal immediately with loading state
    elements.detailModal.classList.add('active');
    elements.detailContent.innerHTML = '<div class="loading-skeleton" style="height: 400px;"></div>';

    try {
        const data = await getMangaDetail(href);
        currentManga = data.data || data;
        renderMangaDetail(currentManga);
    } catch (error) {
        console.error('Detail error:', error);
        elements.detailContent.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <p style="font-size: 3rem; margin-bottom: 20px;">😢</p>
                <p style="color: var(--error); font-size: 1.2rem; margin-bottom: 10px;">Gagal memuat detail manga</p>
                <p style="color: var(--text-muted);">${error.message || 'Unknown error'}</p>
                <button onclick="elements.detailModal.classList.remove('active')" 
                        style="margin-top: 20px; padding: 10px 24px; background: var(--accent); border: none; border-radius: 8px; color: white; cursor: pointer;">
                    Tutup
                </button>
            </div>
        `;
    }
}

async function openChapterReader(href, index) {
    currentChapterIndex = index;
    const slug = href.startsWith('/') ? href.substring(1) : href;

    elements.detailModal.classList.remove('active');
    elements.readerModal.classList.add('active');
    elements.chapterTitle.textContent = currentChapters[index]?.chapter_title || `Chapter ${index + 1}`;
    elements.readerContent.innerHTML = '<div class="loading-skeleton" style="height: 600px;"></div>';

    updateChapterNav();

    try {
        const data = await getChapterImages(slug);
        const images = data.data?.images || data.images || data.data || [];
        renderChapterImages(images);
    } catch (error) {
        elements.readerContent.innerHTML = '<p style="color: var(--error); text-align: center; padding: 40px;">Gagal memuat chapter</p>';
    }
}

function updateChapterNav() {
    elements.prevChapter.disabled = currentChapterIndex <= 0;
    elements.nextChapter.disabled = currentChapterIndex >= currentChapters.length - 1;
}

async function loadHealth() {
    try {
        const data = await getHealth();
        const stats = data.data;
        if (stats?.cache?.performance?.hitRate) {
            elements.cacheHitRate.textContent = stats.cache.performance.hitRate;
        }
    } catch (error) {
        console.log('Health check failed');
    }
}

// ===== UI Functions =====
function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = `toast show ${type}`;

    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    elements.themeToggle.textContent = newTheme === 'light' ? '🌙' : '☀️';
    localStorage.setItem('theme', newTheme);
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    elements.themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
}

// ===== Event Listeners =====
function initEventListeners() {
    // Search
    elements.searchBtn.addEventListener('click', () => {
        performSearch(elements.searchInput.value);
    });

    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch(elements.searchInput.value);
        }
    });

    elements.clearSearch.addEventListener('click', () => {
        elements.searchResults.classList.add('hidden');
        elements.searchInput.value = '';
    });

    // Provider change
    elements.providerSelect.addEventListener('change', (e) => {
        currentProvider = e.target.value;
        showToast(`Provider: ${currentProvider}`, 'success');
        loadLatest(1);
        loadPopular();
    });

    // Refresh
    elements.refreshLatest.addEventListener('click', () => {
        loadLatest(currentPage, true);
        showToast('Refreshing...', 'info');
    });

    // Theme
    elements.themeToggle.addEventListener('click', toggleTheme);

    // Modals
    elements.closeModal.addEventListener('click', () => {
        elements.detailModal.classList.remove('active');
    });

    elements.closeReader.addEventListener('click', () => {
        elements.readerModal.classList.remove('active');
        elements.detailModal.classList.add('active');
    });

    // Chapter navigation
    elements.prevChapter.addEventListener('click', () => {
        if (currentChapterIndex > 0) {
            const prevCh = currentChapters[currentChapterIndex - 1];
            openChapterReader(prevCh.href || prevCh.chapter_endpoint, currentChapterIndex - 1);
        }
    });

    elements.nextChapter.addEventListener('click', () => {
        if (currentChapterIndex < currentChapters.length - 1) {
            const nextCh = currentChapters[currentChapterIndex + 1];
            openChapterReader(nextCh.href || nextCh.chapter_endpoint, currentChapterIndex + 1);
        }
    });

    // Close modal on backdrop click
    elements.detailModal.addEventListener('click', (e) => {
        if (e.target === elements.detailModal) {
            elements.detailModal.classList.remove('active');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            elements.detailModal.classList.remove('active');
            elements.readerModal.classList.remove('active');
        }
    });
}

// ===== Initialize =====
function init() {
    loadSavedTheme();
    initEventListeners();
    loadLatest(1);
    loadPopular();
    loadHealth();

    // Refresh health every 30s
    setInterval(loadHealth, 30000);
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
