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

  function updateCanvasOrientationBox(job) {
    var box = document.getElementById('format-canvas-box');
    if (!box) return;
    var orientation = (job.orientation || '').toLowerCase();
    box.classList.remove('portrait', 'landscape');
    if (orientation.indexOf('portrait') !== -1) {
      box.classList.add('portrait');
      box.textContent = 'Portrait canvas';
    } else if (orientation.indexOf('landscape') !== -1) {
      box.classList.add('landscape');
      box.textContent = 'Landscape canvas';
    } else {
      box.textContent = 'Canvas preview';
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
    document.getElementById('format-publication').textContent = job.publication || '—';
    document.getElementById('format-placement').textContent = job.placement || '—';
    document.getElementById('format-trim').textContent = formatPretty.trim;
    document.getElementById('format-bleed').textContent = formatPretty.bleed;
    document.getElementById('format-orientation').textContent = job.orientation || '—';
    document.getElementById('format-color-export').textContent =
      job.colorExportSummary || 'Working: RGB → Delivery: PDF/X-4 or digital, per job spec.';

    updateCanvasOrientationBox(job);

    // Must include list
    var listEl = document.getElementById('must-include-list');
    var emptyEl = document.getElementById('must-include-empty');
    listEl.innerHTML = '';
    if (job.requiredElements && job.requiredElements.length) {
      job.requiredElements.forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        listEl.appendChild(li);
      });
      emptyEl.style.display = 'none';
    } else {
      emptyEl.style.display = '';
    }

    // Working draft fields
    document.getElementById('working-headline').value = job.workingHeadline || '';
    document.getElementById('working-subhead').value = job.workingSubhead || '';
    document.getElementById('working-cta').value = job.workingCta || '';
    document.getElementById('working-bullets').value = job.workingBullets || '';
    document.getElementById('working-notes').value = job.workingNotes || '';
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
        setSaveStatus('Saved just now');
      })
      .catch(function (err) {
        console.error('Error saving draft', err);
        setSaveStatus('Save failed. Try again.');
      });
  }

  function attachBlurListeners(jobId) {
    ['working-headline', 'working-subhead', 'working-cta', 'working-bullets', 'working-notes']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', function () {
          saveDraft(jobId);
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
    setSaveStatus('Not saved yet');

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