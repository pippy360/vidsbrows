/**
 * VidsBrows - Client Application
 * 100% Offline Local Media Gallery with Infinite Scrolling,
 * Live Background Scanner Monitoring, Hierarchical Folder Browsing,
 * and Unified Media Lightbox.
 */

// Application State
const state = {
  items: [],
  totalCount: 0,
  offset: 0,
  limit: 60,
  hasMore: true,
  isLoading: false,
  filterType: 'all',         // 'all' | 'video' | 'image' | 'folders'
  currentFolder: '',         // '' = root/all
  breadcrumbs: [],
  subfolders: [],
  allFolders: [],
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
  countFolders: document.getElementById('count-folders'),
  folderSelect: document.getElementById('folder-select'),
  sortSelect: document.getElementById('sort-select'),
  sizeBtns: document.querySelectorAll('.size-btn'),

  // Breadcrumb Navigation
  breadcrumbContainer: document.getElementById('breadcrumb-container'),
  breadcrumbUpBtn: document.getElementById('breadcrumb-up-btn'),
  breadcrumbTrail: document.getElementById('breadcrumb-trail'),
  breadcrumbClearBtn: document.getElementById('breadcrumb-clear-btn'),

  // Subfolders Section
  foldersSection: document.getElementById('folders-section'),
  subfoldersCountBadge: document.getElementById('subfolders-count-badge'),
  foldersGrid: document.getElementById('folders-grid'),

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
  fetchFolders(state.currentFolder);
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
      fetchFolders(state.currentFolder);
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

      // When clicking folders tab, fetch subfolders for current folder
      if (state.filterType === 'folders') {
        fetchFolders(state.currentFolder);
      }
      resetAndFetch();
    });
  });

  // Subfolder dropdown select
  el.folderSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    navigateToFolder(val === 'all' ? '' : val);
  });

  // Breadcrumb Up Button
  el.breadcrumbUpBtn.addEventListener('click', () => {
    if (state.breadcrumbs.length > 1) {
      const parentCrumb = state.breadcrumbs[state.breadcrumbs.length - 2];
      navigateToFolder(parentCrumb.path);
    } else {
      navigateToFolder('');
    }
  });

  // Breadcrumb Clear Button
  el.breadcrumbClearBtn.addEventListener('click', () => {
    navigateToFolder('');
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
    state.currentFolder = '';
    state.searchQuery = '';
    state.sort = 'date_desc';

    el.searchInput.value = '';
    el.clearSearchBtn.hidden = true;
    el.sortSelect.value = 'date_desc';
    el.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));

    navigateToFolder('');
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
 * Navigate into a folder path
 */
function navigateToFolder(folderPath) {
  state.currentFolder = folderPath || '';
  el.folderSelect.value = state.currentFolder ? state.currentFolder : 'all';
  fetchFolders(state.currentFolder);
  resetAndFetch();
}

/**
 * Setup IntersectionObserver for smooth infinite scroll
 */
function setupInfiniteScroll() {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !state.isLoading && state.hasMore && state.filterType !== 'folders') {
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

  if (state.filterType === 'folders') {
    // In folders mode, media items are hidden or minimal, subfolders are prominent
    el.mediaGrid.hidden = true;
    el.scrollSentinel.hidden = true;
    el.itemsSummaryText.textContent = state.subfolders.length === 0 
      ? 'No subfolders in this folder' 
      : `Showing ${state.subfolders.length} subfolder${state.subfolders.length === 1 ? '' : 's'}`;
  } else {
    el.mediaGrid.hidden = false;
    el.scrollSentinel.hidden = false;
    fetchNextBatch();
  }
}

/**
 * Fetch next paginated batch of media items from server
 */
async function fetchNextBatch() {
  if (state.isLoading || !state.hasMore || state.filterType === 'folders') return;

  state.isLoading = true;
  el.loadingSpinner.hidden = false;

  const params = new URLSearchParams({
    type: state.filterType,
    sort: state.sort,
    limit: state.limit,
    offset: state.offset,
    recursive: '1',
  });

  if (state.currentFolder) {
    params.set('folder', state.currentFolder);
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
          <span class="card-folder" data-folder="${escapeHtml(item.parent_dir)}" title="Browse folder: ${escapeHtml(item.parent_dir)}">📁 ${escapeHtml(item.parent_dir)}</span>
          <span>${escapeHtml(item.date_formatted)}</span>
        </div>
      </div>
    `;

    // Click on thumbnail/card opens lightbox
    card.querySelector('.card-media-box').addEventListener('click', () => {
      openLightbox(globalIndex);
    });
    card.querySelector('.card-title').addEventListener('click', () => {
      openLightbox(globalIndex);
    });

    // Click on folder tag navigates into that folder
    const folderTag = card.querySelector('.card-folder');
    if (folderTag) {
      folderTag.addEventListener('click', (e) => {
        e.stopPropagation();
        const fPath = folderTag.dataset.folder;
        if (fPath && fPath !== 'Root') {
          navigateToFolder(fPath);
        }
      });
    }

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
  const folderPrefix = state.currentFolder ? `in "${state.currentFolder}": ` : '';
  if (total === 0) {
    el.itemsSummaryText.textContent = `${folderPrefix}No matching items`;
  } else {
    el.itemsSummaryText.textContent = `${folderPrefix}Showing ${loaded} of ${total.toLocaleString()} item${total === 1 ? '' : 's'}`;
  }
}

/**
 * Fetch and Render Folders & Breadcrumbs
 */
async function fetchFolders(folderPath = '') {
  try {
    const res = await fetch(`/api/folders?folder=${encodeURIComponent(folderPath || '')}`);
    if (!res.ok) return;
    const data = await res.json();

    state.breadcrumbs = data.breadcrumbs || [];
    state.subfolders = data.subfolders || [];
    state.allFolders = data.all_folders || [];

    // Update count in tab
    if (el.countFolders) {
      el.countFolders.textContent = state.allFolders.length.toLocaleString();
    }

    // Render breadcrumbs
    renderBreadcrumbs();

    // Render subfolders grid
    renderSubfolders();

    // Populate dropdown
    renderFolderDropdown();
  } catch (err) {
    console.error('Failed to load folders:', err);
  }
}

/**
 * Render Breadcrumbs Navigation Bar
 */
function renderBreadcrumbs() {
  const isInsideFolder = Boolean(state.currentFolder);
  const isFoldersTab = state.filterType === 'folders';

  if (!isInsideFolder && !isFoldersTab) {
    el.breadcrumbContainer.hidden = true;
    return;
  }

  el.breadcrumbContainer.hidden = false;

  // Up button state
  el.breadcrumbUpBtn.style.visibility = (state.breadcrumbs.length > 1) ? 'visible' : 'hidden';

  // Render trail items
  let trailHtml = '';
  state.breadcrumbs.forEach((crumb, idx) => {
    const isLast = idx === state.breadcrumbs.length - 1;
    const activeClass = isLast ? 'active' : '';
    const icon = idx === 0 ? '🏠' : '📁';

    if (idx > 0) {
      trailHtml += `<span class="breadcrumb-separator">/</span>`;
    }

    trailHtml += `
      <span class="breadcrumb-item ${activeClass}" data-path="${escapeHtml(crumb.path)}">
        ${icon} ${escapeHtml(crumb.name)}
      </span>
    `;
  });

  el.breadcrumbTrail.innerHTML = trailHtml;

  // Attach click listeners to crumbs
  el.breadcrumbTrail.querySelectorAll('.breadcrumb-item:not(.active)').forEach(item => {
    item.addEventListener('click', () => {
      navigateToFolder(item.dataset.path);
    });
  });
}

/**
 * Render Subfolder Cards
 */
function renderSubfolders() {
  const showSection = (state.filterType === 'folders') || (state.currentFolder && state.subfolders.length > 0);

  if (!showSection || state.subfolders.length === 0) {
    el.foldersSection.hidden = true;
    return;
  }

  el.foldersSection.hidden = false;
  el.subfoldersCountBadge.textContent = `${state.subfolders.length} folder${state.subfolders.length === 1 ? '' : 's'}`;

  el.foldersGrid.innerHTML = state.subfolders.map(f => {
    const previewImg = f.preview_id 
      ? `<img src="/api/thumbnail?id=${f.preview_id}" loading="lazy" alt="${escapeHtml(f.name)}" onerror="this.style.display='none'" />` 
      : '';

    return `
      <article class="folder-card" data-path="${escapeHtml(f.path)}">
        <div class="folder-preview-box">
          ${previewImg}
          <div class="folder-icon-large">📁</div>
          <span class="folder-card-badge">${f.total_items} items</span>
        </div>
        <div class="folder-card-body">
          <div class="folder-card-info">
            <h4 class="folder-card-title">${escapeHtml(f.name)}</h4>
            <span class="folder-card-meta">${f.videos_count} videos • ${f.images_count} photos</span>
          </div>
          <span class="folder-chevron">➔</span>
        </div>
      </article>
    `;
  }).join('');

  // Add click listeners to folder cards
  el.foldersGrid.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', () => {
      navigateToFolder(card.dataset.path);
    });
  });
}

/**
 * Populate Subfolder Dropdown Select
 */
function renderFolderDropdown() {
  const currentVal = state.currentFolder || 'all';
  let html = '<option value="all">📁 All Folders (Entire Library)</option>';

  state.allFolders.forEach(f => {
    const label = f.folder === 'Root' ? '📁 [Root Directory]' : `📁 ${f.folder}`;
    html += `<option value="${escapeHtml(f.path)}">${escapeHtml(label)} (${f.count})</option>`;
  });

  el.folderSelect.innerHTML = html;

  // Restore selection
  if (el.folderSelect.querySelector(`option[value="${CSS.escape(currentVal)}"]`)) {
    el.folderSelect.value = currentVal;
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
  } else if (state.hasMore && !state.isLoading && state.filterType !== 'folders') {
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
