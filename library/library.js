/**
 * Ascend Library
 * Local-first asset browser with tagging
 */

(function() {
  'use strict';

  // =========================================
  // LIBRARY API CLIENT
  // =========================================

  const LibraryAPI = {
    // Will be set from Config
    baseUrl: null,

    // JSONP callback counter
    _callbackId: 0,

    /**
     * Make a JSONP request to the API
     */
    _jsonp(action, params = {}) {
      return new Promise((resolve, reject) => {
        if (!this.baseUrl) {
          reject(new Error('Library API URL not configured'));
          return;
        }

        const callbackName = `__libraryApiCallback_${++this._callbackId}`;
        const timeout = setTimeout(() => {
          delete window[callbackName];
          script.remove();
          reject(new Error('API request timed out'));
        }, 30000);

        window[callbackName] = (response) => {
          clearTimeout(timeout);
          delete window[callbackName];
          script.remove();

          if (response && response.ok) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'API request failed'));
          }
        };

        const url = new URL(this.baseUrl);
        url.searchParams.set('action', action);
        url.searchParams.set('callback', callbackName);
        url.searchParams.set('_', Date.now()); // Cache buster

        for (const key in params) {
          if (params[key] !== undefined && params[key] !== null) {
            url.searchParams.set(key, params[key]);
          }
        }

        const script = document.createElement('script');
        script.src = url.toString();
        script.onerror = () => {
          clearTimeout(timeout);
          delete window[callbackName];
          script.remove();
          reject(new Error('Failed to load API script'));
        };

        document.head.appendChild(script);
      });
    },

    /**
     * Ping the API to check connectivity
     */
    async ping() {
      return this._jsonp('ping');
    },

    /**
     * Get taxonomy (products, tags, LOBs)
     */
    async listTaxonomy() {
      return this._jsonp('listTaxonomy');
    },

    /**
     * Get all asset metadata
     */
    async listAssetsMeta(includeTrashed = false) {
      return this._jsonp('listAssetsMeta', {
        include_trashed: includeTrashed ? 'true' : 'false'
      });
    },

    /**
     * Get metadata for a single asset
     */
    async getAssetMeta(assetId) {
      return this._jsonp('getAssetMeta', { asset_id: assetId });
    },

    /**
     * Update asset metadata (products, tags, notes, displayName)
     */
    async upsertAssetMeta(assetId, path, products, tags, lob, notes, displayName) {
      const params = {
        asset_id: assetId,
        path: path || '',
        products: Array.isArray(products) ? products.join(',') : (products || ''),
        tags: Array.isArray(tags) ? tags.join(',') : (tags || '')
      };
      if (lob !== undefined) {
        params.lob = lob;
      }
      if (notes !== undefined) {
        params.notes = notes;
      }
      if (displayName !== undefined) {
        params.display_name = displayName;
      }
      return this._jsonp('upsertAssetMeta', params);
    },

    /**
     * Trash an asset (soft delete)
     */
    async trashAsset(assetId, userEmail, path) {
      return this._jsonp('trashAsset', {
        asset_id: assetId,
        user_email: userEmail || '',
        path: path || ''
      });
    },

    /**
     * Restore a trashed asset
     */
    async restoreAsset(assetId) {
      return this._jsonp('restoreAsset', { asset_id: assetId });
    },

    /**
     * List trashed assets
     */
    async listTrashedAssets() {
      return this._jsonp('listTrashedAssets');
    },

    /**
     * Move asset to virtual folder
     */
    async moveAsset(assetId, virtualFolder, path) {
      return this._jsonp('moveAsset', {
        asset_id: assetId,
        virtual_folder: virtualFolder,
        path: path || ''
      });
    },

    /**
     * Batch move assets to virtual folder (POST)
     */
    async batchMoveAssets(assetIds, virtualFolder, pathMap) {
      return this._post('batchMoveAssets', {
        asset_ids: assetIds,
        virtual_folder: virtualFolder,
        path_map: pathMap || {}
      });
    },

    /**
     * Rename a virtual folder
     */
    async renameFolder(oldPath, newPath, source) {
      return this._jsonp('renameFolder', {
        old_path: oldPath,
        new_path: newPath,
        source: source || ''
      });
    },

    /**
     * Delete a virtual folder (trashes all contents)
     */
    async deleteFolder(folderPath, source, userEmail) {
      return this._jsonp('deleteFolder', {
        path: folderPath,
        source: source || '',
        user_email: userEmail || ''
      });
    },

    /**
     * Set or update a folder display name
     */
    async setFolderDisplayName(folderPath, source, displayName) {
      return this._jsonp('setFolderDisplayName', {
        path: folderPath,
        source: source || '',
        display_name: displayName || ''
      });
    },

    /**
     * Get all folder display names
     */
    async listFolderDisplayNames() {
      return this._jsonp('listFolderDisplayNames');
    },

    /**
     * Link assets to a job
     */
    async linkAssetsToJob(assetIds, jobId, jobApp, userEmail) {
      return this._jsonp('linkAssetsToJob', {
        asset_ids: Array.isArray(assetIds) ? assetIds.join(',') : assetIds,
        job_id: jobId,
        job_app: jobApp,
        user_email: userEmail || ''
      });
    },

    /**
     * Unlink assets from a job
     */
    async unlinkAssetsFromJob(assetIds, jobId) {
      return this._jsonp('unlinkAssetsFromJob', {
        asset_ids: Array.isArray(assetIds) ? assetIds.join(',') : assetIds,
        job_id: jobId
      });
    },

    /**
     * List jobs linked to an asset
     */
    async listLinkedJobs(assetId) {
      return this._jsonp('listLinkedJobs', { asset_id: assetId });
    },

    /**
     * List assets linked to a job
     */
    async listJobAssets(jobId) {
      return this._jsonp('listJobAssets', { job_id: jobId });
    }
  };

  // =========================================
  // STATE
  // =========================================

  const State = {
    // UI Mode: 'browse' or 'tags'
    mode: 'browse',

    // Browse mode state
    browse: {
      source: null,       // 'stock', 'publications', 'fileroom', or null
      path: [],           // Current folder path segments
    },

    collection: 'all',
    assets: [],
    filteredAssets: [],
    // Asset metadata: { assetId: { products: [], tags: [], trashed: bool, trashedAt, trashedBy } }
    assetMeta: {},
    // Folder display names: { 'source:path': displayName }
    folderDisplayNames: {},
    // Master lists from API/Sheet
    productList: [],
    tagList: [],
    lobList: [],
    // Product details: { productName: { tags: [], lob: '' } }
    taxonomyMap: {},
    folders: [],
    cart: [],
    activeFilters: {
      products: [],     // Filter by product
      tags: [],         // Filter by tag
      lob: null,        // Filter by LOB (single select)
      fileTypes: [],    // Filter by file extension
      folder: null,
      search: '',
      untaggedOnly: false,
      showTrashed: false  // Show only trashed items
    },
    sort: 'name-asc',
    page: 1,
    currentAsset: null,
    isLoading: false,
    draggedAssetId: null,  // For drag-drop folder management
    lastViewedIndex: -1,   // For returning to position after modal close
    selectedAssets: [],    // For batch operations
    addToJobTarget: null,  // { app: 'ARTSTART', jobId: '12345', fullId: 'ARTSTART:12345' }
    linkedAssetsForJob: [], // Asset IDs already linked to addToJobTarget
    manageJobState: null   // { original: Set, current: Set } for tracking toggle changes
  };

  const Config = window.LIBRARY_CONFIG || {};

  // =========================================
  // ADD TO JOB MODE (bidirectional linking)
  // =========================================

  /**
   * Check for addToJob URL param on page load
   * Format: ?addToJob=ARTSTART:12345
   * Fetches already-linked assets and enables "Manage Job Assets" mode
   */
  function checkAddToJobMode() {
    const params = new URLSearchParams(window.location.search);
    const addToJob = params.get('addToJob');
    if (!addToJob) return;

    // Parse job reference (e.g., "ARTSTART:12345")
    const parts = addToJob.split(':');
    if (parts.length !== 2) return;

    State.addToJobTarget = {
      app: parts[0],    // "ARTSTART", "COPYDESK", "FILEROOM"
      jobId: parts[1],
      fullId: addToJob
    };

    console.log('[Library] Manage Job Assets mode for', State.addToJobTarget.app, '#' + State.addToJobTarget.jobId);

    // Fetch already-linked assets for this job
    fetchLinkedAssetsForJob();
  }

  /**
   * Fetch assets already linked to the target job
   */
  async function fetchLinkedAssetsForJob() {
    if (!State.addToJobTarget) return;

    try {
      const response = await LibraryAPI.listJobAssets(State.addToJobTarget.fullId);
      const assets = (response && response.assets) || [];
      State.linkedAssetsForJob = assets.map(a => a.asset_id);
      console.log('[Library] Found', State.linkedAssetsForJob.length, 'linked assets for job');

      // Re-render grid to show linked borders
      renderGrid();
    } catch (e) {
      console.error('[Library] Failed to fetch linked assets:', e);
      State.linkedAssetsForJob = [];
    }
  }

  /**
   * Check if an asset is linked to the current addToJob target
   */
  function isAssetLinkedToJob(assetId) {
    return State.addToJobTarget && State.linkedAssetsForJob.includes(assetId);
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  async function init() {
    console.log('[Library] Initializing...');
    const startTime = performance.now();

    // Check for addToJob mode (bidirectional linking from ArtStart/etc)
    checkAddToJobMode();

    // Configure API URL
    if (Config.libraryApiUrl) {
      LibraryAPI.baseUrl = Config.libraryApiUrl;
      console.log('[Library] API configured:', Config.libraryApiUrl);
    } else {
      console.warn('[Library] No API URL configured, using localStorage fallback');
    }

    // Load saved state from localStorage (cart only now)
    loadLocalState();

    // Check admin status and hide admin UI if not admin
    checkAdminAccess();

    // FAST: Load cached asset metadata from localStorage (instant)
    loadCachedAssetMeta();

    // Bind event listeners
    bindEvents();
    initTrashModal();

    // Load manifest (required for asset list)
    await loadManifest();

    // Build initial view using cached data (fast!)
    buildProductList();
    buildLobList();
    buildTagCloud();
    buildFileTypeList();
    updateSourceCounts();

    // Set initial mode (renders the grid)
    setMode('browse');

    updateCartCount();
    updateTrashCount();

    const loadTime = Math.round(performance.now() - startTime);
    console.log(`[Library] Ready. Assets: ${State.assets.length}, Load time: ${loadTime}ms`);

    // Load fresh API data in background (non-blocking) and refresh UI when done
    loadTaxonomyAndMeta().then(() => {
      buildProductList();
      buildLobList();
      buildTagCloud();
      if (State.mode === 'browse') renderBrowseView();
      else { applyFilters(); renderGrid(); }
      console.log('[Library] UI refreshed with API data');
    });

    // Auto-detect products from filenames/folders AFTER initial render (non-blocking)
    requestIdleCallback ? requestIdleCallback(() => autoTagAssets()) : setTimeout(autoTagAssets, 100);
  }

  /**
   * Load cached asset metadata from localStorage for instant startup
   */
  function loadCachedAssetMeta() {
    const cachedMeta = localStorage.getItem('library-asset-meta');
    if (cachedMeta) {
      try {
        State.assetMeta = JSON.parse(cachedMeta);
        console.log('[Library] Loaded cached asset meta:', Object.keys(State.assetMeta).length, 'assets');
      } catch (e) {
        console.warn('[Library] Could not parse cached meta:', e);
      }
    }
  }

  // =========================================
  // MODE SWITCHING
  // =========================================

  function setMode(mode) {
    State.mode = mode;

    // Update toggle buttons
    document.querySelectorAll('.library-mode-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });

    // Show/hide sidebar modes
    const browseMode = document.getElementById('sidebar-browse-mode');
    const tagsMode = document.getElementById('sidebar-tags-mode');
    if (browseMode) browseMode.style.display = mode === 'browse' ? 'block' : 'none';
    if (tagsMode) tagsMode.style.display = mode === 'tags' ? 'block' : 'none';

    // Show/hide toolbar elements
    const breadcrumbs = document.getElementById('library-breadcrumbs');
    const activeFilters = document.getElementById('library-active-filters');
    if (breadcrumbs) breadcrumbs.style.display = mode === 'browse' ? 'flex' : 'none';
    if (activeFilters) activeFilters.style.display = mode === 'tags' ? 'flex' : 'none';

    // Show/hide folder grid
    const folderGrid = document.getElementById('library-folder-grid');
    if (folderGrid) folderGrid.style.display = mode === 'browse' ? 'grid' : 'none';

    // Reset and render
    if (mode === 'browse') {
      // If no source selected, show welcome state
      if (!State.browse.source) {
        renderBrowseWelcome();
      } else {
        renderBrowseView();
      }
    } else {
      // Tags mode - apply filters and render
      applyFilters();
      renderGrid();
      renderActiveFilters();
    }
  }

  function selectSource(source) {
    State.browse.source = source;
    State.browse.path = [];

    // Update source buttons
    document.querySelectorAll('.library-source').forEach(el => {
      el.classList.toggle('is-active', el.dataset.source === source);
    });

    renderBrowseView();
  }

  function navigateToFolder(pathSegments) {
    State.browse.path = pathSegments;
    renderBrowseView();
  }

  function renderBrowseWelcome() {
    const folderGrid = document.getElementById('library-folder-grid');
    const assetGrid = document.getElementById('library-grid');
    const resultCount = document.getElementById('library-result-count');

    if (folderGrid) folderGrid.innerHTML = '';
    if (assetGrid) assetGrid.innerHTML = `
      <div class="library-empty">
        <div class="library-empty-icon">📁</div>
        <div class="library-empty-text">Select a source to browse</div>
        <div class="library-empty-hint">Choose Stock, Publications, or Fileroom from the sidebar</div>
      </div>
    `;
    if (resultCount) resultCount.textContent = '';

    renderBreadcrumbs();
  }

  function renderBrowseView() {
    const source = State.browse.source;
    const path = State.browse.path;

    if (!source) {
      renderBrowseWelcome();
      return;
    }

    // Build current folder path for filtering
    let folderPrefix = '';
    if (source === 'stock') {
      folderPrefix = path.length > 0 ? path.join('/') : '';
    } else if (source === 'publications') {
      folderPrefix = path.length > 0 ? path.join('/') : '';
    }

    // Get assets in current folder
    const assetsInFolder = State.assets.filter(asset => {
      // Filter by source (collection)
      if (source === 'stock' && asset.collection !== 'stock') return false;
      if (source === 'publications' && asset.collection !== 'publications') return false;
      if (source === 'fileroom') return false; // TODO: Fileroom assets

      // Filter by folder path (use virtual folder if set)
      const assetFolder = getEffectiveFolder(asset);

      if (folderPrefix === '') {
        // Root level - show assets with no subfolder or first-level items
        const parts = assetFolder.split('/').filter(p => p);
        return parts.length === 0;
      } else {
        // Exact folder match
        return assetFolder === folderPrefix;
      }
    });

    // Get subfolders at current level
    const subfolders = getSubfoldersAt(source, path);

    // Render breadcrumbs
    renderBreadcrumbs();

    // Render folder tiles
    renderFolderTiles(subfolders);

    // Render assets
    State.filteredAssets = sortAssets(
      assetsInFolder.filter(a => !isAssetTrashed(a.id)),
      State.sort
    );
    renderGrid();

    // Update count
    const resultCount = document.getElementById('library-result-count');
    if (resultCount) {
      const folderCount = subfolders.length;
      const assetCount = State.filteredAssets.length;
      const parts = [];
      if (folderCount > 0) parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
      if (assetCount > 0) parts.push(`${assetCount} file${assetCount !== 1 ? 's' : ''}`);
      resultCount.textContent = parts.join(', ') || 'Empty folder';
    }
  }

  function getSubfoldersAt(source, pathSegments) {
    const prefix = pathSegments.join('/');
    const prefixWithSlash = prefix ? prefix + '/' : '';
    const depth = pathSegments.length;

    const subfolderSet = new Set();

    // 1. Find folders from assets
    State.assets.forEach(asset => {
      // Skip trashed assets
      if (isAssetTrashed(asset.id)) return;

      // Filter by source
      if (source === 'stock' && asset.collection !== 'stock') return;
      if (source === 'publications' && asset.collection !== 'publications') return;

      const folder = getEffectiveFolder(asset);
      if (!folder) return;

      // Check if this asset is under the current path
      if (prefix && !folder.startsWith(prefixWithSlash) && folder !== prefix) return;
      if (!prefix && folder.indexOf('/') === -1) {
        // Root level - this IS a top-level folder
        subfolderSet.add(folder);
        return;
      }
      if (!prefix) {
        // Root level - get first segment
        const firstSeg = folder.split('/')[0];
        if (firstSeg) subfolderSet.add(firstSeg);
        return;
      }

      // Get next segment after prefix
      const remainder = folder.slice(prefixWithSlash.length);
      const nextSeg = remainder.split('/')[0];
      if (nextSeg) {
        subfolderSet.add(nextSeg);
      }
    });

    // 2. Also include empty folders from folderDisplayNames registry
    Object.keys(State.folderDisplayNames).forEach(key => {
      // Keys are formatted as 'source:path' - split only on first colon
      const colonIdx = key.indexOf(':');
      if (colonIdx === -1) return;
      const folderSource = key.slice(0, colonIdx);
      const folderPath = key.slice(colonIdx + 1);
      if (folderSource !== source || !folderPath) return;

      // Check if this folder is a direct child of current path
      if (prefix) {
        // Must start with prefix/ and have exactly one more segment
        if (!folderPath.startsWith(prefixWithSlash)) return;
        const remainder = folderPath.slice(prefixWithSlash.length);
        const segments = remainder.split('/').filter(s => s);
        if (segments.length === 1) {
          subfolderSet.add(segments[0]);
        }
      } else {
        // Root level - get first segment only if it's a single segment path
        const segments = folderPath.split('/').filter(s => s);
        if (segments.length >= 1) {
          subfolderSet.add(segments[0]);
        }
      }
    });

    // Convert to array with metadata
    return Array.from(subfolderSet).sort().map(name => {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      const count = countAssetsInFolder(source, fullPath);
      const previews = getPreviewsForFolder(source, fullPath, 4);
      return { name, fullPath, count, previews };
    });
  }

  function countAssetsInFolder(source, folderPath) {
    return State.assets.filter(asset => {
      if (isAssetTrashed(asset.id)) return false;
      if (source === 'stock' && asset.collection !== 'stock') return false;
      if (source === 'publications' && asset.collection !== 'publications') return false;

      const folder = getEffectiveFolder(asset);
      return folder === folderPath || folder.startsWith(folderPath + '/');
    }).length;
  }

  function getPreviewsForFolder(source, folderPath, count) {
    const assets = State.assets.filter(asset => {
      if (isAssetTrashed(asset.id)) return false;
      if (source === 'stock' && asset.collection !== 'stock') return false;
      if (source === 'publications' && asset.collection !== 'publications') return false;

      const folder = getEffectiveFolder(asset);
      return folder === folderPath || folder.startsWith(folderPath + '/');
    });

    // Get first N assets with thumbnails - include ext for transparency detection
    return assets.slice(0, count).map(a => ({
      url: getThumbUrl(a),
      ext: (a.ext || '').toLowerCase()
    }));
  }

  function renderBreadcrumbs() {
    const container = document.getElementById('library-breadcrumbs');
    if (!container) return;

    const source = State.browse.source;
    const path = State.browse.path;

    let html = `<span class="library-breadcrumb is-root" data-path="">Library</span>`;

    if (source) {
      const sourceName = source.charAt(0).toUpperCase() + source.slice(1);
      html += `<span class="library-breadcrumb-sep">›</span>`;
      html += `<span class="library-breadcrumb${path.length === 0 ? ' is-current' : ''}" data-source="${source}" data-path="">${sourceName}</span>`;

      path.forEach((segment, idx) => {
        const isLast = idx === path.length - 1;
        const pathToHere = path.slice(0, idx + 1).join('/');
        const displayName = getFolderDisplayName(source, pathToHere);
        html += `<span class="library-breadcrumb-sep">›</span>`;
        html += `<span class="library-breadcrumb${isLast ? ' is-current' : ''}" data-source="${source}" data-path="${pathToHere}">${escapeHtml(displayName)}</span>`;
      });
    }

    container.innerHTML = html;
  }

  function renderFolderTiles(folders) {
    const container = document.getElementById('library-folder-grid');
    if (!container) return;

    const source = State.browse.source;
    const basePath = State.browse.path.join('/');

    // New Folder tile (always first, Material Design pattern)
    const newFolderTile = `
      <div class="library-folder-tile is-new-folder" data-action="new-folder">
        <div class="library-folder-tile-preview">
          <div class="new-folder-icon">+</div>
        </div>
        <div class="library-folder-tile-info">
          <div class="library-folder-tile-name">New Folder</div>
        </div>
      </div>
    `;

    if (folders.length === 0) {
      container.innerHTML = newFolderTile;
      return;
    }

    const TRANSPARENT_TYPES = new Set(['svg', 'eps', 'png']);

    container.innerHTML = newFolderTile + folders.map(folder => {
      // Filter to only valid previews
      const validPreviews = folder.previews.filter(p => p && p.url);
      const count = validPreviews.length;

      // Helper to generate img tag with transparency class if needed
      const makeImg = (preview) => {
        const hasTransparency = TRANSPARENT_TYPES.has(preview.ext);
        return `<img src="${preview.url}" alt="" loading="lazy" class="${hasTransparency ? 'has-transparency' : ''}">`;
      };

      // Dynamic layout class based on image count
      let layoutClass = 'layout-empty';
      let previewHtml = '';

      if (count === 0) {
        layoutClass = 'layout-empty';
        previewHtml = '<div class="empty-slot"></div>';
      } else if (count === 1) {
        layoutClass = 'layout-single';
        previewHtml = makeImg(validPreviews[0]);
      } else if (count === 2) {
        layoutClass = 'layout-duo';
        previewHtml = validPreviews.slice(0, 2).map(makeImg).join('');
      } else if (count === 3) {
        layoutClass = 'layout-trio';
        previewHtml = validPreviews.slice(0, 3).map(makeImg).join('');
      } else {
        layoutClass = 'layout-quad';
        previewHtml = validPreviews.slice(0, 4).map(makeImg).join('');
      }

      // Get full folder path and display name
      const fullPath = basePath ? `${basePath}/${folder.name}` : folder.name;
      const displayName = getFolderDisplayName(source, fullPath);

      return `
        <div class="library-folder-tile" data-folder="${escapeHtml(folder.name)}" data-full-path="${escapeHtml(fullPath)}">
          <div class="library-folder-tile-preview ${layoutClass}">
            ${previewHtml}
          </div>
          <div class="library-folder-tile-info">
            <div class="library-folder-tile-name">${escapeHtml(displayName)}</div>
            <div class="library-folder-tile-count">${folder.count} items</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderActiveFilters() {
    const container = document.getElementById('library-active-filter-pills');
    const wrapper = document.getElementById('library-active-filters');
    if (!container) return;

    const pills = [];

    State.activeFilters.products.forEach(p => {
      pills.push(`<span class="library-filter-pill" data-type="product" data-value="${escapeHtml(p)}">${escapeHtml(p)}<button class="library-filter-pill-remove">×</button></span>`);
    });

    if (State.activeFilters.lob) {
      pills.push(`<span class="library-filter-pill" data-type="lob" data-value="${escapeHtml(State.activeFilters.lob)}">${escapeHtml(State.activeFilters.lob)}<button class="library-filter-pill-remove">×</button></span>`);
    }

    State.activeFilters.tags.forEach(t => {
      pills.push(`<span class="library-filter-pill" data-type="tag" data-value="${escapeHtml(t)}">${escapeHtml(t)}<button class="library-filter-pill-remove">×</button></span>`);
    });

    State.activeFilters.fileTypes.forEach(ft => {
      pills.push(`<span class="library-filter-pill" data-type="filetype" data-value="${escapeHtml(ft)}">${escapeHtml(ft.toUpperCase())}<button class="library-filter-pill-remove">×</button></span>`);
    });

    // Show/hide the wrapper based on whether there are active filters
    if (wrapper) {
      wrapper.style.display = pills.length > 0 ? 'flex' : 'none';
    }

    if (pills.length === 0) {
      container.innerHTML = '';
    } else {
      container.innerHTML = pills.join('') + '<button class="library-clear-all-filters">Clear all</button>';
    }
  }

  function updateSourceCounts() {
    const stockCount = State.assets.filter(a => a.collection === 'stock').length;
    const pubsCount = State.assets.filter(a => a.collection === 'publications').length;

    const stockEl = document.getElementById('stock-count');
    const pubsEl = document.getElementById('publications-count');

    if (stockEl) stockEl.textContent = stockCount;
    if (pubsEl) pubsEl.textContent = pubsCount;
  }

  function loadLocalState() {
    try {
      const savedCart = localStorage.getItem('library-cart');
      if (savedCart) {
        State.cart = JSON.parse(savedCart);
      }
      // assetMeta is loaded in loadTaxonomyAndMeta()
    } catch (e) {
      console.warn('[Library] Could not load local state:', e);
    }
  }

  function saveCartToLocal() {
    try {
      localStorage.setItem('library-cart', JSON.stringify(State.cart));
    } catch (e) {
      console.warn('[Library] Could not save cart:', e);
    }
  }

  /**
   * Save asset metadata to API (or localStorage fallback)
   */
  async function saveAssetMeta(assetId) {
    const meta = State.assetMeta[assetId];
    if (!meta) return;

    // Find the asset to get its path
    const asset = State.assets.find(a => a.id === assetId);
    const path = asset?.path || '';

    console.log('[Library] Saving asset meta:', assetId, {
      products: meta.products,
      tags: meta.tags,
      lob: meta.lob,
      notes: meta.notes ? `${meta.notes.slice(0, 50)}...` : '',
      displayName: meta.displayName
    });

    // Try API first
    if (LibraryAPI.baseUrl) {
      try {
        const result = await LibraryAPI.upsertAssetMeta(assetId, path, meta.products, meta.tags, meta.lob, meta.notes, meta.displayName);
        console.log('[Library] Saved asset meta to API:', assetId, result);
        showToast('Saved', 'success');
        return;
      } catch (e) {
        console.error('[Library] API save failed:', e.message, e);
        showToast('Save failed: ' + e.message, 'error');
      }
    } else {
      console.warn('[Library] No API URL configured');
    }

    // Fallback to localStorage
    try {
      localStorage.setItem('library-asset-meta', JSON.stringify(State.assetMeta));
      console.log('[Library] Saved to localStorage');
    } catch (e) {
      console.warn('[Library] Could not save to localStorage:', e);
    }
  }

  // Legacy function for backwards compatibility
  function saveLocalState() {
    saveCartToLocal();
    // Note: Asset meta is now saved per-asset via saveAssetMeta()
    // For bulk operations, we still cache to localStorage
    try {
      localStorage.setItem('library-asset-meta', JSON.stringify(State.assetMeta));
    } catch (e) {
      console.warn('[Library] Could not save local state:', e);
    }
  }

  // =========================================
  // DATA LOADING
  // =========================================

  async function loadManifest() {
    State.isLoading = true;
    showLoading();

    try {
      const response = await fetch(Config.manifestUrl || 'library-manifest.json');
      if (!response.ok) {
        throw new Error('Manifest not found. Run the scan script first.');
      }

      const data = await response.json();
      State.assets = data.assets || [];
      State.folders = data.folders || [];

      console.log('[Library] Loaded manifest:', State.assets.length, 'assets');
    } catch (e) {
      console.error('[Library] Failed to load manifest:', e);
      showError('Could not load library manifest. Make sure library-manifest.json exists.');
    }

    State.isLoading = false;
  }

  async function loadTaxonomyAndMeta() {
    // FAST PATH: Load cached data from localStorage first for instant UI
    // Load fresh data from API (cached data already loaded in init)
    if (LibraryAPI.baseUrl) {
      try {
        // Load all API data in PARALLEL for faster startup
        const [taxonomy, metaResult, folderResult] = await Promise.all([
          LibraryAPI.listTaxonomy().catch(e => { console.warn('[Library] Taxonomy load failed:', e.message); return null; }),
          LibraryAPI.listAssetsMeta(true).catch(e => { console.warn('[Library] Asset meta load failed:', e.message); return null; }),
          LibraryAPI.listFolderDisplayNames().catch(e => { console.warn('[Library] Folder names load failed:', e.message); return null; })
        ]);

        // Process taxonomy
        if (taxonomy) {
          State.productList = taxonomy.products?.map(p => p.name) || [];
          State.tagList = taxonomy.tags || [];
          State.lobList = taxonomy.lobs || [];
          State.taxonomyMap = {};
          (taxonomy.products || []).forEach(p => {
            State.taxonomyMap[p.name] = { tags: p.tags, lob: p.lob };
          });
          console.log('[Library] Loaded taxonomy from API:', State.productList.length, 'products');
        }

        // Process asset metadata - MERGE with existing cache, don't replace
        if (metaResult && metaResult.assets) {
          const cachedCount = Object.keys(State.assetMeta).length;

          // Merge API data into existing state (API data takes priority for conflicts)
          metaResult.assets.forEach(a => {
            State.assetMeta[a.asset_id] = {
              products: a.products || [],
              tags: a.tags || [],
              lob: a.lob || '',
              notes: a.notes || '',
              displayName: a.display_name || '',
              virtualFolder: a.virtual_folder || null,
              trashed: !!a.trashed_at,
              trashedAt: a.trashed_at || '',
              trashedBy: a.trashed_by || ''
            };
          });

          const finalCount = Object.keys(State.assetMeta).length;
          console.log(`[Library] Merged API metadata: ${metaResult.count} from API, ${cachedCount} cached → ${finalCount} total`);

          // Cache merged data to localStorage
          try {
            localStorage.setItem('library-asset-meta', JSON.stringify(State.assetMeta));
          } catch (e) {
            console.warn('[Library] Could not cache to localStorage:', e);
          }
        }

        // Process folder display names
        if (folderResult && folderResult.folders) {
          State.folderDisplayNames = {};
          folderResult.folders.forEach(f => {
            const key = `${f.source}:${f.path}`;
            State.folderDisplayNames[key] = f.display_name;
          });
          console.log('[Library] Loaded folder display names:', folderResult.count);
        }

        return; // API loaded successfully
      } catch (e) {
        console.warn('[Library] API load failed, falling back to local:', e.message);
      }
    }

    // Fallback: Load from Google Sheet CSV (taxonomy only)
    if (Config.taxonomySheetId) {
      try {
        const url = `https://docs.google.com/spreadsheets/d/${Config.taxonomySheetId}/export?format=csv&gid=${Config.taxonomyGid || 0}`;
        const response = await fetch(url);
        if (response.ok) {
          const csv = await response.text();
          parseTaxonomyCSV(csv);
          console.log('[Library] Loaded taxonomy from Google Sheet CSV');
        }
      } catch (e) {
        console.log('[Library] Could not fetch taxonomy sheet:', e);
      }
    }

    // Fallback: Load asset assignments from static file
    try {
      const response = await fetch(Config.assetMetaUrl || 'library-assets.json');
      if (response.ok) {
        const data = await response.json();
        State.assetMeta = data.assets || {};
        console.log('[Library] Loaded asset metadata from static file');
      }
    } catch (e) {
      console.log('[Library] No static asset metadata found');
    }

    // Fallback: Merge with localStorage
    const localMeta = localStorage.getItem('library-asset-meta');
    if (localMeta) {
      try {
        const parsed = JSON.parse(localMeta);
        State.assetMeta = { ...State.assetMeta, ...parsed };
        console.log('[Library] Merged localStorage metadata');
      } catch (e) {
        console.warn('[Library] Could not parse localStorage meta:', e);
      }
    }

    // Load folder display names (even in fallback mode, try the API)
    if (Config.libraryApiUrl) {
      try {
        const folderResult = await LibraryAPI.listFolderDisplayNames();
        console.log('[Library] Folder display names raw response:', folderResult);
        if (folderResult && folderResult.folders) {
          State.folderDisplayNames = {};
          folderResult.folders.forEach(f => {
            const key = `${f.source}:${f.path}`;
            State.folderDisplayNames[key] = f.display_name;
            console.log('[Library] Loaded folder display name:', key, '=', f.display_name);
          });
          console.log('[Library] Loaded folder display names:', folderResult.count, State.folderDisplayNames);
        }
      } catch (e) {
        console.warn('[Library] Could not load folder display names:', e.message);
      }
    }
  }

  function parseTaxonomyCSV(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return;

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    // Support both 'name' and 'products' as the product column header
    let nameIdx = header.indexOf('name');
    if (nameIdx === -1) nameIdx = header.indexOf('products');
    const tagsIdx = header.indexOf('tags');
    const lobIdx = header.indexOf('lob');

    if (nameIdx === -1) return;

    const products = [];
    const tags = new Set();
    const lobs = new Set();

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const name = cols[nameIdx]?.trim();
      const tagList = tagsIdx >= 0 ? cols[tagsIdx]?.trim() : '';
      const lob = lobIdx >= 0 ? cols[lobIdx]?.trim() : '';

      if (name) products.push(name);
      if (tagList) {
        tagList.split(',').forEach(t => {
          const tag = t.trim();
          if (tag) tags.add(tag);
        });
      }
      if (lob) lobs.add(lob);
    }

    State.productList = products;
    State.tagList = [...tags].sort();
    State.lobList = [...lobs].sort();
  }

  function parseCSVLine(line) {
    // Simple CSV parser (handles basic quoting)
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  // =========================================
  // AUTO-TAGGING FROM FILENAMES
  // =========================================

  function autoTagAssets() {
    // Build matchers for products
    // Convert "Encore HD" to pattern matching "Encore_HD", "Encore-HD", "EncoreHD", etc.
    const productMatchers = State.productList.map(product => {
      const parts = product.split(/[\s\-_]+/);
      const pattern = parts.map(p => escapeRegex(p)).join('[\\s\\-_]?');
      return {
        value: product,
        regex: new RegExp(pattern, 'i')
      };
    });

    // Build matchers for tags (require word boundaries for short tags)
    const tagMatchers = State.tagList.map(tag => {
      const parts = tag.split(/[\s\-_]+/);
      const pattern = parts.map(p => escapeRegex(p)).join('[\\s\\-_]?');
      // Use word boundaries for short tags to avoid false matches
      const needsBoundary = tag.length <= 4;
      const fullPattern = needsBoundary ? `\\b${pattern}\\b` : pattern;
      return {
        value: tag,
        regex: new RegExp(fullPattern, 'i')
      };
    });

    let autoTaggedProducts = 0;
    let autoTaggedTags = 0;

    State.assets.forEach(asset => {
      const meta = State.assetMeta[asset.id] || { products: [], tags: [] };
      const hadProducts = meta.products.length > 0;
      const hadTags = meta.tags.length > 0;

      // Text to search: filename + folder path
      const searchText = `${asset.name || ''} ${asset.folder || ''} ${asset.path || ''}`;

      // Auto-detect products (only if none assigned)
      if (!hadProducts && productMatchers.length > 0) {
        const detectedProducts = [];
        productMatchers.forEach(({ value, regex }) => {
          if (regex.test(searchText)) {
            detectedProducts.push(value);
          }
        });

        if (detectedProducts.length > 0) {
          if (!State.assetMeta[asset.id]) {
            State.assetMeta[asset.id] = { products: [], tags: [] };
          }
          State.assetMeta[asset.id].products = detectedProducts;
          autoTaggedProducts++;
        }
      }

      // Auto-detect tags (only if none assigned)
      if (!hadTags && tagMatchers.length > 0) {
        const detectedTags = [];
        tagMatchers.forEach(({ value, regex }) => {
          if (regex.test(searchText)) {
            detectedTags.push(value);
          }
        });

        if (detectedTags.length > 0) {
          if (!State.assetMeta[asset.id]) {
            State.assetMeta[asset.id] = { products: [], tags: [] };
          }
          State.assetMeta[asset.id].tags = detectedTags;
          autoTaggedTags++;
        }
      }
    });

    if (autoTaggedProducts > 0 || autoTaggedTags > 0) {
      console.log(`[Library] Auto-tagged: ${autoTaggedProducts} products, ${autoTaggedTags} tags`);
      saveLocalState();
    }
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // =========================================
  // FILTERING & SORTING
  // =========================================

  function applyFilters() {
    let assets = [...State.assets];

    // Trash filter - show trashed OR hide trashed
    if (State.activeFilters.showTrashed) {
      assets = assets.filter(a => isAssetTrashed(a.id));
    } else {
      assets = assets.filter(a => !isAssetTrashed(a.id));
    }

    // Collection filter
    if (State.collection !== 'all') {
      assets = assets.filter(a => a.collection === State.collection);
    }

    // Product filter
    if (State.activeFilters.products.length > 0) {
      assets = assets.filter(a => {
        const meta = State.assetMeta[a.id] || { products: [], tags: [] };
        return State.activeFilters.products.every(p => meta.products.includes(p));
      });
    }

    // Tag filter
    if (State.activeFilters.tags.length > 0) {
      assets = assets.filter(a => {
        const meta = State.assetMeta[a.id] || { products: [], tags: [] };
        return State.activeFilters.tags.every(t => meta.tags.includes(t));
      });
    }

    // LOB filter
    if (State.activeFilters.lob) {
      assets = assets.filter(a => {
        const meta = State.assetMeta[a.id] || { lob: '' };
        return meta.lob === State.activeFilters.lob;
      });
    }

    // File type filter
    if (State.activeFilters.fileTypes.length > 0) {
      assets = assets.filter(a => {
        const ext = (a.ext || '').toLowerCase();
        return State.activeFilters.fileTypes.includes(ext);
      });
    }

    // Folder filter
    if (State.activeFilters.folder) {
      assets = assets.filter(a =>
        a.folder === State.activeFilters.folder ||
        a.folder.startsWith(State.activeFilters.folder + '/')
      );
    }

    // Search filter
    if (State.activeFilters.search) {
      const query = State.activeFilters.search.toLowerCase();
      assets = assets.filter(a => {
        const name = (a.name || '').toLowerCase();
        const folder = (a.folder || '').toLowerCase();
        const meta = State.assetMeta[a.id] || { products: [], tags: [] };
        const products = meta.products.join(' ').toLowerCase();
        const tags = meta.tags.join(' ').toLowerCase();
        return name.includes(query) || folder.includes(query) || products.includes(query) || tags.includes(query);
      });
    }

    // Untagged only (no products assigned)
    if (State.activeFilters.untaggedOnly) {
      assets = assets.filter(a => {
        const meta = State.assetMeta[a.id] || { products: [], tags: [] };
        return meta.products.length === 0;
      });
    }

    // Sorting
    assets = sortAssets(assets, State.sort);

    State.filteredAssets = assets;
    State.page = 1;

    updateResultCount();
  }

  function sortAssets(assets, sortKey) {
    const sorted = [...assets];

    switch (sortKey) {
      case 'name-asc':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'name-desc':
        sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        break;
      case 'date-desc':
        sorted.sort((a, b) => (b.modified || 0) - (a.modified || 0));
        break;
      case 'date-asc':
        sorted.sort((a, b) => (a.modified || 0) - (b.modified || 0));
        break;
      case 'folder':
        sorted.sort((a, b) => (a.folder || '').localeCompare(b.folder || ''));
        break;
    }

    return sorted;
  }

  // =========================================
  // =========================================
  // PRODUCT & TAG MANAGEMENT
  // =========================================

  function buildProductList() {
    const container = document.getElementById('library-product-list');
    if (!container) return;

    // Count products in use
    const productCounts = {};
    for (const assetId in State.assetMeta) {
      const products = State.assetMeta[assetId]?.products || [];
      products.forEach(p => {
        productCounts[p] = (productCounts[p] || 0) + 1;
      });
    }

    if (State.productList.length === 0) {
      container.innerHTML = '<div class="library-empty-hint">No products defined</div>';
      return;
    }

    container.innerHTML = State.productList.map(product => {
      const count = productCounts[product] || 0;
      const isActive = State.activeFilters.products.includes(product);
      return `
        <button type="button"
                class="library-product ${isActive ? 'is-active' : ''}"
                data-product="${escapeHtml(product)}">
          ${escapeHtml(product)}
          ${count > 0 ? `<span class="library-product-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  function buildLobList() {
    const container = document.getElementById('library-lob-list');
    if (!container) return;

    // Count LOBs in use
    const lobCounts = {};
    for (const assetId in State.assetMeta) {
      const lob = State.assetMeta[assetId]?.lob;
      if (lob) {
        lobCounts[lob] = (lobCounts[lob] || 0) + 1;
      }
    }

    if (State.lobList.length === 0) {
      container.innerHTML = '<div class="library-empty-hint">No LOBs defined</div>';
      return;
    }

    container.innerHTML = State.lobList.map(lob => {
      const count = lobCounts[lob] || 0;
      const isActive = State.activeFilters.lob === lob;
      return `
        <button type="button"
                class="library-product ${isActive ? 'is-active' : ''}"
                data-lob="${escapeHtml(lob)}">
          ${escapeHtml(lob)}
          ${count > 0 ? `<span class="library-product-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  function buildTagCloud() {
    const container = document.getElementById('library-tag-cloud');
    if (!container) return;

    // Count tags in use
    const tagCounts = {};
    for (const assetId in State.assetMeta) {
      const tags = State.assetMeta[assetId]?.tags || [];
      tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }

    // Combine sheet tags with any used tags
    const allTags = new Set([...State.tagList]);
    Object.keys(tagCounts).forEach(t => allTags.add(t));

    if (allTags.size === 0) {
      container.innerHTML = '<div class="library-empty-hint">No tags yet</div>';
      return;
    }

    const sortedTags = [...allTags].sort();

    container.innerHTML = sortedTags.map(tag => {
      const count = tagCounts[tag] || 0;
      const isActive = State.activeFilters.tags.includes(tag);
      return `
        <button type="button"
                class="library-tag ${isActive ? 'is-active' : ''}"
                data-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
          ${count > 0 ? `<span class="library-tag-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  function buildFileTypeList() {
    const container = document.getElementById('library-filetype-list');
    if (!container) return;

    // Count file types
    const typeCounts = {};
    State.assets.forEach(asset => {
      const ext = (asset.ext || '').toLowerCase();
      if (ext) {
        typeCounts[ext] = (typeCounts[ext] || 0) + 1;
      }
    });

    // Sort by count descending, then alphabetically
    const sortedTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (sortedTypes.length === 0) {
      container.innerHTML = '<div class="library-empty-hint">No files</div>';
      return;
    }

    container.innerHTML = sortedTypes.map(([ext, count]) => {
      const isActive = State.activeFilters.fileTypes.includes(ext);
      return `
        <button type="button"
                class="library-filetype ${isActive ? 'is-active' : ''}"
                data-filetype="${escapeHtml(ext)}">
          ${escapeHtml(ext.toUpperCase())}
          <span class="library-filetype-count">${count}</span>
        </button>
      `;
    }).join('');
  }

  function getAssetMeta(assetId) {
    if (!State.assetMeta[assetId]) {
      State.assetMeta[assetId] = { products: [], tags: [], lob: '', notes: '', virtualFolder: null, displayName: '' };
    }
    return State.assetMeta[assetId];
  }

  function setLobForAsset(assetId, lob) {
    const meta = getAssetMeta(assetId);
    meta.lob = lob || '';
    saveAssetMeta(assetId); // async, fire and forget
    return true;
  }

  /**
   * Get effective folder for an asset.
   * Returns virtualFolder from metadata if set, otherwise the original folder from manifest.
   */
  function getEffectiveFolder(asset) {
    const meta = State.assetMeta[asset.id];
    if (meta && meta.virtualFolder !== null && meta.virtualFolder !== undefined) {
      return meta.virtualFolder;
    }
    return asset.folder || '';
  }

  /**
   * Get display name for a folder (or the folder name itself if no display name set)
   */
  function getFolderDisplayName(source, folderPath) {
    const key = `${source}:${folderPath}`;
    return State.folderDisplayNames[key] || folderPath.split('/').pop() || folderPath;
  }

  /**
   * Move asset to a virtual folder
   */
  async function moveAssetToFolder(assetId, virtualFolder) {
    const meta = getAssetMeta(assetId);
    meta.virtualFolder = virtualFolder;

    // Find asset to get its path
    const asset = State.assets.find(a => a.id === assetId);
    const path = asset ? asset.path : '';

    try {
      await LibraryAPI.moveAsset(assetId, virtualFolder, path);
      console.log('[Library] Moved asset', assetId, 'to', virtualFolder);
    } catch (e) {
      console.warn('[Library] Move failed:', e.message);
    }
  }

  /**
   * Batch move assets to a virtual folder
   */
  async function batchMoveAssetsToFolder(assetIds, virtualFolder) {
    const pathMap = {};

    assetIds.forEach(id => {
      const meta = getAssetMeta(id);
      meta.virtualFolder = virtualFolder;

      const asset = State.assets.find(a => a.id === id);
      if (asset) pathMap[id] = asset.path;
    });

    try {
      await LibraryAPI.batchMoveAssets(assetIds, virtualFolder, pathMap);
      console.log('[Library] Batch moved', assetIds.length, 'assets to', virtualFolder);
    } catch (e) {
      console.warn('[Library] Batch move failed:', e.message);
    }
  }

  function addProductToAsset(assetId, product) {
    const meta = getAssetMeta(assetId);
    if (meta.products.includes(product)) return false;

    meta.products.push(product);
    saveAssetMeta(assetId); // async, fire and forget
    buildProductList();
    return true;
  }

  function removeProductFromAsset(assetId, product) {
    const meta = getAssetMeta(assetId);
    const idx = meta.products.indexOf(product);
    if (idx === -1) return false;

    meta.products.splice(idx, 1);
    saveAssetMeta(assetId); // async, fire and forget
    buildProductList();
    return true;
  }

  function addTagToAsset(assetId, tag) {
    tag = normalizeTag(tag);
    if (!tag) return false;

    const meta = getAssetMeta(assetId);
    if (meta.tags.includes(tag)) return false;

    meta.tags.push(tag);

    // Add new tag to master list if not already there (so it appears in tag picker)
    if (!State.tagList.includes(tag)) {
      State.tagList.push(tag);
      State.tagList.sort();
    }

    saveAssetMeta(assetId); // async, fire and forget
    buildTagCloud();
    return true;
  }

  function removeTagFromAsset(assetId, tag) {
    const meta = getAssetMeta(assetId);
    const idx = meta.tags.indexOf(tag);
    if (idx === -1) return false;

    meta.tags.splice(idx, 1);
    saveAssetMeta(assetId); // async, fire and forget
    buildTagCloud();
    return true;
  }

  function normalizeTag(tag) {
    return (tag || '')
      .trim()
      .toLowerCase()
      .slice(0, 50);
  }

  function getTagSuggestions(query) {
    const allTags = [...new Set([...State.tagList])];
    if (!query) return allTags.slice(0, 10).map(tag => ({ tag }));

    const q = query.toLowerCase();
    return allTags
      .filter(({ tag }) => tag.includes(q))
      .slice(0, 10);
  }

  // =========================================
  // FOLDER TREE
  // =========================================

  function buildFolderTrees() {
    // Build separate folder trees for each collection
    buildCollectionTree('stock', 'stock-folder-tree');
    buildCollectionTree('publications', 'publications-folder-tree');

    // Update counts in headers
    const stockCount = State.assets.filter(a => a.collection === 'stock').length;
    const pubCount = State.assets.filter(a => a.collection === 'publications').length;

    const stockCountEl = document.getElementById('stock-count');
    const pubCountEl = document.getElementById('publications-count');

    if (stockCountEl) stockCountEl.textContent = stockCount.toLocaleString();
    if (pubCountEl) pubCountEl.textContent = pubCount.toLocaleString();
  }

  function buildCollectionTree(collection, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Get unique top-level folders for this collection
    const folderCounts = {};
    State.assets
      .filter(a => a.collection === collection)
      .forEach(a => {
        if (a.folder) {
          const top = a.folder.split('/')[0];
          folderCounts[top] = (folderCounts[top] || 0) + 1;
        }
      });

    const folders = Object.entries(folderCounts)
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (folders.length === 0) {
      container.innerHTML = '<div class="library-empty-hint">No folders</div>';
      return;
    }

    container.innerHTML = folders.map(([folder, count]) => `
      <button type="button"
              class="library-folder"
              data-folder="${escapeHtml(folder)}"
              data-collection="${collection}">
        <span class="library-folder-icon">📁</span>
        <span>${escapeHtml(folder)}</span>
        <span class="library-folder-count">${count}</span>
      </button>
    `).join('');
  }

  function updateFolderActiveState() {
    document.querySelectorAll('.library-folder').forEach(btn => {
      const isActive = btn.dataset.folder === State.activeFilters.folder &&
                       btn.dataset.collection === State.collection;
      btn.classList.toggle('is-active', isActive);
    });
  }

  // =========================================
  // TRASH
  // =========================================

  async function trashAssetAsync(assetId) {
    const meta = getAssetMeta(assetId);
    const asset = State.assets.find(a => a.id === assetId);
    const path = asset?.path || '';

    // Update local state immediately
    meta.trashed = true;
    meta.trashedAt = new Date().toISOString();
    updateTrashCount();

    // Try API
    if (LibraryAPI.baseUrl) {
      try {
        // Get user email if available
        const userEmail = Config.userEmail || '';
        await LibraryAPI.trashAsset(assetId, userEmail, path);
        console.log('[Library] Trashed asset via API:', assetId);
        return true;
      } catch (e) {
        console.warn('[Library] API trash failed:', e.message);
      }
    }

    // Fallback to localStorage
    saveLocalState();
    return true;
  }

  async function restoreAssetAsync(assetId) {
    const meta = getAssetMeta(assetId);

    // Update local state immediately
    meta.trashed = false;
    meta.trashedAt = '';
    meta.trashedBy = '';
    updateTrashCount();

    // Try API
    if (LibraryAPI.baseUrl) {
      try {
        await LibraryAPI.restoreAsset(assetId);
        console.log('[Library] Restored asset via API:', assetId);
        return true;
      } catch (e) {
        console.warn('[Library] API restore failed:', e.message);
      }
    }

    // Fallback to localStorage
    saveLocalState();
    return true;
  }

  // Sync wrappers for backwards compatibility
  function trashAsset(assetId) {
    trashAssetAsync(assetId);
    return true;
  }

  function restoreAsset(assetId) {
    restoreAssetAsync(assetId);
    return true;
  }

  function isAssetTrashed(assetId) {
    const meta = State.assetMeta[assetId];
    return meta?.trashed === true;
  }

  function updateTrashCount() {
    const count = Object.values(State.assetMeta).filter(m => m.trashed).length;
    // Update sidebar checkbox count
    const el = document.getElementById('library-trash-count');
    if (el) {
      el.textContent = count > 0 ? count : '';
    }
    // Update trigger button count
    const triggerCount = document.getElementById('library-trash-trigger-count');
    if (triggerCount) {
      triggerCount.textContent = count > 0 ? String(count) : '';
    }
  }

  function updateModalTrashButton(assetId) {
    const btn = document.getElementById('library-modal-trash-btn');
    if (!btn) return;

    const isTrashed = isAssetTrashed(assetId);
    btn.classList.toggle('is-trashed', isTrashed);
    btn.textContent = isTrashed ? 'Restore from Trash' : 'Move to Trash';
  }

  // =========================================
  // TRASH MODAL (Recently Removed)
  // =========================================

  function openTrashModal() {
    const modal = document.getElementById('library-trash-modal');
    if (!modal) return;

    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    renderTrashList();
  }

  function closeTrashModal() {
    const modal = document.getElementById('library-trash-modal');
    if (!modal) return;

    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  function renderTrashList() {
    const list = document.getElementById('library-trash-list');
    if (!list) return;

    list.innerHTML = '';

    // Get all trashed assets
    const trashedAssets = Object.entries(State.assetMeta)
      .filter(([id, meta]) => meta.trashed)
      .map(([id, meta]) => {
        const asset = State.assets.find(a => a.id === id);
        return { id, meta, asset };
      })
      .filter(item => item.asset) // Only show assets we have data for
      .sort((a, b) => {
        // Sort by trashed date, newest first
        const dateA = a.meta.trashedAt || '';
        const dateB = b.meta.trashedAt || '';
        return dateB.localeCompare(dateA);
      });

    if (trashedAssets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'library-trash-list-empty';
      empty.textContent = 'Trash is empty';
      list.appendChild(empty);
      return;
    }

    trashedAssets.forEach(({ id, meta, asset }) => {
      const item = document.createElement('div');
      item.className = 'library-trash-item';

      const main = document.createElement('div');
      main.className = 'library-trash-item-main';

      // Thumbnail
      const thumb = document.createElement('img');
      thumb.className = 'library-trash-item-thumb';
      thumb.src = getThumbUrl(asset);
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.onerror = function() {
        this.onerror = null;
        this.src = getPlaceholderForType(asset.ext || '');
      };

      // Info
      const info = document.createElement('div');
      info.className = 'library-trash-item-info';

      const name = document.createElement('div');
      name.className = 'library-trash-item-name';
      name.textContent = asset.name || id;

      const metaEl = document.createElement('div');
      metaEl.className = 'library-trash-item-meta';
      const trashedDate = meta.trashedAt ? formatDate(meta.trashedAt) : '';
      metaEl.textContent = trashedDate ? 'Removed ' + trashedDate : '';

      info.appendChild(name);
      if (trashedDate) info.appendChild(metaEl);

      main.appendChild(thumb);
      main.appendChild(info);

      // Restore button
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'library-trash-item-restore';
      restoreBtn.textContent = '↩';
      restoreBtn.title = 'Restore';
      restoreBtn.setAttribute('aria-label', 'Restore from trash');

      restoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Immediate UI removal
        item.remove();

        // Restore the asset
        restoreAsset(id);

        // Check if list is now empty
        if (list.children.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'library-trash-list-empty';
          empty.textContent = 'Trash is empty';
          list.appendChild(empty);
        }
      });

      item.appendChild(main);
      item.appendChild(restoreBtn);
      list.appendChild(item);
    });
  }

  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return diffDays + ' days ago';

      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function initTrashModal() {
    const trigger = document.getElementById('library-trash-trigger');
    const closeBtn = document.getElementById('library-trash-modal-close');
    const backdrop = document.getElementById('library-trash-modal-backdrop');

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTrashModal();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeTrashModal();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target.getAttribute('data-modal-close') === '1') {
          closeTrashModal();
        }
      });
    }
  }

  // =========================================
  // CART
  // =========================================

  function addToCart(assetId) {
    if (State.cart.includes(assetId)) return;
    State.cart.push(assetId);
    saveCartToLocal();
    updateCartCount();
  }

  function removeFromCart(assetId) {
    const idx = State.cart.indexOf(assetId);
    if (idx === -1) return;
    State.cart.splice(idx, 1);
    saveCartToLocal();
    updateCartCount();
  }

  function isInCart(assetId) {
    return State.cart.includes(assetId);
  }

  function updateCartCount() {
    const el = document.getElementById('library-cart-count');
    if (el) {
      el.textContent = State.cart.length > 0 ? State.cart.length : '';
    }
  }

  function renderCart() {
    const container = document.getElementById('library-cart-body');
    if (!container) return;

    if (State.cart.length === 0) {
      container.innerHTML = `
        <div class="library-cart-empty">
          <p>Your cart is empty</p>
          <p class="library-empty-hint">Add assets while browsing to request them</p>
        </div>
      `;
      return;
    }

    const cartAssets = State.cart
      .map(id => State.assets.find(a => a.id === id))
      .filter(Boolean);

    container.innerHTML = cartAssets.map(asset => {
      const placeholder = getPlaceholderForType(asset.ext);
      return `
      <div class="library-cart-item" data-id="${escapeHtml(asset.id)}">
        <div class="library-cart-item-thumb">
          <img src="${getThumbUrl(asset)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${placeholder}'">
        </div>
        <div class="library-cart-item-info">
          <div class="library-cart-item-title">${escapeHtml(asset.name)}</div>
          <div class="library-cart-item-path">${escapeHtml(asset.folder || '')}</div>
        </div>
        <button type="button" class="library-cart-item-remove" data-id="${escapeHtml(asset.id)}">×</button>
      </div>
    `}).join('');
  }

  // =========================================
  // BATCH SELECTION
  // =========================================

  function toggleAssetSelection(assetId) {
    const idx = State.selectedAssets.indexOf(assetId);
    if (idx === -1) {
      State.selectedAssets.push(assetId);
    } else {
      State.selectedAssets.splice(idx, 1);
    }
    renderGrid();
    renderBatchToolbar();
  }

  function clearSelection() {
    State.selectedAssets = [];
    renderGrid();
    renderBatchToolbar();
  }

  function selectAllVisible() {
    const pageSize = Config.pageSize || 60;
    const visible = State.filteredAssets.slice(0, State.page * pageSize);
    State.selectedAssets = visible.map(a => a.id);
    renderGrid();
    renderBatchToolbar();
  }

  function renderBatchToolbar() {
    let toolbar = document.getElementById('library-batch-toolbar');

    if (State.selectedAssets.length === 0) {
      if (toolbar) toolbar.remove();
      return;
    }

    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'library-batch-toolbar';
      toolbar.className = 'library-batch-toolbar';
      document.body.appendChild(toolbar);
    }

    const jobBtnText = State.addToJobTarget
      ? `Add to ${State.addToJobTarget.app} #${State.addToJobTarget.jobId}`
      : 'Add to Job';

    // Only show Move button in Browse mode
    const showMoveBtn = State.mode === 'browse' && State.browse.source;
    const moveBtnHtml = showMoveBtn
      ? '<button type="button" class="library-batch-btn" data-action="batch-move">Move</button>'
      : '';

    toolbar.innerHTML = `
      <div class="library-batch-count">${State.selectedAssets.length} selected</div>
      <div class="library-batch-actions">
        <button type="button" class="library-batch-btn" data-action="batch-tags">Tags</button>
        ${moveBtnHtml}
        <button type="button" class="library-batch-btn" data-action="batch-job">${jobBtnText}</button>
        <button type="button" class="library-batch-btn is-secondary" data-action="batch-clear">Clear</button>
      </div>
    `;

    // Bind toolbar actions
    toolbar.onclick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'batch-clear') {
        clearSelection();
      } else if (action === 'batch-tags') {
        openBatchTagsModal();
      } else if (action === 'batch-job') {
        batchAddToJob();
      } else if (action === 'batch-move') {
        openBatchMoveModal();
      }
    };
  }

  function openBatchTagsModal() {
    // Create unified modal for batch tagging
    const existing = document.getElementById('library-batch-modal');
    if (existing) existing.remove();

    // Track selected state (add/remove modes)
    const selected = {
      products: new Set(),
      productsToRemove: new Set(),
      lob: null,
      tags: new Set(),
      tagsToRemove: new Set(),
      notes: ''
    };

    const modal = document.createElement('div');
    modal.id = 'library-batch-modal';
    modal.className = 'library-batch-modal';

    const renderPills = (items, type, isMulti = true) => {
      return items.map(item => `
        <button type="button"
                class="library-tag-toggle"
                data-type="${type}"
                data-value="${escapeHtml(item)}">
          ${escapeHtml(item)}
        </button>
      `).join('');
    };

    modal.innerHTML = `
      <div class="library-batch-modal-content">
        <div class="library-batch-modal-header">
          <h3>Tag ${State.selectedAssets.length} Assets</h3>
          <button type="button" class="library-batch-modal-close">×</button>
        </div>
        <div class="library-batch-modal-body">
          <div class="library-batch-section">
            <label class="library-batch-section-label">Products</label>
            <div class="library-batch-pills" data-section="products">
              ${State.productList.length > 0 ? renderPills(State.productList, 'product') : '<span class="library-batch-empty">No products defined</span>'}
            </div>
          </div>

          <div class="library-batch-section">
            <label class="library-batch-section-label">LOB <span class="library-batch-hint">(single select)</span></label>
            <div class="library-batch-pills" data-section="lob">
              ${State.lobList.length > 0 ? renderPills(State.lobList, 'lob') : '<span class="library-batch-empty">No LOBs defined</span>'}
            </div>
          </div>

          <div class="library-batch-section">
            <label class="library-batch-section-label">Tags</label>
            <div class="library-batch-pills" data-section="tags">
              ${State.tagList.length > 0 ? renderPills(State.tagList, 'tag') : '<span class="library-batch-empty">No tags defined</span>'}
            </div>
          </div>

          <div class="library-batch-section">
            <label class="library-batch-section-label">Notes <span class="library-batch-hint">(photographer, source, etc.)</span></label>
            <textarea class="library-batch-notes"
                      placeholder="Add notes to selected assets..."
                      rows="2"></textarea>
          </div>
        </div>
        <div class="library-batch-modal-footer">
          <button type="button" class="library-batch-apply-btn">Apply to ${State.selectedAssets.length} Assets</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('.library-batch-modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Handle pill clicks
    modal.querySelectorAll('.library-tag-toggle').forEach(pill => {
      pill.onclick = () => {
        const type = pill.dataset.type;
        const value = pill.dataset.value;

        if (type === 'product') {
          // Cycle: neutral → add → remove → neutral
          if (selected.products.has(value)) {
            // Was "add" → switch to "remove"
            selected.products.delete(value);
            selected.productsToRemove.add(value);
            pill.classList.remove('is-active');
            pill.classList.add('is-remove');
          } else if (selected.productsToRemove.has(value)) {
            // Was "remove" → switch to neutral
            selected.productsToRemove.delete(value);
            pill.classList.remove('is-remove');
          } else {
            // Was neutral → switch to "add"
            selected.products.add(value);
            pill.classList.add('is-active');
          }
        } else if (type === 'lob') {
          // Single select - clear others first
          modal.querySelectorAll('[data-type="lob"]').forEach(p => p.classList.remove('is-active'));
          if (selected.lob === value) {
            selected.lob = null;
          } else {
            selected.lob = value;
            pill.classList.add('is-active');
          }
        } else if (type === 'tag') {
          // Cycle: neutral → add → remove → neutral
          if (selected.tags.has(value)) {
            // Was "add" → switch to "remove"
            selected.tags.delete(value);
            selected.tagsToRemove.add(value);
            pill.classList.remove('is-active');
            pill.classList.add('is-remove');
          } else if (selected.tagsToRemove.has(value)) {
            // Was "remove" → switch to neutral
            selected.tagsToRemove.delete(value);
            pill.classList.remove('is-remove');
          } else {
            // Was neutral → switch to "add"
            selected.tags.add(value);
            pill.classList.add('is-active');
          }
        }
      };
    });

    // Notes textarea
    const notesTextarea = modal.querySelector('.library-batch-notes');
    notesTextarea.oninput = () => {
      selected.notes = notesTextarea.value.trim();
    };

    // Apply handler
    modal.querySelector('.library-batch-apply-btn').onclick = async () => {
      const hasChanges = selected.products.size > 0 ||
                         selected.productsToRemove.size > 0 ||
                         selected.lob !== null ||
                         selected.tags.size > 0 ||
                         selected.tagsToRemove.size > 0 ||
                         selected.notes.length > 0;

      if (!hasChanges) {
        showToast('Select at least one item or add notes');
        return;
      }

      await batchApplyMetadata({
        products: Array.from(selected.products),
        productsToRemove: Array.from(selected.productsToRemove),
        lob: selected.lob,
        tags: Array.from(selected.tags),
        tagsToRemove: Array.from(selected.tagsToRemove),
        notes: selected.notes
      });
      modal.remove();
    };
  }

  // =========================================
  // BATCH MOVE MODAL
  // =========================================

  function openBatchMoveModal() {
    const existing = document.getElementById('library-move-modal');
    if (existing) existing.remove();

    const source = State.browse.source;
    if (!source) {
      showToast('Select a source first');
      return;
    }

    // Build folder tree for modal
    const folderTree = buildFolderTreeForModal(source);

    const modal = document.createElement('div');
    modal.id = 'library-move-modal';
    modal.className = 'library-move-modal';
    modal.innerHTML = `
      <div class="library-move-modal-backdrop" data-modal-close="1"></div>
      <div class="library-move-modal-panel">
        <div class="library-move-modal-header">
          <div class="library-move-modal-title">Move ${State.selectedAssets.length} Items</div>
          <button type="button" class="library-move-modal-close" data-modal-close="1">×</button>
        </div>
        <div class="library-move-modal-body">
          <div class="library-move-modal-note">Select a destination folder</div>
          <div class="library-move-folder-tree" id="library-move-folder-tree">
            <button type="button" class="library-move-folder is-root" data-path="">
              <span class="library-move-folder-icon">📁</span>
              <span class="library-move-folder-name">${source === 'stock' ? 'Stock' : 'Publications'} (root)</span>
            </button>
            ${folderTree}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('.library-move-modal-close').onclick = () => modal.remove();
    modal.querySelector('.library-move-modal-backdrop').onclick = () => modal.remove();

    // Folder selection
    modal.querySelectorAll('.library-move-folder').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetPath = btn.dataset.path;
        modal.remove();

        // Get current path to check if already there
        const currentPath = State.browse.path.join('/');
        if (targetPath === currentPath) {
          showToast('Items are already in this folder');
          return;
        }

        await executeBatchMove(targetPath);
      });
    });
  }

  function buildFolderTreeForModal(source, parentPath = '', depth = 0) {
    if (depth > 3) return ''; // Limit depth for performance

    const pathSegments = parentPath ? parentPath.split('/') : [];
    const subfolders = getSubfoldersAt(source, pathSegments);

    if (subfolders.length === 0) return '';

    return subfolders.map(folder => {
      const fullPath = folder.fullPath;
      const indent = depth * 20;
      const displayName = getFolderDisplayName(source, fullPath);
      const children = buildFolderTreeForModal(source, fullPath, depth + 1);

      return `
        <button type="button" class="library-move-folder" data-path="${escapeHtml(fullPath)}" style="padding-left: ${24 + indent}px;">
          <span class="library-move-folder-icon">📁</span>
          <span class="library-move-folder-name">${escapeHtml(displayName)}</span>
          <span class="library-move-folder-count">${folder.count}</span>
        </button>
        ${children}
      `;
    }).join('');
  }

  async function executeBatchMove(targetPath) {
    const count = State.selectedAssets.length;
    showToast(`Moving ${count} items...`);

    try {
      await batchMoveAssetsToFolder([...State.selectedAssets], targetPath);
      showToast(`Moved ${count} items`, 'success');

      // Clear selection
      clearSelection();

      // Refresh view
      if (State.mode === 'browse') {
        renderBrowseView();
      }
    } catch (e) {
      showToast('Move failed: ' + e.message, 'error');
    }
  }

  async function batchApplyMetadata({ products, productsToRemove = [], lob, tags, tagsToRemove = [], notes }) {
    const count = State.selectedAssets.length;
    showToast(`Applying metadata to ${count} assets...`);

    let successCount = 0;
    let failCount = 0;

    for (const assetId of State.selectedAssets) {
      const asset = State.assets.find(a => a.id === assetId);
      if (!asset) {
        console.warn('[Library] Asset not found in State.assets:', assetId);
        failCount++;
        continue;
      }

      const meta = getAssetMeta(assetId);

      // Add new products, then remove marked ones
      let newProducts = products.length > 0
        ? [...new Set([...meta.products, ...products])]
        : [...meta.products];
      if (productsToRemove.length > 0) {
        newProducts = newProducts.filter(p => !productsToRemove.includes(p));
      }

      // Add new tags, then remove marked ones
      let newTags = tags.length > 0
        ? [...new Set([...meta.tags, ...tags])]
        : [...meta.tags];
      if (tagsToRemove.length > 0) {
        newTags = newTags.filter(t => !tagsToRemove.includes(t));
      }

      // LOB is single-select: only update if user selected one
      const newLob = lob !== null ? lob : meta.lob;

      // Notes: append if provided
      const newNotes = notes.length > 0
        ? (meta.notes ? `${meta.notes}\n${notes}` : notes)
        : meta.notes;

      State.assetMeta[assetId] = {
        ...meta,
        products: newProducts,
        tags: newTags,
        lob: newLob,
        notes: newNotes
      };

      // Save to API
      try {
        await LibraryAPI.upsertAssetMeta(
          assetId,
          asset.path,
          newProducts,
          newTags,
          newLob,
          newNotes,
          meta.displayName
        );
        successCount++;
      } catch (e) {
        console.error('[Library] Failed to save metadata for', assetId, e);
        failCount++;
      }
    }

    saveLocalState();

    // Build summary message
    const addParts = [];
    const removeParts = [];
    if (products.length > 0) addParts.push(`${products.length} product(s)`);
    if (productsToRemove.length > 0) removeParts.push(`${productsToRemove.length} product(s)`);
    if (lob) addParts.push('LOB');
    if (tags.length > 0) addParts.push(`${tags.length} tag(s)`);
    if (tagsToRemove.length > 0) removeParts.push(`${tagsToRemove.length} tag(s)`);
    if (notes) addParts.push('notes');

    let message = '';
    if (addParts.length > 0) message += `Added ${addParts.join(', ')}`;
    if (removeParts.length > 0) {
      if (message) message += ', ';
      message += `removed ${removeParts.join(', ')}`;
    }
    message += ` on ${successCount} assets`;

    if (failCount > 0) {
      showToast(`${message} (${failCount} failed)`, 'warning');
    } else {
      showToast(message, 'success');
    }

    clearSelection();

    // Refresh UI to show updated tags
    buildTagCloud();
    renderGrid();
  }

  // =========================================
  // ADD TO JOB MODAL
  // =========================================

  // API URLs for job systems
  const JOB_API_URLS = {
    artstart: 'https://script.google.com/macros/s/AKfycbwMEAKtnijh5H4JTaPC7Wz75pwAkzHmEH2l9HoCUNLSza-EhyD4xS1sHudV0SpUxIY70A/exec',
    copydesk: 'https://script.google.com/macros/s/AKfycbwW7nb_iJiZJBKeUIQtpp_GOY4tnLQidefDyOHqZDpQkfMympH2Ip4kvgv8bE1or9O9/exec',
    fileroom: 'https://script.google.com/macros/s/AKfycbyZauMq2R6mIElFnAWVbWRDVgJqT713sT_PTdsixNi9IyZx-a3yiFT7bjk8XE_Fd709/exec'
  };

  // Cache for loaded jobs
  let _jobsCache = {
    artstart: null,
    copydesk: null,
    fileroom: null,
    lastFetch: 0
  };

  const JOB_CACHE_TTL = 60000; // 1 minute cache

  /**
   * Check if a date string has passed end-of-day Eastern time.
   * Matches the logic in ascend.js isPastEofdEastern_
   */
  function isPastEofdEastern(dateStr, nowMs) {
    if (!dateStr) return false;
    try {
      // Parse date (handle various formats)
      let d;
      if (typeof dateStr === 'string') {
        // Try ISO format first, then common date formats
        d = new Date(dateStr);
        if (isNaN(d.getTime())) {
          // Try MM/DD/YYYY or similar
          const parts = dateStr.split(/[-/]/);
          if (parts.length === 3) {
            d = new Date(parts[2], parts[0] - 1, parts[1]);
          }
        }
      } else {
        d = new Date(dateStr);
      }

      if (isNaN(d.getTime())) return false;

      // End of day in Eastern time (approximate: add 1 day, compare to now)
      // Jobs exit at end of day Eastern, so we check if we're past that day
      const jobDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      jobDate.setDate(jobDate.getDate() + 1); // End of that day
      jobDate.setHours(5, 0, 0, 0); // ~midnight Eastern in UTC

      return nowMs > jobDate.getTime();
    } catch (e) {
      return false;
    }
  }

  function batchAddToJob() {
    // If in addToJob mode, add directly to the job (no picker)
    if (State.addToJobTarget) {
      addSelectedToTargetJob();
      return;
    }
    openJobModal();
  }

  /**
   * Add selected assets directly to the target job (no picker)
   */
  async function addSelectedToTargetJob() {
    const target = State.addToJobTarget;
    if (!target) return;

    const assetIds = State.selectedAssets.slice();
    if (assetIds.length === 0) {
      showToast('No assets selected');
      return;
    }

    showToast(`Adding ${assetIds.length} asset(s) to ${target.app} #${target.jobId}...`);

    try {
      const userEmail = getCurrentUserEmail();
      await LibraryAPI.linkAssetsToJob(assetIds, target.fullId, target.app, userEmail);

      // Update local linked state
      assetIds.forEach(id => {
        if (!State.linkedAssetsForJob.includes(id)) {
          State.linkedAssetsForJob.push(id);
        }
      });

      // Notify opener window (ArtStart) and close
      if (window.opener && typeof window.opener.refreshLinkedImages === 'function') {
        window.opener.refreshLinkedImages();
      }

      // Close the popup - user came from ArtStart, job done
      window.close();
    } catch (e) {
      console.error('[Library] Failed to add assets:', e);
      showToast('Failed to add assets: ' + e.message, 'error');
    }
  }

  function openJobModal() {
    const modal = document.getElementById('library-job-modal');
    if (!modal) {
      console.error('[Library] Job modal not found in DOM');
      return;
    }

    // Regular "Add to Job" mode - show job picker
    const titleEl = document.getElementById('library-job-modal-title');
    if (titleEl) titleEl.textContent = 'Add to Job';

    const noteEl = document.getElementById('library-job-modal-note');
    if (noteEl) {
      noteEl.innerHTML = `Select a job to link <span id="library-job-asset-count">${State.selectedAssets.length}</span> selected asset(s).`;
    }

    // Show job lists, hide manage view
    document.querySelectorAll('.library-job-section').forEach(el => el.style.display = '');
    const manageView = document.getElementById('library-manage-job-view');
    if (manageView) manageView.style.display = 'none';

    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Load jobs
    loadAllJobs();

    // Bind close handlers (only once)
    initJobModalHandlers();
  }

  /**
   * Open "Manage Job Assets" view for the target job
   */
  function openManageJobAssetsModal() {
    const modal = document.getElementById('library-job-modal');
    if (!modal) return;

    const target = State.addToJobTarget;

    // Initialize manage state: combine linked assets + selected assets
    const linkedSet = new Set(State.linkedAssetsForJob);
    const selectedSet = new Set(State.selectedAssets);
    const combined = new Set([...linkedSet, ...selectedSet]);

    State.manageJobState = {
      original: new Set(linkedSet), // What was linked before
      current: combined             // Current toggle state
    };

    // Update modal title
    const titleEl = document.getElementById('library-job-modal-title');
    if (titleEl) titleEl.textContent = 'Manage Job Assets';

    // Hide job lists, show manage view
    document.querySelectorAll('.library-job-section').forEach(el => el.style.display = 'none');

    // Create or update manage view
    let manageView = document.getElementById('library-manage-job-view');
    if (!manageView) {
      manageView = document.createElement('div');
      manageView.id = 'library-manage-job-view';
      manageView.className = 'library-manage-job-view';
      document.getElementById('library-job-modal-body')
        || document.querySelector('.library-job-modal-body').appendChild(manageView);
    }
    manageView.style.display = '';

    renderManageJobAssetsView();

    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    initJobModalHandlers();
  }

  /**
   * Render the Manage Job Assets view content
   */
  function renderManageJobAssetsView() {
    const manageView = document.getElementById('library-manage-job-view');
    if (!manageView || !State.manageJobState) return;

    const target = State.addToJobTarget;
    const { original, current } = State.manageJobState;

    // Calculate diff
    const toAdd = [...current].filter(id => !original.has(id));
    const toRemove = [...original].filter(id => !current.has(id));
    const hasChanges = toAdd.length > 0 || toRemove.length > 0;

    // Build summary text
    let summaryParts = [];
    if (toAdd.length > 0) summaryParts.push(`Adding ${toAdd.length}`);
    if (toRemove.length > 0) summaryParts.push(`Removing ${toRemove.length}`);
    const summaryText = summaryParts.length > 0 ? summaryParts.join(', ') : 'No changes';

    // Build asset list HTML
    const allAssetIds = [...current, ...original].filter((v, i, a) => a.indexOf(v) === i);
    const assetsHtml = allAssetIds.map(assetId => {
      const isOn = current.has(assetId);
      const wasLinked = original.has(assetId);
      const asset = State.assets.find(a => a.id === assetId);
      const meta = State.assetMeta[assetId] || {};
      const displayName = meta.displayName || (asset ? asset.name : assetId);
      const thumbUrl = asset ? getThumbUrl(asset) : '';

      let statusClass = isOn ? 'is-on' : 'is-off';
      let badge = '';
      if (wasLinked && isOn) badge = '<span class="library-manage-badge is-linked">linked</span>';
      else if (!wasLinked && isOn) badge = '<span class="library-manage-badge is-adding">+ adding</span>';
      else if (wasLinked && !isOn) badge = '<span class="library-manage-badge is-removing">- removing</span>';

      return `
        <div class="library-manage-asset ${statusClass}" data-asset-id="${escapeHtml(assetId)}">
          <div class="library-manage-asset-thumb">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="">` : ''}
          </div>
          <div class="library-manage-asset-info">
            <div class="library-manage-asset-name">${escapeHtml(displayName)}</div>
            ${badge}
          </div>
          <button type="button" class="library-manage-asset-toggle" data-asset-id="${escapeHtml(assetId)}">
            ${isOn ? '✓' : '○'}
          </button>
        </div>
      `;
    }).join('');

    manageView.innerHTML = `
      <div class="library-manage-header">
        <div class="library-manage-job-name">${escapeHtml(target.app)} #${escapeHtml(target.jobId)}</div>
        <div class="library-manage-summary ${hasChanges ? 'has-changes' : ''}">${summaryText}</div>
      </div>
      <div class="library-manage-assets">
        ${assetsHtml || '<div class="library-manage-empty">No assets selected or linked</div>'}
      </div>
      <div class="library-manage-footer">
        <button type="button" class="library-btn library-btn-secondary" id="library-manage-cancel">Cancel</button>
        <button type="button" class="library-btn library-btn-primary" id="library-manage-save" ${!hasChanges ? 'disabled' : ''}>
          Save Changes
        </button>
      </div>
    `;

    // Bind toggle clicks
    manageView.querySelectorAll('.library-manage-asset-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const assetId = btn.dataset.assetId;
        toggleManageAsset(assetId);
      });
    });

    // Bind asset row clicks (also toggle)
    manageView.querySelectorAll('.library-manage-asset').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.library-manage-asset-toggle')) return; // Let button handle it
        const assetId = row.dataset.assetId;
        toggleManageAsset(assetId);
      });
    });

    // Bind cancel
    const cancelBtn = document.getElementById('library-manage-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        tryCloseJobModal();
      });
    }

    // Bind save
    const saveBtn = document.getElementById('library-manage-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        saveManageJobAssets();
      });
    }
  }

  /**
   * Toggle an asset in the manage state
   */
  function toggleManageAsset(assetId) {
    if (!State.manageJobState) return;

    if (State.manageJobState.current.has(assetId)) {
      State.manageJobState.current.delete(assetId);
    } else {
      State.manageJobState.current.add(assetId);
    }

    renderManageJobAssetsView();
  }

  /**
   * Check if there are unsaved changes in manage mode
   */
  function hasUnsavedManageChanges() {
    if (!State.manageJobState) return false;
    const { original, current } = State.manageJobState;
    const toAdd = [...current].filter(id => !original.has(id));
    const toRemove = [...original].filter(id => !current.has(id));
    return toAdd.length > 0 || toRemove.length > 0;
  }

  /**
   * Try to close the job modal, warn if unsaved changes
   */
  function tryCloseJobModal() {
    if (State.addToJobTarget && hasUnsavedManageChanges()) {
      if (!confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }
    closeJobModal();
  }

  /**
   * Save changes from Manage Job Assets
   */
  async function saveManageJobAssets() {
    if (!State.manageJobState || !State.addToJobTarget) return;

    const target = State.addToJobTarget;
    const { original, current } = State.manageJobState;
    const toAdd = [...current].filter(id => !original.has(id));
    const toRemove = [...original].filter(id => !current.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      closeJobModal();
      return;
    }

    showToast('Saving changes...');

    try {
      const userEmail = getCurrentUserEmail();

      // Link new assets
      if (toAdd.length > 0) {
        await LibraryAPI.linkAssetsToJob(toAdd, target.fullId, target.app, userEmail);
      }

      // Unlink removed assets
      if (toRemove.length > 0) {
        await LibraryAPI.unlinkAssetsFromJob(toRemove, target.fullId);
      }

      // Update local state
      State.linkedAssetsForJob = [...current];
      State.manageJobState = null;

      showToast(`Saved: ${toAdd.length > 0 ? '+' + toAdd.length : ''} ${toRemove.length > 0 ? '-' + toRemove.length : ''}`.trim(), 'success');

      closeJobModal();
      clearSelection();
      renderGrid();

      // Notify opener window (ArtStart)
      if (window.opener && typeof window.opener.refreshLinkedImages === 'function') {
        window.opener.refreshLinkedImages();
      }
    } catch (e) {
      console.error('[Library] Failed to save changes:', e);
      showToast('Failed to save changes: ' + e.message, 'error');
    }
  }

  function closeJobModal() {
    const modal = document.getElementById('library-job-modal');
    if (!modal) return;

    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Reset manage state
    State.manageJobState = null;
  }

  function initJobModalHandlers() {
    const modal = document.getElementById('library-job-modal');
    if (!modal || modal._handlersInit) return;
    modal._handlersInit = true;

    // Close button - use tryClose to check for unsaved changes
    const closeBtn = document.getElementById('library-job-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', tryCloseJobModal);
    }

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target.getAttribute('data-modal-close') === '1') {
        tryCloseJobModal();
      }
    });

    // ESC key (global, but check if modal is open)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        tryCloseJobModal();
      }
    });
  }

  function getCurrentUserEmail() {
    // Try Config first
    if (Config.userEmail) return Config.userEmail;

    // Try Ascend session
    try {
      const raw = localStorage.getItem('ascend_session_v1');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && (obj.userEmail || obj.email)) {
          return String(obj.userEmail || obj.email).trim();
        }
      }
    } catch (e) {}

    return '';
  }

  function checkAdminAccess() {
    const email = getCurrentUserEmail().toLowerCase();
    const adminList = (Config.adminEmails || []).map(e => String(e).toLowerCase().trim());
    const isAdmin = email && adminList.includes(email);

    // Hide admin UI if not admin
    const adminActions = document.getElementById('library-admin-actions');
    if (adminActions) {
      adminActions.style.display = isAdmin ? '' : 'none';
    }

    console.log('[Library] Admin check:', email, isAdmin ? '(admin)' : '(regular user)');
  }

  async function loadAllJobs() {
    const now = Date.now();
    const needRefresh = (now - _jobsCache.lastFetch) > JOB_CACHE_TTL;

    const activeList = document.getElementById('library-job-list-active');
    const archivalList = document.getElementById('library-job-list-archival');

    if (activeList) {
      activeList.innerHTML = '';
      activeList.classList.add('is-loading');
    }
    if (archivalList) {
      archivalList.innerHTML = '';
      archivalList.classList.add('is-loading');
    }

    const userEmail = getCurrentUserEmail();
    if (!userEmail) {
      if (activeList) activeList.classList.remove('is-loading');
      if (archivalList) archivalList.classList.remove('is-loading');
      showToast('Please sign in to view your jobs');
      return;
    }

    // Fetch from all three APIs in parallel
    const promises = [];

    if (needRefresh || !_jobsCache.artstart) {
      promises.push(fetchArtStartJobs(userEmail));
    }
    if (needRefresh || !_jobsCache.copydesk) {
      promises.push(fetchCopydeskJobs(userEmail));
    }
    if (needRefresh || !_jobsCache.fileroom) {
      promises.push(fetchFileRoomJobs(userEmail));
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
      _jobsCache.lastFetch = Date.now();
    }

    // Render
    renderJobLists();
  }

  function fetchArtStartJobs(userEmail) {
    return new Promise((resolve) => {
      const callbackName = `__libraryArtStartCallback_${Date.now()}`;

      window[callbackName] = (response) => {
        try {
          const jobs = response?.jobs || response?.data?.jobs || [];
          const nowMs = Date.now();

          // Filter to only "in play" jobs (not deleted, deadline not passed)
          _jobsCache.artstart = jobs
            .filter(j => {
              // Skip deleted jobs
              if ((j.Status || '').toLowerCase() === 'deleted') return false;
              // Skip jobs past their MaterialsDueDate (they've moved to FileRoom)
              if (j.MaterialsDueDate && isPastEofdEastern(j.MaterialsDueDate, nowMs)) return false;
              return true;
            })
            .map(j => ({
              id: j.AscendJobId || j.JobId || j.jobId || j.id,
              name: j.NordsonJobId || j.Title || j.JobName || j.name || 'Untitled',
              subtitle: j.PublicationName || j.Publication || j.PublicationOrChannel || '',
              app: 'artstart',
              status: j.Status || '',
              createdAt: j.CreatedAt || '',
              materialsDueDate: j.MaterialsDueDate || ''
            }));
        } catch (e) {
          console.error('[Library] Error parsing ArtStart jobs:', e);
          _jobsCache.artstart = [];
        }
        delete window[callbackName];
        resolve();
      };

      const url = new URL(JOB_API_URLS.artstart);
      url.searchParams.set('action', 'listArtStartJobsForUser');
      url.searchParams.set('user_email', userEmail);
      url.searchParams.set('limit', '50');
      url.searchParams.set('callback', callbackName);
      url.searchParams.set('_', Date.now());

      const script = document.createElement('script');
      script.src = url.toString();
      script.onerror = () => {
        _jobsCache.artstart = [];
        delete window[callbackName];
        resolve();
      };
      document.head.appendChild(script);

      // Timeout fallback
      setTimeout(() => {
        if (window[callbackName]) {
          _jobsCache.artstart = _jobsCache.artstart || [];
          delete window[callbackName];
          resolve();
        }
      }, 10000);
    });
  }

  function fetchCopydeskJobs(userEmail) {
    return new Promise((resolve) => {
      const callbackName = `__libraryCopydeskCallback_${Date.now()}`;

      window[callbackName] = (response) => {
        try {
          const jobs = response?.jobs || response?.data?.jobs || [];
          const nowMs = Date.now();

          // Filter to only "in play" jobs (not closed, cutoff not passed)
          // Exception: Open translation subjobs stay even if past cutoff
          _jobsCache.copydesk = jobs
            .filter(j => {
              const status = (j.Status || '').toLowerCase();
              const isTranslation = !!(j.IsTranslation || j.Lang || j.Language);
              const isOpenTranslation = isTranslation && status === 'open';

              // Skip closed jobs (they've moved to FileRoom)
              if (status === 'closed') return false;

              // Skip jobs past their Cutoff date (unless it's an open translation)
              if (j.Cutoff && isPastEofdEastern(j.Cutoff, nowMs) && !isOpenTranslation) return false;

              return true;
            })
            .map(j => ({
              id: j.JobId || j.jobId || j.id,
              name: j.JobName || j.Title || j.name || 'Untitled',
              subtitle: j.Cutoff ? `Due: ${j.Cutoff}` : (j.Status || ''),
              app: 'copydesk',
              status: j.Status || '',
              createdAt: j.CreatedAt || '',
              closedAt: j.ClosedAt || '',
              cutoff: j.Cutoff || ''
            }));
        } catch (e) {
          console.error('[Library] Error parsing Copydesk jobs:', e);
          _jobsCache.copydesk = [];
        }
        delete window[callbackName];
        resolve();
      };

      const url = new URL(JOB_API_URLS.copydesk);
      url.searchParams.set('action', 'listCopydeskJobsForUser');
      url.searchParams.set('user_email', userEmail);
      url.searchParams.set('limit', '50');
      url.searchParams.set('callback', callbackName);
      url.searchParams.set('_', Date.now());

      const script = document.createElement('script');
      script.src = url.toString();
      script.onerror = () => {
        _jobsCache.copydesk = [];
        delete window[callbackName];
        resolve();
      };
      document.head.appendChild(script);

      // Timeout fallback
      setTimeout(() => {
        if (window[callbackName]) {
          _jobsCache.copydesk = _jobsCache.copydesk || [];
          delete window[callbackName];
          resolve();
        }
      }, 10000);
    });
  }

  function fetchFileRoomJobs(userEmail) {
    return new Promise((resolve) => {
      const callbackName = `__libraryFileRoomCallback_${Date.now()}`;

      window[callbackName] = (response) => {
        try {
          let jobs = [];
          if (response?.data?.jobs) jobs = response.data.jobs;
          else if (response?.jobs) jobs = response.jobs;
          else if (Array.isArray(response?.data)) jobs = response.data;

          _jobsCache.fileroom = jobs.map(j => ({
            id: j.AscendJobKey || j.ascend_job_key || j.JobId || j.id,
            name: j.Title || j.JobName || j.name || 'Untitled',
            subtitle: j.App || j.Status || 'Completed',
            app: 'fileroom',
            status: j.Status || 'Completed',
            createdAt: j.CreatedAt || '',
            closedAt: j.ClosedAt || ''
          }));
        } catch (e) {
          console.error('[Library] Error parsing FileRoom jobs:', e);
          _jobsCache.fileroom = [];
        }
        delete window[callbackName];
        resolve();
      };

      const url = new URL(JOB_API_URLS.fileroom);
      url.searchParams.set('action', 'listJobsForUser');
      url.searchParams.set('user_email', userEmail);
      url.searchParams.set('limit', '100');
      url.searchParams.set('callback', callbackName);
      url.searchParams.set('_', Date.now());

      const script = document.createElement('script');
      script.src = url.toString();
      script.onerror = () => {
        _jobsCache.fileroom = [];
        delete window[callbackName];
        resolve();
      };
      document.head.appendChild(script);

      // Timeout fallback
      setTimeout(() => {
        if (window[callbackName]) {
          _jobsCache.fileroom = _jobsCache.fileroom || [];
          delete window[callbackName];
          resolve();
        }
      }, 10000);
    });
  }

  function renderJobLists() {
    const activeList = document.getElementById('library-job-list-active');
    const archivalList = document.getElementById('library-job-list-archival');

    if (activeList) {
      activeList.classList.remove('is-loading');
      activeList.innerHTML = '';

      // Combine ArtStart + Copydesk (non-closed) for active jobs
      const activeJobs = [
        ...(_jobsCache.artstart || []),
        ...(_jobsCache.copydesk || []).filter(j => !j.closedAt)
      ];

      // Sort by createdAt descending
      activeJobs.sort((a, b) => {
        const at = Date.parse(a.createdAt) || 0;
        const bt = Date.parse(b.createdAt) || 0;
        return bt - at;
      });

      activeJobs.forEach(job => {
        activeList.appendChild(createJobRow(job));
      });
    }

    if (archivalList) {
      archivalList.classList.remove('is-loading');
      archivalList.innerHTML = '';

      // FileRoom jobs (archival)
      const archivalJobs = _jobsCache.fileroom || [];

      archivalJobs.forEach(job => {
        archivalList.appendChild(createJobRow(job));
      });
    }
  }

  function createJobRow(job) {
    const row = document.createElement('div');
    row.className = 'library-job-row';
    row.dataset.jobId = job.id;
    row.dataset.jobApp = job.app;

    // Thumb with provenance bar
    const thumb = document.createElement('div');
    thumb.className = 'library-job-thumb';

    const icon = document.createElement('div');
    icon.className = `library-job-icon is-${job.app}`;

    const iconLabel = document.createElement('div');
    iconLabel.className = 'library-job-icon-label';
    // First letter of app name
    iconLabel.textContent = job.app.charAt(0).toUpperCase();

    thumb.appendChild(icon);
    thumb.appendChild(iconLabel);

    // Text
    const text = document.createElement('div');
    text.className = 'library-job-text';

    const title = document.createElement('div');
    title.className = 'library-job-row-title';
    title.textContent = job.name || 'Untitled';

    const sub = document.createElement('div');
    sub.className = 'library-job-row-sub';
    sub.textContent = job.subtitle || job.status || job.app;

    text.appendChild(title);
    text.appendChild(sub);

    // Link status
    const status = document.createElement('div');
    status.className = 'library-job-link-status';
    status.textContent = 'Link';

    row.appendChild(thumb);
    row.appendChild(text);
    row.appendChild(status);

    // Click handler
    row.addEventListener('click', () => {
      linkAssetsToJob(job.id, job.app, job.name);
    });

    return row;
  }

  async function linkAssetsToJob(jobId, jobApp, jobName) {
    const assetIds = State.selectedAssets.slice();
    if (assetIds.length === 0) {
      showToast('No assets selected');
      return;
    }

    showToast(`Linking ${assetIds.length} asset(s) to ${jobName}...`);

    try {
      const userEmail = getCurrentUserEmail();
      await LibraryAPI.linkAssetsToJob(assetIds, jobId, jobApp, userEmail);
      showToast(`Linked ${assetIds.length} asset(s) to ${jobName}`, 'success');
      closeJobModal();
      clearSelection();

      // Notify opener window if linking to ArtStart job
      if (jobApp === 'ARTSTART' && window.opener && typeof window.opener.refreshLinkedImages === 'function') {
        window.opener.refreshLinkedImages();
      }
    } catch (e) {
      console.error('[Library] Failed to link assets:', e);
      showToast('Failed to link assets: ' + e.message, 'error');
    }
  }

  // =========================================
  // RENDERING
  // =========================================

  function renderGrid() {
    const container = document.getElementById('library-grid');
    if (!container) return;

    if (State.isLoading) {
      showLoading();
      return;
    }

    const pageSize = Config.pageSize || 60;
    const visible = State.filteredAssets.slice(0, State.page * pageSize);

    if (visible.length === 0) {
      container.innerHTML = `
        <div class="library-empty">
          <div class="library-empty-icon">📂</div>
          <div class="library-empty-text">No assets found</div>
          <div class="library-empty-hint">Try adjusting your filters or search</div>
        </div>
      `;
      hideLoadMore();
      return;
    }

    container.innerHTML = visible.map(asset => renderCard(asset)).join('');

    // Show/hide load more
    if (visible.length < State.filteredAssets.length) {
      showLoadMore();
    } else {
      hideLoadMore();
    }
  }

  function renderCard(asset) {
    const meta = State.assetMeta[asset.id] || { products: [], tags: [] };
    const isSelected = State.selectedAssets.includes(asset.id);
    const isLinked = isAssetLinkedToJob(asset.id);
    const ext = (asset.ext || '').toLowerCase();
    const extLabel = ext.toUpperCase();
    const isPdf = ext === 'pdf';
    const hasSourceFile = asset.projectFiles && asset.projectFiles.length > 0;

    // Show products on card if any
    const productsHtml = meta.products.length > 0
      ? meta.products.slice(0, 3).map(p => `<span class="library-card-product">${escapeHtml(p)}</span>`).join('')
      : '';

    // Use thumbnails for all types (actual files not hosted on GitHub Pages)
    const placeholder = getPlaceholderForType(ext);
    const thumbContent = `<img src="${getThumbUrl(asset)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${placeholder}'">`;

    // Gold seal for assets with source files
    const sourceSealHtml = hasSourceFile
      ? `<span class="library-card-source-seal" title="Has editable source file (${asset.projectFiles.map(p => p.ext.toUpperCase()).join(', ')})"></span>`
      : '';

    // Display name (editable) or original filename
    const displayName = meta.displayName || asset.name;

    const needsCheckerboard = ['svg', 'eps', 'png'].includes(ext);

    // Build class list
    const classes = ['library-card'];
    if (isPdf) classes.push('is-pdf');
    if (isSelected) classes.push('is-selected');
    if (isLinked) classes.push('is-linked-to-job');

    return `
      <article class="${classes.join(' ')}" data-id="${escapeHtml(asset.id)}" data-ext="${ext}" draggable="true">
        <div class="library-card-thumb${needsCheckerboard ? ' has-transparency' : ''}">
          ${thumbContent}
          ${extLabel ? `<span class="library-card-type">${extLabel}</span>` : ''}
          ${sourceSealHtml}
          <button type="button"
                  class="library-card-select-btn"
                  data-action="select"
                  data-id="${escapeHtml(asset.id)}"
                  title="Select for batch actions">
            ${isSelected ? '✓' : ''}
          </button>
        </div>
        <div class="library-card-info">
          <div class="library-card-name" title="${escapeHtml(asset.name)}">${escapeHtml(displayName)}</div>
          ${productsHtml ? `<div class="library-card-products">${productsHtml}</div>` : ''}
        </div>
      </article>
    `;
  }

  function getAssetUrl(asset) {
    const encodedPath = asset.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `assets/${encodedPath}`;
  }

  // File types that browsers can display directly
  const WEB_DISPLAYABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp']);

  function getThumbUrl(asset, size = 'sm') {
    // size: 'sm' = 500px (grid cards), 'lg' = 1200px (modal preview)
    const thumbFolder = size === 'lg' ? 'thumbs-lg' : 'thumbs';
    const ext = asset.ext.toLowerCase();

    // All image types use pre-generated WebP thumbnails by asset ID
    const THUMB_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'psd', 'ai', 'eps', 'indd', 'pdf']);
    if (THUMB_TYPES.has(ext)) {
      return `${thumbFolder}/${asset.id}.webp`;
    }

    // Non-displayable: return placeholder data URI by type
    return getPlaceholderForType(ext);
  }

  function getPlaceholderForType(ext) {
    // SVG placeholders for different file types
    const colors = {
      ai: '#FF9A00',   // Illustrator orange
      eps: '#FF9A00',
      psd: '#31A8FF',  // Photoshop blue
      indd: '#FF3366', // InDesign pink
      pdf: '#FF0000',  // PDF red
      default: '#666666'
    };
    const color = colors[ext] || colors.default;
    const label = ext.toUpperCase();

    // Return inline SVG as data URI
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#1a1a1a"/>
      <rect x="40" y="30" width="120" height="140" rx="4" fill="${color}" opacity="0.15"/>
      <text x="100" y="115" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="${color}">${label}</text>
    </svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function updateResultCount() {
    const el = document.getElementById('library-result-count');
    if (el) {
      const total = State.filteredAssets.length;
      const noun = total === 1 ? 'asset' : 'assets';
      el.textContent = `${total} ${noun}`;
    }
  }

  function showLoading() {
    const container = document.getElementById('library-grid');
    if (container) {
      container.innerHTML = '<div class="library-loading">Loading library</div>';
    }
  }

  function showError(message) {
    const container = document.getElementById('library-grid');
    if (container) {
      container.innerHTML = `
        <div class="library-empty">
          <div class="library-empty-icon">⚠️</div>
          <div class="library-empty-text">${escapeHtml(message)}</div>
        </div>
      `;
    }
  }

  function showLoadMore() {
    const el = document.getElementById('library-load-more');
    if (el) el.style.display = 'flex';
  }

  function hideLoadMore() {
    const el = document.getElementById('library-load-more');
    if (el) el.style.display = 'none';
  }

  // =========================================
  // ASSET DETAIL MODAL
  // =========================================

  function openAssetModal(assetId) {
    const asset = State.assets.find(a => a.id === assetId);
    if (!asset) return;

    State.currentAsset = asset;
    // Remember position for when modal closes
    State.lastViewedIndex = State.filteredAssets.findIndex(a => a.id === assetId);

    const modal = document.getElementById('library-modal');
    const previewContainer = document.querySelector('.library-modal-preview');
    const title = document.getElementById('library-modal-title');
    const meta = document.getElementById('library-modal-meta');
    const cartBtn = document.getElementById('library-modal-cart-btn');

    const ext = (asset.ext || '').toLowerCase();
    const isPdf = ext === 'pdf';
    const hasTransparency = ['svg', 'eps', 'png'].includes(ext);
    const assetUrl = getAssetUrl(asset);

    // Check if this is a Media Kits PDF - use full PDF viewer instead of thumbnail
    const assetFolder = getEffectiveFolder(asset);
    const isMediaKitsPdf = isPdf && assetFolder === 'MEDIA-KITS';

    // Set preview content
    const placeholder = getPlaceholderForType(ext);
    const thumbUrl = getThumbUrl(asset, 'lg');
    previewContainer.classList.toggle('has-transparency', hasTransparency);
    previewContainer.classList.toggle('is-pdf-viewer', isMediaKitsPdf);

    if (isMediaKitsPdf) {
      // Media Kits PDFs: use iframe with browser's native PDF viewer (multi-page navigation, zoom)
      // Serve via reveal server on localhost:8081 (file:// URLs blocked by browser security)
      let pdfPath;
      if (asset.path.startsWith('library/')) {
        pdfPath = `${Config.basePath}/${asset.path.slice(8)}`;
      } else if (asset.path.startsWith('publications/')) {
        pdfPath = `${Config.publicationsPath}/${asset.path.slice(13)}`;
      } else {
        pdfPath = `${Config.basePath}/${asset.path}`;
      }
      const pdfUrl = `http://localhost:8081/pdf?path=${encodeURIComponent(pdfPath)}`;
      previewContainer.innerHTML = `<iframe class="library-pdf-viewer" src="${pdfUrl}" title="${escapeHtml(asset.name)}"></iframe>`;
    } else {
      // All other assets: use large thumbnail
      previewContainer.innerHTML = `<img id="library-modal-image" src="${thumbUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'">`;
    }

    // Show display name if set, otherwise use filename
    const assetMeta = getAssetMeta(asset.id);
    const displayName = assetMeta.displayName || asset.name;
    title.innerHTML = `<input type="text" id="library-modal-name-input" value="${escapeHtml(displayName)}" placeholder="${escapeHtml(asset.name)}" title="Click to edit display name">`;

    const metaParts = [];
    if (asset.ext) metaParts.push(asset.ext.toUpperCase());
    if (asset.width && asset.height) metaParts.push(`${asset.width} × ${asset.height}`);
    if (asset.dpi) metaParts.push(`${asset.dpi} DPI`);
    if (asset.size) metaParts.push(formatFileSize(asset.size));

    // Add project file indicator
    if (asset.projectFiles && asset.projectFiles.length > 0) {
      const projectTypes = asset.projectFiles.map(p => p.ext.toUpperCase()).join(', ');
      metaParts.push(`Source: ${projectTypes}`);
    }

    meta.innerHTML = metaParts.join(' · ');

    // Show project file badge if available
    if (asset.projectFiles && asset.projectFiles.length > 0) {
      meta.innerHTML += `<span class="library-project-badge" title="Has editable source file">Has source file</span>`;
    }

    // Cart/Job button state - check linked state if in addToJob mode
    const inJob = State.addToJobTarget
      ? State.linkedAssetsForJob.includes(asset.id)
      : isInCart(asset.id);
    cartBtn.classList.toggle('is-in-cart', inJob);
    cartBtn.innerHTML = inJob
      ? '<span class="icon">✓</span> In Job'
      : '<span class="icon">+</span> Add to Job';

    // Render tags
    renderModalTags(asset.id);

    // Populate notes
    const notesTextarea = document.getElementById('library-modal-notes');
    const notesStatus = document.getElementById('library-notes-status');
    if (notesTextarea) {
      notesTextarea.value = assetMeta.notes || '';
      notesStatus.textContent = '';
      notesStatus.className = 'library-notes-status';
    }

    // Update trash button state
    updateModalTrashButton(asset.id);

    // Bind display name input handler
    const nameInput = document.getElementById('library-modal-name-input');
    let nameDebounceTimer = null;
    nameInput?.addEventListener('input', () => {
      clearTimeout(nameDebounceTimer);
      nameDebounceTimer = setTimeout(async () => {
        const meta = getAssetMeta(asset.id);
        const newName = nameInput.value.trim();
        // Store empty string if same as original filename (to clear custom name)
        meta.displayName = (newName === asset.name) ? '' : newName;
        await saveAssetMeta(asset.id);
        renderGrid(); // Update card display
      }, 800);
    });

    // Show modal
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeAssetModal() {
    // Save any pending changes before closing
    if (State.currentAsset) {
      savePendingModalChanges(State.currentAsset.id);
    }

    const modal = document.getElementById('library-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Scroll to and highlight the next card at the position we were viewing
    if (State.lastViewedIndex !== undefined && State.lastViewedIndex >= 0) {
      // Re-render grid first (in case asset was trashed)
      renderGrid();

      // Find the card at or near that index
      const targetIndex = Math.min(State.lastViewedIndex, State.filteredAssets.length - 1);
      if (targetIndex >= 0) {
        const targetAsset = State.filteredAssets[targetIndex];
        if (targetAsset) {
          const card = document.querySelector(`.library-card[data-id="${targetAsset.id}"]`);
          if (card) {
            // Scroll into view
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Briefly highlight
            card.classList.add('is-highlighted');
            setTimeout(() => card.classList.remove('is-highlighted'), 1500);
          }
        }
      }
    }

    State.currentAsset = null;
  }

  /**
   * Save any pending modal changes (display name, notes) immediately
   * Called when modal is about to close to prevent data loss
   */
  function savePendingModalChanges(assetId) {
    const asset = State.assets.find(a => a.id === assetId);
    if (!asset) return;

    const meta = getAssetMeta(assetId);
    let hasChanges = false;

    // Check and save display name
    const nameInput = document.getElementById('library-modal-name-input');
    if (nameInput) {
      const newName = nameInput.value.trim();
      const expectedDisplayName = (newName === asset.name) ? '' : newName;
      if (meta.displayName !== expectedDisplayName) {
        meta.displayName = expectedDisplayName;
        hasChanges = true;
      }
    }

    // Check and save notes
    const notesTextarea = document.getElementById('library-modal-notes');
    if (notesTextarea) {
      const newNotes = notesTextarea.value;
      if (meta.notes !== newNotes) {
        meta.notes = newNotes;
        hasChanges = true;
      }
    }

    // Save if there were changes
    if (hasChanges) {
      console.log('[Library] Saving pending modal changes for:', assetId);
      saveAssetMeta(assetId);
      renderGrid(); // Update card display
    }
  }

  function renderModalTags(assetId) {
    const container = document.getElementById('library-modal-tags');
    const meta = State.assetMeta[assetId] || { products: [], tags: [], lob: '' };
    const assetProducts = meta.products;
    const assetTags = meta.tags;
    const assetLob = meta.lob || '';

    // Preserve current collapsed state of sections (default: tags open, others closed)
    const sectionState = {
      products: true,  // collapsed by default
      lob: true,       // collapsed by default
      tags: false      // open by default
    };
    container.querySelectorAll('.library-picker-section[data-section]').forEach(section => {
      const name = section.dataset.section;
      sectionState[name] = section.classList.contains('is-collapsed');
    });

    // Render product picker (from master list)
    const productListHtml = State.productList.length > 0
      ? State.productList.map(product => {
          const isActive = assetProducts.includes(product);
          return `
            <button type="button"
                    class="library-tag-toggle ${isActive ? 'is-active' : ''}"
                    data-product="${escapeHtml(product)}">
              ${escapeHtml(product)}
            </button>
          `;
        }).join('')
      : '<span class="library-empty-hint">No products defined</span>';

    // Render LOB picker (from master list - single select)
    const lobListHtml = State.lobList.length > 0
      ? State.lobList.map(lob => {
          const isActive = assetLob === lob;
          return `
            <button type="button"
                    class="library-tag-toggle ${isActive ? 'is-active' : ''}"
                    data-lob="${escapeHtml(lob)}">
              ${escapeHtml(lob)}
            </button>
          `;
        }).join('')
      : '<span class="library-empty-hint">No LOBs defined</span>';

    // Render tag picker (from taxonomy + user-created tags)
    const sortedTags = [...State.tagList].sort();
    const tagListHtml = sortedTags.length > 0
      ? sortedTags.map(tag => {
          const isActive = assetTags.includes(tag);
          return `
            <button type="button"
                    class="library-tag-toggle ${isActive ? 'is-active' : ''}"
                    data-tag="${escapeHtml(tag)}">
              ${escapeHtml(tag)}
            </button>
          `;
        }).join('')
      : '<span class="library-empty-hint">No tags defined</span>';

    container.innerHTML = `
      <div class="library-tag-picker">
        <div class="library-picker-section is-collapsible${sectionState.products ? ' is-collapsed' : ''}" data-section="products">
          <h4 class="library-picker-label" data-toggle="collapse">
            <span class="collapse-icon"></span>Products
          </h4>
          <div class="library-picker-content">
            <div class="library-tag-picker-list" id="library-product-picker">
              ${productListHtml}
            </div>
          </div>
        </div>

        <div class="library-picker-section is-collapsible${sectionState.lob ? ' is-collapsed' : ''}" data-section="lob">
          <h4 class="library-picker-label" data-toggle="collapse">
            <span class="collapse-icon"></span>LOB
          </h4>
          <div class="library-picker-content">
            <div class="library-tag-picker-list" id="library-lob-picker">
              ${lobListHtml}
            </div>
          </div>
        </div>

        <div class="library-picker-section is-collapsible${sectionState.tags ? ' is-collapsed' : ''}" data-section="tags">
          <h4 class="library-picker-label" data-toggle="collapse">
            <span class="collapse-icon"></span>Tags
          </h4>
          <div class="library-picker-content">
            <div class="library-tag-picker-list" id="library-tag-picker">
              ${tagListHtml}
            </div>
          </div>
        </div>

        <div class="library-tag-picker-add">
          <input type="text"
                 id="library-new-tag-input"
                 placeholder="Add new tag..."
                 autocomplete="off">
          <button type="button" id="library-add-tag-btn">Add</button>
        </div>
      </div>
    `;

    // Bind product picker clicks
    document.getElementById('library-product-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-product]');
      if (!btn) return;

      const product = btn.dataset.product;
      if (assetProducts.includes(product)) {
        removeProductFromAsset(assetId, product);
      } else {
        addProductToAsset(assetId, product);
      }
      renderModalTags(assetId);
      renderGrid();
    });

    // Bind LOB picker clicks (single select - clicking active deselects)
    document.getElementById('library-lob-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lob]');
      if (!btn) return;

      const lob = btn.dataset.lob;
      if (assetLob === lob) {
        setLobForAsset(assetId, ''); // Deselect
      } else {
        setLobForAsset(assetId, lob);
      }
      renderModalTags(assetId);
      renderGrid();
    });

    // Bind tag picker clicks
    document.getElementById('library-tag-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tag]');
      if (!btn) return;

      const tag = btn.dataset.tag;
      if (assetTags.includes(tag)) {
        removeTagFromAsset(assetId, tag);
      } else {
        addTagToAsset(assetId, tag);
      }
      renderModalTags(assetId);
      renderGrid();
    });

    // Bind events for the new tag input
    const input = document.getElementById('library-new-tag-input');
    const addBtn = document.getElementById('library-add-tag-btn');

    const addNewTag = () => {
      const newTag = normalizeTag(input.value);
      if (newTag && !assetTags.includes(newTag)) {
        addTagToAsset(assetId, newTag);
        input.value = '';
        renderModalTags(assetId);
        buildTagCloud();
        renderGrid();
      }
    };

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNewTag();
      }
    });

    addBtn?.addEventListener('click', addNewTag);

    // Bind collapsible section toggles
    container.querySelectorAll('.library-picker-label[data-toggle="collapse"]').forEach(label => {
      label.addEventListener('click', () => {
        const section = label.closest('.library-picker-section');
        if (section) {
          section.classList.toggle('is-collapsed');
        }
      });
    });
  }

  // =========================================
  // CART MODAL
  // =========================================

  function openCartModal() {
    renderCart();
    const modal = document.getElementById('library-cart-modal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeCartModal() {
    const modal = document.getElementById('library-cart-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function submitCartRequest() {
    const notes = document.getElementById('library-cart-notes')?.value || '';

    const cartAssets = State.cart
      .map(id => State.assets.find(a => a.id === id))
      .filter(Boolean);

    // Build request summary
    const summary = cartAssets.map(a => {
      const basePath = Config.basePath || '';
      return `- ${a.name}\n  Path: ${basePath}/${a.path}`;
    }).join('\n\n');

    const fullMessage = `Asset Request\n\nItems:\n${summary}\n\nNotes: ${notes || '(none)'}`;

    // For now, just copy to clipboard
    navigator.clipboard.writeText(fullMessage).then(() => {
      alert('Request copied to clipboard!\n\nPaste it in an email or message to request these assets.');
    }).catch(() => {
      // Fallback: show in a prompt
      prompt('Copy this request:', fullMessage);
    });
  }

  // =========================================
  // NEW FOLDER CREATION
  // =========================================

  function startNewFolderCreation(tile) {
    console.log('[NewFolder] Starting creation');
    // Transform the tile into editing mode
    tile.classList.add('is-editing');

    const nameEl = tile.querySelector('.library-folder-tile-name');
    const previewEl = tile.querySelector('.library-folder-tile-preview');
    if (!nameEl || !previewEl) return;

    // Hide the + icon
    previewEl.style.display = 'none';

    // Replace name with input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'library-folder-name-input';
    input.placeholder = 'Folder name';
    input.value = '';
    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    input.focus();

    let committed = false;

    const resetTile = () => {
      tile.classList.remove('is-editing');
      previewEl.style.display = '';
      nameEl.textContent = 'New Folder';
    };

    const commitCreation = async () => {
      if (committed) return;
      committed = true;

      const folderName = input.value.trim();
      console.log('[NewFolder] Committing:', folderName);

      if (!folderName) {
        console.log('[NewFolder] Empty name, cancelling');
        resetTile();
        return;
      }

      const source = State.browse.source;
      const basePath = State.browse.path.join('/');
      const fullPath = basePath ? `${basePath}/${folderName}` : folderName;

      // Create the folder by setting a display name (this registers it in the system)
      try {
        if (LibraryAPI.baseUrl) {
          await LibraryAPI.setFolderDisplayName(fullPath, source, folderName);
          console.log('[NewFolder] Created:', fullPath);
        }

        // Add to local state and re-render
        State.folderDisplayNames[`${source}:${fullPath}`] = folderName;

        // Add to manifest folders if not already there
        if (!State.folders.includes(fullPath)) {
          State.folders.push(fullPath);
        }

        showToast(`Folder "${folderName}" created`, 'success');
        renderBrowseView();
      } catch (err) {
        console.error('[NewFolder] Failed:', err);
        showToast(`Failed to create folder: ${err.message}`, 'error');
        resetTile();
      }
    };

    const cancelCreation = () => {
      if (committed) return;
      committed = true;
      resetTile();
    };

    // Handle Enter and Escape keys
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        commitCreation();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelCreation();
      }
    });

    // Handle blur (clicking away, tabbing, etc.)
    input.addEventListener('blur', () => {
      // Small delay to allow click events to fire first
      setTimeout(() => {
        if (committed) return;
        if (input.value.trim()) {
          commitCreation();
        } else {
          cancelCreation();
        }
      }, 100);
    });
  }

  // =========================================
  // EVENT HANDLING
  // =========================================

  function bindEvents() {
    // Mode toggle
    document.getElementById('library-mode-toggle')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.library-mode-btn');
      if (!btn || btn.classList.contains('is-active')) return;
      setMode(btn.dataset.mode);
    });

    // Source buttons (Browse mode)
    document.querySelectorAll('.library-source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectSource(btn.dataset.source);
      });
    });

    // Folder tiles (Browse mode) - delegated
    document.getElementById('library-folder-grid')?.addEventListener('click', (e) => {
      const tile = e.target.closest('.library-folder-tile');
      if (!tile) return;
      // Don't navigate if clicking on input (editing)
      if (e.target.tagName === 'INPUT') return;

      // Handle "New Folder" tile
      if (tile.dataset.action === 'new-folder') {
        startNewFolderCreation(tile);
        return;
      }

      const folderName = tile.dataset.folder;
      const newPath = [...State.browse.path, folderName];
      navigateToFolder(newPath);
    });

    // Folder rename (right-click / context menu)
    document.getElementById('library-folder-grid')?.addEventListener('contextmenu', (e) => {
      const tile = e.target.closest('.library-folder-tile');
      if (!tile) return;

      e.preventDefault();
      e.stopPropagation();

      const nameEl = tile.querySelector('.library-folder-tile-name');
      if (!nameEl) return;

      const folderName = tile.dataset.folder;
      const fullPath = tile.dataset.fullPath || folderName;
      const source = State.browse.source;

      // Get current display name
      const currentDisplayName = getFolderDisplayName(source, fullPath);

      // Replace name with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'library-folder-name-input';
      input.value = currentDisplayName;
      nameEl.innerHTML = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();

      let committed = false;
      const commitRename = () => {
        if (committed) return;
        committed = true;

        const newDisplayName = input.value.trim();
        // If empty or same as folder name, clear display name; if same as current, no change
        const effectiveDisplayName = (newDisplayName === folderName) ? '' : newDisplayName;

        if (newDisplayName === currentDisplayName) {
          nameEl.textContent = currentDisplayName;
          return;
        }

        // Optimistic update - immediately update UI
        const key = `${source}:${fullPath}`;
        if (effectiveDisplayName) {
          State.folderDisplayNames[key] = effectiveDisplayName;
        } else {
          delete State.folderDisplayNames[key];
        }
        renderBrowseView();

        // Save to API in background
        if (!LibraryAPI.baseUrl) {
          console.warn('[FolderRename] No API configured, changes will not persist');
          return;
        }

        console.log('[FolderRename] Saving:', { path: fullPath, source: source, displayName: effectiveDisplayName, key: key });
        LibraryAPI.setFolderDisplayName(fullPath, source, effectiveDisplayName)
          .then(result => {
            console.log('[FolderRename] Saved successfully:', result);
          })
          .catch(err => {
            console.error('[FolderRename] API error:', err);
            showToast(`Save failed: ${err.message}`, 'error');
            // Revert on failure
            if (currentDisplayName && currentDisplayName !== folderName) {
              State.folderDisplayNames[key] = currentDisplayName;
            } else {
              delete State.folderDisplayNames[key];
            }
            renderBrowseView();
          });
      };

      // Click anywhere outside input commits the change
      const handleClickOutside = (ev) => {
        if (!input.contains(ev.target)) {
          ev.preventDefault();
          ev.stopPropagation();
          document.removeEventListener('click', handleClickOutside, true);
          commitRename();
        }
      };
      // Use capture phase to intercept before other handlers
      setTimeout(() => document.addEventListener('click', handleClickOutside, true), 0);

      const cleanup = () => {
        document.removeEventListener('click', handleClickOutside, true);
      };

      input.addEventListener('blur', () => {
        cleanup();
        commitRename();
      });

      input.addEventListener('keydown', (ev) => {
        console.log('[FolderRename] keydown:', ev.key);
        if (ev.key === 'Enter') {
          console.log('[FolderRename] Enter pressed');
          ev.preventDefault();
          cleanup();
          commitRename();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          committed = true; // Prevent save
          cleanup();
          nameEl.textContent = currentDisplayName;
        }
      });
    });

    // Breadcrumb navigation
    document.getElementById('library-breadcrumbs')?.addEventListener('click', (e) => {
      const crumb = e.target.closest('.library-breadcrumb');
      if (!crumb || crumb.classList.contains('is-current')) return;

      if (crumb.classList.contains('is-root')) {
        // Go to library root (deselect source)
        State.browse.source = null;
        State.browse.path = [];
        document.querySelectorAll('.library-source').forEach(el => el.classList.remove('is-active'));
        renderBrowseWelcome();
        return;
      }

      const source = crumb.dataset.source;
      const path = crumb.dataset.path;

      if (source) {
        State.browse.source = source;
        State.browse.path = path ? path.split('/') : [];
        renderBrowseView();
      }
    });

    // Active filter pills (Tags mode) - remove filter
    document.getElementById('library-active-filter-pills')?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.library-filter-pill-remove');
      if (removeBtn) {
        const pill = removeBtn.closest('.library-filter-pill');
        const type = pill.dataset.type;
        const value = pill.dataset.value;

        if (type === 'product') {
          State.activeFilters.products = State.activeFilters.products.filter(p => p !== value);
          buildProductList();
        } else if (type === 'lob') {
          State.activeFilters.lob = null;
          buildLobList();
        } else if (type === 'tag') {
          State.activeFilters.tags = State.activeFilters.tags.filter(t => t !== value);
          buildTagCloud();
        } else if (type === 'filetype') {
          State.activeFilters.fileTypes = State.activeFilters.fileTypes.filter(f => f !== value);
          buildFileTypeList();
        }

        applyFilters();
        renderGrid();
        renderActiveFilters();
        return;
      }

      const clearAll = e.target.closest('.library-clear-all-filters');
      if (clearAll) {
        State.activeFilters.products = [];
        State.activeFilters.lob = null;
        State.activeFilters.tags = [];
        State.activeFilters.fileTypes = [];
        buildProductList();
        buildLobList();
        buildTagCloud();
        buildFileTypeList();
        applyFilters();
        renderGrid();
        renderActiveFilters();
      }
    });

    // Collection section headers (expand/collapse and filter)
    document.querySelectorAll('.library-collection-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.library-collection-section');
        const collection = section.dataset.collection;
        const wasExpanded = section.classList.contains('is-expanded');
        const wasActive = section.classList.contains('is-active');

        // Toggle expand
        section.classList.toggle('is-expanded');

        // If clicking an already-active section, toggle between that collection and all
        if (wasActive && wasExpanded) {
          // Collapse and show all
          document.querySelectorAll('.library-collection-section').forEach(s => {
            s.classList.remove('is-active');
          });
          State.collection = 'all';
          State.activeFilters.folder = null;
        } else {
          // Activate this collection
          document.querySelectorAll('.library-collection-section').forEach(s => {
            s.classList.remove('is-active');
          });
          section.classList.add('is-active');
          section.classList.add('is-expanded');
          State.collection = collection;
          State.activeFilters.folder = null;
        }

        updateFolderActiveState();
        applyFilters();
        renderGrid();
      });
    });

    // Search
    const searchInput = document.getElementById('library-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          State.activeFilters.search = searchInput.value;
          applyFilters();
          renderGrid();
        }, 200);
      });
    }

    // Collapsible sidebar sections
    document.querySelectorAll('.library-sidebar-section.is-collapsible .library-sidebar-subtitle').forEach(subtitle => {
      subtitle.addEventListener('click', () => {
        const section = subtitle.closest('.library-sidebar-section');
        section.classList.toggle('is-collapsed');
      });
    });

    // Product list clicks (sidebar filter)
    document.getElementById('library-product-list')?.addEventListener('click', (e) => {
      const productBtn = e.target.closest('.library-product');
      if (!productBtn) return;

      const product = productBtn.dataset.product;
      const idx = State.activeFilters.products.indexOf(product);

      if (idx === -1) {
        State.activeFilters.products.push(product);
      } else {
        State.activeFilters.products.splice(idx, 1);
      }

      buildProductList();
      applyFilters();
      renderGrid();
      renderActiveFilters();
    });

    // LOB list clicks (sidebar filter - single select)
    document.getElementById('library-lob-list')?.addEventListener('click', (e) => {
      const lobBtn = e.target.closest('[data-lob]');
      if (!lobBtn) return;

      const lob = lobBtn.dataset.lob;
      // Toggle: if same LOB, deselect; otherwise select
      State.activeFilters.lob = (State.activeFilters.lob === lob) ? null : lob;

      buildLobList();
      applyFilters();
      renderGrid();
      renderActiveFilters();
    });

    // Tag cloud clicks
    document.getElementById('library-tag-cloud')?.addEventListener('click', (e) => {
      const tagBtn = e.target.closest('.library-tag');
      if (!tagBtn) return;

      const tag = tagBtn.dataset.tag;
      const idx = State.activeFilters.tags.indexOf(tag);

      if (idx === -1) {
        State.activeFilters.tags.push(tag);
      } else {
        State.activeFilters.tags.splice(idx, 1);
      }

      buildTagCloud();
      applyFilters();
      renderGrid();
      renderActiveFilters();
    });

    // File type clicks
    document.getElementById('library-filetype-list')?.addEventListener('click', (e) => {
      const typeBtn = e.target.closest('.library-filetype');
      if (!typeBtn) return;

      const fileType = typeBtn.dataset.filetype;
      const idx = State.activeFilters.fileTypes.indexOf(fileType);

      if (idx === -1) {
        State.activeFilters.fileTypes.push(fileType);
      } else {
        State.activeFilters.fileTypes.splice(idx, 1);
      }

      buildFileTypeList();
      applyFilters();
      renderGrid();
      renderActiveFilters();
    });

    // Folder tree clicks (both stock and publications)
    ['stock-folder-tree', 'publications-folder-tree'].forEach(treeId => {
      document.getElementById(treeId)?.addEventListener('click', (e) => {
        const folderBtn = e.target.closest('.library-folder');
        if (!folderBtn) return;

        const folder = folderBtn.dataset.folder;
        const collection = folderBtn.dataset.collection;

        // Toggle folder filter
        if (State.activeFilters.folder === folder && State.collection === collection) {
          State.activeFilters.folder = null;
        } else {
          State.activeFilters.folder = folder;
          State.collection = collection;

          // Update collection section active state
          document.querySelectorAll('.library-collection-section').forEach(s => {
            s.classList.toggle('is-active', s.dataset.collection === collection);
          });
        }

        updateFolderActiveState();
        applyFilters();
        renderGrid();
      });
    });

    // Clear filters
    document.getElementById('library-clear-filters')?.addEventListener('click', () => {
      State.collection = 'all';
      State.activeFilters = {
        products: [],
        tags: [],
        fileTypes: [],
        folder: null,
        search: '',
        untaggedOnly: false,
        showTrashed: false
      };

      document.getElementById('library-search').value = '';
      document.getElementById('filter-untagged').checked = false;
      document.getElementById('filter-trashed').checked = false;

      document.querySelectorAll('.library-collection-section').forEach(s => {
        s.classList.remove('is-active');
      });

      buildProductList();
      buildTagCloud();
      buildFileTypeList();
      applyFilters();
      renderGrid();
      renderActiveFilters();
    });

    // Untagged filter
    document.getElementById('filter-untagged')?.addEventListener('change', (e) => {
      State.activeFilters.untaggedOnly = e.target.checked;
      applyFilters();
      renderGrid();
    });

    // Trash filter
    document.getElementById('filter-trashed')?.addEventListener('change', (e) => {
      State.activeFilters.showTrashed = e.target.checked;
      applyFilters();
      renderGrid();
    });

    // Grid clicks (card + select button)
    document.getElementById('library-grid')?.addEventListener('click', (e) => {
      // Select button for batch operations
      const selectBtn = e.target.closest('[data-action="select"]');
      if (selectBtn) {
        e.stopPropagation();
        const id = selectBtn.dataset.id;
        toggleAssetSelection(id);
        return;
      }

      const card = e.target.closest('.library-card');
      if (card) {
        openAssetModal(card.dataset.id);
      }
    });

    // Drag and drop for asset organization (Browse mode)
    const gridEl = document.getElementById('library-grid');
    if (gridEl) {
      gridEl.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.library-card');
        if (!card) return;

        State.draggedAssetId = card.dataset.id;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);

        // Add drag-active class to body for global styling
        document.body.classList.add('library-drag-active');
      });

      gridEl.addEventListener('dragend', (e) => {
        const card = e.target.closest('.library-card');
        if (card) card.classList.remove('is-dragging');

        State.draggedAssetId = null;
        document.body.classList.remove('library-drag-active');

        // Remove all drop targets
        document.querySelectorAll('.is-drop-target').forEach(el => {
          el.classList.remove('is-drop-target');
        });
      });
    }

    // Drop handlers for folder tiles (Browse mode)
    const folderGrid = document.getElementById('library-folder-grid');
    if (folderGrid) {
      folderGrid.addEventListener('dragover', (e) => {
        if (!State.draggedAssetId) return;
        const tile = e.target.closest('.library-folder-tile');
        if (!tile) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tile.classList.add('is-drop-target');
      });

      folderGrid.addEventListener('dragleave', (e) => {
        const tile = e.target.closest('.library-folder-tile');
        if (tile && !tile.contains(e.relatedTarget)) {
          tile.classList.remove('is-drop-target');
        }
      });

      folderGrid.addEventListener('drop', async (e) => {
        e.preventDefault();
        const tile = e.target.closest('.library-folder-tile');
        if (!tile || !State.draggedAssetId) return;

        tile.classList.remove('is-drop-target');

        const targetFolderName = tile.dataset.folder;
        const currentPath = State.browse.path.join('/');
        const targetPath = currentPath ? `${currentPath}/${targetFolderName}` : targetFolderName;

        // Get asset name for feedback
        const asset = State.assets.find(a => a.id === State.draggedAssetId);
        const assetName = asset ? asset.name : 'Asset';

        // Move asset to target folder
        await moveAssetToFolder(State.draggedAssetId, targetPath);

        showToast(`Moved "${assetName}" to ${targetFolderName}`, 'success');

        // Refresh the view
        renderBrowseView();
      });
    }

    // Drop handlers for breadcrumbs (navigate up and drop)
    const breadcrumbs = document.getElementById('library-breadcrumbs');
    if (breadcrumbs) {
      breadcrumbs.addEventListener('dragover', (e) => {
        if (!State.draggedAssetId) return;
        const crumb = e.target.closest('.library-breadcrumb');
        if (!crumb) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        crumb.classList.add('is-drop-target');
      });

      breadcrumbs.addEventListener('dragleave', (e) => {
        const crumb = e.target.closest('.library-breadcrumb');
        if (crumb && !crumb.contains(e.relatedTarget)) {
          crumb.classList.remove('is-drop-target');
        }
      });

      breadcrumbs.addEventListener('drop', async (e) => {
        e.preventDefault();
        const crumb = e.target.closest('.library-breadcrumb');
        if (!crumb || !State.draggedAssetId) return;

        crumb.classList.remove('is-drop-target');

        // Determine target path from breadcrumb
        let targetPath = '';
        let targetName = 'root';
        if (!crumb.classList.contains('is-root')) {
          targetPath = crumb.dataset.path || '';
          targetName = targetPath ? targetPath.split('/').pop() : crumb.textContent.trim();
        }

        // Get asset name for feedback
        const asset = State.assets.find(a => a.id === State.draggedAssetId);
        const assetName = asset ? asset.name : 'Asset';

        // Move asset to target folder
        await moveAssetToFolder(State.draggedAssetId, targetPath);

        showToast(`Moved "${assetName}" to ${targetName}`, 'success');

        // Refresh the view
        renderBrowseView();
      });
    }

    // Load more
    document.getElementById('library-load-more-btn')?.addEventListener('click', () => {
      State.page++;
      renderGrid();
    });

    // Cart trigger
    document.getElementById('library-cart-trigger')?.addEventListener('click', openCartModal);

    // Modal close buttons and backdrop
    document.querySelectorAll('[data-modal-close]').forEach(el => {
      el.addEventListener('click', () => {
        closeAssetModal();
        closeCartModal();
      });
    });

    // ESC to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAssetModal();
        closeCartModal();
      }
    });

    // Asset modal cart button - adds to job when in addToJob mode
    document.getElementById('library-modal-cart-btn')?.addEventListener('click', async () => {
      if (!State.currentAsset) return;
      const id = State.currentAsset.id;
      const btn = document.getElementById('library-modal-cart-btn');

      // If in addToJob mode, toggle link directly
      if (State.addToJobTarget) {
        const isLinked = State.linkedAssetsForJob.includes(id);

        if (isLinked) {
          // Unlink from job
          try {
            await LibraryAPI.unlinkAssetsFromJob([id], State.addToJobTarget.fullId);
            State.linkedAssetsForJob = State.linkedAssetsForJob.filter(x => x !== id);
            showToast('Removed from job', 'success');
          } catch (e) {
            showToast('Failed to remove: ' + e.message, 'error');
            return;
          }
        } else {
          // Link to job
          try {
            const userEmail = getCurrentUserEmail();
            await LibraryAPI.linkAssetsToJob([id], State.addToJobTarget.fullId, State.addToJobTarget.app, userEmail);
            State.linkedAssetsForJob.push(id);
            showToast('Added to job', 'success');
          } catch (e) {
            showToast('Failed to add: ' + e.message, 'error');
            return;
          }
        }

        // Update button state
        const nowLinked = State.linkedAssetsForJob.includes(id);
        btn.classList.toggle('is-in-cart', nowLinked);
        btn.innerHTML = nowLinked
          ? '<span class="icon">✓</span> In Job'
          : '<span class="icon">+</span> Add to Job';

        renderGrid();

        // Notify opener
        if (window.opener && typeof window.opener.refreshLinkedImages === 'function') {
          window.opener.refreshLinkedImages();
        }
        return;
      }

      // Regular cart mode
      if (isInCart(id)) {
        removeFromCart(id);
      } else {
        addToCart(id);
      }

      const inCart = isInCart(id);
      btn.classList.toggle('is-in-cart', inCart);
      btn.innerHTML = inCart
        ? '<span class="icon">✓</span> In Job'
        : '<span class="icon">+</span> Add to Job';

      renderGrid();
    });

    // Asset modal notes autosave
    const notesTextarea = document.getElementById('library-modal-notes');
    const notesStatus = document.getElementById('library-notes-status');
    let notesDebounceTimer = null;

    if (notesTextarea) {
      notesTextarea.addEventListener('input', () => {
        if (!State.currentAsset) return;

        // Capture asset ID now (in case modal closes before timeout fires)
        const assetId = State.currentAsset.id;

        // Show "typing" indicator
        notesStatus.textContent = '';
        notesStatus.className = 'library-notes-status';

        // Debounce save
        clearTimeout(notesDebounceTimer);
        notesDebounceTimer = setTimeout(async () => {
          // Modal may have closed - skip status updates but still save
          const modalOpen = State.currentAsset && State.currentAsset.id === assetId;

          const meta = getAssetMeta(assetId);
          meta.notes = notesTextarea.value;

          // Show saving status (only if modal still open for this asset)
          if (modalOpen) {
            notesStatus.textContent = 'Saving...';
            notesStatus.className = 'library-notes-status is-saving';
          }

          try {
            await saveAssetMeta(assetId);
            if (modalOpen) {
              notesStatus.textContent = 'Saved';
              notesStatus.className = 'library-notes-status is-saved';

              // Clear after a moment
              setTimeout(() => {
                if (notesStatus.textContent === 'Saved') {
                  notesStatus.textContent = '';
                  notesStatus.className = 'library-notes-status';
                }
              }, 2000);
            }
          } catch (e) {
            if (modalOpen) {
              notesStatus.textContent = 'Error saving';
              notesStatus.className = 'library-notes-status is-error';
            }
          }
        }, 800); // 800ms debounce
      });
    }

    // Asset modal reveal button
    document.getElementById('library-modal-reveal-btn')?.addEventListener('click', () => {
      if (!State.currentAsset) return;

      const asset = State.currentAsset;
      // Build full path based on collection
      let fullPath;
      if (asset.path.startsWith('library/')) {
        fullPath = `/Volumes/Today/Nordson/LIBRARY/${asset.path.slice(8)}`;
      } else if (asset.path.startsWith('publications/')) {
        fullPath = `/Volumes/Today/Nordson/PUBLICATIONS/${asset.path.slice(13)}`;
      } else {
        fullPath = `${Config.basePath || ''}/${asset.path}`;
      }

      // Call reveal server to open Finder
      fetch(`http://localhost:8081/reveal?path=${encodeURIComponent(fullPath)}`)
        .then(r => r.json())
        .then(data => {
          if (!data.success) {
            alert('Could not reveal file: ' + (data.error || 'Unknown error'));
          }
        })
        .catch(() => {
          // Fallback: copy path
          navigator.clipboard.writeText(fullPath).then(() => {
            alert(`Reveal server not running.\n\nPath copied: ${fullPath}\n\nRun: python3 reveal-server.py`);
          });
        });
    });

    // Asset modal trash button
    document.getElementById('library-modal-trash-btn')?.addEventListener('click', () => {
      if (!State.currentAsset) return;
      const id = State.currentAsset.id;
      const isTrashed = isAssetTrashed(id);

      if (isTrashed) {
        // Restore: stay in modal, update button
        restoreAsset(id);
        updateModalTrashButton(id);
        applyFilters();
        renderGrid();
      } else {
        // Trash: close modal and return to same position in grid
        trashAsset(id);
        applyFilters();
        closeAssetModal(); // This will scroll to lastViewedIndex position
      }
    });

    // Asset modal tag input
    const tagInput = document.getElementById('library-modal-tag-add');
    const tagSuggestions = document.getElementById('library-tag-suggestions');
    let highlightedSuggestion = -1;

    if (tagInput && tagSuggestions) {
      tagInput.addEventListener('input', () => {
        const query = tagInput.value.trim();
        const suggestions = getTagSuggestions(query);

        if (suggestions.length === 0 || !query) {
          tagSuggestions.classList.remove('is-open');
          return;
        }

        highlightedSuggestion = -1;
        tagSuggestions.innerHTML = suggestions.map(({ tag }, i) => `
          <div class="library-tag-suggestion" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</div>
        `).join('');
        tagSuggestions.classList.add('is-open');
      });

      tagInput.addEventListener('keydown', (e) => {
        const items = tagSuggestions.querySelectorAll('.library-tag-suggestion');

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightedSuggestion = Math.min(highlightedSuggestion + 1, items.length - 1);
          updateSuggestionHighlight(items, highlightedSuggestion);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightedSuggestion = Math.max(highlightedSuggestion - 1, -1);
          updateSuggestionHighlight(items, highlightedSuggestion);
        } else if (e.key === 'Enter') {
          e.preventDefault();

          let tag;
          if (highlightedSuggestion >= 0 && items[highlightedSuggestion]) {
            tag = items[highlightedSuggestion].dataset.tag;
          } else {
            tag = tagInput.value.trim();
          }

          if (tag && State.currentAsset) {
            if (addTagToAsset(State.currentAsset.id, tag)) {
              renderModalTags(State.currentAsset.id);
              renderGrid();
            }
            tagInput.value = '';
            tagSuggestions.classList.remove('is-open');
          }
        } else if (e.key === 'Escape') {
          tagSuggestions.classList.remove('is-open');
        }
      });

      tagInput.addEventListener('blur', () => {
        setTimeout(() => tagSuggestions.classList.remove('is-open'), 150);
      });

      tagSuggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.library-tag-suggestion');
        if (!item || !State.currentAsset) return;

        const tag = item.dataset.tag;
        if (addTagToAsset(State.currentAsset.id, tag)) {
          renderModalTags(State.currentAsset.id);
          renderGrid();
        }
        tagInput.value = '';
        tagSuggestions.classList.remove('is-open');
      });
    }

    // Cart body clicks (remove items)
    document.getElementById('library-cart-body')?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.library-cart-item-remove');
      if (!removeBtn) return;

      const id = removeBtn.dataset.id;
      removeFromCart(id);
      renderCart();
    });

    // Cart submit
    document.getElementById('library-cart-submit')?.addEventListener('click', submitCartRequest);

    // Prevent right-click on images
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.library-card-thumb, .library-modal-preview')) {
        e.preventDefault();
      }
    });
  }

  function updateSuggestionHighlight(items, idx) {
    items.forEach((item, i) => {
      item.classList.toggle('is-highlighted', i === idx);
    });
  }

  // =========================================
  // UTILITIES
  // =========================================

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function showToast(message, type = 'info') {
    // Remove existing toast
    const existing = document.querySelector('.library-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `library-toast is-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    // Auto-remove after 3s
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // =========================================
  // START
  // =========================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
