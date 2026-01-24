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
     * Update asset metadata (products, tags, notes)
     */
    async upsertAssetMeta(assetId, path, products, tags, notes) {
      const params = {
        asset_id: assetId,
        path: path || '',
        products: Array.isArray(products) ? products.join(',') : (products || ''),
        tags: Array.isArray(tags) ? tags.join(',') : (tags || '')
      };
      if (notes !== undefined) {
        params.notes = notes;
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
    draggedAssetId: null  // For drag-drop folder management
  };

  const Config = window.LIBRARY_CONFIG || {};

  // =========================================
  // INITIALIZATION
  // =========================================

  async function init() {
    console.log('[Library] Initializing...');

    // Configure API URL
    if (Config.libraryApiUrl) {
      LibraryAPI.baseUrl = Config.libraryApiUrl;
      console.log('[Library] API configured:', Config.libraryApiUrl);
    } else {
      console.warn('[Library] No API URL configured, using localStorage fallback');
    }

    // Load saved state from localStorage (cart only now)
    loadLocalState();

    // Bind event listeners
    bindEvents();

    // Load manifest
    await loadManifest();

    // Load taxonomy and asset metadata from API (with localStorage fallback)
    await loadTaxonomyAndMeta();

    // Auto-detect products from filenames/folders
    autoTagAssets();

    // Build initial view
    buildProductList();
    buildTagCloud();
    buildFileTypeList();
    updateSourceCounts();

    // Set initial mode
    setMode('browse');

    updateCartCount();
    updateTrashCount();

    console.log('[Library] Ready. Assets:', State.assets.length);
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

    // Get first N assets with thumbnails
    return assets.slice(0, count).map(a => getThumbUrl(a));
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
        html += `<span class="library-breadcrumb-sep">›</span>`;
        html += `<span class="library-breadcrumb${isLast ? ' is-current' : ''}" data-source="${source}" data-path="${pathToHere}">${segment}</span>`;
      });
    }

    container.innerHTML = html;
  }

  function renderFolderTiles(folders) {
    const container = document.getElementById('library-folder-grid');
    if (!container) return;

    if (folders.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = folders.map(folder => {
      // Filter to only valid preview URLs
      const validPreviews = folder.previews.filter(url => url);
      const count = validPreviews.length;

      // Dynamic layout class based on image count
      let layoutClass = 'layout-empty';
      let previewHtml = '';

      if (count === 0) {
        layoutClass = 'layout-empty';
        previewHtml = '<div class="empty-slot"></div>';
      } else if (count === 1) {
        layoutClass = 'layout-single';
        previewHtml = `<img src="${validPreviews[0]}" alt="" loading="lazy">`;
      } else if (count === 2) {
        layoutClass = 'layout-duo';
        previewHtml = validPreviews.slice(0, 2).map(url =>
          `<img src="${url}" alt="" loading="lazy">`
        ).join('');
      } else if (count === 3) {
        layoutClass = 'layout-trio';
        previewHtml = validPreviews.slice(0, 3).map(url =>
          `<img src="${url}" alt="" loading="lazy">`
        ).join('');
      } else {
        layoutClass = 'layout-quad';
        previewHtml = validPreviews.slice(0, 4).map(url =>
          `<img src="${url}" alt="" loading="lazy">`
        ).join('');
      }

      return `
        <div class="library-folder-tile" data-folder="${escapeHtml(folder.name)}">
          <div class="library-folder-tile-preview ${layoutClass}">
            ${previewHtml}
          </div>
          <div class="library-folder-tile-info">
            <div class="library-folder-tile-name">${escapeHtml(folder.name)}</div>
            <div class="library-folder-tile-count">${folder.count} items</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderActiveFilters() {
    const container = document.getElementById('library-active-filter-pills');
    if (!container) return;

    const pills = [];

    State.activeFilters.products.forEach(p => {
      pills.push(`<span class="library-filter-pill" data-type="product" data-value="${escapeHtml(p)}">${escapeHtml(p)}<button class="library-filter-pill-remove">×</button></span>`);
    });

    State.activeFilters.tags.forEach(t => {
      pills.push(`<span class="library-filter-pill" data-type="tag" data-value="${escapeHtml(t)}">${escapeHtml(t)}<button class="library-filter-pill-remove">×</button></span>`);
    });

    State.activeFilters.fileTypes.forEach(ft => {
      pills.push(`<span class="library-filter-pill" data-type="filetype" data-value="${escapeHtml(ft)}">${escapeHtml(ft.toUpperCase())}<button class="library-filter-pill-remove">×</button></span>`);
    });

    if (pills.length === 0) {
      container.innerHTML = '<span class="library-no-filters">All assets</span>';
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

    // Try API first
    if (LibraryAPI.baseUrl) {
      try {
        await LibraryAPI.upsertAssetMeta(assetId, path, meta.products, meta.tags, meta.notes);
        console.log('[Library] Saved asset meta to API:', assetId);
        return;
      } catch (e) {
        console.warn('[Library] API save failed, falling back to localStorage:', e.message);
      }
    }

    // Fallback to localStorage
    try {
      localStorage.setItem('library-asset-meta', JSON.stringify(State.assetMeta));
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
    // Try loading from API first
    if (LibraryAPI.baseUrl) {
      try {
        // Load taxonomy (products, tags, LOBs) from API
        const taxonomy = await LibraryAPI.listTaxonomy();
        if (taxonomy) {
          State.productList = taxonomy.products?.map(p => p.name) || [];
          State.tagList = taxonomy.tags || [];
          State.lobList = taxonomy.lobs || [];
          State.taxonomyMap = {}; // product name -> { tags, lob }
          (taxonomy.products || []).forEach(p => {
            State.taxonomyMap[p.name] = { tags: p.tags, lob: p.lob };
          });
          console.log('[Library] Loaded taxonomy from API:', State.productList.length, 'products');
        }

        // Load asset metadata from API
        const metaResult = await LibraryAPI.listAssetsMeta(true);
        if (metaResult && metaResult.assets) {
          State.assetMeta = {};
          metaResult.assets.forEach(a => {
            State.assetMeta[a.asset_id] = {
              products: a.products || [],
              tags: a.tags || [],
              notes: a.notes || '',
              virtualFolder: a.virtual_folder || null,
              trashed: !!a.trashed_at,
              trashedAt: a.trashed_at || '',
              trashedBy: a.trashed_by || ''
            };
          });
          console.log('[Library] Loaded asset metadata from API:', metaResult.count, 'assets');

          // Cache to localStorage for offline use
          try {
            localStorage.setItem('library-asset-meta', JSON.stringify(State.assetMeta));
          } catch (e) {
            console.warn('[Library] Could not cache to localStorage:', e);
          }
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
      State.assetMeta[assetId] = { products: [], tags: [], notes: '', virtualFolder: null };
    }
    return State.assetMeta[assetId];
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
    const el = document.getElementById('library-trash-count');
    if (el) {
      el.textContent = count > 0 ? count : '';
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
    const inCart = isInCart(asset.id);
    const ext = (asset.ext || '').toLowerCase();
    const extLabel = ext.toUpperCase();
    const isPdf = ext === 'pdf';
    const hasSourceFile = asset.projectFiles && asset.projectFiles.length > 0;

    // Show products on card (primary label)
    const productsHtml = meta.products.length > 0
      ? meta.products.slice(0, 3).map(p => `<span class="library-card-product">${escapeHtml(p)}</span>`).join('')
      : '<span class="library-card-product is-untagged">untagged</span>';

    // Use thumbnails for all types (actual files not hosted on GitHub Pages)
    const placeholder = getPlaceholderForType(ext);
    const thumbContent = `<img src="${getThumbUrl(asset)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${placeholder}'">`;

    // Gold seal for assets with source files
    const sourceSealHtml = hasSourceFile
      ? `<span class="library-card-source-seal" title="Has editable source file (${asset.projectFiles.map(p => p.ext.toUpperCase()).join(', ')})"></span>`
      : '';

    return `
      <article class="library-card ${inCart ? 'is-in-cart' : ''} ${isPdf ? 'is-pdf' : ''}" data-id="${escapeHtml(asset.id)}" draggable="true">
        <div class="library-card-thumb">
          ${thumbContent}
          ${extLabel ? `<span class="library-card-type">${extLabel}</span>` : ''}
          ${sourceSealHtml}
          <button type="button"
                  class="library-card-cart-btn"
                  data-action="cart"
                  data-id="${escapeHtml(asset.id)}"
                  title="${inCart ? 'Remove from cart' : 'Add to cart'}">
            ${inCart ? '✓' : '+'}
          </button>
        </div>
        <div class="library-card-products">${productsHtml}</div>
      </article>
    `;
  }

  function getAssetUrl(asset) {
    return `assets/${asset.path}`;
  }

  // File types that browsers can display directly
  const WEB_DISPLAYABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp']);

  function getThumbUrl(asset) {
    // Use pre-generated thumbnail if available
    if (asset.thumbUrl) {
      return asset.thumbUrl;
    }

    const ext = asset.ext.toLowerCase();

    // Check for WebP thumbnail by asset ID (PSD, AI, EPS)
    if (ext === 'psd' || ext === 'ai' || ext === 'eps') {
      return `thumbs/${asset.id}.webp`;
    }

    // Web-displayable images: use the file directly
    if (WEB_DISPLAYABLE.has(ext)) {
      return `assets/${asset.path}`;
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

    const modal = document.getElementById('library-modal');
    const previewContainer = document.querySelector('.library-modal-preview');
    const title = document.getElementById('library-modal-title');
    const meta = document.getElementById('library-modal-meta');
    const cartBtn = document.getElementById('library-modal-cart-btn');

    const ext = (asset.ext || '').toLowerCase();
    const isPdf = ext === 'pdf';
    const assetUrl = getAssetUrl(asset);

    // Set preview content - use thumbnail for all types (actual files not hosted on GitHub Pages)
    const placeholder = getPlaceholderForType(ext);
    const thumbUrl = getThumbUrl(asset);
    previewContainer.innerHTML = `<img id="library-modal-image" src="${thumbUrl}" alt="" onerror="this.onerror=null;this.src='${placeholder}'">`;

    title.textContent = asset.name;

    const metaParts = [];
    if (asset.folder) metaParts.push(asset.folder);
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

    // Cart button state
    const inCart = isInCart(asset.id);
    cartBtn.classList.toggle('is-in-cart', inCart);
    cartBtn.innerHTML = inCart
      ? '<span class="icon">✓</span> In Cart'
      : '<span class="icon">+</span> Add to Cart';

    // Render tags
    renderModalTags(asset.id);

    // Populate notes
    const notesTextarea = document.getElementById('library-modal-notes');
    const notesStatus = document.getElementById('library-notes-status');
    const assetMeta = getAssetMeta(asset.id);
    if (notesTextarea) {
      notesTextarea.value = assetMeta.notes || '';
      notesStatus.textContent = '';
      notesStatus.className = 'library-notes-status';
    }

    // Update trash button state
    updateModalTrashButton(asset.id);

    // Show modal
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeAssetModal() {
    const modal = document.getElementById('library-modal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    State.currentAsset = null;
  }

  function renderModalTags(assetId) {
    const container = document.getElementById('library-modal-tags');
    const meta = State.assetMeta[assetId] || { products: [], tags: [] };
    const assetProducts = meta.products;
    const assetTags = meta.tags;

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

    // Render tag picker (from master list + any used)
    const allTags = new Set([...State.tagList]);
    Object.values(State.assetMeta).forEach(m => {
      (m.tags || []).forEach(t => allTags.add(t));
    });

    const sortedTags = [...allTags].sort();
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
        <h4 class="library-picker-label">Products</h4>
        <div class="library-tag-picker-list" id="library-product-picker">
          ${productListHtml}
        </div>

        <h4 class="library-picker-label">Tags</h4>
        <div class="library-tag-picker-list" id="library-tag-picker">
          ${tagListHtml}
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

      const folderName = tile.dataset.folder;
      const newPath = [...State.browse.path, folderName];
      navigateToFolder(newPath);
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
        State.activeFilters.tags = [];
        State.activeFilters.fileTypes = [];
        buildProductList();
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

    // Sort
    const sortSelect = document.getElementById('library-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        State.sort = sortSelect.value;
        applyFilters();
        renderGrid();
      });
    }

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

    // Grid clicks (card + cart button)
    document.getElementById('library-grid')?.addEventListener('click', (e) => {
      const cartBtn = e.target.closest('[data-action="cart"]');
      if (cartBtn) {
        e.stopPropagation();
        const id = cartBtn.dataset.id;
        if (isInCart(id)) {
          removeFromCart(id);
        } else {
          addToCart(id);
        }
        renderGrid();
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

    // Asset modal cart button
    document.getElementById('library-modal-cart-btn')?.addEventListener('click', () => {
      if (!State.currentAsset) return;
      const id = State.currentAsset.id;

      if (isInCart(id)) {
        removeFromCart(id);
      } else {
        addToCart(id);
      }

      const btn = document.getElementById('library-modal-cart-btn');
      const inCart = isInCart(id);
      btn.classList.toggle('is-in-cart', inCart);
      btn.innerHTML = inCart
        ? '<span class="icon">✓</span> In Cart'
        : '<span class="icon">+</span> Add to Cart';

      renderGrid();
    });

    // Asset modal notes autosave
    const notesTextarea = document.getElementById('library-modal-notes');
    const notesStatus = document.getElementById('library-notes-status');
    let notesDebounceTimer = null;

    if (notesTextarea) {
      notesTextarea.addEventListener('input', () => {
        if (!State.currentAsset) return;

        // Show "typing" indicator
        notesStatus.textContent = '';
        notesStatus.className = 'library-notes-status';

        // Debounce save
        clearTimeout(notesDebounceTimer);
        notesDebounceTimer = setTimeout(async () => {
          const assetId = State.currentAsset.id;
          const meta = getAssetMeta(assetId);
          meta.notes = notesTextarea.value;

          // Show saving status
          notesStatus.textContent = 'Saving...';
          notesStatus.className = 'library-notes-status is-saving';

          try {
            await saveAssetMeta(assetId);
            notesStatus.textContent = 'Saved';
            notesStatus.className = 'library-notes-status is-saved';

            // Clear after a moment
            setTimeout(() => {
              if (notesStatus.textContent === 'Saved') {
                notesStatus.textContent = '';
                notesStatus.className = 'library-notes-status';
              }
            }, 2000);
          } catch (e) {
            notesStatus.textContent = 'Error saving';
            notesStatus.className = 'library-notes-status is-error';
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
        restoreAsset(id);
      } else {
        trashAsset(id);
      }

      // Update button state
      updateModalTrashButton(id);
      applyFilters();
      renderGrid();
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
