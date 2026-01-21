const CODEDESK_STORE_KEY = 'codedesk_working_files_v1';

// Active working file pointer (so we can save “the same file” repeatedly)
const CODEDESK_ACTIVE_WF_KEY = 'codedesk_active_working_file_v1';

// Autosave tuning (milliseconds)
const CODEDESK_AUTOSAVE_DEBOUNCE_MS = 900;

function safeId(id){ return typeof id === 'string' && id.trim() ? id.trim() : ''; }

function _getValueById(id){
  const el = document.getElementById(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return !!el.checked;
  return (el.value ?? '');
}

function _setValueById(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox'){
    el.checked = !!value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.value = String(value ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function val(id){
  const v = _getValueById(id);
  return (v == null) ? '' : v;
}

// The canonical list of "style knobs" (IDs that already exist in your file below)
const CODEDESK_STYLE_IDS = [
  'fontFamily',
  'campaign','captionBody',

  'captionColor','bodyColor',
  'eyeRingColor','eyeCenterColor',

  'bgTransparent','bgTopHex','bgBottomHex','bgTopAlpha','bgBottomAlpha',

  'moduleShape','eyeRingShape','eyeCenterShape',

  'modulesMode','modulesEmoji','modulesScale',
  'centerMode','centerEmoji','centerScale'
];

// Build a stable export payload (safe if some IDs don’t exist in DOM)
window.okqralExportState = function okqralExportState(){
  const payload = { v: 1, at: Date.now(), fields: {}, style: {} };

  // Type + subtype index are useful for CodeDesk “template provenance”
  const typeSel = document.getElementById('qrType');
  payload.type = typeSel ? (typeSel.value || '') : '';

  // Export “detailsPanel” inputs by scanning ids in the panel (type-specific fields)
  const details = document.getElementById('detailsPanel');
  if (details){
    details.querySelectorAll('input[id],select[id],textarea[id]').forEach(n => {
      const id = safeId(n.id);
      if (!id) return;
      payload.fields[id] = _getValueById(id);
    });
  }

  // Export known style knobs
  CODEDESK_STYLE_IDS.forEach(id => {
    payload.style[id] = _getValueById(id);
  });

  // Persist ECC + font session keys if present
  try { payload.ecc  = sessionStorage.getItem('okqral_ecc')  || undefined; } catch(e){}
  try { payload.font = sessionStorage.getItem('okqral_font') || undefined; } catch(e){}

  return payload;
};

// Import a previously exported state blob
window.okqralImportState = function okqralImportState(state){
  if (!state || typeof state !== 'object') return false;

  // ------------------------------------------------------------------
  // Global import guard:
  // Any import (template OR working-file open) must suppress applyPreset().
  // ------------------------------------------------------------------
  window.__CODEDESK_IMPORTING_STATE__ = true;

  try {
    // 1) Switch type (rebuilds the form via existing listener)
    const typeSel = document.getElementById('qrType');
    if (typeSel && state.type) {
      const desired = String(state.type).toLowerCase();
      let match = null;

      for (const opt of Array.from(typeSel.options || [])) {
        if (String(opt.value).toLowerCase() === desired) { match = opt.value; break; }
      }

      if (match && typeSel.value !== match) {
        typeSel.value = match;
        typeSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2) Restore type-specific fields (after rebuild)
    const fields = state.fields || {};
    Object.keys(fields).forEach(id => _setValueById(id, fields[id]));

    // 3) Restore style knobs (with legacy key aliases + hex/color pairing)
    const style = Object.assign({}, state.style || {});

    // Legacy aliases (older templates / older HTML variants)
    if (style.bgTopColor && !style.bgTopHex) style.bgTopHex = style.bgTopColor;
    if (style.bgBottomColor && !style.bgBottomHex) style.bgBottomHex = style.bgBottomColor;
    if (style.bgTopHex && !style.bgTopColor) style.bgTopColor = style.bgTopHex;
    if (style.bgBottomHex && !style.bgBottomColor) style.bgBottomColor = style.bgBottomHex;

    const _setStyleKnob = (id, val) => {
      _setValueById(id, val);

      // Keep paired Hex/Color inputs in lockstep.
      // Programmatic .value assignments do NOT fire input events,
      // and your colorHex() prefers Hex when present.
      if (/Color$/.test(id)) _setValueById(id.replace(/Color$/, 'Hex'), val);
      if (/Hex$/.test(id))   _setValueById(id.replace(/Hex$/,   'Color'), val);
    };

    Object.keys(style).forEach(id => _setStyleKnob(id, style[id]));

    // Re-apply gating AFTER import so disabled/enabled states match the imported values
    try { typeof refreshBackground === 'function' && refreshBackground(); } catch(e){}
    try { typeof refreshModulesMode === 'function' && refreshModulesMode(); } catch(e){}
    try { typeof refreshCenter === 'function' && refreshCenter(); } catch(e){}

    // 4) Restore ECC + font session if present (non-fatal)
    try {
      if (state.ecc && typeof setECC === 'function') setECC(state.ecc, { trigger: true });
    } catch(e){}
    try {
      if (state.font && typeof setFont === 'function') setFont(state.font);
    } catch(e){}

    // 5) Repaint background + re-render (safe)
    try { typeof window.refreshBackground === 'function' && window.refreshBackground(); } catch(e){}
    try { typeof render === 'function' && render(); } catch(e){}

    return true;
  } finally {
    // Release after all import-triggered handlers have run
    queueMicrotask(() => { window.__CODEDESK_IMPORTING_STATE__ = false; });
  }
};

// Local working-file registry: { id, name, createdAt, updatedAt, state, finishedAt, fileroom }
function _readWorkingFiles(){
  try {
    const raw = localStorage.getItem(CODEDESK_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch(e){
    return [];
  }
}

function _writeWorkingFiles(arr){
  try { localStorage.setItem(CODEDESK_STORE_KEY, JSON.stringify(arr || [])); } catch(e){}
}

function codedeskNotifyAscendWorkingSave(rec){
  // Skip in embed mode (standalone usage)
  if (window.CODEDESK_EMBED_MODE === true) return rec;

  // Best-effort ping so Ascend can refresh its hopper UI (same-origin only).
  try { localStorage.setItem('ascend_codedesk_hopper_ping_v1', String(Date.now())); } catch(e){}
  try {
    // If CodeDesk was opened from Ascend, ask the opener to refresh immediately.
    if (window.opener && typeof window.opener.refreshHopper === 'function') {
      window.opener.refreshHopper();
    }
  } catch(e){}
  return rec;
}

/* === Brief "working" indicator during FileRoom upsert/sync ==================
   - Wraps codedeskSyncFileRoomNow (if/when defined) and toggles a tiny status.
   - Safe no-op if no UI node exists.
============================================================================ */
function codedeskSetWorkingNotice(on){
  try {
    const el =
      document.getElementById('codedeskWorkingNotice') ||
      document.getElementById('codedeskStatus') ||
      document.querySelector('[data-codedesk-working-notice]') ||
      null;

    if (el) {
      el.textContent = on ? 'working' : '';
      el.style.display = on ? '' : 'none';
    }

    // Also expose a CSS hook for any existing styles
    try { document.documentElement.toggleAttribute('data-codedesk-working', !!on); } catch(_e){}
  } catch(_e){}
}

(function wrapFileRoomUpsertOnce(){
  if (window.__CODEDESK_WORKING_NOTICE_WRAPPED__) return;
  window.__CODEDESK_WORKING_NOTICE_WRAPPED__ = true;

  // Defer so it can wrap even if codedeskSyncFileRoomNow is declared later.
  queueMicrotask(function(){
    try {
      if (typeof window.codedeskSyncFileRoomNow !== 'function') return;
      if (window.codedeskSyncFileRoomNow.__wrapped_working_notice__) return;

      const _orig = window.codedeskSyncFileRoomNow;
      window.codedeskSyncFileRoomNow = async function(){
        codedeskSetWorkingNotice(true);
        try {
          return await _orig.apply(this, arguments);
        } finally {
          // Briefly visible, even for fast upserts
          setTimeout(() => codedeskSetWorkingNotice(false), 250);
        }
      };
      window.codedeskSyncFileRoomNow.__wrapped_working_notice__ = true;
    } catch(_e){}
  });
})();

function _getActiveWorkingFileId(){
  try { return String(localStorage.getItem(CODEDESK_ACTIVE_WF_KEY) || '').trim(); } catch(e){ return ''; }
}
function _setActiveWorkingFileId(id){
  try {
    const v = String(id || '').trim();
    if (v) localStorage.setItem(CODEDESK_ACTIVE_WF_KEY, v);
  } catch(e){}
}

function _getWorkingFileRecordById(id){
  const files = _readWorkingFiles();
  return files.find(f => String(f.id || '') === String(id || '')) || null;
}

function _upsertWorkingFileRecord(rec){
  if (!rec || !rec.id) return null;

  const now = Date.now();
  const files = _readWorkingFiles();
  const idx = files.findIndex(f => f.id === rec.id);

  const prev = (idx >= 0) ? files[idx] : null;

  const next = Object.assign({}, prev || {}, rec);

  // Always keep CreatedAt stable once created
  next.createdAt = prev ? prev.createdAt : (rec.createdAt || now);
  next.updatedAt = rec.updatedAt || now;

  if (idx >= 0) files[idx] = next;
  else files.unshift(next);

  _writeWorkingFiles(files);
  _setActiveWorkingFileId(next.id);

  // Keep a session-visible pointer for Finish/Autosave
  try { window.__CODEDESK_CURRENT_WF_ID__ = String(next.id || '').trim(); } catch(e){}

  return next;
}

window.codedeskGetActiveWorkingFileId = function codedeskGetActiveWorkingFileId(){
  return _getActiveWorkingFileId();
};

window.codedeskGetWorkingFileRecord = function codedeskGetWorkingFileRecord(id){
  return _getWorkingFileRecordById(id);
};

window.codedeskListWorkingFiles = function codedeskListWorkingFiles(){
  return _readWorkingFiles().map(x => ({
    id: x.id, name: x.name, createdAt: x.createdAt, updatedAt: x.updatedAt
  }));
};

// Save (create-or-update).
// Supports BOTH call shapes:
//   codedeskSaveWorkingFile(name, {id})
//   codedeskSaveWorkingFile(recObjectWithIdAndOptionalFileroomEtc)
window.codedeskSaveWorkingFile = function codedeskSaveWorkingFile(a, b){
  // Object form: codedeskSaveWorkingFile(rec)
  if (a && typeof a === 'object' && a.id) {
    // Always refresh the serialized state unless explicitly provided
    if (!('state' in a)) {
      try { a.state = window.okqralExportState(); } catch(e){}
    }

    const out = _upsertWorkingFileRecord(a);

    // Notify Ascend (optional): keep orange working file + FileRoom PNG linked
    try { codedeskNotifyAscendWorkingSave(out); } catch(e){}

    return (out || {}).id || '';
  }

  // Name + id form: codedeskSaveWorkingFile(name, {id})
  const name = a;
  const opts = b || {};
  const now = Date.now();

  const __aid = _getActiveWorkingFileId();
  const nextId =
    (opts && opts.id) ||
    ((__aid && _getWorkingFileRecordById(__aid)) ? __aid : null) ||
    ('wf_' + now + '_' + Math.random().toString(16).slice(2));

  const state = window.okqralExportState();

  const prev = _getWorkingFileRecordById(nextId);

  const rec = {
    id: nextId,

    // Marker fields for hopper UI (CSS-only differentiation on the Ascend side)
    kind: (prev && prev.kind) ? prev.kind : 'working',
    indicator: (prev && prev.indicator) ? prev.indicator : 'working_orange_stack',

    name: String(name || (prev && prev.name) || 'Untitled working file').trim() || 'Untitled working file',
    state: state,
    createdAt: (prev ? prev.createdAt : now),
    updatedAt: now
  };

  const out = _upsertWorkingFileRecord(rec);

  // Notify Ascend (optional): keep orange working file + FileRoom PNG linked
  try { codedeskNotifyAscendWorkingSave(out); } catch(e){}

  return rec.id;
};

window.codedeskOpenWorkingFile = function codedeskOpenWorkingFile(id){
  const wfId = String(id || '').trim();
  const rec = _getWorkingFileRecordById(wfId);
  if (!rec || !rec.state) return false;

  _setActiveWorkingFileId(rec.id);
  try { window.__CODEDESK_CURRENT_WF_ID__ = String(rec.id || '').trim(); } catch(e){}

  // Defer import until AFTER setup/UI-gating removals so nothing overwrites loaded state.
  let ok = false;
  const __deferredState = rec.state;

  // Normalize URL on open: ensure refresh is reopen-safe and saved open_url is canonical.
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('working_file_id', String(rec.id || '').trim());
    u.searchParams.set('wf', String(rec.id || '').trim()); // legacy alias (keep)
    // Remove non-working lifecycle params so Enter ceremony never gets confused later
    u.searchParams.delete('mode');
    u.searchParams.delete('template_id');
    u.searchParams.delete('templateId');
    window.history.replaceState({}, '', u.toString());
  } catch(e){}

  // Opening an existing WORKING file from the hopper implies:
  // - setup is already done
  // - filename ceremony is permanently bypassed
  // - autosave + edits are immediately allowed
  try {
    window.__CODEDESK_SETUP_DONE__ = true;
    window.__CODEDESK_FILENAME_ACCEPTED__ = true;
    window.__CODEDESK_FILENAME_GATE_BYPASSED__ = true;
  } catch(e){}

  // Populate the filename input from the working-file record name (freeze rename for now)
  try {
    const inp = document.getElementById('codedeskFilename');
    if (inp) {
      inp.value = String(rec.name || '').trim();

      // Return visit: filename is frozen (disabled) and visually centered
      inp.disabled = true;
      try { inp.setAttribute('disabled', 'disabled'); } catch(_e){}
      inp.style.pointerEvents = 'none';

      // Keep center treatment (matches your desired frozen/centered identity badge)
      inp.readOnly = true;
      try { inp.setAttribute('readonly', 'readonly'); } catch(_e){}
      try { inp.style.textAlign = 'center'; } catch(_e){}
    }

    // Return visit: remove Enter ceremony entirely once a working file exists
    try {
      const _h = window.__CODEDESK_FILENAME_ENTER_CEREMONY__;
      if (_h && inp) {
        try { inp.removeEventListener('keydown', _h, true); } catch(_e){}
      }
    } catch(_e){}
  } catch(e){}

  // Existing working file: permanently remove setup UI
  try {
    if (typeof codedeskRemoveSetupStep === 'function') {
      codedeskRemoveSetupStep();
    }
    if (typeof codedeskSetSetupSparkleVisible === 'function') {
      codedeskSetSetupSparkleVisible(false);
    }
    // Defensive: ensure no setup remnants survive reflows
    const step = document.getElementById('setupStep');
    if (step && step.parentNode) step.parentNode.removeChild(step);
  } catch(e){}

  // Hard unlock — return visits must never be gated
  try {
    if (typeof codedeskSetLocked === 'function') {
      codedeskSetLocked(false);
    }
    if (typeof codedeskRefreshFilenameGate === 'function') {
      codedeskRefreshFilenameGate();
    }
    // Absolute override: ensure editability even if other guards fire later
    window.__CODEDESK_LOCKED__ = false;
  } catch(e){}

  // Ensure the WORKFILE row stays fresh in Ascend even if no prior FileRoom pairing exists
  // Run after import-triggered rebuilds so buildText() reflects the loaded state.
  try {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { window.codedeskPushWorkingDebounced && window.codedeskPushWorkingDebounced('open'); } catch(e){}
      });
    });
  } catch(e){}

  // If this working file has been Finished before, opening it should trigger an update.
  // Debounced so the first render settles.
  try {
    if (rec && rec.fileroom && rec.fileroom.drive_file_id) {
      setTimeout(() => { try { window.codedeskSyncFileRoomDebounced && window.codedeskSyncFileRoomDebounced('open'); } catch(e){} }, 250);
    }
  } catch(e){}

  // Import saved state LAST (after all ceremony/gating teardown).
  try {
    ok = window.okqralImportState(__deferredState);
  } catch(e) {
    ok = false;
  }

  return ok;
};

window.codedeskDeleteWorkingFile = function codedeskDeleteWorkingFile(id){
  const files = _readWorkingFiles().filter(f => f.id !== id);
  _writeWorkingFiles(files);
  try {
    if (_getActiveWorkingFileId() === String(id || '').trim()) {
      localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY);
      window.__CODEDESK_CURRENT_WF_ID__ = '';
    }
  } catch(e){}
  return true;
};