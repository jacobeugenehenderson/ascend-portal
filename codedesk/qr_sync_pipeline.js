window.codedeskPushWorkingDebounced = function codedeskPushWorkingDebounced(reason){
  if (_codedeskFileRoomTimer) clearTimeout(_codedeskFileRoomTimer);
  _codedeskFileRoomTimer = setTimeout(() => {
    try { window.codedeskPushWorkingNow && window.codedeskPushWorkingNow(reason || 'debounced'); } catch(e){}
  }, CODEDESK_AUTOSAVE_DEBOUNCE_MS);
};

window.codedeskPushWorkingNow = async function codedeskPushWorkingNow(reason){
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
  try { stateObj = (rec && rec.state) ? rec.state : (window.okqralExportState ? window.okqralExportState() : null); } catch(e){}
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

  function codedeskSetSetupSparkleVisible(visible){
    // The setup affordance is the sparkle action button (icon-only ✨ in the UI).
    // Do NOT hide “Finish setup” text buttons; only target the sparkle control.
    try {
      document.querySelectorAll('button').forEach((b) => {
        const t = String((b && b.textContent) ? b.textContent : '').trim();
        if (t !== '✨') return;
        b.style.display = visible ? '' : 'none';
      });
    } catch(e){}
  }

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
  }

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

        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}

        const fname = String(inp.value || '').trim();
        if (!fname) return;

        // If a working file already exists, this listener should not be active.
        // (Defensive: remove itself if it ever fires in that state.)
        try {
          const _aid = (typeof _getActiveWorkingFileId === 'function') ? _getActiveWorkingFileId() : null;
          const _rec = _aid && (typeof window.codedeskGetWorkingFileRecord === 'function'
            ? window.codedeskGetWorkingFileRecord(_aid)
            : null);
          if (_rec) {
            try { inp.removeEventListener('keydown', codedeskFilenameEnterCeremony, true); } catch(__e){}
            return;
          }
        } catch(_e){}

        try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(_e){}
        try { codedeskSetLocked(false); } catch(_e){}

        // If the stepper was late-mounted, ensure the right-side controls are actually wired.
        try { wireRightAccordionBehaviorOnce(); } catch(_e){}

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

        if (!__isReturn0 || __forcedNew0) {
          inp.addEventListener('keydown', codedeskFilenameEnterCeremony, true);
        }
      } catch(_e){
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

  // One-time setup: only treat as "already set up" if an actual working-file record exists.
  const existingId = _getActiveWorkingFileId();
  const existingRec = existingId && (typeof window.codedeskGetWorkingFileRecord === 'function'
    ? window.codedeskGetWorkingFileRecord(existingId)
    : null);
  if (existingRec) {
    try { codedeskRemoveSetupStep && codedeskRemoveSetupStep(); } catch(e){}
    return;
  }

  // Hard guard: prevent double-fire (capture + fast clicks + weirdness)
  if (window.__CODEDESK_FINISH_INFLIGHT__ === true) {
    try { e && e.preventDefault && e.preventDefault(); } catch(_e){}
    try { e && e.stopPropagation && e.stopPropagation(); } catch(_e){}
    return;
  }
  window.__CODEDESK_FINISH_INFLIGHT__ = true;

  try {
    const prevText = (btn.textContent || '').trim();
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = 'Working…';
    try { btn.setAttribute('title', 'Working…'); } catch(e){}

    let id = '';
    try { id = window.codedeskFinishSetup(); } catch(err){}

    // Full one-time pairing: creates/updates the Drive PNG + FileRoom rows
    try {
      if (id && window.codedeskSyncFileRoomNow) {
        await window.codedeskSyncFileRoomNow('setup');
      }
    } catch(e){}

    // Disappear forever (button + finish step)
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
function codedeskPngDataUrlFromCurrentSvg(){
  try {
    if (typeof codedeskExportPngDataUrl === 'function') {
      const out = codedeskExportPngDataUrl();
      if (out) return out;
    }
  } catch(e){}

  try {
    const svg = document.querySelector('#qrWrap svg');
    if (!svg) return '';
    const xml = new XMLSerializer().serializeToString(svg);

    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const image64 = 'data:image/svg+xml;base64,' + svg64;

    const img = new Image();
    img.src = image64;

    // Synchronous fallback is not possible; return empty so caller can skip PNG.
    // (Canonical export path should provide a proper PNG export helper.)
    return '';
  } catch(e){
    return '';
  }
}

window.codedeskSyncFileRoomNow = async function codedeskSyncFileRoomNow(reason){
  const workingId = String(window.__CODEDESK_CURRENT_WF_ID__ || _getActiveWorkingFileId() || '').trim();
  if (!workingId) return false;

  const rec = window.codedeskGetWorkingFileRecord && window.codedeskGetWorkingFileRecord(workingId);
  if (!rec) return false;

  const folderId = String(window.CODEDESK_FILEROOM_FOLDER_ID || '').trim();
  if (!folderId) return false;

  const svgNode = (typeof getCurrentSvgNode === 'function') ? getCurrentSvgNode() : null;
  if (!svgNode) return false;

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
  try { stateObj = (rec && rec.state) ? rec.state : (window.okqralExportState ? window.okqralExportState() : null); } catch(e){}

  // Stamp canonical destination_url into the exported state blob (portable single source of truth).
  try {
    if (stateObj && typeof stateObj === 'object') {
      stateObj.destination_url = destinationUrl;
      stateObj.DestinationUrl = destinationUrl; // compatibility alias
      stateObj.payloadText = destinationUrl;    // compatibility alias
    }
  } catch(e){}

  let stateJson = '';
  try { stateJson = (typeof stateObj === 'string') ? stateObj : JSON.stringify(stateObj || {}); } catch(e){ stateJson = ''; }

  // Render a PNG for Drive (best effort; canonical export helper if present)
  let pngDataUrl = '';
  try { pngDataUrl = codedeskPngDataUrlFromCurrentSvg() || ''; } catch(e){ pngDataUrl = ''; }

  // Ensure we have a Drive file id (create once, then update)
  let driveFileId = '';
  try { driveFileId = String((rec.fileroom && rec.fileroom.drive_file_id) ? rec.fileroom.drive_file_id : '').trim(); } catch(e){ driveFileId = ''; }

  try {
    const payload = {
      action: 'upsertDriveFile',
      folder_id: folderId,
      drive_file_id: driveFileId,
      filename: (base || 'CODEDESK') + '.png',
      mime: 'image/png',
      png_data_url: pngDataUrl
    };

    const res = await fetch(window.CODEDESK_FILEROOM_API_BASE, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    try {
      const txt = await res.text();
      const j = JSON.parse(txt || '{}');
      if (j && j.drive_file_id) driveFileId = String(j.drive_file_id || '').trim();
    } catch(_e){}
  } catch (e) {
    // If Drive upsert fails, do not clear dirty.
    return false;
  }

  // Upsert DELIVERABLE row (green FileRoom lane) — references Drive file id
  try {
    await fetch(window.CODEDESK_FILEROOM_API_BASE, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'upsertJob',
        ascend_job_key: 'CODEDESK:' + workingId,
        app: 'codedesk',
        source_id: workingId,
        title: base || 'CODEDESK QR',
        subtitle: 'CODEDESK — QR',
        status: 'open',
        open_url: String(location && location.href ? location.href : ''),
        owner_email: ((window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.user_email) ? window.CODEDESK_ENTRY.user_email : '') || getCurrentUserEmail_(),
        kind: 'deliverable',
        asset_type: 'qr',
        template_id: (rec && (rec.template_id || rec.templateId)) ? String(rec.template_id || rec.templateId) : '',
        destination_url: destinationUrl,
        state_json: stateJson,
        drive_file_id: driveFileId,
        tags: 'codedesk,qr'
      })
    });
  } catch (e) {
    // If deliverable upsert fails, do not clear dirty.
    return false;
  }

  // Record pairing in the working-file record (so return-visits know pairing is done)
  try {
    const next = Object.assign({}, rec.fileroom || {});
    next.drive_file_id = driveFileId;
    rec.fileroom = next;
    try { window.codedeskSaveWorkingFile && window.codedeskSaveWorkingFile(String(rec.name || ''), { id: workingId }); } catch(_e){}
  } catch(e){}

  // Successful full export — clear dirty
  try {
    window.__CODEDESK_DIRTY__ = false;
    window.__CODEDESK_LAST_EXPORT_AT__ = Date.now();
  } catch(e){}

  return true;
};