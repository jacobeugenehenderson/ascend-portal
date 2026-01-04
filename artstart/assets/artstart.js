// art_start.js
// Vanilla JS behavior for ArtStart Job View

(function () {
  'use strict';

// ---- Feature flags (intentionally boring, default-off) ----
// Feature flags (intentionally boring, default-off)
// Allow hard override from window if ascend.js (or console) sets it.
var ARTSTART_ENABLE_DAVE_STATUS = (window.ARTSTART_ENABLE_DAVE_STATUS === true) ? true : false;

var ARTSTART_API_BASE = window.ARTSTART_API_BASE || 'https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec';

function getJobIdFromQuery() {
  var params = new URLSearchParams(window.location.search || '');
  // accept both spellings
  return params.get('jobid') || params.get('jobId');
  }

  // Expose helper for later (non-IIFE) boot code.
  window.getJobIdFromQuery = window.getJobIdFromQuery || getJobIdFromQuery;

  

// Optional shared config (if ../../assets/ascend.js exposes these, we use them; otherwise we fail loudly)
var FILEROOM_API_BASE = window.FILEROOM_API_BASE || '';
var CODEDESK_URL = window.CODEDESK_URL || '';

// ---------- Language / Translation (workspace dropdown) ----------
var baseLanguage = 'EN';
var activeLanguage = 'EN';
var translationsDb = {};
var langSelect = null;
var langDot = null;
var langRetransBtn = null;

// While true, autosave scheduling is suppressed (prevents blur-save from re-marking translations as "human").
var __ARTSTART_TRANSLATION_ACTION__ = false;

// One-page-load guard: prevents repeated auto-translate attempts on every refresh tick.
var __ARTSTART_AUTOTRANSLATE_DONE__ = {};

// Persist per-job language choice so async refreshes can't snap back to base.
var currentJobId = '';
var LANG_STORAGE_PREFIX = 'artstart_active_lang_v1:';

// Persist per-job, per-language "human vs machine" state so async refreshes can't spring back.
var LANG_STATE_PREFIX = 'artstart_lang_state_v1:'; // key: jobId:LANG -> "human" | "machine"

function _langStateKey_(jobId, lang) {
  return LANG_STATE_PREFIX + String(jobId || '') + ':' + String(lang || '').trim().toUpperCase();
}

function loadLangState_(jobId, lang) {
  try {
    if (!jobId || !lang || !window.localStorage) return '';
    return String(window.localStorage.getItem(_langStateKey_(jobId, lang)) || '').trim();
  } catch (e) {
    return '';
  }
}

function saveLangState_(jobId, lang, state) {
  try {
    if (!jobId || !lang || !state || !window.localStorage) return;
    window.localStorage.setItem(_langStateKey_(jobId, lang), String(state));
  } catch (e) {
    // ignore
  }
}

function loadActiveLanguage_(jobId) {
  try {
    if (!jobId || !window.localStorage) return '';
    return String(window.localStorage.getItem(LANG_STORAGE_PREFIX + jobId) || '').trim();
  } catch (e) {
    return '';
  }
}

function saveActiveLanguage_(jobId, lang) {
  try {
    if (!jobId || !lang || !window.localStorage) return;
    window.localStorage.setItem(LANG_STORAGE_PREFIX + jobId, String(lang));
  } catch (e) {
    // ignore
  }
}

// Persist per-job, per-language draft fields locally so fetchJob() can't overwrite unsaved edits.
var LANG_DRAFT_PREFIX = 'artstart_lang_draft_v1:'; // key: jobId:LANG -> JSON {at, fields}

function _langDraftKey_(jobId, lang) {
  return LANG_DRAFT_PREFIX + String(jobId || '') + ':' + String(lang || '').trim().toUpperCase();
}

function loadLangDraft_(jobId, lang) {
  try {
    if (!jobId || !lang || !window.localStorage) return null;
    var raw = window.localStorage.getItem(_langDraftKey_(jobId, lang));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveLangDraft_(jobId, lang, fields) {
  try {
    if (!jobId || !lang || !window.localStorage) return;
    var f = fields || {};
    var rec = {
      at: (new Date()).toISOString(),
      fields: {
        workingHeadline: String(f.workingHeadline || ''),
        workingSubhead: String(f.workingSubhead || ''),
        workingCta: String(f.workingCta || ''),
        workingBullets: String(f.workingBullets || '')
      }
    };
    window.localStorage.setItem(_langDraftKey_(jobId, lang), JSON.stringify(rec));
  } catch (e) {
    // ignore
  }
}

var __LANG_OPTION_LABELS_CACHED__ = false;

function cacheLangOptionLabelsOnce_() {
  if (__LANG_OPTION_LABELS_CACHED__) return;
  if (!langSelect || !langSelect.options) return;

  try {
    Array.prototype.forEach.call(langSelect.options, function (opt) {
      if (!opt) return;

      // Store the base label once (strip any existing square prefix)
      var t = String(opt.textContent || '').replace(/^[\u25A0\u25A1]\s*/g, '');
      if (!opt.getAttribute('data-base-label')) {
        opt.setAttribute('data-base-label', t);
      }
    });

    __LANG_OPTION_LABELS_CACHED__ = true;
  } catch (e) {}
}

function isLangHumanEdited_(lang) {
  var jobIdNow = currentJobId || getJobIdFromQuery();
  lang = String(lang || '').trim().toUpperCase();
  if (!jobIdNow || !lang || lang === baseLanguage) return false;

  // 1) LocalStorage is authoritative (survives fetchJob() rebuilds and option repaints)
  var st = '';
  try { st = loadLangState_(jobIdNow, lang); } catch (_e) { st = ''; }
  if (st === 'human') return true;
  if (st === 'machine') return false;

  // 2) Fallback to in-memory db (best effort)
  var entry = translationsDb && translationsDb[lang];
  return !!(entry && entry.human === true);
}

function paintLangOptionSquares_() {
  // Native <select><option> rows cannot reliably render Ascend-colored squares.
  // We now render the real square regime inside a custom menu (see below).
  // This function is retained ONLY to scrub any legacy □/■ prefixes.
  if (!langSelect || !langSelect.options) return;

  try {
    Array.prototype.forEach.call(langSelect.options, function (opt) {
      if (!opt) return;

      var baseLabel = opt.getAttribute('data-base-label');
      if (!baseLabel) {
        baseLabel = String(opt.textContent || '').replace(/^[\u25A0\u25A1]\s*/g, '');
        opt.setAttribute('data-base-label', baseLabel);
      }

      opt.textContent = baseLabel;
    });
  } catch (e) {}
}

function updateLangDot_() {
  // Always scrub legacy □/■ prefixes if any linger
  cacheLangOptionLabelsOnce_();
  paintLangOptionSquares_();

  // Determine decoupled state for the ACTIVE language (localStorage is authoritative)
  var humanEdited = isLangHumanEdited_(activeLanguage);

  // Square regime:
  // - EN: hidden
  // - non-EN machine-linked: solid blue (default .artstart-language-square)
  // - non-EN human-edited: empty orange (add .is-empty)
  if (langDot) {
    if (!activeLanguage || activeLanguage === baseLanguage) {
      langDot.classList.add('is-hidden');
      langDot.classList.remove('is-empty');
    } else {
      langDot.classList.remove('is-hidden');
      langDot.classList.toggle('is-empty', !!humanEdited);
    }
  }

  // Red re-translate button appears ONLY when:
  // - non-EN active, AND
  // - human-edited/decoupled
  if (langRetransBtn) {
    var show = (activeLanguage !== baseLanguage) && !!humanEdited;
    langRetransBtn.classList.toggle('is-hidden', !show);
  }

  // Keep the custom picker button/menu squares in sync
  updateLangPickerUI_();
}

/* ============================================================
   LANGUAGE PICKER — BASELINE + CUSTOM MENU (COLORED SQUARES)
   Blue filled  = machine-linked
   Orange empty = human-edited / decoupled
   Red filled   = manual retranslate button (already exists)
   ============================================================ */

var __LANG_BASELINE_SIGS__ = {}; // lang -> signature
var __LANG_PICKER_BUILT__ = false;
var __LANG_PICKER_WRAP__ = null;
var __LANG_PICKER_BTN__ = null;
var __LANG_PICKER_BTN_LABEL__ = null;
var __LANG_PICKER_MENU__ = null;

function _readWorkingFields_() {
  var f = {};
  var v;

  v = document.getElementById('working-headline'); if (v) f.workingHeadline = v.value || '';
  v = document.getElementById('working-subhead');  if (v) f.workingSubhead  = v.value || '';
  v = document.getElementById('working-cta');      if (v) f.workingCta      = v.value || '';
  v = document.getElementById('working-bullets');  if (v) f.workingBullets  = v.value || '';

  return f;
}

function _fieldsSig_(f) {
  var x = f || {};
  return JSON.stringify([
    String(x.workingHeadline || ''),
    String(x.workingSubhead || ''),
    String(x.workingCta || ''),
    String(x.workingBullets || '')
  ]);
}

function setLangBaseline_(lang, fields) {
  lang = String(lang || '').trim().toUpperCase();
  if (!lang || lang === baseLanguage) return;
  __LANG_BASELINE_SIGS__[lang] = _fieldsSig_(fields || {});
}

function langHasChangedFromBaseline_(lang, fields) {
  lang = String(lang || '').trim().toUpperCase();
  if (!lang || lang === baseLanguage) return false;

  var sigNow = _fieldsSig_(fields || {});
  var sigBase = __LANG_BASELINE_SIGS__[lang];

  // If we don't yet have a baseline, do NOT assume "human" (prevents false positives).
  if (!sigBase) return false;

  return sigNow !== sigBase;
}

function clearLangDraft_(jobId, lang) {
  try {
    if (!jobId || !lang || !window.localStorage) return;
    window.localStorage.removeItem(_langDraftKey_(jobId, lang));
  } catch (e) {}
}

function getJobLocalLangs_(jobId) {
  if (!jobId || !window.localStorage) return [];
  var out = {};
  try {
    for (var i = 0; i < window.localStorage.length; i++) {
      var k = window.localStorage.key(i);
      if (!k) continue;

      if (k.indexOf(LANG_STATE_PREFIX + jobId + ':') === 0) {
        var lang = k.substring((LANG_STATE_PREFIX + jobId + ':').length);
        if (lang) out[String(lang).trim().toUpperCase()] = true;
      }

      if (k.indexOf(LANG_DRAFT_PREFIX + jobId + ':') === 0) {
        var lang2 = k.substring((LANG_DRAFT_PREFIX + jobId + ':').length);
        if (lang2) out[String(lang2).trim().toUpperCase()] = true;
      }
    }
  } catch (e) {
    return [];
  }
  return Object.keys(out);
}

function ensureLangPickerBuilt_() {
  if (__LANG_PICKER_BUILT__) return;
  if (!langSelect) return;

  try {
    // Hide the native select (we keep it for state + change events)
    langSelect.classList.add('is-hidden');

    __LANG_PICKER_WRAP__ = document.createElement('div');
    __LANG_PICKER_WRAP__.className = 'artstart-langpicker';

    __LANG_PICKER_BTN__ = document.createElement('button');
    __LANG_PICKER_BTN__.type = 'button';
    __LANG_PICKER_BTN__.className = 'artstart-langpicker-btn';
    __LANG_PICKER_BTN__.setAttribute('aria-haspopup', 'listbox');
    __LANG_PICKER_BTN__.setAttribute('aria-expanded', 'false');

    var sq = document.createElement('span');
    sq.className = 'artstart-language-square';
    sq.setAttribute('aria-hidden', 'true');

    __LANG_PICKER_BTN_LABEL__ = document.createElement('span');
    __LANG_PICKER_BTN_LABEL__.className = 'artstart-langpicker-label';

    __LANG_PICKER_BTN__.appendChild(sq);
    __LANG_PICKER_BTN__.appendChild(__LANG_PICKER_BTN_LABEL__);

    __LANG_PICKER_MENU__ = document.createElement('div');
    __LANG_PICKER_MENU__.className = 'artstart-langpicker-menu is-hidden';
    __LANG_PICKER_MENU__.setAttribute('role', 'listbox');

    // Insert wrapper where the select lives
    var parent = langSelect.parentNode;
    parent.insertBefore(__LANG_PICKER_WRAP__, langSelect);
    __LANG_PICKER_WRAP__.appendChild(__LANG_PICKER_BTN__);
    __LANG_PICKER_WRAP__.appendChild(__LANG_PICKER_MENU__);
    __LANG_PICKER_WRAP__.appendChild(langSelect);

    __LANG_PICKER_BTN__.addEventListener('click', function () {
      var open = !__LANG_PICKER_MENU__.classList.contains('is-hidden');
      if (open) {
        __LANG_PICKER_MENU__.classList.add('is-hidden');
        __LANG_PICKER_BTN__.setAttribute('aria-expanded', 'false');
        return;
      }

      renderLangPickerMenu_();
      __LANG_PICKER_MENU__.classList.remove('is-hidden');
      __LANG_PICKER_BTN__.setAttribute('aria-expanded', 'true');
    });

    document.addEventListener('mousedown', function (ev) {
      if (!__LANG_PICKER_WRAP__) return;
      if (__LANG_PICKER_MENU__.classList.contains('is-hidden')) return;
      if (__LANG_PICKER_WRAP__.contains(ev.target)) return;
      __LANG_PICKER_MENU__.classList.add('is-hidden');
      __LANG_PICKER_BTN__.setAttribute('aria-expanded', 'false');
    });

    __LANG_PICKER_BUILT__ = true;
  } catch (e) {}
}

function renderLangPickerMenu_() {
  if (!__LANG_PICKER_MENU__ || !langSelect || !langSelect.options) return;

  __LANG_PICKER_MENU__.innerHTML = '';

  try {
    Array.prototype.forEach.call(langSelect.options, function (opt) {
      if (!opt) return;

      var lang = String(opt.value || '').trim().toUpperCase();

      var baseLabel = opt.getAttribute('data-base-label');
      if (!baseLabel) {
        baseLabel = String(opt.textContent || '').replace(/^[\u25A0\u25A1]\s*/g, '');
        opt.setAttribute('data-base-label', baseLabel);
      }

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'artstart-langpicker-item';
      row.setAttribute('role', 'option');
      row.setAttribute('data-lang', lang);

      if (lang === activeLanguage) {
        row.classList.add('is-active');
        row.setAttribute('aria-selected', 'true');
      } else {
        row.setAttribute('aria-selected', 'false');
      }

      // Square (non-EN only)
      if (lang && lang !== baseLanguage) {
        var sq = document.createElement('span');
        sq.className = 'artstart-language-square';
        if (isLangHumanEdited_(lang)) sq.classList.add('is-empty');
        sq.setAttribute('aria-hidden', 'true');
        row.appendChild(sq);
      } else {
        var spacer = document.createElement('span');
        spacer.className = 'artstart-langpicker-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        row.appendChild(spacer);
      }

      var label = document.createElement('span');
      label.className = 'artstart-langpicker-item-label';
      label.textContent = baseLabel;

      row.appendChild(label);

      row.addEventListener('click', function () {
        try {
          langSelect.value = lang;
          var ev = document.createEvent('HTMLEvents');
          ev.initEvent('change', true, true);
          langSelect.dispatchEvent(ev);
        } catch (e) {}

        __LANG_PICKER_MENU__.classList.add('is-hidden');
        __LANG_PICKER_BTN__.setAttribute('aria-expanded', 'false');
      });

      __LANG_PICKER_MENU__.appendChild(row);
    });
  } catch (e) {}
}

function updateLangPickerUI_() {
  if (!__LANG_PICKER_BUILT__ || !__LANG_PICKER_BTN__ || !langSelect) return;

  try {
    // Button label reflects active option label
    var opt = langSelect.options[langSelect.selectedIndex];
    var baseLabel = opt ? (opt.getAttribute('data-base-label') || String(opt.textContent || '').replace(/^[\u25A0\u25A1]\s*/g, '')) : '';
    if (__LANG_PICKER_BTN_LABEL__) __LANG_PICKER_BTN_LABEL__.textContent = baseLabel;

    // Button square reflects active language state (non-EN only)
    var sq = __LANG_PICKER_BTN__.querySelector('.artstart-language-square');
    if (sq) {
      if (!activeLanguage || activeLanguage === baseLanguage) {
        sq.style.opacity = '0';
      } else {
        sq.style.opacity = '1';
        sq.classList.toggle('is-empty', isLangHumanEdited_(activeLanguage));
      }
    }

    // If menu is open, re-render rows to update squares/active highlight
    if (__LANG_PICKER_MENU__ && !__LANG_PICKER_MENU__.classList.contains('is-hidden')) {
      renderLangPickerMenu_();
    }
  } catch (e) {}
}

function retranslateLanguage_(lang) {
  var jobIdNow = getJobIdFromQuery();
  if (!jobIdNow) return;

  lang = String(lang || '').trim().toUpperCase();
  if (!lang || lang === baseLanguage) return;

  setSaveStatus('Translating…');

  fetch(
    ARTSTART_API_BASE +
    '?action=translateArtStartFields' +
    '&jobId=' + encodeURIComponent(jobIdNow) +
    '&targetLanguage=' + encodeURIComponent(lang)
  )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.success || !data.fields) {
        setSaveStatus('Save error');
        return;
      }

      // Overwrite local entry as machine translation (linked)
      translationsDb = translationsDb || {};
      translationsDb[lang] = {
        human: false,
        at: (new Date()).toISOString(),
        fields: {
          workingHeadline: String((data.fields || {}).workingHeadline || ''),
          workingSubhead: String((data.fields || {}).workingSubhead || ''),
          workingCta: String((data.fields || {}).workingCta || ''),
          workingBullets: String((data.fields || {}).workingBullets || '')
        }
      };

      // Ensure we are showing this language now
      activeLanguage = lang;
      saveActiveLanguage_(jobIdNow, activeLanguage);

      // Persist relink state + clear any stale human draft
      try { saveLangState_(jobIdNow, lang, 'machine'); } catch (_e0) {}
      try { clearLangDraft_(jobIdNow, lang); } catch (_e1) {}

      applyTranslatedFields_(data.fields);

      // Baseline becomes the machine text (prevents blur-save from re-marking as human)
      try { setLangBaseline_(lang, data.fields); } catch (_e2) {}

      updateLangDot_();
      setSaveStatus('Saved');
      __ARTSTART_TRANSLATION_ACTION__ = false;
    })
    .catch(function () {
      setSaveStatus('Save error');
      __ARTSTART_TRANSLATION_ACTION__ = false;
    });
}

function applyTranslatedFields_(f) {
  if (!f) return;
  var v;

  v = document.getElementById('working-headline'); if (v) v.value = f.workingHeadline || '';
  v = document.getElementById('working-subhead');  if (v) v.value = f.workingSubhead || '';
  v = document.getElementById('working-cta');      if (v) v.value = f.workingCta || '';
  v = document.getElementById('working-bullets');  if (v) v.value = f.workingBullets || '';

  // EN-only meta fields must never come from translation records.
  // Only write these if the caller explicitly provided them (e.g., base job load).
  v = document.getElementById('working-website');  if (v && typeof f.workingWebsite !== 'undefined') v.value = f.workingWebsite || '';
  v = document.getElementById('working-email');    if (v && typeof f.workingEmail !== 'undefined') v.value = f.workingEmail || '';

  v = document.getElementById('working-notes');    if (v && typeof f.workingNotes !== 'undefined') v.value = f.workingNotes || '';

  syncCanvasTextFromFields();
  autoscaleCanvasBands();
}

  function setError(message) {
    var errEl = document.getElementById('artstart-error');
    var gridEl = document.getElementById('artstart-grid');
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = message || 'Something went wrong.';
    }
    if (gridEl) {
      gridEl.style.display = 'none';
    }
  }

  function clearError() {
    var errEl = document.getElementById('artstart-error');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
  }

  // ---------------- QR attachment (FileRoom) ----------------

  function getCurrentUserEmail_() {
    try {
      if (window.Ascend && typeof window.Ascend.getCurrentUser === 'function') {
        var u = window.Ascend.getCurrentUser();
        var em = u && (u.email || u.userEmail);
        if (em) return String(em).trim();
      }
    } catch (e) {}

    // Fallback: try Ascend session objects
    try {
      if (window.localStorage) {
        var raw = window.localStorage.getItem('ascend_session_v1');
        if (raw) {
          var obj = JSON.parse(raw);
          var em2 = obj && (obj.userEmail || obj.email);
          if (em2) return String(em2).trim();
        }
      }
    } catch (e2) {}

    return '';
  }

  function qs_(id) { return document.getElementById(id); }

  function getQrState_() {
    var idEl = qs_('qrDriveFileId');
    var urlEl = qs_('qrOpenUrl');
    var txtEl = qs_('qrPayloadText');
    return {
      driveFileId: idEl ? String(idEl.value || '').trim() : '',
      openUrl: urlEl ? String(urlEl.value || '').trim() : '',
      payloadText: txtEl ? String(txtEl.value || '').trim() : ''
    };
  }

  function setQrState_(next) {
    var idEl = qs_('qrDriveFileId');
    var urlEl = qs_('qrOpenUrl');
    var txtEl = qs_('qrPayloadText');

    if (idEl) idEl.value = (next && next.driveFileId) ? String(next.driveFileId) : '';
    if (urlEl) urlEl.value = (next && next.openUrl) ? String(next.openUrl) : '';
    if (txtEl) txtEl.value = (next && next.payloadText) ? String(next.payloadText) : '';

    renderQrStage_();
  }

  function renderQrStage_() {
    var stageEl = qs_('artstart-qr-stage');
    var placeBtn = qs_('artstart-qr-place');
    var linkEl = qs_('artstart-qr-link');
    var imgEl = qs_('artstart-qr-img');
    var payloadEl = qs_('artstart-qr-payload');
    var clearBtn = qs_('artstart-qr-clear');

    if (!placeBtn || !linkEl || !imgEl || !payloadEl || !clearBtn) return;

    var s = getQrState_();
    var has = !!(s && s.driveFileId);

    if (stageEl) stageEl.classList.toggle('has-qr', has);

    placeBtn.style.display = has ? 'none' : '';
    linkEl.style.display = has ? 'block' : 'none';
    clearBtn.style.display = has ? '' : 'none';

    if (has) {
      // Normalize: driveFileId may be a raw id OR a full Drive URL.
      var rawId = String(s.driveFileId || '').trim();
      var driveId = rawId;

      // URL forms:
      // 1) ...open?id=FILEID
      // 2) .../file/d/FILEID/...
      // 3) ...uc?id=FILEID
      try {
        if (rawId.indexOf('http') === 0 || rawId.indexOf('drive.google.com') !== -1) {
          var m1 = rawId.match(/[?&]id=([^&]+)/i);
          var m2 = rawId.match(/\/d\/([^\/\?\#]+)/i);
          if (m1 && m1[1]) driveId = m1[1];
          else if (m2 && m2[1]) driveId = m2[1];
        }
      } catch (e) {}

      var fid = encodeURIComponent(String(driveId || '').trim());
      var href = String(s.openUrl || '').trim();
      if (!href) href = 'https://drive.google.com/open?id=' + fid;

      linkEl.href = href;

      // Prefer direct view; fallback to thumbnail if needed.
      imgEl.onerror = null;
      imgEl.src = 'https://drive.google.com/uc?export=view&id=' + fid;
      imgEl.onerror = function () {
        try { this.onerror = null; } catch (e) {}
        this.src = 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w512';
      };

      var pt2 = String(s.payloadText || '').trim();
      if (pt2) {
        payloadEl.textContent = pt2;
        payloadEl.style.display = '';
      } else {
        // Payload must be DestinationUrl only. If empty, show nothing.
        payloadEl.textContent = '';
        payloadEl.style.display = 'none';
      }
    } else {
      linkEl.href = '#';
      imgEl.removeAttribute('src');
      payloadEl.textContent = '';
      payloadEl.style.display = 'none';
    }
  }

  function openQrModal_() {
    var modal = qs_('artstart-qr-modal');
    if (!modal) return;

    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');

    requestFileRoomQrList_();
  }

  function closeQrModal_() {
    var modal = qs_('artstart-qr-modal');
    if (!modal) return;

    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  function isLikelyQrAsset_(item) {
    if (!item) return false;

    var originRaw =
      (item.Origin || item.origin || item.Source || item.source || item.App || item.app || item.Type || item.type || item.Kind || item.kind) || '';
    var origin = String(originRaw).trim().toLowerCase();

    // Hard rule: anything from CodeDesk is a QR.
    if (origin === 'codedesk') return true;

    if (origin.indexOf('qr') !== -1) return true;
    if (origin.indexOf('codedesk') !== -1) return true;
    if (origin.indexOf('code desk') !== -1) return true;

    // Also accept rows that expose a DestinationUrl (canonical payload)
    var p = item.DestinationUrl || item.destinationUrl || item.destination_url || '';
    if (String(p).trim()) return true;

    return false;
  }

  function renderQrList_(items) {
    var list = qs_('artstart-qr-list');
    if (!list) return;

    list.innerHTML = '';

    var rows = (items || []).slice();

    // Prefer likely QR items first, but do NOT hide everything if tagging/keys differ.
    rows.sort(function(a, b){
      var qa = isLikelyQrAsset_(a) ? 1 : 0;
      var qb = isLikelyQrAsset_(b) ? 1 : 0;
      return qb - qa;
    });

    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'artstart-modal-note';
      empty.textContent = 'No QR assets found in FileRoom for your account.';
      list.appendChild(empty);
      return;
    }

    rows.forEach(function (item) {
      var title =
        item.title || item.Title || item.name || item.Name || item.FileName || item.filename || item.AssetName || 'QR';

        var openUrl =
        item.DrivePngOpenUrl ||
        item.openUrl || item.OpenUrl || item.openURL ||
        item.qrOpenUrl || item.QrOpenUrl || item.qr_open_url || '';

      // FileRoom registry returns PNG fields explicitly (DrivePngFileId / DrivePngOpenUrl).
      // SourceId is NOT the PNG file id — it’s the registry source key.
      // IMPORTANT: do NOT fall back to generic Id/id here; that is commonly the registry row id.
      var driveFileId =
        item.DrivePngFileId || item.drivePngFileId || item.drive_png_file_id ||
        item.driveFileId || item.DriveFileId || item.drive_file_id ||
        item.FileId || item.fileId || '';

      // Payload must be DestinationUrl only (FileRoom registry is the source of truth).
      // If DestinationUrl is empty, payload must be empty (no reconstruction, no subtitle fallbacks).
      var payloadText =
        item.DestinationUrl ||
        item.destinationUrl ||
        item.destination_url ||
        '';

      // If it looks like the human label, treat it as empty so UI falls back to openUrl.
      try {
        var pt = String(payloadText || '').trim();
        if (/codedesk/i.test(pt) && /flattened/i.test(pt)) payloadText = '';
      } catch (e) {}

      // If we can’t render it, it’s not selectable.
      if (!driveFileId) return;

      // Ensure a clickable link even if the registry row doesn’t store OpenUrl for the PNG.
      if (!openUrl) openUrl = 'https://drive.google.com/open?id=' + encodeURIComponent(driveFileId);

      var row = document.createElement('div');
      row.className = 'artstart-qr-row';

      var thumb = document.createElement('div');
      thumb.className = 'artstart-qr-thumb';

            // FileRoom-style provenance lane: bar + monogram letter (siblings)
      var icon = document.createElement('div');
      icon.className = 'artstart-qr-icon';

      var iconLabel = document.createElement('div');
      iconLabel.className = 'artstart-qr-icon-label';
      iconLabel.textContent = 'Q';

      // Bar first (absolute), then the letter sits in the lane
      thumb.appendChild(icon);
      thumb.appendChild(iconLabel);

      var text = document.createElement('div');
      text.className = 'artstart-qr-text';

      var t = document.createElement('div');
      t.className = 'artstart-qr-row-title';
      t.textContent = String(title || 'QR');

      var sub = document.createElement('div');
      sub.className = 'artstart-qr-row-sub';
      sub.textContent = String(payloadText || '').trim() ? String(payloadText) : openUrl;

      text.appendChild(t);
      text.appendChild(sub);

      row.appendChild(thumb);
      row.appendChild(text);

      row.addEventListener('click', function () {
        // Persist selection per-job so populateJob async refresh can't overwrite it.
        try {
          var jobKey = getJobIdFromQuery();
          if (jobKey && window.localStorage) {
            window.localStorage.setItem('artstart_qr_override_v1:' + jobKey, JSON.stringify({
              driveFileId: driveFileId,
              openUrl: openUrl,
              payloadText: String(payloadText || '').trim()
            }));
          }
        } catch (e2) {}

        setQrState_({
          driveFileId: driveFileId,
          openUrl: openUrl,
          payloadText: String(payloadText || '').trim()
        });

        // Trigger autosave via blur listeners: touch a working field momentarily.
        try {
          var notes = qs_('working-notes');
          if (notes) {
            notes.focus();
            notes.blur();
          }
        } catch (e) {}

        closeQrModal_();
      });

      list.appendChild(row);
    });
  }

  function requestFileRoomQrList_() {
    if (!FILEROOM_API_BASE) {
      renderQrList_([]);
      console.warn('FILEROOM_API_BASE is missing. Expose window.FILEROOM_API_BASE in ../../assets/ascend.js.');
      return;
    }

    var email = getCurrentUserEmail_();
    if (!email) {
      renderQrList_([]);
      console.warn('No user email available for FileRoom list.');
      return;
    }

    var callbackName = 'artstartFileRoomQrCallback_' + String(Date.now());
    window[callbackName] = function (payload) {
      try {
        var jobs = [];

        // Accept multiple payload shapes (FileRoom has varied over time)
        if (payload) {
          if (Array.isArray(payload.jobs)) jobs = payload.jobs;
          else if (payload.data && Array.isArray(payload.data.jobs)) jobs = payload.data.jobs;
          else if (payload.data && Array.isArray(payload.data.rows)) jobs = payload.data.rows;
          else if (Array.isArray(payload.rows)) jobs = payload.rows;
          else if (Array.isArray(payload.items)) jobs = payload.items;
        }

        renderQrList_(jobs);
      } catch (e) {
        console.warn('ArtStart: error in FileRoom QR callback', e);
        renderQrList_([]);
      }

      try { delete window[callbackName]; } catch (e2) { window[callbackName] = undefined; }
    };

    var url = new URL(FILEROOM_API_BASE);
    url.searchParams.set('action', 'listJobsForUser');

    // FileRoom has historically accepted different param keys; set both.
    url.searchParams.set('user_email', email);
    url.searchParams.set('userEmail', email);

    url.searchParams.set('limit', '1500');
    url.searchParams.set('callback', callbackName);

    var script = document.createElement('script');
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

  function openCodeDeskNewQr_() {
    if (!CODEDESK_URL) {
      console.warn('CODEDESK_URL is missing. Expose window.CODEDESK_URL in ../../assets/ascend.js.');
      return;
    }

    var jobIdNow = getJobIdFromQuery();
    var target = CODEDESK_URL;

    // Lightweight return hint (no coupling required)
    try {
      var u = new URL(target, window.location.href);
      u.searchParams.set('origin', 'artstart');
      if (jobIdNow) u.searchParams.set('jobid', jobIdNow);
      target = u.toString();
    } catch (e) {}

    window.open(target, '_blank', 'noopener');
  }

  function initQrUi_() {
    var placeBtn = qs_('artstart-qr-place');
    var clearBtn = qs_('artstart-qr-clear');
    var modal = qs_('artstart-qr-modal');
    var modalClose = qs_('artstart-qr-modal-close');
    var newBtn = qs_('artstart-qr-new-btn');

    if (placeBtn) {
      placeBtn.addEventListener('click', function () {
        openQrModal_();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        try {
          var jobKey = getJobIdFromQuery();
          if (jobKey && window.localStorage) {
            window.localStorage.removeItem('artstart_qr_override_v1:' + jobKey);
          }
        } catch (e2) {}

        setQrState_({ driveFileId: '', openUrl: '', payloadText: '' });

        try {
          var notes = qs_('working-notes');
          if (notes) {
            notes.focus();
            notes.blur();
          }
        } catch (e) {}
      });
    }

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        openCodeDeskNewQr_();
      });
    }

    if (modalClose) {
      modalClose.addEventListener('click', function () { closeQrModal_(); });
    }

    if (modal) {
      modal.addEventListener('click', function (evt) {
        var t = evt && evt.target;
        if (t && t.getAttribute && t.getAttribute('data-modal-close') === '1') {
          closeQrModal_();
        }
      });
    }

    // Initial paint
    renderQrStage_();
  }

  function setUserLabel() {
    var labelEl = document.getElementById('artstart-user-label');
    if (!labelEl) return;

    var email = getCurrentUserEmail_();

    if (email) {
      labelEl.textContent = 'Logged in as ' + email;
      document.documentElement.setAttribute('data-ascend-state', 'authenticated');
    } else {
      labelEl.textContent = 'Not logged in';
      document.documentElement.setAttribute('data-ascend-state', 'unauthenticated');
    }
  }

  function buildFormatPretty(job) {
    var trim = '—';
    if (job.trimWidth && job.trimHeight) {
      // Use whatever unit is already in the data; don’t add extra quotes
      trim = job.trimWidth + ' × ' + job.trimHeight;
    }

    // Bleed as-is (e.g., "3mm"), falling back to em dash when missing
    var bleed = job.bleed || '—';

    return { trim: trim, bleed: bleed };
  }

  function extractCanvasDims(job) {
    // Use pixel dimensions if present (digital)
    var pixelWidth = parseFloat(job.PixelWidth || job.pixelWidth);
    var pixelHeight = parseFloat(job.PixelHeight || job.pixelHeight);

    if (isFinite(pixelWidth) && pixelWidth > 0 &&
        isFinite(pixelHeight) && pixelHeight > 0) {
      return {
        kind: 'digital',
        width: pixelWidth,
        height: pixelHeight
      };
    }

    // Otherwise assume print (trim size)
    var trimWidth = parseFloat(job.trimWidth);
    var trimHeight = parseFloat(job.trimHeight);

    if (isFinite(trimWidth) && trimWidth > 0 &&
        isFinite(trimHeight) && trimHeight > 0) {
      return {
        kind: 'print',
        width: trimWidth,
        height: trimHeight
      };
    }

    return null;
  }

function renderCanvasPreview(job, dimsOverride, mediaKindOverride) {
    var box = document.getElementById('format-canvas-box');
    var noInfoEl = document.getElementById('canvas-noinfo');
    if (!box) return;

    var inner = box.querySelector('.artstart-canvas-inner');
    var bleedEl = box.querySelector('.artstart-canvas-bleed');
    var safeEl = box.querySelector('.artstart-canvas-safe');

    var dims = dimsOverride || (job ? extractCanvasDims(job) : null);
    var hasDims = !!dims;

    var mediaKind = mediaKindOverride || (hasDims ? dims.kind : null);
    var hideBleed = (mediaKind === 'digital');

    box.setAttribute('data-has-dimensions', hasDims ? 'true' : 'false');
    box.setAttribute('data-media-kind', mediaKind || '');

    if (!hasDims) {
      if (inner) {
        inner.style.width = '';
        inner.style.height = '';
      }
      if (bleedEl) {
        bleedEl.style.display = hideBleed ? 'none' : '';
        bleedEl.style.top = '';
        bleedEl.style.right = '';
        bleedEl.style.bottom = '';
        bleedEl.style.left = '';
      }
      if (safeEl) {
        safeEl.style.top = '';
        safeEl.style.right = '';
        safeEl.style.bottom = '';
        safeEl.style.left = '';
      }
      if (noInfoEl) {
        noInfoEl.style.display = 'flex';
      }
      return;
    }

    var w = dims.width || 1;
    var h = dims.height || 1;

    var displayWidth;
    var displayHeight;

    // PRINT MODE BELOW (digital shares the same stage model; only bleed behavior differs)

    // 1) Bleed in same units as trim (e.g., inches)
    var bleedAmount = 0;
    if (job) {
      var rawBleed = job.bleed;
      if (rawBleed !== undefined && rawBleed !== null && rawBleed !== '') {
        var parsed = parseFloat(rawBleed);
        if (isFinite(parsed) && parsed > 0) {
          bleedAmount = parsed;
        }
      }
    }

    // Digital must not include bleed in sizing math (and must place trim on the edge).
    if (mediaKind === 'digital') {
      bleedAmount = 0;
    }

    // Total artboard = trim + bleed on all four sides
    var totalWidth = w + bleedAmount * 2;
    var totalHeight = h + bleedAmount * 2;

    if (!isFinite(totalWidth) || totalWidth <= 0) totalWidth = w;
    if (!isFinite(totalHeight) || totalHeight <= 0) totalHeight = h;

    // 2) Scale the full artboard so it fills the card width.
    // Treat units as "inches" and convert to pixels, but cap
    // pixels-per-inch so huge formats don't explode.
    var maxWidth = box.clientWidth || 720;
    var MARGIN_FACTOR = 0.9;      // leave a little breathing room
    var MAX_PX_PER_UNIT = 120;    // ceiling on px per unit (inch)

    var pxPerUnit = Math.min(
      (maxWidth * MARGIN_FACTOR) / totalWidth,
      MAX_PX_PER_UNIT
    );

    displayWidth = Math.round(totalWidth * pxPerUnit);
    displayHeight = Math.round(totalHeight * pxPerUnit);

    if (inner) {
      inner.style.width = displayWidth + 'px';
      inner.style.height = displayHeight + 'px';
    }

    // Establish a baseline typography scale based on preview DPI.
    if (safeEl) {
      var BASE_PX_PER_INCH = 72; // reference "dpi" for type
      var baseScale = pxPerUnit / BASE_PX_PER_INCH;

      if (!isFinite(baseScale) || baseScale <= 0) {
        baseScale = 1;
      }

      baseScale = Math.max(0.10, baseScale);

      safeEl.dataset.baseScale = String(baseScale);
      safeEl.style.setProperty('--artstart-scale', baseScale.toFixed(3));
    }

    // 3) Position trim (magenta stroke) and bleed (dashed teal) correctly.
    if (safeEl) {
      if (mediaKind === 'digital') {
        // DIGITAL: trim is the document border (no bleed zone).
        safeEl.style.top = '0';
        safeEl.style.bottom = '0';
        safeEl.style.left = '0';
        safeEl.style.right = '0';

        if (bleedEl) {
          bleedEl.style.display = 'none';
          bleedEl.style.top = '';
          bleedEl.style.bottom = '';
          bleedEl.style.left = '';
          bleedEl.style.right = '';
        }
      } else if (bleedAmount > 0) {
        var bleedX = (bleedAmount / totalWidth) * displayWidth;
        var bleedY = (bleedAmount / totalHeight) * displayHeight;

        var insetTop = bleedY + 'px';
        var insetBottom = bleedY + 'px';
        var insetLeft = bleedX + 'px';
        var insetRight = bleedX + 'px';

        safeEl.style.top = insetTop;
        safeEl.style.bottom = insetBottom;
        safeEl.style.left = insetLeft;
        safeEl.style.right = insetRight;

        if (bleedEl) {
          bleedEl.style.display = hideBleed ? 'none' : '';
          bleedEl.style.top = insetTop;
          bleedEl.style.bottom = insetBottom;
          bleedEl.style.left = insetLeft;
          bleedEl.style.right = insetRight;
        }
      } else {
        // PRINT with no bleed configured: proportional inset
        safeEl.style.top = '6%';
        safeEl.style.bottom = '6%';
        safeEl.style.left = '6%';
        safeEl.style.right = '6%';

        if (bleedEl) {
          bleedEl.style.display = hideBleed ? 'none' : '';
          bleedEl.style.top = '6%';
          bleedEl.style.bottom = '6%';
          bleedEl.style.left = '6%';
          bleedEl.style.right = '6%';
        }
      }
    }

    if (noInfoEl) {
      noInfoEl.style.display = 'none';
    }
  }  
  // --- Canvas line layout helpers ---
  // Split text by hard returns and render each line as a span so we can measure widths precisely.
  function setCanvasLines(el, text, maxLines) {
    if (!el) return;

    var raw = (text || '');
    var lines = raw.split('\n');

    if (maxLines && maxLines > 0) {
      lines = lines.slice(0, maxLines);
    }

    // Clear
    while (el.firstChild) el.removeChild(el.firstChild);

    for (var i = 0; i < lines.length; i++) {
      var span = document.createElement('span');
      span.className = 'artstart-line';
      // Preserve empty lines as visible height.
      span.textContent = lines[i] === '' ? '\u00A0' : lines[i];
      el.appendChild(span);
    }
  }

  function _getLineSpans(rowEl) {
    if (!rowEl) return [];
    var spans = rowEl.querySelectorAll('.artstart-line');
    return spans && spans.length ? Array.prototype.slice.call(spans) : [];
  }

  function _prepareSpansForMeasure(spans) {
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      // No transforms; true typographic fit uses font-size only.
      s.style.transform = '';
      s.style.display = 'block';
      // Measure intrinsic width (override CSS temporarily)
      s.style.width = 'max-content';
      s.style.whiteSpace = 'pre';
    }
  }

  function _measureMaxLineWidthPx(rowEl) {
    var spans = _getLineSpans(rowEl);
    if (!spans.length) return 0;
    _prepareSpansForMeasure(spans);

    var maxW = 0;
    for (var i = 0; i < spans.length; i++) {
      // scrollWidth tracks intrinsic width (no transforms)
      var w = spans[i].scrollWidth || 0;
      if (w > maxW) maxW = w;
    }
    // Important: remove inline measurement width so CSS can right-align meta lines.
    for (var k = 0; k < spans.length; k++) {
      spans[k].style.width = '';
    }
    return maxW;
  }

  function _countLines(rowEl) {
    var spans = _getLineSpans(rowEl);
    return spans.length ? spans.length : 0;
  }

  // Fit a single band (rowEl) into its parent cell by font-size (no wrapping, no scaleX).
  // Returns the chosen font-size in px.
  function _fitRowToCellByFontSize(rowEl, cellEl, lineHeightMult, minPx, maxPx) {
    if (!rowEl || !cellEl) return minPx;

    var W = cellEl.clientWidth || 0;
    var apparentH = cellEl.clientHeight || 0;

    if (!W || !apparentH) return minPx;

    var N = _countLines(rowEl);
    if (!N) {
      rowEl.style.fontSize = '';
      return minPx;
    }

    var lh = lineHeightMult || 1.2;

    // Height-constrained max size (one line = full band height / lh, multi-line shares it)
    var byH = apparentH / (N * lh);

    var size = Math.min(maxPx, Math.max(minPx, byH));

    // Apply candidate size, then check width; reduce proportionally if needed.
    rowEl.style.fontSize = size.toFixed(2) + 'px';

    var maxLineW = _measureMaxLineWidthPx(rowEl);
    if (maxLineW > 0 && maxLineW > W) {
      var shrink = W / maxLineW;
      size = size * shrink;
      size = Math.min(maxPx, Math.max(minPx, size));
      rowEl.style.fontSize = size.toFixed(2) + 'px';
    }

    // One more pass (fonts measure slightly non-linear across sizes).
    maxLineW = _measureMaxLineWidthPx(rowEl);
    if (maxLineW > 0 && maxLineW > W) {
      var shrink2 = W / maxLineW;
      size = size * shrink2;
      size = Math.min(maxPx, Math.max(minPx, size));
      rowEl.style.fontSize = size.toFixed(2) + 'px';
    }

    return size;
  }

  // Fit website + email together inside the meta band (shared 10% cell).
  function _fitMetaBlock(cellEl, websiteRowEl, emailRowEl, lineHeightMult, minPx, maxPx) {
    if (!cellEl) return;

    var W = cellEl.clientWidth || 0;
    var H = cellEl.clientHeight || 0;
    if (!W || !H) return;

    var spansW = _getLineSpans(websiteRowEl);
    var spansE = _getLineSpans(emailRowEl);

    var linesCount = 0;
    if (spansW.length) linesCount += spansW.length;
    if (spansE.length) linesCount += spansE.length;

    // If nothing, clear inline sizes and exit.
    if (!linesCount) {
      if (websiteRowEl) websiteRowEl.style.fontSize = '';
      if (emailRowEl) emailRowEl.style.fontSize = '';
      return;
    }

    var lh = lineHeightMult || 1.2;

    var byH = H / (linesCount * lh);
    var size = Math.min(maxPx, Math.max(minPx, byH));

    if (websiteRowEl) websiteRowEl.style.fontSize = size.toFixed(2) + 'px';
    if (emailRowEl) emailRowEl.style.fontSize = size.toFixed(2) + 'px';

    // Measure max line width across both rows and shrink if needed.
    var maxW = 0;
    if (websiteRowEl) maxW = Math.max(maxW, _measureMaxLineWidthPx(websiteRowEl));
    if (emailRowEl) maxW = Math.max(maxW, _measureMaxLineWidthPx(emailRowEl));

    if (maxW > 0 && maxW > W) {
      var shrink = W / maxW;
      size = size * shrink;
      size = Math.min(maxPx, Math.max(minPx, size));
      if (websiteRowEl) websiteRowEl.style.fontSize = size.toFixed(2) + 'px';
      if (emailRowEl) emailRowEl.style.fontSize = size.toFixed(2) + 'px';
    }

    // One more pass.
    maxW = 0;
    if (websiteRowEl) maxW = Math.max(maxW, _measureMaxLineWidthPx(websiteRowEl));
    if (emailRowEl) maxW = Math.max(maxW, _measureMaxLineWidthPx(emailRowEl));

    if (maxW > 0 && maxW > W) {
      var shrink2 = W / maxW;
      size = size * shrink2;
      size = Math.min(maxPx, Math.max(minPx, size));
      if (websiteRowEl) websiteRowEl.style.fontSize = size.toFixed(2) + 'px';
      if (emailRowEl) emailRowEl.style.fontSize = size.toFixed(2) + 'px';
    }
  }

  function autoscaleCanvasBands() {
    var safe = document.querySelector('.artstart-canvas-safe');
    if (!safe) return;

    // Cells (bands) in order: 15/15/20/40/10
    var cells = safe.querySelectorAll('.artstart-canvas-cell, .artstart-canvas-cell-meta');
    if (!cells || cells.length < 5) return;

    var headlineCell = cells[0];
    var subheadCell = cells[1];
    var ctaCell = cells[2];
    var bodyCell = cells[3];
    var metaCell = cells[4];

    var headlineEl = document.getElementById('canvas-headline');
    var subheadEl = document.getElementById('canvas-subhead');
    var ctaEl = document.getElementById('canvas-cta');
    var bodyEl = document.getElementById('canvas-body');
    var websiteEl = document.getElementById('canvas-website');
    var emailEl = document.getElementById('canvas-email');

    // Fit each band by true font-size autoscale.
    _fitRowToCellByFontSize(headlineEl, headlineCell, 1.2, 6, 999);
    _fitRowToCellByFontSize(subheadEl, subheadCell, 1.2, 6, 999);
    _fitRowToCellByFontSize(ctaEl, ctaCell, 1.2, 6, 999);
    _fitRowToCellByFontSize(bodyEl, bodyCell, 1.3, 6, 999);

    // Meta: website + email share the same band and must both fit.
    _fitMetaBlock(metaCell, websiteEl, emailEl, 1.2, 6, 999);
  }

  function syncCanvasTextFromFields() {
    var box = document.getElementById('format-canvas-box');
    if (!box || box.getAttribute('data-has-dimensions') !== 'true') return;

    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }

    var headline = val('working-headline').trim();
    var subhead = val('working-subhead').trim();
    var cta = val('working-cta').trim();

    var body = val('working-bullets');
    if (body) {
      // Keep internal line breaks; no soft wrapping, only hard returns.
      body = body.trim();
    }

    var website = val('working-website').trim();
    var email = val('working-email').trim();

    var headlineEl = document.getElementById('canvas-headline');
    var subheadEl = document.getElementById('canvas-subhead');
    var ctaEl = document.getElementById('canvas-cta');
    var bodyEl = document.getElementById('canvas-body');
    var websiteEl = document.getElementById('canvas-website');
    var emailEl = document.getElementById('canvas-email');

    // Render as explicit line spans so we can scaleX each line to "justify" horizontally.
    setCanvasLines(headlineEl, headline, 1);
    setCanvasLines(subheadEl, subhead, 2);
    setCanvasLines(ctaEl, cta, 4);
    setCanvasLines(bodyEl, body, 0); // 0 = unlimited
    setCanvasLines(websiteEl, website, 1);
    setCanvasLines(emailEl, email, 1);

    // After mirroring text into the canvas, fit each band by true font-size autoscale.
    autoscaleCanvasBands();
  }

  function autoscaleCanvas() {
    // Back-compat shim in case anything still calls autoscaleCanvas().
    autoscaleCanvasBands();
  }
  function populateJob(job) {
    var gridEl = document.getElementById('artstart-grid');
    if (gridEl) {
      gridEl.style.display = '';
    }

    // QR attachment (base job metadata, not translated)
    try {
      // Prefer a user-picked QR override (prevents async refresh from snapping back to stale sheet fields)
      var jobKeyQr = (job && (job.jobId || job.ascendJobId)) || getJobIdFromQuery();
      var qrOverride = null;

      try {
        if (jobKeyQr && window.localStorage) {
          var rawQr = window.localStorage.getItem('artstart_qr_override_v1:' + jobKeyQr);
          if (rawQr) qrOverride = JSON.parse(rawQr);
        }
      } catch (_e) { qrOverride = null; }

      if (qrOverride && qrOverride.driveFileId) {
        // Sanitize stale overrides (older builds stored a human label or empty payload).
        try {
          var opt = String((qrOverride && qrOverride.payloadText) || '').trim();
          if (/codedesk/i.test(opt) && /flattened/i.test(opt)) opt = '';
          qrOverride.payloadText = opt;
        } catch (_e) {}

        // If override payload is empty, fall back to the job's canonical DestinationUrl fields only.
        if (!String((qrOverride && qrOverride.payloadText) || '').trim()) {
          qrOverride.payloadText = (job && (
            job.DestinationUrl || job.destinationUrl || job.destination_url
          )) || '';
        }

        setQrState_(qrOverride);
      } else {
        setQrState_({
          driveFileId: (job && (
            job.qrDrivePngFileId || job.QrDrivePngFileId || job.qr_drive_png_file_id ||
            job.qrDriveFileId || job.QrDriveFileId || job.qr_drive_file_id
          )) || '',
          openUrl: (job && (
            job.qrDrivePngOpenUrl || job.QrDrivePngOpenUrl || job.qr_drive_png_open_url ||
            job.qrOpenUrl || job.QrOpenUrl || job.qr_open_url
          )) || '',
          payloadText: (job && (
            job.DestinationUrl || job.destinationUrl || job.destination_url
          )) || ''
        });
      }
    } catch (e) {}

    // Header middle
    var headerTitleEl = document.getElementById('job-title');
    var headerMetaEl = document.getElementById('job-meta');
    var titleParts = [];
    if (job.jobTitle) titleParts.push(job.jobTitle);
    headerTitleEl.textContent = titleParts.join(' • ') || job.jobId || 'Job';

    var metaBits = [];
    if (job.publication) metaBits.push(job.publication);
    if (job.placement) metaBits.push(job.placement);
    headerMetaEl.textContent = metaBits.join(' • ');

    // Overview card
    var overviewTitleEl = document.getElementById('job-overview-title');
    if (overviewTitleEl) {
      // Filename: user-entered Job ID from intake (NordsonJobId),
      // fall back to internal Ascend id and other labels.
      overviewTitleEl.textContent =
        job.jobFilename ||      // from getArtStartJob_ (p.NordsonJobId)
        job.nordsonJobCode ||   // NordsonJobId fallback
        job.jobTitle ||         // extra fallback
        job.jobId ||            // internal Ascend id
        job.ascendJobId ||
        '—';
    }

    // Requested by
    var requesterName =
      job.requesterName ||
      job.requestedByName ||
      job.requestedByNameFirst ||
      '';
    var requesterEmail =
      job.requesterEmail ||
      job.requestedByEmail ||
      job.requestedByEmailAddress ||
      '';

    var requesterBits = [];
    if (requesterName) requesterBits.push(requesterName);
    if (requesterEmail) requesterBits.push('<' + requesterEmail + '>');

    var requesterEl = document.getElementById('job-overview-requester');
    if (requesterEl) {
      requesterEl.textContent = requesterBits.join(' ') || '—';
    }

    // Dates
    var created =
      job.createdDatePretty ||
      job.createdDate ||
      job.createdOn ||
      '';
    var run =
      job.runDatePretty ||
      job.runDate ||
      job.goLiveDatePretty ||
      job.goLiveDate ||
      '';
    var materials =
      job.materialsDeadlinePretty ||
      job.materialsDeadline ||
      job.materialsDueDatePretty ||
      job.materialsDueDate ||
      job.materialsDue ||
      '';

    var createdEl = document.getElementById('job-overview-created');
    if (createdEl) createdEl.textContent = created || '—';

    var runEl = document.getElementById('job-overview-run');
    if (runEl) runEl.textContent = run || '—';

    var deadlineEl = document.getElementById('job-overview-deadline');
    if (deadlineEl) deadlineEl.textContent = materials || '—';

    // Editorial notes + intake notes
    var topicEl = document.getElementById('job-overview-topic');
    if (topicEl) {
      topicEl.textContent =
        job.topic ||
        job.editorialNotes ||
        '—';
    }

    var notesEl = document.getElementById('job-overview-notes');
    if (notesEl) {
      notesEl.textContent =
        job.notes ||
        job.intakeNotes ||
        '—';
    }

    // Format card
    var formatPretty = buildFormatPretty(job);
    var dimsForSize = extractCanvasDims(job);

    // Media kind:
    // 1) Trust MediaType from the sheet first
    // 2) Fall back to whatever extractCanvasDims decided
    var mediaKind = null;
    var rawMediaType = job && (job.mediaType || job.MediaType || job.media_type || '');
    if (rawMediaType) {
      var mt = String(rawMediaType).toLowerCase();
      if (mt.indexOf('digital') !== -1) {
        mediaKind = 'digital';
      } else if (mt.indexOf('print') !== -1) {
        mediaKind = 'print';
      }
    }
    if (!mediaKind && dimsForSize && dimsForSize.kind) {
      mediaKind = dimsForSize.kind;
    }

    var publicationEl = document.getElementById('format-publication');
    if (publicationEl) publicationEl.textContent = job.publication || '—';

    var placementEl = document.getElementById('format-placement');
    if (placementEl) placementEl.textContent = job.placement || '—';

    var sizeText = '—';
    if (dimsForSize && dimsForSize.kind === 'digital' &&
        isFinite(dimsForSize.width) && isFinite(dimsForSize.height)) {
      sizeText = Math.round(dimsForSize.width) + 'px × ' + Math.round(dimsForSize.height) + 'px';
    } else if (formatPretty.trim) {
      sizeText = formatPretty.trim;
    }

    var sizeEl = document.getElementById('format-size');
    if (sizeEl) sizeEl.textContent = sizeText;

    var bleedRowEl = document.getElementById('format-bleed-row');
    var bleedEl = document.getElementById('format-bleed');
    if (bleedEl) bleedEl.textContent = formatPretty.bleed;
    if (bleedRowEl) {
      // Hide bleed row entirely for digital pieces.
      bleedRowEl.style.display = mediaKind === 'digital' ? 'none' : '';
    }
    
    // Canvas preview (digital vs print, with bleed)
    renderCanvasPreview(job, dimsForSize, mediaKind);

    // Working draft fields
    var prevActiveLanguage = activeLanguage;
    baseLanguage = (job && job.languagePrimary)
      ? String(job.languagePrimary).trim().toUpperCase()
      : 'EN';

    // Preserve user selection across fetchJob() refreshes.
    // Only snap to base if we have no prior selection.
    activeLanguage = prevActiveLanguage
      ? String(prevActiveLanguage).trim().toUpperCase()
      : baseLanguage;

    // Parse translations JSON
    try {
      translationsDb = job && job.workingTranslationsJson ? JSON.parse(job.workingTranslationsJson) : {};
    } catch (e) {
      translationsDb = {};
    }

    // Enforce translation invariants locally: translationsDb[lang].fields contains ONLY translatable fields.
    try {
      translationsDb = translationsDb || {};
      Object.keys(translationsDb).forEach(function (lang) {
        var rec = translationsDb[lang];
        if (!rec || !rec.fields) return;
        var f = rec.fields || {};
        rec.fields = {
          workingHeadline: String(f.workingHeadline || ''),
          workingSubhead: String(f.workingSubhead || ''),
          workingCta: String(f.workingCta || ''),
          workingBullets: String(f.workingBullets || '')
        };
      });
    } catch (_e) {}

    // Re-apply persisted "human vs machine" states so refreshes can't spring back.
    // IMPORTANT: "human" is only trusted if there is a local draft backing it.
    // This prevents stale state from making squares orange / showing the red button.
    try {
      var jobKeyState = (job && (job.jobId || job.ascendJobId)) || getJobIdFromQuery();
      translationsDb = translationsDb || {};

      // Ensure locally-known languages exist in translationsDb so they can be merged + displayed.
      var localLangs = getJobLocalLangs_(jobKeyState) || [];
      localLangs.forEach(function (L) {
        var langU = String(L || '').trim().toUpperCase();
        if (!langU || langU === baseLanguage) return;
        translationsDb[langU] = translationsDb[langU] || { human: false, fields: { workingHeadline:'', workingSubhead:'', workingCta:'', workingBullets:'' } };
      });

  Object.keys(translationsDb).forEach(function (lang) {
    var langU2 = String(lang || '').trim().toUpperCase();
    if (!langU2 || langU2 === baseLanguage) return;

    var rec = translationsDb[lang] || {};
    var st = loadLangState_(jobKeyState, langU2);

    if (st === 'human') {
      var d = loadLangDraft_(jobKeyState, langU2);

      // ONLY accept human if draft exists.
      if (d && d.fields) {
        rec.human = true;
      } else {
        rec.human = false;
        try { saveLangState_(jobKeyState, langU2, 'machine'); } catch (_eS) {}
      }

      translationsDb[lang] = rec;
      return;
    }

    if (st === 'machine') {
      rec.human = false;
      translationsDb[lang] = rec;
      return;
    }

    // No persisted state: default is machine-linked
    rec.human = false;
    translationsDb[lang] = rec;
  });
} catch (_e2) {}

    // Restore saved language selection for this job (prevents snap-back during async refreshes)
    var jobKey = (job && (job.jobId || job.ascendJobId)) || getJobIdFromQuery();
    var savedLang = loadActiveLanguage_(jobKey);
    if (savedLang) {
      activeLanguage = savedLang;
    }

    // Merge local drafts last so fetchJob() can never overwrite unsaved/just-saved translation edits.
    // Include locally-known languages so edits persist even if the server payload lags.
    try {
      var jobKeyDraft = jobKey;
      var langsToMerge = {};

      langsToMerge[String(activeLanguage || '').trim().toUpperCase()] = true;
      Object.keys(translationsDb || {}).forEach(function (l) { langsToMerge[String(l || '').trim().toUpperCase()] = true; });
      (getJobLocalLangs_(jobKeyDraft) || []).forEach(function (l2) { langsToMerge[String(l2 || '').trim().toUpperCase()] = true; });

      Object.keys(langsToMerge).forEach(function (lang) {
        if (!lang || lang === baseLanguage) return;

        var d = loadLangDraft_(jobKeyDraft, lang);
        if (!d || !d.fields) return;

        // Draft exists => this language is human-edited/decoupled
        try { saveLangState_(jobKeyDraft, lang, 'human'); } catch (_eS) {}

        translationsDb = translationsDb || {};
        translationsDb[lang] = translationsDb[lang] || {};
        translationsDb[lang].human = true;
        translationsDb[lang].edited = true;
        translationsDb[lang].at = d.at || (new Date()).toISOString();
        translationsDb[lang].fields = {
          workingHeadline: String(d.fields.workingHeadline || ''),
          workingSubhead:  String(d.fields.workingSubhead || ''),
          workingCta:      String(d.fields.workingCta || ''),
          workingBullets:  String(d.fields.workingBullets || '')
        };
      });
    } catch (_e4) {}

    // Establish baselines for every available translation record (required for "changed vs baseline" logic).
    try {
      translationsDb = translationsDb || {};
      Object.keys(translationsDb).forEach(function (l) {
        var L = String(l || '').trim().toUpperCase();
        if (!L || L === baseLanguage) return;
        var rec = translationsDb[L];
        if (!rec || !rec.fields) return;
        setLangBaseline_(L, rec.fields);
      });
    } catch (_eB) {}

    // Populate language dropdown
    if (langSelect) {
      langSelect.innerHTML = '';
      // Base language first (muted label)
      var optBase = document.createElement('option');
      optBase.value = baseLanguage;

      // Base language should read as a human label immediately (prevents "EN (EN)" flash/stick)
      optBase.textContent = 'English' + ' (' + baseLanguage + ')';
      try { optBase.setAttribute('data-base-label', optBase.textContent); } catch (_eBLabel) {}

      langSelect.appendChild(optBase);

      // Ensure the current selection exists immediately so the UI never snaps to base.
      if (activeLanguage && activeLanguage !== baseLanguage) {
        var optKeep = document.createElement('option');
        optKeep.value = activeLanguage;
        optKeep.textContent = activeLanguage + ' (' + activeLanguage + ')';
        langSelect.appendChild(optKeep);
      }

      // Keep current language selected (even before listLanguages returns).
      langSelect.value = activeLanguage;

      // Pull supported languages from backend
      try {
        var url = ARTSTART_API_BASE + '?action=listLanguages';
        fetch(url)
          .then(function (r) { return r.json(); })
          .then(function (payload) {
            var langs = (payload && payload.languages) ? payload.languages : [];
            langs.forEach(function (l) {
              var code = String((l && l.code) || '').trim().toUpperCase();
              var label = String((l && l.label) || code).trim();
              if (!code) return;

// If this is the base language, update the existing base option label to "Language (CODE)".
if (code === baseLanguage) {
  try {
    var baseOpt = langSelect && langSelect.querySelector && langSelect.querySelector('option[value="' + code + '"]');
    if (baseOpt) {
      baseOpt.textContent = label + ' (' + code + ')';
      try { baseOpt.setAttribute('data-base-label', baseOpt.textContent); } catch (_eB0lbl) {}
    }
  } catch (_eB0) {}
  return;
}

              // Avoid duplicates (we may have inserted a temporary option to preserve selection)
              // BUT: if it exists already, upgrade its label so we don't get stuck with "FR (FR)" forever.
              try {
                var existingOpt = langSelect && langSelect.querySelector && langSelect.querySelector('option[value="' + code + '"]');
                if (existingOpt) {
                  existingOpt.textContent = label + ' (' + code + ')';
                  try { existingOpt.setAttribute('data-base-label', label + ' (' + code + ')'); } catch (_eLbl) {}
                  return;
                }
              } catch (e) {}

              var opt = document.createElement('option');
              opt.value = code;
              opt.textContent = label + ' (' + code + ')';
              langSelect.appendChild(opt);
            });

            // listLanguages arrives async; re-assert current selection.
            langSelect.value = activeLanguage;
            updateLangDot_();
          })
          .catch(function () {
            // If listLanguages fails, leave base only.
            langSelect.value = activeLanguage;
            updateLangDot_();
          });
      } catch (e) {
            if (langSelect) langSelect.value = activeLanguage;
            updateLangDot_();
      }
     }   
  
    updateLangDot_();

    // Prevent "English snapback":
    // If a non-base language is active, NEVER overwrite the 4 translation fields with EN.
    // Prefer: (1) cached translationsDb, (2) local lang draft v1, (3) backend translated-fields fetch.
    var usedTranslation = false;
    if (activeLanguage && baseLanguage && activeLanguage !== baseLanguage) {
      var keyUpper = String(activeLanguage).trim().toUpperCase();
      var keyLower = keyUpper.toLowerCase();
      var entry = translationsDb && (translationsDb[keyUpper] || translationsDb[keyLower]);

      // (1) In-memory cache
      if (entry && entry.fields) {
        applyTranslatedFields_(entry.fields);
        usedTranslation = true;
        updateLangDot_();
      }

      // (2) Local per-language draft (authoritative for human edits)
      if (!usedTranslation) {
        try {
          var jobIdNow = currentJobId || (job && job.id) || getJobIdFromQuery();
          var localDraft = loadLangDraft_(jobIdNow, keyUpper);
          if (localDraft && localDraft.fields) {
            applyTranslatedFields_(localDraft.fields);
            try { setLangBaseline_(keyUpper, localDraft.fields); } catch (_eBL0) {}
            try { saveLangState_(jobIdNow, keyUpper, 'human'); } catch (_eST0) {}
            translationsDb = translationsDb || {};
            translationsDb[keyUpper] = translationsDb[keyUpper] || {};
            translationsDb[keyUpper].human = true;
            translationsDb[keyUpper].edited = true;
            translationsDb[keyUpper].fields = localDraft.fields;
            usedTranslation = true;
            updateLangDot_();
          }
        } catch (_eLD0) {}
      }

      // (3) Backend fetch for this language if we still have nothing (prevents "empty unless truly missing")
      if (!usedTranslation) {
        try {
          var jobIdNow2 = currentJobId || (job && job.id) || getJobIdFromQuery();
          if (jobIdNow2) {
            var urlT = ARTSTART_API_BASE
              + '?action=translateArtStartFields'
              + '&jobId=' + encodeURIComponent(String(jobIdNow2))
              + '&targetLanguage=' + encodeURIComponent(String(keyUpper));

            fetch(urlT)
              .then(function (r) { return r.json(); })
              .then(function (payload) {
                var f = payload && payload.fields ? payload.fields : null;
                if (!f) return;

                var fields = {
                  workingHeadline: String(f.workingHeadline || ''),
                  workingSubhead:  String(f.workingSubhead || ''),
                  workingCta:      String(f.workingCta || ''),
                  workingBullets:  String(f.workingBullets || '')
                };

                applyTranslatedFields_(fields);
                translationsDb = translationsDb || {};
                translationsDb[keyUpper] = translationsDb[keyUpper] || {};
                translationsDb[keyUpper].fields = fields;

                // Respect returned human/machine if present; default to machine.
                var isHuman = !!(payload && payload.human === true);
                translationsDb[keyUpper].human = isHuman;
                translationsDb[keyUpper].edited = isHuman;

                try { setLangBaseline_(keyUpper, fields); } catch (_eBL1) {}
                try { saveLangState_(jobIdNow2, keyUpper, isHuman ? 'human' : 'machine'); } catch (_eST1) {}

                updateLangDot_();
              })
              .catch(function () {
                // silent; we fall back to EN-only hydration below
              });
          }
        } catch (_eFT0) {}
      }
    }

    if (!usedTranslation) {
      // Only hydrate base-language fields when base language is active
      if (activeLanguage === baseLanguage) {
        document.getElementById('working-headline').value = job.workingHeadline || '';
        document.getElementById('working-subhead').value  = job.workingSubhead || '';
        document.getElementById('working-cta').value      = job.workingCta || '';
        document.getElementById('working-bullets').value  = job.workingBullets || '';

        const websiteEl = document.getElementById('working-website');
        if (websiteEl) websiteEl.value = job.workingWebsite || '';

        const emailEl = document.getElementById('working-email');
        if (emailEl) emailEl.value = job.workingEmail || '';

        document.getElementById('working-notes').value = job.workingNotes || '';
      } else {
        // Non-EN is active, but we had no cached translation fields to apply.
        // Do NOT leave the UI blank — hydrate by:
        //   1) local draft (human) if present
        //   2) otherwise auto-request machine translation ONCE per job+lang per page load
        try {
          var jobKeyHydrate = (job && (job.jobId || job.ascendJobId)) || getJobIdFromQuery();
          var langHydrate = String(activeLanguage || '').trim().toUpperCase();
          var guardKey = String(jobKeyHydrate || '') + ':' + langHydrate;

          // Prefer local draft if it exists (human-edited)
          var dHyd = loadLangDraft_(jobKeyHydrate, langHydrate);
          if (dHyd && dHyd.fields) {
            applyTranslatedFields_(dHyd.fields);
            usedTranslation = true;
            updateLangDot_();
          } else if (!__ARTSTART_AUTOTRANSLATE_DONE__[guardKey]) {
            __ARTSTART_AUTOTRANSLATE_DONE__[guardKey] = true;
            __ARTSTART_TRANSLATION_ACTION__ = true;
            retranslateLanguage_(langHydrate);
          }
        } catch (_eHyd) {}
      }
    }

    // Mirror text into canvas for scale only
    syncCanvasTextFromFields();
  }

  function setSaveStatus(text) {
    var el = document.getElementById('artstart-save-status');
    if (!el) return;
    el.textContent = text;
  }

  // ---------- Dave status helpers ----------

  function setDaveStatusHeader(text) {
    var el = document.getElementById('status-dave-header');
    if (el) el.textContent = text;
  }

  function setDaveStatusBody(text) {
    var el = document.getElementById('status-dave');
    if (el) el.textContent = text;
  }

  function refreshDaveStatus(jobId) {
    if (!jobId) return;

    setDaveStatusHeader('Dave (courier)');
    setDaveStatusBody('Checking task status…');

    var url = ARTSTART_API_BASE +
      '?action=getDaveStatusForJob&jobId=' +
      encodeURIComponent(jobId);

    fetch(url)
      .then(function (resp) { return resp.json(); })
      .then(function (data) {
        if (!data || data.success === false) {
          setDaveStatusBody('Dave status unavailable.');
          return;
        }

        if (!data.hasTask) {
          setDaveStatusBody('No courier task yet for this job.');
          return;
        }

        var t = data.task || {};
        var statusLabel = (t.Status || 'unknown').toString();

        // Header: "Dave – queued", "Dave – running", etc.
        setDaveStatusHeader('Dave – ' + statusLabel);

        var bits = [];
        if (t.Type) bits.push(t.Type);
        if (t.DeviceId) bits.push('Device: ' + t.DeviceId);
        if (t.RunDate) bits.push('Run: ' + t.RunDate);
        if (t.LastError) bits.push('Error: ' + t.LastError);

        setDaveStatusBody(bits.join(' • ') || 'Task recorded.');
      })
      .catch(function () {
        setDaveStatusBody('Dave status unavailable.');
      });
  }

  function buildDraftPayload(jobId) {
    return {
      jobId: jobId,
      workingHeadline: document.getElementById('working-headline').value,
      workingSubhead: document.getElementById('working-subhead').value,
      workingCta: document.getElementById('working-cta').value,
      workingBullets: document.getElementById('working-bullets').value,
      workingWebsite: (document.getElementById('working-website') || {}).value || '',
      workingEmail: (document.getElementById('working-email') || {}).value || '',
      workingNotes: document.getElementById('working-notes').value,

      // QR association (FileRoom)
      qrDriveFileId: (document.getElementById('qrDriveFileId') || {}).value || '',
      qrOpenUrl: (document.getElementById('qrOpenUrl') || {}).value || '',
      qrDestinationUrl: (document.getElementById('qrPayloadText') || {}).value || ''
    };
  }

function saveDraft(jobId, langOverride) {
  setSaveStatus('Saving…');

  var langToSave = langOverride || activeLanguage;

  var payload = buildDraftPayload(jobId);

  var isBase = (langToSave === baseLanguage);

  // Non-EN saves are translation-only: never persist EN-only meta fields or QR fields per-language.
  if (!isBase) {
    payload = {
      jobId: payload.jobId,
      workingHeadline: payload.workingHeadline,
      workingSubhead: payload.workingSubhead,
      workingCta: payload.workingCta,
      workingBullets: payload.workingBullets
    };

    // If nothing changed vs baseline, do NOT mark human or persist drafts.
    try {
      if (!langHasChangedFromBaseline_(langToSave, payload)) {
        setSaveStatus('Saved');
        updateLangDot_();
        return Promise.resolve({ success: true, skipped: true });
      }
    } catch (_e0) {}
  }

  // Trim empty QR params on base saves to reduce URL length and avoid backend confusion.
  if (isBase) {
    if (!payload.qrDriveFileId && !payload.qrOpenUrl && !payload.qrDestinationUrl) {
      delete payload.qrDriveFileId;
      delete payload.qrOpenUrl;
      delete payload.qrDestinationUrl;
    }
  }

  var url =
    ARTSTART_API_BASE +
    '?action=' + (isBase ? 'updateArtStartDraftFields' : 'updateArtStartTranslatedFields') +
    (isBase ? '' : ('&lang=' + encodeURIComponent(langToSave)));

  Object.keys(payload).forEach(function (key) {
    var value = payload[key];
    url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(value);
  });

  return fetch(url)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.success === false) {
        console.warn('ArtStart saveDraft: backend error', data);
        setSaveStatus('Save error');
        return { success: false, data: data };
      }

      // Track human edit state deterministically (for the language we actually saved)
      if (!isBase) {
        translationsDb = translationsDb || {};
        translationsDb[langToSave] = translationsDb[langToSave] || {};
        translationsDb[langToSave].human = true;
        translationsDb[langToSave].edited = true;
        translationsDb[langToSave].at = (new Date()).toISOString();
        translationsDb[langToSave].fields = translationsDb[langToSave].fields || {};
        var base = window.__ARTSTART_BASE_DRAFT_CACHE__ || {};
        translationsDb[langToSave].fields.workingHeadline = payload.workingHeadline || '';
        translationsDb[langToSave].fields.workingSubhead  = payload.workingSubhead  || '';
        translationsDb[langToSave].fields.workingCta      = payload.workingCta      || '';
        translationsDb[langToSave].fields.workingBullets  = payload.workingBullets  || '';

        // UI fallback rule: never show blanks if EN exists.
        if (!translationsDb[langToSave].fields.workingHeadline) translationsDb[langToSave].fields.workingHeadline = base.workingHeadline || '';
        if (!translationsDb[langToSave].fields.workingSubhead)  translationsDb[langToSave].fields.workingSubhead  = base.workingSubhead  || '';
        if (!translationsDb[langToSave].fields.workingCta)      translationsDb[langToSave].fields.workingCta      = base.workingCta      || '';
        if (!translationsDb[langToSave].fields.workingBullets)  translationsDb[langToSave].fields.workingBullets  = base.workingBullets  || '';

        // Persist human state so async refreshes can't revert it.
        try { saveLangState_(jobId, langToSave, 'human'); } catch (_e) {}

        // Persist the draft locally so fetchJob() can't overwrite it while the network save catches up.
        try { saveLangDraft_(jobId, langToSave, translationsDb[langToSave].fields); } catch (_e2) {}

        // Baseline becomes the human text (so subsequent edits can be detected).
        try { setLangBaseline_(langToSave, translationsDb[langToSave].fields); } catch (_e3) {}

        // Only update the UI indicator if we saved the currently viewed language
        if (langToSave === activeLanguage) updateLangDot_();
      }

      setSaveStatus('Saved');
      return { success: true, data: data };
    })
    .catch(function (err) {
      console.warn('ArtStart saveDraft: request failed', err);
      setSaveStatus('Save error');
      return { success: false, error: String(err) };
    });
}

  // Prevent duplicate listener attachment across fetchJob() refreshes.
  // fetchJob() can be called repeatedly (language switching, refreshes, etc.).
  // Guard to prevent duplicate blur / unload listeners across refreshes
  var __ARTSTART_BLUR_LISTENERS_JOB__ = window.__ARTSTART_BLUR_LISTENERS_JOB__ || '';

  function attachBlurListeners(jobId) {
    // Already attached for this job → do nothing.
    if (jobId && __ARTSTART_BLUR_LISTENERS_JOB__ === String(jobId)) {
      return;
    }
    __ARTSTART_BLUR_LISTENERS_JOB__ = String(jobId || '');
    window.__ARTSTART_BLUR_LISTENERS_JOB__ = __ARTSTART_BLUR_LISTENERS_JOB__;

    var debounceTimer = null;
    var DEBOUNCE_MS = 1500;

    // Language safety: snapshot the language at the moment of edit so debounce/unload cannot "follow" the dropdown.
    var lastEditedLanguage = null;
    var pendingDebounceLanguage = null;

    function scheduleAutosave(langSnapshot) {
      // If we are applying a machine translation / reset, do NOT autosave on blur.
      if (__ARTSTART_TRANSLATION_ACTION__ === true) return;

      setSaveStatus('Editing…');

      var langToSave = (langSnapshot || activeLanguage);
      lastEditedLanguage = langToSave;
      pendingDebounceLanguage = langToSave;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        var langFire = pendingDebounceLanguage || lastEditedLanguage || activeLanguage;
        pendingDebounceLanguage = null;
        saveDraft(jobId, langFire);
      }, DEBOUNCE_MS);
    }

    ['working-headline', 'working-subhead', 'working-cta', 'working-bullets', 'working-website', 'working-email', 'working-notes']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;

        el.addEventListener('input', function () {
          // Keep the canvas in sync while typing
          syncCanvasTextFromFields();

          // Language snapshot at the moment of edit:
          // - Translation fields follow the dropdown
          // - EN-only meta fields always save as baseLanguage
          var langSnapshot =
            (id === 'working-headline' || id === 'working-subhead' || id === 'working-cta' || id === 'working-bullets')
              ? activeLanguage
              : baseLanguage;

          // Debounced autosave while user pauses
          scheduleAutosave(langSnapshot);
        });

        el.addEventListener('blur', function () {
          // On explicit field exit, ensure a save happens promptly
          var langSnapshot =
            (id === 'working-headline' || id === 'working-subhead' || id === 'working-cta' || id === 'working-bullets')
              ? activeLanguage
              : baseLanguage;

          scheduleAutosave(langSnapshot);
        });
      });

    function finalSave() {
      try {
        // If there is a pending debounce, flush it and save immediately.
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        var langToSave = pendingDebounceLanguage || lastEditedLanguage || activeLanguage;

        var payload = buildDraftPayload(jobId);

        var isBase = (langToSave === baseLanguage);

        // Non-EN unload saves are translation-only: never persist EN-only meta fields or QR fields per-language.
        if (!isBase) {
          payload = {
            jobId: payload.jobId,
            workingHeadline: payload.workingHeadline,
            workingSubhead: payload.workingSubhead,
            workingCta: payload.workingCta,
            workingBullets: payload.workingBullets
          };
        }

        // Trim empty QR params on base unload saves to reduce URL length.
        if (isBase) {
          if (!payload.qrDriveFileId && !payload.qrOpenUrl && !payload.qrDestinationUrl) {
            delete payload.qrDriveFileId;
            delete payload.qrOpenUrl;
            delete payload.qrDestinationUrl;
          }
        }

        // IMPORTANT: Apps Script endpoints are querystring-driven in this app.
        // On unload, put the payload in the URL (like saveDraft does), not the POST body.
        var url =
          ARTSTART_API_BASE +
          '?action=' + (isBase ? 'updateArtStartDraftFields' : 'updateArtStartTranslatedFields') +
          (isBase ? '' : ('&lang=' + encodeURIComponent(langToSave)));

        Object.keys(payload).forEach(function (key) {
          var value = payload[key];
          url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(value);
        });

        if (navigator && typeof navigator.sendBeacon === 'function') {
          // sendBeacon is unload-safe, but it POSTs; that's fine because our data is now in the URL.
          var blob = new Blob([''], { type: 'text/plain' });
          navigator.sendBeacon(url, blob);
        } else {
          // Fallback: synchronous GET on unload
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, false);
          xhr.send(null);
        }
      } catch (e) {
        // Nothing useful to do during unload.
      }
    }

    window.addEventListener('beforeunload', finalSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        finalSave();
      }
    });
  }

  function fetchJsonWithTimeout_(url, timeoutMs) {
    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 25000;

    // AbortController supported in modern browsers; fall back to normal fetch if missing.
    var ctrl = null;
    var timer = null;

    try {
      if (typeof AbortController === 'function') {
        ctrl = new AbortController();
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) {}
        }, ms);
      }
    } catch (e2) { ctrl = null; }

    var opts = ctrl ? { signal: ctrl.signal } : {};
    // Be explicit; we’re on GitHub Pages calling Apps Script.
    opts.cache = 'no-store';
    opts.credentials = 'omit';

    return fetch(url, opts)
      .then(function (r) {
        // Don’t assume JSON; Apps Script can return HTML on auth/error.
        return r.text().then(function (txt) {
          var data = null;
          try { data = JSON.parse(txt); } catch (e) {
            var err = new Error('Non-JSON response from API');
            err._raw = txt;
            err._status = r.status;
            throw err;
          }
          return data;
        });
      })
      .finally(function () {
        if (timer) {
          try { clearTimeout(timer); } catch (e3) {}
        }
      });
  }

  // Fallback loader: XHR uses a different network path than fetch() and can succeed when fetch stalls.
  function fetchJsonViaXhr_(url, timeoutMs) {
    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 25000;

    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = ms;

        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;

          var status = xhr.status || 0;
          var txt = xhr.responseText || '';

          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(txt));
            } catch (e) {
              var err = new Error('Non-JSON response from API');
              err._raw = txt;
              err._status = status;
              reject(err);
            }
            return;
          }

          var err2 = new Error('HTTP ' + status);
          err2._raw = txt;
          err2._status = status;
          reject(err2);
        };

        xhr.ontimeout = function () {
          var errT = new Error('XHR timeout');
          errT.name = 'AbortError';
          reject(errT);
        };

        xhr.onerror = function () {
          reject(new Error('XHR network error'));
        };

        xhr.send(null);
      } catch (e2) {
        reject(e2);
      }
    });
  }

  function fetchJob(jobId) {
    currentJobId = jobId || '';
    clearError();
    setSaveStatus('Loading job…');

    var url = ARTSTART_API_BASE + '?action=getArtStartJob&jobId=' + encodeURIComponent(jobId);

    // DEBUG: show the exact endpoint being called
    try { console.log('ArtStart fetchJob URL:', url); } catch (_e0) {}

    fetchJsonWithTimeout_(url, 25000)
      .catch(function (err) {
        // If fetch() timed out / got stuck, try XHR as a fallback.
        try {
          if (err && String(err.name || '').toLowerCase().indexOf('abort') !== -1) {
            return fetchJsonViaXhr_(url, 25000);
          }
        } catch (_e0b) {}
        throw err;
      })
      .then(function (json) {
        if (!json || !json.ok) {
          throw new Error((json && json.error) || 'Unknown error');
        }

        // DEBUG: inspect the job payload for MediaType / mediaType
        try {
          console.log('ArtStart job payload:', json.job);
          if (json.job) {
            console.log(
              'MediaType fields:',
              json.job.MediaType,
              json.job.mediaType,
              json.job.media_type
            );
          }
        } catch (e) {
          // ignore
        }

        var effectiveJobId = (json.job && (json.job.jobId || json.job.ascendJobId)) || jobId;

        populateJob(json.job);
        attachBlurListeners(effectiveJobId);
        if (ARTSTART_ENABLE_DAVE_STATUS === true) {
          refreshDaveStatus(effectiveJobId);
        }
        setSaveStatus('Autosave ready.');
      })
      .catch(function (err) {
        console.error('Error loading job', err);

        // If the API returned HTML (common when auth/session breaks), show a useful clue.
        try {
          if (err && err._raw) {
            console.warn('ArtStart raw API response (first 300 chars):', String(err._raw).slice(0, 300));
          }
        } catch (_e2) {}

        var msg = 'We couldn’t load that job.';
        try {
          if (err && String(err.name || '').toLowerCase().indexOf('abort') !== -1) {
            msg = 'Timed out contacting ArtStart API (network/auth/CORS).';
          } else if (err && err._status) {
            msg = 'ArtStart API error (' + err._status + ').';
          } else if (err && err.message) {
            msg = 'ArtStart load error: ' + err.message;
          }
        } catch (_e3) {}

        setError(msg);
        setSaveStatus('Load error');
      });
  }

  // Dev-only hook so we can drive the UI from the console
  window.artStartDebug = window.artStartDebug || {};
  window.artStartDebug.populateJob = populateJob;
  window.artStartDebug.attachBlurListeners = attachBlurListeners;

  var getJobIdFromQuery = window.getJobIdFromQuery;

  function init() {
    setUserLabel();
    initQrUi_();

    // Cache language UI
    langSelect = document.getElementById('working-language');
    langDot = document.getElementById('working-language-square');

    // Build the custom picker UI (colored squares) and hide the native select.
    ensureLangPickerBuilt_();

    // Ensure the dropdown options get their per-language square indicators
    cacheLangOptionLabelsOnce_();
    paintLangOptionSquares_();

    // Sync picker button label + square immediately
    updateLangPickerUI_();

    // Legacy square is no longer the action control; we use a dedicated red button.
    if (langDot) {
      langDot.classList.add('is-hidden');
    }

    // Create the red, unlabeled re-translate square button inline next to the language square
    // Order: [square] [red] [select]
    if (langSelect && !langRetransBtn) {
      langRetransBtn = document.createElement('button');
      langRetransBtn.type = 'button';
      langRetransBtn.className = 'artstart-retranslate-btn is-hidden';
      langRetransBtn.setAttribute('aria-label', 'Re-translate from English');
      langRetransBtn.setAttribute('title', 'Re-translate from English');

      try {
        if (langDot && langDot.parentNode) {
          if (langDot.nextSibling) {
            langDot.parentNode.insertBefore(langRetransBtn, langDot.nextSibling);
          } else {
            langDot.parentNode.appendChild(langRetransBtn);
          }
        } else {
          langSelect.parentNode.insertBefore(langRetransBtn, langSelect);
        }
      } catch (e) {}

      // Must be mousedown so it runs BEFORE the focused field blurs (blur triggers autosave).
      langRetransBtn.addEventListener('mousedown', function () {
        __ARTSTART_TRANSLATION_ACTION__ = true;
      });

      langRetransBtn.addEventListener('click', function (ev) {
        try { ev.preventDefault(); } catch (_e) {}
        try { ev.stopPropagation(); } catch (_e2) {}

        if (activeLanguage === baseLanguage) {
          __ARTSTART_TRANSLATION_ACTION__ = false;
          return;
        }

        var entry = translationsDb && translationsDb[activeLanguage];
        var humanEdited = !!(entry && entry.human === true);
        if (!humanEdited) {
          __ARTSTART_TRANSLATION_ACTION__ = false;
          return;
        }

        // Run the reset; retranslateLanguage_ will clear the flag on completion.
        retranslateLanguage_(activeLanguage);
      });
    }

if (langSelect) {
  langSelect.addEventListener('change', function () {
    var jobIdNow = getJobIdFromQuery();
    var next = String(langSelect.value || '').trim().toUpperCase();
    if (!jobIdNow || !next) return;

    // If user selected the current language, do nothing.
    var prevLangSafe = String(activeLanguage || '').trim().toUpperCase() || baseLanguage;
    if (prevLangSafe === next) return;

    // Suppress blur/unload autosaves during the switch (blur fires when clicking the picker).
    __ARTSTART_TRANSLATION_ACTION__ = true;

    var leavingBase = (prevLangSafe === baseLanguage) && (next !== baseLanguage);

    // COMMIT the language we are leaving (prevents EN fetchJob() refresh from overwriting unsaved edits)
    try {
      var prevLang = prevLangSafe;
      if (prevLang && prevLang !== baseLanguage) {
        var snap = {
          workingHeadline: (document.getElementById('working-headline') || {}).value || '',
          workingSubhead:  (document.getElementById('working-subhead')  || {}).value || '',
          workingCta:      (document.getElementById('working-cta')      || {}).value || '',
          workingBullets:  (document.getElementById('working-bullets')  || {}).value || ''
        };

        // If this language is still "machine" and the user hasn't changed anything,
        // do NOT flip it to human or write a draft (prevents false "human edited" persistence).
        var stPrev = '';
        try { stPrev = loadLangState_(jobIdNow, prevLang); } catch (_eSt) { stPrev = ''; }

        var existing = (translationsDb && translationsDb[prevLang] && translationsDb[prevLang].fields) ? translationsDb[prevLang].fields : null;

        var wasHuman = !!(translationsDb && translationsDb[prevLang] && translationsDb[prevLang].human === true);

        // Default: assume unchanged unless we can prove a change against an existing record.
        // This prevents "just switching languages" from promoting machine translations to human.
        var changed = false;
        if (existing) {
          changed = !(
            String(existing.workingHeadline || '') === String(snap.workingHeadline || '') &&
            String(existing.workingSubhead  || '') === String(snap.workingSubhead  || '') &&
            String(existing.workingCta      || '') === String(snap.workingCta      || '') &&
            String(existing.workingBullets  || '') === String(snap.workingBullets  || '')
          );
        }

        // Only commit as human if it was already human, or we have a real diff against an existing record.
        if (wasHuman || stPrev === 'human' || changed) {
          translationsDb = translationsDb || {};
          translationsDb[prevLang] = translationsDb[prevLang] || {};
          translationsDb[prevLang].human = true;
          translationsDb[prevLang].at = (new Date()).toISOString();
          translationsDb[prevLang].fields = {
            workingHeadline: String(snap.workingHeadline || ''),
            workingSubhead:  String(snap.workingSubhead || ''),
            workingCta:      String(snap.workingCta || ''),
            workingBullets:  String(snap.workingBullets || '')
          };

          try { saveLangState_(jobIdNow, prevLang, 'human'); } catch (_e0) {}
          try { saveLangDraft_(jobIdNow, prevLang, translationsDb[prevLang].fields); } catch (_e1) {}

          // Also kick an immediate save for the language we are leaving (best effort).
          try { saveDraft(jobIdNow, prevLang); } catch (_e2) {}
        }
      }
    } catch (_e3) {}

    // If we are leaving EN → non-EN, force-save EN FIRST so the translator never sees stale/blank base text.
    var commitBaseP = Promise.resolve();
    if (leavingBase) {
      try { commitBaseP = saveDraft(jobIdNow, baseLanguage) || Promise.resolve(); } catch (_eB) { commitBaseP = Promise.resolve(); }
    }

    commitBaseP.then(function () {
      activeLanguage = next;
      saveActiveLanguage_(jobIdNow, activeLanguage);

      // Base language: reload canonical job fields from sheet
      if (activeLanguage === baseLanguage) {
        __ARTSTART_TRANSLATION_ACTION__ = false;
        fetchJob(jobIdNow);
        return;
      }

      // Prefer local per-language draft (survives refreshes; prevents "blank flash")
      try {
        var local = loadLangDraft_(jobIdNow, activeLanguage);
        if (local && local.fields) {
          applyTranslatedFields_(local.fields);
          updateLangDot_();
          __ARTSTART_TRANSLATION_ACTION__ = false;
          return;
        }
      } catch (_eLocal) {}

      // Existing translation in cache?
      var entry = translationsDb && translationsDb[activeLanguage];
      if (entry && entry.fields) {
        applyTranslatedFields_(entry.fields);
        updateLangDot_();
        __ARTSTART_TRANSLATION_ACTION__ = false;
        return;
      }

      // Otherwise request translation and persist server-side
      setSaveStatus('Translating…');

      fetch(
        ARTSTART_API_BASE +
        '?action=translateArtStartFields' +
        '&jobId=' + encodeURIComponent(jobIdNow) +
        '&targetLanguage=' + encodeURIComponent(activeLanguage)
      )
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || 'Translate failed');
          }

          // Record this as a machine-linked translation immediately (prevents baseline race).
          translationsDb = translationsDb || {};
          translationsDb[activeLanguage] = {
            human: false,
            at: (new Date()).toISOString(),
            fields: {
              workingHeadline: String(((payload.fields || {}).workingHeadline) || ''),
              workingSubhead:  String(((payload.fields || {}).workingSubhead) || ''),
              workingCta:      String(((payload.fields || {}).workingCta) || ''),
              workingBullets:  String(((payload.fields || {}).workingBullets) || '')
            }
          };

          // Persist "machine" state so async refreshes can't misclassify.
          try { saveLangState_(jobIdNow, activeLanguage, 'machine'); } catch (_e0) {}

          // Baseline becomes the machine text (so the first human edit can be detected/saved).
          try { setLangBaseline_(activeLanguage, translationsDb[activeLanguage].fields); } catch (_e1) {}

          // Apply translated text immediately
          applyTranslatedFields_(translationsDb[activeLanguage].fields);

          updateLangDot_();

          __ARTSTART_TRANSLATION_ACTION__ = false;

          // Refresh job payload so translationsDb + dot state are canonical
          // BUT keep the user’s selected language from snapping back to base.
          var keep = activeLanguage;
          fetchJob(jobIdNow);
          activeLanguage = keep;
        })
        .catch(function (err) {
          console.error(err);
          __ARTSTART_TRANSLATION_ACTION__ = false;
          setSaveStatus('Translate failed – try again');
        });
    });
  });
}
    // Prime the Dave status card before we know anything else.
    setDaveStatusHeader('Dave (courier)');
    setDaveStatusBody('Waiting for job…');

    var jobId = getJobIdFromQuery();
    currentJobId = jobId || '';
    if (!jobId) {
      setError('We couldn’t find that job (missing jobId).');
      return;
    }

    fetchJob(jobId);

    // Refit text if layout changes (responsive, digital scrollbox, etc.)
    window.addEventListener('resize', function () {
      autoscaleCanvasBands();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();