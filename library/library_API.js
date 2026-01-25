/**
 * Library Tags Master API v1.1
 * Google Apps Script for managing Library asset metadata.
 *
 * Sheet: Tags Master (1ZtR9Jv64Jogrvx77drQGNosCo0-sjDMTulC_Q__TpQQ)
 *
 * Required Tabs:
 *  - TAXONOMY (headers: Name, Tags, LOB)
 *  - ASSETS   (headers: AssetId, Path, Products, Tags, Notes, VirtualFolder, TrashedAt, TrashedBy, UpdatedAt)
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
 */

/** =========================
 * CONFIG
 * ======================= */
const TAGS_MASTER_SPREADSHEET_ID = '1ZtR9Jv64Jogrvx77drQGNosCo0-sjDMTulC_Q__TpQQ';
const TAXONOMY_SHEET_NAME = 'TAXONOMY';
const ASSETS_SHEET_NAME = 'ASSETS';

const LIBRARY_API_VERSION = 'library_v1.1_2026-01-24';

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
  if (lastRow < 2) return { products: [] };

  const data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  const products = [];

  for (let i = 0; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const tags = String(data[i][1] || '').trim();
    const lob = String(data[i][2] || '').trim();

    if (name) {
      products.push({
        name: name,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [],
        lob: lob
      });
    }
  }

  // Also extract unique tags across all products
  const allTags = new Set();
  products.forEach(p => p.tags.forEach(t => allTags.add(t)));

  // Extract unique LOBs
  const allLobs = new Set();
  products.forEach(p => { if (p.lob) allLobs.add(p.lob); });

  return {
    products: products,
    tags: Array.from(allTags).sort(),
    lobs: Array.from(allLobs).sort()
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
  let sh = ss.getSheetByName(ASSETS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ASSETS_SHEET_NAME);
    sh.getRange(1, 1, 1, 10).setValues([[
      'AssetId', 'Path', 'Products', 'Tags', 'Notes', 'DisplayName', 'VirtualFolder', 'TrashedAt', 'TrashedBy', 'UpdatedAt'
    ]]);
    sh.setFrozenRows(1);
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
