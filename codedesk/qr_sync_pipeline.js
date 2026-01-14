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
        try { if (typeof window.render === 'function') window.render(); } catch(_e){}

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

  // HARD GATE: never sync until setup is done (filename ceremony).
  if (window.__CODEDESK_SETUP_DONE__ !== true) return false;

  const workingId = (window.__CODEDESK_CURRENT_WF_ID__ || window.codedeskGetActiveWorkingFileId?.() || '').trim();
  if (!workingId) return false;

  const rec = window.codedeskGetWorkingFileRecord ? window.codedeskGetWorkingFileRecord(workingId) : null;
  if (!rec) return false;

  const folderId = String(window.CODEDESK_FILEROOM_FOLDER_ID || '').trim();
  if (!folderId) return false;

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
  try { stateObj = (rec && rec.state) ? rec.state : (window.okqralExportState ? window.okqralExportState() : null); } catch(e){}
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
    const pngDataUrl = await codedeskPngDataUrlFromCurrentSvg(3);
    if (pngDataUrl) {

      // canonical filename (always .png)
      const fileName = (base || 'CODEDESK') + '.png';

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
      if (!j || !j.ok) return false;

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
function measureTextPx(text, fontFamily, fontSizePx, fontWeight) {
  try {
    const c = measureTextPx._c || (measureTextPx._c = document.createElement('canvas'));
    const ctx = c.getContext('2d');
    ctx.font = `${fontWeight || 600} ${fontSizePx || 18}px ${fontFamily || 'Work Sans'}`;
    const m = ctx.measureText(String(text || ''));
    return m.width || 0;
  } catch (e) {
    return 0;
  }
}

// Layout caption lines to fit within a target width.
// Returns { headLines: [...], bodyLines: [...], headSize, bodySize, headLeading, bodyLeading }
function layoutCaptionLines(opts) {
  opts = opts || {};
  const head = String(opts.headline || '').trim();
  const body = String(opts.body || '').trim();

  const maxW = Number(opts.maxWidthPx || 520);
  const fontFamily = String(opts.fontFamily || 'Work Sans');
  const headWeight = Number(opts.headWeight || 700);
  const bodyWeight = Number(opts.bodyWeight || 600);

  const headMaxSize = Number(opts.headMaxSize || 28);
  const headMinSize = Number(opts.headMinSize || 16);
  const bodyMaxSize = Number(opts.bodyMaxSize || 18);
  const bodyMinSize = Number(opts.bodyMinSize || 12);

  // Greedy word-wrap helper
  function wrap(text, sizePx, weight) {
    if (!text) return [];
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const next = cur ? (cur + ' ' + words[i]) : words[i];
      const w = measureTextPx(next, fontFamily, sizePx, weight);
      if (w <= maxW || !cur) {
        cur = next;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function fit(text, maxSize, minSize, weight, maxLines) {
    let size = maxSize;
    let lines = wrap(text, size, weight);
    while (size > minSize && (lines.length > maxLines || (lines.some(l => measureTextPx(l, fontFamily, size, weight) > maxW)))) {
      size -= 1;
      lines = wrap(text, size, weight);
    }
    return { size, lines };
  }

  // Headline: aim for <= 2 lines
  const headFit = fit(head, headMaxSize, headMinSize, headWeight, 2);

  // Body: aim for <= 2 lines (optional)
  const bodyFit = fit(body, bodyMaxSize, bodyMinSize, bodyWeight, 2);

  return {
    headLines: headFit.lines,
    bodyLines: bodyFit.lines,
    headSize: headFit.size,
    bodySize: bodyFit.size,
    headLeading: Math.round(headFit.size * 1.15),
    bodyLeading: Math.round(bodyFit.size * 1.2),
    fontFamily
  };
}

// Build an SVG element for the QR, including background, modules, and eyes.
// Returns SVG string
function buildQrSvg(text, opts) {
  opts = opts || {};
  const ecc = String(opts.ecc || 'M').toUpperCase();
  const size = Number(opts.size || 256);
  const margin = Number(opts.margin || 0);

  // colors
  const modColor = String(opts.modulesColor || '#000000');
  const eyeColor = String(opts.eyesColor || modColor);
  const bg = String(opts.background || 'transparent');

  // module shape presets (segno style)
  const segno = window.segno || null;

  // Fallback to QRCode.js if segno isn't present
  // (Canonical file expects segno; keep behavior as-is when present.)
  let matrix = null;
  try {
    if (segno && typeof segno.make === 'function') {
      const qr = segno.make(text || '', { error: ecc });
      matrix = qr.matrix;
    }
  } catch (e) {
    matrix = null;
  }

  // If segno isn't present, use QRCode.js to generate a matrix-like raster and paint as modules
  if (!matrix && window.QRCode && window.QRCode.CorrectLevel) {
    // QRCode.js renders to DOM; we only need its internal data if accessible.
    // Canonical file still supports QRCode.js path; keep it minimal.
    const tmp = document.createElement('div');
    tmp.style.position = 'absolute';
    tmp.style.left = '-99999px';
    tmp.style.top = '-99999px';
    document.body.appendChild(tmp);
    try {
      const qr = new window.QRCode(tmp, {
        text: text || '',
        width: size,
        height: size,
        colorDark: modColor,
        colorLight: 'transparent',
        correctLevel: window.QRCode.CorrectLevel[ecc] || window.QRCode.CorrectLevel.M
      });
      // Try to read the canvas pixels and infer matrix (crude fallback)
      const canvas = tmp.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, size, size).data;
        // infer module count by scanning first row for transitions
        // (best-effort fallback; canonical path prefers segno)
        const row = [];
        for (let x = 0; x < size; x++) {
          const i = (0 * size + x) * 4;
          row.push(img[i + 3] > 0 ? 1 : 0);
        }
        // guess moduleCount
        let transitions = 0;
        for (let i = 1; i < row.length; i++) {
          if (row[i] !== row[i - 1]) transitions++;
        }
        const moduleCount = Math.max(21, Math.min(177, Math.round(transitions / 2)));
        matrix = [];
        const step = size / moduleCount;
        for (let y = 0; y < moduleCount; y++) {
          const line = [];
          for (let x = 0; x < moduleCount; x++) {
            const cx = Math.floor((x + 0.5) * step);
            const cy = Math.floor((y + 0.5) * step);
            const j = (cy * size + cx) * 4;
            const on = img[j + 3] > 0 && img[j] < 200;
            line.push(!!on);
          }
          matrix.push(line);
        }
      }
    } catch (e) {
      // noop
    } finally {
      try { tmp.remove(); } catch(e){}
    }
  }

  if (!matrix) {
    // last-ditch empty svg
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;
  }

  const n = matrix.length;
  const scale = (size - margin * 2) / n;

  function rect(x, y, w, h, fill) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }

  // Identify eyes (finder patterns) - top-left, top-right, bottom-left
  function isInEye(x, y) {
    const inTL = (x < 7 && y < 7);
    const inTR = (x >= n - 7 && y < 7);
    const inBL = (x < 7 && y >= n - 7);
    return inTL || inTR || inBL;
  }

  let parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`);

  if (bg !== 'transparent') {
    parts.push(rect(0, 0, size, size, bg));
  }

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue;
      const px = margin + x * scale;
      const py = margin + y * scale;
      const fill = isInEye(x, y) ? eyeColor : modColor;
      parts.push(rect(px, py, scale, scale, fill));
    }
  }

  parts.push(`</svg>`);
  return parts.join('');
}

// Compose the full card SVG: background, caption, QR, border radius, etc.
function composeCardSvg(opts) {
  opts = opts || {};
  const w = Number(opts.width || 640);
  const h = Number(opts.height || 1000);
  const r = Number(opts.radius || 44);

  const bgPaint = String(opts.bgPaint || 'white');
  const strokeOn = !!opts.strokeOn;
  const strokeColor = String(opts.strokeColor || '#e6e6e6');
  const strokeWidth = Number(opts.strokeWidth || 6);

  const qrSvg = String(opts.qrSvg || '');
  const qrSize = Number(opts.qrSize || 420);

  const cap = opts.caption || {};
  const headLines = cap.headLines || [];
  const bodyLines = cap.bodyLines || [];
  const fontFamily = String(cap.fontFamily || 'Work Sans');
  const headSize = Number(cap.headSize || 24);
  const bodySize = Number(cap.bodySize || 16);
  const headLeading = Number(cap.headLeading || Math.round(headSize * 1.15));
  const bodyLeading = Number(cap.bodyLeading || Math.round(bodySize * 1.2));

  const textColor = String(opts.textColor || '#000000');

  // Positioning
  const padX = Number(opts.padX || 64);
  const topY = Number(opts.topY || 84);
  const qrY = Number(opts.qrY || 360);
  const qrX = Math.round((w - qrSize) / 2);

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Clip path for rounded corners
  const clipId = 'clip_' + Math.random().toString(16).slice(2);

  let parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}"/></clipPath></defs>`);
  parts.push(`<g clip-path="url(#${clipId})">`);

  // Background paint can be CSS gradient in preview; in SVG we use a flat fill fallback.
  // If passed bgPaint already is an SVG-friendly color, use it.
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${bgPaint}"/>`);

  // Optional stroke (when background is transparent)
  if (strokeOn) {
    parts.push(`<rect x="${strokeWidth/2}" y="${strokeWidth/2}" width="${w-strokeWidth}" height="${h-strokeWidth}" rx="${r}" ry="${r}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`);
  }

  // Caption (headline + body)
  let y = topY;

  if (headLines.length) {
    parts.push(`<text x="${padX}" y="${y}" fill="${textColor}" font-family="${esc(fontFamily)}" font-size="${headSize}" font-weight="700">`);
    headLines.forEach((line, i) => {
      const dy = i === 0 ? 0 : headLeading;
      parts.push(`<tspan x="${padX}" dy="${dy}">${esc(line)}</tspan>`);
    });
    parts.push(`</text>`);
    y += headLeading * headLines.length + 18;
  }

  if (bodyLines.length) {
    parts.push(`<text x="${padX}" y="${y}" fill="${textColor}" font-family="${esc(fontFamily)}" font-size="${bodySize}" font-weight="600">`);
    bodyLines.forEach((line, i) => {
      const dy = i === 0 ? 0 : bodyLeading;
      parts.push(`<tspan x="${padX}" dy="${dy}">${esc(line)}</tspan>`);
    });
    parts.push(`</text>`);
  }

  // QR SVG (nested)
  if (qrSvg) {
    // Strip outer <svg ...> wrapper and inject its inner content into a group with scaling.
    const inner = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    parts.push(`<g transform="translate(${qrX},${qrY})">`);
    // We assume qrSvg viewBox corresponds to its own size; scale to qrSize if needed.
    parts.push(inner);
    parts.push(`</g>`);
  }

  parts.push(`</g></svg>`);
  return parts.join('');
}

function render() {
  let preview = document.getElementById('qrPreview');
  let mount   = document.getElementById('qrMount');

  // If the host HTML is a different/older variant, self-heal by creating
  // the required nodes inside the existing preview-stage wrapper.
  if (!preview || !mount) {
    const stage = document.querySelector('.preview-stage');
    if (stage) {
      if (!preview) {
        preview = document.createElement('div');
        preview.id = 'qrPreview';
        stage.appendChild(preview);
      }
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'qrMount';
        preview.appendChild(mount);
      }
    }
  }

  if (!preview || !mount) return;

  // PreviewModel state: prevent blank frames by keeping last-good SVG
  if (!render._previewState) {
    render._previewState = {
      stageState: 'ready',
      lastGoodSvg: null,
      errorMessage: null
    };
  }
  const _previewState = render._previewState;

  const toHex = (v) => {
    v = String(v || '').trim();
    if (!v) return null;
    if (!v.startsWith('#')) v = '#' + v;
    const short = /^#([0-9a-f]{3})$/i;
    const full  = /^#([0-9a-f]{6})$/i;
    if (short.test(v)) return ('#' + v.slice(1).split('').map(c => c + c).join('')).toUpperCase();
    if (full.test(v))  return v.toUpperCase();
    return null;
  };

  const colorHex = (id, fallback) => {
    const c = toHex(document.getElementById(id)?.value);
    return c || fallback;
  };

  const hexPair = (colorId, textId, fallback) => {
    const t = toHex(document.getElementById(textId)?.value);
    if (t) return t;
    const c = toHex(document.getElementById(colorId)?.value);
    return c || fallback;
  };

  const num = (id, fallback) => {
    const v = parseFloat(document.getElementById(id)?.value);
    return Number.isFinite(v) ? v : fallback;
  };

  // ---- background mode + CSS paint
  try { if (typeof window.refreshBackground === 'function') window.refreshBackground(); } catch {}

  // ---- caption (implicit: any text enables caption + rectangular card)
  const headline = (document.getElementById('campaign')?.value || '').trim().slice(0, 20);
  const body     = (document.getElementById('captionBody')?.value || '').trim().slice(0, 60);
  const hasCaption = !!(headline || body);

  // PreviewModel (pure data): stage + semantic content
  const previewModel = {
    stage: {
      shape: hasCaption ? 'wallet' : 'square',
      aspectRatio: hasCaption ? 0.63 : 1
    },
    content: {
      hasCaption,
      headline,
      body
    },
    qr: null,
    presentation: null,
    overlays: null,
    state: _previewState
  };

  // Preview stage must match the same two-state geometry as composeCardSvg()
  // - no caption: square
  // - caption present: wallet card (0.63 : 1 width : height)
  const stageEl = preview.closest('.preview-stage');
  if (stageEl) {
    stageEl.style.aspectRatio = (previewModel.stage.shape === 'wallet') ? '0.63 / 1' : '1 / 1';
  }

  // Toggle visual style (stroke vs fill card)
  // “Transparent background” = both gradient alphas are 0
  const topRaw = parseFloat(document.getElementById('bgTopAlpha')?.value);
  const botRaw = parseFloat(document.getElementById('bgBottomAlpha')?.value);
  const topA = (Number.isFinite(topRaw) ? topRaw : 100) / 100;
  const botA = (Number.isFinite(botRaw) ? botRaw : 100) / 100;
  const isTransparent = (topA <= 0.001 && botA <= 0.001);

  preview.classList.toggle('card--stroke', isTransparent);
  preview.classList.toggle('card--fill',  !isTransparent);

  // Stable card width (height via CSS aspect-ratio)
  const rect      = preview.getBoundingClientRect();
  const cardWidth = Math.max(rect.width || preview.clientWidth || 320, 320);

  // Build composed SVG
  const ecc = getECC();

  // PreviewModel (pure data): QR inputs (ALWAYS non-empty; fallback slug allowed)
  let __enc = "";
  try { __enc = (typeof buildText === 'function') ? buildText() : ""; } catch(_e){}
  const rawTrim = String(__enc || "").trim();
  const qrText = rawTrim || 'CODEDESK QR';

  previewModel.qr = {
    text: qrText,
    eccLevel: ecc,
    moduleStyle: (document.getElementById('modulesMode')?.value || 'Shape'),
    size: null,
    quietZonePolicy: num('margin', 4)
  };

  // PreviewModel (pure data): presentation (surface-only; background stays via CSS)
  previewModel.presentation = {
    background: {
      mode: isTransparent ? 'card--stroke' : 'card--fill',
      token: null,
      intensity: null
    },
    layout: {
      center: true,
      marginMode: null
    },
    qrDisplay: {
      modules: (document.getElementById('modulesMode')?.value || 'Shape'),
      invert: false,
      pixelSnap: false
    }
  };

  // PreviewModel (pure data): overlays (surface-only; not in SVG)
  previewModel.overlays = {
    grid: false,
    bleed: false,
    bounds: false,
    debug: false
  };

  _previewState.stageState = 'loading';
  _previewState.errorMessage = null;

  let svgStr = '';
  try {
    const fontFamily = (document.getElementById('fontFamily')?.value || 'Work Sans');

    const capLayout = layoutCaptionLines({
      headline,
      body,
      fontFamily
    });

    const qrSvg = buildQrSvg(previewModel.qr.text, {
      ecc,
      modulesColor: colorHex('bodyColor', '#000000'),
      eyesColor: colorHex('eyeRingColor', colorHex('bodyColor', '#000000')),
      background: 'transparent'
    });

    svgStr = composeCardSvg({
      bgPaint: 'transparent',
      strokeOn: isTransparent,

      qrSvg,

      caption: hasCaption ? {
        headLines: capLayout.headLines,
        bodyLines: capLayout.bodyLines,
        headSize: capLayout.headSize,
        bodySize: capLayout.bodySize,
        headLeading: capLayout.headLeading,
        bodyLeading: capLayout.bodyLeading,
        fontFamily
      } : {
        headLines: [],
        bodyLines: [],
        headSize: 0,
        bodySize: 0,
        headLeading: 0,
        bodyLeading: 0,
        fontFamily
      },

      textColor: colorHex('captionColor', '#000000')
    });
  } catch (e) {
    _previewState.stageState = 'error';
    try { _previewState.errorMessage = String(e && e.message ? e.message : e); } catch(_e){}
    console.warn('render() failed', e);
    return;
  }

  // Paint (never clear unless replacing in the same pass)
  try {
    mount.innerHTML = svgStr;
    const svgEl = mount.querySelector('svg');
    if (svgEl) {
      _previewState.lastGoodSvg = svgEl;
    }
    _previewState.stageState = 'ready';
  } catch (e) {
    _previewState.stageState = 'error';
    try { _previewState.errorMessage = String(e && e.message ? e.message : e); } catch(_e){}
    console.warn('render() mount failed', e);
    return;
  }

  // Ensure no opaque mount background blocks true transparency
  try {
    mount.style.background = 'transparent';
    mount.style.backgroundColor = 'transparent';
    const svgEl = mount.querySelector('svg');
    if (svgEl) {
      svgEl.style.background = 'transparent';
      svgEl.style.backgroundColor = 'transparent';
    }
  } catch (e) {}
}
;window.render = render;

  // One-time lightweight listeners that re-render
  if (!render._wired) {
    const _rerender = () => {
      if (window.__CODEDESK_IMPORTING_STATE__ || window.__CODEDESK_APPLYING_TEMPLATE__) return;
      clearTimeout(render._t);
      render._t = setTimeout(render, 30);
    };

    // Live updates while typing (Mechanicals must regenerate QR immediately)
    document.addEventListener('input',  _rerender, true);
    document.addEventListener('change', _rerender, true);

    // Safety net for any “non-input” controls / contenteditable / weird UI widgets
    document.addEventListener('keyup', (e) => {
      if (!e) return;
      _rerender();
    }, true);

    window.addEventListener('resize', () => _rerender());
    document.getElementById('qrType')?.addEventListener('change', () => setTimeout(_rerender, 0));

    // Ensure we generate *something* immediately (even before the user blurs a field)
    queueMicrotask(() => { try { _rerender(); } catch (e) {} });

    render._wired = true;
  }

// --- Modules mode toggle (hide QR modules vs show)
function refreshModulesMode(){
  const mode      = document.getElementById('modulesMode');
  const label     = document.getElementById('modulesModeLabel');
  const isOn      = !!(mode && mode.checked);
  const previewEl = document.getElementById('qrPreview') || document.getElementById('qrMount') || null;

  if (label) label.textContent = isOn ? 'Modules: ON' : 'Modules: OFF';
  if (previewEl) {
    previewEl.classList.toggle('modules-off', !isOn);
    previewEl.classList.toggle('modules-on', !!isOn);
  }

  // Disable module color when modules off
  const modInput = document.getElementById('modulesColor') || document.querySelector('#modulesColor');
  if (modInput) modInput.disabled = !isOn;
}

// --- Centering mode toggle
function refreshCenter(){
  const mode      = document.getElementById('centerMode');
  const label     = document.getElementById('centerModeLabel');
  const isOn      = !!(mode && mode.checked);
  const previewEl = document.getElementById('qrPreview') || document.getElementById('qrMount') || null;

  if (label) label.textContent = isOn ? 'Center: ON' : 'Center: OFF';
  if (previewEl) {
    previewEl.classList.toggle('center-off', !isOn);
    previewEl.classList.toggle('center-on', !!isOn);
  }
}

// --- Export helpers ---
function getCurrentSvgNode() {
  return document.querySelector('#qrMount svg');
}

function downloadSvg(filename = 'qr.svg') {
  const src = getCurrentSvgNode();
  if (!src) return;

  const blob = new Blob([src.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function svgToPngBlob(svgNode, width, height) {
  return new Promise((resolve) => {
    try {
      const svg = new Blob([svgNode.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svg);
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => resolve(b), 'image/png');
      };
      img.src = url;
    } catch (e) {
      resolve(null);
    }
  });
}

async function downloadPng(filename = 'qr.png') {
  const src = getCurrentSvgNode();
  if (!src) return;

  const w = parseInt(src.getAttribute('width') || '640', 10) || 640;
  const h = parseInt(src.getAttribute('height') || '1000', 10) || 1000;

  const blob = await svgToPngBlob(src, w, h);
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
      downloadSvg(buildSuggestedFilename('svg'));
    });
  }
  if (bPng) {
    bPng.addEventListener('click', async (e) => {
      try { e.preventDefault(); } catch(_){}
      await downloadPng(buildSuggestedFilename('png'));
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

