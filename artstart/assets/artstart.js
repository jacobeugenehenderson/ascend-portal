// art_start.js
// Vanilla JS behavior for ArtStart Job View

(function () {
  'use strict';

var ARTSTART_API_BASE = window.ARTSTART_API_BASE || 'https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec';
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

  function setUserLabel() {
    var labelEl = document.getElementById('artstart-user-label');
    if (!labelEl) return;

    var email = '';

    try {
      // 1) Prefer the shared Ascend helper if it exists.
      if (window.Ascend && typeof window.Ascend.getCurrentUser === 'function') {
        var user = window.Ascend.getCurrentUser();
        if (user && user.email) {
          email = user.email;
        }
      }

      // 2) Fall back to known localStorage keys if we still don't have an email.
      if (!email && window.localStorage) {
        var possibleKeys = [
          'ascendUserEmail',
          'ascend_user_email',
          'ascendEmail',
          'ascend.user.email',
          'ascend-user-email'
        ];

        for (var i = 0; i < possibleKeys.length && !email; i++) {
          var v = window.localStorage.getItem(possibleKeys[i]);
          if (v && typeof v === 'string') {
            email = v;
          }
        }

        // 3) Last-resort: scan any Ascend-ish localStorage entry for an email.
        if (!email) {
          for (var j = 0; j < window.localStorage.length; j++) {
            var key = window.localStorage.key(j);
            if (!key || key.toLowerCase().indexOf('ascend') === -1) continue;

            var raw = window.localStorage.getItem(key);
            if (!raw || typeof raw !== 'string') continue;

            // If it’s JSON, try to pull .email; otherwise use the string itself.
            var candidate = '';
            try {
              var parsed = JSON.parse(raw);
              if (parsed && parsed.email) {
                candidate = parsed.email;
              }
            } catch (e) {
              candidate = raw;
            }

            if (candidate && candidate.indexOf('@') !== -1) {
              email = candidate;
              break;
            }
          }
        }
      }
    } catch (e) {
      // Swallow any weirdness; we'll just show "Not logged in".
    }

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

    box.setAttribute('data-has-dimensions', hasDims ? 'true' : 'false');
    box.setAttribute('data-media-kind', mediaKind || '');

    if (!hasDims) {
      if (inner) {
        inner.style.width = '';
        inner.style.height = '';
      }
      if (bleedEl) {
        bleedEl.style.display = '';
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

    // DIGITAL: pixel-perfect, scrollable
    // DIGITAL: pixel-based canvas, adjusted for source DPI
    if (mediaKind === 'digital') {
      // Optional: read a DPI value from the job (e.g., 144)
      var rawDpi =
        (job && (job.PixelDPI || job.pixelDpi || job.pixel_dpi || job.dpi)) || '';
      var dpi = parseFloat(rawDpi);

      var TARGET_DPI = 72; // CSS "native" feel
      var dpiScale =
        isFinite(dpi) && dpi > 0 ? (TARGET_DPI / dpi) : 1;

      // Example: 144 dpi → 72 dpi => scale = 0.5
      displayWidth  = w * dpiScale;
      displayHeight = h * dpiScale;

      if (inner) {
        inner.style.width  = displayWidth  + 'px';
        inner.style.height = displayHeight + 'px';
      }

      if (bleedEl) {
        bleedEl.style.display = 'none';
        bleedEl.style.top = '';
        bleedEl.style.right = '';
        bleedEl.style.bottom = '';
        bleedEl.style.left = '';
      }

      if (safeEl) {
        // Let CSS handle inset = 0 for digital
        safeEl.style.top = '';
        safeEl.style.right = '';
        safeEl.style.bottom = '';
        safeEl.style.left = '';

        // Digital baseline scale for text
        safeEl.dataset.baseScale = '1';
        safeEl.style.setProperty('--artstart-scale', '1');
      }

      if (noInfoEl) {
        noInfoEl.style.display = 'none';
      }
      return;
    }

    // PRINT MODE BELOW

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

      // Keep within a reasonable band so nothing gets absurdly big/small.
      baseScale = Math.max(0.55, Math.min(baseScale, 1.25));

      safeEl.dataset.baseScale = String(baseScale);
      safeEl.style.setProperty('--artstart-scale', baseScale.toFixed(3));
    }

    // 3) Position trim (magenta stroke + dashed teal) based on bleed
    if (safeEl) {
      if (bleedAmount > 0) {
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
          bleedEl.style.display = '';
          bleedEl.style.top = insetTop;
          bleedEl.style.bottom = insetBottom;
          bleedEl.style.left = insetLeft;
          bleedEl.style.right = insetRight;
        }
      } else {
        // No bleed configured: simple proportional inset
        safeEl.style.top = '6%';
        safeEl.style.bottom = '6%';
        safeEl.style.left = '6%';
        safeEl.style.right = '6%';

        if (bleedEl) {
          bleedEl.style.display = '';
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

    if (headlineEl) headlineEl.textContent = headline;
    if (subheadEl) subheadEl.textContent = subhead;
    if (ctaEl) ctaEl.textContent = cta;
    if (bodyEl) bodyEl.textContent = body;
    if (websiteEl) websiteEl.textContent = website;
    if (emailEl) emailEl.textContent = email;

    // After mirroring text into the canvas, shrink-to-fit.
    autoscaleCanvas();
  }

  function autoscaleCanvas() {
    var safe = document.querySelector('.artstart-canvas-safe');
    if (!safe) return;

    // Baseline scale is set in renderCanvasPreview (DPI-based for print,
    // or 1.0 for digital). Fall back to 1 if missing.
    var baseAttr = safe.dataset.baseScale;
    var baseScale = baseAttr ? parseFloat(baseAttr) : 1;
    if (!isFinite(baseScale) || baseScale <= 0) {
      baseScale = 1;
    }

    // Start from the baseline scale.
    safe.style.setProperty('--artstart-scale', baseScale);

    // If the canvas hasn't been sized yet, bail quietly.
    if (!safe.clientWidth || !safe.clientHeight) {
      return;
    }

    function fits() {
      // With fixed grid rows + overflow hidden, safe.scrollHeight may not reflect
      // per-cell overflow. Measure each canvas row against its parent cell.
      var rows = safe.querySelectorAll('.artstart-canvas-row');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var cell = row && row.parentElement ? row.parentElement : null;
        if (!cell) continue;

        if (row.scrollWidth > cell.clientWidth) return false;
        if (row.scrollHeight > cell.clientHeight) return false;
      }
      return true;
    }

    // If everything fits at the baseline size, we're done.
    if (fits()) return;

    var scale = baseScale;
    var minScale = baseScale * 0.5; // don't shrink below half baseline

    // Gradually shrink until it fits or we hit the floor.
    while (scale > minScale) {
      scale -= 0.02;
      safe.style.setProperty('--artstart-scale', scale.toFixed(3));
      if (fits()) break;
    }
  }

  function populateJob(job) {
    var gridEl = document.getElementById('artstart-grid');
    if (gridEl) {
      gridEl.style.display = '';
    }

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
    document.getElementById('working-headline').value = job.workingHeadline || '';
    document.getElementById('working-subhead').value = job.workingSubhead || '';
    document.getElementById('working-cta').value = job.workingCta || '';
    document.getElementById('working-bullets').value = job.workingBullets || '';

    var websiteEl = document.getElementById('working-website');
    if (websiteEl) websiteEl.value = job.workingWebsite || '';

    var emailEl = document.getElementById('working-email');
    if (emailEl) emailEl.value = job.workingEmail || '';

    document.getElementById('working-notes').value = job.workingNotes || '';

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
      workingNotes: document.getElementById('working-notes').value
    };
  }

function saveDraft(jobId) {
  setSaveStatus('Saving…');

  var payload = buildDraftPayload(jobId);
  var params = new URLSearchParams();

  params.append('action', 'updateArtStartDraftFields');
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
        var url = ARTSTART_API_BASE + '?action=updateArtStartDraftFields';
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
        refreshDaveStatus(effectiveJobId);
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

    // Prime the Dave status card before we know anything else.
    setDaveStatusHeader('Dave (courier)');
    setDaveStatusBody('Waiting for job…');

    var jobId = getJobIdFromQuery();
    if (!jobId) {
      setError('We couldn’t find that job (missing jobId).');
      return;
    }

    fetchJob(jobId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();