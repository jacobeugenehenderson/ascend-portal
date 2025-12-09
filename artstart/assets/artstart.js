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
      trim = job.trimWidth + '" × ' + job.trimHeight + '"';
    }
    var bleed = job.bleed ? job.bleed + '"' : '—';
    return { trim: trim, bleed: bleed };
  }

  function inferMediaKind(job) {
    // MediaType column in MediaSpecs is the single source of truth.
    // We normalize that string into either "digital" or "print".
    var raw = (job.MediaType || job.mediaType || '')
      .toString()
      .toLowerCase()
      .trim();

    if (!raw) {
      // If MediaType is missing, default to print.
      return 'print';
    }

    if (
      raw === 'digital' ||
      raw.indexOf('digital') !== -1 ||
      raw.indexOf('screen') !== -1 ||
      raw.indexOf('html') !== -1
    ) {
      return 'digital';
    }

    // Everything else is treated as print.
    return 'print';
  }

  function getMediaKind(job) {
    // Wrapper kept so existing call sites don’t change.
    return inferMediaKind(job);
  }

  function extractCanvasDims(job) {
    var pixelWidth = parseFloat(job.pixelWidth);
    var pixelHeight = parseFloat(job.pixelHeight);
    var trimWidth = parseFloat(job.trimWidth);
    var trimHeight = parseFloat(job.trimHeight);

    var hasPixel = isFinite(pixelWidth) && pixelWidth > 0 &&
                   isFinite(pixelHeight) && pixelHeight > 0;
    var hasTrim = isFinite(trimWidth) && trimWidth > 0 &&
                  isFinite(trimHeight) && trimHeight > 0;

    var kind = getMediaKind(job);
    if (kind === 'digital' && hasPixel) {
      return { kind: 'digital', width: pixelWidth, height: pixelHeight };
    }
    if (hasTrim) {
      return { kind: kind || 'print', width: trimWidth, height: trimHeight };
    }
    if (hasPixel) {
      return { kind: kind || 'digital', width: pixelWidth, height: pixelHeight };
    }
    return null;
  }

  function renderCanvasPreview(job) {
    var box = document.getElementById('format-canvas-box');
    var noInfoEl = document.getElementById('canvas-noinfo');
    if (!box) return;

    var inner = box.querySelector('.artstart-canvas-inner');
    var bleedEl = box.querySelector('.artstart-canvas-bleed');

    var dims = extractCanvasDims(job);
    var hasDims = !!dims;
    var mediaKind = getMediaKind(job);

    box.setAttribute('data-has-dimensions', hasDims ? 'true' : 'false');
    box.setAttribute('data-media-kind', mediaKind || '');

    if (!hasDims) {
      if (inner) {
        inner.style.width = '';
        inner.style.height = '';
      }
      if (bleedEl) {
        bleedEl.style.width = '';
        bleedEl.style.height = '';
        bleedEl.style.display = '';
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

    if (mediaKind === 'digital') {
      // Digital projects: always 1:1 pixel size, never scaled, and no bleed frame.
      displayWidth = w;
      displayHeight = h;
      if (bleedEl) {
        bleedEl.style.display = 'none';
      }
    } else {
      // Print projects: scale to fit viewport and show bleed box.
      var maxWidth = box.clientWidth || 520;
      var maxHeight = box.clientHeight || 260;
      if (maxHeight < 80) maxHeight = 260;

      var scale = Math.min(maxWidth / w, maxHeight / h);
      displayWidth = Math.max(100, Math.round(w * scale));
      displayHeight = Math.max(100, Math.round(h * scale));

      if (bleedEl) {
        bleedEl.style.display = '';
        bleedEl.style.width = '100%';
        bleedEl.style.height = '100%';
      }
    }

    if (inner) {
      inner.style.width = displayWidth + 'px';
      inner.style.height = displayHeight + 'px';
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
      body = body.trim(); // keep internal line breaks for pre-line rendering
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
    var mediaKind = getMediaKind(job);

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
    renderCanvasPreview(job);

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
    setSaveStatus('Autosave ready');

    fetch(ARTSTART_API_BASE + '?action=getArtStartJob&jobId=' + encodeURIComponent(jobId))
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || !json.ok) {
          throw new Error((json && json.error) || 'Unknown error');
        }
        populateJob(json.job);
        attachBlurListeners(json.job.jobId || jobId);
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