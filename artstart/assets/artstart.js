// art_start.js
// Vanilla JS behavior for ArtStart Job View

(function () {
  'use strict';

var ARTSTART_API_BASE = window.ARTSTART_API_BASE || 'https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec';  function getJobIdFromQuery() {
    var params = new URLSearchParams(window.location.search || '');
    return params.get('jobId');
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

    // If ascend.js exposes a helper, prefer that; otherwise fall back to localStorage.
    var email = '';
    try {
      if (window.Ascend && typeof window.Ascend.getCurrentUser === 'function') {
        var user = window.Ascend.getCurrentUser();
        email = user && user.email;
      } else if (window.localStorage) {
        email = window.localStorage.getItem('ascendUserEmail');
      }
    } catch (e) {
      // ignore
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
    // We only normalize that string; no guessing from bleed/export.
    var raw = (job.mediaType || job.MediaType || '')
      .toString()
      .toLowerCase()
      .trim();

    // If the sheet is empty, be conservative and treat it as print.
    if (!raw) {
      return 'print';
    }

    // Allow simple synonyms like "Digital Ad", "Digital Banner", etc.
    if (raw === 'digital' ||
        raw.indexOf('digital') !== -1 ||
        raw.indexOf('screen') !== -1 ||
        raw.indexOf('html') !== -1) {
      return 'digital';
    }

    // Anything else is treated as print.
    return 'print';
  }

  function getMediaKind(job) {
    var raw = (job.mediaType || job.MediaType || '').toString().toLowerCase().trim();
    if (raw === 'print' || raw === 'digital') {
      return raw;
    }
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

    box.setAttribute('data-has-dimensions', hasDims ? 'true' : 'false');
    if (dims && dims.kind) {
      box.setAttribute('data-media-kind', dims.kind);
    } else {
      box.removeAttribute('data-media-kind');
    }

    if (!hasDims) {
      if (inner) {
        inner.style.width = '';
        inner.style.height = '';
      }
      if (bleedEl) {
        bleedEl.style.width = '';
        bleedEl.style.height = '';
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

    if (dims.kind === 'digital') {
      // Digital pieces: always 1:1 pixel size, never scaled.
      displayWidth = w;
      displayHeight = h;
    } else {
      // Print pieces: scale to fit viewport while preserving proportions.
      var maxWidth = box.clientWidth || 520;
      var maxHeight = box.clientHeight || 260;
      if (maxHeight < 80) maxHeight = 260;

      var scale = Math.min(maxWidth / w, maxHeight / h);
      displayWidth = Math.max(100, Math.round(w * scale));
      displayHeight = Math.max(100, Math.round(h * scale));
    }

    if (inner) {
      inner.style.width = displayWidth + 'px';
      inner.style.height = displayHeight + 'px';
    }
    if (bleedEl) {
      bleedEl.style.width = '100%';
      bleedEl.style.height = '100%';
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
    if (job.campaignName) titleParts.push(job.campaignName);
    headerTitleEl.textContent = titleParts.join(' • ') || job.jobId || 'Job';

    var metaBits = [];
    if (job.jobId) metaBits.push('ID ' + job.jobId);
    if (job.publication) metaBits.push(job.publication);
    if (job.placement) metaBits.push(job.placement);
    headerMetaEl.textContent = metaBits.join(' • ');

    // Overview card
    document.getElementById('job-overview-title').textContent = job.jobTitle || '—';
    document.getElementById('job-overview-campaign').textContent = job.campaignName || '—';
    document.getElementById('job-overview-id').textContent = job.jobId || '—';
    document.getElementById('job-overview-nordson-code').textContent = job.nordsonJobCode || '—';

    var requesterBits = [];
    if (job.requesterName) requesterBits.push(job.requesterName);
    if (job.requesterEmail) requesterBits.push('<' + job.requesterEmail + '>');
    document.getElementById('job-overview-requester').textContent =
      requesterBits.join(' ') || '—';

    document.getElementById('job-overview-created').textContent = job.createdDate || '—';
    document.getElementById('job-overview-run').textContent = job.runDate || '—';
    document.getElementById('job-overview-deadline').textContent = job.materialsDeadline || '—';

    // Format card
    var formatPretty = buildFormatPretty(job);
    var dimsForSize = extractCanvasDims(job);
    var mediaKind = dimsForSize ? dimsForSize.kind : getMediaKind(job);

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

    var outputText = job.outputSummary || job.outputFormat || job.output || '—';
    var outputEl = document.getElementById('format-output');
    if (outputEl) outputEl.textContent = outputText;

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

  function saveDraft(jobId) {
    setSaveStatus('Saving…');

    var payload = {
      jobId: jobId,
      workingHeadline: document.getElementById('working-headline').value,
      workingSubhead: document.getElementById('working-subhead').value,
      workingCta: document.getElementById('working-cta').value,
      workingBullets: document.getElementById('working-bullets').value,
      workingWebsite: (document.getElementById('working-website') || {}).value || '',
      workingEmail: (document.getElementById('working-email') || {}).value || '',
      workingNotes: document.getElementById('working-notes').value
    };

    fetch(ARTSTART_API_BASE + '?action=updateArtStartDraftFields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
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
    ['working-headline', 'working-subhead', 'working-cta', 'working-bullets', 'working-website', 'working-email', 'working-notes']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', function () {
          saveDraft(jobId);
        });
        el.addEventListener('input', function () {
          syncCanvasTextFromFields();
        });
      });

    var button = document.getElementById('artstart-save-button');
    if (button) {
      button.addEventListener('click', function () {
        saveDraft(jobId);
      });
    }
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