// copydesk_subjob_view.js
// Copydesk “Translation Subjob” view (single-language):
// - URL carries jobid/jobId (and whatever backend uses to resolve language/subjob)
// - Renders rows seeded from final Committed English + style metadata
// - Autosaves translator edits (and optional notes) frequently
//
// Key contract (V1):
// - English is frozen after parent job closes.
// - Translation remains editable (no Push; no cards lane; no ghost slots).
//
// Depends on:
// - window.COPYDESK_API_BASE (or it can call window.copydeskGetJob if present)
// - subjob.html DOM IDs: load-overlay(+text), job-name, job-cutoff-date, job-cutoff-countdown,
//   job-collaborators, subjob-rows, segments-empty, status-bar
//
// Explicit non-goals:
// - NO push, NO add/move/delete, NO ghost slots, NO two-lane layout on this page.

(function () {
  'use strict';

  // ---------------------------
  // Hot caches / state
  // ---------------------------
  var __latestSegments = [];
  var __jobId = '';
  var __lang = '';

  // ---------------------------
  // Field mapping (adjust only if backend uses different keys)
  // ---------------------------
  var FIELD_SEGMENT_ID = 'segmentId';

  // Canonical segment fields (match copydesk_job_view.js payload)
  var FIELD_COMMITTED_EN = 'committedText';

  // Translation field (editable)
  var FIELD_TRANSLATION = 'workingText';

  // Machine translation seed field (optional)
  var FIELD_MACHINE = 'machineText';

  // Notes field (optional)
  // Backend uses "notes" for translation subjobs (see copydesk_API.gs segments payload + updateSegment handler)
  var FIELD_NOTES = 'notes';

  // ---------------------------
  // URL
  // ---------------------------
  function getJobIdFromQuery() {
    var params = new URLSearchParams(window.location.search || '');
    return params.get('jobid') || params.get('jobId') || '';
  }

  function getLangFromQuery() {
    var params = new URLSearchParams(window.location.search || '');

    // Tolerate multiple param conventions.
    var v =
      params.get('lang') ||
      params.get('language') ||
      params.get('locale') ||
      params.get('subjob') ||
      params.get('subjobLang') ||
      params.get('target') ||
      params.get('to') ||
      params.get('tl') ||
      '';

    v = String(v || '').trim();

    // If URL omitted lang entirely, try storage fallbacks (job-scoped first).
    if (!v) {
      try {
        var jobIdNow = getJobIdFromQuery();

        var keys = [
          'copydesk_lang_' + jobIdNow,
          'copydesk_active_lang_' + jobIdNow,
          'copydesk_subjob_lang_' + jobIdNow,
          'copydesk_lang',
          'copydesk_active_lang',
          'copydesk_subjob_lang'
        ];

        for (var i = 0; i < keys.length && !v; i++) {
          try { v = (sessionStorage && sessionStorage.getItem(keys[i])) || ''; } catch (_eSS) { v = ''; }
          if (!v) {
            try { v = (localStorage && localStorage.getItem(keys[i])) || ''; } catch (_eLS) { v = ''; }
          }
          v = String(v || '').trim();
        }
      } catch (_e) {
        v = '';
      }
    }

    if (!v) return '';
    return String(v).toUpperCase(); // "fr" -> "FR"
  }

  // ---------------------------
  // Status bar
  // ---------------------------
  function setStatus_(state, message, isError) {
    var el = document.getElementById('status-bar');
    if (!el) return;

    el.textContent = message || '';

    // Match subjob.html CSS: status-ok / status-saving / status-error
    el.classList.remove('status-ok', 'status-saving', 'status-error');

    if (isError) {
      el.classList.add('status-error');
      return;
    }

    if (state === 'saving') {
      el.classList.add('status-saving');
      return;
    }

    // Default “good/neutral”
    el.classList.add('status-ok');
  }

  // ---------------------------
  // Load Overlay (slow actions)
  // ---------------------------
  var __overlayCount = 0;

  function showOverlay_(message) {
    var ov = document.getElementById('load-overlay');
    if (!ov) return;

    __overlayCount++;

    var txt = document.getElementById('load-overlay-text');
    if (txt) txt.textContent = message || 'Working…';

    ov.classList.add('is-on');
  }

  function hideOverlay_() {
    var ov = document.getElementById('load-overlay');
    if (!ov) return;

    __overlayCount = Math.max(0, __overlayCount - 1);
    if (__overlayCount === 0) ov.classList.remove('is-on');
  }

  async function withOverlay_(message, fn) {
    showOverlay_(message);
    try {
      return await fn();
    } finally {
      hideOverlay_();
    }
  }

  // ---------------------------
  // Countdown + header render (same intent as main view)
  // ---------------------------
  function formatCountdown_(dueISO) {
    if (!dueISO) return '';

    var now = new Date();
    var due = new Date(String(dueISO) + 'T23:59:59');

    var diffMs = due.getTime() - now.getTime();
    if (!(diffMs > 0)) return 'Due';

    var diffMin = Math.floor(diffMs / 60000);
    var diffHr = Math.floor(diffMin / 60);
    var diffDay = Math.floor(diffHr / 24);

    if (diffDay >= 1) return diffDay + 'd';
    if (diffHr >= 1) return diffHr + 'h';
    return diffMin + 'm';
  }

  function renderHeader_(job) {
    var nameEl = document.getElementById('job-name');
    var dueEl = document.getElementById('job-cutoff-date');
    var countdownEl = document.getElementById('job-cutoff-countdown');
    var collabEl = document.getElementById('job-collaborators');

    if (nameEl) {
      nameEl.textContent = (job && job.jobName) ? job.jobName : '';
    }

    // Subjob header rules:
    // - No cutoff, no countdown.
    // - Only show the translator identity (email).
    if (dueEl) dueEl.textContent = '';
    if (countdownEl) countdownEl.textContent = '';

    if (collabEl) {
      var c = job && job.collaborators;
      var txt = '';

      // Prefer single-string identity if present; otherwise first entry.
      if (typeof c === 'string') txt = c.trim();
      else if (Array.isArray(c) && c.length) txt = String(c[0] || '').trim();

      collabEl.textContent = txt ? txt : '';
      collabEl.classList.toggle('is-muted', !txt);
    }
  }

  // ---------------------------
  // Closed-state header helpers (Bucket B)
  // ---------------------------

  // Resolve THIS translation subjob meta from the job payload (defensive aliases).
  function getSubjobMeta_(job, lang) {
    lang = String(lang || '').trim().toUpperCase();
    if (!job || !lang) return null;

    var list = job.translations || job.translationSubjobs || job.translationJobs || [];
    if (!Array.isArray(list) || !list.length) return null;

    for (var i = 0; i < list.length; i++) {
      var t = list[i] || {};
      var code =
        String(t.lang || t.code || t.locale || t.languageCode || '').trim().toUpperCase();
      if (code === lang) return t;
    }
    return null;
  }

  function applyClosedHeader_(job, subMeta) {
    document.body.classList.add('copydesk-is-closed');

    var metaEl = document.getElementById('subjob-closed-meta');
    if (!metaEl) return;

    var translator = '';

    if (job && job.collaborators) {
      if (typeof job.collaborators === 'string') translator = job.collaborators.trim();
      else if (Array.isArray(job.collaborators) && job.collaborators.length) {
        translator = String(job.collaborators[0] || '').trim();
      }
    }

    // Always show a date. Prefer THIS subjob finishedAt; fall back to “today”.
    var when =
      (subMeta && (subMeta.finishedAt || subMeta.completedAt)) ? (subMeta.finishedAt || subMeta.completedAt) :
      (new Date().toISOString());

    var dateStr = '';
    try {
      var d = new Date(when);
      dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {}

    // Two-line meta (same slot Finish occupied):
    // {translator}
    // {date}
    var out = '';
    if (translator) out += translator;
    if (dateStr) out += (out ? '\n' : '') + dateStr;

    metaEl.textContent = out;
  }

  // ---------------------------
  // Styles injection (authoritative)
  // ---------------------------
  function injectStylesCss_(cssText) {
    if (!cssText) return;
    var id = 'copydesk-styles-css';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = cssText;
  }

  // ---------------------------
  // Minimal POST helper (compatible with Apps Script CORS strategy)
  // ---------------------------
  function getSpreadsheetId_() {
    // Use whatever the rest of your app already sets (do not invent new knobs elsewhere)
    return window.COPYDESK_SPREADSHEET_ID || window.TEMPLATE_SPREADSHEET_ID || '';
  }

  function assertBase_() {
    var base = window.COPYDESK_API_BASE || '';
    if (!base) throw new Error('Missing window.COPYDESK_API_BASE');
    return base;
  }

  async function postJson_(bodyObj) {
    var base = assertBase_();
    var res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj || {})
    });

    var raw = await res.text();
    try { return JSON.parse(raw); } catch (e) { return { ok: false, raw: raw }; }
  }

  // ---------------------------
  // Translation row rendering
  // ---------------------------

  // Auto-size a textarea to its content (used for CLOSED artifact view).
  function autoSizeTextarea_(ta) {
    if (!ta) return;
    try {
      ta.style.height = 'auto';
      ta.style.overflowY = 'hidden';
      ta.style.height = (ta.scrollHeight || 0) + 'px';
    } catch (e) {}
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getSegId_(seg, fallbackIdx) {
    return (seg && (seg[FIELD_SEGMENT_ID] || seg.segmentId || seg.id)) || ('seg_' + String(fallbackIdx || 0));
  }

  function getCommittedEn_(seg) {
    return (seg && (seg[FIELD_COMMITTED_EN] || seg.committedEnglish || seg.committed || seg.english || seg.text)) || '';
  }

  function getMachine_(seg) {
    return (seg && (seg[FIELD_MACHINE] || seg.machineTranslation || seg.mt)) || '';
  }

  function getTranslation_(seg) {
    return (seg && (seg[FIELD_TRANSLATION] || seg.translation)) || '';
  }

  function getNotes_(seg) {
    var v = (seg && (seg[FIELD_NOTES] || seg.notes || seg.translatorNotes)) || '';

    // Defensive: some payloads rename the field after finishing.
    // If still empty, scan for any key that looks like notes.
    if (!v && seg) {
      for (var k in seg) {
        if (!Object.prototype.hasOwnProperty.call(seg, k)) continue;
        if (/note/i.test(k)) {
          v = seg[k];
          if (v) break;
        }
      }
    }

    return v || '';
  }

  // ---------------------------
  // Style class (authoritative style-* hooks from backend/spreadsheet)
  // ---------------------------
  function styleLabelToCssClass_(label) {
    var raw = String(label || '').trim();
    if (!raw) return '';

    // If backend already sent a CSS classname, preserve it.
    // e.g. "style-headline", "style-bullet", "style-divider"
    if (/^style-/i.test(raw)) return raw;

    var v = raw.toLowerCase().trim();
    if (v === 'headline') return 'style-headline';
    if (v === 'subheadline') return 'style-subheadline';
    if (v === 'cta') return 'style-cta';
    if (v === 'bullet') return 'style-bullet';

    // Divider variants
    if (v === 'section divider') return 'style-divider';
    if (v === 'divider') return 'style-divider';
    if (v === 'segment divider') return 'style-divider';

    return 'style-body';
  }

  function getStyleClass_(seg) {
    // Match job view: style is a LABEL (committedStyle / workingStyle), not a CSS class.
    // Nuclear option: tolerate “spreadsheet-shaped” keys and backend variations.
    var v =
      (seg && (
        seg.committedStyle ||
        seg.workingStyle ||
        seg.styleLabel ||
        seg.style ||
        seg.committedStyleLabel ||
        seg.committed_style ||
        seg.style_label ||
        seg.committedStyleName
      )) ||
      '';

    // If still empty, scan for ANY key that looks like "style" (case-insensitive).
    if (!v && seg) {
      for (var k in seg) {
        if (!Object.prototype.hasOwnProperty.call(seg, k)) continue;
        if (/style/i.test(k)) {
          v = seg[k];
          if (v) break;
        }
      }
    }

    v = String(v || '').trim();
    if (!v) return '';
    return styleLabelToCssClass_(v);
  }

  function renderRows_(segments, locked) {
    var rowsEl = document.getElementById('subjob-rows');
    var emptyEl = document.getElementById('segments-empty');
    if (!rowsEl) return;

    rowsEl.innerHTML = '';

    if (!segments || !segments.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i] || {};
      var segId = getSegId_(seg, i);

      var committedEn = getCommittedEn_(seg);
      var styleClass = getStyleClass_(seg);

      // Divider is style-driven (matches spreadsheet style label → css class)
      // Tolerate backend variants: explicit divider flags/kinds.
      var isDivider =
        (styleClass === 'style-divider') ||
        (seg && (seg.isDivider === true || seg.divider === true)) ||
        (String(seg && (seg.kind || seg.type || '')).toLowerCase() === 'divider');
      var machine = getMachine_(seg);
      var translation = getTranslation_(seg);
      var notes = getNotes_(seg);

      var hasNotes = !!String(notes || '').trim();

      // Notes glyph should exist ONLY in LOCKED mode, and ONLY when notes exist.
      var notesBtnHtml = (locked && hasNotes)
        ? (
            ''
            + '<button type="button" class="subjob-notes-toggle" '
            +   'data-segid="' + escapeHtml_(segId) + '" '
            +   'aria-label="Translator notes" '
            +   'title="Translator notes">'
            +   '<span class="ascend-hopper-progress" aria-hidden="true">'
            +     '<span class="ascend-hopper-progress-dot" data-step="1"></span>'
            +     '<span class="ascend-hopper-progress-dot" data-step="2"></span>'
            +     '<span class="ascend-hopper-progress-dot" data-step="3"></span>'
            +   '</span>'
            + '</button>'
          )
        : '';

      // Locked-only popover target (starts hidden)
      var notesPopHtml = (locked && hasNotes)
        ? (
            ''
            + '<div class="subjob-notes-pop" data-segid="' + escapeHtml_(segId) + '" hidden>'
            +   '<div class="subjob-notes-pop__title">Translator Notes</div>'
            +   '<div class="subjob-notes-pop__body">' + escapeHtml_(notes) + '</div>'
            + '</div>'
          )
        : '';

      // Seed translation: prefer existing translation; else machine; else blank
      var seededTranslation = (typeof translation === 'string' && translation.length) ? translation : (machine || '');

      var row = document.createElement('div');
      row.className =
        'subjob-row' +
        (isDivider ? ' is-divider' : '') +
        ((i % 2) ? ' is-alt' : '');
      row.dataset.segmentId = String(segId);

      if (styleClass) row.classList.add(styleClass);

      // LEFT: stacked card (or divider)
      var left = document.createElement('div');
      left.className = 'subjob-card';

      if (isDivider) {
        // Divider = static graphical element only (no committed label, no translation field)
        left.innerHTML = ''
          + '<div class="subjob-divider" aria-hidden="true"></div>';
      } else {
        if (locked) {
          left.innerHTML = ''
            + '<div class="subjob-segmeta">'
            +   '<div class="subjob-card__label">Segment ' + (i + 1) + '</div>'
            +   notesBtnHtml
            + '</div>'
            + '<div class="subjob-stack subjob-artifact-stack">'
            +   '<div class="committed-seg subjob-english subjob-translation-wrap ' + styleClass + '">'
            +   '<textarea class="subjob-textarea subjob-translation committed-seg ' + styleClass + '" data-role="translation" data-segid="' + escapeHtml_(segId) + '" spellcheck="true"></textarea>'
            +   '</div>'
            +   '<div class="committed-seg subjob-english subjob-english-subtitle ' + styleClass + '">' + escapeHtml_(committedEn) + '</div>'
            + '</div>'
            + notesPopHtml;
        } else {
          left.innerHTML = ''
            + '<div class="subjob-segmeta">'
            +   '<div class="subjob-card__label">Segment ' + (i + 1) + '</div>'
            + '</div>'
            + '<div class="subjob-stack">'
            +   '<div class="subjob-card__label">Committed English</div>'
            +   '<div class="committed-seg subjob-english ' + styleClass + '">' + escapeHtml_(committedEn) + '</div>'
            +   '<div class="subjob-card__label" style="margin-top:2px;">Translation</div>'
            +   '<div class="committed-seg subjob-english subjob-translation-wrap ' + styleClass + '">'
            +   '<textarea class="subjob-textarea subjob-translation committed-seg ' + styleClass + '" data-role="translation" data-segid="' + escapeHtml_(segId) + '" spellcheck="true"></textarea>'
            +   '</div>'
            + '</div>';
        }
      }

      row.appendChild(left);

      // RIGHT: per-segment translator notes (OPEN STATE ONLY)
      if (!isDivider && !locked) {
        var right = document.createElement('div');
        right.className = 'subjob-card subjob-notes-col';

        right.innerHTML = ''
          + '<textarea class="subjob-textarea subjob-notes" '
          +   'data-role="notes" '
          +   'data-segid="' + escapeHtml_(segId) + '" '
          +   'spellcheck="true"></textarea>';

        row.appendChild(right);
      }

      rowsEl.appendChild(row);

      if (isDivider) {
        // Divider has no editable fields.
        continue;
      }

      // Hydrate any present textareas (open OR closed).
      var taT = row.querySelector('textarea[data-role="translation"]');
      if (taT) {
        taT.value = seededTranslation || '';
        taT.disabled = !!locked;
        taT.readOnly = !!locked;

        // In CLOSED mode, expand to show the full frozen artifact text.
        if (locked) autoSizeTextarea_(taT);
      }

      var taN = row.querySelector('textarea[data-role="notes"]');
      if (taN) {
        taN.value = notes || '';
        taN.disabled = !!locked;
      }
    }

    bindOnce_();

    // In CLOSED mode, do a second-pass autosize after layout/fonts settle,
    // so frozen translation textareas expand to show all content.
    if (locked) {
      setTimeout(function () {
        try {
          var container = document.getElementById('subjob-rows');
          if (!container) return;
          var tas = container.querySelectorAll('textarea[data-role="translation"]');
          tas.forEach(function (ta) { autoSizeTextarea_(ta); });
        } catch (e) {}
      }, 0);
    }
  }

  // ---------------------------
  // Autosave (per-segment; debounce + blur + pagehide/visibilitychange flush)
  // ---------------------------
  var DEBOUNCE_MS = 650;

  // segId -> { translation?: string, notes?: string }
  var segDirty = new Map();

  // segId -> timeout id
  var segTimers = new Map();

  // segId -> { translation: string, notes: string } last saved
  var segLastSaved = new Map();

  // segId -> boolean
  var segInflight = new Map();

  // segId -> queued patch
  var segQueued = new Map();

  function samePatch_(a, b) {
    if (!a || !b) return false;
    return (a.translation || '') === (b.translation || '') &&
           (a.notes || '') === (b.notes || '');
  }

  function markDirty_(segId, patch) {
    if (!segId) return;
    var cur = segDirty.get(segId) || {};
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'translation')) cur.translation = patch.translation;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'notes')) cur.notes = patch.notes;
    segDirty.set(segId, cur);
  }

  function scheduleSave_(segId, delayMs) {
    if (!segId) return;
    var d = (typeof delayMs === 'number') ? delayMs : DEBOUNCE_MS;

    if (segTimers.has(segId)) {
      clearTimeout(segTimers.get(segId));
      segTimers.delete(segId);
    }

    var t = setTimeout(function () {
      segTimers.delete(segId);
      saveNow_(segId);
    }, d);

    segTimers.set(segId, t);
  }

  function buildSavePayload_(segId, patch) {
    var p = {
      action: 'updateSegment',
      spreadsheetId: getSpreadsheetId_(),
      jobId: __jobId,
      segmentId: segId,
      lang: __lang
    };

    if (patch && typeof patch.translation === 'string') p[FIELD_TRANSLATION] = patch.translation;
    if (patch && typeof patch.notes === 'string') p[FIELD_NOTES] = patch.notes;

    return p;
  }

  async function saveNow_(segId) {
    if (!__jobId || !segId) return;

    var patch = segDirty.get(segId);
    if (!patch) return;

    // If nothing meaningful, bail
    var hasAny = (typeof patch.translation === 'string') || (typeof patch.notes === 'string');
    if (!hasAny) return;

    // De-dupe: if same as last-saved, skip
    var prev = segLastSaved.get(segId);
    if (prev && samePatch_(prev, patch)) {
      segDirty.delete(segId);
      return;
    }

    if (segInflight.get(segId)) {
      segQueued.set(segId, patch);
      return;
    }

    segInflight.set(segId, true);
    setStatus_('saving', 'Saving…', false);

    try {
      // If your API client eventually exposes a dedicated function, use it.
      // For now: POST directly, with a couple payload fallbacks.
      var payload = buildSavePayload_(segId, patch);
      var res = await postJson_(payload);

      if (!res || res.ok === false) {
        // Fallback #1: flattened
        var payload2 = { action: 'updateSegment', spreadsheetId: getSpreadsheetId_(), jobId: __jobId, segmentId: segId, lang: __lang };
        if (typeof patch.translation === 'string') payload2[FIELD_TRANSLATION] = patch.translation;
        if (typeof patch.notes === 'string') payload2[FIELD_NOTES] = patch.notes;
        res = await postJson_(payload2);
      }

      if (!res || res.ok === false) {
        // Fallback #2: fn
        var payload3 = { fn: 'updateSegment', spreadsheetId: getSpreadsheetId_(), jobId: __jobId, segmentId: segId, lang: __lang };
        if (typeof patch.translation === 'string') payload3[FIELD_TRANSLATION] = patch.translation;
        if (typeof patch.notes === 'string') payload3[FIELD_NOTES] = patch.notes;
        res = await postJson_(payload3);
      }

      if (res && res.ok !== false) {
        segLastSaved.set(segId, {
          translation: (typeof patch.translation === 'string') ? patch.translation : (prev ? prev.translation : ''),
          notes: (typeof patch.notes === 'string') ? patch.notes : (prev ? prev.notes : '')
        });
        segDirty.delete(segId);
        setStatus_('ok', 'Saved.', false);
      } else {
        setStatus_('error', 'Save failed.', true);
        console.error('Subjob save failed', { segId: segId, res: res, payload: payload });
        // keep dirty; can retry on flush
      }

      // If something queued during inflight, immediately save again
      var q = segQueued.get(segId);
      if (q) {
        segQueued.delete(segId);
        // Replace dirty with queued and run again
        segDirty.set(segId, q);
        // eslint-disable-next-line no-await-in-loop
        await saveNow_(segId);
      }

    } catch (err) {
      console.error('Subjob save error', err);
      setStatus_('error', 'Save failed: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
      segInflight.set(segId, false);
    }
  }

  async function flushAll_() {
    // cancel timers
    segTimers.forEach(function (tid) { clearTimeout(tid); });
    segTimers.clear();

    var ids = Array.from(segDirty.keys());
    for (var i = 0; i < ids.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await saveNow_(ids[i]);
    }
  }

  // ---------------------------
  // Event wiring (single bind; stable; no runaway listeners)
  // ---------------------------
  var __bound = false;

  function bindOnce_(locked) {
    if (__bound) return;
    __bound = true;

    var container = document.getElementById('subjob-rows');
    if (!container) return;

    // Notes toggle / jump (works in OPEN and CLOSED)
    container.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;

      var btn = (t.closest ? t.closest('.subjob-notes-toggle') : null);
      if (!btn) return;

      e.preventDefault();

      var segId = btn.getAttribute('data-segid') || '';
      if (!segId) return;

      var row = btn.closest ? btn.closest('.subjob-row') : null;
      if (!row) return;

      // Safe for use inside a double-quoted attribute selector.
      // Avoids relying on CSS.escape() being present.
      var sid = String(segId)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');

      var lockedNow = false;
      try { lockedNow = document.body && document.body.classList.contains('copydesk-is-closed'); } catch (_eLk) { lockedNow = false; }

      if (lockedNow) {
        // Close other open pops first (keeps the page tidy).
        try {
          var openPops = container.querySelectorAll('.subjob-notes-pop:not([hidden])');
          openPops.forEach(function (p) { p.hidden = true; });
        } catch (_eClose) {}

        var pop = row.querySelector('.subjob-notes-pop[data-segid="' + sid + '"]');
        if (!pop) return;

        pop.hidden = !pop.hidden;
        return;
      }

      // OPEN state: focus the notes textarea on the right (if present)
      var ta = row.querySelector('textarea[data-role="notes"][data-segid="' + sid + '"]');
      if (!ta) return;

      try {
        ta.focus();
        ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_e) {}
    });

    if (locked) {
      // Still bind flush events so we don’t crash; inputs are disabled anyway.
      hookFlushEvents_();
      return;
    }

    // Debounced input save
    container.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'TEXTAREA') return;

      var segId = el.getAttribute('data-segid') || '';
      var role = el.getAttribute('data-role') || '';

      if (role === 'translation') {
        markDirty_(segId, { translation: el.value });
        scheduleSave_(segId, DEBOUNCE_MS);
      } else if (role === 'notes') {
        markDirty_(segId, { notes: el.value });
        scheduleSave_(segId, DEBOUNCE_MS);
      }
    });

    // Blur save (immediate)
    container.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'TEXTAREA') return;

      var segId = el.getAttribute('data-segid') || '';
      scheduleSave_(segId, 0);
    }, true);

    hookFlushEvents_();
  }

  function hookFlushEvents_() {
    if (window.__copydeskSubjobBeforeUnloadBound) return;
    window.__copydeskSubjobBeforeUnloadBound = true;

    window.addEventListener('pagehide', function () {
      flushAll_(); // best effort
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAll_();
    });

    window.addEventListener('beforeunload', function () {
      flushAll_(); // best effort
    });
  }

  function bindFinishButton_(locked) {
    var btn = document.getElementById('subjob-finish-btn');
    if (!btn) return;

    if (locked) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }

    btn.disabled = false;

    if (btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener('click', async function () {
      if (btn.disabled) return;

      var ok = window.confirm('Mark this translation as finished?\n\nYour work is already saved. You can only finish the job once.');
      if (!ok) return;

      try {
        await withOverlay_('Finishing…', async function () {
          setStatus_('loading', 'Finishing…', false);

          // Best-effort flush of any pending autosaves before finalizing
          await flushAll_();

          var spreadsheetId = getSpreadsheetId_();

          var payload1 = { action: 'finishSubjob', spreadsheetId: spreadsheetId, jobId: __jobId };
          if (__lang) payload1.lang = __lang;

          var res = await postJson_(payload1);

          if (!res || res.ok === false) {
            var payload2 = { fn: 'finishSubjob', spreadsheetId: spreadsheetId, jobId: __jobId };
            if (__lang) payload2.lang = __lang;
            res = await postJson_(payload2);
          }

          if (!res || res.ok === false) {
            throw new Error((res && res.error) ? res.error : 'finishSubjob failed');
          }

          // Lock UI locally
          var container = document.getElementById('subjob-rows');
          if (container) {
            var tas = container.querySelectorAll('textarea');
            tas.forEach(function (ta) { ta.disabled = true; });
          }

          // Bucket B: enter closed/read-only header state immediately
          try {
            // Mark status locally so applyClosedHeader_ can render a date if backend doesn’t echo one yet.
            window.__copydeskSubjobJob = window.__copydeskSubjobJob || {};
            window.__copydeskSubjobJob.status = 'final';

            // Preserve collaborator identity already normalized in boot_()
            // and use a local timestamp as a fallback “finishedAt”.
            if (!window.__copydeskSubjobJob.finishedAt) {
              window.__copydeskSubjobJob.finishedAt = new Date().toISOString();
            }

            applyClosedHeader_(window.__copydeskSubjobJob);
          } catch (e) {}

          // Re-render rows in CLOSED / artifact mode
          renderRows_(__latestSegments, true);

          // Hide Finish (not just disabled)
          btn.style.display = 'none';
          btn.disabled = true;

          setStatus_('ok', 'Closed. Read-only.', false);
        });
      } catch (e) {
        console.error('finishSubjob error', e);
        setStatus_('error', 'Finish failed: ' + (e && e.message ? e.message : String(e)), true);
      }
    });
  }

  // ---------------------------
  // Load job + segments
  // ---------------------------
  async function getJob_(jobId) {
    var spreadsheetId = getSpreadsheetId_();

    // Prefer API client if available (same as main view)
    // IMPORTANT: most versions of copydeskGetJob expect a STRING jobId, not an object.
    if (window.copydeskGetJob) {
      try {
        return await window.copydeskGetJob(jobId, __lang);
      } catch (e) {
        return await window.copydeskGetJob(jobId);
      }
    }

    // Fallback to direct POST
    var payload1 = { action: 'getJob', spreadsheetId: spreadsheetId, jobId: jobId };
    if (__lang) payload1.lang = __lang;

    var res = await postJson_(payload1);

    if (!res || res.ok === false) {
      var payload2 = { fn: 'getJob', spreadsheetId: spreadsheetId, jobId: jobId };
      if (__lang) payload2.lang = __lang;
      res = await postJson_(payload2);
    }

    return res;
  }

  // Styles for translation subjobs are identical to the base job (STYLE tab).
  // Some backends omit stylesCss when lang is provided, so we fetch the base job
  // (no lang) as a fallback to obtain stylesCss for injection.
  async function getJobNoLang_(jobId) {
    var spreadsheetId = getSpreadsheetId_();

    // Prefer API client if available
    if (window.copydeskGetJob) {
      return await window.copydeskGetJob(jobId);
    }

    // Fallback to direct POST (NO lang)
    var payload1 = { action: 'getJob', spreadsheetId: spreadsheetId, jobId: jobId };
    var res = await postJson_(payload1);

    if (!res || res.ok === false) {
      var payload2 = { fn: 'getJob', spreadsheetId: spreadsheetId, jobId: jobId };
      res = await postJson_(payload2);
    }

    return res;
  }

  async function boot_() {
    __jobId = getJobIdFromQuery();
    __lang = getLangFromQuery();
    if (!__jobId) {
      setStatus_('error', 'Missing job id. Add ?jobid=...', true);
      return;
    }

    // Fail fast if API base is missing; without it autosave + finish cannot work.
    try { assertBase_(); }
    catch (e) {
      console.error(e);
      setStatus_('error', (e && e.message) ? e.message : String(e), true);
      return;
    }

    try {
      await withOverlay_('Loading job…', async function () {
        setStatus_('loading', 'Loading job…', false);

        var res = await getJob_(__jobId);

        if (!res || res.ok === false) {
          console.error('Subjob load failed', res);
          setStatus_('error', 'Error loading job.', true);
          return;
        }

        if (res && res.spreadsheetId) window.COPYDESK_SPREADSHEET_ID = res.spreadsheetId;

        var job = (res && res.job) ? res.job : (res && res.data ? res.data : {});

        // If backend resolved language, trust it over URL
        if (!__lang && res && res.lang) {
          __lang = String(res.lang).toUpperCase();
        }

        // Persist lang into the URL once known (stabilizes refresh + copy/paste links)
        try {
          if (__lang) {
            var u = new URL(window.location.href);
            if (!u.searchParams.get('lang')) {
              u.searchParams.set('lang', __lang);
              window.history.replaceState({}, '', u.toString());
            }
          }
        } catch (_eUrl) {}
        // Normalize collaborators (same idea as main view)
        if (res && typeof res.collaborators === 'string') job.collaborators = res.collaborators;
        else if (res && res.header && typeof res.header.collaborators === 'string') job.collaborators = res.header.collaborators;
        else if (res && res.job && typeof res.job.collaborators === 'string') job.collaborators = res.job.collaborators;

        var segments = (res && res.segments) ? res.segments : (job && job.segments ? job.segments : []);
        var stylesCss =
          (res && res.stylesCss) ? res.stylesCss :
          (res && res.styles_css) ? res.styles_css :
          (res && res.stylesCSS) ? res.stylesCSS :
          (res && res.css) ? res.css :
          (res && res.job && res.job.stylesCss) ? res.job.stylesCss :
          '';

        // Fallback: if lang call omitted stylesCss, fetch base job once to get stylesCss
        if (!stylesCss && __lang) {
          try {
            var baseRes = await getJobNoLang_(__jobId);
            stylesCss =
              (baseRes && baseRes.stylesCss) ? baseRes.stylesCss :
              (baseRes && baseRes.styles_css) ? baseRes.styles_css :
              (baseRes && baseRes.stylesCSS) ? baseRes.stylesCSS :
              (baseRes && baseRes.css) ? baseRes.css :
              (baseRes && baseRes.job && baseRes.job.stylesCss) ? baseRes.job.stylesCss :
              '';
          } catch (e) {
            // Ignore; page still renders—just without injected typography
          }
        }

        injectStylesCss_(stylesCss);

        __latestSegments = segments || [];

        renderHeader_(job);

        window.__copydeskSubjobJob = job;

        // Reset closed state UI each boot (defensive)
        document.body.classList.remove('copydesk-is-closed');
        var metaEl = document.getElementById('subjob-closed-meta');
        if (metaEl) metaEl.textContent = '';

        var subMeta = getSubjobMeta_(job, __lang);
        var statusLower = String((subMeta && (subMeta.status || subMeta.state)) || '').toLowerCase();

        // Locked iff THIS translation is actually finished.
        // Parent English being Closed must NOT lock translations.
        var locked =
          (statusLower === 'finished' ||
           statusLower === 'final' ||
           statusLower === 'done' ||
           !!(subMeta && (subMeta.finishedAt || subMeta.completedAt)));

        if (locked) {
          setStatus_('ok', 'Locked. Editing is disabled.', false);
          applyClosedHeader_(job, subMeta);
        } else {
          setStatus_('ok', 'Ready (autosave on).', false);
        }

        bindFinishButton_(locked);

        // Prime last-saved snapshots so first blur doesn’t re-save unchanged values
        segLastSaved.clear();
        segDirty.clear();
        segQueued.clear();

        // Render + bind
        renderRows_(__latestSegments, locked);

        // Prime snapshots from the DOM (what user sees is what we consider “saved baseline”)
        // This prevents immediate flushAll_ from POSTing everything.
        if (!locked) {
          var container = document.getElementById('subjob-rows');
          if (container) {
            var tas = container.querySelectorAll('textarea[data-segid]');
            tas.forEach(function (ta) {
              var segId = ta.getAttribute('data-segid') || '';
              var role = ta.getAttribute('data-role') || '';
              if (!segId) return;

              var prev = segLastSaved.get(segId) || { translation: '', notes: '' };
              if (role === 'translation') prev.translation = ta.value || '';
              if (role === 'notes') prev.notes = ta.value || '';
              segLastSaved.set(segId, prev);
            });
          }
        }

      });
    } catch (err) {
      console.error('Subjob boot error', err);
      setStatus_('error', 'Error loading job: ' + (err && err.message ? err.message : String(err)), true);
    }
  }

  document.addEventListener('DOMContentLoaded', boot_);
})();