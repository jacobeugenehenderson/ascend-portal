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
  var FIELD_COMMITTED_EN = 'committedText';

  // Translation field (editable)
  var FIELD_TRANSLATION = 'workingText';

  // Machine translation seed field (optional)
  var FIELD_MACHINE = 'machineText';

  // Notes field (optional; if backend doesn’t support it yet, save will try anyway)
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
    return (params.get('lang') || '').trim().toUpperCase();
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

    // English is frozen after close, but translation remains editable.
    // Translation lock (if you ever add it) should be a separate flag.
    var locked = false;

    if (dueEl) {
      if (locked) dueEl.textContent = 'Locked';
      else if (job && job.dueDate) dueEl.textContent = 'Cutoff ' + job.dueDate;
      else dueEl.textContent = '';
    }

    if (countdownEl) {
      if (!locked && job && job.dueDate) countdownEl.textContent = formatCountdown_(job.dueDate);
      else countdownEl.textContent = '';
    }

    if (collabEl) {
      var c = job && job.collaborators;
      var txt = '';

      if (Array.isArray(c)) txt = c.join(', ');
      else if (typeof c === 'string') txt = c.trim();

      collabEl.textContent = txt ? txt : 'No collaborators';
      collabEl.classList.toggle('is-muted', !txt);
    }
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
    return (seg && (seg[FIELD_NOTES] || seg.translatorNotes)) || '';
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
      var machine = getMachine_(seg);
      var translation = getTranslation_(seg);
      var notes = getNotes_(seg);

      // Seed translation: prefer existing translation; else machine; else blank
      var seededTranslation = (typeof translation === 'string' && translation.length) ? translation : (machine || '');

      var row = document.createElement('div');
      row.className = 'subjob-row';
      row.dataset.segmentId = String(segId);

      // LEFT: stacked card
      var left = document.createElement('div');
      left.className = 'subjob-card';

      left.innerHTML = ''
        + '<div class="subjob-segmeta">'
        +   '<div class="subjob-card__label">Segment</div>'
        +   '<div class="subjob-chip">' + escapeHtml_(segId) + '</div>'
        + '</div>'
        + '<div class="subjob-stack">'
        +   '<div class="subjob-card__label">Committed English</div>'
        +   '<div class="subjob-english">' + escapeHtml_(committedEn) + '</div>'
        +   '<div class="subjob-card__label" style="margin-top:2px;">Translation</div>'
        +   '<textarea class="subjob-textarea" data-role="translation" data-segid="' + escapeHtml_(segId) + '" spellcheck="true"></textarea>'
        + '</div>';

      // RIGHT: notes card
      var right = document.createElement('div');
      right.className = 'subjob-card';

      right.innerHTML = ''
        + '<div class="subjob-card__label">Translator Notes</div>'
        + '<textarea class="subjob-textarea" data-role="notes" data-segid="' + escapeHtml_(segId) + '" spellcheck="true" style="min-height:140px;"></textarea>';

      row.appendChild(left);
      row.appendChild(right);
      rowsEl.appendChild(row);

      var taT = row.querySelector('textarea[data-role="translation"]');
      var taN = row.querySelector('textarea[data-role="notes"]');

      if (taT) {
        taT.value = seededTranslation || '';
        taT.disabled = !!locked;
      }
      if (taN) {
        taN.value = notes || '';
        taN.disabled = !!locked;
      }
    }

    bindOnce_(locked);
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
      patch: {}
    };

    if (patch && typeof patch.translation === 'string') p.patch[FIELD_TRANSLATION] = patch.translation;
    if (patch && typeof patch.notes === 'string') p.patch[FIELD_NOTES] = patch.notes;

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
        var payload2 = { action: 'updateSegment', spreadsheetId: getSpreadsheetId_(), jobId: __jobId, segmentId: segId };
        if (typeof patch.translation === 'string') payload2[FIELD_TRANSLATION] = patch.translation;
        if (typeof patch.notes === 'string') payload2[FIELD_NOTES] = patch.notes;
        res = await postJson_(payload2);
      }

      if (!res || res.ok === false) {
        // Fallback #2: fn
        var payload3 = { fn: 'updateSegment', spreadsheetId: getSpreadsheetId_(), jobId: __jobId, segmentId: segId };
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
      setStatus_('error', 'Save failed.', true);
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

    if (locked) {
      // Still bind flush events so we don’t crash; inputs are disabled anyway.
      hookFlushEvents_();
      return;
    }

    var container = document.getElementById('subjob-rows');
    if (!container) return;

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

  async function boot_() {
    __jobId = getJobIdFromQuery();
    __lang = getLangFromQuery();
    if (!__jobId) {
      setStatus_('error', 'Missing job id. Add ?jobid=...', true);
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

        var job = (res && res.job) ? res.job : (res && res.data ? res.data : {});
        // Normalize collaborators (same idea as main view)
        if (res && typeof res.collaborators === 'string') job.collaborators = res.collaborators;
        else if (res && res.header && typeof res.header.collaborators === 'string') job.collaborators = res.header.collaborators;
        else if (res && res.job && typeof res.job.collaborators === 'string') job.collaborators = res.job.collaborators;

        var segments = (res && res.segments) ? res.segments : (job && job.segments ? job.segments : []);
        var stylesCss = (res && res.stylesCss) ? res.stylesCss : '';

        injectStylesCss_(stylesCss);

        __latestSegments = segments || [];

        renderHeader_(job);

        // Keep header countdown fresh (1-minute tick)
        if (!window.__copydeskSubjobCountdownTimer) {
          window.__copydeskSubjobCountdownTimer = window.setInterval(function () {
            if (window.__copydeskSubjobJob) renderHeader_(window.__copydeskSubjobJob);
          }, 60000);
        }
        window.__copydeskSubjobJob = job;

        var locked = job && job.status === 'Locked';
        if (locked) setStatus_('ok', 'Locked. Editing is disabled.', false);
        else setStatus_('ok', 'Ready (autosave on).', false);

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