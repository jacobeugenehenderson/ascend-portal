// art_start.js
// Vanilla JS behavior for ArtStart Job View

(function () {
  'use strict';

// ---- Feature flags (intentionally boring, default-off) ----
var ARTSTART_ENABLE_DAVE_STATUS = false;  

var ARTSTART_API_BASE = window.ARTSTART_API_BASE || 'https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec';

// Optional shared config (if ../../assets/ascend.js exposes these, we use them; otherwise we fail loudly)
var FILEROOM_API_BASE = window.FILEROOM_API_BASE || '';
var CODEDESK_URL = window.CODEDESK_URL || '';

// ---------- Language / Translation (workspace dropdown) ----------
var baseLanguage = 'EN';
var activeLanguage = 'EN';
var translationsDb = {};
var langSelect = null;
var langDot = null;

// Persist per-job language choice so async refreshes can't snap back to base.
var currentJobId = '';
var LANG_STORAGE_PREFIX = 'artstart_active_lang_v1:';

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

function updateLangDot_() {
  if (!langDot) return;
  var entry = translationsDb && translationsDb[activeLanguage];
  var humanEdited = !!(entry && entry.human && entry.edited === true);
  langDot.classList.toggle('is-human', humanEdited);
  langDot.style.opacity = humanEdited ? '1' : '0';
}

function applyTranslatedFields_(f) {
  if (!f) return;
  var v;

  v = document.getElementById('working-headline'); if (v) v.value = f.workingHeadline || '';
  v = document.getElementById('working-subhead');  if (v) v.value = f.workingSubhead || '';
  v = document.getElementById('working-cta');      if (v) v.value = f.workingCta || '';
  v = document.getElementById('working-bullets');  if (v) v.value = f.workingBullets || '';

  v = document.getElementById('working-website');  if (v) v.value = f.workingWebsite || '';
  v = document.getElementById('working-email');    if (v) v.value = f.workingEmail || '';

  v = document.getElementById('working-notes');    if (v) v.value = f.workingNotes || '';

  syncCanvasTextFromFields();
  autoscaleCanvasBands();
}
  function getJobIdFromQuery() {
  var params = new URLSearchParams(window.location.search || '');
  // accept both spellings
  return params.get('jobid') || params.get('jobId');
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

      if (String(s.payloadText || '').trim()) {
        payloadEl.textContent = s.payloadText;
        payloadEl.style.display = '';
      } else {
        payloadEl.textContent = '';
        payloadEl.style.display = 'none';
      }
    } else {
      linkEl.href = '#';
      imgEl.removeAttribute('src');
      payloadEl.textContent = '—';
      payloadEl.style.display = '';
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

    // Also accept rows that expose payload text with the mechanicals-esque keys
    var p = item.qrPayloadText || item.PayloadText || item.payloadText || item.Payload || item.payload || '';
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
        item.DrivePngOpenUrl || item.drivePngOpenUrl || item.drive_png_open_url ||
        item.openUrl || item.OpenUrl || item.open_url || item.OpenURL ||
        item.Url || item.URL || item.url || item.link || item.Link || '';

      // FileRoom registry returns PNG fields explicitly (DrivePngFileId / DrivePngOpenUrl).
      // SourceId is NOT the PNG file id — it’s the registry source key.
      // IMPORTANT: do NOT fall back to generic Id/id here; that is commonly the registry row id.
      var driveFileId =
        item.DrivePngFileId || item.drivePngFileId || item.drive_png_file_id ||
        item.driveFileId || item.DriveFileId || item.drive_file_id ||
        item.FileId || item.fileId || '';

      // Correct payload is the destination url when present (FileRoom: DestinationUrl).
      // IMPORTANT: do NOT fall back to Subtitle/subtitle; that is commonly a label like "CODEDESK — FLATTENED (PNG)".
      var payloadText =
        item.DestinationUrl || item.DestinationURL || item.destinationUrl || item.destination_url || item.destUrl || item.DestUrl ||
        item.qrDestinationUrl || item.QrDestinationUrl || item.qr_destination_url ||
        item.qrPayloadText || item.QrPayloadText ||
        item.PayloadText || item.payloadText || item.Payload || item.payload || '';

      // Guard: FileRoom often stores a human label here (e.g. "CODEDESK — FLATTENED (PNG)"), not the true destination.
      // If it looks like that label, treat it as empty so UI falls back to openUrl.
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
            job.qrDestinationUrl || job.QrDestinationUrl || job.qr_destination_url ||
            job.qrPayloadText || job.QrPayloadText || job.qr_payload_text
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

    // Restore saved language selection for this job (prevents snap-back during async refreshes)
    var jobKey = (job && (job.jobId || job.ascendJobId)) || getJobIdFromQuery();
    var savedLang = loadActiveLanguage_(jobKey);
    if (savedLang) {
      activeLanguage = savedLang;
    }

    // Populate language dropdown
    if (langSelect) {
      langSelect.innerHTML = '';
      // Base language first (muted label)
      var optBase = document.createElement('option');
      optBase.value = baseLanguage;
      optBase.textContent = baseLanguage + ' (base)';
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
              if (!code || code === baseLanguage) return;

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
    // If a non-base language is active and we have cached translation fields,
    // populate the UI from that translation instead of overwriting with base fields.
    var usedTranslation = false;
    if (activeLanguage && baseLanguage && activeLanguage !== baseLanguage) {
      var keyUpper = String(activeLanguage).trim();
      var keyLower = keyUpper.toLowerCase();
      var entry = translationsDb && (translationsDb[keyUpper] || translationsDb[keyLower]);
      if (entry && entry.fields) {
        applyTranslatedFields_(entry.fields);
        usedTranslation = true;
        updateLangDot_();
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
      qrPayloadText: (document.getElementById('qrPayloadText') || {}).value || ''
    };
  }

function saveDraft(jobId) {
  setSaveStatus('Saving…');

  var payload = buildDraftPayload(jobId);
  var params = new URLSearchParams();

  var isBase = (activeLanguage === baseLanguage);
  params.append('action', isBase ? 'updateArtStartDraftFields' : 'updateArtStartTranslatedFields');

  // Non-base writes must specify which language is being edited.
  if (!isBase) {
    params.append('lang', activeLanguage);
  }

  Object.keys(payload).forEach(function (key) {
    var value = payload[key];
    if (value !== undefined && value !== null) {
      params.append(key, value);
    }
  });

  var url = ARTSTART_API_BASE + '?' + params.toString();

  fetch(url, { method: 'GET' })
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (!json || !json.ok) {
        throw new Error((json && json.error) || 'Unknown error');
      }

      // Mark translation as human-edited locally (dot fills immediately)
      if (!isBase) {
        translationsDb = translationsDb || {};
        translationsDb[activeLanguage] = translationsDb[activeLanguage] || {};
        translationsDb[activeLanguage].human = true;
        translationsDb[activeLanguage].edited = true;
        translationsDb[activeLanguage].fields = {
          workingHeadline: payload.workingHeadline || '',
          workingSubhead: payload.workingSubhead || '',
          workingCta: payload.workingCta || '',
          workingBullets: payload.workingBullets || '',
          workingWebsite: payload.workingWebsite || '',
          workingEmail: payload.workingEmail || '',
          workingNotes: payload.workingNotes || ''
        };
        updateLangDot_();
      }

      setSaveStatus('Saved');
    })
    .catch(function (err) {
      console.error('Error saving draft', err);
      setSaveStatus('Save failed – try again');
    });
}

  function attachBlurListeners(jobId) {
    var debounceTimer = null;
    var DEBOUNCE_MS = 1500;

    function scheduleAutosave() {
      setSaveStatus('Editing…');

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        saveDraft(jobId);
      }, DEBOUNCE_MS);
    }

    ['working-headline', 'working-subhead', 'working-cta', 'working-bullets', 'working-website', 'working-email', 'working-notes']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;

        el.addEventListener('input', function () {
          // Keep the canvas in sync while typing
          syncCanvasTextFromFields();
          // Debounced autosave while user pauses
          scheduleAutosave();
        });

        el.addEventListener('blur', function () {
          // On explicit field exit, ensure a save happens promptly
          scheduleAutosave();
        });
      });

    function finalSave() {
      try {
        // If there is a pending debounce, flush it and save immediately.
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        var payload = buildDraftPayload(jobId);
        var isBase = (activeLanguage === baseLanguage);
        var url =
          ARTSTART_API_BASE +
          '?action=' + (isBase ? 'updateArtStartDraftFields' : 'updateArtStartTranslatedFields') +
          (isBase ? '' : ('&lang=' + encodeURIComponent(activeLanguage)));
        var data = JSON.stringify(payload);

        if (navigator && typeof navigator.sendBeacon === 'function') {
          // sendBeacon is designed for unload-safe fire-and-forget
          var blob = new Blob([data], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          // Fallback: synchronous XHR on unload
          var xhr = new XMLHttpRequest();
          xhr.open('POST', url, false);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(data);
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

  function fetchJob(jobId) {
    currentJobId = jobId || '';
    clearError();
    setSaveStatus('Loading job…');

    fetch(ARTSTART_API_BASE + '?action=getArtStartJob&jobId=' + encodeURIComponent(jobId))
      .then(function (res) { return res.json(); })
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
        if (window.ARTSTART_ENABLE_DAVE_STATUS === true) {
          if (ARTSTART_ENABLE_DAVE_STATUS) {
            refreshDaveStatus(effectiveJobId);
          }
}
        setSaveStatus('Autosave ready.');
      })
      .catch(function (err) {
        console.error('Error loading job', err);
        setError('We couldn’t find that job or load its details.');
      });
  }

  // Dev-only hook so we can drive the UI from the console
  window.artStartDebug = window.artStartDebug || {};
  window.artStartDebug.populateJob = populateJob;
  window.artStartDebug.attachBlurListeners = attachBlurListeners;

  function init() {
    setUserLabel();
    initQrUi_();

    // Cache language UI
    langSelect = document.getElementById('working-language');
    langDot = document.getElementById('working-language-dot');

    if (langSelect) {
      langSelect.addEventListener('change', function () {
        var jobIdNow = getJobIdFromQuery();
        var next = String(langSelect.value || '').trim().toUpperCase();
        if (!jobIdNow || !next) return;

        activeLanguage = next;
        saveActiveLanguage_(jobIdNow, activeLanguage);

        // Base language: reload canonical job fields from sheet
        if (activeLanguage === baseLanguage) {
          fetchJob(jobIdNow);
          return;
        }

        // Existing translation in cache?
        var entry = translationsDb && translationsDb[activeLanguage];
        if (entry && entry.fields) {
          applyTranslatedFields_(entry.fields);
          updateLangDot_();
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

            // Apply translated text immediately
            applyTranslatedFields_(payload.fields || {});

            // Refresh job payload so translationsDb + dot state are canonical
            // BUT keep the user’s selected language from snapping back to base.
            var keep = activeLanguage;
            fetchJob(jobIdNow);
            activeLanguage = keep;
          })
          .catch(function (err) {
            console.error(err);
            setSaveStatus('Translate failed – try again');
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