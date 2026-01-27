/**
 * FileRoom Registry v0 (Jobs directory + per-user dashboard prefs)
 * Google Apps Script — copy/paste as a single .gs file.
 *
 * Required Sheets (tabs):
 *  - JOBS      (headers exactly as provided)
 *  - DASHBOARD (headers exactly as provided)
 *
 * Deploy as Web App:
 *  - Execute as: Me
 *  - Who has access: Anyone (or anyone in domain) — JSONP style
 *
 * Endpoints (JSONP):
 *  ?action=listJobsForUser&user_email=you@example.com&callback=cb
 *  ?action=upsertJob&...&callback=cb
 *  ?action=setDashboardPref&...&callback=cb
 *  ?action=hideJob&user_email=...&ascend_job_key=...&callback=cb
 *  ?action=trashJob&user_email=...&ascend_job_key=...&callback=cb
 *  ?action=restoreJob&user_email=...&ascend_job_key=...&callback=cb
 *  ?action=listTrashedJobsForUser&user_email=...&callback=cb
 */

/** =========================
 * CONFIG
 * ======================= */
const FILEROOM_SPREADSHEET_ID = '1M48XhZsvUyy_tJt8Tz2kf9zxOQIKx6vBTkxKyeGtCCM';
const JOBS_SHEET_NAME = 'JOBS';
const DASHBOARD_SHEET_NAME = 'DASHBOARD';

// Bump to bust caches if you want.
const FILEROOM_API_VERSION = 'fileroom_v0_2025-12-19';

// ADMIN: allowlist for nuclear delete actions
const FILEROOM_ADMIN_EMAILS = [
  'jacob@jacobhenderson.studio'
];

function authorizeDrive_() {
  // 1) proves Drive scope + authorization prompt works
  DriveApp.getRootFolder().getName();

  // 2) validates the *exact* folder you plan to write into
  var folderId = '1x882jC2h_2YJsIXQrV1K56nqKvCPzJ4N';
  var name = DriveApp.getFolderById(folderId).getName();

  Logger.log('OK folder: ' + name);
}

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
        data = { ok: true, version: FILEROOM_API_VERSION };
        break;

      case 'upsertJob':
        data = upsertJob_(p);
        break;

      case 'upsertQrAsset':
        // NOTE: GET is supported for small payloads only.
        // For SVG/card, use POST (doPost) to avoid URL-length limits.
        data = upsertQrAsset_(p, null);
        break;

      case 'upsertQrPngAsset':
        // NOTE: PNG payloads must use POST (doPost). This GET handler exists only for symmetry/testing.
        data = upsertQrPngAsset_(p);
        break;

      case 'listJobsForUser':
        data = listJobsForUser_(p);
        break;

      case 'setDashboardPref':
        data = setDashboardPref_(p);
        break;

      case 'hideJob':
        data = hideJob_(p);
        break;

      case 'trashJob':
        data = trashJob_(p);
        break;

      case 'restoreJob':
        data = restoreJob_(p);
        break;

      case 'listTrashedJobsForUser':
        data = listTrashedJobsForUser_(p);
        break;

      case 'nukeJob':
        data = nukeJob_(p);
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
      version: FILEROOM_API_VERSION
    });
  }
}

function doPost(e) {
  // JSON body:
  // {
  //   "action": "upsertQrAsset",
  //   "folder_id": "...",
  //   "svg_text": "<svg ...>...</svg>",
  //   "file_name": "something.svg",
  //   "drive_file_id": "(optional)",
  //   "app": "codedesk",
  //   "source_id": "(working file id)",
  //   "ascend_job_key": "(optional)",
  //   "title": "(optional)",
  //   "subtitle": "(optional)",
  //   "status": "(optional)",
  //   "owner_email": "(optional)"
  // }
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    const body = raw ? JSON.parse(raw) : {};
    const action = String(body.action || '').trim();
    if (!action) throw new Error('Missing action');

    let data;
    switch (action) {
      case 'upsertJob':
        data = upsertJob_(body);
        break;

      case 'upsertQrAsset':
        data = upsertQrAsset_(body, raw);
        break;

      case 'upsertQrPngAsset':
        data = upsertQrPngAsset_(body);
        break;

      case 'trashJob':
        data = trashJob_(body);
        break;

      case 'restoreJob':
        data = restoreJob_(body);
        break;

      case 'nukeJob':
        data = nukeJob_(body);
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
      version: FILEROOM_API_VERSION
    });
  }
}

/** =========================
 * ACTIONS
 * ======================= */

function upsertQrAsset_(p, rawBody) {
  // Required:
  //  - folder_id
  //  - svg_text
  //  - file_name
  //  - app
  //  - source_id
  //
  // Optional:
  //  - drive_file_id (if updating an existing Drive file)
  //  - title, subtitle, status, owner_email, ascend_job_key
  //
  const folderId = String(p.folder_id || '').trim();
  const svgText  = String(p.svg_text || '').trim();
  const fileName = String(p.file_name || '').trim();

  const app = String(p.app || '').trim();
  const sourceId = String(p.source_id || '').trim();

  if (!folderId) throw new Error('upsertQrAsset: missing folder_id');
  if (!svgText) throw new Error('upsertQrAsset: missing svg_text');
  if (!fileName) throw new Error('upsertQrAsset: missing file_name');
  if (!app) throw new Error('upsertQrAsset: missing app');
  if (!sourceId) throw new Error('upsertQrAsset: missing source_id');

  const existingFileId = String(p.drive_file_id || '').trim();

  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(svgText, 'image/svg+xml', fileName);

  let file;
  if (existingFileId) {
    file = DriveApp.getFileById(existingFileId);
    file.setContent(svgText);
    file.setName(fileName);
  } else {
    file = folder.createFile(blob);
  }

  const openUrl = file.getUrl();

  const jobTitle = String(p.title || fileName.replace(/\.svg$/i, '') || 'QR Deliverable');
  const jobSubtitle = String(p.subtitle || 'CODEDESK — FLATTENED');
  const jobStatus = String(p.status || 'delivered');
  const ownerEmail = String(p.owner_email || '').trim();

  const ascendJobKey = String(p.ascend_job_key || (String(app).toUpperCase() + '_FLAT:' + sourceId)).trim();

  const upsert = upsertJob_({
    ascend_job_key: ascendJobKey,
    app: app,
    source_id: sourceId,
    title: jobTitle,
    subtitle: jobSubtitle,
    status: jobStatus,
    open_url: openUrl,
    owner_email: ownerEmail,
    lane: 'FILEROOM'
  });

  return {
    drive_file_id: file.getId(),
    open_url: openUrl,
    ascend_job_key: ascendJobKey,
    upsert_job: upsert
  };
}

function upsertQrPngAsset_(p) {
  // Requires Advanced Drive Service: Drive API
  // Required:
  //  - folder_id
  //  - png_data_url   (data:image/png;base64,...)
  //  - source_id
  //
  // Optional:
  //  - drive_png_file_id  (if you want to overwrite an existing Drive file IN PLACE)
  //  - title, subtitle, status, owner_email, ascend_job_key
  //  - kind, asset_type, template_id, state_json, destination_url
  //
  // Behavior (current):
  //  - Default: CREATE a new Drive PNG each call (no accidental overwrites).
  //  - If drive_png_file_id is provided: overwrite that exact Drive file id.
  //  - Upserts TWO registry rows:
  //      1) OUTPUT row  -> Kind=output  (shows in FileRoom lane)
  //      2) WORKING row -> Kind=working (shows in CodeDesk working lane in Ascend)
  //
  const folderId = String(p.folder_id || '').trim();
  const dataUrl  = String(p.png_data_url || '').trim();
  const sourceId = String(p.source_id || '').trim();

  if (!folderId) throw new Error('upsertQrPngAsset: missing folder_id');
  if (!dataUrl)  throw new Error('upsertQrPngAsset: missing png_data_url');
  if (!sourceId) throw new Error('upsertQrPngAsset: missing source_id');

  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/i);
  if (!m) throw new Error('upsertQrPngAsset: png_data_url must be data:image/png;base64,...');

  const bytes = Utilities.base64Decode(m[1]);

  // Build a helpful filename.
  // If the caller doesn't pass a title yet, we still guarantee uniqueness.
  const rawTitle = String(p.title || '').trim();
  const safeTitle = rawTitle
    ? rawTitle.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48)
    : 'CODEDESK_QR';

  // If we were given a specific Drive file id, overwrite IN PLACE.
  // Accept either drive_png_file_id (preferred) or drive_file_id (legacy/client convenience).
  const overwriteId = String(p.drive_png_file_id || p.drive_file_id || '').trim();

  // When overwriting, keep a stable filename (no timestamp churn).
  // When creating a new file, keep the timestamp for uniqueness.
  const stamp = (new Date()).toISOString().replace(/[:.]/g, '-');
  const fileName = overwriteId
    ? (safeTitle + '_' + sourceId + '.png')
    : (safeTitle + '_' + sourceId + '_' + stamp + '.png');

  const blob = Utilities.newBlob(bytes, 'image/png', fileName);

  let fileId = '';
  if (overwriteId) {
    fileId = overwriteId;
    Drive.Files.update(
      { title: fileName, mimeType: 'image/png' },
      fileId,
      blob
    );
  } else {
    const created = Drive.Files.insert(
      {
        title: fileName,
        mimeType: 'image/png',
        parents: [{ id: folderId }]
      },
      blob
    );
    fileId = created && created.id ? String(created.id) : '';
  }

  if (!fileId) throw new Error('upsertQrPngAsset: failed to obtain Drive file id');

  // Share the file publicly so it can be embedded in artstart previews
  try {
    DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // Best effort - continue even if sharing fails
  }

  // Prefer Drive API webViewLink/alternateLink if available
  let openUrl = '';
  try {
    const meta = Drive.Files.get(fileId);
    openUrl = String((meta && (meta.webViewLink || meta.alternateLink)) ? (meta.webViewLink || meta.alternateLink) : '').trim();
  } catch (e) {
    // Fallback: DriveApp file URL
    openUrl = DriveApp.getFileById(fileId).getUrl();
  }

  const jobTitle = String(p.title || safeTitle).trim();
  const jobSubtitle = String(p.subtitle || 'CODEDESK — FLATTENED (PNG)').trim();
  const jobStatus = String(p.status || 'delivered').trim();
  const ownerEmail = String(p.owner_email || '').trim();

  // IMPORTANT: output rows must be unique per export so they don't overwrite each other.
  // If you need stable identity, pass ascend_job_key explicitly.
  const ascendJobKey = String(p.ascend_job_key || ('CODEDESK_FLAT:' + sourceId + ':' + fileId)).trim();

  // 1) OUTPUT row (FileRoom lane)
  const upsertOutput = upsertJob_({
    ascend_job_key: ascendJobKey,
    app: 'codedesk',
    source_id: sourceId,
    kind: String(p.kind || 'output'),
    asset_type: String(p.asset_type || 'qr'),
    template_id: String(p.template_id || ''),
    state_json: String(p.state_json || ''),
    drive_folder_id: folderId,
    drive_png_file_id: fileId,
    drive_png_open_url: openUrl,
    destination_url: String(p.destination_url || ''),
    title: jobTitle,
    subtitle: jobSubtitle,
    status: jobStatus,
    open_url: openUrl,
    owner_email: ownerEmail,
    lane: 'FILEROOM'
  });

  // 2) WORKING row (Ascend CodeDesk working lane)
  // This is the thing Ascend uses to paint orange "working file" cards.
  const workingKey = 'CODEDESK_WF:' + sourceId;

  const upsertWorking = upsertJob_({
    ascend_job_key: workingKey,
    app: 'codedesk',
    source_id: sourceId,
    kind: 'working',
    asset_type: 'working',
    template_id: String(p.template_id || ''),
    state_json: String(p.state_json || ''),
    drive_folder_id: folderId,
    title: String(p.working_title || jobTitle || 'QR Working File'),
    subtitle: String(p.working_subtitle || 'CODEDESK — WORKING'),
    status: String(p.working_status || 'open'),
    open_url: '',
    owner_email: ownerEmail,
    lane: 'HOPPER'
  });

  return {
    drive_file_id: fileId,
    open_url: openUrl,
    ascend_job_key: ascendJobKey,
    upsert_job: upsertOutput,
    working_ascend_job_key: workingKey,
    upsert_working_job: upsertWorking
  };
}

/**
 * upsertJob
 * Required:
 *  - ascend_job_key OR (app + source_id) (we can derive key as APP:SOURCE_ID)
 *  - app
 *  - source_id
 * Optional:
 *  - title, subtitle, status, open_url, owner_email, collaborators,
 *    created_at, updated_at, last_touched_by, tags, parent_ascend_job_key, is_deleted
 */
function upsertJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
    const sh = getSheet_(ss, JOBS_SHEET_NAME);

    const header = getHeaderMap_(sh);
    ensureHeaders_(header, [
      'AscendJobKey','App','SourceId','Title','Subtitle','Status','OpenUrl','OwnerEmail','Collaborators','CreatedAt','UpdatedAt','LastTouchedBy','Tags','ParentAscendJobKey','IsDeleted','DestinationUrl',
      'Kind','AssetType','TemplateId','StateJson','DriveFolderId','DrivePngFileId','DrivePngOpenUrl','TrashedAt','TrashedBy'
    ]);

    const app = req_(p, 'app');
    const sourceId = req_(p, 'source_id');

    let ascendJobKey = String(p.ascend_job_key || '').trim();
    if (!ascendJobKey) {
      ascendJobKey = String(app).toUpperCase() + ':' + String(sourceId);
    }

    const nowIso = new Date().toISOString();

    const rowObj = {
      AscendJobKey: ascendJobKey,
      App: String(app).toUpperCase(),
      SourceId: String(sourceId),
      Title: opt_(p, 'title', ''),
      Subtitle: opt_(p, 'subtitle', ''),
      Status: opt_(p, 'status', 'open'),
      OpenUrl: opt_(p, 'open_url', ''),
      DestinationUrl: (opt_(p, 'destination_url', '') || opt_(p, 'destinationUrl', '') || opt_(p, 'dest_url', '') || opt_(p, 'target_url', '') || opt_(p, 'targetUrl', '') || ''),
      OwnerEmail: opt_(p, 'owner_email', ''),
      Collaborators: opt_(p, 'collaborators', ''),
      CreatedAt: opt_(p, 'created_at', nowIso),
      UpdatedAt: opt_(p, 'updated_at', nowIso),
      LastTouchedBy: opt_(p, 'last_touched_by', ''),
      Tags: opt_(p, 'tags', ''),
      ParentAscendJobKey: opt_(p, 'parent_ascend_job_key', ''),
      IsDeleted: toBoolStr_(opt_(p, 'is_deleted', 'FALSE')),
      Kind: opt_(p, 'kind', ''),
      AssetType: opt_(p, 'asset_type', ''),
      TemplateId: opt_(p, 'template_id', ''),
      StateJson: opt_(p, 'state_json', ''),
      DriveFolderId: opt_(p, 'drive_folder_id', ''),
      DrivePngFileId: opt_(p, 'drive_png_file_id', ''),
      DrivePngOpenUrl: opt_(p, 'drive_png_open_url', ''),
      TrashedAt: opt_(p, 'trashed_at', ''),
      TrashedBy: opt_(p, 'trashed_by', '')
    };

    // Find existing row by AscendJobKey
    const keyCol = header['AscendJobKey'];
    const lastRow = sh.getLastRow();
    let foundRow = -1;

    if (lastRow >= 2) {
      const keyValues = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < keyValues.length; i++) {
        if (String(keyValues[i][0]).trim() === ascendJobKey) {
          foundRow = 2 + i;
          break;
        }
      }
    }

    if (foundRow === -1) {
      // Append new
      const newRow = sh.getLastRow() + 1;
      writeRowByHeader_(sh, header, newRow, rowObj);
      return { upsert: 'insert', AscendJobKey: ascendJobKey, row: newRow };
    } else {
      // Update existing (keep CreatedAt unless explicitly provided)
      if (!p.created_at) {
        rowObj.CreatedAt = String(sh.getRange(foundRow, header['CreatedAt']).getValue() || '').trim() || rowObj.CreatedAt;
      }
      // Always bump UpdatedAt unless explicitly provided
      if (!p.updated_at) rowObj.UpdatedAt = nowIso;

      // IMPORTANT: Preserve TrashedAt/TrashedBy unless explicitly provided.
      // This prevents autosave/sync from accidentally un-trashing items.
      if (!p.trashed_at && header['TrashedAt']) {
        rowObj.TrashedAt = String(sh.getRange(foundRow, header['TrashedAt']).getValue() || '').trim();
      }
      if (!p.trashed_by && header['TrashedBy']) {
        rowObj.TrashedBy = String(sh.getRange(foundRow, header['TrashedBy']).getValue() || '').trim();
      }

      writeRowByHeader_(sh, header, foundRow, rowObj);
      return { upsert: 'update', AscendJobKey: ascendJobKey, row: foundRow };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * listJobsForUser
 * Required:
 *  - user_email
 * Optional:
 *  - include_hidden=TRUE/FALSE
 *  - include_deleted=TRUE/FALSE
 */
function listJobsForUser_(p) {
  const userEmail = String(req_(p, 'user_email')).toLowerCase().trim();
  const includeHidden = toBool_(opt_(p, 'include_hidden', 'FALSE'));
  const includeDeleted = toBool_(opt_(p, 'include_deleted', 'FALSE'));
  const includeTrashed = toBool_(opt_(p, 'include_trashed', 'FALSE'));

  const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
  const jobsSh = getSheet_(ss, JOBS_SHEET_NAME);
  const dashSh = getSheet_(ss, DASHBOARD_SHEET_NAME);

  const jobsHeader = getHeaderMap_(jobsSh);
  ensureHeaders_(jobsHeader, [
    'AscendJobKey','App','SourceId','Title','Subtitle','Status','OpenUrl','OwnerEmail','Collaborators','CreatedAt','UpdatedAt','LastTouchedBy','Tags','ParentAscendJobKey','IsDeleted','DestinationUrl',
    'Kind','AssetType','TemplateId','StateJson','DriveFolderId','DrivePngFileId','DrivePngOpenUrl'
  ]);

  const dashHeader = getHeaderMap_(dashSh);
  ensureHeaders_(dashHeader, ['UserEmail','AscendJobKey','Lane','Pinned','Hidden','SortWeight','Note','UpdatedAt']);

  // Build dashboard pref map for user
  const dashPrefs = buildDashboardPrefs_(dashSh, dashHeader, userEmail);

  // Read JOBS
  const lastRow = jobsSh.getLastRow();
  if (lastRow < 2) return { user_email: userEmail, jobs: [] };

  const lastCol = jobsSh.getLastColumn();
  const values = jobsSh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const job = rowToObj_(row, jobsHeader);

    const isDeleted = toBool_(String(job.IsDeleted || 'FALSE'));
    if (isDeleted && !includeDeleted) continue;

    const isTrashed = !!(job.TrashedAt && String(job.TrashedAt).trim());
    if (isTrashed && !includeTrashed) continue;

    const owner = String(job.OwnerEmail || '').toLowerCase().trim();
    const collabs = String(job.Collaborators || '').toLowerCase();

    const isMine = owner === userEmail || (collabs && collabs.indexOf(userEmail) !== -1);
    if (!isMine) continue;

    const pref = dashPrefs[job.AscendJobKey] || null;

    const hidden = pref ? toBool_(String(pref.Hidden || 'FALSE')) : false;
    if (hidden && !includeHidden) continue;

    const pinned = pref ? toBool_(String(pref.Pinned || 'FALSE')) : false;

    out.push({
      AscendJobKey: job.AscendJobKey,
      App: job.App,
      SourceId: job.SourceId,
      Title: job.Title,
      Subtitle: job.Subtitle,
      Status: job.Status,
      OpenUrl: job.OpenUrl,
      DestinationUrl: job.DestinationUrl || '',
      Kind: job.Kind || '',
      AssetType: job.AssetType || '',
      TemplateId: job.TemplateId || '',
      StateJson: job.StateJson || '',
      DriveFolderId: job.DriveFolderId || '',
      DrivePngFileId: job.DrivePngFileId || '',
      DrivePngOpenUrl: job.DrivePngOpenUrl || '',
      UpdatedAt: job.UpdatedAt,
      Pinned: pinned,
      Hidden: hidden,
      Lane: pref && pref.Lane ? pref.Lane : 'AUTO',
      SortWeight: pref && pref.SortWeight !== '' ? Number(pref.SortWeight) : null,
      ParentAscendJobKey: job.ParentAscendJobKey || '',
      TrashedAt: job.TrashedAt || '',
      TrashedBy: job.TrashedBy || ''
    });
  }

  // Sort:
  // 1) Pinned desc
  // 2) SortWeight asc if present
  // 3) UpdatedAt desc
  out.sort(function(a, b) {
    const ap = a.Pinned ? 1 : 0;
    const bp = b.Pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;

    const aw = (a.SortWeight === null || isNaN(a.SortWeight)) ? null : a.SortWeight;
    const bw = (b.SortWeight === null || isNaN(b.SortWeight)) ? null : b.SortWeight;
    if (aw !== null || bw !== null) {
      if (aw === null) return 1;
      if (bw === null) return -1;
      if (aw !== bw) return aw - bw;
    }

    const at = Date.parse(a.UpdatedAt || '') || 0;
    const bt = Date.parse(b.UpdatedAt || '') || 0;
    return bt - at;
  });

  return { user_email: userEmail, jobs: out, count: out.length };
}

/**
 * setDashboardPref
 * Required:
 *  - user_email
 *  - ascend_job_key
 * Optional:
 *  - lane, pinned, hidden, sort_weight, note
 */
function setDashboardPref_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const userEmail = String(req_(p, 'user_email')).toLowerCase().trim();
    const key = String(req_(p, 'ascend_job_key')).trim();

    const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
    const sh = getSheet_(ss, DASHBOARD_SHEET_NAME);

    const header = getHeaderMap_(sh);
    ensureHeaders_(header, ['UserEmail','AscendJobKey','Lane','Pinned','Hidden','SortWeight','Note','UpdatedAt']);

    const nowIso = new Date().toISOString();

    const rowObj = {
      UserEmail: userEmail,
      AscendJobKey: key,
      Lane: opt_(p, 'lane', 'AUTO'),
      Pinned: toBoolStr_(opt_(p, 'pinned', '')),
      Hidden: toBoolStr_(opt_(p, 'hidden', '')),
      SortWeight: opt_(p, 'sort_weight', ''),
      Note: opt_(p, 'note', ''),
      UpdatedAt: nowIso
    };

    // Find existing row by (UserEmail + AscendJobKey)
    const lastRow = sh.getLastRow();
    let foundRow = -1;

    if (lastRow >= 2) {
      const emailCol = header['UserEmail'];
      const keyCol = header['AscendJobKey'];
      const emails = sh.getRange(2, emailCol, lastRow - 1, 1).getValues();
      const keys = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < emails.length; i++) {
        if (String(emails[i][0]).toLowerCase().trim() === userEmail &&
            String(keys[i][0]).trim() === key) {
          foundRow = 2 + i;
          break;
        }
      }
    }

    if (foundRow === -1) {
      const newRow = sh.getLastRow() + 1;
      // If pinned/hidden were omitted, default them to FALSE
      if (rowObj.Pinned === '') rowObj.Pinned = 'FALSE';
      if (rowObj.Hidden === '') rowObj.Hidden = 'FALSE';
      writeRowByHeader_(sh, header, newRow, rowObj);
      return { upsert: 'insert', user_email: userEmail, AscendJobKey: key, row: newRow };
    } else {
      // Merge: only overwrite fields that were provided (except UpdatedAt)
      const existing = readRowByHeader_(sh, header, foundRow);

      if (!('lane' in p)) rowObj.Lane = existing.Lane || 'AUTO';
      if (!('pinned' in p)) rowObj.Pinned = existing.Pinned || 'FALSE';
      if (!('hidden' in p)) rowObj.Hidden = existing.Hidden || 'FALSE';
      if (!('sort_weight' in p)) rowObj.SortWeight = existing.SortWeight || '';
      if (!('note' in p)) rowObj.Note = existing.Note || '';

      writeRowByHeader_(sh, header, foundRow, rowObj);
      return { upsert: 'update', user_email: userEmail, AscendJobKey: key, row: foundRow };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * hideJob convenience
 * Required:
 *  - user_email
 *  - ascend_job_key
 */
function hideJob_(p) {
  p.hidden = 'TRUE';
  return setDashboardPref_(p);
}

/**
 * trashJob
 * Soft-deletes a job by setting TrashedAt timestamp.
 * Required:
 *  - user_email (caller identity)
 *  - ascend_job_key
 */
function trashJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const userEmail = String(req_(p, 'user_email')).toLowerCase().trim();
    const key = String(req_(p, 'ascend_job_key')).trim();

    const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
    const sh = getSheet_(ss, JOBS_SHEET_NAME);

    let header = getHeaderMap_(sh);
    // Ensure all needed columns exist
    ensureHeaders_(header, ['AscendJobKey','App','SourceId','Title','OwnerEmail','UpdatedAt','CreatedAt']);
    header = ensureOrAddColumns_(sh, header, ['TrashedAt', 'TrashedBy']);

    const keyCol = header['AscendJobKey'];
    const lastRow = sh.getLastRow();
    let foundRow = -1;

    if (lastRow >= 2) {
      const keyValues = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < keyValues.length; i++) {
        if (String(keyValues[i][0]).trim() === key) {
          foundRow = 2 + i;
          break;
        }
      }
    }

    const nowIso = new Date().toISOString();

    // If job doesn't exist, create a minimal entry so it can be trashed
    if (foundRow === -1) {
      // Parse app and source_id from key (format: "APP:sourceId")
      const colonIdx = key.indexOf(':');
      const app = colonIdx > 0 ? key.substring(0, colonIdx) : '';
      const sourceId = colonIdx > 0 ? key.substring(colonIdx + 1) : key;

      foundRow = sh.getLastRow() + 1;
      if (header['AscendJobKey']) sh.getRange(foundRow, header['AscendJobKey']).setValue(key);
      if (header['App']) sh.getRange(foundRow, header['App']).setValue(app);
      if (header['SourceId']) sh.getRange(foundRow, header['SourceId']).setValue(sourceId);
      if (header['Title']) sh.getRange(foundRow, header['Title']).setValue(opt_(p, 'title', ''));
      if (header['OwnerEmail']) sh.getRange(foundRow, header['OwnerEmail']).setValue(userEmail);
      if (header['CreatedAt']) sh.getRange(foundRow, header['CreatedAt']).setValue(nowIso);
    }

    // Set TrashedAt and TrashedBy
    sh.getRange(foundRow, header['TrashedAt']).setValue(nowIso);
    sh.getRange(foundRow, header['TrashedBy']).setValue(userEmail);
    sh.getRange(foundRow, header['UpdatedAt']).setValue(nowIso);

    return {
      ok: true,
      action: 'trash',
      ascend_job_key: key,
      trashed_at: nowIso,
      trashed_by: userEmail
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * restoreJob
 * Restores a trashed job by clearing TrashedAt.
 * Required:
 *  - user_email (caller identity)
 *  - ascend_job_key
 */
function restoreJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const userEmail = String(req_(p, 'user_email')).toLowerCase().trim();
    const key = String(req_(p, 'ascend_job_key')).trim();

    const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
    const sh = getSheet_(ss, JOBS_SHEET_NAME);

    let header = getHeaderMap_(sh);
    ensureHeaders_(header, ['AscendJobKey','UpdatedAt']);
    header = ensureOrAddColumns_(sh, header, ['TrashedAt', 'TrashedBy']);

    const keyCol = header['AscendJobKey'];
    const lastRow = sh.getLastRow();
    let foundRow = -1;

    if (lastRow >= 2) {
      const keyValues = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < keyValues.length; i++) {
        if (String(keyValues[i][0]).trim() === key) {
          foundRow = 2 + i;
          break;
        }
      }
    }

    if (foundRow === -1) {
      return { ok: false, error: 'Job not found', ascend_job_key: key };
    }

    const nowIso = new Date().toISOString();

    // Clear TrashedAt and TrashedBy
    sh.getRange(foundRow, header['TrashedAt']).setValue('');
    sh.getRange(foundRow, header['TrashedBy']).setValue('');
    sh.getRange(foundRow, header['UpdatedAt']).setValue(nowIso);

    return {
      ok: true,
      action: 'restore',
      ascend_job_key: key,
      restored_at: nowIso,
      restored_by: userEmail
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * listTrashedJobsForUser
 * Returns all trashed jobs for a user.
 * Required:
 *  - user_email
 */
function listTrashedJobsForUser_(p) {
  const userEmail = String(req_(p, 'user_email')).toLowerCase().trim();
  const isAdmin = FILEROOM_ADMIN_EMAILS.some(function(e) {
    return e.toLowerCase() === userEmail;
  });

  const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
  const jobsSh = getSheet_(ss, JOBS_SHEET_NAME);

  let jobsHeader = getHeaderMap_(jobsSh);
  ensureHeaders_(jobsHeader, ['AscendJobKey','OwnerEmail']);
  // If TrashedAt column doesn't exist, return empty (nothing trashed yet)
  if (!jobsHeader['TrashedAt']) {
    return { user_email: userEmail, jobs: [], count: 0, isAdmin: isAdmin };
  }

  const lastRow = jobsSh.getLastRow();
  if (lastRow < 2) return { user_email: userEmail, jobs: [], count: 0, isAdmin: isAdmin };

  const lastCol = jobsSh.getLastColumn();
  const values = jobsSh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const job = rowToObj_(row, jobsHeader);

    // Only include trashed items
    const trashedAt = String(job.TrashedAt || '').trim();
    if (!trashedAt) continue;

    // Admins see all trashed items
    if (!isAdmin) {
      // Check ownership - also include items trashed by this user, or items with no owner
      const owner = String(job.OwnerEmail || '').toLowerCase().trim();
      const collabs = String(job.Collaborators || '').toLowerCase();
      const trashedBy = String(job.TrashedBy || '').toLowerCase().trim();

      const isMine = !owner || owner === userEmail || trashedBy === userEmail || (collabs && collabs.indexOf(userEmail) !== -1);
      if (!isMine) continue;
    }

    out.push({
      AscendJobKey: job.AscendJobKey,
      App: job.App,
      SourceId: job.SourceId,
      Title: job.Title,
      Subtitle: job.Subtitle,
      Status: job.Status,
      OpenUrl: job.OpenUrl,
      DestinationUrl: job.DestinationUrl || '',
      Kind: job.Kind || '',
      AssetType: job.AssetType || '',
      UpdatedAt: job.UpdatedAt,
      TrashedAt: job.TrashedAt,
      TrashedBy: job.TrashedBy
    });
  }

  // Sort by TrashedAt desc (most recently trashed first)
  out.sort(function(a, b) {
    const at = Date.parse(a.TrashedAt || '') || 0;
    const bt = Date.parse(b.TrashedAt || '') || 0;
    return bt - at;
  });

  return { user_email: userEmail, jobs: out, count: out.length, isAdmin: isAdmin };
}

/**
 * nukeJob (ADMIN ONLY)
 * Required:
 *  - user_email  (caller identity)
 *  - ascend_job_key (the JOBS.AscendJobKey to delete)
 * Optional:
 *  - delete_drive=TRUE/FALSE  (default TRUE) -> trashes DrivePngFileId if present
 *  - delete_dashboard=TRUE/FALSE (default TRUE) -> removes DASHBOARD rows for this key (all users)
 *  - delete_working=TRUE/FALSE (default TRUE) -> if this is a CODEDESK output, also deletes CODEDESK_WF:<SourceId>
 *
 * Behavior:
 *  - Deletes the JOBS row physically (not just IsDeleted)
 *  - Optionally trashes linked Drive PNG file (DrivePngFileId)
 *  - Optionally deletes all DASHBOARD prefs rows that reference the key
 */
function nukeJob_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const caller = String(req_(p, 'user_email')).toLowerCase().trim();
    if (!isAdminEmail_(caller)) throw new Error('nukeJob: not authorized');

    const key = String(req_(p, 'ascend_job_key')).trim();

    const deleteDrive = (('delete_drive' in p) ? toBool_(opt_(p, 'delete_drive', 'TRUE')) : true);
    const deleteDash  = (('delete_dashboard' in p) ? toBool_(opt_(p, 'delete_dashboard', 'TRUE')) : true);
    const deleteWorking = (('delete_working' in p) ? toBool_(opt_(p, 'delete_working', 'TRUE')) : true);

    const ss = SpreadsheetApp.openById(FILEROOM_SPREADSHEET_ID);
    const jobsSh = getSheet_(ss, JOBS_SHEET_NAME);
    const dashSh = getSheet_(ss, DASHBOARD_SHEET_NAME);

    const jobsHeader = getHeaderMap_(jobsSh);
    ensureHeaders_(jobsHeader, [
      'AscendJobKey','App','SourceId','Title','Subtitle','Status','OpenUrl','OwnerEmail','Collaborators','CreatedAt','UpdatedAt','LastTouchedBy','Tags','ParentAscendJobKey','IsDeleted','DestinationUrl',
      'Kind','AssetType','TemplateId','StateJson','DriveFolderId','DrivePngFileId','DrivePngOpenUrl','TrashedAt','TrashedBy'
    ]);

    const dashHeader = getHeaderMap_(dashSh);
    ensureHeaders_(dashHeader, ['UserEmail','AscendJobKey','Lane','Pinned','Hidden','SortWeight','Note','UpdatedAt']);

    // Locate JOBS row by AscendJobKey
    const keyCol = jobsHeader['AscendJobKey'];
    const lastRow = jobsSh.getLastRow();

    let foundRow = -1;
    let jobObj = null;

    if (lastRow >= 2) {
      const keyValues = jobsSh.getRange(2, keyCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < keyValues.length; i++) {
        if (String(keyValues[i][0]).trim() === key) {
          foundRow = 2 + i;
          break;
        }
      }
    }

    if (foundRow === -1) {
      // Still allow dashboard cleanup for orphaned keys
      if (deleteDash) {
        const removedDash = deleteDashboardRowsByKey_(dashSh, dashHeader, key);
        return { ok: true, ascend_job_key: key, jobs_row: null, dash_rows_deleted: removedDash, drive_trashed: false, working_deleted: false };
      }
      return { ok: true, ascend_job_key: key, jobs_row: null, dash_rows_deleted: 0, drive_trashed: false, working_deleted: false };
    }

    jobObj = readRowByHeader_(jobsSh, jobsHeader, foundRow);

    // Trash linked Drive PNG (if present)
    let driveTrashed = false;
    if (deleteDrive) {
      const pngId = String(jobObj.DrivePngFileId || '').trim();
      if (pngId) {
        try {
          DriveApp.getFileById(pngId).setTrashed(true);
          driveTrashed = true;
        } catch (e) {
          // Don't fail the nuke if Drive trash fails
        }
      }
    }

    // If this is a CodeDesk OUTPUT row and caller asked to delete working row too, delete CODEDESK_WF:<SourceId>
    let workingDeleted = false;
    if (deleteWorking) {
      const app = String(jobObj.App || '').toUpperCase().trim();
      const kind = String(jobObj.Kind || '').toLowerCase().trim();
      const sourceId = String(jobObj.SourceId || '').trim();

      if (app === 'CODEDESK' && sourceId && (kind === 'output' || kind === '')) {
        try {
          const workingKey = 'CODEDESK_WF:' + sourceId;
          const wr = deleteJobsRowByKey_(jobsSh, jobsHeader, workingKey);
          if (wr && wr.deleted) workingDeleted = true;
        } catch (e) {}
      }
    }

    // Delete JOBS row (physical)
    jobsSh.deleteRow(foundRow);

    // Delete DASHBOARD rows (all users) that point at the key
    let dashDeleted = 0;
    if (deleteDash) {
      dashDeleted = deleteDashboardRowsByKey_(dashSh, dashHeader, key);
    }

    return {
      ok: true,
      ascend_job_key: key,
      deleted_title: String(jobObj.Title || ''),
      deleted_kind: String(jobObj.Kind || ''),
      deleted_app: String(jobObj.App || ''),
      deleted_source_id: String(jobObj.SourceId || ''),
      drive_trashed: driveTrashed,
      dash_rows_deleted: dashDeleted,
      working_deleted: workingDeleted
    };
  } finally {
    lock.releaseLock();
  }
}

function isAdminEmail_(email) {
  const e = String(email || '').toLowerCase().trim();
  for (let i = 0; i < FILEROOM_ADMIN_EMAILS.length; i++) {
    if (String(FILEROOM_ADMIN_EMAILS[i] || '').toLowerCase().trim() === e) return true;
  }
  return false;
}

function deleteDashboardRowsByKey_(dashSh, dashHeader, key) {
  const lastRow = dashSh.getLastRow();
  if (lastRow < 2) return 0;

  const keyCol = dashHeader['AscendJobKey'];
  const values = dashSh.getRange(2, keyCol, lastRow - 1, 1).getValues();

  // Delete bottom-up to preserve indices
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || '').trim() === String(key).trim()) {
      dashSh.deleteRow(2 + i);
      deleted++;
    }
  }
  return deleted;
}

function deleteJobsRowByKey_(jobsSh, jobsHeader, key) {
  const keyCol = jobsHeader['AscendJobKey'];
  const lastRow = jobsSh.getLastRow();
  if (lastRow < 2) return { deleted: false };

  const keyValues = jobsSh.getRange(2, keyCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < keyValues.length; i++) {
    if (String(keyValues[i][0]).trim() === String(key).trim()) {
      jobsSh.deleteRow(2 + i);
      return { deleted: true, row: 2 + i };
    }
  }
  return { deleted: false };
}

/** =========================
 * HELPERS
 * ======================= */

function jsonp_(callback, payload) {
  const json = JSON.stringify(payload);

  // If no callback provided, return JSON (still usable in browser).
  if (!callback) {
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // JSONP
  const body = callback + '(' + json + ');';
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function getSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Missing sheet tab: ' + name);
  return sh;
}

function getHeaderMap_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) throw new Error('Sheet has no columns: ' + sh.getName());
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] || '').trim();
    if (h) map[h] = c + 1;
  }
  return map;
}

function ensureHeaders_(headerMap, required) {
  for (let i = 0; i < required.length; i++) {
    if (!headerMap[required[i]]) {
      throw new Error('Missing required header "' + required[i] + '" in sheet.');
    }
  }
}

function ensureOrAddColumns_(sh, headerMap, columns) {
  // Add any missing columns to the end of the sheet
  let lastCol = sh.getLastColumn();
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!headerMap[col]) {
      lastCol++;
      sh.getRange(1, lastCol).setValue(col);
      headerMap[col] = lastCol;
    }
  }
  return headerMap;
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

function readRowByHeader_(sh, headerMap, rowIndex) {
  const lastCol = sh.getLastColumn();
  const row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return rowToObj_(row, headerMap);
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

function buildDashboardPrefs_(dashSh, dashHeader, userEmail) {
  const lastRow = dashSh.getLastRow();
  const prefs = {};
  if (lastRow < 2) return prefs;

  const lastCol = dashSh.getLastColumn();
  const values = dashSh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const o = rowToObj_(row, dashHeader);
    const email = String(o.UserEmail || '').toLowerCase().trim();
    if (email !== userEmail) continue;
    const key = String(o.AscendJobKey || '').trim();
    if (!key) continue;
    prefs[key] = o;
  }
  return prefs;
}

function req_(p, key) {
  const v = (p && (key in p)) ? String(p[key]) : '';
  if (!v || !String(v).trim()) throw new Error('Missing required parameter: ' + key);
  return String(v).trim();
}

function opt_(p, key, def) {
  if (!p || !(key in p)) return def;
  return String(p[key]);
}

function toBool_(v) {
  const s = String(v || '').toLowerCase().trim();
  return (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 't' || s === 'on');
}

function toBoolStr_(v) {
  // If empty, return '' so caller can decide whether to merge or default.
  const s = String(v || '').trim();
  if (!s) return '';
  return toBool_(s) ? 'TRUE' : 'FALSE';
}