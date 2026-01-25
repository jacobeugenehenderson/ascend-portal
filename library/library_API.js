/**
 * Library Tags Master API v1.1
 * Google Apps Script for managing Library asset metadata.
 *
 * Sheet: Tags Master (1ZtR9Jv64Jogrvx77drQGNosCo0-sjDMTulC_Q__TpQQ)
 *
 * Required Tabs:
 *  - TAXONOMY (headers: Name, Tags, LOB)
 *  - ASSETS   (headers: AssetId, Path, Products, Tags, LOB, Notes, VirtualFolder, TrashedAt, TrashedBy, UpdatedAt)
 *
 * Deploy as Web App:
 *  - Execute as: Me
 *  - Who has access: Anyone (JSONP style)
 *
 * Endpoints (GET):
 *  ?action=ping
 *  ?action=listTaxonomy&callback=cb
 *  ?action=getAssetMeta&asset_id=xxx&callback=cb
 *  ?action=listAssetsMeta&callback=cb
 *  ?action=listTrashedAssets&callback=cb
 *
 * Endpoints (GET/POST):
 *  ?action=upsertAssetMeta&asset_id=xxx&path=xxx&products=a,b&tags=x,y&notes=...&callback=cb
 *  ?action=trashAsset&asset_id=xxx&user_email=xxx&callback=cb
 *  ?action=restoreAsset&asset_id=xxx&callback=cb
 *  ?action=batchUpsertAssets (POST only, JSON body)
 *  ?action=moveAsset&asset_id=xxx&virtual_folder=xxx&callback=cb
 *  ?action=batchMoveAssets (POST only, JSON body: { asset_ids: [], virtual_folder: '' })
 *  ?action=renameFolder&old_path=xxx&new_path=xxx&source=xxx&callback=cb
 *  ?action=deleteFolder&path=xxx&source=xxx&user_email=xxx&callback=cb
 *  ?action=setFolderDisplayName&path=xxx&source=xxx&display_name=xxx&callback=cb
 *  ?action=listFolderDisplayNames&callback=cb
 */

/** =========================
 * CONFIG
 * ======================= */
const TAGS_MASTER_SPREADSHEET_ID = '1ZtR9Jv64Jogrvx77drQGNosCo0-sjDMTulC_Q__TpQQ';
const TAXONOMY_SHEET_NAME = 'Tags';
const ASSETS_SHEET_NAME = 'ASSETS';
const FOLDERS_SHEET_NAME = 'FOLDERS';
const ASSET_JOBS_SHEET_NAME = 'ASSET_JOBS';

const LIBRARY_API_VERSION = 'library_v1.3_2026-01-25_asset_jobs';

const LIBRARY_ADMIN_EMAILS = [
  'jacob@jacobhenderson.studio',
  'jacobhenderson@gmail.com'
];

/** =========================
 * ENTRYPOINT
 * ======================= */
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = String(p.action || '').trim();
  const callback = String(p.callback || '').trim();

  try {
    if (!action) throw new Error('Missing action');

    let data;
    switch (action) {
      case 'ping':
        data = { ok: true, version: LIBRARY_API_VERSION };
        break;

      case 'listTaxonomy':
        data = listTaxonomy_();
        break;

      case 'getAssetMeta':
        data = getAssetMeta_(p);
        break;

      case 'listAssetsMeta':
        data = listAssetsMeta_(p);
        break;

      case 'upsertAssetMeta':
        data = upsertAssetMeta_(p);
        break;

      case 'trashAsset':
        data = trashAsset_(p);
        break;

      case 'restoreAsset':
        data = restoreAsset_(p);
        break;

      case 'listTrashedAssets':
        data = listTrashedAssets_(p);
        break;

      case 'moveAsset':
        data = moveAsset_(p);
        break;

      case 'renameFolder':
        data = renameFolder_(p);
        break;

      case 'deleteFolder':
        data = deleteFolder_(p);
        break;

      case 'setFolderDisplayName':
        data = setFolderDisplayName_(p);
        break;

      case 'listFolderDisplayNames':
        data = listFolderDisplayNames_();
        break;

      case 'linkAssetsToJob':
        data = linkAssetsToJob_(p);
        break;

      case 'unlinkAssetsFromJob':
        data = unlinkAssetsFromJob_(p);
        break;

      case 'listLinkedJobs':
        data = listLinkedJobs_(p);
        break;

      case 'listJobAssets':
        data = listJobAssets_(p);
        break;

      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonp_(callback, { ok: true, action, data });
  } catch (err) {
    return jsonp_(callback, {
      ok: false,
      action: action || null,
      error: String(err && err.message ? err.message : err),
      version: LIBRARY_API_VERSION
    });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    const body = raw ? JSON.parse(raw) : {};
    const action = String(body.action || '').trim();
    if (!action) throw new Error('Missing action');

    let data;
    switch (action) {
      case 'upsertAssetMeta':
        data = upsertAssetMeta_(body);
        break;

      case 'batchUpsertAssets':
        data = batchUpsertAssets_(body);
        break;

      case 'trashAsset':
        data = trashAsset_(body);
        break;

      case 'restoreAsset':
        data = restoreAsset_(body);
        break;

      case 'moveAsset':
        data = moveAsset_(body);
        break;

      case 'batchMoveAssets':
        data = batchMoveAssets_(body);
        break;

      case 'renameFolder':
        data = renameFolder_(body);
        break;

      case 'deleteFolder':
        data = deleteFolder_(body);
        break;

      case 'linkAssetsToJob':
        data = linkAssetsToJob_(body);
        break;

      case 'unlinkAssetsFromJob':
        data = unlinkAssetsFromJob_(body);
        break;

      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonp_('', { ok: true, action, data });
  } catch (err) {
    return jsonp_('', {
      ok: false,
      action: null,
      error: String(err && err.message ? err.message : err),
      version: LIBRARY_API_VERSION
    });
  }
}

/** =========================
 * SETUP - Run once to create ASSETS tab
 * ======================= */
function setupAssetsTab() {
  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  let sh = ss.getSheetByName(ASSETS_SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(ASSETS_SHEET_NAME);
    sh.getRange(1, 1, 1, 9).setValues([[
      'AssetId', 'Path', 'Products', 'Tags', 'Notes', 'VirtualFolder', 'TrashedAt', 'TrashedBy', 'UpdatedAt'
    ]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold');
    Logger.log('Created ASSETS tab with headers');
  } else {
    Logger.log('ASSETS tab already exists');
  }
}

/** =========================
 * ACTIONS
 * ======================= */

/**
 * listTaxonomy
 * Returns all products with their tags and LOB from TAXONOMY tab.
 */
function listTaxonomy_() {
  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ss.getSheetByName(TAXONOMY_SHEET_NAME);
  if (!sh) throw new Error('TAXONOMY sheet not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { products: [], tags: [], lobs: [] };

  // Read all three columns independently (they are separate lists, not related rows)
  const data = sh.getRange(2, 1, lastRow - 1, 3).getValues();

  const products = [];
  const tags = [];
  const lobs = [];

  for (let i = 0; i < data.length; i++) {
    const productName = String(data[i][0] || '').trim();
    const tagName = String(data[i][1] || '').trim();
    const lobName = String(data[i][2] || '').trim();

    // Column A: Products (just names, no associated tags/lob)
    if (productName) {
      products.push({ name: productName, tags: [], lob: '' });
    }

    // Column B: Tags (independent list)
    if (tagName) {
      tags.push(tagName);
    }

    // Column C: LOBs (independent list)
    if (lobName) {
      lobs.push(lobName);
    }
  }

  return {
    products: products,
    tags: tags.sort(),
    lobs: lobs.sort()
  };
}

/**
 * getAssetMeta
 * Get metadata for a single asset by ID.
 */
function getAssetMeta_(p) {
  const assetId = String(p.asset_id || '').trim();
  if (!assetId) throw new Error('Missing asset_id');

  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ensureAssetsSheet_(ss);
  const header = getHeaderMap_(sh);

  const row = findAssetRow_(sh, header, assetId);
  if (row === -1) {
    return { found: false, asset_id: assetId };
  }

  const obj = readRowByHeader_(sh, header, row);
  return {
    found: true,
    asset_id: assetId,
    path: obj.Path || '',
    products: parseList_(obj.Products),
    tags: parseList_(obj.Tags),
    notes: obj.Notes || '',
    virtual_folder: obj.VirtualFolder || '',
    trashed_at: obj.TrashedAt || '',
    trashed_by: obj.TrashedBy || '',
    updated_at: obj.UpdatedAt || ''
  };
}

/**
 * listAssetsMeta
 * Get metadata for all assets (optionally filtered).
 */
function listAssetsMeta_(p) {
  const includeTrashed = toBool_(String(p.include_trashed || 'false'));

  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ensureAssetsSheet_(ss);
  const header = getHeaderMap_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { assets: [], count: 0 };

  const lastCol = sh.getLastColumn();
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const assets = [];
  for (let i = 0; i < values.length; i++) {
    const obj = rowToObj_(values[i], header);
    const trashedAt = String(obj.TrashedAt || '').trim();

    if (trashedAt && !includeTrashed) continue;

    assets.push({
      asset_id: obj.AssetId || '',
      path: obj.Path || '',
      products: parseList_(obj.Products),
      tags: parseList_(obj.Tags),
      lob: obj.LOB || '',
      notes: obj.Notes || '',
      display_name: obj.DisplayName || '',
      virtual_folder: obj.VirtualFolder || '',
      trashed_at: trashedAt,
      trashed_by: obj.TrashedBy || '',
      updated_at: obj.UpdatedAt || ''
    });
  }

  return { assets: assets, count: assets.length };
}

/**
 * upsertAssetMeta
 * Create or update metadata for an asset.
 */
function upsertAssetMeta_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const assetId = String(p.asset_id || '').trim();
    if (!assetId) throw new Error('Missing asset_id');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const nowIso = new Date().toISOString();

    const products = p.products !== undefined ? normalizeList_(p.products) : null;
    const tags = p.tags !== undefined ? normalizeList_(p.tags) : null;
    const lob = p.lob !== undefined ? String(p.lob || '') : null;
    const notes = p.notes !== undefined ? String(p.notes || '') : null;
    const displayName = p.display_name !== undefined ? String(p.display_name || '') : null;
    const virtualFolder = p.virtual_folder !== undefined ? String(p.virtual_folder || '') : null;

    const existingRow = findAssetRow_(sh, header, assetId);

    if (existingRow === -1) {
      // Insert new row
      const newRow = sh.getLastRow() + 1;
      const rowObj = {
        AssetId: assetId,
        Path: String(p.path || '').trim(),
        Products: products !== null ? products.join(',') : '',
        Tags: tags !== null ? tags.join(',') : '',
        LOB: lob !== null ? lob : '',
        Notes: notes !== null ? notes : '',
        DisplayName: displayName !== null ? displayName : '',
        VirtualFolder: virtualFolder !== null ? virtualFolder : '',
        TrashedAt: '',
        TrashedBy: '',
        UpdatedAt: nowIso
      };
      writeRowByHeader_(sh, header, newRow, rowObj);
      return { upsert: 'insert', asset_id: assetId, row: newRow };
    } else {
      // Update existing row
      const existing = readRowByHeader_(sh, header, existingRow);

      const rowObj = {
        AssetId: assetId,
        Path: p.path !== undefined ? String(p.path).trim() : (existing.Path || ''),
        Products: products !== null ? products.join(',') : (existing.Products || ''),
        Tags: tags !== null ? tags.join(',') : (existing.Tags || ''),
        LOB: lob !== null ? lob : (existing.LOB || ''),
        Notes: notes !== null ? notes : (existing.Notes || ''),
        DisplayName: displayName !== null ? displayName : (existing.DisplayName || ''),
        VirtualFolder: virtualFolder !== null ? virtualFolder : (existing.VirtualFolder || ''),
        TrashedAt: existing.TrashedAt || '',
        TrashedBy: existing.TrashedBy || '',
        UpdatedAt: nowIso
      };
      writeRowByHeader_(sh, header, existingRow, rowObj);
      return { upsert: 'update', asset_id: assetId, row: existingRow };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * batchUpsertAssets
 * Bulk upsert multiple assets (POST only).
 * Body: { assets: [{ asset_id, path, products, tags }, ...] }
 */
function batchUpsertAssets_(body) {
  const assets = body.assets;
  if (!Array.isArray(assets)) throw new Error('Missing assets array');

  const results = [];
  for (let i = 0; i < assets.length; i++) {
    try {
      const r = upsertAssetMeta_(assets[i]);
      results.push({ asset_id: assets[i].asset_id, ok: true, result: r });
    } catch (e) {
      results.push({ asset_id: assets[i].asset_id, ok: false, error: String(e.message || e) });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  return { processed: results.length, success: successCount, results: results };
}

/**
 * trashAsset
 * Soft-delete an asset by setting TrashedAt timestamp.
 */
function trashAsset_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const assetId = String(p.asset_id || '').trim();
    const userEmail = String(p.user_email || '').toLowerCase().trim();
    if (!assetId) throw new Error('Missing asset_id');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const nowIso = new Date().toISOString();
    const existingRow = findAssetRow_(sh, header, assetId);

    if (existingRow === -1) {
      // Create minimal entry for the trashed asset
      const newRow = sh.getLastRow() + 1;
      const rowObj = {
        AssetId: assetId,
        Path: String(p.path || '').trim(),
        Products: '',
        Tags: '',
        TrashedAt: nowIso,
        TrashedBy: userEmail,
        UpdatedAt: nowIso
      };
      writeRowByHeader_(sh, header, newRow, rowObj);
      return { action: 'trash', asset_id: assetId, trashed_at: nowIso, created: true };
    } else {
      // Update existing row
      sh.getRange(existingRow, header['TrashedAt']).setValue(nowIso);
      sh.getRange(existingRow, header['TrashedBy']).setValue(userEmail);
      sh.getRange(existingRow, header['UpdatedAt']).setValue(nowIso);
      return { action: 'trash', asset_id: assetId, trashed_at: nowIso, created: false };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * restoreAsset
 * Restore a trashed asset by clearing TrashedAt.
 */
function restoreAsset_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const assetId = String(p.asset_id || '').trim();
    if (!assetId) throw new Error('Missing asset_id');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const existingRow = findAssetRow_(sh, header, assetId);
    if (existingRow === -1) {
      return { ok: false, error: 'Asset not found', asset_id: assetId };
    }

    const nowIso = new Date().toISOString();
    sh.getRange(existingRow, header['TrashedAt']).setValue('');
    sh.getRange(existingRow, header['TrashedBy']).setValue('');
    sh.getRange(existingRow, header['UpdatedAt']).setValue(nowIso);

    return { action: 'restore', asset_id: assetId, restored_at: nowIso };
  } finally {
    lock.releaseLock();
  }
}

/**
 * listTrashedAssets
 * Get all trashed assets.
 */
function listTrashedAssets_(p) {
  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ensureAssetsSheet_(ss);
  const header = getHeaderMap_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { assets: [], count: 0 };

  const lastCol = sh.getLastColumn();
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const assets = [];
  for (let i = 0; i < values.length; i++) {
    const obj = rowToObj_(values[i], header);
    const trashedAt = String(obj.TrashedAt || '').trim();

    if (!trashedAt) continue;

    assets.push({
      asset_id: obj.AssetId || '',
      path: obj.Path || '',
      products: parseList_(obj.Products),
      tags: parseList_(obj.Tags),
      notes: obj.Notes || '',
      trashed_at: trashedAt,
      trashed_by: obj.TrashedBy || '',
      updated_at: obj.UpdatedAt || ''
    });
  }

  // Sort by trashed_at descending
  assets.sort((a, b) => {
    const at = Date.parse(a.trashed_at) || 0;
    const bt = Date.parse(b.trashed_at) || 0;
    return bt - at;
  });

  return { assets: assets, count: assets.length };
}

/**
 * moveAsset
 * Move a single asset to a virtual folder.
 */
function moveAsset_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const assetId = String(p.asset_id || '').trim();
    const virtualFolder = String(p.virtual_folder || '');
    if (!assetId) throw new Error('Missing asset_id');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const nowIso = new Date().toISOString();
    const existingRow = findAssetRow_(sh, header, assetId);

    if (existingRow === -1) {
      // Create new entry with just the virtual folder
      const newRow = sh.getLastRow() + 1;
      const rowObj = {
        AssetId: assetId,
        Path: String(p.path || '').trim(),
        Products: '',
        Tags: '',
        Notes: '',
        VirtualFolder: virtualFolder,
        TrashedAt: '',
        TrashedBy: '',
        UpdatedAt: nowIso
      };
      writeRowByHeader_(sh, header, newRow, rowObj);
      return { action: 'move', asset_id: assetId, virtual_folder: virtualFolder, created: true };
    } else {
      // Update existing row
      if (header['VirtualFolder']) {
        sh.getRange(existingRow, header['VirtualFolder']).setValue(virtualFolder);
      }
      sh.getRange(existingRow, header['UpdatedAt']).setValue(nowIso);
      return { action: 'move', asset_id: assetId, virtual_folder: virtualFolder, created: false };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * batchMoveAssets
 * Move multiple assets to a virtual folder (POST only).
 * Body: { asset_ids: [], virtual_folder: '', path_map: { assetId: path, ... } }
 */
function batchMoveAssets_(body) {
  const assetIds = body.asset_ids;
  const virtualFolder = String(body.virtual_folder || '');
  const pathMap = body.path_map || {};

  if (!Array.isArray(assetIds)) throw new Error('Missing asset_ids array');

  const results = [];
  for (let i = 0; i < assetIds.length; i++) {
    try {
      const assetId = String(assetIds[i]).trim();
      const r = moveAsset_({
        asset_id: assetId,
        virtual_folder: virtualFolder,
        path: pathMap[assetId] || ''
      });
      results.push({ asset_id: assetId, ok: true, result: r });
    } catch (e) {
      results.push({ asset_id: assetIds[i], ok: false, error: String(e.message || e) });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  return { processed: results.length, success: successCount, virtual_folder: virtualFolder, results: results };
}

/**
 * renameFolder
 * Rename a virtual folder by updating all assets with that folder prefix.
 */
function renameFolder_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const oldPath = String(p.old_path || '').trim();
    const newPath = String(p.new_path || '').trim();
    const source = String(p.source || '').toLowerCase().trim();

    if (!oldPath) throw new Error('Missing old_path');
    if (!newPath) throw new Error('Missing new_path');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { action: 'rename', old_path: oldPath, new_path: newPath, updated: 0 };

    const vfCol = header['VirtualFolder'];
    if (!vfCol) throw new Error('VirtualFolder column not found');

    const lastCol = sh.getLastColumn();
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const nowIso = new Date().toISOString();

    let updated = 0;
    const oldPathSlash = oldPath + '/';

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const vf = String(row[vfCol - 1] || '').trim();

      if (!vf) continue;

      let newVf = null;
      if (vf === oldPath) {
        // Exact match
        newVf = newPath;
      } else if (vf.startsWith(oldPathSlash)) {
        // Nested folder
        newVf = newPath + '/' + vf.slice(oldPathSlash.length);
      }

      if (newVf !== null) {
        const rowIndex = 2 + i;
        sh.getRange(rowIndex, vfCol).setValue(newVf);
        sh.getRange(rowIndex, header['UpdatedAt']).setValue(nowIso);
        updated++;
      }
    }

    return { action: 'rename', old_path: oldPath, new_path: newPath, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * deleteFolder
 * Delete a virtual folder by trashing all assets in it (and subfolders).
 */
function deleteFolder_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folderPath = String(p.path || '').trim();
    const source = String(p.source || '').toLowerCase().trim();
    const userEmail = String(p.user_email || '').toLowerCase().trim();

    if (!folderPath) throw new Error('Missing path');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetsSheet_(ss);
    const header = getHeaderMap_(sh);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { action: 'delete_folder', path: folderPath, trashed: 0 };

    const vfCol = header['VirtualFolder'];
    if (!vfCol) throw new Error('VirtualFolder column not found');

    const lastCol = sh.getLastColumn();
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const nowIso = new Date().toISOString();

    let trashed = 0;
    const folderPathSlash = folderPath + '/';

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const vf = String(row[vfCol - 1] || '').trim();
      const alreadyTrashed = String(row[header['TrashedAt'] - 1] || '').trim();

      if (!vf || alreadyTrashed) continue;

      // Check if asset is in this folder or subfolder
      if (vf === folderPath || vf.startsWith(folderPathSlash)) {
        const rowIndex = 2 + i;
        sh.getRange(rowIndex, header['TrashedAt']).setValue(nowIso);
        sh.getRange(rowIndex, header['TrashedBy']).setValue(userEmail);
        sh.getRange(rowIndex, header['UpdatedAt']).setValue(nowIso);
        trashed++;
      }
    }

    return { action: 'delete_folder', path: folderPath, trashed: trashed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * setFolderDisplayName
 * Set or update a display name for a folder (filesystem or virtual).
 */
function setFolderDisplayName_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folderPath = String(p.path || '').trim();
    const source = String(p.source || '').toLowerCase().trim();
    const displayName = String(p.display_name || '').trim();

    if (!folderPath) throw new Error('Missing path');
    if (!source) throw new Error('Missing source');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureFoldersSheet_(ss);
    const header = getHeaderMap_(sh);

    const nowIso = new Date().toISOString();

    // Find existing row for this folder
    const lastRow = sh.getLastRow();
    let existingRow = 0;

    if (lastRow >= 2) {
      const pathCol = header['Path'];
      const sourceCol = header['Source'];
      const data = sh.getRange(2, 1, lastRow - 1, Math.max(pathCol, sourceCol)).getValues();

      for (let i = 0; i < data.length; i++) {
        const rowPath = String(data[i][pathCol - 1] || '').trim();
        const rowSource = String(data[i][sourceCol - 1] || '').toLowerCase().trim();
        if (rowPath === folderPath && rowSource === source) {
          existingRow = i + 2;
          break;
        }
      }
    }

    if (existingRow > 0) {
      // Update existing
      if (displayName) {
        sh.getRange(existingRow, header['DisplayName']).setValue(displayName);
      } else {
        // Empty display name - delete the row
        sh.deleteRow(existingRow);
        return { action: 'delete_folder_display_name', path: folderPath, source: source };
      }
      sh.getRange(existingRow, header['UpdatedAt']).setValue(nowIso);
      return { action: 'update_folder_display_name', path: folderPath, source: source, display_name: displayName };
    } else if (displayName) {
      // Insert new row
      const newRow = lastRow + 1;
      sh.getRange(newRow, header['Path']).setValue(folderPath);
      sh.getRange(newRow, header['Source']).setValue(source);
      sh.getRange(newRow, header['DisplayName']).setValue(displayName);
      sh.getRange(newRow, header['UpdatedAt']).setValue(nowIso);
      return { action: 'create_folder_display_name', path: folderPath, source: source, display_name: displayName };
    }

    return { action: 'no_change', path: folderPath, source: source };
  } finally {
    lock.releaseLock();
  }
}

/**
 * listFolderDisplayNames
 * Get all folder display names.
 */
function listFolderDisplayNames_() {
  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ss.getSheetByName(FOLDERS_SHEET_NAME);

  if (!sh || sh.getLastRow() < 2) {
    return { folders: [] };
  }

  const header = getHeaderMap_(sh);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const folders = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const path = String(row[header['Path'] - 1] || '').trim();
    const source = String(row[header['Source'] - 1] || '').toLowerCase().trim();
    const displayName = String(row[header['DisplayName'] - 1] || '').trim();

    if (path && displayName) {
      folders.push({
        path: path,
        source: source,
        display_name: displayName
      });
    }
  }

  return { folders: folders, count: folders.length };
}

/**
 * Ensure FOLDERS sheet exists with required columns.
 */
function ensureFoldersSheet_(ss) {
  const requiredColumns = ['Path', 'Source', 'DisplayName', 'UpdatedAt'];

  let sh = ss.getSheetByName(FOLDERS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(FOLDERS_SHEET_NAME);
    sh.getRange(1, 1, 1, requiredColumns.length).setValues([requiredColumns]);
    sh.setFrozenRows(1);
  } else {
    // Ensure all required columns exist
    const lastCol = sh.getLastColumn();
    const existingHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const existingSet = new Set(existingHeaders.map(h => String(h).trim()));

    for (const col of requiredColumns) {
      if (!existingSet.has(col)) {
        const newCol = sh.getLastColumn() + 1;
        sh.getRange(1, newCol).setValue(col);
      }
    }
  }
  return sh;
}

/** =========================
 * ASSET-JOB LINKING
 * ======================= */

/**
 * linkAssetsToJob
 * Link one or more assets to a job.
 * Params: asset_ids (array or single), job_id, job_app, user_email
 */
function linkAssetsToJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // Handle array, comma-separated string, or single value
    let assetIds = [];
    if (Array.isArray(p.asset_ids)) {
      assetIds = p.asset_ids;
    } else if (p.asset_ids) {
      assetIds = String(p.asset_ids).split(',').map(s => s.trim()).filter(s => s);
    } else if (p.asset_id) {
      assetIds = [String(p.asset_id).trim()];
    }

    const jobId = String(p.job_id || '').trim();
    const jobApp = String(p.job_app || '').trim();
    const userEmail = String(p.user_email || '').toLowerCase().trim();

    if (!jobId) throw new Error('Missing job_id');
    if (assetIds.length === 0) throw new Error('Missing asset_ids');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetJobsSheet_(ss);
    const header = getHeaderMap_(sh);
    const nowIso = new Date().toISOString();

    const results = [];
    for (let i = 0; i < assetIds.length; i++) {
      const assetId = String(assetIds[i]).trim();
      if (!assetId) continue;

      // Check if link already exists
      const existingRow = findAssetJobRow_(sh, header, assetId, jobId);
      if (existingRow > 0) {
        results.push({ asset_id: assetId, action: 'already_linked' });
        continue;
      }

      // Insert new link
      const newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, header['AssetId']).setValue(assetId);
      sh.getRange(newRow, header['JobId']).setValue(jobId);
      sh.getRange(newRow, header['JobApp']).setValue(jobApp);
      sh.getRange(newRow, header['LinkedAt']).setValue(nowIso);
      sh.getRange(newRow, header['LinkedBy']).setValue(userEmail);

      results.push({ asset_id: assetId, action: 'linked' });
    }

    const linkedCount = results.filter(r => r.action === 'linked').length;
    return { job_id: jobId, job_app: jobApp, linked: linkedCount, results: results };
  } finally {
    lock.releaseLock();
  }
}

/**
 * unlinkAssetsFromJob
 * Remove link between one or more assets and a job.
 * Params: asset_ids (array or single), job_id
 */
function unlinkAssetsFromJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // Handle array, comma-separated string, or single value
    let assetIds = [];
    if (Array.isArray(p.asset_ids)) {
      assetIds = p.asset_ids;
    } else if (p.asset_ids) {
      assetIds = String(p.asset_ids).split(',').map(s => s.trim()).filter(s => s);
    } else if (p.asset_id) {
      assetIds = [String(p.asset_id).trim()];
    }

    const jobId = String(p.job_id || '').trim();

    if (!jobId) throw new Error('Missing job_id');

    const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
    const sh = ensureAssetJobsSheet_(ss);
    const header = getHeaderMap_(sh);

    // Delete rows in reverse to avoid index shifting
    const rowsToDelete = [];
    for (let i = 0; i < assetIds.length; i++) {
      const assetId = String(assetIds[i]).trim();
      if (!assetId) continue;

      const row = findAssetJobRow_(sh, header, assetId, jobId);
      if (row > 0) {
        rowsToDelete.push(row);
      }
    }

    // Sort descending and delete
    rowsToDelete.sort((a, b) => b - a);
    for (const row of rowsToDelete) {
      sh.deleteRow(row);
    }

    return { job_id: jobId, removed: rowsToDelete.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * listLinkedJobs
 * Get all jobs linked to a specific asset.
 * Params: asset_id
 */
function listLinkedJobs_(p) {
  const assetId = String(p.asset_id || '').trim();
  if (!assetId) throw new Error('Missing asset_id');

  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ss.getSheetByName(ASSET_JOBS_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { asset_id: assetId, jobs: [] };

  const header = getHeaderMap_(sh);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const jobs = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowAssetId = String(row[header['AssetId'] - 1] || '').trim();
    if (rowAssetId === assetId) {
      jobs.push({
        job_id: String(row[header['JobId'] - 1] || '').trim(),
        job_app: String(row[header['JobApp'] - 1] || '').trim(),
        linked_at: String(row[header['LinkedAt'] - 1] || '').trim(),
        linked_by: String(row[header['LinkedBy'] - 1] || '').trim()
      });
    }
  }

  return { asset_id: assetId, jobs: jobs };
}

/**
 * listJobAssets
 * Get all assets linked to a specific job.
 * Params: job_id
 */
function listJobAssets_(p) {
  const jobId = String(p.job_id || '').trim();
  if (!jobId) throw new Error('Missing job_id');

  const ss = SpreadsheetApp.openById(TAGS_MASTER_SPREADSHEET_ID);
  const sh = ss.getSheetByName(ASSET_JOBS_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { job_id: jobId, assets: [] };

  const header = getHeaderMap_(sh);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const assets = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowJobId = String(row[header['JobId'] - 1] || '').trim();
    if (rowJobId === jobId) {
      assets.push({
        asset_id: String(row[header['AssetId'] - 1] || '').trim(),
        linked_at: String(row[header['LinkedAt'] - 1] || '').trim(),
        linked_by: String(row[header['LinkedBy'] - 1] || '').trim()
      });
    }
  }

  return { job_id: jobId, assets: assets };
}

/**
 * Ensure ASSET_JOBS sheet exists with required columns.
 */
function ensureAssetJobsSheet_(ss) {
  const requiredColumns = ['AssetId', 'JobId', 'JobApp', 'LinkedAt', 'LinkedBy'];

  let sh = ss.getSheetByName(ASSET_JOBS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ASSET_JOBS_SHEET_NAME);
    sh.getRange(1, 1, 1, requiredColumns.length).setValues([requiredColumns]);
    sh.setFrozenRows(1);
  } else {
    // Ensure all required columns exist
    const lastCol = sh.getLastColumn();
    const existingHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const existingSet = new Set(existingHeaders.map(h => String(h).trim()));

    for (const col of requiredColumns) {
      if (!existingSet.has(col)) {
        const newCol = sh.getLastColumn() + 1;
        sh.getRange(1, newCol).setValue(col);
      }
    }
  }
  return sh;
}

/**
 * Find a row in ASSET_JOBS by asset ID and job ID.
 */
function findAssetJobRow_(sh, header, assetId, jobId) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  const aidCol = header['AssetId'];
  const jidCol = header['JobId'];
  if (!aidCol || !jidCol) return -1;

  const maxCol = Math.max(aidCol, jidCol);
  const data = sh.getRange(2, 1, lastRow - 1, maxCol).getValues();

  for (let i = 0; i < data.length; i++) {
    const rowAssetId = String(data[i][aidCol - 1] || '').trim();
    const rowJobId = String(data[i][jidCol - 1] || '').trim();
    if (rowAssetId === assetId && rowJobId === jobId) {
      return i + 2;
    }
  }
  return -1;
}

/** =========================
 * HELPERS
 * ======================= */

function jsonp_(callback, payload) {
  const json = JSON.stringify(payload);

  if (!callback) {
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  const body = callback + '(' + json + ');';
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function ensureAssetsSheet_(ss) {
  const requiredColumns = ['AssetId', 'Path', 'Products', 'Tags', 'LOB', 'Notes', 'DisplayName', 'VirtualFolder', 'TrashedAt', 'TrashedBy', 'UpdatedAt'];

  let sh = ss.getSheetByName(ASSETS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ASSETS_SHEET_NAME);
    sh.getRange(1, 1, 1, requiredColumns.length).setValues([requiredColumns]);
    sh.setFrozenRows(1);
  } else {
    // Ensure all required columns exist
    const lastCol = sh.getLastColumn();
    const existingHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const existingSet = new Set(existingHeaders.map(h => String(h).trim()));

    for (const col of requiredColumns) {
      if (!existingSet.has(col)) {
        const newCol = sh.getLastColumn() + 1;
        sh.getRange(1, newCol).setValue(col);
      }
    }
  }
  return sh;
}

function getHeaderMap_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] || '').trim();
    if (h) map[h] = c + 1;
  }
  return map;
}

function findAssetRow_(sh, header, assetId) {
  const idCol = header['AssetId'];
  if (!idCol) return -1;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  const values = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === assetId) {
      return 2 + i;
    }
  }
  return -1;
}

function readRowByHeader_(sh, header, rowIndex) {
  const lastCol = sh.getLastColumn();
  const row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return rowToObj_(row, header);
}

function rowToObj_(row, headerMap) {
  const obj = {};
  for (const key in headerMap) {
    if (!headerMap.hasOwnProperty(key)) continue;
    const col = headerMap[key];
    obj[key] = row[col - 1];
  }
  return obj;
}

function writeRowByHeader_(sh, headerMap, rowIndex, obj) {
  const lastCol = sh.getLastColumn();
  const row = new Array(lastCol).fill('');
  for (const key in headerMap) {
    if (!headerMap.hasOwnProperty(key)) continue;
    const col = headerMap[key];
    if (obj.hasOwnProperty(key)) row[col - 1] = obj[key];
  }
  sh.getRange(rowIndex, 1, 1, lastCol).setValues([row]);
}

function parseList_(val) {
  const s = String(val || '').trim();
  if (!s) return [];
  return s.split(',').map(v => v.trim()).filter(v => v);
}

function normalizeList_(val) {
  if (Array.isArray(val)) {
    return val.map(v => String(v).trim()).filter(v => v);
  }
  return parseList_(val);
}

function toBool_(v) {
  const s = String(v || '').toLowerCase().trim();
  return (s === 'true' || s === '1' || s === 'yes');
}
