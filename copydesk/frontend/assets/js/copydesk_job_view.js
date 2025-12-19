// copydesk_job_view.js
// Copydesk “Job” view (two-lane editorial):
// - Left lane = Committed (final English artifact)
// - Right lane = Edits (cards; autosave)
//
// Close regime (V1, clock-driven):
// - When now > cutoff (local end-of-day), job MUST auto-close (no user-facing “Close” button).
// - On close: lock editing UI + collapse layout (Committed 100% / Edits 0%; DOM stays intact).
// - On close: spawn translation subjobs for ALL supported languages (idempotent).
//
// Pills (read-only header, V1):
// - Only visible when job is Closed.
// - One pill per language; derived from backend translation/subjob data (not guessed).
// - Pill states map to: Seeded (createdAt), Human touched (touchedAt), Archived (archivedAt/status).
// - Clicking a pill navigates to the translation subjob view.
//
// Testing philosophy:
// - Prefer console triggers + spreadsheet cutoff edits. Avoid risky user UI.

(function () {
  'use strict';

  // ---------------------------
  // Auto-close state (V1)
  // ---------------------------
  var __autoCloseFired = false;
  var __autoCloseInflight = false;

  // Hot caches / state (must be declared in strict mode)
  var __latestSegments = [];
  var __latestCards = [];
  var __latestGhostSlots = [];

  // Styles hot-cache (prevents "window.__latestStyles is not defined")
  window.__latestStyles = window.__latestStyles || [];

  // ---------------------------
  // URL
  // ---------------------------
  function getJobIdFromQuery() {
    var params = new URLSearchParams(window.location.search || '');
    return params.get('jobid') || params.get('jobId') || '';
  }

  // ---------------------------
  // Status bar
  // ---------------------------

  function setPushEnabled_(enabled) {
    var btn = document.getElementById('push-btn');
    if (!btn) return;
    btn.disabled = !enabled;
  }
  function setStatus(state, message, isError) {
    var el = document.getElementById('status-bar');
    if (!el) return;

    el.textContent = message || '';

    // Minimal class strategy; keep your existing CSS if it exists.
    el.classList.toggle('status-error', !!isError);

    // Optional state classes (only if you want to style them)
    el.classList.toggle('status-loading', state === 'loading');
    el.classList.toggle('status-saving', state === 'saving');

    // disable Push while saving/loading
    setPushEnabled_(state !== 'saving' && state !== 'loading');
    el.classList.toggle('status-saved', state === 'saved');
    el.classList.toggle('status-locked', state === 'locked');
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
  // Rendering
  // ---------------------------

  // Countdown rules:
  // - days until the day of
  // - then hours
  // - last hour becomes minutes
  // Due date is treated as local end-of-day (no Dave required).
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

function renderHeader(job) {
  var nameEl = document.getElementById('job-name');

  // Back-compat: support either old div ids or new input ids
  var dueInput = document.getElementById('job-cutoff-input');
  var dueDiv = document.getElementById('job-cutoff-date');
  var countdownEl = document.getElementById('job-cutoff-countdown');

  var collabInput = document.getElementById('job-collaborators-input');
  var collabDiv = document.getElementById('job-collaborators');

  if (nameEl) {
    nameEl.textContent = (job && job.jobName) ? job.jobName : '';
  }

  // Treat Closed as locked (your CONTROL_PANEL now uses Open/Closed semantics)
  var isClosed = !!(job && String(job.status || '').toLowerCase() === 'closed');

  // Normalize due date to "yyyy-MM-dd" string if present
  var dueStr = (job && job.dueDate) ? String(job.dueDate).trim() : '';

  // Helper: compute whole-day delta (today 00:00 → due 00:00)
  function daysUntil_(yyyy_mm_dd) {
    if (!yyyy_mm_dd) return null;
    // Parse as local midnight (avoid timezone drift from Date-only parsing quirks)
    var due = new Date(yyyy_mm_dd + 'T00:00:00');
    if (isNaN(due.getTime())) return null;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var ms = due.getTime() - today.getTime();
    return Math.round(ms / 86400000);
  }

  // Deadline render (input preferred)
  if (dueInput) {
    dueInput.value = dueStr || '';

    // Reference-only: keep the calendar UI, but prevent edits.
    // (readonly keeps the styling/icon; disabling often greys it out.)
    // Reference-only: visually interactive, functionally inert
    dueInput.classList.add('job-cutoff-ref');
    dueInput.setAttribute('aria-readonly', 'true');

    // Kill any legacy handler if this input was previously wired in another build.
    if (dueInput.dataset.wired) delete dueInput.dataset.wired;

    // Defensive: block any attempt to open/change via keyboard.
    if (!dueInput.dataset.refOnlyWired) {
      dueInput.dataset.refOnlyWired = '1';
      dueInput.addEventListener('keydown', function (e) {
        // prevent typing / Enter from toggling picker
        e.preventDefault();
      });
      dueInput.addEventListener('click', function (e) {
        // prevent date picker popup
        e.preventDefault();
        try { dueInput.blur(); } catch (err) {}
      });
    }
  } else if (dueDiv) {
    dueDiv.textContent = isClosed ? 'Closed' : (dueStr ? dueStr : '');
  }

  // Days counter
  if (countdownEl) {
    if (isClosed) {
      countdownEl.textContent = '';
    } else {
      var d = daysUntil_(dueStr);
      if (d == null) {
        countdownEl.textContent = '';
      } else if (d === 0) {
        countdownEl.textContent = 'Due today';
      } else if (d > 0) {
        countdownEl.textContent = d + ' day' + (d === 1 ? '' : 's') + ' remaining';
      } else {
        var late = Math.abs(d);
        countdownEl.textContent = late + ' day' + (late === 1 ? '' : 's') + ' overdue';
      }
    }
  }

  // Collaborators normalize (allow array or comma-string)
  var c = job && job.collaborators;
  var collabStr = '';
  if (Array.isArray(c)) collabStr = c.join(', ');
  else if (typeof c === 'string') collabStr = c.trim();

  // Collaborators render + save
  if (collabInput) {
    collabInput.value = collabStr || '';
    collabInput.disabled = isClosed;

    if (!collabInput.dataset.wired) {
      collabInput.dataset.wired = '1';
      function saveCollaborators_() {
        if (!job || !job.jobId) return;
        if (isClosed) return;

        var v = String(collabInput.value || '').trim();
        if (window.copydeskUpdateJobMeta) {
          window.copydeskUpdateJobMeta(job.jobId, { collaborators: v }).catch(function () {});
        }
      }

      collabInput.addEventListener('blur', saveCollaborators_);

      // Save on Enter (Shift+Enter allowed to insert newline if this ever becomes a textarea)
      collabInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return;
        e.preventDefault();
        saveCollaborators_();
        try { collabInput.blur(); } catch (err) {}
      });
    }
  } else if (collabDiv) {
    collabDiv.textContent = collabStr ? collabStr : 'No collaborators';
    collabDiv.classList.toggle('is-muted', !collabStr);
  }
}
// Styles are authoritative from the spreadsheet; no invented defaults.

    function ensureStyles_(styles) {
    return (styles && styles.length) ? styles : [];
  }

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

  function styleLabelToCssClass_(label) {
    var v = (label || '').toLowerCase().trim();
    if (v === 'headline') return 'style-headline';
    if (v === 'subheadline') return 'style-subheadline';
    if (v === 'cta') return 'style-cta';
    if (v === 'bullet') return 'style-bullet';
    if (v === 'section divider') return 'style-divider';
    return 'style-body';
  }

function removeStyleClasses_(el) {
  if (!el) return;
  el.classList.remove(
    'style-headline',
    'style-subheadline',
    'style-body',
    'style-cta',
    'style-bullet',
    'style-divider'
  );
}

function applyStyleToEl_(el, styleLabel) {
  if (!el) return;
  removeStyleClasses_(el);
  el.classList.add(styleLabelToCssClass_(styleLabel));
}

// committed segments use committedStyle (immutable until push/timer)
function applyStyleToCommitted_(el, styleLabel) {
  applyStyleToEl_(el, styleLabel);
}

// card textarea uses workingStyle (live styling)
function applyStyleToTextarea_(cardEl, styleLabel) {
  if (!cardEl) return;
  var ta = cardEl.querySelector('[data-role="card-text"]');
  if (!ta) return;
  applyStyleToEl_(ta, styleLabel);
}

// legacy helper retained if anything still calls it
function applyStyleToRow_(row, styleLabel) {
  if (!row) return;
  var ta = row.querySelector('[data-role="working"]');
  if (ta) applyStyleToEl_(ta, styleLabel);
  applyStyleToEl_(row, styleLabel);
}
  function buildStyleSelect(styles, value) {
    styles = ensureStyles_(styles);

    var sel = document.createElement('select');
    sel.dataset.role = 'style';
    sel.className = 'seg-style-select';

    (styles || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label || s.value;
      sel.appendChild(opt);
    });

    if (value) sel.value = value;
    return sel;
  }

  // ---------------------------
  // Card Regime Rendering
  // ---------------------------

  function isDividerStyle_(styleLabel) {
    return String(styleLabel || '').trim().toLowerCase() === 'section divider';
  }

  function isDeleteRowStyle_(styleLabel) {
    var v = String(styleLabel || '').trim().toLowerCase();
    return v === 'delete row' || v === 'delete segment';
  }

  function isOneLineStyle_(styleLabel) {
    var v = String(styleLabel || '').trim().toLowerCase();
    return v === 'headline' || v === 'subheadline';
  }

  function isBulletStyle_(styleLabel) {
    return String(styleLabel || '').trim().toLowerCase() === 'bullet';
  }

  // Bullet rules:
  // - always bullet-prefixed lines
  // - empty => a single bullet glyph remains
  // - no "exit bullet mode"
  var BULLET_GLYPH = '• ';

  // Structural rows must never serialize as truly empty strings,
  // or they may collapse / fail to commit server-side.
  var ZWSP = '\u200B';

// Section divider must be REAL TEXT (em dashes), not a graphic line.
var SECTION_DIVIDER_TEXT = '——————————————————————————'; // zero-width space (invisible, but non-empty)

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // For Bullet style display only:
  // - each line shows bullet glyph (rendered)
  // - first " - " becomes bold lead-in (before dash)
  function renderBulletDisplayHtml_(text) {
    var raw = (text == null) ? '' : String(text);

    // normalize newlines
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // empty => single bullet glyph (no content)
    if (!raw.trim()) raw = BULLET_GLYPH;

    var lines = raw.split('\n');

    var out = lines.map(function (ln) {
      var s = String(ln || '');

      // strip any leading bullet/dash then normalize, so preview is stable
      s = s.replace(/^\s*(?:•\s*|\-\s*|\u2022\s*)/i, '');

      // dash→bold only on first " - " (space-dash-space)
      var idx = s.indexOf(' - ');
      if (idx >= 0) {
        var lead = s.slice(0, idx);
        var rest = s.slice(idx + 3); // skip " - "
        return '<span class="bullet-glyph">• </span><strong>' +
          escapeHtml_(lead) +
          '</strong> - ' +
          escapeHtml_(rest);
      }

      return '<span class="bullet-glyph">• </span>' + escapeHtml_(s);
    });

    // Use <br> because we are injecting HTML
    return out.join('<br>');
  }

  function ensureCardPreview_(cardEl) {
    // Preview system disabled: edits are always a single textarea surface.
    return null;
  }

  // Bullet UX: show formatted display when NOT editing; show textarea when editing.
    function showBulletDisplay_(cardEl) {
      // Preview system disabled.
      return;
    }

    function showBulletEditor_(cardEl) {
      // Preview system disabled.
      return;
    }

    function updateCardPreview_(cardEl) {
      // Preview system disabled: committed lane renders formatting; edit lane stays textarea-only.
      return;
    }
    function normalizeBulletText_(text) {
    var raw = (text == null) ? '' : String(text);

    // Normalize newlines
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // If empty/whitespace -> single bullet
    if (!raw.trim()) return BULLET_GLYPH;

    var lines = raw.split('\n').map(function (ln) {
      // Strip any leading bullets/dashes/spaces then re-apply bullet glyph
      var s = String(ln || '');

      // If user typed "-" bullets, accept them but normalize.
      s = s.replace(/^\s*(?:•\s*|\-\s*|\u2022\s*)/i, '');

      return BULLET_GLYPH + s;
    });

    return lines.join('\n');
  }

  function enforceOneLine_(text) {
    // Remove any hard returns; Headline/Subhead are single-line.
    return String(text == null ? '' : text).replace(/[\r\n]+/g, ' ');
  }

  function configureTextareaForStyle_(ta, styleLabel) {
    if (!ta) return;

    // reset
    ta.classList.remove('card-textarea--one-line');
    ta.removeAttribute('wrap');
    ta.rows = 0;

    if (isOneLineStyle_(styleLabel)) {
      // Headline/Subheadline: one-line, no wrap, horizontal scroll (CSS controls)
      ta.classList.add('card-textarea--one-line');
      ta.setAttribute('wrap', 'off');
      ta.rows = 1;
      ta.style.resize = 'none';
    } else {
      // normal multiline
      ta.rows = 3;
      ta.style.resize = 'none';
    }
  }

  function renderCommitted_(segments, cards, ghostSlots) {
    var list = document.getElementById('committed-list');
    var emptyState = document.getElementById('segments-empty');
    if (!list) return;

    list.innerHTML = '';

    if (!segments || !segments.length) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    // Build a quick lookup: segmentId -> card (if exists)
    var cardBySeg = {};
    (cards || []).forEach(function (c) {
      if (c && c.segmentId) cardBySeg[c.segmentId] = c;
    });

    // Ghost slots are *pure structure* in the committed lane.
    // They create empty vertical space so cards can insert above/below cleanly.
    var ghostSet = {};
    (ghostSlots || []).forEach(function (n) { ghostSet[String(n)] = true; });

    // Also map cards by slot index (orderIndex) so ghost slots can render
    // structural visuals (e.g., Section divider) instead of always blank.
    var cardBySlot = {};
    (cards || []).forEach(function (c) {
      if (!c) return;
      var oi = (typeof c.orderIndex === 'number')
        ? c.orderIndex
        : (c.orderIndex != null ? Number(c.orderIndex) : null);
      if (oi == null || isNaN(oi)) return;
      if (!Object.prototype.hasOwnProperty.call(cardBySlot, oi)) {
        cardBySlot[oi] = c;
      }
    });

    // Slot count must include real segments + ghost slots
    var slotCount = (segments || []).length + (ghostSlots || []).length;

    var segCursor = 0;

    for (var slot = 0; slot < slotCount; slot++) {
      // Ghost slot: render an empty committed row and consume NO segment
      if (ghostSet[String(slot)]) {
        var ghost = document.createElement('div');
        ghost.className = 'committed-seg committed-seg--ghost';
        ghost.dataset.slotIndex = String(slot);

        // If there is a card welded to this ghost slot and it's a divider,
        // render the divider line in the committed lane too.
        var gc = cardBySlot[slot];
        if (gc && isDividerStyle_(gc.workingStyle)) {
          ghost.classList.add('is-divider');
          ghost.textContent = SECTION_DIVIDER_TEXT;
          applyStyleToCommitted_(ghost, gc.workingStyle || 'Section divider');
        } else {
          ghost.innerHTML = '&nbsp;'; // keeps height without implying content
        }

        list.appendChild(ghost);
        continue;
      }

      // Real segment: consume next segment
      var seg = (segments || [])[segCursor++];
      if (!seg) continue;

      var segId = seg.segmentId || '';
      var committedText = seg.committedText || '';
      var style = seg.committedStyle || '';

      var wrapper = document.createElement('div');
      wrapper.className = 'committed-seg';
      wrapper.dataset.segmentId = segId;
      wrapper.dataset.slotIndex = String(slot);

      // Divider segment renders as REAL em-dash text (not a graphic line)
      if (isDividerStyle_(style)) {
        wrapper.classList.add('is-divider');
        // Always render the canonical divider width (existing committed rows may have older shorter text).
        wrapper.textContent = SECTION_DIVIDER_TEXT;
        applyStyleToCommitted_(wrapper, style);
        list.appendChild(wrapper);
        continue;
      }

      // If this segment has a card whose style is Delete row -> crosshatch committed segment
      var c = cardBySeg[segId];
      if (c && isDeleteRowStyle_(c.workingStyle)) {
        wrapper.classList.add('is-marked-delete');
      }

      // Committed rendering: if style is Bullet OR the committed text contains bullet glyphs,
      // render as bullet HTML so the dash→bold rule applies reliably.
      var looksLikeBullets =
        (String(committedText || '').indexOf('•') >= 0) ||
        (String(committedText || '').indexOf('\u2022') >= 0);

      if (isBulletStyle_(style) || looksLikeBullets) {
        wrapper.innerHTML = '<div class="committed-bullets">' + renderBulletDisplayHtml_(committedText) + '</div>';
      } else {
        wrapper.textContent = committedText;
      }
      applyStyleToCommitted_(wrapper, style);
      list.appendChild(wrapper);
    }
  }

  function buildDividerEditor_(initialValue, locked) {
    var box = document.createElement('div');
    box.className = 'card-divider';
    box.textContent = SECTION_DIVIDER_TEXT;

    // Spec: divider has no visible label/text field.
    // Keep autosave contract with a hidden [data-role="card-text"] input.
    var input = document.createElement('input');
    input.type = 'hidden';
    input.dataset.role = 'card-text';

    var v = (initialValue != null ? String(initialValue) : '');
    // Divider must never save blank; enforce real em-dash content.
    input.value = v ? v : SECTION_DIVIDER_TEXT;

    input.disabled = !!locked;

    box.appendChild(input);
    return box;
  }

  function buildDeleteNote_() {
    // Spec: no explanatory text for delete; pulldown + committed lane crosshatch tells the story.
    return null;
  }

  // Keep autosave contract WITHOUT showing a text surface.
  // (Delete Segment should not show editable content, but we still want a stable [data-role="card-text"] value.)
  function buildHiddenCardText_(value) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.dataset.role = 'card-text';

    var v = (value != null ? String(value) : '');
    input.value = v ? v : ZWSP;

    return input;
  }

  function buildCardStyleSelect_(styles, value) {
    styles = ensureStyles_(styles);

    var sel = document.createElement('select');
    sel.className = 'card-select';
    sel.dataset.role = 'card-style';

    // Split: typographic styles vs structural/actions
    var styleOpts = [];
    var actionOpts = [];

    (styles || []).forEach(function (s) {
      var label = String((s && (s.label || s.value)) || '').trim().toLowerCase();
      var isAction = (label === 'section divider' || label === 'delete segment' || label === 'delete row' || label === 'delete segment');

      if (isAction) actionOpts.push(s);
      else styleOpts.push(s);
    });

    function addOption_(s) {
      var opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label || s.value;
      sel.appendChild(opt);
    }

    styleOpts.forEach(addOption_);

    if (actionOpts.length) {
      var sep = document.createElement('option');
      sep.disabled = true;
      sep.value = '';
      sep.textContent = '────────';
      sel.appendChild(sep);
      actionOpts.forEach(addOption_);
    }

    if (value) sel.value = value;
    return sel;
  }

  function renderCards_(cards, segments, styles, locked) {
    var list = document.getElementById('cards-list');
    if (!list) return;

    list.innerHTML = '';

    var segById = {};
    (segments || []).forEach(function (s) { if (s.segmentId) segById[s.segmentId] = s; });

        // Build quick lookup: orderIndex -> card
    var cardByIndex = {};
    var maxIdx = -1;

    (cards || []).forEach(function (c) {
      var oi = (c && typeof c.orderIndex === 'number')
        ? c.orderIndex
        : (c && c.orderIndex != null ? Number(c.orderIndex) : null);

      if (oi == null || isNaN(oi)) return;

      // Deterministic collision handling: keep the first and warn.
      if (Object.prototype.hasOwnProperty.call(cardByIndex, oi)) {
        console.warn('Duplicate orderIndex detected. Keeping first card for slot', oi, {
          kept: cardByIndex[oi],
          dropped: c
        });
        return;
      }

      cardByIndex[oi] = c;
      if (oi > maxIdx) maxIdx = oi;
    });

    // Slot count must include committed structure (segments + ghost slots),
    // so the cards lane never “collapses” relative to the committed lane.
    var committedSlotCount = (segments || []).length + (__latestGhostSlots || []).length;
    var slotCount = Math.max(committedSlotCount, maxIdx + 1);

    for (var slot = 0; slot < slotCount; slot++) {
      var card = cardByIndex[slot];

      // Empty slot placeholder (so moves/creates can target gaps)
      if (!card) {
        var ph = document.createElement('div');
        ph.className = 'card card--empty';
        ph.dataset.slotIndex = String(slot);
        // Optional: a tiny affordance
        ph.innerHTML = '<div class="card-main"><div class="card-empty-label">Empty</div></div>';
        list.appendChild(ph);
        continue;
      }

      var cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.dataset.cardId = card.cardId || '';
      cardEl.dataset.segmentId = card.segmentId || '';
      cardEl.dataset.orderIndex = String(slot);
      cardEl.dataset.slotIndex = String(slot); // align with committed lane

      var main = document.createElement('div');
      main.className = 'card-main';

      var sel = buildCardStyleSelect_(styles, card.workingStyle || 'Body');
      sel.disabled = !!locked;
      main.appendChild(sel);

      // If this card is marking a segment for deletion, it must stay aligned with its slot.
      // So: lock movement/insert controls, but keep the trash can available.
      var lockPositionControls = !!locked || isDeleteRowStyle_(sel.value);

      function makeBtn(sym, title, role) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'card-btn';
        b.textContent = sym;
        b.title = title;
        b.dataset.role = role;

        if (lockPositionControls && role !== 'delete-card') b.disabled = true;
        if (locked) b.disabled = true; // locked always wins

        return b;
      }

      var rail = document.createElement('div');
      rail.className = 'card-rail';

      var railTop = document.createElement('div');
      railTop.className = 'card-rail-top';
      railTop.appendChild(makeBtn('⬆', 'Move up', 'move-up'));
      railTop.appendChild(makeBtn('⊕', 'Create card above', 'add-above'));

      var railMid = document.createElement('div');
      railMid.className = 'card-rail-mid';
      railMid.appendChild(makeBtn('🗑', 'Delete card', 'delete-card'));

      var railBot = document.createElement('div');
      railBot.className = 'card-rail-bot';
      railBot.appendChild(makeBtn('⬇', 'Move down', 'move-down'));
      railBot.appendChild(makeBtn('⊕', 'Create card below', 'add-below'));

      rail.appendChild(railTop);
      rail.appendChild(railMid);
      rail.appendChild(railBot);

      // "Delete segment" is NOT "delete this card".
      // It marks the committed segment for deletion and disables text entry on the card.
      // (Trash can deletes the card; the dropdown is a marking.)
      if (isDeleteRowStyle_(sel.value)) {
        cardEl.classList.add('is-delete-mark'); // optional hook; keeps semantics clear
      } else {
        cardEl.classList.remove('is-delete-mark');
      }

      // DELETE SEGMENT: hide text + editing features entirely (keep hidden card-text for autosave contract)
      if (isDeleteRowStyle_(sel.value)) {
        main.appendChild(buildHiddenCardText_(card.workingText || ''));
        // No textarea/divider editor in delete mode.
        cardEl.appendChild(main);
        cardEl.appendChild(rail);
        list.appendChild(cardEl);
        continue; // IMPORTANT: skip the rest of text-surface rendering
      }

      // SECTION DIVIDER: render a graphical divider row (line + editable label)
      if (isDividerStyle_(sel.value)) {
        var divider = buildDividerEditor_(card.workingText || '', !!locked);
        main.appendChild(divider);

        // Apply style class directly to the hidden/input inside the divider.
        var divTextEl = divider.querySelector('[data-role="card-text"]');
        if (divTextEl) applyStyleToEl_(divTextEl, sel.value || '');

        // Divider has no preview
        updateCardPreview_(cardEl);
      } else {
        // Normal card: multiline textarea
        var ta = document.createElement('textarea');
        ta.className = 'card-textarea';
        ta.dataset.role = 'card-text';
        ta.value = card.workingText || '';
        ta.disabled = !!locked;

        // Configure textarea UX by style (Headline/Subheadline single-line)
        configureTextareaForStyle_(ta, sel.value || '');

        // If this style is Bullet, normalize immediately so empty shows a bullet
        if (isBulletStyle_(sel.value)) {
          ta.value = normalizeBulletText_(ta.value);
        } else if (isOneLineStyle_(sel.value)) {
          ta.value = enforceOneLine_(ta.value);
        }

        main.appendChild(ta);
        applyStyleToEl_(ta, sel.value || '');

        // Bullet UX: editor while focused; preview when not editing.
        updateCardPreview_(cardEl);

        if (isBulletStyle_(sel.value)) {
          (function (cardEl_, ta_) {
            var prev_ = ensureCardPreview_(cardEl_);

            // Default state: show styled preview (not the editor)
            showBulletDisplay_(cardEl_);

            // Focus -> editor only (preview hidden)
            ta_.addEventListener('focus', function () {
              showBulletEditor_(cardEl_);
            });

            // Blur -> preview only (editor hidden)
            ta_.addEventListener('blur', function () {
              updateCardPreview_(cardEl_);
              showBulletDisplay_(cardEl_);
            });

            // Click preview -> edit (and ensure preview hides)
            if (prev_) {
              prev_.style.cursor = 'text';
              prev_.addEventListener('click', function () {
                showBulletEditor_(cardEl_);
                ta_.focus();
                try { ta_.selectionStart = ta_.selectionEnd = ta_.value.length; } catch (e) {}
              });
            }
          })(cardEl, ta);
        }
      }

      cardEl.appendChild(main);
      cardEl.appendChild(rail);
      list.appendChild(cardEl);
    }
  }

  // ---------------------------
  // Countdown clock
  // ---------------------------

  // ---------------------------
  // Auto-close helpers (V1)
  // ---------------------------

  // Authoritative rule: dueDate is treated as LOCAL end-of-day.
  // Returns true when now > (dueDate 23:59:59 local).
  function isPastCutoff_(dueISO) {
    var s = String(dueISO || '').trim();
    if (!s) return false;

    // Interpret yyyy-MM-dd as local date; compare against local EOD.
    var due = new Date(s + 'T23:59:59');
    if (isNaN(due.getTime())) return false;

    return Date.now() > due.getTime();
  }

  // Minimal POST helper (do NOT depend on api_client internals).
  async function postToCopydeskApi_(bodyObj) {
    var base = window.COPYDESK_API_BASE || '';
    if (!base) throw new Error('Missing window.COPYDESK_API_BASE');
    if (!/^https?:\/\//i.test(base)) throw new Error('Bad COPYDESK_API_BASE: ' + base);

    var res = await fetch(base, {
      method: 'POST',
      // IMPORTANT: text/plain avoids CORS preflight (Apps Script).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj || {})
    });

    var raw = await res.text();
    var json = null;
    try { json = JSON.parse(raw); } catch (e) {}
    if (!json) throw new Error('Non-JSON response: ' + raw);
    if (json.ok === false) throw new Error(json.error || 'API error');
    return json;
  }

  // Close job + spawn translation sheets (idempotent in backend).
  async function closeAndSpawn_(jobId) {
    if (__autoCloseInflight) return;
    __autoCloseInflight = true;

    try {
      setStatus('loading', 'Closing job…', false);

      // Prefer a client wrapper if it exists; otherwise POST directly.
      var res;
      if (window.copydeskCloseJob) {
        res = await window.copydeskCloseJob(jobId);
      } else {
        res = await postToCopydeskApi_({ action: 'closeJob', jobId: jobId });
      }

      // Refresh local job cache from response if present.
      if (res && res.job) window.__copydeskJob = res.job;

      // Force closed-mode UI immediately (no waiting for next minute tick).
      setClosedMode_(true);
      setStatus('locked', 'Closed. Editing is disabled.', false);

      // Re-fetch authoritative state so translation subjobs + URLs arrive before pill render.
      try { await boot(); } catch (e0) {}

      // Best-effort (boot() already does these, but harmless to keep)
      if (window.__copydeskJob) renderHeader(window.__copydeskJob);
      if (typeof renderTranslationPills_ === 'function') renderTranslationPills_(window.__copydeskJob);

    } catch (err) {
      console.error('closeAndSpawn_ error:', err);
      __autoCloseFired = false; // allow retry (console / next tick)
      setStatus('error', 'Auto-close failed: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
      __autoCloseInflight = false;
    }
  }

  // Console-only triggers (testing philosophy: no risky UI)
  // Usage:
  //   window.__copydeskForceClose()
  //   window.__copydeskIsPastCutoff('2025-12-31')
  window.__copydeskIsPastCutoff = isPastCutoff_;
  window.__copydeskForceClose = function () {
    if (!jobId) jobId = getJobIdFromQuery();
    if (!jobId) throw new Error('Missing jobId in URL');
    __autoCloseFired = true;
    return closeAndSpawn_(jobId);
  };

  // Console helper: inspect the *raw* job payload (including translations arrays/urls)
  window.__copydeskFetchJob = function () {
    var id = jobId || getJobIdFromQuery();
    if (!id) throw new Error('Missing jobId in URL');
    if (!window.copydeskGetJob) throw new Error('Missing copydeskGetJob()');
    return window.copydeskGetJob(id);
  };

  // ---------------------------
  // Lane row height sync (committed <-> cards)
  // ---------------------------
  var __syncHeightsRaf = null;

  function syncLaneRowHeights_() {
    var committedList = document.getElementById('committed-list');
    var cardsList = document.getElementById('cards-list');
    if (!committedList || !cardsList) return;

    // Clear previous forcing so we measure natural heights
    committedList.querySelectorAll('.committed-seg').forEach(function (el) {
      el.style.minHeight = '';
    });
    Array.prototype.forEach.call(cardsList.children, function (el) {
      if (el && el.classList && el.classList.contains('card')) el.style.minHeight = '';
    });

    // Measure both lanes by slotIndex
    var bySlot = {};

    committedList.querySelectorAll('.committed-seg').forEach(function (el) {
      var slot = el.dataset ? el.dataset.slotIndex : null;
      if (slot == null) return;
      if (!bySlot[slot]) bySlot[slot] = {};
      bySlot[slot].committed = el;
      bySlot[slot].hCommitted = el.getBoundingClientRect().height || 0;
    });

    Array.prototype.forEach.call(cardsList.children, function (el) {
      if (!el || !el.dataset) return;
      var slot = el.dataset.slotIndex || el.dataset.orderIndex;
      if (slot == null) return;
      if (!bySlot[slot]) bySlot[slot] = {};
      bySlot[slot].card = el;
      bySlot[slot].hCard = el.getBoundingClientRect().height || 0;
    });

    // Force both to the max height per slot
    Object.keys(bySlot).forEach(function (slot) {
      var row = bySlot[slot];
      var h = Math.max(row.hCommitted || 0, row.hCard || 0);
      if (!h) return;
      if (row.committed) row.committed.style.minHeight = h + 'px';
      if (row.card) row.card.style.minHeight = h + 'px';
    });
  }

  function scheduleSyncLaneRowHeights_() {
    if (__syncHeightsRaf) cancelAnimationFrame(__syncHeightsRaf);
    __syncHeightsRaf = requestAnimationFrame(function () {
      __syncHeightsRaf = null;
      syncLaneRowHeights_();
    });
  }

  // ---------------------------
  // Autosave engine (cards only)
  // ---------------------------
  var jobId = '';
  var DEBOUNCE_MS = 800;

  // Autosave state (must exist in strict mode)
  var cardSaveTimers = new Map();        // cardId -> timeout id
  var cardLastSaved = new Map();         // cardId -> {cardId, workingStyle, workingText}
  var cardInflight = new Map();          // cardId -> boolean
  var cardInflightPromise = new Map();   // cardId -> Promise
  var cardQueued = new Map();            // cardId -> queued snap

function uuid_() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

  // Focus an existing card in the right lane (no duplicate children)
  function focusCardBySegmentId_(segmentId) {
    if (!segmentId) return false;

    var cardsList = document.getElementById('cards-list');
    if (!cardsList) return false;

    // Find card record
    var card = (__latestCards || []).find(function (c) {
      return c && String(c.segmentId || '') === String(segmentId);
    });
    if (!card || !card.cardId) return false;

    // Find DOM node
    var el = cardsList.querySelector('[data-card-id="' + card.cardId + '"]');
    if (!el) return false;

    // Scroll + focus textarea (or first focusable)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(function () {
      var ta = el.querySelector('textarea');
      if (ta) ta.focus();
      else {
        var focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable) focusable.focus();
      }
    }, 50);

    return true;
  }

  function sameCardSnap_(a, b) {
    if (!a || !b) return false;
    return (a.workingStyle || '') === (b.workingStyle || '') &&
           (a.workingText || '') === (b.workingText || '');
  }

  // Read current UI state from a card DOM node
  function getCardSnapshot_(cardEl) {
    if (!cardEl || !cardEl.dataset) return { cardId: '', workingStyle: '', workingText: '' };

    var cardId = cardEl.dataset.cardId || '';
    var styleEl = cardEl.querySelector('[data-role="card-style"]');
    var textEl = cardEl.querySelector('[data-role="card-text"]'); // textarea OR divider input

    return {
      cardId: cardId,
      workingStyle: styleEl ? (styleEl.value || '') : '',
      workingText: textEl ? (textEl.value || '') : ''
    };
  }

  // Update __latestCards in-place so we can reflect LIVE style/text changes without boot().
  // (Structure changes—move/insert/delete—always reload from source-of-truth via boot().)
  function syncLatestCardFromEl_(cardEl) {
    if (!cardEl) return;

    var snap = getCardSnapshot_(cardEl);
    if (!snap || !snap.cardId) return;

    var segId = (cardEl.dataset && cardEl.dataset.segmentId) ? cardEl.dataset.segmentId : '';

    for (var i = 0; i < (__latestCards || []).length; i++) {
      if (__latestCards[i] && __latestCards[i].cardId === snap.cardId) {
        __latestCards[i].workingStyle = snap.workingStyle;
        __latestCards[i].workingText = snap.workingText;
        if (segId) __latestCards[i].segmentId = segId;
        return;
      }
    }
  }

  async function saveNowForCard_(cardEl) {
    var snap = getCardSnapshot_(cardEl);
    if (!snap.cardId) return;

    var prev = cardLastSaved.get(snap.cardId);
    if (prev && sameCardSnap_(prev, snap)) return;

    if (cardInflight.get(snap.cardId)) {
        cardQueued.set(snap.cardId, snap);
        return cardInflightPromise.get(snap.cardId) || Promise.resolve();
    }

    cardInflight.set(snap.cardId, true);
    setStatus('saving', 'Saving…', false);

    var p = (async function () {
    try {
        await window.copydeskSaveCard(jobId, snap.cardId, snap.workingStyle, snap.workingText);
        cardLastSaved.set(snap.cardId, snap);

        var q = cardQueued.get(snap.cardId);
        if (q) {
          if (!sameCardSnap_(q, snap)) {
            cardQueued.delete(snap.cardId);
            // keep inflight true; immediately run the queued save
            return saveNowForCard_(cardEl);
          } else {
            // queued state is identical to what we just saved; clear it
            cardQueued.delete(snap.cardId);
          }
        }

        setStatus('saved', 'Saved.', false);

        syncLatestCardFromEl_(cardEl);
        renderCommitted_(__latestSegments, __latestCards, __latestGhostSlots);
        scheduleSyncLaneRowHeights_();

    } catch (err) {
        console.error('saveCard error:', err);
        setStatus('error', 'Save failed.', true);
    } finally {
        cardInflight.set(snap.cardId, false);
        cardInflightPromise.delete(snap.cardId);
    }
    })();
    cardInflightPromise.set(snap.cardId, p);
    return p;

  }

  function scheduleSaveForCard_(cardEl) {
    var snap = getCardSnapshot_(cardEl);
    var cardId = snap.cardId;
    if (!cardId) return;

    var t = cardSaveTimers.get(cardId);
    if (t) window.clearTimeout(t);

    cardSaveTimers.set(cardId, window.setTimeout(function () {
      cardSaveTimers.delete(cardId);
      saveNowForCard_(cardEl);
    }, DEBOUNCE_MS));
  }

  async function flushAllCardSaves_() {
    var list = document.getElementById('cards-list');
    if (!list) return;

    var cards = list.querySelectorAll('.card[data-card-id]');

    // Clear any pending debounce timers first
    cards.forEach(function (cardEl) {
      var cardId = cardEl.dataset.cardId || '';
      var t = cardSaveTimers.get(cardId);
      if (t) {
        window.clearTimeout(t);
        cardSaveTimers.delete(cardId);
      }
    });

    // Then WAIT for saves
    var promises = [];
    cards.forEach(function (cardEl) {
      promises.push(saveNowForCard_(cardEl));
    });

    await Promise.all(promises);
  }  // ---------------------------
  // Event wiring
  // ---------------------------
  function attachHandlers_(locked, segments, styles) {
    // Push button remains (admin-only server enforcement is assumed)
    var pushBtn = document.getElementById('push-btn');
    if (pushBtn) {
      pushBtn.style.display = '';
      pushBtn.disabled = !!locked;

      if (!pushBtn.dataset.boundClick) {
        pushBtn.dataset.boundClick = '1';
        pushBtn.addEventListener('click', async function () {
        if (!jobId) return;

        await flushAllCardSaves_();

        await withOverlay_('Pushing…', async function () {
          setStatus('saving', 'Pushing…', false);
          setPushEnabled_(false);

          try {
            if (!window.copydeskCommitJob) throw new Error('Missing copydeskCommitJob()');
            await window.copydeskCommitJob(jobId);
            setStatus('saved', 'Pushed.', false);

            // Always re-fetch authoritative state after push.
            await boot();
          } catch (err) {
            console.error('push error:', err);
            setStatus('error', 'Push failed.', true);
          }
        });
        });
      }
    }

    if (locked) return;

    // Click committed segment -> open existing child card, else create it (no multiple children)
    var committedList = document.getElementById('committed-list');
    if (committedList) {
      if (!committedList.dataset.boundClick) {
        committedList.dataset.boundClick = '1';
        committedList.addEventListener('click', async function (e) {
          var segEl = e.target && e.target.closest ? e.target.closest('.committed-seg') : null;
          if (!segEl) return;

          // Ghost rows have no segmentId; ignore them.
          // Dividers are structural; ignore click unless you explicitly want them editable.
          if (segEl.classList && segEl.classList.contains('is-divider')) return;

          var segId = segEl.dataset.segmentId || '';
          if (!segId) return;

          // If child already exists, just focus it (no duplicates).
          if (focusCardBySegmentId_(segId)) return;

          await withOverlay_('Creating card…', async function () {
            setStatus('saving', 'Creating card…', false);

            try {
              await flushAllCardSaves_();

              // Slot index is already on the clicked committed row (includes ghost slots).
              var segIndex = Number(segEl.dataset.slotIndex || -1);
              if (!(segIndex >= 0)) throw new Error('Missing slotIndex on committed row.');

              // Seed from the segment record (clone committed into the new card)
              var seedText = '';
              var seedStyle = '';
              for (var i = 0; i < (__latestSegments || []).length; i++) {
                if (__latestSegments[i] && __latestSegments[i].segmentId === segId) {
                  seedText = __latestSegments[i].committedText || '';
                  seedStyle = __latestSegments[i].committedStyle || '';
                  break;
                }
              }

              // Create ONE child card for this committed segment (welded to same row)
              await window.copydeskCreateCard(jobId, {
                segmentId: segId,
                insertAt: segIndex,      // aligned slot
                seedText: seedText,      // clone committedText into card
                seedStyle: seedStyle     // optional: default workingStyle = committedStyle
              });

              // Clean + deterministic: reload from server (no local index shifting)
              await boot();

              // Best-effort focus
              focusCardBySegmentId_(segId);
            } catch (err) {
              console.error('createCard/open child error:', err);
              setStatus('error', 'Create card failed.', true);
            }
          });
        });
      }
    }

    // Card list handlers
    var cardsList = document.getElementById('cards-list');
    if (!cardsList) return;

    // Key handling (Headline/Subheadline single-line; Bullet always-bullets)
    if (!cardsList.dataset.boundKeydown) {
      cardsList.dataset.boundKeydown = '1';
      cardsList.addEventListener('keydown', function (e) {
        var t = e.target;
        if (!t || t.dataset.role !== 'card-text') return;

        var cardEl = t.closest('.card');
        if (!cardEl) return;

        var styleEl = cardEl.querySelector('[data-role="card-style"]');
        var styleVal = styleEl ? (styleEl.value || '') : '';

        // Headline/Subheadline: no hard returns, ever.
        if (isOneLineStyle_(styleVal)) {
          if (e.key === 'Enter') {
            e.preventDefault();
            return;
          }
        }

        // Bullet: Enter always makes a new bullet line (never exits bullet mode)
        if (isBulletStyle_(styleVal)) {
          if (e.key === 'Enter') {
            e.preventDefault();

            var ta = t;
            var start = ta.selectionStart;
            var end = ta.selectionEnd;

            var before = ta.value.slice(0, start);
            var after = ta.value.slice(end);

            // Ensure the current value is normalized first
            before = normalizeBulletText_(before);
            // (do not normalize "after" here; we'll normalize whole string after insert)

            // Insert newline + bullet glyph
            var insert = '\n' + BULLET_GLYPH;
            ta.value = before + insert + after;

            // Put caret after the bullet glyph
            var newPos = (before + insert).length;
            ta.selectionStart = ta.selectionEnd = newPos;

            // Normalize full value to keep every line bullet-prefixed
            ta.value = normalizeBulletText_(ta.value);

            scheduleSaveForCard_(cardEl);
            syncLatestCardFromEl_(cardEl);
            renderCommitted_(__latestSegments, __latestCards, __latestGhostSlots);
            scheduleSyncLaneRowHeights_();
            return;
          }
        }
      });
    }

    // Input typing -> debounced save
    if (!cardsList.dataset.boundInput) {
      cardsList.dataset.boundInput = '1';
      cardsList.addEventListener('input', async function (e) {
      var cardEl = e.target.closest('.card');
      if (!cardEl) return;
      // var cardId = cardEl.dataset.cardId;

      if (e.target.matches('[data-role="card-style"]') || e.target.matches('[data-role="card-text"]')) {
        var styleEl = cardEl.querySelector('[data-role="card-style"]');
        var textEl = cardEl.querySelector('[data-role="card-text"]');

        // LIVE styling: textarea reflects current working style
        applyStyleToTextarea_(cardEl, styleEl.value);

        // Enforce one-line behavior (paste/newlines) for Headline/Subheadline
        if (textEl && isOneLineStyle_(styleEl.value)) {
          var v1 = enforceOneLine_(textEl.value);
          if (v1 !== textEl.value) textEl.value = v1;
          configureTextareaForStyle_(textEl, styleEl.value);
        }

        // Enforce bullet normalization for Bullet style
        if (textEl && isBulletStyle_(styleEl.value)) {
          var v2 = normalizeBulletText_(textEl.value);
          if (v2 !== textEl.value) {
            var caret = textEl.selectionStart;
            textEl.value = v2;
            // Best-effort caret preservation (not perfect, but stable)
            textEl.selectionStart = textEl.selectionEnd = Math.min(caret, textEl.value.length);
          }
        }

        // Update live preview (Bullet only)
        updateCardPreview_(cardEl);

        // Defensive: ensure first keystroke always schedules a save
        scheduleSaveForCard_(cardEl);
      }
    });
    }

    if (!cardsList.dataset.boundOther) {
      cardsList.dataset.boundOther = '1';

    // Style change -> immediate save, and toggle textarea if divider
    cardsList.addEventListener('change', async function (e) {
      var el = e.target;
      if (!el || el.dataset.role !== 'card-style') return;

      var cardEl = el.closest('.card');
      if (!cardEl) return;

      // If this is a pure ghost editor (no welded card yet), create the card NOW.
      // This is critical for Section Divider, because it has no editable textarea to force persistence.
      if (!cardEl.dataset.cardId) {
        var slotIndex0 = Number(cardEl.dataset.slotIndex);
        if (!isNaN(slotIndex0) && window.copydeskCreateCard) {
          var newSegId0 = 'new:' + uuid_();
          await window.copydeskCreateCard(jobId, { segmentId: newSegId0, insertAt: slotIndex0 });
          // After creation, the simplest/cleanest is to reload authoritative state.
          await boot();
          return;
        }
      }

      var ta = cardEl.querySelector('[data-role="card-text"]');
      var norm = String(el.value || '').trim().toLowerCase();

      var main = cardEl.querySelector('.card-main');
      if (!main) {
        console.error('Missing .card-main; refusing to mutate card.', cardEl);
        return;
      }

      // Spec: no delete explanatory text in the card UI.

      // DELETE SEGMENT chosen
      if (isDeleteRowStyle_(el.value)) {

        // Remove any visible text surface (textarea OR divider input)
        var existingTextElDel = cardEl.querySelector('[data-role="card-text"]');
        if (existingTextElDel) {
          cardEl.dataset.lastWorkingText = String(existingTextElDel.value || cardEl.dataset.lastWorkingText || '');
          existingTextElDel.remove();
        }
        var dividerWrapDel = main.querySelector('.card-divider');
        if (dividerWrapDel) dividerWrapDel.remove();

        // Install hidden card-text (preserves autosave contract, but hides editing)
        main.appendChild(buildHiddenCardText_(cardEl.dataset.lastWorkingText || ''));

        // Update live preview (Bullet only)
        updateCardPreview_(cardEl);

        // LIVE styling (harmless on hidden input)
        applyStyleToTextarea_(cardEl, el.value);

        // Save + update committed lane
        saveNowForCard_(cardEl);
        syncLatestCardFromEl_(cardEl);
        renderCommitted_(__latestSegments, __latestCards, __latestGhostSlots);

        return; // IMPORTANT: delete mode short-circuits other swaps
      }

      if (norm === 'section divider') {
        // Swap any existing textarea -> divider editor
        var existingTextEl = cardEl.querySelector('[data-role="card-text"]');
        var currentVal = existingTextEl ? existingTextEl.value : (cardEl.dataset.lastWorkingText || '');
        if (currentVal === ZWSP) currentVal = '';

        if (existingTextEl) existingTextEl.remove();

        var divider = buildDividerEditor_(currentVal, false);

        // HARD RULE: Section divider is real em-dash text data.
        // Ensure the hidden [data-role="card-text"] is never empty.
        var divInput = divider.querySelector('[data-role="card-text"]');
        if (divInput) divInput.value = SECTION_DIVIDER_TEXT;

        // Insert divider right after select
        var sel2 = cardEl.querySelector('[data-role="card-style"]');
        if (sel2 && sel2.parentNode === main) {
          sel2.insertAdjacentElement('afterend', divider);
        } else {
          main.appendChild(divider);
        }

// Preserve for later swaps
cardEl.dataset.lastWorkingText = SECTION_DIVIDER_TEXT;
      } else {
        // Swap any divider input -> textarea (or ensure textarea exists)
        var existingTextEl2 = cardEl.querySelector('[data-role="card-text"]');

        // If we are coming FROM delete mode, existingTextEl2 might be <input type="hidden">
        var currentVal2 = existingTextEl2 ? (existingTextEl2.value || '') : (cardEl.dataset.lastWorkingText || '');
if (currentVal2 === ZWSP) currentVal2 = '';

        // Remove hidden input if present (we're restoring visible textarea)
        if (existingTextEl2 && existingTextEl2.tagName === 'INPUT') {
          existingTextEl2.remove();
        }

        // If it's currently an input inside divider, remove the whole divider wrapper
        var dividerWrap = main.querySelector('.card-divider');
        if (dividerWrap) dividerWrap.remove();
        if (existingTextEl2 && existingTextEl2.tagName === 'INPUT') existingTextEl2.remove();

        // Ensure textarea exists
        var ta2 = cardEl.querySelector('textarea[data-role="card-text"]');
        if (!ta2) {
          ta2 = document.createElement('textarea');
          ta2.className = 'card-textarea';
          ta2.dataset.role = 'card-text';
          ta2.value = String(currentVal2 || '');

          var sel3 = cardEl.querySelector('[data-role="card-style"]');
          if (sel3 && sel3.parentNode === main) {
            sel3.insertAdjacentElement('afterend', ta2);
          } else {
            main.appendChild(ta2);
          }
        } else {
          ta2.value = String(currentVal2 || '');
        }

        ta2.disabled = isDeleteRowStyle_(el.value);
        cardEl.dataset.lastWorkingText = String(currentVal2 || '');
      }

      // Do NOT decorate the card as "delete segment" (trash can deletes the card).
      // Visual intent belongs on the committed lane only.
      // Mark this card as "delete segment" (visual behavior is driven by CSS)
      cardEl.classList.toggle('is-delete-mark', isDeleteRowStyle_(el.value));

      // LIVE styling (will no-op if textarea absent)
      applyStyleToTextarea_(cardEl, el.value);

      // #4: if we now have a visible textarea, immediately enforce UX for the chosen style
      var liveTextEl = cardEl.querySelector('textarea[data-role="card-text"]');
      if (liveTextEl) {
        // Configure single-line vs multiline rendering immediately on dropdown change
        configureTextareaForStyle_(liveTextEl, el.value || '');

        // If switching into Headline/Subheadline, strip hard returns immediately
        if (isOneLineStyle_(el.value)) {
          var v = enforceOneLine_(liveTextEl.value);
          if (v !== liveTextEl.value) liveTextEl.value = v;
        }

        // If switching into Bullet, normalize immediately so empty shows a bullet
        if (isBulletStyle_(el.value)) {
          liveTextEl.value = normalizeBulletText_(liveTextEl.value);
        }
      }

      saveNowForCard_(cardEl);

      // Update committed lane immediately (e.g., Delete row crosshatch) without boot()
      syncLatestCardFromEl_(cardEl);
      renderCommitted_(__latestSegments, __latestCards, __latestGhostSlots);

    });

    // Focus-in -> for Bullet style, return to raw textarea editing
    cardsList.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el) return;
      if (el.dataset.role !== 'card-text' && el.dataset.role !== 'card-style') return;

      var cardEl = el.closest('.card');
      if (!cardEl) return;

      showBulletEditor_(cardEl);
    }, true);

    // Blur -> immediate save; for Bullet style, show formatted display when leaving the field/card
    cardsList.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el) return;
      if (el.dataset.role !== 'card-text' && el.dataset.role !== 'card-style') return;

      var cardEl = el.closest('.card');
      if (!cardEl) return;

      saveNowForCard_(cardEl);

      // Only flip to formatted view if focus is leaving the card entirely.
      window.setTimeout(function () {
        var active = document.activeElement;
        if (active && cardEl.contains(active)) return; // still inside this card
        showBulletDisplay_(cardEl);
      }, 0);
    }, true);

    // Card control buttons
    cardsList.addEventListener('click', async function (e) {
      var btn = e.target;
      if (!btn || !btn.dataset || !btn.dataset.role) return;

      var role = btn.dataset.role;
      var cardEl = btn.closest('.card');
      if (!cardEl) return;

      var cardId = cardEl.dataset.cardId || '';
      if (!cardId) return;

      // preserve focus + scroll across boot()
      var active = document.activeElement;
      var activeCardId = active && active.closest ? (active.closest('.card') && active.closest('.card').dataset.cardId) : '';
      var activeRole = active && active.dataset ? active.dataset.role : '';
      var scrollY = window.scrollY;

      try {
        if (role === 'move-up' || role === 'move-down') {
          await withOverlay_('Reordering…', async function () {
            await flushAllCardSaves_();
            window.__copydeskRestore = { activeCardId: activeCardId, activeRole: activeRole, scrollY: scrollY };

            var dir = (role === 'move-up') ? 'up' : 'down';
            await window.copydeskMoveCard(jobId, cardId, dir);

            // Source-of-truth reload (prevents local identity shifting)
            await boot();
          });

        } else if (role === 'add-above' || role === 'add-below') {
          await withOverlay_('Creating card…', async function () {
            await flushAllCardSaves_();
            window.__copydeskRestore = { activeCardId: activeCardId, activeRole: activeRole, scrollY: scrollY };

                        // Use the slot index (authoritative) — NOT DOM child index.
            var baseSlot = Number(cardEl.dataset.slotIndex);
            if (isNaN(baseSlot) || baseSlot < 0) {
              throw new Error('Bad slotIndex on cardEl: ' + String(cardEl.dataset.slotIndex || ''));
            }

            var insertAt = (role === 'add-below') ? (baseSlot + 1) : baseSlot;

            // Create structure first: ghost slot in committed lane
            if (!window.copydeskInsertGhostSlot) throw new Error('Missing copydeskInsertGhostSlot()');

            function isOk_(r) {
              return !!(r && (r.ok === true || r.ok === 'true' || r.success === true || r.success === 'true'));
            }

            var r1 = await window.copydeskInsertGhostSlot(jobId, insertAt);
            if (!isOk_(r1)) {
              throw new Error('insertGhostSlot failed: ' + JSON.stringify(r1));
            }

            // Then create the welded edit card for that new row
            var r2 = await window.copydeskCreateCard(jobId, { segmentId: 'new:' + uuid_(), insertAt: insertAt });
            if (!isOk_(r2)) {
              throw new Error('createCard failed: ' + JSON.stringify(r2));
            }

            // Source-of-truth reload
            await boot();
          });

        } else if (role === 'delete-card') {
          await withOverlay_('Deleting…', async function () {
            await flushAllCardSaves_();
            window.__copydeskRestore = { activeCardId: activeCardId, activeRole: activeRole, scrollY: scrollY };

            var slotIndex = Number(cardEl.dataset.slotIndex);
            var hasGhostHere =
              Array.isArray(__latestGhostSlots) &&
              __latestGhostSlots.indexOf(slotIndex) !== -1;

            // Always delete the card itself
            await window.copydeskDeleteCard(jobId, cardId);

            // If this card lived in a ghost slot, purge the structure too
            if (hasGhostHere && window.copydeskDeleteGhostSlot) {
              await window.copydeskDeleteGhostSlot(jobId, slotIndex);
            }

            // Source-of-truth reload
            await boot();
          });
        }

      } catch (err) {
        console.error('card control error:', err);
        setStatus('error', 'Card action failed.', true);
      }
    });

    }
    if (!window.__copydeskBeforeUnloadBound) {
        window.__copydeskBeforeUnloadBound = true;

        // pagehide is more reliable than beforeunload on modern browsers (especially mobile)
        window.addEventListener('pagehide', function () {
            flushAllCardSaves_(); // best effort
        });

        // visibilitychange catches tab-switch / minimize
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
            flushAllCardSaves_(); // best effort
            }
        });

        // keep beforeunload too (still useful sometimes)
        window.addEventListener('beforeunload', function () {
            flushAllCardSaves_(); // best effort
        });
        }
  }

          function setClosedMode_(isClosed) {
            var closed = !!isClosed;

            // CSS toggle (layout collapse lives in job.html CSS below)
            document.body.classList.toggle('copydesk-is-closed', closed);

            // Push is not allowed once closed
            var pushBtn = document.getElementById('push-btn');
            if (pushBtn) pushBtn.disabled = closed;

            // Header inputs
            var collabInput = document.getElementById('job-collaborators-input');
            if (collabInput) collabInput.disabled = closed;

            var dueInput = document.getElementById('job-cutoff-input');
            if (dueInput) {
              // keep it visually present but inert
              dueInput.setAttribute('aria-readonly', 'true');
              if (closed) {
                // extra-hard block for date picker / edits
                dueInput.addEventListener('keydown', function (e) { e.preventDefault(); }, true);
                dueInput.addEventListener('click', function (e) { e.preventDefault(); try { dueInput.blur(); } catch (err) {} }, true);
              }
            }

            // Cards lane: lock editing without blocking selection/copy.
            // - textareas/inputs become readOnly (selectable)
            // - selects/buttons become disabled (non-clickable)
            var cardsList = document.getElementById('cards-list');
            if (cardsList) {
              var els = cardsList.querySelectorAll('textarea, input, select, button');
              for (var i = 0; i < els.length; i++) {
                var el = els[i];
                var tag = (el && el.tagName) ? el.tagName.toLowerCase() : '';

                // Default: mark aria-disabled to match closed state.
                try { el.setAttribute('aria-disabled', closed ? 'true' : 'false'); } catch (e0) {}

                // Preserve selection/copy for text surfaces.
                if (tag === 'textarea') {
                  try { el.readOnly = closed; } catch (e1) {}
                  continue;
                }

                if (tag === 'input') {
                  // Keep text-like inputs selectable; lock with readOnly.
                  var type = String(el.type || '').toLowerCase();
                  var isTextLike =
                    !type || type === 'text' || type === 'search' || type === 'url' || type === 'email' ||
                    type === 'tel' || type === 'number' || type === 'date' || type === 'datetime-local';

                  if (isTextLike) {
                    try { el.readOnly = closed; } catch (e2) {}
                  } else {
                    try { el.disabled = closed; } catch (e3) {}
                  }
                  continue;
                }

                // Clicky controls: hard-disable.
                try { el.disabled = closed; } catch (e4) {}
              }
            }
          }

function extractTranslationSubjobs_(job) {
  if (!job) return [];
  var list = [];

  // Supported shapes:
  // - job.translations: [{ lang, subjobId, status, createdAt, touchedAt, archivedAt }, ...]
  // - job.translationSubjobs: [...]
  // - job.translationJobs: [...]
  var arr =
    (job && job.translations) ||
    (job && job.translationSubjobs) ||
    (job && job.translationJobs) ||
    [];

  if (!Array.isArray(arr)) return [];

  for (var i = 0; i < arr.length; i++) {
    var t = arr[i];
    if (!t) continue;
    list.push(t);
  }

  return list;
}

function pillState_(t) {
  if (!t) return 'seeded';

  // Prefer explicit status if present.
  var st = (t.status || t.state || '').toString().toLowerCase();

  // Final state in this product.
  if (st === 'finished' || st === 'final' || st === 'done' || t.finishedAt || t.completedAt) return 'finished';

  // Human-touched if touchedAt exists (or explicit).
  if (st === 'touched' || st === 'human' || st === 'inprogress' || t.touchedAt) return 'human';

  return 'seeded';
}

function getSubjobUrl_(t, job) {
  // Backend-provided URL only (no local URL construction).
  var direct = (t && (t.url || t.href || t.link)) ? (t.url || t.href || t.link) : '';
  if (!direct) return '';
  return String(direct);
}

function renderTranslationPills_(job) {
  var host = document.getElementById('translation-pills');
  if (!host) return;

  var statusLower = String((job && job.status) || '').toLowerCase();
  if (statusLower !== 'closed') {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }

  var subs = extractTranslationSubjobs_(job);

  // If closed but no translations metadata exists yet, still hide (no junk UI).
  if (!subs.length) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }

  var html = '';
  for (var i = 0; i < subs.length; i++) {
    var t = subs[i] || {};
    var code = (t.lang || t.languageCode || t.code || t.locale || '').toString();
    var label = code ? code.toUpperCase() : ('T' + (i + 1));

    var state = pillState_(t);
    var url = getSubjobUrl_(t, job);

    var cls = 'translation-pill pill-' + state;
    var ariaDisabled = url ? 'false' : 'true';

    html +=
      '<button type="button" class="' + cls + '" data-url="' + (url || '') + '" aria-disabled="' + ariaDisabled + '">' +
        '<span class="pill-label">' + label + '</span>' +
      '</button>';
  }

  host.innerHTML = html;
  host.style.display = 'flex';

  // Click handler (delegated)
  if (!host.dataset.wired) {
    host.dataset.wired = '1';
    host.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== host && !el.classList.contains('translation-pill')) el = el.parentNode;
      if (!el || el === host) return;

      if (el.getAttribute('aria-disabled') === 'true') return;

      var url = el.getAttribute('data-url') || '';
      if (!url) return;

      var w = window.open(url, '_blank', 'noopener');
      if (w) w.opener = null;
    });
  }
}

  // ---------------------------
  // Boot
  // ---------------------------
  async function boot() {
    jobId = getJobIdFromQuery();
    if (!jobId) {
      setStatus('error', 'Missing job id. Add ?jobid=...', true);
      return;
    }

    try {
      await withOverlay_('Loading job…', async function () {
        setStatus('loading', 'Loading job…', false);
        var res = await window.copydeskGetJob(jobId);

      var job = (res && res.job) ? res.job : {};

    // Normalize translation subjobs payload onto job (pills renderer reads job.* only).
    if (res && Array.isArray(res.translationSubjobs) && !Array.isArray(job.translationSubjobs)) {
      job.translationSubjobs = res.translationSubjobs;
    }
    if (res && Array.isArray(res.translations) && !Array.isArray(job.translations)) {
      job.translations = res.translations;
    }

      // Normalize translation subjobs payload onto job (pills renderer reads job.* only).
      if (res && Array.isArray(res.translationSubjobs) && !Array.isArray(job.translationSubjobs)) {
        job.translationSubjobs = res.translationSubjobs;
      }
      if (res && Array.isArray(res.translations) && !Array.isArray(job.translations)) {
        job.translations = res.translations;
      }

      var segments = (res && res.segments) ? res.segments : [];
      var styles = (res && res.styles) ? res.styles : [];
      var stylesCss = (res && res.stylesCss) ? res.stylesCss : '';
      window.__latestStyles = styles || [];

      // Inject STYLE sheet CSS rules (if provided by backend)
      injectStylesCss_(stylesCss);

      // Ensure dropdown always has options
      styles = ensureStyles_(styles);

      var cards = (res && res.cards) ? res.cards : [];
      var ghostSlots = (res && res.ghostSlots) ? res.ghostSlots : [];

__latestSegments = segments || [];
__latestCards = cards || [];
__latestGhostSlots = ghostSlots || [];

// Prime last-saved snapshots so flushAllCardSaves_() does NOT POST every card on first move.
cardLastSaved.clear();
(__latestCards || []).forEach(function (c) {
  if (!c || !c.cardId) return;
  cardLastSaved.set(c.cardId, {
    cardId: c.cardId,
    workingStyle: c.workingStyle || '',
    workingText: c.workingText || ''
  });
});

      // Normalize translation subjobs (so pills can render even if backend returns them outside res.job)
      if (res && Array.isArray(res.translationSubjobs) && !job.translationSubjobs) job.translationSubjobs = res.translationSubjobs;
      if (res && Array.isArray(res.translationJobs) && !job.translationJobs) job.translationJobs = res.translationJobs;
      if (res && Array.isArray(res.translations) && !job.translations) job.translations = res.translations;

      window.__copydeskJob = job;
      renderHeader(job);
      setClosedMode_(String((job && job.status) || '').toLowerCase() === 'closed');
      renderTranslationPills_(job);

// ---------------------------

      // Keep header countdown fresh (1-minute tick).
      if (!window.__copydeskCountdownTimer) {

        window.__copydeskCountdownTimer = window.setInterval(function () {
          if (!window.__copydeskJob) return;

          renderHeader(window.__copydeskJob);

          // Auto-close regime (V1): when cutoff passes, close + spawn once.
          var statusLower = String((window.__copydeskJob.status || '')).toLowerCase();
          if (statusLower !== 'closed' && !__autoCloseFired) {
            var dueISO = String(window.__copydeskJob.dueDate || '').trim();
            if (isPastCutoff_(dueISO)) {
              __autoCloseFired = true;
              closeAndSpawn_(jobId);
            }
          }
        }, 60000);
      }

      // Immediate auto-close check on load (do not wait for the first tick)
      (function () {
        var statusLower = String((job && job.status) || '').toLowerCase();
        if (statusLower !== 'closed' && !__autoCloseFired) {
          var dueISO = String(job.dueDate || '').trim();
          if (isPastCutoff_(dueISO)) {
            __autoCloseFired = true;
            closeAndSpawn_(jobId);
          }
        }
      })();

      // Treat Closed as locked (editing disabled) in addition to legacy Locked.
var statusLower = String((job && job.status) || '').toLowerCase();
var locked = (statusLower === 'locked' || statusLower === 'closed');
      if (locked) {
        setStatus('locked', 'Locked. Editing is disabled.', false);
      } else {
        setStatus('idle', '', false);
      }

      renderCommitted_(__latestSegments, __latestCards, __latestGhostSlots);
      renderCards_(__latestCards, __latestSegments, window.__latestStyles || [], locked);
      scheduleSyncLaneRowHeights_();
      attachHandlers_(locked, __latestSegments, __latestStyles || []);

      // Restore scroll + focus if a handler requested it
      if (window.__copydeskRestore) {
        var r = window.__copydeskRestore;
        window.__copydeskRestore = null;

        if (typeof r.scrollY === 'number') {
          window.scrollTo(0, r.scrollY);
        }

        if (r.activeCardId) {
          var card = document.querySelector('.card[data-card-id="' + r.activeCardId + '"]');
          if (card) {
            var target = null;
            if (r.activeRole === 'card-text') target = card.querySelector('[data-role="card-text"]');
            if (!target) target = card.querySelector('[data-role="card-style"]');
            if (target) target.focus();
          }
        }
      }

      }); // withOverlay_ (Loading job…)
    } catch (err) {
      console.error('boot error:', err);
      setStatus(
  'error',
  'Error loading job: ' + (err && err.message ? err.message : String(err)),
  true
);
    }
  }

window.addEventListener('resize', scheduleSyncLaneRowHeights_);
document.addEventListener('DOMContentLoaded', boot);
})();