"use strict";

// ------------------------------------------------------------
// CodeDesk template bootstrap gate (single-run invariant)
// ------------------------------------------------------------
// NOTE: Do not use a global "done" latch for bootstrapping.
// URL bootstrap is signature-driven via CODEDESK_BOOTSTRAP_SESSION_KEY.
window.__CODEDESK_BOOTSTRAP_DONE__ = false;
const CODEDESK_BOOTSTRAP_SESSION_KEY = "codedesk_bootstrap_session_v1";
// This file runs in the browser.  No <script> or HTML tags belong here.

(function loadQRCodeOnce() {
  if (window.QRCode && window.QRCode.CorrectLevel) return; // already loaded

  function use(url, onload) {
    var s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = onload;
    s.onerror = function () {
      // If the first URL fails (your preferred host), fall back to cdnjs
      if (!/cdnjs/.test(url)) {
        use('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', onload);
      } else {
        console.error('Failed to load QRCode library from', url);
      }
    };
    document.head.appendChild(s);
  }

  // TODO: if you have a preferred primary URL, call use('<your primary URL>', function(){ ... });
  // For now, just load from cdnjs directly:
  use('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', function () {
    // QRCode is now available as window.QRCode
  });
})();

// =====================================================
//  ASCEND ENTRY-POINT PARSING (add-only)
//  - Reads lifecycle signals from URL params.
//  - Does NOT change behavior yet; it only records context.
// =====================================================
(function parseEntryPointOnce() {
  const qs = new URLSearchParams(window.location.search || "");

  // Primary lifecycle signals
  const origin = (qs.get("origin") || "").trim(); // e.g. "ascend"
  let mode = (qs.get("mode") || "").trim();       // "new" | "template" (or legacy)
  if (mode === "portal_new") mode = "new";        // normalize legacy portal mode

  // ArtStart always implies a fresh job unless explicitly reopening a working file
  if (!mode && (qs.get("origin") || "").trim() === "artstart") {
    mode = "new";
  }

  const templateId = (qs.get("template_id") || qs.get("templateId") || "").trim();
  const parentAscendJobKey = (qs.get("parent_ascend_job_key") || "").trim();

  // Working-file open path (from hopper)
  const workingFileId = (qs.get("working_file_id") || qs.get("workingFileId") || qs.get("wf") || "").trim();

  // Carry-through identity (may be present when launched from Ascend)
  const token = (qs.get("token") || "").trim();
  const userEmail = (qs.get("user_email") || "").trim();
  const userNameFirst = (qs.get("user_name_first") || "").trim();
  const userNameFull = (qs.get("user_name_full") || "").trim();

  window.CODEDESK_ENTRY = {
    origin: origin || "",
    mode: mode || "",

    // Template path (persistent working-file) context
    template_id: templateId || "",
    parent_ascend_job_key: parentAscendJobKey || "",

    // Working-file open path
    working_file_id: workingFileId || "",

    // Optional identity context
    token: token || "",
    user_email: userEmail || "",
    user_name_first: userNameFirst || "",
    user_name_full: userNameFull || ""
  };
})();

;(async function () {

  // Templates must be function-scoped (used by template mode boot logic)
  var templates = [];

  // Bootstrap signature guard key (add-only fallback; avoids ReferenceError if other modules define later)
  if (!window.CODEDESK_BOOTSTRAP_SESSION_KEY) {
    window.CODEDESK_BOOTSTRAP_SESSION_KEY = 'codedesk_bootstrap_sig_v1';
  }

  // --- Load manifest (with inline fallback) ---
  let manifest;
  // Build a directory-safe base URL so fetches work even if the page URL is missing a trailing slash.
  const __CODEDESK_BASE_URL__ = (function () {
    var p = window.location.pathname || "/";
    // If we are at "/codedesk/index.html", treat it as a file and strip it to the folder.
    if (p && !p.endsWith("/")) {
      var last = p.split("/").pop() || "";
      if (last.indexOf(".") !== -1) {
        // Looks like a filename (e.g., index.html) — remove the last segment
        p = p.slice(0, p.length - last.length);
      } else {
        // Looks like a folder path missing a trailing slash
        p = p + "/";
      }
    }
    if (p && !p.endsWith("/")) p = p + "/";
    return window.location.origin + p;
  })();

  try {
    const manifestUrl = new URL("qr_type_manifest.json", __CODEDESK_BASE_URL__).toString();
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("manifest not found: " + res.status);
    manifest = await res.json();
 } catch (e) {
    console.warn("Manifest load failed, continuing with inline fallback", e);
    // Canonical: types is an object map (not an array)
    manifest = { types: {} };
  }

// --- Load templates (separate from type manifest) ---
templates = [];

try {
  const templatesUrl = new URL("qr_templates.json", __CODEDESK_BASE_URL__).toString();
  const tRes = await fetch(templatesUrl, { cache: "no-store" });
  if (tRes.ok) {
    const tJson = await tRes.json();
    templates = Array.isArray(tJson.templates) ? tJson.templates : [];

    // Canonical invariant: templates MUST carry a ready-to-import state object.
    templates = templates.filter(tpl => {
      const ok = tpl && typeof tpl === 'object' && tpl.id && tpl.state && typeof tpl.state === 'object';
      if (!ok) console.warn('Dropping invalid template (missing id/state):', tpl);
      return ok;
    });
  } else {
    console.warn("Templates fetch returned non-OK:", tRes.status);
  }
} catch (e) {
  console.warn("Template load failed, continuing without templates", e);
}
  // Expose for debugging + Ascend/console introspection
  // IMPORTANT: Do not replace the manifest object if something else captured it.
  // Mutate in place to preserve references across split modules.
  window.manifest = window.manifest || {};
  try { Object.assign(window.manifest, manifest); } catch(_e) { window.manifest = manifest; }

  window.CODEDESK_TEMPLATES = templates;

const _codedeskResolveTemplateById_ = function(id){
  if (!id) return null;
  const want = String(id).trim().toLowerCase();

  const list = Array.isArray(window.CODEDESK_TEMPLATES)
    ? window.CODEDESK_TEMPLATES
    : [];

  return list.find(tpl => {
    if (!tpl) return false;
    if (String(tpl.id || '').toLowerCase() === want) return true;
    if (String(tpl.template_id || '').toLowerCase() === want) return true;
    if (String(tpl.templateId || '').toLowerCase() === want) return true;
    if (String(tpl.name || '').toLowerCase() === want) return true;
    return false;
  }) || null;
};

window.codedeskResolveTemplateById = _codedeskResolveTemplateById_;

// allow other call sites (hopper / bootstrap / apply-by-id) to use it
try {
  if (typeof _codedeskTemplateToState === 'function') {
    window.codedeskTemplateToState = _codedeskTemplateToState;
  }
} catch (e) {}

/**
 * Apply a specific template by ID (used by hopper selection).
 * This bypasses preset cycling entirely.
 */

window.codedeskApplyTemplateById = function codedeskApplyTemplateById(tid) {
  const t = codedeskResolveTemplateById(tid);
  if (!t || !t.state) {
    console.warn('codedeskApplyTemplateById: missing template/state for', tid, t);
    return false;
  }

  // IMPORTANT: template selection must never reuse or reopen a stale working file id.
  // Create a fresh working-file record for this template, then mark it active WITHOUT re-importing.
  const name = (t.type || 'QR') + ' — ' + (t.name || t.id || 'Template');

  // IMPORTANT: selecting a template must NOT create a working file record.
  // It only seeds the live UI so the user can preview, then ✨ creates the working file.
  try {
    window.__CODEDESK_PENDING_TEMPLATE__ = {
      id: String(t.id || '').trim(),
      name: name,
      state: t.state
    };
  } catch(e){}

  // Clear any previously active working file id so Enter cannot upsert anything.
  try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
  try { typeof CODEDESK_ACTIVE_WF_KEY !== 'undefined' && localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY); } catch(e){}
  try { window.CODEDESK_ACTIVE_WORKING_FILE_ID = ''; } catch(e){}
  try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}

  window.CODEDESK_ACTIVE_TEMPLATE_ID = t.id;

  // Apply the template’s saved state to the live UI + preview (guarded import).
  window.__CODEDESK_APPLYING_TEMPLATE__ = true;
  try {
    if (typeof window.okqralImportState === 'function') {
      window.okqralImportState(t.state);
    }
    if (typeof render === 'function') render();
  } finally {
    queueMicrotask(() => { window.__CODEDESK_APPLYING_TEMPLATE__ = false; });
  }

  return true;
};

// force UI refresh now that templates are in memory
try {
  if (typeof render === "function" && window.QRCode && window.QRCode.CorrectLevel) {
    render();
  }
} catch (e) {}
try {
  // If launched from Ascend (new tab/window), ask the opener to refresh hoppers now.
  // This is same-origin (github.io) so it can directly call Ascend functions.
  if (window.opener && !window.opener.closed) {
    if (typeof window.opener.requestCodeDeskTemplates === "function") {
      window.opener.requestCodeDeskTemplates();
    } else if (window.opener.AscendDebug && typeof window.opener.AscendDebug.requestCodeDeskTemplates === "function") {
      window.opener.AscendDebug.requestCodeDeskTemplates();
    } else if (typeof window.opener.renderCodeDeskHopper === "function") {
      window.opener.renderCodeDeskHopper();
    }
  }
} catch (e) {}

  // --- URL bootstrap (idempotent; no polling loops) ---
  // Runs once per page-load (and once per session via sessionStorage key).
  // Uses a microtask so it executes after this script finishes defining functions.
  try {
    queueMicrotask(function codedeskBootstrapFromEntryOnce(){
      // Signature guard is the *only* guard that should matter.
      // The global "__CODEDESK_BOOTSTRAP_DONE__" latch can block legitimate re-entry
      // (e.g., selecting Template 2 after Template 1 in the same tab/session).
      let __sig = '';
      try {
        __sig = [
          String((window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.mode) || '').toLowerCase(),
          String((window.CODEDESK_ENTRY && (window.CODEDESK_ENTRY.template_id || window.CODEDESK_ENTRY.templateId)) || '').trim().toLowerCase(),
          String((window.CODEDESK_ENTRY && (window.CODEDESK_ENTRY.working_file_id || window.CODEDESK_ENTRY.workingFileId)) || '').trim()
        ].join('|');

const __prev = sessionStorage.getItem(CODEDESK_BOOTSTRAP_SESSION_KEY) || '';

        // IMPORTANT: never short-circuit reloads for working-file opens.
        // Otherwise: first refresh works (sig changes once), second refresh skips bootstrap and "purges" state.
        const __wf = String((window.CODEDESK_ENTRY && (window.CODEDESK_ENTRY.working_file_id || window.CODEDESK_ENTRY.workingFileId)) || '').trim();

        if (__prev === __sig && !__wf) return;
        sessionStorage.setItem(CODEDESK_BOOTSTRAP_SESSION_KEY, __sig);
      } catch (e) {}

      const entry = window.CODEDESK_ENTRY || {};
      const mode = String(entry.mode || '').toLowerCase();
      const templateId = String(entry.template_id || entry.templateId || '').trim();
      const wfId = String(entry.working_file_id || entry.workingFileId || '').trim();

      // Canonical rule: non-working entry must not inherit an old active working file.
      if (mode === 'template' || mode === 'new') {
        try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
        try { typeof CODEDESK_ACTIVE_WF_KEY !== 'undefined' && localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY); } catch(e){}
        try { window.CODEDESK_ACTIVE_WORKING_FILE_ID = ''; } catch(e){}
        try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}

        // New/template lifecycle must re-arm the ceremony + prevent autosave until ✨ completes.
        try { window.__CODEDESK_FILENAME_ACCEPTED__ = false; } catch(e){}
        try { window.__CODEDESK_SETUP_DONE__ = false; } catch(e){}
        try { window.__CODEDESK_FINISH_INFLIGHT__ = false; } catch(e){}

        // Defensive: if "New" was clicked while a working_file_id is still in the URL, strip it.
        if (mode === 'new') {
          try {
            const u = new URL(window.location.href);
            u.searchParams.delete('working_file_id');
            u.searchParams.delete('workingFileId');
            u.searchParams.delete('wf');
            window.history.replaceState({}, '', u.toString());
          } catch(e){}
        }
      }

      // 1) Working-file open path wins (hopper open)
      // Treat presence of wfId as authoritative even if `mode` is missing.
      // EXCEPT: mode=new must always force a fresh filename ceremony.
      if (wfId && mode !== 'new' && typeof window.codedeskOpenWorkingFile === 'function') {
        window.codedeskOpenWorkingFile(wfId);
        return;
      }

      // 2) Template path (URL template open) routes through codedeskApplyTemplateById (idempotent)
      if (mode === 'template' && templateId && typeof window.codedeskApplyTemplateById === 'function') {
        window.codedeskApplyTemplateById(templateId);
        return;
      }

      // Nothing to do
    });
  } catch (e) {
    console.warn('CodeDesk URL bootstrap failed (non-fatal)', e);
  }

  // after manifest = ... is set
  // IMPORTANT: Do not overwrite window.manifest (other split files may have captured the object reference).
  // Keep the in-place publish done above via Object.assign(...).
})();