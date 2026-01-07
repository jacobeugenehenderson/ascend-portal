// ===== CONFIG =====
const TEMPLATE_SPREADSHEET_ID = '1QXHSiHwR7gku2RIlX8XKOzokHKsgs3I-xFkXbEA5GCM';
const JOB_EN_SHEET_NAME = 'JOB_EN';
const CONTROL_PANEL_SHEET_NAME = 'CONTROL_PANEL';
const STYLES_SHEET_NAME = 'STYLE';
const JOBS_FOLDER_NAME = 'Jobs';
const CARDS_SHEET_NAME = 'CARDS';
const GHOST_SLOTS_SHEET_NAME = 'GHOST_SLOTS';

// Bump this any time you want to be SURE the frontend is hitting new code
const COPYDESK_API_VERSION = 'copydesk_API-2025-12-16-vGHOSTS-19';

// Hopper DB (across jobs/users) + FileRoom-style deliverables list (small contained DB)
const HOPPER_DB_PROP_KEY = 'COPYDESK_HOPPER_DB_ID';
const HOPPER_SHEET_NAME = 'HOPPER';
const DELIVERABLES_SHEET_NAME = 'DELIVERABLES';

// FileRoom Registry API (used for close handoff; idempotent upsert)
const FILEROOM_API_BASE_URL =
  'https://script.google.com/macros/s/AKfycbyZauMq2R6mIElFnAWVbWRDVgJqT713sT_PTdsixNi9IyZx-a3yiFT7bjk8XE_Fd709/exec';

// Frontend job view (used as OpenUrl in FileRoom)
const COPYDESK_JOB_VIEW_URL =
  'https://jacobeugenehenderson.github.io/ascend-portal/copydesk/frontend/job.html';

// Normalize style labels for robust comparison
function normalizeStyleLabel_(label) {
  if (label == null) return '';
  return String(label).trim().toLowerCase();
}

// -----------------------------
// Job status (ScriptProperties)
// -----------------------------
function jobStatusKey_(jobId) {
  return 'JOB_STATUS::' + String(jobId || '').trim();
}
function getJobStatus_(jobId) {
  if (!jobId) return { status: 'Active', closedAt: '' };
  var raw = PropertiesService.getScriptProperties().getProperty(jobStatusKey_(jobId));
  if (!raw) return { status: 'Active', closedAt: '' };
  try {
    var o = JSON.parse(raw);
    return {
      status: o && o.status ? String(o.status) : 'Active',
      closedAt: o && o.closedAt ? String(o.closedAt) : ''
    };
  } catch (e) {
    return { status: String(raw), closedAt: '' };
  }
}
function setJobStatus_(jobId, status, closedAtIso) {
  if (!jobId) return;
  var payload = {
    status: String(status || 'Active'),
    closedAt: closedAtIso ? String(closedAtIso) : ''
  };
  PropertiesService.getScriptProperties().setProperty(jobStatusKey_(jobId), JSON.stringify(payload));
}
function isJobClosed_(jobId) {
  var st = getJobStatus_(jobId);
  return String(st.status || '').toLowerCase() === 'closed';
}

// -----------------------------
// Subjob status (ScriptProperties)
// -----------------------------
function subjobStatusKey_(jobId, lang) {
  return 'SUBJOB_STATUS::' + String(jobId || '').trim() + '::' + String(lang || '').trim().toUpperCase();
}
function getSubjobStatus_(jobId, lang) {
  if (!jobId || !lang) return { status: '', finishedAt: '', touchedAt: '' };
  var raw = PropertiesService.getScriptProperties().getProperty(subjobStatusKey_(jobId, lang));
  if (!raw) return { status: '', finishedAt: '', touchedAt: '' };
  try {
    var o = JSON.parse(raw);
    return {
      status: o && o.status ? String(o.status) : '',
      finishedAt: o && o.finishedAt ? String(o.finishedAt) : '',
      touchedAt: o && o.touchedAt ? String(o.touchedAt) : ''
    };
  } catch (e) {
    return { status: String(raw), finishedAt: '', touchedAt: '' };
  }
}
function setSubjobStatus_(jobId, lang, status, finishedAtIso, touchedAtIso) {
  if (!jobId || !lang) return;
  var payload = {
    status: String(status || ''),
    finishedAt: finishedAtIso ? String(finishedAtIso) : '',
    touchedAt: touchedAtIso ? String(touchedAtIso) : ''
  };
  PropertiesService.getScriptProperties().setProperty(subjobStatusKey_(jobId, lang), JSON.stringify(payload));
}
function isSubjobFinished_(jobId, lang) {
  var st = getSubjobStatus_(jobId, lang);
  return String(st.status || '').toLowerCase() === 'finished';
}

// Utility: list all known jobIds from the JOB_INDEX:: cache
function listKnownJobIds_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var out = [];
  for (var k in props) {
    if (!props.hasOwnProperty(k)) continue;
    if (k.indexOf('JOB_INDEX::') === 0) {
      out.push(k.replace('JOB_INDEX::', ''));
    }
  }
  return out;
}

// -----------------------------
// Translation subjobs payload (frontend pills)
// -----------------------------
function buildTranslationSubjobsPayload_(ss, jobId) {
  var langs = [
    { code: 'ES', name: 'Spanish' },
    { code: 'FR', name: 'French' },
    { code: 'DE', name: 'German' },
    { code: 'IT', name: 'Italian' },
    { code: 'PT', name: 'Portuguese' },
    { code: 'ZH', name: 'Chinese' },
    { code: 'JA', name: 'Japanese' },
    { code: 'KO', name: 'Korean' }
  ];

  function hasHumanEdits_(sh) {
    if (!sh) return false;
    var startRow = 11;
    var lastRow = sh.getLastRow();
    if (lastRow < startRow) return false;

    // Human working surface is Column C (3)
    var vals = sh.getRange(startRow, 3, lastRow - startRow + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] == null ? '' : vals[i][0]).trim();
      if (v) return true;
    }
    return false;
  }

  var out = [];
  for (var i = 0; i < langs.length; i++) {
    var code = langs[i].code;
    var shName = 'JOB_' + code;
    var sh = ss.getSheetByName(shName);
    if (!sh) continue;

    var status = hasHumanEdits_(sh) ? 'human' : 'seed';

    var st = getSubjobStatus_(jobId, code);

    // Explicit touched (meaningful human edit) beats seed/human.
    if (st && (String(st.status || '').toLowerCase() === 'touched' || st.touchedAt)) {
      status = 'touched';
    }

    // Finished wins last.
    if (st && String(st.status || '').toLowerCase() === 'finished') {
      status = 'finished';
    }

    out.push({
      lang: code,
      language: langs[i].name,
      sheetName: shName,
      status: status,
      finishedAt: (st && st.finishedAt) ? String(st.finishedAt) : '',
      touchedAt: (st && st.touchedAt) ? String(st.touchedAt) : '',
      href: 'subjob.html?jobid=' + encodeURIComponent(String(jobId || '')) + '&lang=' + encodeURIComponent(code)
    });
  }

  return out;
}

// Create language sheets inside the same job spreadsheet (simple v0 closeout).
// Each sheet is a copy of JOB_EN with a language suffix and cleared working cols.
// You can refine later; this is deterministic and “no libraries”.
function createLanguageSheetsOnClose_(ss) {
  var langs = [
    { code: 'ES', name: 'Spanish' },
    { code: 'FR', name: 'French' },
    { code: 'DE', name: 'German' },
    { code: 'IT', name: 'Italian' },
    { code: 'PT', name: 'Portuguese' },
    { code: 'ZH', name: 'Chinese' },
    { code: 'JA', name: 'Japanese' },
    { code: 'KO', name: 'Korean' }
  ];

  var base = ss.getSheetByName(JOB_EN_SHEET_NAME);
  if (!base) return { created: 0 };

  var created = 0;
  for (var i = 0; i < langs.length; i++) {
    var shName = 'JOB_' + langs[i].code;
    if (ss.getSheetByName(shName)) continue;

    var copy = base.copyTo(ss).setName(shName);

    // Clear human working column C (rows 11+) and ensure a Machine Translation column H exists + is cleared.
    try {
      var headerRow = 10;
      var startRow = 11;
      var lastRow = copy.getLastRow();

      // Clear Column C (human working surface for this language)
      if (lastRow >= startRow) {
        copy.getRange(startRow, 3, lastRow - startRow + 1, 1).clearContent();
      }

      // Ensure Column H exists (8). If the sheet is only A–G, add one column.
      // (copy of JOB_EN may already have >7 cols; this is safe either way.)
      if (copy.getMaxColumns() < 8) {
        copy.insertColumnAfter(7);
      }

      // Ensure Column I exists (9) for per-segment translator notes.
      if (copy.getMaxColumns() < 9) {
        copy.insertColumnAfter(8);
      }

      // Header labels
      copy.getRange(headerRow, 8).setValue('Machine Translation');
      copy.getRange(headerRow, 9).setValue('Translator Notes');

      // Clear Column H (machine translation surface)
      if (lastRow >= startRow) {
        copy.getRange(startRow, 8, lastRow - startRow + 1, 1).clearContent();
      }

      // Clear Column I (translator notes surface)
      if (lastRow >= startRow) {
        copy.getRange(startRow, 9, lastRow - startRow + 1, 1).clearContent();
      }
    } catch (e) {}

    created++;
  }

  return { created: created };
}

// Public runner: commit + (optionally) close
function runNightlyCommitAll_() {
  var jobIds = listKnownJobIds_();
  var results = [];
  for (var i = 0; i < jobIds.length; i++) {
    var jid = jobIds[i];
    if (!jid || isJobClosed_(jid)) continue;
    try {
      // Same canonical path used by Push
      var state = handleCommitJob_({ jobId: jid });
      results.push({ jobId: jid, ok: true, commit: state && state.commit ? state.commit : null });
    } catch (e) {
      results.push({ jobId: jid, ok: false, error: String(e) });
    }
  }
  return { ok: true, jobs: results };
}

// Normalize cutoff values before sending them to the frontend.
// - If JOB_EN!B4 is a Date, send it as "yyyy-MM-dd" in the script timezone.
// - If it's already a string, just stringify it.
function formatCutoffForClient_(value) {
  if (!value) return '';

  // Date object from Sheets
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    var tz = Session.getScriptTimeZone() || 'US/Eastern';
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }

  // Anything else (string, number, etc.)
  return String(value);
}


// Where to put new job copies in Drive (for now, parent of template)
function getJobsFolder_() {
  const templateFile = DriveApp.getFileById(TEMPLATE_SPREADSHEET_ID);

  // Parent folder of the MASTER_TEMPLATE; fallback to root if weirdly missing.
  const parent = templateFile.getParents().hasNext()
    ? templateFile.getParents().next()
    : DriveApp.getRootFolder();

  // Look for an existing "Jobs" folder under the parent.
  const existing = parent.getFoldersByName(JOBS_FOLDER_NAME);
  if (existing.hasNext()) {
    return existing.next();
  }

  // If it doesn't exist yet, create it.
  return parent.createFolder(JOBS_FOLDER_NAME);
}

function jobIndexKey_(jobId) {
  return 'JOB_INDEX::' + String(jobId || '').trim();
}

function setJobIndex_(jobId, spreadsheetId) {
  if (!jobId || !spreadsheetId) return;
  PropertiesService.getScriptProperties().setProperty(jobIndexKey_(jobId), String(spreadsheetId));
}

function getSpreadsheetIdForJobId_(jobId) {
  if (!jobId) return '';

  // Fast path: PropertiesService cache
  var cached = PropertiesService.getScriptProperties().getProperty(jobIndexKey_(jobId));
  if (cached) return String(cached);

  // Safety net (temporary): fall back to scan, then persist
  var scanned = findSpreadsheetIdByJobId_(jobId);
  if (scanned) setJobIndex_(jobId, scanned);
  return scanned || '';
}

function findSpreadsheetIdByJobId_(jobId) {
  if (!jobId) return '';

  // Search all Google Sheets files in the Jobs folder.
  // (Motion-first: brute force scan; we can add caching later.)
  var folder = getJobsFolder_();
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (files.hasNext()) {
    var file = files.next();
    try {
      var ss = SpreadsheetApp.openById(file.getId());
      var sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);
      if (!sheet) continue;

      var candidate = String(sheet.getRange('B1').getValue() || '').trim();
      if (candidate && candidate === String(jobId).trim()) {
        return ss.getId();
      }
    } catch (e) {
      // Ignore unreadable files and keep scanning
    }
  }

  return '';
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------
// Card regime (CARDS sheet)
// Columns:
// A CardId | B SegmentId | C OrderIndex (0-based slot index) | D WorkingStyle | E WorkingText | F Notes | G UpdatedAt
// -----------------------------

// -----------------------------
// Ghost slots regime (GHOST_SLOTS sheet)
// Columns:
// A SlotIndex (0-based slot index)
// -----------------------------
function getOrCreateGhostSlotsSheet_(ss) {
  var sh = ss.getSheetByName(GHOST_SLOTS_SHEET_NAME);
  if (sh) return sh;

  sh = ss.insertSheet(GHOST_SLOTS_SHEET_NAME);
  sh.getRange(1, 1, 1, 1).setValues([['SlotIndex']]);
  return sh;
}

function readGhostSlots_(ss) {
  var sh = getOrCreateGhostSlotsSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];

  var values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var n = Number(values[i][0]);
    if (isNaN(n) || n < 0) continue;
    out.push(n);
  }

  // unique + sort
  var seen = {};
  var uniq = [];
  for (var j = 0; j < out.length; j++) {
    var k = String(out[j]);
    if (seen[k]) continue;
    seen[k] = true;
    uniq.push(out[j]);
  }
  uniq.sort(function (a, b) { return a - b; });
  return uniq;
}

function writeGhostSlots_(ss, slots) {
  var sh = getOrCreateGhostSlotsSheet_(ss);

  // clear all rows except header
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).clearContent();
  }

  slots = (slots || []).slice();
  // normalize: numbers, >=0, unique, sorted
  var seen = {};
  var norm = [];
  for (var i = 0; i < slots.length; i++) {
    var n = Number(slots[i]);
    if (isNaN(n) || n < 0) continue;
    var key = String(n);
    if (seen[key]) continue;
    seen[key] = true;
    norm.push(n);
  }
  norm.sort(function (a, b) { return a - b; });

  if (!norm.length) return;
  var rows = norm.map(function (n) { return [n]; });
  sh.getRange(2, 1, rows.length, 1).setValues(rows);
}

// Shift ghost slots on insert/delete at an index
function shiftGhostSlotsOnInsert_(slots, insertAt) {
  slots = (slots || []).slice();
  var out = [];
  for (var i = 0; i < slots.length; i++) {
    var n = Number(slots[i]);
    if (isNaN(n) || n < 0) continue;
    out.push(n >= insertAt ? (n + 1) : n);
  }
  out.push(insertAt);
  return out;
}

function shiftGhostSlotsOnDelete_(slots, slotIndex) {
  slots = (slots || []).slice();
  var out = [];
  for (var i = 0; i < slots.length; i++) {
    var n = Number(slots[i]);
    if (isNaN(n) || n < 0) continue;
    if (n === slotIndex) continue;           // remove the target
    out.push(n > slotIndex ? (n - 1) : n);    // pull up everything below
  }
  return out;
}

// IMPORTANT: inserting/removing a ghost slot changes the slot grid.
// To preserve lane alignment, we must shift ALL cards at/after the insertion point.
function shiftCardsOrderIndexOnInsert_(ss, insertAt) {
  var sh = getOrCreateCardsSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return;

  var rng = sh.getRange(2, 1, lastRow - 1, 7);
  var vals = rng.getValues();

  for (var i = 0; i < vals.length; i++) {
    var oi = Number(vals[i][2]); // col C
    if (!isNaN(oi) && oi >= insertAt) {
      vals[i][2] = oi + 1;
    }
  }
  rng.setValues(vals);
}

function shiftCardsOrderIndexOnDelete_(ss, slotIndex) {
  var sh = getOrCreateCardsSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return;

  var rng = sh.getRange(2, 1, lastRow - 1, 7);
  var vals = rng.getValues();

  for (var i = 0; i < vals.length; i++) {
    var oi = Number(vals[i][2]); // col C
    if (!isNaN(oi) && oi > slotIndex) {
      vals[i][2] = oi - 1;
    }
  }
  rng.setValues(vals);
}
function getOrCreateCardsSheet_(ss) {
  var sh = ss.getSheetByName(CARDS_SHEET_NAME);
  if (sh) return sh;

  sh = ss.insertSheet(CARDS_SHEET_NAME);
  sh.getRange(1, 1, 1, 7).setValues([[
    'CardId',
    'SegmentId',
    'OrderIndex',
    'WorkingStyle',
    'WorkingText',
    'Notes',
    'UpdatedAt'
  ]]);
  return sh;
}

function readCards_(ss) {
  var sh = getOrCreateCardsSheet_(ss);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];
  var values = sh.getRange(1, 1, lastRow, 7).getValues();
  if (!values || values.length <= 1) return [];

  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var cardId = r[0];
    if (!cardId) continue;
    var oi = Number(r[2]);
    if (isNaN(oi)) continue; // ignore malformed rows instead of collapsing to slot 0

    out.push({
      cardId: String(r[0]),
      segmentId: String(r[1] || ''),
      orderIndex: oi,
      workingStyle: String(r[3] || ''),
      workingText: String(r[4] || ''),
      notes: String(r[5] || ''),
      updatedAt: r[6] || null
    });
  }

  out.sort(function (a, b) { return (a.orderIndex || 0) - (b.orderIndex || 0); });
  return out;
}

function findCardRowById_(sh, cardId) {
  if (!cardId) return 0;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  var range = sh.getRange(2, 1, lastRow - 1, 1); // col A, skip header
  var finder = range.createTextFinder(String(cardId)).matchEntireCell(true);
  var cell = finder.findNext();
  return cell ? cell.getRow() : 0;
}

function updateCardRowFields_(ss, cardId, fields) {
  var sh = getOrCreateCardsSheet_(ss);
  var row = findCardRowById_(sh, cardId);
  if (!row) return false;

  // Columns:
  // A CardId | B SegmentId | C OrderIndex | D WorkingStyle | E WorkingText | F Notes | G UpdatedAt
  if (fields.orderIndex != null) sh.getRange(row, 3).setValue(Number(fields.orderIndex));
  if (fields.workingStyle != null) sh.getRange(row, 4).setValue(String(fields.workingStyle));
  if (fields.workingText != null) sh.getRange(row, 5).setValue(String(fields.workingText));
  if (fields.notes != null)       sh.getRange(row, 6).setValue(String(fields.notes));

  // Always touch UpdatedAt when mutating a row
  sh.getRange(row, 7).setValue(new Date());
  return true;
}

function deleteCardRowById_(ss, cardId) {
  var sh = getOrCreateCardsSheet_(ss);
  var row = findCardRowById_(sh, cardId);
  if (!row) return false;
  sh.deleteRow(row);
  return true;
}

function appendCardRow_(ss, rowValues) {
  var sh = getOrCreateCardsSheet_(ss);
  sh.appendRow(rowValues);
}

function writeCards_(ss, cards) {
  var sh = getOrCreateCardsSheet_(ss);

  // clear all rows except header
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 7).clearContent();
  }

  if (!cards || !cards.length) return;

  // IMPORTANT:
  // Do NOT renormalize orderIndex. Gaps are meaningful (empty slots).
  // We only sort for stable writing, but we preserve each card's orderIndex.
  cards = cards.slice().sort(function (a, b) {
    return (a.orderIndex || 0) - (b.orderIndex || 0);
  });

  var rows = cards.map(function (c) {
    return [
      c.cardId || '',
      c.segmentId || '',
      (c.orderIndex == null || isNaN(Number(c.orderIndex))) ? '' : Number(c.orderIndex),
      c.workingStyle || '',
      c.workingText || '',
      c.notes || '',
      c.updatedAt || new Date()
    ];
  });

  sh.getRange(2, 1, rows.length, 7).setValues(rows);
}

function doGet(e) {
  // Default "info" payload (also used when JSONP has no action)
  var payload = {
    ok: true,
    apiVersion: COPYDESK_API_VERSION,
    hasInsertGhostSlot: true,
    note: 'CopyDesk API supports JSONP via doGet when callback is provided. Use ?callback=CB&action=...&payload=... (payload is JSON).'
  };

  var p = (e && e.parameter) ? e.parameter : {};
  var cb = p && p.callback ? String(p.callback) : '';

  // JSONP action path:
  // <script src=".../exec?callback=CB&action=getJob&payload={...}">
  if (cb && p && p.action) {
    try {
      var body = {};
      if (p.payload) {
        body = JSON.parse(String(p.payload));
      } else {
        // Allow simple key/value calls without payload JSON (best-effort)
        body = {};
      }

      // Ensure action is set (payload may omit it)
      body.action = body.action || body.fn || String(p.action);

      var out = routeCopydeskAction_(body);

      return ContentService
        .createTextOutput(cb + '(' + JSON.stringify(out) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);

    } catch (err) {
      var fail = { ok: false, error: String(err), stack: err && err.stack ? err.stack : '' };
      return ContentService
        .createTextOutput(cb + '(' + JSON.stringify(fail) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
  }

  // JSONP info path (no action)
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // Plain GET (debug/info)
  return jsonResponse_(payload);
}

// Shared action router (used by BOTH doPost JSON and doGet JSONP)
// Returns a plain object (NOT a ContentService output).
function routeCopydeskAction_(body) {
  const action = (body && (body.action || body.fn)) ? String(body.action || body.fn) : '';

  if (action === 'createEnglishJob') {
    return handleCreateEnglishJob_(body);
  } else if (action === 'saveDraft' || action === 'updateSegment') {
    // Card-regime hard rule:
    // clients must never write JOB_EN working columns directly.
    // HOWEVER: translation subjobs (JOB_XX) are segment-based and MUST be writable.
    var lang = (body && body.lang != null) ? String(body.lang).trim().toUpperCase() : '';
    if (lang) {
      return handleUpdateSegment_(body);
    }
    return { ok: false, error: 'Direct segment edits are disabled in card regime. Use createCard/saveCard.' };
  } else if (action === 'getJob') {
    return handleGetJob_(body);
  } else if (action === 'createCard') {
    return handleCreateCard_(body);
  } else if (action === 'saveCard') {
    return handleSaveCard_(body);
  } else if (action === 'deleteCard') {
    return handleDeleteCard_(body);
  } else if (action === 'moveCard') {
    return handleMoveCard_(body);
  } else if (action === 'mutateCard') {
    return handleMutateCard_(body);
  } else if (action === 'insertGhostSlot') {
    return handleInsertGhostSlot_(body);
  } else if (action === 'deleteGhostSlot') {
    return handleDeleteGhostSlot_(body);
  } else if (action === 'commitJob') {
    return handleCommitJob_(body);
  } else if (action === 'closeJob') {
    return handleCloseJob_(body);
  } else if (action === 'runNightly') {
    return handleRunNightly_(body);
  } else if (action === 'finishSubjob') {
    return handleFinishSubjob_(body);

  // ---- Hopper parity (Copydesk jobs list + dismiss) ----
  } else if (action === 'listCopydeskJobsForUser') {
    return handleListCopydeskJobsForUser_(body);
  } else if (action === 'dismissCopydeskJob') {
    return handleDismissCopydeskJob_(body);

  // ---- FileRoom-style outputs (served here until FileRoom API is wired) ----
  } else if (action === 'listDeliverablesForUser') {
    return handleListDeliverablesForUser_(body);

  } else {
    return { ok: false, error: 'Unknown action: ' + action };
  }
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};

    var out = routeCopydeskAction_(body);
    return jsonResponse_(out);

  } catch (err) {
    return jsonResponse_({ ok: false, error: err.toString(), stack: err.stack });
  }
}

function handleSaveDraft_(body) {
  // New frontend contract:
  // { jobId, segmentId, workingStyle, workingText }
  const { jobId, segmentId, workingText, workingStyle } = body;

  const spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) {
    return { ok: false, error: 'Job not found for jobId: ' + jobId };
  }

  // Delegate to existing logic (styleLabel == workingStyle)
  return handleUpdateSegment_({
    spreadsheetId: spreadsheetId,
    segmentId: segmentId,
    workingText: workingText,
    styleLabel: workingStyle
  });
}
function handleUpdateSegment_(body) {

  const { spreadsheetId, segmentId, workingText, styleLabel, notes } = body;

  const ss = SpreadsheetApp.openById(spreadsheetId);

  // If a lang is provided (e.g., "FR"), read from JOB_FR.
  // Fallback to JOB_EN for safety.
  var lang = (body && body.lang != null) ? String(body.lang).trim().toUpperCase() : '';
  var sheetName = lang ? ('JOB_' + lang) : JOB_EN_SHEET_NAME;

  const sheet =
    ss.getSheetByName(sheetName) ||
    ss.getSheetByName(JOB_EN_SHEET_NAME);

  // Read rows 11+ (A–I for lang sheets, A–F for JOB_EN but we still search by SegmentID in D)
  const startRow = 11;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) {
    throw new Error("No segments found (sheet has no data rows yet).");
  }
  const numRows = lastRow - startRow + 1;

  var width = lang ? 9 : 6;
  const data = sheet.getRange(startRow, 1, numRows, width).getValues();

  // Locate the matching segmentId in Column D and capture existing values
  let targetRow = null;
  let existingStyle = null;
  let existingWorking = '';
  let existingNotes = '';

  for (let i = 0; i < data.length; i++) {
    if (data[i][3] === segmentId) {  // Column D index = 3
      targetRow = startRow + i;
      existingStyle = data[i][1];    // Column B = StyleLabel
      existingWorking = data[i][2];  // Column C = Working (translation) text
      if (lang) existingNotes = data[i][8]; // Column I = Notes (lang sheets)
      break;
    }
  }

  if (!targetRow) {
    throw new Error("Segment not found: " + segmentId);
  }

  // Determine the effective style label for this update
  const effectiveStyleLabel = styleLabel != null ? styleLabel : existingStyle;
  const normEffectiveStyle = normalizeStyleLabel_(effectiveStyleLabel);
  const normExistingStyle = normalizeStyleLabel_(existingStyle);

  // If this is a section divider, we do NOT change text columns.
  if (normEffectiveStyle === 'section divider') {
    // Still record the style change if requested
    if (styleLabel != null && normalizeStyleLabel_(styleLabel) !== normExistingStyle) {
      sheet.getRange(targetRow, 2).setValue(styleLabel);
    }

    const user = Session.getActiveUser().getEmail() || "SYSTEM";
    const now = new Date();
    sheet.getRange(targetRow, 5).setValue(user);
    sheet.getRange(targetRow, 6).setValue(now);

    return {
      ok: true,
      segmentId,
      row: targetRow,
      styleLabel: effectiveStyleLabel || null,
      lastEditor: user,
      lastEditTime: now
    };
  }

  // Update Style (Column B), if provided (non–section divider rows)
  if (styleLabel != null && normalizeStyleLabel_(styleLabel) !== normExistingStyle) {
    sheet.getRange(targetRow, 2).setValue(styleLabel);
  }

  // Normalize Working English for Bullet style
  let finalWorking = workingText;

  if (normEffectiveStyle === 'bullet') {
    const raw = (workingText == null ? '' : String(workingText)).trimStart();

    if (raw.length) {
      if (raw[0] === '•') {
        // Ensure exactly one bullet + one space
        finalWorking = '• ' + raw.replace(/^•\s*/, '');
      } else {
        finalWorking = '• ' + raw;
      }
    } else {
      // empty is allowed
      finalWorking = '';
    }
  }

  // If this is a translation sheet: first meaningful edit marks the subjob as TOUCHED.
// (Meaningful = working text changes from its prior saved value.)
  if (lang) {
    var jobId = (body && body.jobId != null) ? String(body.jobId).trim() : '';
    if (jobId) {
      var st0 = getSubjobStatus_(jobId, lang);

      var isFinished = (String(st0.status || '').toLowerCase() === 'finished');
      var hasTouched = !!(st0 && st0.touchedAt);

      if (!isFinished && !hasTouched) {
        var prev = String(existingWorking == null ? '' : existingWorking);
        var next = String(finalWorking == null ? '' : finalWorking);

        if (prev !== next) {
          setSubjobStatus_(jobId, lang, 'touched', (st0 && st0.finishedAt) ? st0.finishedAt : '', new Date().toISOString());
        }
      }
    }
  }

// Update Working English (Column C)
  sheet.getRange(targetRow, 3).setValue(finalWorking);

  // Update Translator Notes (Column I) for language sheets only
  if (lang) {
    sheet.getRange(targetRow, 9).setValue(notes == null ? '' : String(notes));
  }

  // Update LastEditor / LastEditTime (Columns E and F)
  const user = Session.getActiveUser().getEmail() || "SYSTEM";
  const now = new Date();

  sheet.getRange(targetRow, 5).setValue(user);
  sheet.getRange(targetRow, 6).setValue(now);

  return {
    ok: true,
    segmentId,
    row: targetRow,
    styleLabel: effectiveStyleLabel || null,
    lastEditor: user,
    lastEditTime: now
  };
}

function handleCreateCard_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var segmentId = body && body.segmentId ? String(body.segmentId) : '';
  var insertAt = (body && body.insertAt != null) ? Number(body.insertAt) : -1;

  // Optional seeds provided by client (preferred; avoids sheet scan latency)
  var seedText = (body && body.seedText != null) ? String(body.seedText) : null;
  var seedStyle = (body && body.seedStyle != null) ? String(body.seedStyle) : null;

  if (!jobId) return { ok: false, error: 'Missing jobId' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var cards = readCards_(ss);

  // Hard rule: one card per segmentId (prevents duplicate children)
  if (segmentId && segmentId.indexOf('new:') !== 0) {
    for (var x = 0; x < cards.length; x++) {
      if (cards[x] && String(cards[x].segmentId || '') === segmentId) {
        return { ok: true, card: cards[x], alreadyExisted: true };
      }
    }
  }

  // Create a new cardId
  var cardId = 'card_' + Utilities.getUuid();

  // Default style/text for a new card.
  // Prefer client-provided seeds (fast path). Fallback: seed from JOB_EN committed (slow path).
  var defaultStyle = 'Body';
  var defaultText = '';

  if (seedStyle != null && seedStyle !== '') defaultStyle = seedStyle;
  if (seedText != null) defaultText = seedText;

  if ((seedText == null || seedStyle == null) && segmentId && segmentId.indexOf('new:') !== 0) {
    try {
      var sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);
      var startRow = 11;
      var lastRow = sheet.getLastRow();
      if (lastRow >= startRow) {
        var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, 7).getValues();
        for (var i = 0; i < values.length; i++) {
          var r = values[i];
          if (r[3] === segmentId) { // D
            if (seedStyle == null) defaultStyle = String(r[6] || r[1] || defaultStyle); // prefer committed style (G)
            if (seedText == null) defaultText = String(r[0] || defaultText);            // committed text (A)
            break;
          }
        }
      }
    } catch (e) {}
  }

  // Compute max orderIndex (used only for default append behavior)
  var maxOrder = -1;
  for (var m = 0; m < cards.length; m++) {
    var oi = Number(cards[m].orderIndex);
    if (isNaN(oi)) continue;
    if (oi > maxOrder) maxOrder = oi;
  }

  // Default append: after the last occupied slot
  var orderIndex = maxOrder + 1; // if no cards, becomes 0

  // INSERT behavior:
  // Slot-grid changes (and shifting other cards) are handled by insertGhostSlot().
  // createCard() only places the new card at the requested slot.
  if (insertAt != null && insertAt >= 0) {
    orderIndex = insertAt;
  }

  var seg = segmentId || ('new:' + Utilities.getUuid());

  appendCardRow_(ss, [
    cardId,
    seg,
    orderIndex,
    defaultStyle,
    defaultText,
    '',          // Notes
    new Date()   // UpdatedAt
  ]);

  return {
  ok: true,
  card: {
    cardId: cardId,
    segmentId: seg,
    orderIndex: orderIndex,
    workingStyle: defaultStyle,
    workingText: defaultText,
    updatedAt: new Date()
  }
};
}

function handleSaveCard_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var cardId = body && body.cardId ? String(body.cardId) : '';
  var workingStyle = body && body.workingStyle != null ? String(body.workingStyle) : '';
  var workingText = body && body.workingText != null ? String(body.workingText) : '';
  var notes = body && body.notes != null ? String(body.notes) : '';

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!cardId) return { ok: false, error: 'Missing cardId' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);

  var ok = updateCardRowFields_(ss, cardId, {
    workingStyle: workingStyle,
    workingText: workingText,
    notes: notes
  });

  if (!ok) return { ok: false, error: 'Card not found: ' + cardId };
  return { ok: true };
}

function handleDeleteCard_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var cardId = body && body.cardId ? String(body.cardId) : '';

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!cardId) return { ok: false, error: 'Missing cardId' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);

  // Find segmentId from the CARDS row (no full-table rewrite)
  var sh = getOrCreateCardsSheet_(ss);
  var row = findCardRowById_(sh, cardId);
  if (!row) return { ok: false, error: 'Card not found: ' + cardId };

  var segId = String(sh.getRange(row, 2).getValue() || '');

  // Delete just this row
  sh.deleteRow(row);

  // Scrub dirty state for existing segments:
  // reset JOB_EN working columns to committed (and committed style if present).
  if (segId && segId.indexOf('new:') !== 0) {
    try {
      var sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);
      var startRow = 11;
      var lastRow = sheet.getLastRow();
      if (lastRow >= startRow) {
        var numRows = lastRow - startRow + 1;
        var data = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var r = 0; r < data.length; r++) {
          var seg = String(data[r][3] || '');
          if (seg === segId) {
            // committed text/style → working text/style
            sheet.getRange(startRow + r, 3).setValue(data[r][0] || '');
            sheet.getRange(startRow + r, 2).setValue(data[r][6] || data[r][1] || '');
            break;
          }
        }
      }
    } catch (e) {}
  }

  return { ok: true };
}

function handleMoveCard_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var cardId = body && body.cardId ? String(body.cardId) : '';
  var direction = body && body.direction === 'up' ? 'up' : 'down';

  // Optional: allow move to also persist the moving card's current draft in the SAME call
  var workingStyle = (body && body.workingStyle != null) ? String(body.workingStyle) : null;
  var workingText  = (body && body.workingText  != null) ? String(body.workingText)  : null;

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!cardId) return { ok: false, error: 'Missing cardId' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var cards = readCards_(ss) || [];

  // Find moving card
  var moving = null;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i] && String(cards[i].cardId) === cardId) {
      moving = cards[i];
      break;
    }
  }
  if (!moving) return { ok: false, error: 'Card not found: ' + cardId };

  var cur = (moving && moving.orderIndex != null) ? Number(moving.orderIndex) : NaN;
  if (isNaN(cur)) return { ok: false, error: 'Card has invalid orderIndex: ' + cardId };

  var target = (direction === 'up') ? (cur - 1) : (cur + 1);
  if (target < 0) return { ok: true, cards: cards };

  // Find occupant card (if any) at the target slot
  var occupant = null;
  for (var j = 0; j < cards.length; j++) {
    if (cards[j] && Number(cards[j].orderIndex) === target) {
      occupant = cards[j];
      break;
    }
  }

  // Build fields update for moving card
  var movingFields = { orderIndex: target };
  if (workingStyle != null) movingFields.workingStyle = workingStyle;
  if (workingText  != null) movingFields.workingText  = workingText;

  if (!occupant) {
    // Move into empty slot: update only moving row
    var ok1 = updateCardRowFields_(ss, moving.cardId, movingFields);
    if (!ok1) return { ok: false, error: 'Card not found: ' + cardId };

    // Update in-memory array so frontend can use returned cards immediately
    moving.orderIndex = target;
    if (workingStyle != null) moving.workingStyle = workingStyle;
    if (workingText  != null) moving.workingText  = workingText;

    return { ok: true, cards: cards };
  }

  // Swap with occupant
  var okA = updateCardRowFields_(ss, moving.cardId, movingFields);
  var okB = updateCardRowFields_(ss, occupant.cardId, { orderIndex: cur });

  if (!okA) return { ok: false, error: 'Card not found: ' + moving.cardId };
  if (!okB) return { ok: false, error: 'Card not found: ' + occupant.cardId };

  // Update in-memory array
  moving.orderIndex = target;
  if (workingStyle != null) moving.workingStyle = workingStyle;
  if (workingText  != null) moving.workingText  = workingText;
  occupant.orderIndex = cur;

  return { ok: true, cards: cards };
}

function handleMutateCard_(body) {
  var jobId = body.jobId;
  var op = String(body.op || '');
  var payload = body.payload || {};

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!op) return { ok: false, error: 'Missing op' };

  if (op === 'create') {
    return handleCreateCard_({
      jobId: jobId,
      segmentId: payload.segmentId || '',
      insertAt: payload.insertAt,
      seedText: payload.seedText,
      seedStyle: payload.seedStyle
    });
  }

  if (op === 'move') {
    return handleMoveCard_({
      jobId: jobId,
      cardId: payload.cardId,
      direction: payload.direction
    });
  }

  if (op === 'delete') {
    return handleDeleteCard_({
      jobId: jobId,
      cardId: payload.cardId
    });
  }

  if (op === 'save') {
    return handleSaveCard_({
      jobId: jobId,
      cardId: payload.cardId,
      workingStyle: payload.workingStyle,
      workingText: payload.workingText
    });
  }

  return { ok: false, error: 'Unknown mutate op: ' + op };
}

function handleInsertGhostSlot_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var insertAt = (body && body.insertAt != null) ? Number(body.insertAt) : NaN;

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (isNaN(insertAt) || insertAt < 0) return { ok: false, error: 'Missing/invalid insertAt' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);

  // 1) shift ghost slots + add the new one
  var slots = readGhostSlots_(ss);
  slots = shiftGhostSlotsOnInsert_(slots, insertAt);
  writeGhostSlots_(ss, slots);

  // 2) shift cards to preserve alignment with committed lane
  shiftCardsOrderIndexOnInsert_(ss, insertAt);

  return { ok: true, ghostSlots: readGhostSlots_(ss) };
}

function handleDeleteGhostSlot_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  var slotIndex = (body && body.slotIndex != null) ? Number(body.slotIndex) : NaN;

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (isNaN(slotIndex) || slotIndex < 0) return { ok: false, error: 'Missing/invalid slotIndex' };

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);

  // 1) remove + pull up ghost slots below it
  var slots = readGhostSlots_(ss);
  slots = shiftGhostSlotsOnDelete_(slots, slotIndex);
  writeGhostSlots_(ss, slots);

  // 2) shift cards to preserve alignment with committed lane
  shiftCardsOrderIndexOnDelete_(ss, slotIndex);

  return { ok: true, ghostSlots: readGhostSlots_(ss) };
}

function handleGetJob_(body) {
  try {
    const spreadsheetId =
      body.spreadsheetId ||
      (body.jobId ? getSpreadsheetIdForJobId_(body.jobId) : '');

    if (!spreadsheetId) {
      return { ok: false, error: 'Missing spreadsheetId/jobId or job not found.' };
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);

    // Lang-aware sheet selection (subjobs pass body.lang, e.g. "FR")
    var lang = (body && body.lang != null) ? String(body.lang).trim().toUpperCase() : '';
    var sheetName = lang ? ('JOB_' + lang) : JOB_EN_SHEET_NAME;

    const sheet =
      ss.getSheetByName(sheetName) ||
      ss.getSheetByName(JOB_EN_SHEET_NAME);

    if (!sheet) {
      return {
        ok: false,
        error: 'JOB_EN sheet not found in spreadsheet ' + spreadsheetId
      };
    }

    // ----- HEADER (B1–B7 + CONTROL_PANEL) -----
    // Default to values stored on the JOB_EN sheet…
    let timezone = sheet.getRange("B5").getValue();
    let nightly = sheet.getRange("B6").getDisplayValue();

    // …but prefer GLOBAL_SETTINGS in CONTROL_PANEL if available.
    const controlPanel = ss.getSheetByName(CONTROL_PANEL_SHEET_NAME);
    if (controlPanel) {
      const panelTimezone = controlPanel.getRange("B2").getValue();        // "US/Eastern"
      const panelNightly = controlPanel.getRange("B3").getDisplayValue();  // "0:00"
      if (panelTimezone) timezone = panelTimezone;
      if (panelNightly) nightly = panelNightly;
    }

    const header = {
      jobId: sheet.getRange("B1").getValue(),
      jobName: sheet.getRange("B2").getValue(),
      createdAt: sheet.getRange("B3").getValue(),
      cutoff: formatCutoffForClient_(sheet.getRange("B4").getValue()),
      timezone: timezone,
      nightly: nightly,
      collaborators: (function () {
        var v = sheet.getRange("B7").getValue();
        return String(v == null ? '' : v).trim();
      })()
    };

// ----- SEGMENTS -----
// JOB_EN uses A–G.
// JOB_XX uses A–H (H = Machine Translation).
const startRow = 11;
const lastRow = sheet.getLastRow();
const segments = [];

var width = lang ? 9 : 7;

if (lastRow >= startRow) {
  var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();

  // If this is a language sheet and MT is missing, generate it now (idempotent),
  // then re-read the table so machineText comes back populated.
  if (lang) {
    var needsMt = false;

    for (var _i = 0; _i < values.length; _i++) {
      var _row = values[_i];
      var _committed = String(_row[0] == null ? '' : _row[0]).trim();
      var _ws = normalizeStyleLabel_(_row[1] || '');
      var _cs = normalizeStyleLabel_(_row[6] || '');
      var _isDivider = (_ws === 'section divider') || (_cs === 'section divider');
      var _machine = String(_row[7] == null ? '' : _row[7]).trim();

      if (_committed && !_isDivider && !_machine) {
        needsMt = true;
        break;
      }
    }

    if (needsMt) {
      machineTranslateLanguageSheetsOnClose_(ss);
      values = sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();
    }
  }

  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
    const segmentId = row[3];
    if (!segmentId) continue;

    const workingStyle = row[1];                  // Col B
    const committedStyle = row[6] || workingStyle;// Col G (fallback to B)
    
    const machineText = lang ? row[7] : '';       // Col H (only on language sheets)
    const translatorNotes = lang ? row[8] : '';   // Col I (only on language sheets)

    segments.push({
      committed: row[0],              // Col A
      style: workingStyle,            // Col B
      styleCommitted: committedStyle, // Col G (fallback to B)
      working: row[2],                // Col C (human working surface)
      machine: machineText,           // Col H (machine translation surface)
      notes: translatorNotes,         // Col I (translator notes surface)
      segmentId: segmentId,           // Col D
      lastEditor: row[4],             // Col E
      lastEditTime: row[5]            // Col F
    });
  }
}

    // ----- STYLES (from this job's STYLE/STYLES sheet) -----
    const styles = buildStylesPayload_(ss);

    // New frontend expects { job, segments, styles }
    // Keep old keys too (header) for backward compat.
    return {
      ok: true,
      apiVersion: COPYDESK_API_VERSION,

      // New shape
      job: (function () {
        var st = getJobStatus_(header.jobId);
        var translations = buildTranslationSubjobsPayload_(ss, header.jobId) || [];
        return {
          jobId: header.jobId,
          jobName: header.jobName,
          dueDate: header.cutoff,
          timezone: header.timezone,
          status: st.status || 'Active',
          closedAt: st.closedAt || '',
          collaborators: header.collaborators,

          // Translation pills payload (aliases for frontend robustness)
          translations: translations,
          translationSubjobs: translations,
          translationJobs: translations
        };
      })(),
      segments: segments.map(function (s) {
        return {
          segmentId: s.segmentId,
          committedText: s.committed,
          workingText: s.working,
          machineText: s.machine || '',
          notesText: s.notes || '',
          workingStyle: s.style,
          committedStyle: s.styleCommitted || s.style || '',
          lastEditedBy: s.lastEditor,
          lastEditedAt: s.lastEditTime
        };
      }),

      // Card regime: card existence IS dirty state.
      // Return both:
      // 1) cards (sparse list)
      // 2) cardSlots (dense array with nulls so the UI cannot collapse gaps accidentally)
      cards: (function () {
        return readCards_(ss).map(function (c) {
          return {
            cardId: c.cardId,
            segmentId: c.segmentId,
            orderIndex: c.orderIndex,
            workingStyle: c.workingStyle,
            workingText: c.workingText,
            notes: c.notes || ''
          };
        });
      })(),

      ghostSlots: (function () {
        return readGhostSlots_(ss) || [];
      })(),

      translations: (function () {
        return buildTranslationSubjobsPayload_(ss, header.jobId) || [];
      })(),

      cardSlots: (function () {
        var list = readCards_(ss) || [];
        var max = -1;
        for (var i = 0; i < list.length; i++) {
          var oi = Number(list[i].orderIndex);
          if (!isNaN(oi) && oi > max) max = oi;
        }
        var slots = [];
        for (var s = 0; s <= max; s++) slots.push(null);

        for (var j = 0; j < list.length; j++) {
          var c = list[j];
          var oi2 = Number(c.orderIndex);
          if (isNaN(oi2) || oi2 < 0) continue;
          slots[oi2] = {
            cardId: c.cardId,
            segmentId: c.segmentId,
            orderIndex: oi2,
            workingStyle: c.workingStyle,
            workingText: c.workingText,
            notes: c.notes || ''
          };
        }
        return slots;
      })(),
      styles: (function () {
        var list = (styles || []).map(function (st) {
          var v = st.styleLabel || st.StyleLabel || '';
          return { value: v, label: v };
        }).filter(function (x) { return x.value; });

        // Fallback so the UI always has *something* usable.
        if (!list.length) {
        list = [
          { value: 'Body', label: 'Body' },
          { value: 'Headline', label: 'Headline' },
          { value: 'Section divider', label: 'Section divider' },
          { value: 'Delete segment', label: 'Delete segment' }
        ];
        }
        return list;
      })(),

      // Backward compat / debugging (keep your existing goodies)
      header: header,
      stylesCss: buildStylesCss_(styles),
      // stylesDebug is expensive; only include when explicitly requested
      stylesDebug: (body && body.debug) ? getStylesDebug_(ss) : null,
      spreadsheetId: spreadsheetId,

      testMarker: 'HELLO_FROM_NEW_DEPLOYMENT'
    };
    
  } catch (err) {
    return {
      ok: false,
      error: err.toString(),
      stack: err.stack
    };
  }
}

function handleCommitJob_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  // Guard: closed jobs cannot be committed
  if (isJobClosed_(jobId)) {
    return { ok: false, error: 'Job is Closed. No further commits allowed.' };
  }

  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'JOB_EN sheet not found.' };

  var cards = readCards_(ss);

    var ghostSlots = readGhostSlots_(ss) || [];
    var ghostSet = {};
    for (var gs = 0; gs < ghostSlots.length; gs++) {
      ghostSet[String(ghostSlots[gs])] = true;
    }

  // No cards = nothing to do — but ghosts must still be cleared (hard rule).
  if (!cards.length) {
    writeGhostSlots_(ss, []);
    return { ok: true, committedRows: 0, insertedRows: 0, deletedRows: 0, clearedCards: 0 };
  }

  // Load segment table A–G into memory (rows 11+).
  var startRow = 11;
  var lastRow = sheet.getLastRow();
  var numRows = (lastRow >= startRow) ? (lastRow - startRow + 1) : 0;

  var range = numRows ? sheet.getRange(startRow, 1, numRows, 7) : null;
  var values = numRows ? range.getValues() : [];

  // Map segmentId -> row index in values
  var segIndex = {};
  for (var i = 0; i < values.length; i++) {
    var segId = values[i][3];
    if (segId) segIndex[String(segId)] = i;
  }

  // Build a new ordered list of rows for the post-commit sheet.
  // Baseline: existing segments in their current order.
  var committedOrder = values.slice();

  // Apply cards in card order as a pending “intent” list:
  // - Existing segment cards edit or delete that segment
  // - new: cards insert new segments
  var newRows = [];
  var toDelete = {};    // segmentId -> true
  var consumed = {};    // segmentId -> true (prevents dupes in outFromSlots)

  var inserted = 0;
  var deleted = 0;
  var committed = 0;

  // Helper to generate a new SegmentID for inserted rows
  function newSegmentId_() {
    return 'seg_' + Utilities.getUuid();
  }

  // First pass: mark deletions + collect inserts + write edits into existing working fields.
  cards.sort(function (a, b) { return (a.orderIndex || 0) - (b.orderIndex || 0); });

  // Defensive hardening:
  // If the frontend accidentally calls createCard repeatedly while typing,
  // we can end up with many consecutive "new:" cards with identical style/text.
  // Squash consecutive duplicate inserts so Push does not explode row counts.
  (function squashConsecutiveDuplicateNewCards_() {
    var outCards = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var sid = String(c.segmentId || '');
      var isNew = (sid.indexOf('new:') === 0);

      if (!isNew) {
        outCards.push(c);
        continue;
      }

      var style = normalizeStyleLabel_(c.workingStyle || '');
      var text = String(c.workingText || '').trim();

      var prev = outCards.length ? outCards[outCards.length - 1] : null;
      if (prev) {
        var prevSid = String(prev.segmentId || '');
        var prevIsNew = (prevSid.indexOf('new:') === 0);
        var prevStyle = normalizeStyleLabel_(prev.workingStyle || '');
        var prevText = String(prev.workingText || '').trim();

        // If the last kept card is also a "new:" insert with the same payload,
        // keep only the most recent one (replacement).
        if (prevIsNew && prevStyle === style && prevText === text) {
          outCards[outCards.length - 1] = c;
          continue;
        }
      }

      outCards.push(c);
    }
    cards = outCards;
  })();

  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var segId = String(card.segmentId || '');
    var style = String(card.workingStyle || '');
    var text = String(card.workingText || '');
    var normStyle = normalizeStyleLabel_(style);

    // Section Divider: treat ZWSP as empty so we can apply the em-dash default.
    if (normStyle === 'section divider') {
      text = String(text || '').replace(/\u200B/g, '').trim();
    }

    // IMPORTANT: Section Divider cards often carry ZWSP (zero-width space) from the UI
    // because they have a hidden [data-role="card-text"] surface.
    // ZWSP is truthy, so without this, the divider commits as "blank" instead of using the em-dash default.
    if (normStyle === 'section divider') {
      text = text.replace(/\u200B/g, '').trim();
    }

    if (normStyle === 'delete row' || normStyle === 'delete segment') {
      if (segId && segId.indexOf('new:') !== 0) {
        toDelete[segId] = true;
      }
      continue;
    }

    if (segId.indexOf('new:') === 0 || (!segId && normStyle === 'section divider')) {
      // Insert a brand new segment row (committed = working at commit time)
      var newId = newSegmentId_();
      var now = new Date();
      var user = Session.getActiveUser().getEmail() || 'SYSTEM';

      // Section divider is real content: default to em-dash line if blank.
      var isDivider = (normStyle === 'section divider');
      var keepText = isDivider ? (text ? text : '————————————') : text;

      var row = [
        keepText,    // A committed
        style,       // B working style
        keepText,    // C working
        newId,       // D segmentId
        user,        // E lastEditor
        now,         // F lastEditTime
        style        // G committed style
      ];
      newRows.push(row);
      inserted++;
      continue;
    }

    // Existing segment edit: update that segment’s working fields first,
    // then committed will copy from working below.
    var idx = segIndex[segId];
    if (idx == null) continue;

    values[idx][1] = style; // B
    values[idx][2] = text;  // C
  }

  // Second pass is handled below by outFromCards (cards define order + inserts),
  // then we append remaining non-card segments preserving relative order.

// Slot-based rebuild (WELDED):
// - Committed lane defines the stream of committed rows we can "consume" (committedCursor).
// - Slot index defines alignment. Cards act on slots, not on global segmentId lookup.
// - Rules:
//    * Ghost slot: consumes NO committed row, emits nothing unless a card occupies it.
//    * Insert card (new:): consumes NO committed row, emits a new row.
//    * Edit card: consumes EXACTLY ONE committed row for that slot, emits the edited row.
//    * Delete card: consumes EXACTLY ONE committed row for that slot, emits nothing.
// - No empty committed rows survive (divider rows are forced to em-dash).

var outFromSlots = [];

// Map slot -> card (orderIndex is the slot). If duplicates exist, last write wins.
var cardBySlot = {};
var maxCardSlot = -1;
for (var m2 = 0; m2 < cards.length; m2++) {
  var ccc = cards[m2];
  var slot = Number(ccc.orderIndex);
  if (isNaN(slot) || slot < 0) continue;
  cardBySlot[slot] = ccc;
  if (slot > maxCardSlot) maxCardSlot = slot;
}

// Compute slotCount large enough to place:
// - all cards
// - all committed rows
// - all ghost slots
var maxGhostSlot = -1;
for (var g2 = 0; g2 < ghostSlots.length; g2++) {
  var gg = Number(ghostSlots[g2]);
  if (!isNaN(gg) && gg > maxGhostSlot) maxGhostSlot = gg;
}

var slotCount = Math.max(
  maxCardSlot + 1,
  committedOrder.length + ghostSlots.length,
  maxGhostSlot + 1
);

// Helpers
function stripInvisible_(v) {
  return String(v == null ? '' : v)
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '') // ZWSP/ZWNJ/ZWJ/WordJoiner/BOM
    .trim();
}

function makeInsertedRow_(styleLabel, workingText, isDivider) {
  var newId = 'seg_' + Utilities.getUuid();
  var nowIns = new Date();
  var userIns = Session.getActiveUser().getEmail() || 'SYSTEM';

  var clean = isDivider ? stripInvisible_(workingText) : String(workingText == null ? '' : workingText);
  var a = isDivider ? (clean ? clean : '————————————') : clean;

  return [
    a,         // A committed
    styleLabel,// B working style
    a,         // C working text
    newId,     // D segmentId
    userIns,   // E lastEditor
    nowIns,    // F lastEditTime
    styleLabel // G committed style
  ];
}

// Iterate slot grid, consuming committed rows only when rules say so.
var committedCursor = 0;

for (var s = 0; s < slotCount; s++) {
  var cardAt = cardBySlot[s] || null;
  var isGhost = !!ghostSet[String(s)];

  if (cardAt) {
    var sidAt = String(cardAt.segmentId || '');
    var styleAt = String(cardAt.workingStyle || '');
    var textAt = String(cardAt.workingText || '');
    var normStyleAt = normalizeStyleLabel_(styleAt);

    // Any real card occupying a ghost slot consumes that ghost slot.
    if (isGhost) {
      delete ghostSet[String(s)];
      isGhost = false; // treated as a real occupied slot now
    }

    // INSERT: new segment cards consume no committed row.
    // Divider insert is allowed only when segmentId is missing (defensive).
    var isInsert =
      (sidAt.indexOf('new:') === 0) ||
      (!sidAt && normStyleAt === 'section divider');

    if (isInsert) {
      outFromSlots.push(
        makeInsertedRow_(styleAt, textAt, normStyleAt === 'section divider')
      );
      continue;
    }

    // EDIT / DELETE: consume exactly one committed row for this slot.
    var baseRow = (committedCursor < committedOrder.length)
      ? committedOrder[committedCursor]
      : null;

    if (baseRow) committedCursor++; // consume now

    // If we have no committed row left but we got an edit/delete card,
    // degrade safely: treat as insert (keeps data, avoids silent drop).
    if (!baseRow) {
      if (normStyleAt === 'delete row' || normStyleAt === 'delete segment') {
        // Nothing to delete; nothing to emit.
        continue;
      }
      outFromSlots.push(
        makeInsertedRow_(styleAt, textAt, normStyleAt === 'section divider')
      );
      continue;
    }

    // DELETE: emit nothing.
    if (normStyleAt === 'delete row' || normStyleAt === 'delete segment') {
      continue;
    }

    // EDIT: emit the consumed base row with working fields overwritten from the card.
    var edited = baseRow.slice();

    // Working style always comes from card
    edited[1] = styleAt;

    // Working text from card; divider text forced if empty/invisible
    if (normStyleAt === 'section divider') {
      var cleanDiv = stripInvisible_(textAt);
      edited[2] = cleanDiv ? cleanDiv : '————————————';
      // Also keep committed A aligned for immediate render stability; commit pass will finalize anyway.
      edited[0] = edited[2];
      // And ensure committed style carries divider too.
      edited[6] = styleAt;
    } else {
      edited[2] = String(textAt == null ? '' : textAt);
    }

    outFromSlots.push(edited);
    continue;
  }

  // No card in this slot:
  // Ghost slot consumes no committed row.
  if (isGhost) {
    continue;
  }

  // Normal slot consumes one committed row and emits it unchanged.
  if (committedCursor < committedOrder.length) {
    outFromSlots.push(committedOrder[committedCursor]);
    committedCursor++;
  }
}

// Safety: if anything remains unconsumed (should be rare), append it.
while (committedCursor < committedOrder.length) {
  outFromSlots.push(committedOrder[committedCursor]);
  committedCursor++;
}

var out = outFromSlots;

// Repair divider rows that were committed as blank/ZWSP.
// Divider rows must survive, but they must render as the em-dash line (not an empty card).
(out || []).forEach(function (row) {
  if (!row) return;

  var ws = normalizeStyleLabel_(row[1] || '');
  var cs = normalizeStyleLabel_(row[6] || '');
  var isDivider = (ws === 'section divider') || (cs === 'section divider');
  if (!isDivider) return;

  function stripZWSP_(v) {
    return String(v == null ? '' : v)
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
      .trim();
  }

  var a = stripZWSP_(row[0]); // committed
  var c = stripZWSP_(row[2]); // working

  // If both are effectively empty, force the divider glyph-line into both surfaces.
  if (a === '' && c === '') {
    row[0] = '————————————';
    row[2] = '————————————';
    return;
  }

  // Otherwise, just remove ZWSP noise while preserving real content.
  if (a !== '') row[0] = a;
  if (c !== '') row[2] = c;
});

// Collapse “blank survivor” rows after slot-based rebuild.
// If an edit card cleared the text to empty, we do NOT want to preserve an empty committed row.
// (Exception: Section divider rows must survive even when “visually blank”.)
out = (out || []).filter(function (row) {
  if (!row) return false;

  var ws = normalizeStyleLabel_(row[1] || '');
  var cs = normalizeStyleLabel_(row[6] || '');

  var isDivider = (ws === 'section divider') || (cs === 'section divider');
  if (isDivider) return true;

  var a = String(row[0] == null ? '' : row[0]).trim();
  var c = String(row[2] == null ? '' : row[2]).trim();

  // If BOTH committed+working are empty, drop the row entirely.
  // This makes “clear text + Push” behave like a real delete (bump-up).
  return !(a === '' && c === '');
});

  // Now apply Working → Committed, but ONLY mark rows "touched" when they truly change.
  // This preserves LastEditor/LastEditTime for unchanged rows.
  var user2 = Session.getActiveUser().getEmail() || 'SYSTEM';
  var now2 = new Date();

  for (var r = 0; r < out.length; r++) {
    var row = out[r];
    var sid3 = row[3];
    if (!sid3) continue;

    var workingStyle = row[1];
    var workingText = row[2];
    var committedText = row[0];
    var committedStyle = row[6];

    var changed = false;

    // Copy working text -> committed ONLY if different
    if (workingText !== committedText) {
      row[0] = workingText;
      committed++;
      changed = true;
    }

// Divider rows are real content now (em-dash text), so no placeholder forcing.
// We only keep the normal "commit style from working style" rule.
if (workingStyle && workingStyle !== committedStyle) {
  row[6] = workingStyle;
  changed = true;
}

    // IMPORTANT: Only update audit fields when something truly changed
    if (changed) {
      row[4] = user2;
      row[5] = now2;
    }
  }

  // Rewrite JOB_EN table rows 11+ to match out (and delete anything removed)
  // Clear old area and write new
  if (lastRow >= startRow) {
    sheet.getRange(startRow, 1, lastRow - startRow + 1, 7).clearContent();
  }

  if (out.length) {
    sheet.getRange(startRow, 1, out.length, 7).setValues(out);
  }

  // Clear cards (dirty state wiped)
  writeCards_(ss, []);

  // Clear ghost slots (structure wiped) — hard rule: no ghosts after Push.
  writeGhostSlots_(ss, []);

  // Return a fresh job payload (same shape as GetJob) so the frontend can
  // immediately render the new committed lane without relying on a follow-up fetch.
  var state = handleGetJob_({ jobId: jobId });

  // Fallback: if for any reason GetJob fails, still return commit success.
  if (!state || state.ok === false) state = { ok: true };

  // Attach commit meta (non-breaking; frontend may ignore).
  state.commit = {
    committedRows: committed,
    insertedRows: inserted,
    deletedRows: deleted,
    clearedCards: cards.length,
    lastEditor: user2,
    lastEditTime: now2
  };

  return state;
}

function handleRunNightly_(body) {
  // Canonical “nightly now” path (same as trigger would do)
  return runNightlyCommitAll_();
}

function handleFinishSubjob_(body) {
  var jobId = (body && body.jobId != null) ? String(body.jobId).trim() : '';
  var lang = (body && body.lang != null) ? String(body.lang).trim().toUpperCase() : '';
  var spreadsheetId =
    (body && body.spreadsheetId) ? String(body.spreadsheetId) :
    (jobId ? getSpreadsheetIdForJobId_(jobId) : '');

  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!lang) return { ok: false, error: 'Missing lang' };
  if (!spreadsheetId) return { ok: false, error: 'Missing spreadsheetId (or job not found for jobId)' };

  // Ensure the sheet exists (sanity check; also makes failures obvious)
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var shName = 'JOB_' + lang;
  var sh = ss.getSheetByName(shName);
  if (!sh) return { ok: false, error: 'Language sheet not found: ' + shName };

  // Idempotent "finish once"
  if (isSubjobFinished_(jobId, lang)) {
    var prev = getSubjobStatus_(jobId, lang);
    return { ok: true, alreadyFinished: true, finishedAt: prev.finishedAt || '' };
  }

  var now = new Date();
  var iso = Utilities.formatDate(now, 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  setSubjobStatus_(jobId, lang, 'Finished', iso);

  return { ok: true, finishedAt: iso };
}

// Machine-translate JOB_EN committed column A into each JOB_XX working column H.
function machineTranslateLanguageSheetsOnClose_(ss) {
  var langs = [
    { code: 'ES', name: 'Spanish' },
    { code: 'FR', name: 'French' },
    { code: 'DE', name: 'German' },
    { code: 'IT', name: 'Italian' },
    { code: 'PT', name: 'Portuguese' },
    { code: 'ZH', name: 'Chinese' },
    { code: 'JA', name: 'Japanese' },
    { code: 'KO', name: 'Korean' }
  ];

  var base = ss.getSheetByName(JOB_EN_SHEET_NAME);
  if (!base) return { translated: 0, rows: 0 };

  var startRow = 11;

  // Read JOB_EN rows A–G once
  var lastRow = base.getLastRow();
  if (lastRow < startRow) return { translated: 0, rows: 0 };

  var numRows = lastRow - startRow + 1;
  var baseValues = base.getRange(startRow, 1, numRows, 7).getValues(); // A..G

  // Precompute which rows are "section divider" (do NOT translate)
  function isDividerRow_(row) {
    var ws = normalizeStyleLabel_(row[1] || ''); // B working style
    var cs = normalizeStyleLabel_(row[6] || ''); // G committed style
    return (ws === 'section divider') || (cs === 'section divider');
  }

  var translatedSheets = 0;
  var translatedRowsTotal = 0;

  for (var i = 0; i < langs.length; i++) {
    var code = langs[i].code;
    var shName = 'JOB_' + code;
    var sh = ss.getSheetByName(shName);
    if (!sh) continue;

    // Build a machine translation output column (H) for this sheet
    var outColH = [];
    for (var r = 0; r < baseValues.length; r++) {
      var row = baseValues[r];

      var committedText = String(row[0] == null ? '' : row[0]); // A
      if (!committedText.trim()) {
        outColH.push(['']);
        continue;
      }

      if (isDividerRow_(row)) {
        // Keep divider glyph line as-is (never translate)
        outColH.push([committedText]);
        continue;
      }

      // LanguageApp.translate(sourceText, sourceLang, targetLang)
      // Source is English by contract.
      var tr = '';
      try {
        tr = LanguageApp.translate(committedText, 'en', code.toLowerCase());
      } catch (e) {
        // If translate fails for a row, leave it blank (or keep English if you prefer)
        tr = '';
      }

      outColH.push([tr]);
      translatedRowsTotal++;
    }

    // Ensure Column H exists (8). If the sheet is only A–G, add one column.
    if (sh.getMaxColumns() < 8) {
      sh.insertColumnAfter(7);
    }

    // Header label for MT column
    sh.getRange(10, 8).setValue('Machine Translation');

    // Write machine translation into Column H of JOB_XX
    sh.getRange(startRow, 8, outColH.length, 1).setValues(outColH);
    translatedSheets++;
  }

  return { translated: translatedSheets, rows: translatedRowsTotal };
}

function handleCloseJob_(body) {
  var jobId = body && body.jobId ? String(body.jobId) : '';
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  if (isJobClosed_(jobId)) {
    // Idempotent close: if someone marked the job closed earlier (force-close),
    // we STILL ensure language sheets + machine translations exist so pills can render.
    var spreadsheetId0 = getSpreadsheetIdForJobId_(jobId);
    if (!spreadsheetId0) return { ok: false, error: 'Job not found for jobId: ' + jobId };

    var ss0 = SpreadsheetApp.openById(spreadsheetId0);

    // Hopper + deliverables (best-effort; never blocks close)
    try { updateHopperAndDeliverablesOnClose_(jobId, ss0, ''); } catch (e) {}

    // Ensure language sheets exist (safe if already present)
    var lang0 = createLanguageSheetsOnClose_(ss0);

    // Ensure machine translations exist (safe to re-run)
    var mt0 = machineTranslateLanguageSheetsOnClose_(ss0);

    // Return fresh state (includes translation pills payload)
    var state0 = handleGetJob_({ jobId: jobId });
    if (!state0 || state0.ok === false) state0 = { ok: true };

    state0.close = {
      alreadyClosed: true,
      languagesCreated: lang0 && lang0.created ? lang0.created : 0,
      languagesTranslated: mt0 && mt0.translated ? mt0.translated : 0,
      translatedRows: mt0 && mt0.rows ? mt0.rows : 0
    };

    return state0;
  }

  // 1) Final commit first (canonical path)
  var finalState = handleCommitJob_({ jobId: jobId });
  if (finalState && finalState.ok === false) {
    return finalState;
  }

  // 2) Mark closed
  var now = new Date();
  var iso = Utilities.formatDate(now, 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  setJobStatus_(jobId, 'Closed', iso);

  // 3) Create language sheets (v0 closeout)
  var spreadsheetId = getSpreadsheetIdForJobId_(jobId);
  if (!spreadsheetId) return { ok: false, error: 'Job not found for jobId: ' + jobId };

  var ss = SpreadsheetApp.openById(spreadsheetId);

  // Hopper + deliverables (best-effort; never blocks close)
  try { updateHopperAndDeliverablesOnClose_(jobId, ss, iso); } catch (e) {}

  var lang = createLanguageSheetsOnClose_(ss);
var mt = machineTranslateLanguageSheetsOnClose_(ss);

  // 4) Return fresh state
  var state = handleGetJob_({ jobId: jobId });
  if (!state || state.ok === false) state = { ok: true };

  state.close = {
    closedAt: iso,
    languagesCreated: lang && lang.created ? lang.created : 0,
    languagesTranslated: mt && mt.translated ? mt.translated : 0,
    translatedRows: mt && mt.rows ? mt.rows : 0
  };

  return state;
}

function handleCreateEnglishJob_(body) {
  const jobName = body.jobName || 'Untitled Job';
  const seedText = body.seedText || '';
  const cutoff = body.cutoff || '';        // ISO string or empty
  const nightly = body.nightly || '';      // "HH:MM" or empty
  const collaborators = body.collaborators || []; // array of emails
  const reqUserEmail = (body && body.user_email) ? String(body.user_email).trim() : '';
  if (reqUserEmail && collaborators.indexOf(reqUserEmail) < 0) {
    collaborators.push(reqUserEmail);
  }

  const templateFile = DriveApp.getFileById(TEMPLATE_SPREADSHEET_ID);
  const jobsFolder = getJobsFolder_();
  const newFileName = `JOB_EN_${new Date().toISOString()}_${jobName}`;
  const copyFile = templateFile.makeCopy(newFileName, jobsFolder);
  const ss = SpreadsheetApp.open(copyFile);
  const jobSheet = ss.getSheetByName(JOB_EN_SHEET_NAME);

  // Generate a jobId (you can adjust format later)
  const jobId = 'JOB_' + Utilities.getUuid();

  // Header writes
  jobSheet.getRange('B1').setValue(jobId);
  jobSheet.getRange('B2').setValue(jobName || '');
  jobSheet.getRange('B3').setValue(new Date());
  
  if (cutoff) {
    // Accept "yyyy-MM-dd" (or ISO) from client; write a real Date when possible
    var d = new Date(cutoff);
    jobSheet.getRange('B4').setValue(isNaN(d.getTime()) ? cutoff : d);
  }

  jobSheet.getRange('B5').setValue('US/Eastern');

// Use user-specified nightly if provided, otherwise default to midnight
  jobSheet.getRange('B6').setValue(nightly || '00:00');

  // Collaborators: join with commas for now
  if (collaborators.length) {
    jobSheet.getRange('B7').setValue(collaborators.join(', '));
  }

  // Seed text → segments (simple v0: split by double newline)
  const segments = seedText
    ? seedText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
    : [];

  const startRow = 11;
  const defaultStyle = 'Body';

  if (segments.length) {
    const values = [];
    const now = new Date();
    segments.forEach((segText, idx) => {
      const segId = 'seg_' + (idx + 1);

    values.push([
      segText,       // A: Committed English (initial source text)
      defaultStyle,  // B: StyleLabel (working style)
      segText,       // C: Working English (start equal to committed)
      segId,         // D: SegmentID
      Session.getActiveUser().getEmail() || 'SYSTEM', // E: LastEditor
      now,           // F: LastEditTime
      defaultStyle   // G: CommittedStyleLabel (frozen at creation)
    ]);

    });

    jobSheet.getRange(startRow, 1, values.length, values[0].length).setValues(values);
  }

    collaborators.forEach(email => {
    try { copyFile.addEditor(email); } catch (e) {}
  });

  setJobIndex_(jobId, ss.getId());

  // Hopper DB (across jobs/users): register this job (best-effort; never blocks job creation)
  try {
    var createdAtIso = Utilities.formatDate(new Date(), 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");

    var ownerEmail0 = (body && body.user_email) ? String(body.user_email) : '';
    ownerEmail0 = String(ownerEmail0 || '').trim();
    if (!ownerEmail0) {
      try { ownerEmail0 = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e0) {}
    }

    var ownerEmail0 =
      (body && body.user_email) ? String(body.user_email).trim() :
      (Session.getActiveUser().getEmail() || '');

    recordCopydeskJobInHopper_({
      jobId: jobId,
      jobName: jobName,
      spreadsheetId: ss.getId(),
      createdAt: createdAtIso,
      cutoff: cutoff,
      collaborators: collaborators,
      userEmail: ownerEmail0
    });
  } catch (e) {}

  return {
    ok: true,
    jobId: jobId,
    spreadsheetId: ss.getId(),
    seedSegments: segments.length
  };
}

/**
 * Build a CSS string from the styles array.
 * Each row generates something like:
 * .style-body { font-size: 14px; font-weight: 400; line-height: 1.4; color: #222222; }
 */
function buildStylesCss_(styles) {
  function scopedSelector_(cssClass) {
    // Higher specificity than .ascend-app-panel textarea/input rules
    // Covers BOTH lanes: committed (div surfaces) + edits (textarea/input surfaces)
    return [
      '.committed-list .committed-seg.' + cssClass,
      '.committed-list .committed-divider-label.' + cssClass,
      '.cards-list .card-textarea.' + cssClass,
      '.cards-list .card-divider-input.' + cssClass
    ].join(',\n');
  }
  if (!styles || !styles.length) return '';

  // Fallback map from StyleLabel -> class name, mirroring the frontend
  // NOTE: keys are normalized (trim + lowercase) for robustness.
  var LABEL_TO_CLASS_MAP = {
    'headline': 'style-headline',
    'subheadline': 'style-subheadline',
    'body': 'style-body',
    'cta': 'style-cta',
    'bullet': 'style-bullet',
    'section divider': 'style-divider'
  };

  var lines = [];

  styles.forEach(function(style) {
    var label = style.StyleLabel || style.styleLabel;
    var normLabel = normalizeStyleLabel_(label);

    var cssClass =
      (style.AdditionalCSSClass ? String(style.AdditionalCSSClass).trim() : '') ||
      (style.additionalCssClass ? String(style.additionalCssClass).trim() : '') ||
      (normLabel ? LABEL_TO_CLASS_MAP[normLabel] : '');

    // If we still don't have a class name, skip this row
    if (!cssClass) {
      return;
    }

    var fontFamily = style.FontFamily || '';
    var fontSize = style.FontSize || '';
    var fontWeight = style.FontWeight || '';
    var lineHeight = style.LineHeight || '';
    var color = style.ColorHex || '';

    var rule = scopedSelector_(cssClass) + ' {';

    if (fontFamily) {
      rule += ' font-family: ' + fontFamily + ';';
    }
    if (fontSize) {
      rule += ' font-size: ' + fontSize + ';';
    }
    if (fontWeight) {
      rule += ' font-weight: ' + fontWeight + ';';
    }
    if (lineHeight) {
      rule += ' line-height: ' + lineHeight + ';';
    }
    if (color) {
      rule += ' color: ' + color + ' !important;';
    }

    rule += ' }';

    lines.push(rule);
  });

  return lines.join('\n');
}

function buildStylesPayload_(ss) {
  // Helper: fuzzy "STYLE"/"STYLES" name finder
  function findStyleSheet_(spreadsheet) {
    // Exact matches first
    var s =
      spreadsheet.getSheetByName(STYLES_SHEET_NAME) ||
      spreadsheet.getSheetByName('STYLES');
    if (s) return s;

    // Fuzzy match: ignore case and whitespace
    var sheets = spreadsheet.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName();
      var norm = name.replace(/\s+/g, '').toUpperCase();
      if (norm === 'STYLE' || norm === 'STYLES') {
        return sheets[i];
      }
    }
    return null;
  }

  // 1) Job spreadsheet STYLE/STYLES, if present
  var jobStyleSheet = findStyleSheet_(ss);

  // 2) MASTER_TEMPLATE STYLE/STYLES (fallback) — only if needed
  var masterStyleSheet = null;

  if (!jobStyleSheet) {
    try {
      var masterSs = SpreadsheetApp.openById(TEMPLATE_SPREADSHEET_ID);
      masterStyleSheet = findStyleSheet_(masterSs);
    } catch (e) {
      // If TEMPLATE_SPREADSHEET_ID is wrong, we’ll simply skip the fallback.
    }
  }

  // Prefer job STYLE, fall back to MASTER STYLE
  var sheetToUse = jobStyleSheet || masterStyleSheet;
  if (!sheetToUse) {
    return [];
  }

  var values = sheetToUse.getDataRange().getValues() || [];

  // If job STYLE has only a header row, fall back to master if available
  if (jobStyleSheet && sheetToUse === jobStyleSheet && values.length <= 1 && masterStyleSheet) {
    sheetToUse = masterStyleSheet;
    values = sheetToUse.getDataRange().getValues() || [];
  }

  if (!values.length) {
    return [];
  }

  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var label = row[0]; // Column A

    // Skip empty rows and the header row (robust)
    var normLabel = String(label == null ? '' : label).trim().toLowerCase();
    if (!normLabel || normLabel === 'stylelabel' || normLabel === 'style label') {
      continue;
    }

    var fontFamily = row[1] || '';        // B
    var fontSize = row[2] || '';          // C
    var fontWeight = row[3] || '';        // D
    var colorHex = row[4] || '';          // E
    var lineHeight = row[5] || '';        // F
    var additionalCssClass = row[6] || '';// G
    var notes = row[7] || '';             // H

    out.push({
      // Lowercase keys
      styleLabel: label,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      colorHex: colorHex,
      lineHeight: lineHeight,
      additionalCssClass: additionalCssClass,
      notes: notes,
      // TitleCase duplicates for existing frontend lookups
      StyleLabel: label,
      FontFamily: fontFamily,
      FontSize: fontSize,
      FontWeight: fontWeight,
      ColorHex: colorHex,
      LineHeight: lineHeight,
      AdditionalCSSClass: additionalCssClass,
      Notes: notes
    });
  }

  return out;
}

function buildStylesCssFromStyles_(styles) {
  if (!styles || !styles.length) return '';

  var LABEL_TO_CLASS_MAP = {
    'Headline': 'style-headline',
    'Subheadline': 'style-subheadline',
    'Body': 'style-body',
    'CTA': 'style-cta',
    'Bullet': 'style-bullet',
    'Section divider': 'style-divider'
  };

  var lines = [];

  styles.forEach(function(style) {
    var label = style.StyleLabel || style.styleLabel;
    var cssClass =
      style.AdditionalCSSClass ||
      style.additionalCssClass ||
      (label ? LABEL_TO_CLASS_MAP[label] : '');

    if (!cssClass) {
      return; // no selector, skip
    }

    var fontFamily = style.FontFamily || style.fontFamily || '';
    var fontSize = style.FontSize || style.fontSize || '';
    var fontWeight = style.FontWeight || style.fontWeight || '';
    var lineHeight = style.LineHeight || style.lineHeight || '';
    var color = style.ColorHex || style.colorHex || '';

    var rule = '.' + cssClass + ' {';

    if (fontFamily) {
      rule += ' font-family: ' + fontFamily + ';';
    }
    if (fontSize) {
      rule += ' font-size: ' + fontSize + ';';
    }
    if (fontWeight) {
      rule += ' font-weight: ' + fontWeight + ';';
    }
    if (lineHeight) {
      rule += ' line-height: ' + lineHeight + ';';
    }
    if (color) {
      rule += ' color: ' + color + ';';
    }

    rule += ' }';

    lines.push(rule);
  });

  return lines.join('\n');
}

/**
 * Backfill CommittedStyleLabel (Column G) from StyleLabel (Column B)
 * for a single JOB_EN sheet.
 *
 * - Only affects rows 11+ that have a SegmentID in Column D.
 * - If G is already non-empty, it is left alone.
 */
function backfillCommittedStyleForSheet_(sheet) {
  var startRow = 11;
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return;

  var numRows = lastRow - startRow + 1;
  // Columns A–G (1..7)
  var range = sheet.getRange(startRow, 1, numRows, 7);
  var values = range.getValues();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];

    var segmentId = row[3];   // Col D
    if (!segmentId) {
      // Skip rows without a SegmentID
      continue;
    }

    var workingStyle = row[1];   // Col B
    var committedStyle = row[6]; // Col G

    // Only backfill if we have a working style and G is empty
    if (workingStyle && !committedStyle) {
      row[6] = workingStyle;
    }
  }

  range.setValues(values);
}

/**
 * Backfill CommittedStyleLabel for:
 * - The MASTER_TEMPLATE JOB_EN sheet, and
 * - All JOB_EN sheets in the same folder as the template.
 *
 * Run this once from the Script Editor.
 */
function backfillCommittedStyleAllJobs() {
  // 1) MASTER_TEMPLATE itself
  var masterSs = SpreadsheetApp.openById(TEMPLATE_SPREADSHEET_ID);
  var masterJobSheet = masterSs.getSheetByName(JOB_EN_SHEET_NAME);
  if (masterJobSheet) {
    backfillCommittedStyleForSheet_(masterJobSheet);
  }

  // 2) All job copies in the same folder as the template
  var jobsFolder = getJobsFolder_();
  var files = jobsFolder.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (files.hasNext()) {
    var file = files.next();
    var ss = SpreadsheetApp.openById(file.getId());
    var sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);
    if (sheet) {
      backfillCommittedStyleForSheet_(sheet);
    }
  }
}

/**
 * TEMP debug helper: reports which sheets exist and what STYLE/STYLES
 * sheet (if any) the backend sees, and how many rows it has.
 */
function getStylesDebug_(ss) {
  var debug = {};

  try {
    // Job spreadsheet sheet names
    debug.jobSheets = ss.getSheets().map(function(sh) {
      return sh.getName();
    });

    // Job STYLE/STYLES sheet, if present (using the same fuzzy finder)
    var jobStyleSheet =
      ss.getSheetByName(STYLES_SHEET_NAME) ||
      ss.getSheetByName('STYLES');

    if (!jobStyleSheet) {
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        var name = sheets[i].getName();
        var norm = name.replace(/\s+/g, '').toUpperCase();
        if (norm === 'STYLE' || norm === 'STYLES') {
          jobStyleSheet = sheets[i];
          break;
        }
      }
    }

    if (jobStyleSheet) {
      var jobValues = jobStyleSheet.getDataRange().getValues();
      debug.jobStyleName = jobStyleSheet.getName();
      debug.jobStyleRowCount = jobValues.length;
      debug.jobStyleFirstRow = jobValues[0] || null;
    } else {
      debug.jobStyleName = null;
      debug.jobStyleRowCount = 0;
      debug.jobStyleFirstRow = null;
    }

    // MASTER_TEMPLATE spreadsheet + STYLE/STYLES sheet, if present
    var masterSs = SpreadsheetApp.openById(TEMPLATE_SPREADSHEET_ID);
    debug.masterSheets = masterSs.getSheets().map(function(sh) {
      return sh.getName();
    });

    var masterStyleSheet =
      masterSs.getSheetByName(STYLES_SHEET_NAME) ||
      masterSs.getSheetByName('STYLES');

    if (!masterStyleSheet) {
      var mSheets = masterSs.getSheets();
      for (var j = 0; j < mSheets.length; j++) {
        var mName = mSheets[j].getName();
        var mNorm = mName.replace(/\s+/g, '').toUpperCase();
        if (mNorm === 'STYLE' || mNorm === 'STYLES') {
          masterStyleSheet = mSheets[j];
          break;
        }
      }
    }

    if (masterStyleSheet) {
      var masterValues = masterStyleSheet.getDataRange().getValues();
      debug.masterStyleName = masterStyleSheet.getName();
      debug.masterStyleRowCount = masterValues.length;
      debug.masterStyleFirstRow = masterValues[0] || null;
    } else {
      debug.masterStyleName = null;
      debug.masterStyleRowCount = 0;
      debug.masterStyleFirstRow = null;
    }

  } catch (err) {
    debug.error = err.toString();
  }

  return debug;
}

function backfillJobIndexFromJobsFolder_() {
  var folder = getJobsFolder_();
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  var n = 0;

  while (files.hasNext()) {
    var file = files.next();
    try {
      var ss = SpreadsheetApp.openById(file.getId());
      var sh = ss.getSheetByName(JOB_EN_SHEET_NAME);
      if (!sh) continue;

      var jobId = String(sh.getRange('B1').getValue() || '').trim();
      if (!jobId) continue;

      setJobIndex_(jobId, ss.getId());
      n++;
    } catch (e) {}
  }

  return { ok: true, indexed: n };
}

// Public runner (so it appears in the Run dropdown)
function backfillJobIndexFromJobsFolder() {
  return backfillJobIndexFromJobsFolder_();
}

// ---------------------------
// Hopper DB (across jobs/users)
// + Deliverables (FileRoom-style list)
// ---------------------------

function getOrCreateHopperDbId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(HOPPER_DB_PROP_KEY);
  if (id) return id;

  var ss = SpreadsheetApp.create('Copydesk Hopper DB');
  id = ss.getId();

  props.setProperty(HOPPER_DB_PROP_KEY, id);

  // Initialize sheets + headers
  ensureHopperSheet_(ss);
  ensureDeliverablesSheet_(ss);

  return id;
}

function openHopperDb_() {
  var id = getOrCreateHopperDbId_();
  return SpreadsheetApp.openById(id);
}

function ensureSheetWithHeader_(ss, sheetName, headerRow) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  var existing = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var needsHeader = true;

  // If any cell in row 1 has content, assume header exists.
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i] || '').trim()) { needsHeader = false; break; }
  }

  if (needsHeader) {
    sh.clear();
    sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    sh.setFrozenRows(1);
  }

  return sh;
}

function ensureHopperSheet_(ss) {
  return ensureSheetWithHeader_(ss, HOPPER_SHEET_NAME, [
    'JobId',
    'JobName',
    'SpreadsheetId',
    'CreatedAt',
    'Cutoff',
    'Status',
    'OwnerEmail',
    'CollaboratorsCsv',
    'DismissedByCsv',
    'ClosedAt'
  ]);
}

function ensureDeliverablesSheet_(ss) {
  return ensureSheetWithHeader_(ss, DELIVERABLES_SHEET_NAME, [
    'DeliverableId',
    'App',
    'JobId',
    'Title',
    'Status',
    'CreatedAt',
    'OpenUrl',
    'OwnerEmail'
  ]);
}

function csvFromArray_(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return !!x; }).join(', ');
}

function arrayFromCsv_(csv) {
  var s = String(csv || '').trim();
  if (!s) return [];
  return s.split(',').map(function (x) { return String(x || '').trim(); }).filter(function (x) { return !!x; });
}

// Robust last-row detector (avoids getLastRow() being inflated by formatting/empty rows)
function lastDataRowInCol_(sh, colIndex, cap) {
  cap = cap || 5000; // safety cap to prevent massive reads
  var lr = sh.getLastRow();
  if (lr < 2) return lr;

  var max = Math.min(lr, cap);
  // read only the ID column (JobId / DeliverableId), rows 2..max
  var vals = sh.getRange(2, colIndex, max - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim()) {
      return 2 + i;
    }
  }
  return 1; // header only
}

function findRowByJobId_(sh, jobId) {
  var last = lastDataRowInCol_(sh, 1, 20000); // Col A = JobId
  if (last < 2) return 0;

  var vals = sh.getRange(2, 1, last - 1, 10).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === String(jobId || '').trim()) {
      return 2 + i;
    }
  }
  return 0;
}

function recordCopydeskJobInHopper_(o) {
  if (!o || !o.jobId) return;

  var db = openHopperDb_();
  var sh = ensureHopperSheet_(db);

  var jobId = String(o.jobId || '').trim();
  var row = findRowByJobId_(sh, jobId);

  var collaboratorsCsv = csvFromArray_(o.collaborators || []);
  var ownerEmail = String(o.userEmail || '').trim();

  // If the client didn't pass user_email, fall back to the script user.
  // This is critical because listCopydeskJobsForUser filters by OwnerEmail.
  if (!ownerEmail) {
    try { ownerEmail = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e) {}
  }

  var payload = [
    jobId,
    String(o.jobName || '').trim(),
    String(o.spreadsheetId || '').trim(),
    String(o.createdAt || '').trim(),
    String(o.cutoff || '').trim(),
    'Open',
    ownerEmail,
    collaboratorsCsv,
    '',
    ''
  ];

  if (row) {
    // Update mutable fields only (keep dismissed list)
    sh.getRange(row, 1, 1, payload.length).setValues([payload]);
  } else {
    sh.appendRow(payload);
  }
}

function updateHopperOnClose_(jobId, closedAtIso) {
  if (!jobId) return;

  var db = openHopperDb_();
  var sh = ensureHopperSheet_(db);

  var row = findRowByJobId_(sh, jobId);
  if (!row) return;

  // Status (F) + ClosedAt (J)
  sh.getRange(row, 6).setValue('Closed');
  if (closedAtIso) sh.getRange(row, 10).setValue(String(closedAtIso));
}

function upsertDeliverableForClose_(jobId, ss, ownerEmail) {
  if (!jobId || !ss) return;

  var db = openHopperDb_();
  var sh = ensureDeliverablesSheet_(db);

  var deliverableId = 'deliv_' + String(jobId).trim(); // deterministic per job
  var last = sh.getLastRow();
  var row = 0;

  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 1).getValues(); // Col A: DeliverableId
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim() === deliverableId) { row = 2 + i; break; }
    }
  }

  var createdAtIso = Utilities.formatDate(new Date(), 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  var openUrl = '';
  try { openUrl = ss.getUrl(); } catch (e) {}

  // Ensure deliverables are attributable for listDeliverablesForUser filtering
  if (!ownerEmail) {
    try { ownerEmail = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e0) {}
  }

  var title = 'Copydesk Output • ' + String(jobId).trim();

  var payload = [
    deliverableId,
    'Copydesk',
    String(jobId).trim(),
    title,
    'output',
    createdAtIso,
    openUrl,
    String(ownerEmail || '').trim()
  ];

  if (row) {
    sh.getRange(row, 1, 1, payload.length).setValues([payload]);
  } else {
    sh.appendRow(payload);
  }
}

function updateHopperAndDeliverablesOnClose_(jobId, ss, closedAtIso) {

function upsertFileRoomRegistryOnClose_(jobId, ss, ownerEmail, closedAtIso) {
  if (!jobId || !ss) return;

  var jobName = '';
  var createdAtIso = '';

  try {
    var sh = ss.getSheetByName(JOB_EN_SHEET_NAME);
    if (sh) {
      jobName = String(sh.getRange('B2').getValue() || '').trim();

      var c = sh.getRange('B3').getValue();
      if (c && Object.prototype.toString.call(c) === '[object Date]' && !isNaN(c.getTime())) {
        createdAtIso = c.toISOString();
      } else {
        createdAtIso = String(c || '').trim();
      }
    }
  } catch (e0) {}

  var openUrl = COPYDESK_JOB_VIEW_URL + '?jobid=' + encodeURIComponent(jobId);

  var params = {
    action: 'upsertJob',
    app: 'Copydesk',
    source_id: jobId,
    title: jobName || jobId,
    subtitle: 'Copydesk',
    status: 'closed',
    open_url: openUrl,
    owner_email: ownerEmail || '',
    collaborators: '',
    created_at: createdAtIso || '',
    updated_at: closedAtIso || '',
    last_touched_by: '',
    tags: 'copydesk',
    parent_ascend_job_key: '',
    is_deleted: 'FALSE'
  };

  var parts = [];
  for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
  }

  var url = FILEROOM_API_BASE_URL + (FILEROOM_API_BASE_URL.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');

  // Best-effort only: never block close.
  try {
    UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (e1) {}
}

  try { updateHopperOnClose_(jobId, closedAtIso); } catch (e0) {}

  // Attempt to infer an owner email from hopper row, otherwise leave blank.
  var ownerEmail = '';
  try {
    var db = openHopperDb_();
    var hs = ensureHopperSheet_(db);
    var r = findRowByJobId_(hs, jobId);
    if (r) ownerEmail = String(hs.getRange(r, 7).getValue() || '').trim(); // OwnerEmail col
  } catch (e1) {}

  try { upsertDeliverableForClose_(jobId, ss, ownerEmail); } catch (e2) {}

  // Handoff to FileRoom Registry (idempotent upsert; best-effort)
  try { upsertFileRoomRegistryOnClose_(jobId, ss, ownerEmail, closedAtIso); } catch (e3) {}
}

function handleListCopydeskJobsForUser_(body) {
  var userEmail = (body && body.user_email) ? String(body.user_email).trim().toLowerCase() : '';
  var limit = (body && body.limit) ? Number(body.limit) : 5000;

  var db = openHopperDb_();
  var sh = ensureHopperSheet_(db);

  var last = sh.getLastRow();
  if (last < 2) {
    // Fallback: Hopper DB not populated yet.
    // Build a list from JOB_INDEX:: ScriptProperties so the UI still shows jobs.
    var jobIds0 = listKnownJobIds_() || [];
    var out0 = [];

    for (var i0 = 0; i0 < jobIds0.length; i0++) {
      var jid0 = String(jobIds0[i0] || '').trim();
      if (!jid0) continue;

      var sid0 = getSpreadsheetIdForJobId_(jid0);
      if (!sid0) continue;

      var jobName0 = '';
      var createdAt0 = '';
      var cutoff0 = '';
      var status0 = 'Open';
      var closedAt0 = '';

      try {
        var ss0 = SpreadsheetApp.openById(sid0);
        var sh0 = ss0.getSheetByName(JOB_EN_SHEET_NAME);
        if (sh0) {
          jobName0 = String(sh0.getRange('B2').getValue() || '').trim();
          createdAt0 = String(sh0.getRange('B3').getValue() || '').trim();
          cutoff0 = String(formatCutoffForClient_(sh0.getRange('B4').getValue()) || '').trim();
        }
        var st0 = getJobStatus_(jid0);
        status0 = (st0 && st0.status) ? String(st0.status) : status0;
        closedAt0 = (st0 && st0.closedAt) ? String(st0.closedAt) : '';
      } catch (e0) {}

      out0.push({
        App: 'Copydesk',
        JobId: jid0,
        JobName: jobName0,
        SpreadsheetId: sid0,
        CreatedAt: createdAt0,
        Cutoff: cutoff0,
        Status: status0,
        ClosedAt: closedAt0
      });
    }

    // Newest first (CreatedAt may not be ISO here, but this keeps stable ordering when it is)
    out0.sort(function (a, b) {
      return String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || ''));
    });

    if (limit && out0.length > limit) out0 = out0.slice(0, limit);

    return { ok: true, jobs: out0, items: out0 };
  }

  var rows = sh.getRange(2, 1, last - 1, 10).getValues();
  var out = [];

  rows.forEach(function (r) {
    var jobId = String(r[0] || '').trim();
    if (!jobId) return;

    var jobName = String(r[1] || '').trim();
    var spreadsheetId = String(r[2] || '').trim();

    // If Hopper DB name is missing but the job sheet exists, read the human name from the job file.
    // This matches the fallback behavior used earlier in this function (B2 on the job sheet).
    if (!jobName && spreadsheetId) {
      try {
        var ssName = SpreadsheetApp.openById(spreadsheetId);
        var shName = ssName.getSheetByName(JOB_EN_SHEET_NAME);
        if (shName) {
          jobName = String(shName.getRange('B2').getValue() || '').trim();
        }
      } catch (eName) {}
    }
    var createdAt = String(r[3] || '').trim();
    var cutoff = String(r[4] || '').trim();
    var status = String(r[5] || '').trim();
    var ownerEmail = String(r[6] || '').trim();
    var collaboratorsCsv = String(r[7] || '').trim();
    var dismissedCsv = String(r[8] || '').trim();
    var closedAt = String(r[9] || '').trim();

    // If userEmail provided, enforce visibility and dismissal
    // IMPORTANT: OwnerEmail may be blank in web-app contexts (Session.getActiveUser() can be empty).
    // In that legacy/blank-owner case, we allow visibility so jobs don't vanish.
    if (userEmail) {
      var ownerBlank = !ownerEmail;
      var ownerOk = ownerBlank ? true : (ownerEmail.toLowerCase() === userEmail);

      var collabs = arrayFromCsv_(collaboratorsCsv).map(function (x) { return x.toLowerCase(); });
      var collabOk = collabs.indexOf(userEmail) >= 0;

      if (!ownerOk && !collabOk) return;

      var dismissed = arrayFromCsv_(dismissedCsv).map(function (x) { return x.toLowerCase(); });
      if (dismissed.indexOf(userEmail) >= 0) return;
    }

    out.push({
      App: 'Copydesk',
      JobId: jobId,
      JobName: jobName,
      SpreadsheetId: spreadsheetId,
      CreatedAt: createdAt,
      Cutoff: cutoff,
      Status: status || 'Open',
      ClosedAt: closedAt
    });
  });

  // Newest first (CreatedAt ISO sorts lexicographically when consistent)
  out.sort(function (a, b) {
    return String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || ''));
  });

  if (limit && out.length > limit) out = out.slice(0, limit);

  // Return both keys for UI compatibility (some hoppers expect items[], others expect jobs[])
  return { ok: true, jobs: out, items: out };
}

function handleDismissCopydeskJob_(body) {
  var userEmail = (body && body.user_email) ? String(body.user_email).trim().toLowerCase() : '';
  var jobId = (body && body.jobId) ? String(body.jobId).trim() : '';
  if (!userEmail) return { ok: false, error: 'Missing user_email' };
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  var db = openHopperDb_();
  var sh = ensureHopperSheet_(db);

  var row = findRowByJobId_(sh, jobId);
  if (!row) return { ok: false, error: 'Job not found in hopper: ' + jobId };

  var dismissedCsv = String(sh.getRange(row, 9).getValue() || '').trim(); // I: DismissedByCsv
  var dismissed = arrayFromCsv_(dismissedCsv).map(function (x) { return x.toLowerCase(); });

  if (dismissed.indexOf(userEmail) < 0) dismissed.push(userEmail);

  sh.getRange(row, 9).setValue(dismissed.join(', '));

  return { ok: true, jobId: jobId, dismissedBy: userEmail };
}

function handleListDeliverablesForUser_(body) {
  var userEmail = (body && body.user_email) ? String(body.user_email).trim().toLowerCase() : '';
  var limit = (body && body.limit) ? Number(body.limit) : 5000;

  var db = openHopperDb_();
  var sh = ensureDeliverablesSheet_(db);

  var last = lastDataRowInCol_(sh, 1, 20000); // Col A = DeliverableId
  if (last < 2) return { ok: true, items: [] };

  var rows = sh.getRange(2, 1, last - 1, 8).getValues();
  var out = [];

  rows.forEach(function (r) {
    var deliverableId = String(r[0] || '').trim();
    if (!deliverableId) return;

    var app = String(r[1] || '').trim();
    var jobId = String(r[2] || '').trim();
    var title = String(r[3] || '').trim();
    var status = String(r[4] || '').trim();
    var createdAt = String(r[5] || '').trim();
    var openUrl = String(r[6] || '').trim();
    var ownerEmail = String(r[7] || '').trim();

    if (userEmail) {
      if (!ownerEmail || ownerEmail.toLowerCase() !== userEmail) return;
    }

    out.push({
      App: app || 'Copydesk',
      JobId: jobId,
      Title: title,
      Status: status || 'output',
      CreatedAt: createdAt,
      OpenUrl: openUrl
    });
  });

  out.sort(function (a, b) {
    return String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || ''));
  });

  if (limit && out.length > limit) out = out.slice(0, limit);

  // Return shape matches Ascend’s FileRoom hopper expectations: {items:[...]}
  return { ok: true, items: out };
}