window.codedeskPushWorkingDebounced = function codedeskPushWorkingDebounced(reason){
  if (_codedeskFileRoomTimer) clearTimeout(_codedeskFileRoomTimer);
  _codedeskFileRoomTimer = setTimeout(() => {
    try { window.codedeskPushWorkingNow && window.codedeskPushWorkingNow(reason || 'debounced'); } catch(e){}
  }, CODEDESK_AUTOSAVE_DEBOUNCE_MS);
};

window.codedeskPushWorkingNow = async function codedeskPushWorkingNow(reason){
  // Skip server push in embed mode (standalone usage)
  if (window.CODEDESK_EMBED_MODE === true) return false;

  const workingId = String(window.__CODEDESK_CURRENT_WF_ID__ || _getActiveWorkingFileId() || '').trim();
  if (!workingId) return false;

  const rec = window.codedeskGetWorkingFileRecord && window.codedeskGetWorkingFileRecord(workingId);
  if (!rec) return false;

  // If the filename gate has not been accepted yet, do not push anything server-side.
  if (window.__CODEDESK_FILENAME_ACCEPTED__ !== true) return false;

  const ownerEmail = ((window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.user_email) ? window.CODEDESK_ENTRY.user_email : '') || getCurrentUserEmail_();
  const templateId = (rec && (rec.template_id || rec.templateId)) ? String(rec.template_id || rec.templateId) : '';

  // DestinationUrl: canonical QR payload (includes Mechanical knobs like UTM)
  let destinationUrl = '';
  try { destinationUrl = (typeof buildText === 'function') ? String(buildText() || '') : ''; } catch(e){ destinationUrl = ''; }

  // Canonical display name: CodeDesk filename (live), falling back to record name
  const caption =
    String(document.getElementById('codedeskFilename')?.value || '').trim() ||
    String(rec.name || '').trim() ||
    'codedesk';
  const base = caption.replace(/[^\w\d-_]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'codedesk';

  // --- Canonical state blob (includes all styling knobs) ---
  let stateObj = null;
  try { stateObj = (rec && rec.state) ? rec.state : (window.codedeskExportState ? window.codedeskExportState() : null); } catch(e){}
  let stateJson = '';
  try { stateJson = (typeof stateObj === 'string') ? stateObj : JSON.stringify(stateObj || {}); } catch(e){ stateJson = ''; }

  // Upsert WORKFILE row (blue FileRoom lane) — NO PNG
  let workingOpenUrl = '';
  try {
    const u = new URL(String(location && location.href ? location.href : ''));
    u.searchParams.set('working_file_id', String(workingId || ''));
    u.searchParams.delete('mode');
    u.searchParams.delete('template_id');
    u.searchParams.delete('templateId');
    u.searchParams.delete('template');
    workingOpenUrl = String(u.toString() || '');
  } catch(e){ workingOpenUrl = String(location && location.href ? location.href : ''); }

  try {
    await fetch(window.CODEDESK_FILEROOM_API_BASE, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'upsertJob',
        ascend_job_key: 'CODEDESK:' + workingId + ':WORKFILE',
        app: 'codedesk',
        source_id: workingId,
        title: base || 'CODEDESK QR',
        subtitle: 'CODEDESK — Working file',
        status: 'open',
        open_url: String(workingOpenUrl || ''),
        owner_email: ownerEmail,
        kind: 'workfile',
        asset_type: 'qr',
        template_id: templateId,
        destination_url: destinationUrl,
        state_json: stateJson,
        tags: 'codedesk,workfile'
      })
    });
  } catch (e) {}

  // Notify Ascend to refresh (best-effort)
  try {
    const u = new URL(String(workingOpenUrl || location.href || ''));
    u.searchParams.set('ascend_ping', String(Date.now()));
    if (window.opener) {
      fetch(u, { method: 'GET', credentials: 'omit' }).catch(function () {});
    }
  } catch (e) {}

  return true;
};

function codedeskAutosaveKick(){
  // HARD GATE: autosave/push is only allowed after ✨ (Finish setup).
  if (window.__CODEDESK_SETUP_DONE__ !== true) return;

  let activeId = _getActiveWorkingFileId();
 
  // Canonical rule: autosave never creates working files.
  // Working files are created only by explicit Finish.
  if (!activeId) return;

  if (_codedeskAutosaveTimer) clearTimeout(_codedeskAutosaveTimer);
  _codedeskAutosaveTimer = setTimeout(() => {
    try {
      // Live filename (workspace): prefer CodeDesk filename as the working-file display name
      const rec = window.codedeskGetWorkingFileRecord && window.codedeskGetWorkingFileRecord(activeId);
      const fname = String(document.getElementById('codedeskFilename')?.value || '').trim();
      const head = String(document.getElementById('campaign')?.value || '').trim();
      const keepName = rec?.name || '';
      const nextName = fname || keepName || head || 'Working file';

      // Local autosave (never creates files; activeId must already exist)
      window.codedeskSaveWorkingFile(nextName, { id: activeId });

      // Mark dirty (we have changes since last explicit export)
      try { window.__CODEDESK_DIRTY__ = true; } catch(e){}

      // Throttled server push (NO PNG) after idle
      if (window.codedeskPushWorkingDebounced) {
        window.codedeskPushWorkingDebounced('autosave');
      }
    } catch(e){}
  }, CODEDESK_AUTOSAVE_DEBOUNCE_MS);
}

// Arm once: autosave on any user edits (delegated; safe across form rebuilds)
(function wireCodedeskAutosaveOnce(){
  if (window.__CODEDESK_AUTOSAVE_WIRED__) return;
  window.__CODEDESK_AUTOSAVE_WIRED__ = true;

  const handler = (e) => {
    // Never autosave during any import (template apply or working-file open)
    if (window.__CODEDESK_IMPORTING_STATE__ === true) return;
    if (window.__CODEDESK_APPLYING_TEMPLATE__ === true) return;

    const t = e.target;
    if (!t) return;
    // only react to edits on inputs/selects/textareas
    const tag = (t.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return;

    // Ignore emoji search box + modal controls (not “document state”)
    if (t.id === 'emojiSearch') return;

    codedeskAutosaveKick();
  };

  document.addEventListener('input', handler, { passive: true });
  document.addEventListener('change', handler, { passive: true });
})();

/* -------- Finish button behavior --------
   Goal:
     - Clicking “Finish” should NOT be a one-time ceremony.
     - It should simply “lock in” the current working file state (same id),
       and autosave already covers ongoing edits.
*/
window.codedeskFinishSetup = function codedeskFinishSetup(){
  let activeId = _getActiveWorkingFileId();
  try {
    if (activeId && !_getWorkingFileRecordById(activeId)) {
      // stale pointer: treat as no working file yet
      try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
      try { typeof CODEDESK_ACTIVE_WF_KEY !== 'undefined' && localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY); } catch(e){}
      try { window.CODEDESK_ACTIVE_WORKING_FILE_ID = ''; } catch(e){}
      try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}
      activeId = '';
    }
  } catch(e){}

  // Name source (canonical CodeDesk UI): Filename (required)
  const fname =
    String(document.getElementById('codedeskFilename')?.value || '').trim();

  // HARD GATE: no filename, no Finish.
  if (!fname) {
    try { document.getElementById('codedeskFilename')?.focus(); } catch(e){}
    return '';
  }

  const name = fname;

    // Finish must be allowed 
  // to establish the working file exactly once.
  if (!activeId) {
    activeId = window.codedeskSaveWorkingFile(name);
  } else {
    window.codedeskSaveWorkingFile(name, { id: activeId });
  }

  // Briefly show “working” while the upsert runs (best-effort, icon-only safe).
  try {
    document.querySelectorAll('button').forEach((b) => {
      try {
        const da = String(b && b.getAttribute ? (b.getAttribute('data-action') || '') : '').toLowerCase();
        const txt = String((b && b.textContent) ? b.textContent : '').trim().toLowerCase();
        const id  = String(b && b.id ? b.id : '').trim().toLowerCase();

        const isFinishish =
          (da === 'finish') ||
          (id === 'finish' || id === 'finishbtn' || id === 'btnfinish') ||
          (txt === 'finish' || txt === 'finish setup' || txt === '✨');

        if (!isFinishish) return;
      } catch(_e){ return; }

      try { b.classList.add('is-busy'); } catch(_e){}
      try { b.setAttribute('title', 'working'); } catch(_e){}
      try {
        const t = (b.textContent || '').trim();
        if (t.length > 2) b.textContent = 'working';
      } catch(_e){}
    });
  } catch(e){}

  // ✨ has created/confirmed the working file: autosave/push is now allowed.
  try { window.__CODEDESK_SETUP_DONE__ = true; } catch(e){}
  try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(e){}

  // Clear the brief “working” state shortly after.
  try {
    setTimeout(function(){
      try {
        document.querySelectorAll('button').forEach((b) => {
          try {
            const da = String(b && b.getAttribute ? (b.getAttribute('data-action') || '') : '').toLowerCase();
            const txt = String((b && b.textContent) ? b.textContent : '').trim().toLowerCase();
            const id  = String(b && b.id ? b.id : '').trim().toLowerCase();

            const isFinishish =
              (da === 'finish') ||
              (id === 'finish' || id === 'finishbtn' || id === 'btnfinish') ||
              (txt === 'finish' || txt === 'finish setup' || txt === 'working' || txt === 'working…' || txt === '✨');

            if (!isFinishish) return;
          } catch(_e){ return; }

          try { b.classList.remove('is-busy'); } catch(_e){}
          try { b.removeAttribute('title'); } catch(_e){}
        });
      } catch(_e){}
    }, 600);
  } catch(e){}

  // NEW-FLOW POLISH:
  // Immediately flip the UI into "return-visit" posture:
  // - filename becomes frozen + centered badge
  // - setup step / ✨ affordance disappears
  // - accordion unlocks
  try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(e){}
  try {
    const inp = document.getElementById('codedeskFilename');
    if (inp) {
      try { inp.readOnly = true; } catch(_e){}
      try { inp.setAttribute('readonly', 'readonly'); } catch(_e){}
      try { inp.disabled = true; } catch(_e){}
      try { inp.setAttribute('disabled', 'disabled'); } catch(_e){}
      try { inp.style.textAlign = 'center'; } catch(_e){}
      try { inp.style.pointerEvents = 'none'; } catch(_e){}
    }
  } catch(e){}
  try { typeof codedeskRemoveSetupStep === 'function' && codedeskRemoveSetupStep(); } catch(e){}
  try { typeof codedeskSetSetupSparkleVisible === 'function' && codedeskSetSetupSparkleVisible(false); } catch(e){}
  try { typeof codedeskSetLocked === 'function' && codedeskSetLocked(false); } catch(e){}
  try { typeof render === 'function' && render(); } catch(e){}

  // IMPORTANT: after Finish, lock the URL to this working file.
  // Otherwise a refresh on mode=new/template will clear the active id during bootstrap.
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('working_file_id', String(activeId || ''));
    u.searchParams.delete('mode');
    u.searchParams.delete('template_id');
    u.searchParams.delete('templateId');
    u.searchParams.delete('template');
    history.replaceState(null, '', u.toString());
  } catch(e){}

  try { typeof window.refreshHopper === 'function' && window.refreshHopper(); } catch(e){}

  return activeId;
};

(function wireFinishSetupOnce(){
  if (window.__CODEDESK_FINISH_SETUP_WIRED__) return;
  window.__CODEDESK_FINISH_SETUP_WIRED__ = true;

  // Mandatory filename capture: keep it centered/clickable; disable Finish until non-empty
  function ensureFilenameUi(){
    const inp = document.getElementById('codedeskFilename');
    if (!inp) return;

    // Temporary policy: freeze rename ONLY on true return-visits (URL has working_file_id/wf),
    // not merely because a stale "active working file" pointer exists in storage.
    try {
      const u = new URL(window.location.href);
      const mode = String(u.searchParams.get('mode') || '').trim().toLowerCase();
      const wfParam =
        String(u.searchParams.get('working_file_id') || u.searchParams.get('wf') || '').trim();

      const forcedNew = (mode === 'new' || mode === 'portal_new');

      const aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
      const rec = aid && (typeof window.codedeskGetWorkingFileRecord === 'function'
        ? window.codedeskGetWorkingFileRecord(aid)
        : null);

      const isReturnVisit = (!!rec && !!wfParam && String(aid || '') === String(wfParam || ''));

      if (isReturnVisit && !forcedNew) {
        inp.readOnly = true;
        try { inp.setAttribute('readonly', 'readonly'); } catch(_e){}
        try { inp.style.textAlign = 'center'; } catch(_e){}

        inp.disabled = true;
        try { inp.setAttribute('disabled', 'disabled'); } catch(_e){}
        inp.style.pointerEvents = 'none';

        // Return visit must behave as "already accepted" so the accordion is live immediately.
        try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(_e){}
        try { window.__CODEDESK_SETUP_DONE__ = true; } catch(_e){}
        try { codedeskSetLocked(false); } catch(_e){}
        try { codedeskSetSetupSparkleVisible(false); } catch(_e){}
        try { typeof codedeskRemoveSetupStep === 'function' && codedeskRemoveSetupStep(); } catch(_e){}
        try { typeof render === 'function' && render(); } catch(_e){}
        return;
      }
    } catch(e){}

    // No working file yet (or New →): filename must be editable.
    inp.disabled = false;
    inp.removeAttribute('disabled');
    inp.style.pointerEvents = 'auto';

    inp.readOnly = false;
    try { inp.removeAttribute('readonly'); } catch(_e){}
  }

    function syncFinishEnabled(){
    ensureFilenameUi();

    const fname = String(document.getElementById('codedeskFilename')?.value || '').trim();
    const accepted = (window.__CODEDESK_FILENAME_ACCEPTED__ === true);

    const aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
    const rec = aid && (typeof window.codedeskGetWorkingFileRecord === 'function'
      ? window.codedeskGetWorkingFileRecord(aid)
      : null);
    const hasWf = !!rec;

    const ok = (accepted && !!fname && !hasWf);

    document.querySelectorAll('button').forEach(b => {
      if (!isFinishButton(b)) return;

      // Only manage the setup sparkle button here (icon-only).
      // Do not disable any other Finish-ish buttons.
      try {
        const t0 = String((b && b.textContent) ? b.textContent : '').trim();
        if (t0 !== '✨') return;
      } catch(_e){}

      // don't stomp busy/done
      if (b.classList.contains('is-busy')) return;
      if (b.classList.contains('is-setup-done')) return;

      // preserve original label (do NOT overwrite icon buttons)
      try {
        if (b.dataset && typeof b.dataset._label !== 'string') {
          b.dataset._label = b.textContent || '';
        }
      } catch(e){}

      if (!ok) {
        b.disabled = true;
        try { b.setAttribute('title', 'Filename required to finish'); } catch(e){}

        // Only overwrite text labels (never icon-only buttons like ✨)
        try {
          const t = (b.textContent || '').trim();
          if (t.length > 2) b.textContent = 'Filename required to finish';
        } catch(e){}
      } else {
        b.disabled = false;
        try { b.removeAttribute('title'); } catch(e){}

        // restore label if we previously preserved it
        try {
          if (b.dataset && typeof b.dataset._label === 'string') b.textContent = b.dataset._label;
          if (b.dataset) delete b.dataset._label;
        } catch(e){}

        relabel(b);
      }
    });
  }

  function relabel(btn){
    try {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'finish') btn.textContent = 'Finish setup';
    } catch(e){}
  }

  function isFinishButton(el){
    if (!el) return false;
    const id = (el.id || '').toLowerCase();
    const da = (el.getAttribute && el.getAttribute('data-action')) || '';
    const txt = (el.textContent || '').trim().toLowerCase();

    // Be permissive: you can tighten this later if you want
    if (da && String(da).toLowerCase() === 'finish') return true;
    if (id === 'finish' || id === 'finishbtn' || id === 'btnfinish') return true;
    if (txt === 'finish' || txt === 'finish setup') return true;
    return false;
  }
  document.querySelectorAll('button').forEach(b => { if (isFinishButton(b)) relabel(b); });

  // --- Filename-first lock: everything else inert until filename exists ---
  function codedeskSetLocked(locked){
    // Reflect lock state on <body> (styling + debugging sanity)
    try { document.body && document.body.classList && document.body.classList.toggle('codedesk-locked', !!locked); } catch(e){}

    // Always start with all drawers closed (Caption/Design/Mechanicals/Finish)
    try {
      const stepper = document.getElementById('stepper');
      if (stepper) {
        stepper.querySelectorAll('[data-step-panel]').forEach((p) => { p.style.display = 'none'; });
        stepper.querySelectorAll('[data-step-toggle]').forEach((b) => {
          try { b.setAttribute('aria-expanded', 'false'); } catch(e){}
        });

        // Disable/enable the accordion buttons (they must feel inert until filename is accepted)
        stepper.querySelectorAll('[data-step-toggle]').forEach((b) => {
          try { b.disabled = !!locked; } catch(e){}
          try { b.setAttribute('aria-disabled', locked ? 'true' : 'false'); } catch(e){}
        });

        // Prefer native inert if available; fallback to pointer-events.
        if ('inert' in stepper) stepper.inert = !!locked;

        // IMPORTANT: when unlocking, force interactivity back on (do not rely on empty-string restore).
        stepper.style.pointerEvents = locked ? 'none' : 'auto';
      }
    } catch(e){}
  }
  // Expose globally for cross-module access (state engine needs this)
  window.codedeskSetLocked = codedeskSetLocked;

  function codedeskUnlockAndOpenFinish(){
  // Unlock + reveal Finish (Create working file) without opening a drawer (Finish does not fold down).
  codedeskSetLocked(false);

  try {
    const stepper = document.getElementById('stepper');
    if (stepper) {
      stepper.classList.remove('mech-active');
      stepper.classList.add('finish-active');

      const finishCard = stepper.querySelector('.step-card[data-step="finish"]');
      if (finishCard) {
        const preferSmooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        finishCard.scrollIntoView({ block: 'start', behavior: preferSmooth ? 'smooth' : 'auto' });
      }
    }
  } catch(e){}
}

  function codedeskRefreshFilenameGate(){
    // Gate is ceremony-based: ONLY Enter unlocks (typing does not).
    let accepted = (window.__CODEDESK_FILENAME_ACCEPTED__ === true);

    // Ensure filename UI reflects mode (new vs return visit)
    try { ensureFilenameUi && ensureFilenameUi(); } catch(e){}

    // If we are reopening an existing working file and a name is already present,
    // skip the Enter ceremony and unlock immediately.
    try {
      const inp = document.getElementById('codedeskFilename');
      const fname = String(inp ? (inp.value || '') : '').trim();

      const aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
      const rec = aid && (typeof window.codedeskGetWorkingFileRecord === 'function'
        ? window.codedeskGetWorkingFileRecord(aid)
        : null);
      const hasWf = !!rec;

      if (hasWf && fname) {
        accepted = true;
        try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(e){}

        // Return visit: force frozen/centered filename identity badge
        try {
          if (inp) {
            inp.disabled = true;
            try { inp.setAttribute('disabled', 'disabled'); } catch(_e){}
            inp.style.pointerEvents = 'none';
            inp.readOnly = true;
            try { inp.setAttribute('readonly', 'readonly'); } catch(_e){}
            try { inp.style.textAlign = 'center'; } catch(_e){}
          }
        } catch(_e){}

        // Return visit: remove Enter ceremony entirely once a working file exists.
        try {
          const _h = window.__CODEDESK_FILENAME_ENTER_CEREMONY__;
          if (_h && inp) {
            try { inp.removeEventListener('keydown', _h, true); } catch(_e){}
          }
        } catch(_e){}

        // Return visit: remove the setup step so the “Create working file” flipper cannot appear.
        try { typeof codedeskRemoveSetupStep === 'function' && codedeskRemoveSetupStep(); } catch(_e){}

        // Return visit: hard-unlock regardless of any earlier ceremony state.
        try { codedeskSetLocked(false); } catch(_e){}
        try { codedeskSetSetupSparkleVisible(false); } catch(_e){}
      } else {
        // Lock/unlock the rest of the UI strictly by accepted flag (new job flow)
        codedeskSetLocked(!accepted);

        // Setup (✨) is only relevant before a working file exists
        codedeskSetSetupSparkleVisible(accepted && !hasWf);
      }
    } catch(e){
      // Fall back to original behavior if anything above fails
      codedeskSetLocked(!accepted);
      try { codedeskSetSetupSparkleVisible(false); } catch(_e){}
    }

    syncFinishEnabled();
  }
  // Expose globally for cross-module access (state engine needs this)
  window.codedeskRefreshFilenameGate = codedeskRefreshFilenameGate;

  function codedeskSetSetupSparkleVisible(visible){
    // The setup affordance is the sparkle action button (icon-only ✨ in the UI).
    // Do NOT hide "Finish setup" text buttons; only target the sparkle control.
    try {
      document.querySelectorAll('button').forEach((b) => {
        const t = String((b && b.textContent) ? b.textContent : '').trim();
        if (t !== '✨') return;
        b.style.display = visible ? '' : 'none';
      });
    } catch(e){}
  }
  // Expose globally for cross-module access (state engine needs this)
  window.codedeskSetSetupSparkleVisible = codedeskSetSetupSparkleVisible;

  function codedeskRemoveSetupStep(){
    // Remove the entire setup accordion step (Finish) if it exists.
    try {
      const stepper = document.getElementById('stepper');
      if (stepper) {
        const finishCard = stepper.querySelector('.step-card[data-step="finish"]');
        if (finishCard) finishCard.remove();
      }
    } catch(e){}

    // Also remove any remaining setup sparkle button (✨) in case it is not inside the stepper.
    try {
      document.querySelectorAll('button').forEach((b) => {
        const t = String((b && b.textContent) ? b.textContent : '').trim();
        if (t !== '✨') return;
        b.remove();
      });
    } catch(e){}

    // Also remove the finishCard by ID (belt + suspenders)
    try {
      const finishCard = document.getElementById('finishCard');
      if (finishCard) finishCard.remove();
    } catch(e){}
  }
  // Expose globally for cross-module access (state engine needs this)
  window.codedeskRemoveSetupStep = codedeskRemoveSetupStep;

  // live sync (wire once, even if this script loads before the DOM nodes exist)
  (function wireFilenameGateOnce(){
    if (window.__CODEDESK_FILENAME_GATE_WIRED__) return;

    function wire(){
      const inp = document.getElementById('codedeskFilename');
      if (!inp) return false;

      // initial state: locked + ✨ hidden
      // BUT: if we are reopening an existing working file and a filename is already present,
      // do not require the Enter ceremony.
      try {
        const fname0 = String(inp.value || '').trim();

        const aid0 = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
        const rec0 = aid0 && (typeof window.codedeskGetWorkingFileRecord === 'function'
          ? window.codedeskGetWorkingFileRecord(aid0)
          : null);
        const hasWf0 = !!rec0;

        // Only skip Enter ceremony on true return-visits (explicit working_file_id), never on mode=new.
        try {
          const u0 = new URL(window.location.href);
          const mode0 = String(u0.searchParams.get('mode') || '').trim().toLowerCase();
          const wf0 = String(u0.searchParams.get('working_file_id') || '').trim();
          const forcedNew0 = (mode0 === 'new' || mode0 === 'portal_new');

          if (!forcedNew0 && wf0 && hasWf0 && fname0 && String(aid0 || '') === String(wf0 || '')) {
            try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(_e){}
          }
        } catch(_e){}
      } catch(_e){}

      if (window.__CODEDESK_FILENAME_ACCEPTED__ !== true) {
        try { codedeskSetLocked(true); } catch(e){}
        try { codedeskSetSetupSparkleVisible(false); } catch(e){}
      } else {
        // If we skipped the Enter ceremony (true return-visit), unlock + wire + render now.
        try { codedeskSetLocked(false); } catch(e){}
        try { if (typeof window.render === 'function') window.render(); } catch(e){}
        try { wireRightAccordionBehaviorOnce(); } catch(e){}
      }
      try { syncFinishEnabled(); } catch(e){}

      // Keep lock state stable while typing (Enter is the only ceremony)
      inp.addEventListener('input', function(){
        try { syncFinishEnabled(); } catch(e){}
      }, { passive: true });

      // Ceremony: Enter commits the filename gate and unlocks the workspace (drawers remain closed).
      // Once a WORKING file exists, this ceremony is disabled entirely.
      function codedeskFilenameEnterCeremony(e){
        if (!e) return;
        const isEnter = (e.key === 'Enter' || e.keyCode === 13);
        if (!isEnter) return;

        console.log('⌨️ ENTER ceremony', {
          value: String(inp.value || '').trim(),
          acceptedBefore: window.__CODEDESK_FILENAME_ACCEPTED__,
          activeWF: (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null
        });

        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}

        const fname = String(inp.value || '').trim();
        if (!fname) return;

        // Disable ceremony only on a TRUE return-visit:
        // URL working_file_id matches active working id AND not mode=new/portal_new.
        try {
          const __u1 = new URL(window.location.href);
          const __mode1 = String(__u1.searchParams.get('mode') || '').trim().toLowerCase();
          const __forcedNew1 = (__mode1 === 'new' || __mode1 === 'portal_new');
          const __wf1 = String(__u1.searchParams.get('working_file_id') || __u1.searchParams.get('wf') || '').trim();

          const __aid1 = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
          const __rec1 = __aid1 && (typeof window.codedeskGetWorkingFileRecord === 'function'
            ? window.codedeskGetWorkingFileRecord(__aid1)
            : null);

          const __isReturn1 = (!!__wf1 && !!__rec1 && String(__aid1 || '') === String(__wf1 || ''));

          if (__isReturn1 && !__forcedNew1) {
            try { inp.removeEventListener('keydown', codedeskFilenameEnterCeremony, true); } catch(__e){}
            return;
          }
        } catch(_e){}

        try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(_e){}
        try { codedeskSetLocked(false); } catch(_e){}

        // If the stepper was late-mounted, ensure the right-side controls are actually wired.
        try { wireRightAccordionBehaviorOnce(); } catch(_e){}

        // Render twice:
        //  - once immediately (best-effort)
        //  - once on a short delay to allow template/manifest/import-state to finish
        try { if (typeof window.render === 'function') window.render(); } catch(_e){}
        try {
          setTimeout(function(){
            try { if (typeof window.render === 'function') window.render(); } catch(__e){}
          }, 60);
        } catch(_e){}

                // New filename ceremony = new job. Clear any prior active working-file pointer so ✨ can run once.
        try {
          const __aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
          if (__aid) {
            try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
            try { typeof CODEDESK_ACTIVE_WF_KEY !== 'undefined' && localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY); } catch(e){}
            try { window.CODEDESK_ACTIVE_WORKING_FILE_ID = ''; } catch(e){}
            try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}
          }
        } catch(_e){}

        // Do NOT auto-open Finish on Enter. Stay neutral.
        try {
          const stepper = document.getElementById('stepper');
          if (stepper) {
            try { stepper.classList.remove('mech-active', 'finish-active'); } catch(e){}
          }
        } catch(_e){}

        try { codedeskSetSetupSparkleVisible(true); } catch(_e){}
        try { syncFinishEnabled(); } catch(_e){}

        try { inp.blur(); } catch(_e){}
      }

      // Stash a reference so other code paths can remove this later.
      try { window.__CODEDESK_FILENAME_ENTER_CEREMONY__ = codedeskFilenameEnterCeremony; } catch(_e){}

      // Attach Enter ceremony for New flow even if a stale active record exists.
      // Only skip attaching on a TRUE return-visit (URL working_file_id matches active record) and not mode=new.
      try {
        const __u0 = new URL(window.location.href);
        const __mode0 = String(__u0.searchParams.get('mode') || '').trim().toLowerCase();
        const __forcedNew0 = (__mode0 === 'new' || __mode0 === 'portal_new');
        const __wf0 = String(__u0.searchParams.get('working_file_id') || __u0.searchParams.get('wf') || '').trim();

        const __aid0 = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
        const __rec0 = __aid0 && (typeof window.codedeskGetWorkingFileRecord === 'function'
          ? window.codedeskGetWorkingFileRecord(__aid0)
          : null);

        const __isReturn0 = (!!__wf0 && !!__rec0 && String(__aid0 || '') === String(__wf0 || ''));

        console.log('🧪 filename ceremony attach decision', {
          mode: __mode0,
          forcedNew: __forcedNew0,
          url_working_file_id: __wf0,
          activeId: __aid0,
          hasActiveRec: !!__rec0,
          isReturn: __isReturn0,
          willAttach: (!__isReturn0 || __forcedNew0)
        });

        if (!__isReturn0 || __forcedNew0) {
          inp.addEventListener('keydown', codedeskFilenameEnterCeremony, true);
          console.log('🧪 filename ceremony: keydown listener ATTACHED');
        } else {
          console.warn('🧪 filename ceremony: keydown listener SKIPPED (return-visit detected)');
        }
      } catch(_e){
        console.error('🧨 filename ceremony attach: threw; attaching anyway', _e);
        inp.addEventListener('keydown', codedeskFilenameEnterCeremony, true);
      }

      // Cmd/Ctrl+S: push working metadata/state (NO PNG) if a working file exists.
      document.addEventListener('keydown', function(e){
        if (!e) return;
        const key = String(e.key || '').toLowerCase();
        const isSave = (key === 's' && (e.metaKey || e.ctrlKey));
        if (!isSave) return;

        const activeId = _getActiveWorkingFileId();
        const activeRec = activeId && (typeof window.codedeskGetWorkingFileRecord === 'function'
          ? window.codedeskGetWorkingFileRecord(activeId)
          : null);
        if (!activeRec) return;

        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}

        try {
          if (window.codedeskSyncFileRoomNow) {
            Promise.resolve(window.codedeskSyncFileRoomNow('hotkey')).catch(function(){});
          }
        } catch(_e){}
      }, true);

      // Blur: push working metadata/state (debounced) if a working file exists.
      inp.addEventListener('blur', function(){
        const activeId = _getActiveWorkingFileId();
        const activeRec = activeId && (typeof window.codedeskGetWorkingFileRecord === 'function'
          ? window.codedeskGetWorkingFileRecord(activeId)
          : null);
        if (!activeRec) return;
        try { window.codedeskPushWorkingDebounced && window.codedeskPushWorkingDebounced('filename-blur'); } catch(e){}
      }, { passive: true });

      // Warn on navigation away if:
      // - filename accepted but working file not created yet, OR
      // - working file exists and there are unexported changes
      if (!window.__CODEDESK_BEFOREUNLOAD_WIRED__) {
        window.__CODEDESK_BEFOREUNLOAD_WIRED__ = true;
        window.addEventListener('beforeunload', function(e){
          // Skip warning in embed mode (standalone usage)
          if (window.CODEDESK_EMBED_MODE === true) return undefined;

          try {
            const accepted = (window.__CODEDESK_FILENAME_ACCEPTED__ === true);
            const aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
            const rec = aid && (typeof window.codedeskGetWorkingFileRecord === 'function'
              ? window.codedeskGetWorkingFileRecord(aid)
              : null);
            const hasWf = !!rec;
            const dirty = (window.__CODEDESK_DIRTY__ === true);

            // If they accepted a name but never created the working file, warn.
            if (accepted && !hasWf) {
              e.preventDefault();
              e.returnValue = '';
              return '';
            }

            // If they have a working file and have changes since last export, warn.
            if (hasWf && dirty) {
              e.preventDefault();
              e.returnValue = '';
              return '';
            }
          } catch(err){}

          return undefined;
        }, true);
      }

      window.__CODEDESK_FILENAME_GATE_WIRED__ = true;
      return true;
    }

    // Try now; if DOM isn't ready yet, try again on DOMContentLoaded.
    if (!wire()) {
      document.addEventListener('DOMContentLoaded', function(){
        try { wire(); } catch(e){}
      }, { once: true });
      // Also a retry ladder as a safety net for late-mounted nodes / async render.
      (function retryWire(){
        let tries = 0;
        const maxTries = 20;   // ~5 seconds @ 250ms
        const iv = setInterval(function(){
          tries++;
          try {
            if (wire()) { clearInterval(iv); return; }
          } catch(e){}
          if (tries >= maxTries) { clearInterval(iv); }
        }, 250);
      })();
    }
  })();

  // capture click for finish/setup
  document.addEventListener('click', async (e) => {
  const btn = e.target && e.target.closest && e.target.closest('button');

  // We own the ✨ click exclusively (do not intercept any other "finish-ish" buttons).
  try {
    const t = String((btn && btn.textContent) ? btn.textContent : '').trim();
    if (t !== '✨') return;
  } catch(_e) { return; }

  // HARD STOP: this button may still have legacy handlers / form-submit behavior.
  // We own the ✨ click exclusively.
  try { e.preventDefault && e.preventDefault(); } catch(_e){}
  try { e.stopPropagation && e.stopPropagation(); } catch(_e){}
  try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch(_e){}
  try {
    if (btn) {
      btn.onclick = null;
      btn.removeAttribute && btn.removeAttribute('onclick');
    }
  } catch(_e){}

  // Ceremony contract:
  // - Enter unlocks the workspace (no server writes)
  // - ✨ creates the working file + Drive/FileRoom artifacts (one-time), then disappears forever
  const accepted = (window.__CODEDESK_FILENAME_ACCEPTED__ === true);

  const inp = document.getElementById('codedeskFilename');
  const fname = String(inp?.value || '').trim();

  if (!accepted || !fname) {
    try { inp && (inp.disabled = false); } catch(e){}
    try { inp && inp.removeAttribute && inp.removeAttribute('disabled'); } catch(e){}
    try { inp && (inp.style.pointerEvents = 'auto'); } catch(e){}
    try { inp && inp.focus && inp.focus(); } catch(e){}
    try { e && e.preventDefault && e.preventDefault(); } catch(e){}
    try { e && e.stopPropagation && e.stopPropagation(); } catch(e){}
    syncFinishEnabled();
    return;
  }

  // One-time setup: only treat as "already set up" if an actual working-file record exists
  // AND matches the current filename (otherwise it's a stale record from a different session).
  const existingId = _getActiveWorkingFileId();
  const existingRec = existingId && (typeof window.codedeskGetWorkingFileRecord === 'function'
    ? window.codedeskGetWorkingFileRecord(existingId)
    : null);
  console.log('[✨ click] existingId:', existingId, 'existingRec:', existingRec, 'fname:', fname);
  if (existingRec) {
    // Check if the existing record's name matches the current filename
    const existingName = String(existingRec.name || '').trim().toLowerCase();
    const currentName = fname.toLowerCase();
    console.log('[✨ click] existingName:', existingName, 'currentName:', currentName);
    if (existingName === currentName) {
      // Matching record exists - setup is already complete
      console.log('[✨ click] names match, removing setup step (already complete)');
      try { codedeskRemoveSetupStep && codedeskRemoveSetupStep(); } catch(e){}
      return;
    }
    // Names don't match - this is a stale record, clear it and proceed with new setup
    console.log('[✨ click] names mismatch, clearing stale record and proceeding');
    try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
    try { typeof CODEDESK_ACTIVE_WF_KEY !== 'undefined' && localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY); } catch(e){}
    try { window.CODEDESK_ACTIVE_WORKING_FILE_ID = ''; } catch(e){}
    try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}
  }

  // Hard guard: prevent double-fire (capture + fast clicks + weirdness)
  if (window.__CODEDESK_FINISH_INFLIGHT__ === true) {
    console.log('[✨ click] already in-flight, skipping');
    try { e && e.preventDefault && e.preventDefault(); } catch(_e){}
    try { e && e.stopPropagation && e.stopPropagation(); } catch(_e){}
    return;
  }
  window.__CODEDESK_FINISH_INFLIGHT__ = true;
  console.log('[✨ click] proceeding with setup...');

  // =====================================================
  // EMBED MODE: Download PNG directly instead of FileRoom sync
  // =====================================================
  if (window.CODEDESK_EMBED_MODE === true) {
    console.log('[✨ click] EMBED MODE — downloading PNG');
    try {
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = 'Saving…';

      // Build filename from the ceremony input
      const baseName = String(fname || 'qr').trim()
        .replace(/[^\w\d\-_\s]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 40) || 'qr';
      const pngFilename = baseName + '.png';

      // Download the PNG
      if (typeof window.downloadPng === 'function') {
        await window.downloadPng(pngFilename);
        console.log('[✨ click] EMBED MODE — PNG downloaded:', pngFilename);
      } else {
        console.error('[✨ click] EMBED MODE — downloadPng not available');
      }

      // Reset button state (allow re-download)
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = '✨';
    } catch (embedErr) {
      console.error('[✨ click] EMBED MODE error:', embedErr);
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = '✨';
    } finally {
      try { window.__CODEDESK_FINISH_INFLIGHT__ = false; } catch(_e){}
    }
    return; // Exit early — do not run normal FileRoom flow
  }

  // =====================================================
  // NORMAL MODE: FileRoom sync (Ascend integration)
  // =====================================================
  try {
    const prevText = (btn.textContent || '').trim();
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = 'Working…';
    console.log('[✨ click] button set to Working…');
    try { btn.setAttribute('title', 'Working…'); } catch(e){}

    let id = '';
    try { id = window.codedeskFinishSetup(); } catch(err){ console.error('[✨ click] codedeskFinishSetup error:', err); }
    console.log('[✨ click] codedeskFinishSetup returned id:', id);

    // Full one-time pairing: creates/updates the Drive PNG + FileRoom rows
    try {
      if (id && window.codedeskSyncFileRoomNow) {
        console.log('[✨ click] calling codedeskSyncFileRoomNow...');
        await window.codedeskSyncFileRoomNow('setup');
        console.log('[✨ click] codedeskSyncFileRoomNow complete');
      } else {
        console.warn('[✨ click] skipping sync: id=', id, 'codedeskSyncFileRoomNow=', !!window.codedeskSyncFileRoomNow);
      }
    } catch(e){ console.error('[✨ click] codedeskSyncFileRoomNow error:', e); }

    // Disappear forever (button + finish step)
    console.log('[✨ click] removing setup step');
    try { codedeskRemoveSetupStep && codedeskRemoveSetupStep(); } catch(e){}

  } finally {
    try { window.__CODEDESK_FINISH_INFLIGHT__ = false; } catch(e){}
  }
}, true);

})();

/* -------- Quiet autosave (debounced) -------- */
let _codedeskAutosaveTimer = null;
let _codedeskFileRoomTimer = null;

function _codedeskHasFinishedPairing(activeId){
  try {
    const rec = window.codedeskGetWorkingFileRecord && window.codedeskGetWorkingFileRecord(activeId);
    return !!(rec && rec.fileroom && String(rec.fileroom.drive_file_id || '').trim());
  } catch(e){
    return false;
  }
}

// Export a PNG dataURL from the current SVG composition (best effort).
async function codedeskPngDataUrlFromCurrentSvg(scale){
  try {
    if (typeof window.codedeskExportPngDataUrl === 'function') {
      console.log('[codedeskPngDataUrlFromCurrentSvg] calling window.codedeskExportPngDataUrl...');
      const out = await window.codedeskExportPngDataUrl(scale || 3);
      console.log('[codedeskPngDataUrlFromCurrentSvg] got result, length:', out ? out.length : 0);
      if (out) return out;
    } else {
      console.warn('[codedeskPngDataUrlFromCurrentSvg] window.codedeskExportPngDataUrl not available');
    }
  } catch(e){
    console.error('[codedeskPngDataUrlFromCurrentSvg] error:', e);
  }

  // Fallback: return empty (PNG export requires the render engine helper)
  console.warn('[codedeskPngDataUrlFromCurrentSvg] returning empty (no PNG available)');
  return '';
}

window.codedeskSyncFileRoomNow = async function codedeskSyncFileRoomNow(reason){
  console.log('[codedeskSyncFileRoomNow] called, reason:', reason);

  // Skip FileRoom sync in embed mode (standalone usage)
  if (window.CODEDESK_EMBED_MODE === true) {
    console.log('[codedeskSyncFileRoomNow] EMBED MODE — skipping FileRoom sync');
    return false;
  }

  // HARD GATE: never sync until setup is done (filename ceremony).
  if (window.__CODEDESK_SETUP_DONE__ !== true) {
    console.warn('[codedeskSyncFileRoomNow] SETUP_DONE not true, aborting');
    return false;
  }

  const workingId = (window.__CODEDESK_CURRENT_WF_ID__ || window.codedeskGetActiveWorkingFileId?.() || '').trim();
  if (!workingId) {
    console.warn('[codedeskSyncFileRoomNow] no workingId, aborting');
    return false;
  }
  console.log('[codedeskSyncFileRoomNow] workingId:', workingId);

  const rec = window.codedeskGetWorkingFileRecord ? window.codedeskGetWorkingFileRecord(workingId) : null;
  if (!rec) {
    console.warn('[codedeskSyncFileRoomNow] no record for workingId, aborting');
    return false;
  }
  console.log('[codedeskSyncFileRoomNow] rec:', rec);

  const folderId = String(window.CODEDESK_FILEROOM_FOLDER_ID || '').trim();
  if (!folderId) {
    console.warn('[codedeskSyncFileRoomNow] no folderId, aborting');
    return false;
  }
  console.log('[codedeskSyncFileRoomNow] folderId:', folderId);

  // Always prefer the live filename field as the caption/base name
  const caption = String(document.getElementById('codedeskFilename')?.value || '').trim() || String(rec.name || '').trim() || 'codedesk';

  // sanitize filename
  const safeName = caption
    .replace(/[^\w\d-_]+/g, '_')   // replace spaces/punct with _
    .replace(/^_+|_+$/g, '')       // trim leading/trailing _
    .substring(0, 40);             // max 40 chars

  const base = safeName;

  // Owner email (for dashboard prefs + FileRoom ownership)
  const ownerEmail = (window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.user_email) ? String(window.CODEDESK_ENTRY.user_email) : '';

  // Canonical destination url (payload)
  let destinationUrl = '';
  try { destinationUrl = (typeof buildText === 'function') ? String(buildText() || '') : ''; } catch(e){ destinationUrl = ''; }

  // Export canonical state blob for portability (single source of truth)
  let stateObj = null;
  try { stateObj = (rec && rec.state) ? rec.state : (window.codedeskExportState ? window.codedeskExportState() : null); } catch(e){}
  try {
    if (stateObj && typeof stateObj === 'object') {
      stateObj.destination_url = destinationUrl;
      stateObj.DestinationUrl = destinationUrl; // compatibility alias
      stateObj.payloadText = destinationUrl;    // compatibility alias
    }
  } catch(e){}
  let stateJson = '';
  try { stateJson = (typeof stateObj === 'string') ? stateObj : JSON.stringify(stateObj || {}); } catch(e){ stateJson = ''; }

  // Template linkage (when present)
  const templateId = String((rec && (rec.template_id || rec.templateId)) ? (rec.template_id || rec.templateId) : '').trim();

  // 2) Upload PNG to Drive + upsert delivered row
  try {
    console.log('[codedeskSyncFileRoomNow] exporting PNG...');
    const pngDataUrl = await codedeskPngDataUrlFromCurrentSvg(3);
    console.log('[codedeskSyncFileRoomNow] pngDataUrl length:', pngDataUrl ? pngDataUrl.length : 0);
    if (pngDataUrl) {

      // canonical filename (always .png)
      const fileName = (base || 'CODEDESK') + '.png';

      console.log('[codedeskSyncFileRoomNow] POSTing to FileRoom API:', window.CODEDESK_FILEROOM_API_BASE);
      const res = await fetch(window.CODEDESK_FILEROOM_API_BASE, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'upsertQrPngAsset',
          folder_id: folderId,
          png_data_url: pngDataUrl,
          file_name: fileName,
          source_id: workingId,
          ascend_job_key: 'CODEDESK_PNG:' + workingId,
          title: base || 'CODEDESK QR',
          subtitle: 'CODEDESK — FLATTENED (PNG)',
          status: 'delivered',
          owner_email: ownerEmail,
          kind: 'output',
          asset_type: 'qr',
          template_id: templateId,
          destination_url: destinationUrl,
          state_json: stateJson
        })
      });

      const j = await res.json();
      console.log('[codedeskSyncFileRoomNow] API response:', j);
      if (!j || !j.ok) {
        console.error('[codedeskSyncFileRoomNow] API returned error:', j);
        return false;
      }

      const data = j.data || {};
      const driveId = String(data.drive_file_id || '').trim();
      const openUrl = String(data.open_url || '').trim();
      const jobKey  = String(data.ascend_job_key || '').trim();

      // Persist any updated metadata (e.g., file name changes)
      rec.fileroom = { drive_file_id: driveId, open_url: openUrl, ascend_job_key: jobKey };
      rec.updatedAt = Date.now();
      window.codedeskSaveWorkingFile(rec);

      // ALSO: ensure this export appears in the right Ascend lanes (Dashboard prefs).
      try {
        const workingKey = String((data && data.working_ascend_job_key) ? data.working_ascend_job_key : ('CODEDESK_WORKFILE:' + workingId)).trim();

        // FileRoom lane for the delivered PNG row
        await fetch(window.CODEDESK_FILEROOM_API_BASE, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'setDashboardPref',
            user_email: ownerEmail,
            ascend_job_key: jobKey,
            lane: 'FILEROOM'
          })
        });

        // Hopper lane for the working file row
        await fetch(window.CODEDESK_FILEROOM_API_BASE, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'setDashboardPref',
            user_email: ownerEmail,
            ascend_job_key: workingKey,
            lane: 'HOPPER'
          })
        });

        // Keep the explicit "working file" upsert so the record stays fresh + has open_url/state.
      } catch (e) {}

      // Upsert WORKFILE row (orange hopper lane) — NO PNG
      try {
        await fetch(window.CODEDESK_FILEROOM_API_BASE, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'upsertJob',
            ascend_job_key: 'CODEDESK_WORKFILE:' + workingId,
            app: 'codedesk',
            source_id: workingId,
            title: base || 'CODEDESK QR',
            subtitle: 'CODEDESK — WORKING FILE',
            status: 'open',
            open_url: String(location && location.href ? location.href : ''),
            owner_email: ownerEmail,
            kind: 'workfile',
            asset_type: 'qr',
            template_id: templateId,
            destination_url: destinationUrl,
            state_json: stateJson,
            tags: 'codedesk,workfile'
          })
        });
        } catch (e) {}

      // Successful full export (includes PNG) — clear dirty
      try {
        window.__CODEDESK_DIRTY__ = false;
        window.__CODEDESK_LAST_EXPORT_AT__ = Date.now();
      } catch(e){}

      return true;
    }
  } catch (e) {}

  return false;
};

/* === DOM READY (boot) ========================================= */
(function(){
  function boot(){
    console.log('🚀 boot() fired', { readyState: document.readyState });

    // Mark body as ready once JS is alive
    try {
      const documentElement = document.documentElement;
      if (documentElement) documentElement.classList.add('ui-ready');
    } catch(e){}

    // =====================================================
    // EMBED MODE: Adjust UI for standalone usage
    // =====================================================
    if (window.CODEDESK_EMBED_MODE === true) {
      console.log('🔧 EMBED MODE — adjusting UI');
      try {
        // Add body class for CSS targeting
        document.body.classList.add('codedesk-embed-mode');

        // Change "Create working file" to "Download PNG"
        const finishToggle = document.querySelector('#finishCard [data-step-toggle]');
        if (finishToggle) {
          finishToggle.textContent = 'Download PNG';
        }

        // Update sparkle button title
        const sparkleBtn = document.querySelector('#finishCard button[data-action="finish"]');
        if (sparkleBtn) {
          sparkleBtn.setAttribute('title', 'Download PNG');
        }

        // Hide the "finishOverlay" modal (not needed in embed mode)
        const finishOverlay = document.getElementById('finishOverlay');
        if (finishOverlay) {
          finishOverlay.style.display = 'none';
        }

        // Disable beforeunload warning (no working file to lose)
        window.__CODEDESK_EMBED_NO_WARN__ = true;
      } catch (embedUiErr) {
        console.warn('EMBED MODE UI setup error:', embedUiErr);
      }
    }

    // Expose a no-op safety hook for other modules
    try {
      if (typeof window.refreshModulesMode !== 'function') {
        window.refreshModulesMode = function () {};
      }
    } catch (e) {}

    // Render once if available
    try {
      console.log('🧪 boot(): render availability', {
        hasWindowRender: (typeof window.render === 'function'),
        hasRender: (typeof render === 'function'),
        readyState: document.readyState
      });

      if (typeof window.render === 'function') {
        console.log('🧪 boot(): calling window.render()');
        window.render();
      } else if (typeof render === 'function') {
        console.log('🧪 boot(): calling render()');
        render();
      } else {
        console.warn('🧪 boot(): NO render() found at boot time');
      }
    } catch (e) {
      console.error('🧨 boot(): render threw', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

if (typeof window.$ !== 'function') (function () {
  const $ = (id) => document.getElementById(id);

  // Do not stomp globals owned by canonical modules.
  try { if (typeof window.$ !== 'function') window.$ = $; } catch(e){}
  try { if (!window.preview) window.preview = $("qrPreview"); } catch(e){}
  try { if (!window.typeSel) window.typeSel = $("qrType"); } catch(e){}

  try {
    if (typeof window.colorHex !== 'function') {
      window.colorHex = function (id, fallback) {
        const node = $(id);
        const v = (node && node.value) ? String(node.value).trim() : "";
        const ok = /^#?[0-9a-f]{6}$/i.test(v);
        const s = ok ? (v[0] === "#" ? v : "#" + v) : (fallback || "#000000");
        if (node && ok) node.value = s;
        return s;
      };
    }
  } catch(e){}

  try {
    if (typeof window.val !== 'function') {
      window.val = function (id, fallback) {
        const node = $(id);
        if (!node) return fallback;
        if (node.type === "checkbox") return !!node.checked;
        const v = (node.value == null ? "" : String(node.value));
        if (v === "" && fallback != null) return fallback;
        return v;
      };
    }
  } catch(e){}
})();

function buildText__LEGACY_DO_NOT_USE(mode, data) {
  data = data || {};
  // Normalized / trimmed inputs
  const link = String(data.url || data.link || "").trim();
  const email = String(data.email || "").trim();
  const phone = String(data.phone || "").trim();
  const smsBody = String(data.sms_body || data.smsBody || "").trim();
  const geo = String(data.geo || "").trim();
  const title = String(data.title || "").trim();
  const note = String(data.note || "").trim();

  // URL type (default)
  if (mode === "url" || mode === "link" || mode === "website" || !mode) {
    return link || "";
  }

  // Mailto
  if (mode === "email") {
    const subj = String(data.subject || "").trim();
    const body = String(data.body || "").trim();
    const q = [];
    if (subj) q.push("subject=" + encodeURIComponent(subj));
    if (body) q.push("body=" + encodeURIComponent(body));
    const qs = q.length ? "?" + q.join("&") : "";
    return email ? ("mailto:" + email + qs) : "";
  }

  // Tel
  if (mode === "phone" || mode === "tel") {
    return phone ? ("tel:" + phone.replace(/\s+/g, "")) : "";
  }

  // SMS
  if (mode === "sms") {
    // Format: sms:+15551234567?body=hi
    const q = smsBody ? ("?body=" + encodeURIComponent(smsBody)) : "";
    return phone ? ("sms:" + phone.replace(/\s+/g, "") + q) : "";
  }

  // Geo
  if (mode === "geo") {
    // geo:lat,lng?q=label
    return geo || "";
  }

  // Plain text / note
  if (mode === "text" || mode === "note") {
    const parts = [];
    if (title) parts.push(title);
    if (note) parts.push(note);
    return parts.join("\n").trim();
  }

  // vCard (basic)
  if (mode === "vcard") {
    const first = String(data.first || "").trim();
    const last = String(data.last || "").trim();
    const org = String(data.org || "").trim();
    const phone2 = String(data.phone2 || "").trim();
    const email2 = String(data.email2 || "").trim();
    const url2 = String(data.url2 || "").trim();

    const lines = [];
    lines.push("BEGIN:VCARD");
    lines.push("VERSION:3.0");
    lines.push("N:" + last + ";" + first + ";;;");
    lines.push("FN:" + [first, last].filter(Boolean).join(" "));
    if (org) lines.push("ORG:" + org);
    if (phone) lines.push("TEL;TYPE=CELL:" + phone);
    if (phone2) lines.push("TEL;TYPE=WORK:" + phone2);
    if (email2 || email) lines.push("EMAIL:" + (email2 || email));
    if (url2 || link) lines.push("URL:" + (url2 || link));
    lines.push("END:VCARD");
    return lines.join("\n");
  }

  // Fallback to URL
  return link || "";
}

// Small helper to measure a text line in SVG space (rough; uses canvas)
// =====================================================
//  EXTRACTED: CodeDesk Custom QR Code Regime
//  Source: qr_app-011326.js
//  Purpose: isolate custom SVG QR + card composition + render path
//  Note: This file is NOT expected to run standalone.
// =====================================================

// ---- ECC helper (used by render) ----
// ---- ECC helper (used by render) ----
// Canonical synthesis: define once globally to avoid const redeclare across split files.
if (typeof window.ECC_KEY === 'undefined') window.ECC_KEY = 'codedesk_ecc';
if (typeof window.ECC_DEFAULT === 'undefined') window.ECC_DEFAULT = 'M';

function getECC(){
  const v = sessionStorage.getItem(window.ECC_KEY);
  return /^[LMQH]$/.test(v) ? v : window.ECC_DEFAULT;
}

// ---- Background helper (used by render) ----
window.refreshBackground = function refreshBackground () {
  const card = document.getElementById('qrPreview');
  if (!card) return;

  // IMPORTANT: do NOT use `|| 0` here; 0 is valid and must stay 0.
  const topRaw = parseFloat(document.getElementById('bgTopAlpha')?.value);
  const botRaw = parseFloat(document.getElementById('bgBottomAlpha')?.value);
  const topA = (Number.isFinite(topRaw) ? topRaw : 100) / 100;
  const botA = (Number.isFinite(botRaw) ? botRaw : 100) / 100;

  // “Transparent background” = both alphas are 0
  const isTransparent = (topA <= 0.001 && botA <= 0.001);

  // class gating (stroke vs fill)
  card.classList.toggle('card--stroke', isTransparent);
  card.classList.toggle('card--fill', !isTransparent);

  // paint the CSS gradient var used by ::before
  try {
    if (typeof window.updatePreviewBackground === 'function') window.updatePreviewBackground();
  } catch (_e) {}
}

// ---- buildText(): QR payload encoder (type/mechanicals) ----
function buildText(){
    const _typeSel = document.getElementById('qrType');
    const t = _typeSel ? (_typeSel.value || '') : '';
    switch(t){
      case "URL": {
        // NOTE: field IDs come from qr_type_manifest.json; support common variants
                const raw =
          val("urlData") ||
          val("url") ||
          val("href") ||
          val("link") ||
          val("destination") ||
          val("targetUrl") ||
          "";

        // If empty, default to easter egg asset
        const rawTrim = String(raw || "").trim();
        if (!rawTrim) return "https://ascend.jacobhenderson.studio/codedesk/assets/love.html";

        // read optional utm fields (support common variants)
        const s = (val("utmSource")   || val("utm_source")   || "").trim();
        const m = (val("utmMedium")   || val("utm_medium")   || "").trim();
        const c = (val("utmCampaign") || val("utm_campaign") || "").trim();

        // If nothing extra was entered, return as-is
        if (!s && !m && !c) return rawTrim;

        try {
          // Robust path when rawTrim is a valid absolute URL
          const u = new URL(rawTrim);
          if (s) u.searchParams.set("utm_source",   s);
          if (m) u.searchParams.set("utm_medium",   m);
          if (c) u.searchParams.set("utm_campaign", c);
          return u.toString();
        } catch {
          // Fallback for non-absolute or invalid URLs:
          // append query the "old-fashioned" way without breaking existing params
          const join = rawTrim.includes("?") ? "&" : "?";
          const parts = [];
          if (s) parts.push(`utm_source=${encodeURIComponent(s)}`);
          if (m) parts.push(`utm_medium=${encodeURIComponent(m)}`);
          if (c) parts.push(`utm_campaign=${encodeURIComponent(c)}`);
          return parts.length ? `${rawTrim}${join}${parts.join("&")}` : rawTrim;
        }
      }
      case "Payment": {
        const mode = val("payMode");
        const user = val("payUser");
        const link = val("payLink");
        const amt  = val("payAmount");
        const note = val("payNote");
        const q = new URLSearchParams();
        if(amt) q.set("amount", amt);
        if(note) q.set("note", note);

        if(mode==="Generic Link" || mode==="Stripe Payment Link"){
          return link || "https://pay.example.com/your-link";
        }
        if(mode==="PayPal.me"){
          return `https://paypal.me/${(user||"yourname").replace(/^@/,"")}${amt?"/"+amt:""}`;
        }
        if(mode==="Venmo"){
          // venmo:// is not universally supported in scanners; https fallback:
          const u = (user||"yourname").replace(/^@/,"");
          return q.toString()
            ? `https://venmo.com/${u}?${q.toString()}`
            : `https://venmo.com/${u}`;
        }
        if(mode==="Cash App"){
          const u = (user||"$yourname");
          return q.toString()
            ? `https://cash.app/${u.replace(/^\$/,"$")}?${q.toString()}`
            : `https://cash.app/${u.replace(/^\$/,"$")}`;
        }
        return link || "https://example.org/pay";
      }
      case "WiFi": {
        const ssid = val("wifiSsid");
        const pwd  = val("wifiPwd");
        const sec  = val("wifiSec") || "WPA";
        const hid  = $("wifiHidden")?.checked ? "true" : "false";
        // WIFI:T:WPA;S:mynetwork;P:mypass;H:true;;
        return `WIFI:T:${sec};S:${ssid};P:${pwd};H:${hid};;`;
      }
      case "Contact": {
        // Minimal vCard 3.0 (keeps preview simple)
        const first = val("vFirst"), last = val("vLast");
        const org   = val("vOrg"),   title= val("vTitle");
        const phone = val("vPhone1"), email= val("vEmail1");
        return [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `N:${last||""};${first||""};;;`,
          `FN:${[first,last].filter(Boolean).join(" ")}`,
          org ? `ORG:${org}` : "",
          title ? `TITLE:${title}` : "",
          phone ? `TEL;TYPE=CELL:${phone}` : "",
          email ? `EMAIL;TYPE=INTERNET:${email}` : "",
          "END:VCARD"
        ].filter(Boolean).join("\n");
      }
      case "Message": {
        // ⛔ `?body=`, NOT `?&body=`. RFC 5724 is `sms:<number>?body=<text>`; the stray
        // ampersand made the whole thing a malformed query, and a pasted URI in the
        // number field turned into `sms:N?body=A?&body=B` — two bodies, and the phone
        // takes the last one. That is the "it still says Hello" report, 2026-08-29.
        // ⛔ NO PLACEHOLDER FALLBACKS. `|| "5551234567"` and `|| "Hello"` produced a
        // WORKING QR for an EMPTY form — a code that scans, addresses a stranger's
        // number and says Hello. A blank field must yield a blank payload so the
        // preview is visibly empty, not plausibly wrong.
        // ⭐ Same construction as buildText()'s SMS case in qr_ui_toolkit.js, which
        // was already right; this one is the live path because the manifest's type is
        // "Message", so the correct twin was never reached. Keep them identical.
        const num = String(val("smsNumber") || "").trim().replace(/[^\d+]/g, "");
        const txt = String(val("smsText") || "").trim();
        if (!num) return "";
        return txt ? `sms:${num}?body=${encodeURIComponent(txt)}` : `sms:${num}`;
      }
      case "Event": {
        // Very light VEVENT for preview
        const title = val("evtTitle") || "Event";
        const start = (val("evtStart") || "2025-10-16 12:00:00").replace(/[-: ]/g,"").slice(0,14)+"Z";
        const end   = (val("evtEnd")   || "2025-10-16 13:00:00").replace(/[-: ]/g,"").slice(0,14)+"Z";
        const loc   = val("evtLoc") || "";
        const det   = val("evtDet") || "";
        return [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "BEGIN:VEVENT",
          `SUMMARY:${title}`,
          `DTSTART:${start}`,
          `DTEND:${end}`,
          loc ? `LOCATION:${loc}` : "",
          det ? `DESCRIPTION:${det}` : "",
          "END:VEVENT",
          "END:VCALENDAR"
        ].filter(Boolean).join("\n");
      }
      case "Map": {
        const q   = val("mapQuery");
        const lat = val("mapLat");
        const lng = val("mapLng");
        const prov= val("mapProvider");
        if(lat && lng){
          if(prov==="geo"){ return `geo:${lat},${lng}`; }
          // default to Google maps link
          return `https://maps.google.com/?q=${lat},${lng}`;
        }
        return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : "https://maps.google.com";
      }
      default:
        return "https://jacobhenderson.studio/codedesk/";
    }
  }

// ---- Caption layout helper (used by compose/build) ----
function layoutCaptionLines(ns, {
  text,
  family,
  weight = '600',
  maxWidth,
  startSize,
  minSize,
  maxLines = 2,
  charBudget = 0,       // total characters across all lines
  twoLineTrigger = 14    // if > this, prefer wrapping first
}) {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  const s   = charBudget > 0 ? raw.slice(0, charBudget) : raw;

  const measure = (fs, str) => measureSvgText(ns, family, weight, fs, str);

  /* === NEW: single-line fast path (no ellipses) ===================== */
  if (maxLines === 1) {
    for (let fs = startSize; fs >= Math.max(5, minSize); fs--) {
      if (measure(fs, s) <= maxWidth) {
        return { fontSize: fs, lines: [s] };
      }
    }
    // If nothing fits wider than minSize, still return the full string at minSize.
    return { fontSize: Math.max(5, minSize), lines: [s] };
  }
  /* ================================================================== */

  // Greedy wrap (<= maxLines) at a given font size
  function wrapAt(fs) {
    const words = s.split(' ');
    const lines = [];
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (measure(fs, test) <= maxWidth) {
        line = test;
      } else {
        if (line) { lines.push(line); line = words[i]; }
        else      { lines.push(words[i]); line = ''; }
      }
      if (lines.length === maxLines) {
        // shove the remainder
        if (i < words.length - 1) {
          const rest = words.slice(i + 1).join(' ');
          lines[maxLines - 1] = (lines[maxLines - 1] + ' ' + rest).trim();
        }
        break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  // Try two-line wrap first when long
  const preferWrap = s.length > twoLineTrigger;

  for (let fs = startSize; fs >= minSize; fs--) {
    const lines = wrapAt(fs);

    if (lines.length <= maxLines) {
      // If all lines fit, accept.
      let ok = true;
      for (const ln of lines) {
        if (measure(fs, ln) > maxWidth) { ok = false; break; }
      }
      if (ok) return { fontSize: fs, lines };
    }

    // If preferWrap is false, allow single-line shrinking earlier
    if (!preferWrap && measure(fs, s) <= maxWidth) {
      return { fontSize: fs, lines: [s] };
    }
  }

  // Fallback: clamp at minSize and ellipsize last line
  const fs = minSize;
  let lines = wrapAt(fs);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);

  // Ellipsis on last line
  const lastIdx = Math.min(lines.length, maxLines) - 1;
  let last = lines[lastIdx] || '';
  while (last && measure(fs, last + '…') > maxWidth) {
    last = last.slice(0, -1);
  }
  lines[lastIdx] = last ? (last + '…') : '…';

  return { fontSize: fs, lines };
}

// ---- buildQrSvg(): custom SVG QR generator ----
function buildQrSvg({
  text, size, level,
  modulesShape, bodyColor,
  bgColor, transparentBg,
  eyeRingColor, eyeCenterColor,
  eyeRingShape = 'Square',
  eyeCenterShape = 'Square',

  // Module fill mode + scale + emoji
  modulesMode = 'Shape',         // 'Shape' | 'Emoji'
  emoji = '',
  emojiSize = 1.0,
  moduleScale = 1.0,

  // Quiet zone
  quietZone = 4,

  // Caption (optional)
  captionHeadline = '',
  captionBody1 = '',
  captionBody2 = '',
  captionColor = '#000',
  captionFontFamily = 'Work Sans',
  captionWeightHead = '700',
  captionWeightBody = '600',
}) {

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');

  const n = getQrModuleCount(text, level);
  const q = quietZone;
  const dim = n + q * 2;

  svg.setAttribute('xmlns', ns);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  // BG
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', transparentBg ? 'transparent' : (bgColor || '#fff'));
  svg.appendChild(bg);

  // Module size in px
  const u = size / dim;
  const scale = Math.max(0.2, Math.min(1.4, Number(moduleScale || 1.0)));
  const u2 = u * scale;
  const offset = (u - u2) / 2;

  // Emoji “cell”
  const wantsEmoji = (modulesMode === 'Emoji') && String(emoji || '').trim();
  const emojiChar = String(emoji || '').trim();
  const emojiScale = Math.max(0.4, Math.min(2.0, Number(emojiSize || 1.0)));

  // Eyes locations
  const eyes = [
    { x: 0, y: 0 },
    { x: n - 7, y: 0 },
    { x: 0, y: n - 7 },
  ];

  function isEyeArea(r, c){
    // finder patterns are 7x7 squares at the three corners
    return (
      (r <= 6 && c <= 6) ||
      (r <= 6 && c >= n - 7) ||
      (r >= n - 7 && c <= 6)
    );
  }

  // Draw modules
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {

      // Skip eye area; rendered separately
      if (isEyeArea(r, c)) continue;

      if (!qrIsDark(text, level, r, c)) continue;

      const x = (c + q) * u + offset;
      const y = (r + q) * u + offset;

      if (wantsEmoji) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', String(x + u2 / 2));
        t.setAttribute('y', String(y + u2 / 2));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-size', String(u2 * 0.9 * emojiScale));
        t.textContent = emojiChar;
        svg.appendChild(t);
      } else {
        const el = moduleRect(ns, modulesShape, x, y, u2, u2, bodyColor || '#000');
        svg.appendChild(el);
      }
    }
  }

  // Draw eyes
  for (const e of eyes) {
    const ox = (e.x + q) * u;
    const oy = (e.y + q) * u;
    drawFinderEye(ns, svg, {
      x: ox,
      y: oy,
      u: u,
      ringColor: eyeRingColor || bodyColor || '#000',
      centerColor: eyeCenterColor || eyeRingColor || bodyColor || '#000',
      ringShape: eyeRingShape,
      centerShape: eyeCenterShape,
    });
  }

  return svg;
}

// ---- composeCardSvg(): composes card + QR + caption ----
function composeCardSvg({
  cardWidth,
  transparentBg,

  // gradient inputs
  bgTopColor,
  bgBottomColor,
  bgTopAlpha,
  bgBottomAlpha,

  // caption
  captionHeadline,
  captionBody1,
  captionBody2,
  captionColor,
  captionFontFamily,

  // qr styling
  qrText,
  ecc,
  modulesShape,
  modulesMode,
  bodyColor,
  eyeRingColor,
  eyeCenterColor,
  eyeRingShape,
  eyeCenterShape,
  emoji,
  emojiSize,
  moduleScale,
  quietZone
}) {

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');

  const w = Number(cardWidth || 640);
  const h = Math.round(w / 0.63); // aspect
  const r = 44;

  svg.setAttribute('xmlns', ns);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Clip path (rounded card)
  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', 'rclip');
  const clipRect = document.createElementNS(ns, 'rect');
  clipRect.setAttribute('x', '0');
  clipRect.setAttribute('y', '0');
  clipRect.setAttribute('width', String(w));
  clipRect.setAttribute('height', String(h));
  clipRect.setAttribute('rx', String(r));
  clipRect.setAttribute('ry', String(r));
  clip.appendChild(clipRect);
  defs.appendChild(clip);
  svg.appendChild(defs);

  const g = document.createElementNS(ns, 'g');
  g.setAttribute('clip-path', 'url(#rclip)');
  svg.appendChild(g);

  // Background (transparent; CSS handles gradient fill on the host)
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', 'transparent');
  g.appendChild(bg);

  // Caption (top)
  const headline = String(captionHeadline || '').trim();
  const b1 = String(captionBody1 || '').trim();
  const b2 = String(captionBody2 || '').trim();

  const hasCaption = !!(headline || b1 || b2);

  const padX = Math.round(w * 0.08);
  const maxW = Math.round(w * 0.84);

  let captionBottomY = Math.round(w * 0.22);

  if (hasCaption) {
    const headFit = layoutCaptionLines(ns, {
      text: headline,
      family: captionFontFamily || 'Work Sans',
      weight: '700',
      maxWidth: maxW,
      startSize: 34,
      minSize: 18,
      maxLines: 2,
      charBudget: 64,
      twoLineTrigger: 16
    });

    const bodyFit = layoutCaptionLines(ns, {
      text: [b1, b2].filter(Boolean).join('  '),
      family: captionFontFamily || 'Work Sans',
      weight: '600',
      maxWidth: maxW,
      startSize: 22,
      minSize: 14,
      maxLines: 2,
      charBudget: 90,
      twoLineTrigger: 18
    });

    let y = Math.round(w * 0.09);

    // Head lines
    for (const ln of (headFit.lines || [])) {
      y += headFit.fontSize;
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(padX));
      t.setAttribute('y', String(y));
      t.setAttribute('font-family', captionFontFamily || 'Work Sans');
      t.setAttribute('font-size', String(headFit.fontSize));
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', captionColor || '#000');
      t.textContent = ln;
      g.appendChild(t);
      y += Math.round(headFit.fontSize * 0.18);
    }

    // Body lines
    for (const ln of (bodyFit.lines || [])) {
      y += bodyFit.fontSize;
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(padX));
      t.setAttribute('y', String(y));
      t.setAttribute('font-family', captionFontFamily || 'Work Sans');
      t.setAttribute('font-size', String(bodyFit.fontSize));
      t.setAttribute('font-weight', '600');
      t.setAttribute('fill', captionColor || '#000');
      t.textContent = ln;
      g.appendChild(t);
      y += Math.round(bodyFit.fontSize * 0.22);
    }

    captionBottomY = y + Math.round(w * 0.05);
  }

  // QR positioning
  const qrPad = Math.round(w * 0.06);
  const qrSize = Math.round(w - qrPad * 2);
  const qrX = qrPad;
  const qrY = hasCaption ? Math.max(captionBottomY, Math.round(w * 0.30)) : qrPad;

  const qrSvg = buildQrSvg({
    text: qrText,
    size: qrSize,
    level: ecc || 'M',
    modulesShape: modulesShape || 'Square',
    modulesMode: modulesMode || 'Shape',
    bodyColor: bodyColor || '#000',
    bgColor: '#fff',
    transparentBg: true,
    eyeRingColor: eyeRingColor || bodyColor || '#000',
    eyeCenterColor: eyeCenterColor || eyeRingColor || bodyColor || '#000',
    eyeRingShape: eyeRingShape || 'Square',
    eyeCenterShape: eyeCenterShape || 'Square',
    emoji: emoji || '',
    emojiSize: emojiSize || 1.0,
    moduleScale: moduleScale || 1.0,
    quietZone: quietZone || 4
  });

  // Mount QR as inner markup
  const holder = document.createElementNS(ns, 'g');
  holder.setAttribute('transform', `translate(${qrX},${qrY})`);
  // Strip outer svg and inject inner nodes
  const inner = (qrSvg && qrSvg.outerHTML) ? qrSvg.outerHTML : '';
  holder.innerHTML = inner.replace(/^\s*<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  g.appendChild(holder);

  return svg.outerHTML;
}

// NOTE: render(), refreshModulesMode(), refreshCenter(), and export helpers
// are now provided by qr_render_engine.js. Removed duplicates to avoid conflicts.

function _sanitizeFileBase(name) {
  return String(name || 'qr')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 40);
}

function buildSuggestedFilename(ext) {
  const type = String(val('qrType','url') || 'qr').trim().toLowerCase();
  const head = String(val('campaign','') || '').trim();
  const base = head ? _sanitizeFileBase(head) : type;
  return `${base}.${ext || 'png'}`;
}

function uaHints(){
  const nav = navigator || {};
  const ua  = String(nav.userAgent || '');
  const plat= String(nav.platform || '');
  return { ua, platform: plat };
}

// Bind export buttons if present
(function wireExportButtonsOnce(){
  if (window.__CODEDESK_EXPORT_WIRED__) return;
  window.__CODEDESK_EXPORT_WIRED__ = true;

  const bSvg = document.getElementById('downloadSvg');
  const bPng = document.getElementById('downloadPng');

  if (bSvg) {
    bSvg.addEventListener('click', (e) => {
      try { e.preventDefault(); } catch(_){}
      window.downloadSvg(buildSuggestedFilename('svg'));
    });
  }
  if (bPng) {
    bPng.addEventListener('click', async (e) => {
      try { e.preventDefault(); } catch(_){}
      await window.downloadPng(buildSuggestedFilename('png'));
    });
  }
})();

// Ensure preview reflows after fonts load (best-effort)
try {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => typeof render === 'function' && render());
  }
} catch (e) {}

// Render once at load if QR libs are ready
try {
  if (typeof render === 'function') render();
} catch (e) {}

