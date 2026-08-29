/**
 * VidsBrows - Client Application
 * 100% Offline Local Media Gallery with Infinite Scrolling,
 * Live Background Scanner Monitoring, and Unified Media Lightbox.
 */

// Application State
const state = {
  items: [],
  totalCount: 0,
  offset: 0,
  limit: 60,
  hasMore: true,
  isLoading: false,
  filterType: 'all',
  filterFolder: 'all',
  searchQuery: '',
  sort: 'date_desc',
  gridSize: 'normal',
  modalIndex: -1,
  scanStatus: 'idle',
  pollTimer: null,
};

// DOM Elements
const el = {
  folderBadge: document.getElementById('folder-name-badge'),
  scanPill: document.getElementById('scan-status-pill'),
  statusDot: document.getElementById('status-indicator-dot'),
  statusText: document.getElementById('status-text'),
  miniProgress: document.getElementById('mini-progress-bar'),
  miniProgressFill: document.getElementById('mini-progress-fill'),
  searchInput: document.getElementById('search-input'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  rescanBtn: document.getElementById('rescan-btn'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  countAll: document.getElementById('count-all'),
  countVideos: document.getElementById('count-videos'),
  countImages: document.getElementById('count-images'),
  folderSelect: document.getElementById('folder-select'),
  sortSelect: document.getElementById('sort-select'),
  sizeBtns: document.querySelectorAll('.size-btn'),
  itemsSummaryText: document.getElementById('items-summary-text'),
  scanFeedbackText: document.getElementById('scan-feedback-text'),
  mediaGrid: document.getElementById('media-grid'),
  scrollSentinel: document.getElementById('scroll-sentinel'),
  loadingSpinner: document.getElementById('loading-spinner'),
  endOfResults: document.getElementById('end-of-results'),
  emptyState: document.getElementById('empty-state'),
  emptyResetBtn: document.getElementById('empty-reset-btn'),

  // Lightbox Modal
  modal: document.getElementById('media-modal'),
  modalBackdrop: document.getElementById('modal-backdrop'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalTypeBadge: document.getElementById('modal-type-badge'),
  modalCounterBadge: document.getElementById('modal-counter-badge'),
  modalFilename: document.getElementById('modal-filename'),
  modalDownloadBtn: document.getElementById('modal-download-btn'),
  modalPrevBtn: document.getElementById('modal-prev-btn'),
  modalNextBtn: document.getElementById('modal-next-btn'),
  videoViewerBox: document.getElementById('video-viewer-box'),
  videoPlayer: document.getElementById('active-video-player'),
  imageViewerBox: document.getElementById('image-viewer-box'),
  imageViewer: document.getElementById('active-image-viewer'),
  modalFolderTag: document.getElementById('modal-folder-tag'),
  modalSizeTag: document.getElementById('modal-size-tag'),
  modalDateTag: document.getElementById('modal-date-tag'),
};

/**
 * Initialize Application
 */
function init() {
  setupEventListeners();
  setupInfiniteScroll();
  fetchScanStatus();
  fetchFolders();
  resetAndFetch();

  // Start polling scan status
  startScanStatusPolling();
}

/**
 * Set up user interface event listeners
 */
function setupEventListeners() {
  // Search input debounced
  let debounceTimeout = null;
  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    el.clearSearchBtn.hidden = !state.searchQuery;
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      resetAndFetch();
    }, 300);
  });

  el.clearSearchBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    state.searchQuery = '';
    el.clearSearchBtn.hidden = true;
    resetAndFetch();
    el.searchInput.focus();
  });

  // Rescan button
  el.rescanBtn.addEventListener('click', async () => {
    el.rescanBtn.disabled = true;
    try {
      await fetch('/api/rescan', { method: 'POST' });
      fetchScanStatus();
    } catch (err) {
      console.error('Failed to trigger rescan:', err);
    } finally {
      setTimeout(() => { el.rescanBtn.disabled = false; }, 1500);
    }
  });

  // Media type filter tabs
  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterType = btn.dataset.type;
      resetAndFetch();
    });
  });

  // Subfolder select
  el.folderSelect.addEventListener('change', (e) => {
    state.filterFolder = e.target.value;
    resetAndFetch();
  });

  // Sort selector
  el.sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    resetAndFetch();
  });

  // Grid Density Switcher
  el.sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.sizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.gridSize = btn.dataset.size;
      if (state.gridSize === 'compact') {
        el.mediaGrid.classList.add('compact');
      } else {
        el.mediaGrid.classList.remove('compact');
      }
    });
  });

  // Reset filters button in empty state
  el.emptyResetBtn.addEventListener('click', () => {
    state.filterType = 'all';
    state.filterFolder = 'all';
    state.searchQuery = '';
    state.sort = 'date_desc';

    el.searchInput.value = '';
    el.clearSearchBtn.hidden = true;
    el.folderSelect.value = 'all';
    el.sortSelect.value = 'date_desc';
    el.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));

    resetAndFetch();
  });

  // Lightbox close listeners
  el.modalCloseBtn.addEventListener('click', closeLightbox);
  el.modalBackdrop.addEventListener('click', closeLightbox);

  // Lightbox navigation
  el.modalPrevBtn.addEventListener('click', showPreviousMedia);
  el.modalNextBtn.addEventListener('click', showNextMedia);

  // Global Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);
}

/**
 * Setup IntersectionObserver for smooth infinite scroll
 */
function setupInfiniteScroll() {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !state.isLoading && state.hasMore) {
      fetchNextBatch();
    }
  }, { rootMargin: '400px' });

  observer.observe(el.scrollSentinel);
}

/**
 * Reset pagination and fetch fresh items
 */
function resetAndFetch() {
  state.offset = 0;
  state.items = [];
  state.hasMore = true;
  el.mediaGrid.innerHTML = '';
  el.emptyState.hidden = true;
  el.endOfResults.hidden = true;
  fetchNextBatch();
}

/**
 * Fetch next paginated batch of media items from server
 */
async function fetchNextBatch() {
  if (state.isLoading || !state.hasMore) return;

  state.isLoading = true;
  el.loadingSpinner.hidden = false;

  const params = new URLSearchParams({
    type: state.filterType,
    sort: state.sort,
    limit: state.limit,
    offset: state.offset,
  });

  if (state.filterFolder !== 'all') {
    params.set('folder', state.filterFolder);
  }
  if (state.searchQuery) {
    params.set('q', state.searchQuery);
  }

  try {
    const res = await fetch(`/api/media?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const newItems = data.items || [];
    state.totalCount = data.total_count;
    state.hasMore = data.has_more;
    state.offset += newItems.length;

    // Append to in-memory items
    const startIndex = state.items.length;
    state.items.push(...newItems);

    renderBatch(newItems, startIndex);
    updateSummaryText();

    if (!state.hasMore && state.items.length > 0) {
      el.endOfResults.hidden = false;
    }
  } catch (err) {
    console.error('Failed to fetch media batch:', err);
    el.itemsSummaryText.textContent = 'Failed to load media from server.';
  } finally {
    state.isLoading = false;
    el.loadingSpinner.hidden = true;
  }
}

/**
 * Render batch of media cards to the DOM
 */
function renderBatch(items, startIndex) {
  if (state.items.length === 0) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();

  items.forEach((item, i) => {
    const globalIndex = startIndex + i;
    const card = document.createElement('article');
    card.className = 'media-card';
    card.dataset.index = globalIndex;

    const isVideo = item.media_type === 'video';
    const typeLabel = isVideo ? 'VIDEO' : 'PHOTO';
    const typeBadgeClass = isVideo ? 'video' : 'image';
    const overlayIcon = isVideo ? '▶' : '🔍';

    card.innerHTML = `
      <div class="card-media-box">
        <span class="card-type-badge ${typeBadgeClass}">${typeLabel}</span>
        <span class="card-size-badge">${escapeHtml(item.size_formatted)}</span>
        
        <img 
          src="${escapeHtml(item.thumb_url)}" 
          alt="${escapeHtml(item.filename)}" 
          loading="lazy"
          onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'400\\' height=\\'225\\' fill=\\'%23151a26\\'><rect width=\\'100%\\' height=\\'100%\\'/><text x=\\'50%\\' y=\\'55%\\' font-size=\\'36\\' fill=\\'%23475569\\' text-anchor=\\'middle\\'>${isVideo ? '🎬' : '📷'}</text></svg>';"
        />

        <div class="card-overlay">
          <div class="overlay-circle">${overlayIcon}</div>
        </div>
      </div>

      <div class="card-details">
        <h4 class="card-title" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</h4>
        <div class="card-subtext">
          <span class="card-folder" title="${escapeHtml(item.parent_dir)}">📁 ${escapeHtml(item.parent_dir)}</span>
          <span>${escapeHtml(item.date_formatted)}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      openLightbox(globalIndex);
    });

    fragment.appendChild(card);
  });

  el.mediaGrid.appendChild(fragment);
}

/**
 * Update summary text in sub-nav
 */
function updateSummaryText() {
  const loaded = state.items.length;
  const total = state.totalCount;
  if (total === 0) {
    el.itemsSummaryText.textContent = 'No matching items';
  } else {
    el.itemsSummaryText.textContent = `Showing ${loaded} of ${total.toLocaleString()} item${total === 1 ? '' : 's'}`;
  }
}

/**
 * Poll `/api/scan_status` for live background discovery and thumbnail generation
 */
async function fetchScanStatus() {
  try {
    const res = await fetch('/api/scan_status');
    if (!res.ok) return;
    const data = await res.json();

    state.scanStatus = data.status;

    // Folder badge
    el.folderBadge.textContent = data.target_name || 'Library';
    el.folderBadge.title = data.target_dir;

    // Counts
    el.countAll.textContent = (data.total_media || 0).toLocaleString();
    el.countVideos.textContent = (data.videos_count || 0).toLocaleString();
    el.countImages.textContent = (data.images_count || 0).toLocaleString();

    // Scan Indicator
    if (data.status === 'scanning') {
      el.statusDot.classList.add('scanning');
      const folderHint = data.current_folder ? ` (${data.current_folder})` : '';
      el.statusText.textContent = `Scanning... ${data.total_media.toLocaleString()} found${folderHint}`;
      el.scanFeedbackText.textContent = `⚡ Background indexer active`;
      el.miniProgress.hidden = true;
    } else {
      el.statusDot.classList.remove('scanning');
      el.scanFeedbackText.textContent = '';

      // Check thumbnail generation progress
      const total = data.total_media || 0;
      const done = data.thumbs_done || 0;
      const pending = data.thumbs_pending || 0;

      if (pending > 0 && total > 0) {
        const pct = Math.round((done / total) * 100);
        el.statusText.textContent = `Generating thumbnails (${done}/${total} • ${pct}%)`;
        el.miniProgress.hidden = false;
        el.miniProgressFill.style.width = `${pct}%`;
      } else {
        el.statusText.textContent = `${total.toLocaleString()} items ready`;
        el.miniProgress.hidden = true;
      }
    }
  } catch (err) {
    el.statusText.textContent = 'Offline';
  }
}

function startScanStatusPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    fetchScanStatus();
  }, 2000);
}

/**
 * Fetch subfolders list for dropdown
 */
async function fetchFolders() {
  try {
    const res = await fetch('/api/folders');
    if (!res.ok) return;
    const data = await res.json();
    const folders = data.folders || [];

    const currentVal = el.folderSelect.value;
    let html = '<option value="all">📁 All Folders</option>';
    folders.forEach(f => {
      html += `<option value="${escapeHtml(f.folder)}">📁 ${escapeHtml(f.folder)} (${f.count})</option>`;
    });
    el.folderSelect.innerHTML = html;

    // Restore selected value if still present
    if (currentVal && el.folderSelect.querySelector(`option[value="${CSS.escape(currentVal)}"]`)) {
      el.folderSelect.value = currentVal;
    }
  } catch (err) {
    console.error('Failed to load folders list:', err);
  }
}

/**
 * Open Unified Lightbox Modal
 */
function openLightbox(index) {
  if (index < 0 || index >= state.items.length) return;
  state.modalIndex = index;
  const item = state.items[index];

  // Update header info
  const isVideo = item.media_type === 'video';
  el.modalTypeBadge.textContent = isVideo ? 'VIDEO' : 'PHOTO';
  el.modalTypeBadge.style.backgroundColor = isVideo ? 'var(--badge-video)' : 'var(--badge-image)';
  el.modalCounterBadge.textContent = `${index + 1} / ${state.totalCount}`;
  el.modalFilename.textContent = item.filename;
  el.modalFilename.title = item.filename;

  // Update download link
  el.modalDownloadBtn.href = item.media_url;
  el.modalDownloadBtn.download = item.filename;

  // Update footer info
  el.modalFolderTag.textContent = `📁 ${item.parent_dir}`;
  el.modalSizeTag.textContent = `💾 ${item.size_formatted}`;
  el.modalDateTag.textContent = `📅 ${item.date_formatted}`;

  // Update viewer box
  if (isVideo) {
    el.imageViewerBox.hidden = true;
    el.imageViewer.src = '';

    el.videoViewerBox.hidden = false;
    el.videoPlayer.src = item.media_url;
    el.videoPlayer.play().catch(() => {});
  } else {
    el.videoViewerBox.hidden = true;
    el.videoPlayer.pause();
    el.videoPlayer.removeAttribute('src');
    el.videoPlayer.load();

    el.imageViewerBox.hidden = false;
    el.imageViewer.src = item.media_url;
  }

  // Prev / Next button states
  el.modalPrevBtn.style.visibility = index > 0 ? 'visible' : 'hidden';
  el.modalNextBtn.style.visibility = (index < state.totalCount - 1) ? 'visible' : 'hidden';

  el.modal.hidden = false;
}

/**
 * Close Lightbox Modal
 */
function closeLightbox() {
  el.modal.hidden = true;
  el.videoPlayer.pause();
  el.videoPlayer.removeAttribute('src');
  el.videoPlayer.load();
  el.imageViewer.src = '';
  state.modalIndex = -1;
}

/**
 * Lightbox Previous Item
 */
function showPreviousMedia() {
  if (state.modalIndex > 0) {
    openLightbox(state.modalIndex - 1);
  }
}

/**
 * Lightbox Next Item
 */
function showNextMedia() {
  if (state.modalIndex < state.items.length - 1) {
    openLightbox(state.modalIndex + 1);
  } else if (state.hasMore && !state.isLoading) {
    // If at end of loaded buffer, load next batch and advance
    fetchNextBatch().then(() => {
      if (state.modalIndex < state.items.length - 1) {
        openLightbox(state.modalIndex + 1);
      }
    });
  }
}

/**
 * Keyboard Navigation
 */
function handleKeyDown(e) {
  // If typing in search box, let normal typing occur unless Escape
  if (document.activeElement === el.searchInput) {
    if (e.key === 'Escape') {
      el.searchInput.blur();
    }
    return;
  }

  if (el.modal.hidden) return;

  switch (e.key) {
    case 'Escape':
      closeLightbox();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      showPreviousMedia();
      break;
    case 'ArrowRight':
      e.preventDefault();
      showNextMedia();
      break;
    case ' ':
      // Space bar toggles play/pause for video
      if (!el.videoViewerBox.hidden) {
        e.preventDefault();
        if (el.videoPlayer.paused) {
          el.videoPlayer.play();
        } else {
          el.videoPlayer.pause();
        }
      }
      break;
    case 'f':
    case 'F':
      // Toggle fullscreen on video player
      if (!el.videoViewerBox.hidden && el.videoPlayer.requestFullscreen) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          el.videoPlayer.requestFullscreen();
        }
      }
      break;
  }
}

/**
 * Utility: HTML escape string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start on DOMContentLoaded
window.addEventListener('DOMContentLoaded', init);
