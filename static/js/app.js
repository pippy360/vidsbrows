/**
 * VidsBrows - Client Application Logic
 * Plain JavaScript handling API communication, video library rendering,
 * search filtering, category filtering, and modal video playback.
 */

// Application State
const state = {
  videos: [],
  filteredVideos: [],
  selectedFilter: 'all',
  searchQuery: '',
  hasLocalVideos: false,
};

// DOM Elements
const elements = {
  videoGrid: document.getElementById('video-grid'),
  emptyState: document.getElementById('empty-state'),
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  filterChips: document.getElementById('filter-chips'),
  statsText: document.getElementById('stats-text'),
  sourceBadge: document.getElementById('source-badge'),
  refreshBtn: document.getElementById('refresh-btn'),
  resetFilterBtn: document.getElementById('reset-filter-btn'),
  infoBanner: document.getElementById('info-banner'),
  closeBannerBtn: document.getElementById('close-banner'),
  
  // Modal Elements
  modal: document.getElementById('video-modal'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalTitle: document.getElementById('modal-video-title'),
  modalTag: document.getElementById('modal-video-tag'),
  modalPlayer: document.getElementById('main-video-player'),
  modalDesc: document.getElementById('modal-video-desc'),
  modalFile: document.getElementById('modal-video-file'),
  modalSize: document.getElementById('modal-video-size'),
};

/**
 * Fetch video collection from backend Python API
 */
async function loadVideos() {
  elements.statsText.textContent = 'Scanning video library...';
  try {
    const response = await fetch('/api/videos');
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    const data = await response.json();
    state.videos = data.videos || [];
    state.hasLocalVideos = data.has_local_videos;

    // Update Source Badge
    if (state.hasLocalVideos) {
      elements.sourceBadge.textContent = `${state.videos.length} Local File${state.videos.length === 1 ? '' : 's'}`;
      elements.sourceBadge.style.borderColor = 'rgba(52, 211, 153, 0.4)';
      elements.sourceBadge.style.color = '#6ee7b7';
      elements.infoBanner.hidden = true;
    } else {
      elements.sourceBadge.textContent = 'Demo Mode';
      elements.sourceBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      elements.sourceBadge.style.color = '#fcd34d';
      elements.infoBanner.hidden = false;
    }

    buildFilterChips();
    applyFilters();
  } catch (error) {
    console.error('Failed to load videos:', error);
    elements.statsText.textContent = 'Failed to connect to backend server.';
    elements.videoGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #f87171;">
        <h3>Unable to load videos</h3>
        <p style="margin-top: 8px; color: #94a3b8;">Ensure <code>python3 server.py</code> is running.</p>
      </div>
    `;
  }
}

/**
 * Generate category / tag filter buttons
 */
function buildFilterChips() {
  const tags = new Set();
  state.videos.forEach(v => {
    if (v.tag) tags.add(v.tag);
  });

  const chips = ['all', ...Array.from(tags)];
  elements.filterChips.innerHTML = chips.map(tag => {
    const label = tag === 'all' ? 'All Videos' : tag;
    const activeClass = state.selectedFilter === tag ? 'active' : '';
    return `<button class="chip ${activeClass}" data-filter="${escapeHtml(tag)}">${escapeHtml(label)}</button>`;
  }).join('');

  // Attach click listeners to chips
  elements.filterChips.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      state.selectedFilter = btn.dataset.filter;
      applyFilters();
    });
  });
}

/**
 * Filter videos according to active search query and selected tag
 */
function applyFilters() {
  const q = state.searchQuery.trim().toLowerCase();
  const filter = state.selectedFilter;

  state.filteredVideos = state.videos.filter(video => {
    const matchesTag = (filter === 'all') || (video.tag && video.tag.toLowerCase() === filter.toLowerCase());
    if (!matchesTag) return false;

    if (!q) return true;

    const title = (video.title || '').toLowerCase();
    const filename = (video.filename || '').toLowerCase();
    const tag = (video.tag || '').toLowerCase();
    const category = (video.category || '').toLowerCase();
    const desc = (video.description || '').toLowerCase();

    return title.includes(q) || filename.includes(q) || tag.includes(q) || category.includes(q) || desc.includes(q);
  });

  renderVideos();
}

/**
 * Render filtered video cards into grid
 */
function renderVideos() {
  const count = state.filteredVideos.length;
  elements.statsText.textContent = `${count} video${count === 1 ? '' : 's'} available`;

  if (count === 0) {
    elements.videoGrid.innerHTML = '';
    elements.emptyState.hidden = false;
    return;
  }

  elements.emptyState.hidden = true;
  elements.videoGrid.innerHTML = state.filteredVideos.map(video => {
    const thumbnailHtml = video.thumbnail
      ? `<img src="${escapeHtml(video.thumbnail)}" alt="${escapeHtml(video.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'placeholder-bg\\'><span>📼</span></div>'" />`
      : `<div class="placeholder-bg"><span>🎞️</span></div>`;

    const sizeText = video.size ? `<span>💾 ${escapeHtml(video.size)}</span>` : '';
    const durationBadge = video.duration ? `<span class="duration-badge">${escapeHtml(video.duration)}</span>` : '';
    const categoryText = video.category || (video.is_sample ? 'Demo' : 'Local');

    return `
      <article class="video-card" data-video-id="${escapeHtml(video.id)}">
        <div class="card-thumbnail">
          ${thumbnailHtml}
          ${durationBadge}
          <div class="play-overlay">
            <div class="play-circle">▶</div>
          </div>
        </div>
        <div class="card-body">
          <h4 class="card-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h4>
          <p class="card-desc">${escapeHtml(video.description || video.filename || '')}</p>
          <div class="card-meta">
            <span class="tag-pill">${escapeHtml(video.tag || 'VIDEO')}</span>
            <div style="display: flex; gap: 8px;">
              ${sizeText}
              <span>📁 ${escapeHtml(categoryText)}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Add click listeners to cards
  elements.videoGrid.querySelectorAll('.video-card').forEach(card => {
    card.addEventListener('click', () => {
      const videoId = card.dataset.videoId;
      const video = state.videos.find(v => v.id === videoId);
      if (video) openVideoModal(video);
    });
  });
}

/**
 * Open Video Player Modal
 */
function openVideoModal(video) {
  elements.modalTitle.textContent = video.title;
  elements.modalTag.textContent = video.tag || 'VIDEO';
  elements.modalDesc.textContent = video.description || '';
  elements.modalFile.textContent = video.filename ? `File: ${video.filename}` : '';
  elements.modalSize.textContent = video.size ? `Size: ${video.size}` : '';

  elements.modalPlayer.src = video.url;
  elements.modal.hidden = false;
  elements.modalPlayer.play().catch(e => {
    console.log('Autoplay prevented by browser:', e);
  });
}

/**
 * Close Video Player Modal
 */
function closeVideoModal() {
  elements.modal.hidden = true;
  elements.modalPlayer.pause();
  elements.modalPlayer.removeAttribute('src');
  elements.modalPlayer.load();
}

/**
 * Utility HTML escaping
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

// Event Listeners
elements.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  elements.clearSearch.hidden = !state.searchQuery;
  applyFilters();
});

elements.clearSearch.addEventListener('click', () => {
  elements.searchInput.value = '';
  state.searchQuery = '';
  elements.clearSearch.hidden = true;
  elements.searchInput.focus();
  applyFilters();
});

elements.refreshBtn.addEventListener('click', () => {
  loadVideos();
});

elements.resetFilterBtn.addEventListener('click', () => {
  elements.searchInput.value = '';
  state.searchQuery = '';
  state.selectedFilter = 'all';
  elements.clearSearch.hidden = true;
  buildFilterChips();
  applyFilters();
});

elements.closeBannerBtn.addEventListener('click', () => {
  elements.infoBanner.hidden = true;
});

elements.modalCloseBtn.addEventListener('click', closeVideoModal);

elements.modal.addEventListener('click', (e) => {
  if (e.target === elements.modal) {
    closeVideoModal();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !elements.modal.hidden) {
    closeVideoModal();
  }
});

// Initial boot
window.addEventListener('DOMContentLoaded', () => {
  loadVideos();
});
