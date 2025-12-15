// copydesk_api_client.js
// Minimal API client for CopyDesk v1 (no Dave, no scheduling)

(function () {
  'use strict';

  // Read base dynamically (so you can set/override it before or after this script loads)
  function getBase_() {
    return window.COPYDESK_API_BASE || '';
  }

  function assertBase_() {
    var base = getBase_();
    if (!base) {
      throw new Error('Missing window.COPYDESK_API_BASE');
    }
    return base;
  }

  async function postJson_(bodyObj) {
    var base = assertBase_();

    // Fail fast if someone accidentally set a placeholder / bad URL.
    if (!/^https?:\/\//i.test(base)) {
      throw new Error('Bad COPYDESK_API_BASE (must start with http/https): ' + base);
    }

    // Hard timeout so the UI never hangs forever on a stuck network/App Script.
    var controller = new AbortController();
    var timeoutMs = 20000; // 20s; adjust if you want
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    var res = null;
    try {
      res = await fetch(base, {
        method: 'POST',
        signal: controller.signal,
        // IMPORTANT: text/plain avoids CORS preflight (OPTIONS), which Apps Script does not support.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(bodyObj || {})
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('API timeout after ' + timeoutMs + 'ms');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // Read as text first so we can surface useful diagnostics even if it's not JSON.
    var raw = '';
    try { raw = await res.text(); } catch (e) {}

    if (!res.ok) {
      throw new Error('API HTTP ' + res.status + ' ' + (raw || ''));
    }

    var json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch (e2) {
      // Apps Script sometimes returns HTML/text on exceptions — surface it.
      throw new Error('API returned non-JSON: ' + (raw || '[empty]'));
    }

    if (!json || json.ok === false) {
      throw new Error((json && (json.error || json.message)) ? (json.error || json.message) : 'API error');
    }
    return json;
  }

  // --- Public API ---

  // getJob(jobId)
  window.copydeskGetJob = async function (jobId) {
    if (!jobId) throw new Error('Missing jobId');
    return postJson_({ action: 'getJob', jobId: jobId });
  };

  // updateJobMeta(jobId, patch)
  // Header/meta updates (cutoff date, collaborators, status, etc).
  window.copydeskUpdateJobMeta = async function (jobId, patch) {
    if (!jobId) throw new Error('Missing jobId');
    return postJson_({
      action: 'updateJobMeta',
      jobId: jobId,
      patch: patch || {}
    });
  };

  // updateJobMeta(jobId, patch)
  // patch: { cutoff: "yyyy-MM-dd" | "", collaborators: "a@b.com, c@d.com" | "" }
  window.copydeskUpdateJobMeta = async function (jobId, patch) {
    if (!jobId) throw new Error('Missing jobId');
    return postJson_({
      action: 'updateJobMeta',
      jobId: jobId,
      patch: patch || {}
    });
  };

  // updateSegment(jobId, segmentId, patch)
  // Modern segment update: allows setting workingText / notes / etc without inventing a new architecture.
  window.copydeskUpdateSegment = async function (jobId, segmentId, patch) {
    if (!jobId) throw new Error('Missing jobId');
    if (!segmentId) throw new Error('Missing segmentId');
    return postJson_({
      action: 'updateSegment',
      jobId: jobId,
      segmentId: segmentId,
      patch: patch || {}
    });
  };

  // saveDraft(jobId, segmentId, workingStyle, workingText)
  // Legacy alias: older regime saved drafts against segmentId.
  window.copydeskSaveDraft = async function (jobId, segmentId, workingStyle, workingText) {
    if (!jobId) throw new Error('Missing jobId');
    if (!segmentId) throw new Error('Missing segmentId');

    return postJson_({
      action: 'saveDraft',
      jobId: jobId,
      segmentId: segmentId,
      workingStyle: workingStyle || '',
      workingText: workingText || ''
    });
  };

  // --- Card regime API ---

  window.copydeskCreateCard = async function (jobId, opts) {
    if (!jobId) throw new Error('Missing jobId');
    opts = opts || {};
    return postJson_({
      action: 'createCard',
      jobId: jobId,
      // segmentId may be an existing segmentId OR a "new:" id created client-side
      segmentId: opts.segmentId || '',
      insertAt: (opts.insertAt == null ? -1 : opts.insertAt),

      // IMPORTANT: pass-through seeds so backend avoids JOB_EN full-sheet scan
      seedText: (opts.seedText == null ? null : String(opts.seedText)),
      seedStyle: (opts.seedStyle == null ? null : String(opts.seedStyle))
    });
  };

  window.copydeskSaveCard = async function (jobId, cardId, workingStyle, workingText) {
    if (!jobId) throw new Error('Missing jobId');
    if (!cardId) throw new Error('Missing cardId');

    return postJson_({
      action: 'saveCard',
      jobId: jobId,
      cardId: cardId,
      workingStyle: workingStyle || '',
      workingText: workingText || ''
    });
  };

  // saveCardEx(jobId, cardId, workingStyle, workingText, notes)
  // Non-breaking extension: adds "notes" to the same saveCard action.
  // If server ignores notes today, no harm; once server supports it, subjob notes persist.
  window.copydeskSaveCardEx = async function (jobId, cardId, workingStyle, workingText, notes) {
    if (!jobId) throw new Error('Missing jobId');
    if (!cardId) throw new Error('Missing cardId');

    return postJson_({
      action: 'saveCard',
      jobId: jobId,
      cardId: cardId,
      workingStyle: workingStyle || '',
      workingText: workingText || '',
      notes: notes || ''
    });
  };

  window.copydeskMutateCard = async function (jobId, op, payload) {
    if (!jobId) throw new Error('Missing jobId');
    if (!op) throw new Error('Missing op');
    return postJson_({
      action: 'mutateCard',
      jobId: jobId,
      op: op,
      payload: payload || {}
    });
  };

  window.copydeskDeleteCard = async function (jobId, cardId) {
    if (!jobId) throw new Error('Missing jobId');
    if (!cardId) throw new Error('Missing cardId');
    return postJson_({ action: 'deleteCard', jobId: jobId, cardId: cardId });
  };

  // moveCard(jobId, cardId, direction, workingStyle, workingText)
  // Kept for convenience; implemented as a mutateCard op so server owns the mechanics.
  window.copydeskMoveCard = async function (jobId, cardId, direction, workingStyle, workingText) {
    if (!jobId) throw new Error('Missing jobId');
    if (!cardId) throw new Error('Missing cardId');
    direction = direction === 'up' ? 'up' : 'down';

    return postJson_({
      action: 'mutateCard',
      jobId: jobId,
      op: 'move',
      payload: {
        cardId: cardId,
        direction: direction
      }
    });
  };

  // (duplicate copydeskMutateCard removed; defined above)

  // --- Ghost slot (structure) API ---

  // insertGhostSlot(jobId, insertAt)
  // Creates a blank slot in the committed lane at slot index insertAt.
  // This is STRUCTURE, independent of whether a card exists.
  window.copydeskInsertGhostSlot = async function (jobId, insertAt) {
    if (!jobId) throw new Error('Missing jobId');
    if (insertAt == null || isNaN(Number(insertAt))) throw new Error('Missing insertAt');
    return postJson_({ action: 'insertGhostSlot', jobId: jobId, insertAt: Number(insertAt) });
  };

  // deleteGhostSlot(jobId, slotIndex)
  // Removes a previously-created ghost slot (structure).
  window.copydeskDeleteGhostSlot = async function (jobId, slotIndex) {
    if (!jobId) throw new Error('Missing jobId');
    if (slotIndex == null || isNaN(Number(slotIndex))) throw new Error('Missing slotIndex');
    return postJson_({ action: 'deleteGhostSlot', jobId: jobId, slotIndex: Number(slotIndex) });
  };

  // Optional admin-only test harness hooks (safe to include; server enforces role)
  window.copydeskCommitJob = async function (jobId) {
    if (!jobId) throw new Error('Missing jobId');
    return postJson_({ action: 'commitJob', jobId: jobId });
  };

  // lockJob is not implemented server-side in this deployment.
})();