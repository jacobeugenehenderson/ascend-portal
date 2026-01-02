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

  const templateId = (qs.get("template_id") || qs.get("templateId") || "").trim();
  const parentAscendJobKey = (qs.get("parent_ascend_job_key") || "").trim();

  // Working-file open path (from hopper)
  const workingFileId = (qs.get("working_file_id") || qs.get("workingFileId") || "").trim();

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

/* === Wheel scroll (independent, app-level) ============================
   Fix: some wrappers end up "locking" scroll so wheel does nothing.
   Strategy: on wheel, find nearest scrollable ancestor and scroll it.
   (Does not interfere with textareas / inputs / normal page scroll.)
====================================================================== */
(function wireWheelScrollOnce(){
  if (window.__CODEDESK_WHEEL_SCROLL_WIRED__) return;
  window.__CODEDESK_WHEEL_SCROLL_WIRED__ = true;

  function isEditable(el){
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      // allow wheel to behave normally on number inputs too (don’t hijack)
      return true;
    }
    return el.isContentEditable === true;
  }

  function isScrollable(el){
    if (!el || el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    if (!(oy === 'auto' || oy === 'scroll')) return false;
    return el.scrollHeight > el.clientHeight + 1;
  }

  function nearestScrollable(start){
    let el = start;
    while (el && el !== document.body && el !== document.documentElement){
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    // fall back to preview scroller if present
    const main =
      document.querySelector('[data-scroll-root]') ||
      document.getElementById('appScroll') ||
      document.querySelector('.app-scroll') ||
      null;
    if (main && isScrollable(main)) return main;
    return null;
  }

  document.addEventListener('wheel', (e) => {
    // If user is interacting with an editable control, let the browser do its thing.
    if (isEditable(e.target)) return;

    // If the page itself is already scrollable and working, don’t hijack it.
    // Only intervene when we can find an internal scroller to move.
    const scroller = nearestScrollable(e.target);
    if (!scroller) return;

    // If scroller can scroll in the wheel direction, consume and scroll it.
    const dy = e.deltaY || 0;
    if (!dy) return;

    const atTop = scroller.scrollTop <= 0;
    const atBot = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

    if ((dy < 0 && !atTop) || (dy > 0 && !atBot)) {
      e.preventDefault(); // REQUIRED to take control
      scroller.scrollTop += dy;
    }
  }, { passive: false });
})();

  /* === ECC (add-only, session-persistent) ========================== */
const ECC_KEY = 'okqral_ecc';
const ECC_DEFAULT = 'M';

function getECC(){
  const v = sessionStorage.getItem(ECC_KEY);
  return /^[LMQH]$/.test(v) ? v : ECC_DEFAULT;
}

function setECC(val, { trigger = true } = {}){
  const v = (val || '').toUpperCase();
  if (!/^[LMQH]$/.test(v)) return;
  sessionStorage.setItem(ECC_KEY, v);

  // Reflect to pill buttons
  const pill = document.getElementById('eccPill');
  pill?.querySelectorAll('.ecc-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.ecc === v ? 'true' : 'false');
  });

  // Reflect to any select#ecc present (top-bar or hidden)
  const sel = document.getElementById('ecc');
  if (sel && sel.value !== v){
    sel.value = v;
    if (trigger) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Live re-render (non-invasive)
  if (typeof render === 'function') render();
}

function wireECCPill(){
  const pill = document.getElementById('eccPill');
  if (!pill || wireECCPill._done) return;
  pill.querySelectorAll('.ecc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // keep header toggle from swallowing clicks
      setECC(btn.dataset.ecc);
    }, { passive: false });
  });
  setECC(getECC(), { trigger: false });
  wireECCPill._done = true;
}

// Keep legacy/top-bar select alive and in sync (add-only)
function wireECCLegacySelect(){
  const sel = document.getElementById('ecc');
  if (!sel || wireECCLegacySelect._done) return;

  sel.addEventListener('change', () => {
    // Sync from select → pill (no re-emit)
    setECC(sel.value, { trigger: false });
  });

  // Ensure initial mutual sync
  setECC(sel.value || getECC(), { trigger: false });
  wireECCLegacySelect._done = true;
}
/* === END ECC ===================================================== */

/* === Preview Font (session-persistent) ============================ */
const FONT_KEY     = 'okqral_font';
// Store/select by base family name so it matches <option> values.
const FONT_DEFAULT = 'Work Sans';

function normalizeFont(val) {
  if (!val) return FONT_DEFAULT;

  let v = String(val).trim();
  if (!v) return FONT_DEFAULT;

  // Strip outer quotes if present
  if ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }

  // If it's a stack, only keep the first family as our key
  const first = v.split(',')[0].trim();
  return first || FONT_DEFAULT;
}

// === Utility: Font helpers ===
function getPreviewFont() {
  const host = document.getElementById('qrPreview');
  return getComputedStyle(host || document.body).fontFamily;
}

function getFont() {
  const stored = sessionStorage.getItem(FONT_KEY);
  return normalizeFont(stored || FONT_DEFAULT);
}

function setFont(val) {
  const base = normalizeFont(val);
  sessionStorage.setItem(FONT_KEY, base);

  const sel = document.getElementById('fontFamily');
  if (sel) {
    sel.value = base;            // this now matches <option> values
    sel.style.fontFamily = base;
  }

  const preview = document.getElementById('qrPreview');
  if (preview) {
    preview.style.fontFamily = base;
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => typeof render === 'function' && render());
  } else if (typeof render === 'function') {
    render();
  }
}

function wireFontSelect(){
  const sel = document.getElementById('fontFamily');
  if (!sel || wireFontSelect._done) return;

  // Make each option preview in its own face
  Array.from(sel.options).forEach(opt => {
    // each <option> has the full stack as its value
    opt.style.fontFamily = opt.value;
    opt.style.fontWeight = '600'; // keeps visual parity with pills
  });

  // When the user changes the selection, reflect everywhere
  sel.addEventListener('change', () => {
    setFont(sel.value);             // persists + updates preview + value
    sel.style.fontFamily = sel.value; // paint the button in that face
  });

  // Initialize from session or default and paint the control
    const initial = getFont();
  setFont(initial); // setFont will sync select + preview

  wireFontSelect._done = true;
}

    // === Caption placeholders + body auto-size =============================
    function wireCaptionInputs(){
      const head = document.getElementById('campaign');
      const body = document.getElementById('captionBody');
      const HEAD_PH = 'Headline';
      const BODY_PH = 'Body (optional)';

      function syncHead(){
        if (!head) return;
        if (head.value.trim() === '') head.placeholder = HEAD_PH;
      }

      function syncBody(){
        if (!body) return;
        if (body.value.trim() === '') body.placeholder = BODY_PH;

        // rows: 1 by default; grow to 2 only when a second line exists
        const lines = body.value.split('\n').length;
        body.rows = Math.min(2, Math.max(1, lines));
      }

      head && head.addEventListener('input', syncHead);
      body && body.addEventListener('input', syncBody);

      // initialize on load
      syncHead();
      syncBody();
    }

    // === Emoji picker (HTML modal-driven; no fallback) =======================
    function wireEmojiPickerOnce(){
      if (window.__CODEDESK_EMOJI_PICKER_WIRED__) return;
      window.__CODEDESK_EMOJI_PICKER_WIRED__ = true;

      const modal = document.getElementById('emojiModal');
      const grid  = document.getElementById('emojiGrid');
      const search= document.getElementById('emojiSearch');
      const close = document.getElementById('emojiClose');

      if (!modal || !grid || !search || !close) return;

      // Emoji corpus: prefer the full okQRal set if present
      const EMOJIS =
        (typeof EMOJI_BIG !== 'undefined' && Array.isArray(EMOJI_BIG) && EMOJI_BIG.length)
          ? EMOJI_BIG
          : [
              "✨","✅","⚠️","❗","❓","📌","📎","🔗","📣","📢","🧠","💡","🛠️","⚙️","🧾","📄","🗂️","📦","🧩","🧪",
              "🎯","📍","🧭","🗺️","⏱️","⏳","🕒","📅","🗓️","🧷",
              "❤️","🖤","💙","💚","💛","🧡","💜","🤍","🤎","💖",
              "🙂","😎","🤝","🙏","👏","🔥","💥","⭐","🌈","⚡",
              "⬆️","⬇️","➡️","⬅️","↗️","↘️","↙️","↖️","🔼","🔽",
              "➕","➖","✖️","➗","∞","≈","≠","≤","≥",
              "🏳️‍🌈","🏳️‍⚧️"
            ];

      let activeTargetId = '';

      function setActiveTarget(id){
        activeTargetId = String(id || '').trim();
      }

      function openModal(){
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        try { search.focus(); } catch(e){}
      }

      function closeModal(){
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        setActiveTarget('');
      }

      function paint(filterText){
        const q = String(filterText || '').trim().toLowerCase();
        grid.innerHTML = '';

        const list = q
          ? EMOJIS.filter(e => e.toLowerCase().includes(q))
          : EMOJIS;

        list.forEach((emo) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'emoji-btn';
          b.textContent = emo;
          b.setAttribute('aria-label', emo);

          b.addEventListener('click', function(ev){
            try { ev.preventDefault(); } catch(_e){}
            try { ev.stopPropagation(); } catch(_e){}

            if (!activeTargetId) return;
            const inp = document.getElementById(activeTargetId);
            if (!inp) return;

            inp.value = emo;
            inp.dispatchEvent(new Event('input',  { bubbles:true }));
            inp.dispatchEvent(new Event('change', { bubbles:true }));
            try { if (typeof render === 'function') render(); } catch(e){}

            closeModal();
          }, { passive:false });

          grid.appendChild(b);
        });
      }

      // Delegate: any button with data-emoji-target opens modal
      document.addEventListener('click', function(e){
        const btn = e.target && e.target.closest && e.target.closest('button[data-emoji-target]');
        if (!btn) return;

        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}

        const tid = btn.getAttribute('data-emoji-target') || '';
        if (!tid) return;

        setActiveTarget(tid);
        search.value = '';
        paint('');
        openModal();
      }, true);

      // Search
      search.addEventListener('input', function(){
        paint(search.value || '');
      });

      // Close button
      close.addEventListener('click', function(e){
        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}
        closeModal();
      });

      // Click backdrop to close
      modal.addEventListener('click', function(e){
        if (e.target === modal) closeModal();
      });

      // ESC to close
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
      });

      // initial paint (so the grid is ready on first open)
      paint('');
    }

    // run after DOM loads
    (function wireCaptionAndEmojiOnce(){
      if (window.__CODEDESK_CAPTION_EMOJI_WIRED__) return;
      window.__CODEDESK_CAPTION_EMOJI_WIRED__ = true;

      const run = function(){
        try { wireCaptionInputs(); } catch(e){}
        try { wireEmojiPickerOnce(); } catch(e){}
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    })();
    // -------- Scale clickers (delegated; safe across form rebuilds) --------
    function clamp(val, min, max) {
      return Math.min(max, Math.max(min, val));
    }

    if (!window._stepperBound) {
          const __codedeskStepperHandler__ = (e) => {
            const btn = e.target && e.target.closest && e.target.closest('[data-stepper]');
            if (!btn) return;

            // Capture-phase handler: prevent other UI layers from hijacking the interaction.
            try { e.preventDefault(); } catch(_e){}
            try { e.stopPropagation(); } catch(_e){}

            const targetId = btn.getAttribute('data-stepper');
            const delta = parseFloat(btn.getAttribute('data-delta')||'0');

            const input = document.getElementById(targetId);
            if (!input) return;

            const v = parseFloat(input.value||'0') || 0;
            const step = parseFloat(input.step||'0.05') || 0.05;
            const min = parseFloat(input.min||'0.1') || 0.1;
            const max = parseFloat(input.max||'1') || 1;

            const next = clamp((Math.round((v + (delta||step))*100)/100), min, max);
            input.value = next.toFixed(2);
            input.dispatchEvent(new Event('input', {bubbles:true}));
          };

          // IMPORTANT: use capture so narrow-mode accordion/tap handlers can't swallow it.
          document.addEventListener('click', __codedeskStepperHandler__, true);

          window._stepperBound = true;
        }

;(async function () {

  // Templates must be function-scoped (used by template mode boot logic)
  var templates = [];

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
    manifest = { types: [] };
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
try { if (typeof render === "function") render(); } catch (e) {}
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
        if (__prev === __sig) return;
        sessionStorage.setItem(CODEDESK_BOOTSTRAP_SESSION_KEY, __sig);
      } catch (e) {}

      const entry = window.CODEDESK_ENTRY || {};
      const mode = String(entry.mode || '').toLowerCase();
      const templateId = String(entry.template_id || entry.templateId || '').trim();
      const wfId = String(entry.working_file_id || entry.workingFileId || '').trim();

      // Canonical rule: non-working entry must not inherit an old active working file.
      if (mode === 'template' || mode === 'new') {
        try { localStorage.removeItem('codedesk_active_working_file_v1'); } catch(e){}
        try { window.__CODEDESK_CURRENT_WF_ID__ = ''; } catch(e){}
}

      // 1) Working-file open path wins (hopper open)
      // Treat presence of wfId as authoritative even if `mode` is missing.
      if (wfId && typeof window.codedeskOpenWorkingFile === 'function') {
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
window.manifest = manifest;

// --- BACKGROUND GRADIENT + STROKE HANDLERS ---
// Helpers for converting and painting background
function _hexToRGBA(hex, a = 1) {
  const h = (hex || '#ffffff').replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function _bgGradientFromKnobs() {
  const top = document.getElementById('bgTopColor')?.value || '#FFFFFF';
  const bot = document.getElementById('bgBottomColor')?.value || '#FFFFFF';

  // IMPORTANT: do NOT use `|| 100` here; 0 is a valid value.
  const topRaw = parseFloat(document.getElementById('bgTopAlpha')?.value);
  const botRaw = parseFloat(document.getElementById('bgBottomAlpha')?.value);
  const ta = (Number.isFinite(topRaw) ? topRaw : 100) / 100;
  const ba = (Number.isFinite(botRaw) ? botRaw : 100) / 100;

  const preview = document.getElementById('qrPreview');
if (preview) {
  const isTransparent = ta === 0 && ba === 0;
  preview.classList.toggle('is-transparent', isTransparent);
}

  // Solid when both colors+alphas match closely; otherwise gradient
  const tHex = String(top || '#FFFFFF').trim();
  const bHex = String(bot || '#FFFFFF').trim();
  if (tHex.toLowerCase() === bHex.toLowerCase() && Math.abs(ta - ba) < 0.001) {
    return _hexToRGBA(tHex, ta);
  }
  return `linear-gradient(180deg, ${_hexToRGBA(tHex, ta)} 0%, ${_hexToRGBA(bHex, ba)} 100%)`;
}

function updatePreviewBackground() {
  const card = document.getElementById('qrPreview');
  if (!card) return;
  const g = _bgGradientFromKnobs();

  // Paint BOTH vars: some skins use --bg-paint, some older code uses --frame-bg.
  card.style.setProperty('--bg-paint', g);
  card.style.setProperty('--frame-bg', g);
}

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
  updatePreviewBackground();
};

// Live re-paint when user moves any background knob
// Also: default-link top/bottom (alpha + color), and prevent 0% → 100% snapback
let _bg_knobs_wired = false;
function wireBackgroundKnobsOnce() {
  if (_bg_knobs_wired) return;

  const topColor = document.getElementById('bgTopColor');
  const botColor = document.getElementById('bgBottomColor');
  const topHex   = document.getElementById('bgTopHex');
  const botHex   = document.getElementById('bgBottomHex');

  const topA = document.getElementById('bgTopAlpha');
  const botA = document.getElementById('bgBottomAlpha');

  // Numeric alpha inputs are not adjacent anymore (layout moved).
  const topANum = document.getElementById('bgTopAlphaNum');
  const botANum = document.getElementById('bgBottomAlphaNum');

  const LINK_KEY = 'codedesk_bg_link_v1';

  function clampPct(v, fallback) {
    // IMPORTANT: do NOT coerce '' (empty) to 100 — that's the snapback bug.
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function isLinked() {
    const raw = (() => { try { return localStorage.getItem(LINK_KEY); } catch (_) { return null; } })();
    // default: linked ON
    if (raw === null) return true;
    return raw === '1';
  }

  function setLinked(on) {
  try { localStorage.setItem(LINK_KEY, on ? '1' : '0'); } catch (_) {}
  const btn = document.getElementById('bgLink');
  if (btn) {
    // Coupling metaphor (not locking):
    // linked = 🔗, unlinked = broken chain
    btn.textContent = on ? '🔗' : '⛓️‍💥';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('title', on ? 'Background linked' : 'Background unlinked');
    btn.setAttribute('aria-label', on ? 'Background linked' : 'Background unlinked');
    btn.classList.toggle('is-on', !!on);
  }
}

  // Optional: if you later add a link icon with id="bgLink", this will toggle it.
  (function wireLinkButtonOnce() {
    const btn = document.getElementById('bgLink');
    if (!btn || btn.__bg_link_wired) return;
    btn.__bg_link_wired = true;
    btn.addEventListener('click', () => setLinked(!isLinked()));
    // init state
    setLinked(isLinked());
  })();

  function syncAlpha(from /* 'top' | 'bot' */) {
    if (!topA || !botA) return;

    const t = clampPct(topA.value, 100);
    const b = clampPct(botA.value, 100);

    const v = (from === 'top') ? t : b;

    // Always normalize the driver side
    if (from === 'top') topA.value = String(v);
    if (from === 'bot') botA.value = String(v);

    if (topANum && topANum.tagName === 'INPUT') topANum.value = String(clampPct(topA.value, v));
    if (botANum && botANum.tagName === 'INPUT') botANum.value = String(clampPct(botA.value, v));

    // If linked, mirror to the other side
    if (isLinked()) {
      if (from === 'top') {
        botA.value = String(v);
        if (botANum && botANum.tagName === 'INPUT') botANum.value = String(v);
      } else {
        topA.value = String(v);
        if (topANum && topANum.tagName === 'INPUT') topANum.value = String(v);
      }
    }
  }

  function syncColor(from /* 'top' | 'bot' */) {
    if (!isLinked()) return;

    // Prefer hex fields as canonical if they exist; otherwise use the color pickers.
    if (from === 'top') {
      const h = (topHex && typeof topHex.value === 'string' && topHex.value.trim())
        ? topHex.value.trim()
        : (topColor && typeof topColor.value === 'string' ? topColor.value : '');
      if (h) {
        if (botHex)   botHex.value   = h;
        if (botColor) botColor.value = h;
      }
    } else {
      const h = (botHex && typeof botHex.value === 'string' && botHex.value.trim())
        ? botHex.value.trim()
        : (botColor && typeof botColor.value === 'string' ? botColor.value : '');
      if (h) {
        if (topHex)   topHex.value   = h;
        if (topColor) topColor.value = h;
      }
    }
  }

  function repaint() {
    if (typeof window.refreshBackground === 'function') window.refreshBackground();
    if (typeof window.render === 'function') requestAnimationFrame(window.render);
  }

  // ---- Kill inline oninput snapback by intercepting at capture phase ----
  if (topA) {
    topA.addEventListener('input', (e) => {
      e.stopImmediatePropagation();
      syncAlpha('top');
      repaint();
    }, true);
  }
  if (botA) {
    botA.addEventListener('input', (e) => {
      e.stopImmediatePropagation();
      syncAlpha('bot');
      repaint();
    }, true);
  }

  if (topANum && topANum.tagName === 'INPUT') {
    topANum.addEventListener('input', (e) => {
      e.stopImmediatePropagation();
      // ignore empty transient states (do not force defaults)
      if (topANum.value === '') return;
      const v = clampPct(topANum.value, clampPct(topA ? topA.value : 100, 100));
      if (topA) topA.value = String(v);
      topANum.value = String(v);
      syncAlpha('top');
      repaint();
    }, true);
  }

  if (botANum && botANum.tagName === 'INPUT') {
    botANum.addEventListener('input', (e) => {
      e.stopImmediatePropagation();
      if (botANum.value === '') return;
      const v = clampPct(botANum.value, clampPct(botA ? botA.value : 100, 100));
      if (botA) botA.value = String(v);
      botANum.value = String(v);
      syncAlpha('bot');
      repaint();
    }, true);
  }

  // Colors / hex
  if (topColor) topColor.addEventListener('input', () => { syncColor('top'); repaint(); });
  if (botColor) botColor.addEventListener('input', () => { syncColor('bot'); repaint(); });
  if (topHex)   topHex.addEventListener('input',   () => { syncColor('top'); repaint(); });
  if (botHex)   botHex.addEventListener('input',   () => { syncColor('bot'); repaint(); });

  // If you *don't* add a link icon yet, this keeps behavior linked by default.
  setLinked(isLinked());

  // Initial paint/class gating
  try { repaint(); } catch (e) {}

  _bg_knobs_wired = true;
}

try { wireBackgroundKnobsOnce(); } catch (e) {}

// optional helpers (put them right here too)
window.getTypeFields = (t) => {
  const root = (manifest.types && typeof manifest.types === 'object')
              ? manifest.types
              : manifest;
  const want = String(t || '').trim().toLowerCase();
  const key  = Object.keys(root).find(k => k.toLowerCase() === want) || t;
  return root[key] || [];
};

window.getPresets = (t) => {
  const want = String(t || "").trim().toLowerCase();

  // Defensive: presets may not exist in template-first builds
  const safePresets = (manifest && typeof manifest.presets === 'object')
  ? manifest.presets
  : {};

  // IMPORTANT:
  // Templates are *not* presets. They are hydrated explicitly (hopper / URL template_id).
  // getPresets() must return only legacy presets unless you deliberately opt-in.
  const templates = [];
  if (templates.length) {
    // If templates carry a type field, return only matches for the current type.
    const byType = templates.filter((p) => {
      const ty = (p.qrType || p.qr_type || p.type || "").toString().trim().toLowerCase();
      return ty && ty === want;
    });
    if (byType.length) return byType;

        // If the type doesn't match any template, return empty (don't "show something" incorrectly).
    return [];
  }

  // Fallback: legacy presets from the manifest
  const key = Object.keys(safePresets).find((k) => k.toLowerCase() === want) || t;
  return safePresets[key] || [];
};

 /* ====================================================================     
 * Purpose:
 *  - Provide a stable JSON "state" format that Ascend (later) can create/open.
 *  - Provide localStorage persistence so CodeDesk can keep editable templates.
 *
 * Additions in this patch:
 *  - Track “active working file” id (so saves are idempotent)
 *  - Quiet autosave (debounced)
 *  - “Finish” button becomes “Finish setup” + re-click updates same file
 * ==================================================================== */

const CODEDESK_STORE_KEY = 'codedesk_working_files_v1';

// Active working file pointer (so we can save “the same file” repeatedly)
const CODEDESK_ACTIVE_WF_KEY = 'codedesk_active_working_file_v1';

// Autosave tuning
const CODEDESK_AUTOSAVE_DEBOUNCE_MS = 900;

function safeId(id){ return typeof id === 'string' && id.trim() ? id.trim() : ''; }

function _getValueById(id){
  const el = document.getElementById(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return !!el.checked;
  return (el.value ?? '');
}

function _setValueById(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox'){
    el.checked = !!value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.value = String(value ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function val(id){
  const v = _getValueById(id);
  return (v == null) ? '' : v;
}

// The canonical list of "style knobs" (IDs that already exist in your file below)
const CODEDESK_STYLE_IDS = [
  'fontFamily',
  'campaign','captionBody',

  'captionColor','bodyColor',
  'eyeRingColor','eyeCenterColor',

  'bgTransparent','bgTopHex','bgBottomHex','bgTopAlpha','bgBottomAlpha',

  'moduleShape','eyeRingShape','eyeCenterShape',

  'modulesMode','modulesEmoji','modulesScale',
  'centerMode','centerEmoji','centerScale'
];

// Build a stable export payload (safe if some IDs don’t exist in DOM)
window.okqralExportState = function okqralExportState(){
  const payload = { v: 1, at: Date.now(), fields: {}, style: {} };

  // Type + subtype index are useful for CodeDesk “template provenance”
  const typeSel = document.getElementById('qrType');
  payload.type = typeSel ? (typeSel.value || '') : '';

  // Export “detailsPanel” inputs by scanning ids in the panel (type-specific fields)
  const details = document.getElementById('detailsPanel');
  if (details){
    details.querySelectorAll('input[id],select[id],textarea[id]').forEach(n => {
      const id = safeId(n.id);
      if (!id) return;
      payload.fields[id] = _getValueById(id);
    });
  }

  // Export known style knobs
  CODEDESK_STYLE_IDS.forEach(id => {
    payload.style[id] = _getValueById(id);
  });

  // Persist ECC + font session keys if present
  try { payload.ecc  = sessionStorage.getItem('okqral_ecc')  || undefined; } catch(e){}
  try { payload.font = sessionStorage.getItem('okqral_font') || undefined; } catch(e){}

  return payload;
};

// Import a previously exported state blob
window.okqralImportState = function okqralImportState(state){
  if (!state || typeof state !== 'object') return false;

  // ------------------------------------------------------------------
  // Global import guard:
  // Any import (template OR working-file open) must suppress applyPreset().
  // ------------------------------------------------------------------
  window.__CODEDESK_IMPORTING_STATE__ = true;

  try {
    // 1) Switch type (rebuilds the form via existing listener)
    const typeSel = document.getElementById('qrType');
    if (typeSel && state.type) {
      const desired = String(state.type).toLowerCase();
      let match = null;

      for (const opt of Array.from(typeSel.options || [])) {
        if (String(opt.value).toLowerCase() === desired) { match = opt.value; break; }
      }

      if (match && typeSel.value !== match) {
        typeSel.value = match;
        typeSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2) Restore type-specific fields (after rebuild)
    const fields = state.fields || {};
    Object.keys(fields).forEach(id => _setValueById(id, fields[id]));

    // 3) Restore style knobs (with legacy key aliases + hex/color pairing)
    const style = Object.assign({}, state.style || {});

    // Legacy aliases (older templates / older HTML variants)
    if (style.bgTopColor && !style.bgTopHex) style.bgTopHex = style.bgTopColor;
    if (style.bgBottomColor && !style.bgBottomHex) style.bgBottomHex = style.bgBottomColor;
    if (style.bgTopHex && !style.bgTopColor) style.bgTopColor = style.bgTopHex;
    if (style.bgBottomHex && !style.bgBottomColor) style.bgBottomColor = style.bgBottomHex;

    const _setStyleKnob = (id, val) => {
      _setValueById(id, val);

      // Keep paired Hex/Color inputs in lockstep.
      // Programmatic .value assignments do NOT fire input events,
      // and your colorHex() prefers Hex when present.
      if (/Color$/.test(id)) _setValueById(id.replace(/Color$/, 'Hex'), val);
      if (/Hex$/.test(id))   _setValueById(id.replace(/Hex$/,   'Color'), val);
    };

    Object.keys(style).forEach(id => _setStyleKnob(id, style[id]));

    // Re-apply gating AFTER import so disabled/enabled states match the imported values
    try { typeof refreshBackground === 'function' && refreshBackground(); } catch(e){}
    try { typeof refreshModulesMode === 'function' && refreshModulesMode(); } catch(e){}
    try { typeof refreshCenter === 'function' && refreshCenter(); } catch(e){}

  // 4) Restore ECC + font session if present (non-fatal)
  try {
    if (state.ecc && typeof setECC === 'function') setECC(state.ecc, { trigger: true });
  } catch(e){}
  try {
    if (state.font && typeof setFont === 'function') setFont(state.font);
  } catch(e){}

    // 5) Repaint background + re-render (safe)
    try { typeof window.refreshBackground === 'function' && window.refreshBackground(); } catch(e){}
    try { typeof render === 'function' && render(); } catch(e){}

    return true;
  } finally {
    // Release after all import-triggered handlers have run
    queueMicrotask(() => { window.__CODEDESK_IMPORTING_STATE__ = false; });
  }
};

// Local working-file registry: { id, name, createdAt, updatedAt, state, finishedAt, fileroom }
function _readWorkingFiles(){
  try {
    const raw = localStorage.getItem(CODEDESK_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch(e){
    return [];
  }
}

function _writeWorkingFiles(arr){
  try { localStorage.setItem(CODEDESK_STORE_KEY, JSON.stringify(arr || [])); } catch(e){}
}

function codedeskNotifyAscendWorkingSave(rec){
  // Best-effort ping so Ascend can refresh its hopper UI (same-origin only).
  try { localStorage.setItem('ascend_codedesk_hopper_ping_v1', String(Date.now())); } catch(e){}
  try {
    // If CodeDesk was opened from Ascend, ask the opener to refresh immediately.
    if (window.opener && typeof window.opener.refreshHopper === 'function') {
      window.opener.refreshHopper();
    }
  } catch(e){}
  return rec;
}

function _getActiveWorkingFileId(){
  try { return String(localStorage.getItem(CODEDESK_ACTIVE_WF_KEY) || '').trim(); } catch(e){ return ''; }
}
function _setActiveWorkingFileId(id){
  try {
    const v = String(id || '').trim();
    if (v) localStorage.setItem(CODEDESK_ACTIVE_WF_KEY, v);
  } catch(e){}
}

function _getWorkingFileRecordById(id){
  const files = _readWorkingFiles();
  return files.find(f => String(f.id || '') === String(id || '')) || null;
}

function _upsertWorkingFileRecord(rec){
  if (!rec || !rec.id) return null;

  const now = Date.now();
  const files = _readWorkingFiles();
  const idx = files.findIndex(f => f.id === rec.id);

  const prev = (idx >= 0) ? files[idx] : null;

  const next = Object.assign({}, prev || {}, rec);

  // Always keep CreatedAt stable once created
  next.createdAt = prev ? prev.createdAt : (rec.createdAt || now);
  next.updatedAt = rec.updatedAt || now;

  if (idx >= 0) files[idx] = next;
  else files.unshift(next);

  _writeWorkingFiles(files);
  _setActiveWorkingFileId(next.id);

  // Keep a session-visible pointer for Finish/Autosave
  try { window.__CODEDESK_CURRENT_WF_ID__ = String(next.id || '').trim(); } catch(e){}

  return next;
}

window.codedeskGetActiveWorkingFileId = function codedeskGetActiveWorkingFileId(){
  return _getActiveWorkingFileId();
};

window.codedeskGetWorkingFileRecord = function codedeskGetWorkingFileRecord(id){
  return _getWorkingFileRecordById(id);
};

window.codedeskListWorkingFiles = function codedeskListWorkingFiles(){
  return _readWorkingFiles().map(x => ({
    id: x.id, name: x.name, createdAt: x.createdAt, updatedAt: x.updatedAt
  }));
};

// Save (create-or-update).
// Supports BOTH call shapes:
//   codedeskSaveWorkingFile(name, {id})
//   codedeskSaveWorkingFile(recObjectWithIdAndOptionalFileroomEtc)
window.codedeskSaveWorkingFile = function codedeskSaveWorkingFile(a, b){
  // Object form: codedeskSaveWorkingFile(rec)
  if (a && typeof a === 'object' && a.id) {
    // Always refresh the serialized state unless explicitly provided
    if (!('state' in a)) {
      try { a.state = window.okqralExportState(); } catch(e){}
    }

    const out = _upsertWorkingFileRecord(a);

    // Notify Ascend (optional): keep orange working file + FileRoom PNG linked
    try { codedeskNotifyAscendWorkingSave(out); } catch(e){}

    return (out || {}).id || '';
  }

  // Name + id form: codedeskSaveWorkingFile(name, {id})
  const name = a;
  const opts = b || {};
  const now = Date.now();

  const __aid = _getActiveWorkingFileId();
  const nextId =
    (opts && opts.id) ||
    ((__aid && _getWorkingFileRecordById(__aid)) ? __aid : null) ||
    ('wf_' + now + '_' + Math.random().toString(16).slice(2));

  const state = window.okqralExportState();

  const prev = _getWorkingFileRecordById(nextId);

  const rec = {
    id: nextId,

    // Marker fields for hopper UI (CSS-only differentiation on the Ascend side)
    kind: (prev && prev.kind) ? prev.kind : 'working',
    indicator: (prev && prev.indicator) ? prev.indicator : 'working_orange_stack',

    name: String(name || (prev && prev.name) || 'Untitled working file').trim() || 'Untitled working file',
    state: state,
    createdAt: (prev ? prev.createdAt : now),
    updatedAt: now
  };

  const out = _upsertWorkingFileRecord(rec);

  // Notify Ascend (optional): keep orange working file + FileRoom PNG linked
  try { codedeskNotifyAscendWorkingSave(out); } catch(e){}

  return rec.id;
};

window.codedeskOpenWorkingFile = function codedeskOpenWorkingFile(id){
  const rec = _getWorkingFileRecordById(id);
  if (!rec || !rec.state) return false;

  _setActiveWorkingFileId(rec.id);
  try { window.__CODEDESK_CURRENT_WF_ID__ = String(rec.id || '').trim(); } catch(e){}

  const ok = window.okqralImportState(rec.state);

  // Opening an existing WORKING file from the hopper implies:
  // - setup is already done (autosave allowed)
  // - filename ceremony is already satisfied (UI unlocked + push allowed)
  try { window.__CODEDESK_SETUP_DONE__ = true; } catch(e){}
  try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(e){}

  // Populate the filename input from the working-file record name (and keep it editable)
  try {
    const inp = document.getElementById('codedeskFilename');
    if (inp) {
      inp.value = String(rec.name || '').trim();
      inp.disabled = false;
      inp.removeAttribute('disabled');
      inp.style.pointerEvents = 'auto';
    }
  } catch(e){}

  // Unlock the accordion / interactive UI and keep ✨ hidden for existing working files
  try { typeof codedeskRefreshFilenameGate === 'function' && codedeskRefreshFilenameGate(); } catch(e){}
  try { typeof codedeskSetSetupSparkleVisible === 'function' && codedeskSetSetupSparkleVisible(false); } catch(e){}

  // Ensure the WORKFILE row stays fresh in Ascend even if no prior FileRoom pairing exists
  try {
    setTimeout(() => { try { window.codedeskPushWorkingDebounced && window.codedeskPushWorkingDebounced('open'); } catch(e){} }, 250);
  } catch(e){}

  // If this working file has been Finished before, opening it should trigger an update.
  // Debounced so the first render settles.
  try {
    if (rec && rec.fileroom && rec.fileroom.drive_file_id) {
      setTimeout(() => { try { window.codedeskSyncFileRoomDebounced && window.codedeskSyncFileRoomDebounced('open'); } catch(e){} }, 250);
    }
  } catch(e){}

  return ok;
};

window.codedeskDeleteWorkingFile = function codedeskDeleteWorkingFile(id){
  const files = _readWorkingFiles().filter(f => f.id !== id);
  _writeWorkingFiles(files);
  try {
    if (_getActiveWorkingFileId() === String(id || '').trim()) {
      localStorage.removeItem(CODEDESK_ACTIVE_WF_KEY);
      window.__CODEDESK_CURRENT_WF_ID__ = '';
    }
  } catch(e){}
  return true;
};

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

async function codedeskPngDataUrlFromCurrentSvg(scale = 3) {
  const src = getCurrentSvgNode();
  if (!src) return '';

  const svg = src.cloneNode(true);
  applyPhoneBackgroundForExport(svg);    // inject here before serialization

  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));

  const img = new Image();

  // important for SVG-in-canvas
  img.crossOrigin = 'anonymous';

  await new Promise(res => { img.onload = res; img.src = url; });

  const w = img.naturalWidth  || parseInt(svg.getAttribute('width'))  || 512;
  const h = img.naturalHeight || parseInt(svg.getAttribute('height')) || 512;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext('2d');

    // Match preview background (gradient vs transparent) before drawing SVG
  // “Transparent mode” is purely: both alphas are 0
  const topA   = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
  const botA   = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);
  const transparent = (topA <= 0 && botA <= 0);

  if (!transparent) {
    // Read the same knobs used by updatePreviewBackground()
    const topHex = document.getElementById('bgTopHex')?.value
                || document.getElementById('bgTopColor')?.value || '#FFFFFF';
    const botHex = document.getElementById('bgBottomHex')?.value
                || document.getElementById('bgBottomColor')?.value || '#FFFFFF';
    const topA   = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
    const botA   = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);

    // Convert hex + alpha → rgba
    const rgba = (hex, aPct) => {
      let h = String(hex || '#FFFFFF').trim();
      if (!h) h = '#FFFFFF';
      if (h[0] !== '#') h = '#' + h;
      const m3 = /^#([0-9a-fA-F]{3})$/.exec(h);
      if (m3) {
        h = '#' + m3[1].split('').map(c => c + c).join('');
      }
      const m6 = /^#([0-9a-fA-F]{6})$/.exec(h);
      const v = m6 ? m6[1] : 'FFFFFF';
      const r = parseInt(v.slice(0,2),16);
      const g = parseInt(v.slice(2,4),16);
      const b = parseInt(v.slice(4,6),16);
      const a = Math.max(0, Math.min(1, (Number(aPct) || 0) / 100));
      return `rgba(${r},${g},${b},${a})`;
    };

    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, rgba(topHex, topA));
    g.addColorStop(1, rgba(botHex, botA));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    // fully transparent background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  URL.revokeObjectURL(url);

  return canvas.toDataURL('image/png');
}

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

window.codedeskSyncFileRoomNow = async function codedeskSyncFileRoomNow(reason){
  const workingId = String(window.__CODEDESK_CURRENT_WF_ID__ || _getActiveWorkingFileId() || '').trim();
  if (!workingId) return false;

  const rec = window.codedeskGetWorkingFileRecord && window.codedeskGetWorkingFileRecord(workingId);
  if (!rec) return false;

  const folderId = String(window.CODEDESK_FILEROOM_FOLDER_ID || '').trim();
  if (!folderId) return false;

  const svgNode = (typeof getCurrentSvgNode === 'function') ? getCurrentSvgNode() : null;
  if (!svgNode) return false;

  // --- Canonical state blob (includes all styling knobs) ---
  let stateObj = null;
  try { stateObj = (rec && rec.state) ? rec.state : (window.okqralExportState ? window.okqralExportState() : null); } catch(e){}
  let stateJson = '';
  try { stateJson = (typeof stateObj === 'string') ? stateObj : JSON.stringify(stateObj || {}); } catch(e){ stateJson = ''; }

  // OpenUrl (best-effort): allow Ascend to “open this working state”
  let workingOpenUrl = '';
  try {
    const u = new URL(location.href);
    // Ensure we have a stable id param if you later choose to add one
    u.searchParams.set('wf', workingId); // legacy alias
    workingOpenUrl = u.toString();
  } catch (e) {}

  const caption =
    String(document.getElementById('codedeskFilename')?.value || '').trim() ||
    String(document.getElementById('campaign')?.value || '').trim() ||
    String(rec.name || '').trim() ||
    'codedesk';
  const base = caption.replace(/[^\w\d-_]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'codedesk';
  const fileName = `${base}.png`;

  const ownerEmail = ((window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.user_email) ? window.CODEDESK_ENTRY.user_email : '') || getCurrentUserEmail_();
  const templateId = (rec && (rec.template_id || rec.templateId)) ? String(rec.template_id || rec.templateId) : '';

  // DestinationUrl: canonical QR payload (includes Mechanical knobs like UTM)
  let destinationUrl = '';
  try { destinationUrl = (typeof buildText === 'function') ? String(buildText() || '') : ''; } catch(e){ destinationUrl = ''; }



  // 2) Upload PNG to Drive + upsert delivered row
  try {
    const pngDataUrl = await codedeskPngDataUrlFromCurrentSvg(3);
    if (pngDataUrl) {
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
        const workingKey = String((data && data.working_ascend_job_key) ? data.working_ascend_job_key : ('CODEDESK_WF:' + workingId)).trim();

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
        await fetch(window.CODEDESK_FILEROOM_API_BASE, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'upsertJob',
            ascend_job_key: 'CODEDESK_WF:' + workingId,
            app: 'codedesk',
            source_id: workingId,
            title: base || 'CODEDESK QR',
            subtitle: 'CODEDESK — WORKING FILE',
            status: 'open',
            open_url: workingOpenUrl || String(location && location.href ? location.href : ''),
            owner_email: ownerEmail,
            kind: 'working',
            asset_type: 'working',
            template_id: templateId,
            destination_url: destinationUrl,
            state_json: stateJson,
            tags: 'codedesk,workfile'
          })
        });
      } catch(e){}
    }
  } catch(e){}

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
};

window.codedeskSyncFileRoomDebounced = function codedeskSyncFileRoomDebounced(reason){

  // Compatibility alias: "debounced FileRoom sync" now means a lightweight push (NO PNG).
  if (_codedeskFileRoomTimer) clearTimeout(_codedeskFileRoomTimer);
  _codedeskFileRoomTimer = setTimeout(() => {
    try { window.codedeskPushWorkingNow && window.codedeskPushWorkingNow(reason || 'debounced'); } catch(e){}
  }, CODEDESK_AUTOSAVE_DEBOUNCE_MS);
};

function codedeskAutosaveKick(){
  // HARD GATE: autosave/push is only allowed after ✨ (Finish setup).
  if (window.__CODEDESK_SETUP_DONE__ !== true) return;

  let activeId = _getActiveWorkingFileId();

  // Canonical rule: autosave never creates working files.
  // Working files are created only by explicit Finish.
  if (!activeId) return;

  if (!activeId) return; // still nothing to autosave (should be rare)

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

  // ✨ has created/confirmed the working file: autosave/push is now allowed.
  try { window.__CODEDESK_SETUP_DONE__ = true; } catch(e){}

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

    // Filename input must always be editable if it exists
    inp.disabled = false;
    inp.removeAttribute('disabled');
    inp.style.pointerEvents = 'auto';
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

  // initial relabel pass
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

    // Keep filename editable at all times
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
      }

      // Lock/unlock the rest of the UI strictly by accepted flag
      codedeskSetLocked(!accepted);

      // Setup (✨) is only relevant before a working file exists
      codedeskSetSetupSparkleVisible(accepted && !hasWf);
    } catch(e){
      // Fall back to original behavior if anything above fails
      codedeskSetLocked(!accepted);
      try { codedeskSetSetupSparkleVisible(false); } catch(_e){}
    }

    syncFinishEnabled();
  }

  function codedeskSetSetupSparkleVisible(visible){
    // The setup affordance is the Finish/Setup action button (icon-only ✨ in the UI).
    // Hide it on load; reveal it only after Enter accepts the filename; remove it forever after setup.
    try {
      document.querySelectorAll('button').forEach((b) => {
        if (!isFinishButton(b)) return;
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

    // Also remove any remaining setup action button (✨) in case it is not inside the stepper.
    try {
      document.querySelectorAll('button').forEach((b) => { if (isFinishButton(b)) b.remove(); });
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

        if (hasWf0 && fname0) {
          try { window.__CODEDESK_FILENAME_ACCEPTED__ = true; } catch(_e){}
        }
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
      inp.addEventListener('keydown', function(e){
        if (!e) return;
        const isEnter = (e.key === 'Enter' || e.keyCode === 13);
        if (!isEnter) return;

        try { e.preventDefault(); } catch(_e){}
        try { e.stopPropagation(); } catch(_e){}

        const fname = String(inp.value || '').trim();
        if (!fname) return;

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
      }, true);

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
  if (!isFinishButton(btn)) return;

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
    if (prevText.length > 2) btn.textContent = 'Working…';

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

    // Keep filename editable (live label) — do NOT hide or freeze it
    try { ensureFilenameUi && ensureFilenameUi(); } catch(e){}
  } finally {
    try { window.__CODEDESK_FINISH_INFLIGHT__ = false; } catch(e){}
  }
}, true);

})();

/* === END CODEDESK WORKING FILES ===================================== */

  // --- helpers to create inputs ---
  function el(tag, props={}, children=[]){
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k,v])=>{
      if(k==='class') n.className = v;
      else if(k==='text') n.textContent = v;
      else if(k==='html') n.innerHTML = v;
      else if(v!==undefined && v!==null) n.setAttribute(k, v);
    });
    (Array.isArray(children)?children:[children]).forEach(c => { if(c) n.appendChild(c); });
    return n;
  }

  function buildField(id){
  const meta = (window.manifest?.fields || {})[id];
  if (!meta) { console.warn('No field meta for', id); return null; }
    const wrap = el('label', {class:'text-sm block'});
    const title = el('span', {class:'block mb-1', text: meta.label});
    let input;

    if(meta.type === 'select'){
      input = el('select', {id: id, class:'w-full rounded-md border px-3 py-2'});
      (meta.options||[]).forEach(opt => input.appendChild(el('option', {text: opt})));
    } else if(meta.type === 'checkbox'){
      // Inline checkbox layout
      const row = el('label', {class:'inline-flex items-center gap-2'});
      const cb  = el('input', {id:id, type:'checkbox', class:'rounded border'});
      row.appendChild(cb);
      row.appendChild(el('span', {class:'text-sm', text: meta.label}));
      return row; // checkbox returns its own row and skips "title"
    } else if(meta.type === 'textarea'){
      input = el('textarea', {id:id, rows: String(meta.rows||2), class:'w-full rounded-md border px-3 py-2'});
      if(meta.placeholder) input.setAttribute('placeholder', meta.placeholder);
    } else {
      // text / email / number / url
      input = el('input', {id:id, type: meta.type||'text', class:'w-full rounded-md border px-3 py-2'});
      if(meta.placeholder) input.setAttribute('placeholder', meta.placeholder);
      if(meta.step)        input.setAttribute('step', meta.step);
    }

    wrap.appendChild(title);
    wrap.appendChild(input);
    return wrap;
  }

  // --- render the form for a given Type ---
  const typeSel = document.getElementById('qrType');
  const details = document.getElementById('detailsPanel');

  function renderTypeForm(type){
    details.innerHTML = '';
    const ids = getTypeFields(type);
    console.log('renderTypeForm:', type, ids);
    
    if (!ids.length) {
      console.warn('[qr] Unknown type for manifest:', type);
      return;
    }

    // NOTE: do not wire global listeners here.
    // renderTypeForm() can be called many times; wiring belongs in a one-time init()
    // (or must be delegated / individually guarded per element).

    const frag = document.createDocumentFragment();

    // Simple heuristic grouping for prettier layout
    const grid = el('div', {class:'grid gap-3'});
    ids.forEach(fid => {
      grid.appendChild(buildField(fid));
    });
    frag.appendChild(grid);
    details.appendChild(frag);
    window.reflowStepper && window.reflowStepper();
  }

    // Wire type-specific behaviors

    // Type change = rebuild the type fields, then re-wire dynamic controls, then render.
typeSel.addEventListener('change', () => {
  const t = typeSel.value;

  // 1) rebuild the form for this type
  renderTypeForm(t);

  // 2) re-wire dynamic controls created by the rebuild (must be idempotent)
  if (typeof wireColorHexSync === 'function') wireColorHexSync();
  if (typeof wireSteppers === 'function') wireSteppers();
  if (typeof wireEmojiModal === 'function') wireEmojiModal();
  if (typeof wireECCPill === 'function') wireECCPill();
  if (typeof wireECCLegacySelect === 'function') wireECCLegacySelect();

  // 3) refresh + render using whatever state is already active (templates/working files)
  if (typeof window.refreshBackground === 'function') window.refreshBackground();
  if (typeof refreshModulesMode === 'function') refreshModulesMode();
  if (typeof refreshCenter === 'function') refreshCenter();
  if (typeof render === 'function') render();

  // 4) analytics
  try { typeof sendEvent === 'function' && sendEvent('type_change', (typeof currentUiState === 'function' ? currentUiState() : {})); } catch (e) {}
});

// First-load hydration: build Mechanical controls + preview for the default type immediately
try { typeSel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}

    // Payment: toggle user vs link by mode
    const payMode = document.getElementById('payMode');
    const payUser = document.getElementById('payUser');
    const payLink = document.getElementById('payLink');
    function refreshPaymentMode(){
      if(!payMode) return;
      const m = payMode.value;
      const needsLink = (m==='Generic Link' || m==='Stripe Payment Link');
      if(payLink){ payLink.closest('label').style.display = needsLink ? 'block' : 'none'; }
      if(payUser){ payUser.closest('label').style.display = needsLink ? 'none'  : 'block'; }
    }
    if(payMode){
      payMode.addEventListener('change', refreshPaymentMode);
      refreshPaymentMode();
    }

    // Message: Resistbot preset
    const msgMode = document.getElementById('msgMode');
    const smsNumber = document.getElementById('smsNumber');
    const smsText = document.getElementById('smsText');
    let personalNumber = '';
    function applyResistbot(){
      if(smsNumber && smsNumber.value && smsNumber.value !== '50409'){ personalNumber = smsNumber.value; }
      if(smsNumber){ smsNumber.value = '50409'; smsNumber.setAttribute('disabled','disabled'); }
      if(smsText && !smsText.value){ smsText.value = 'RESIST'; }
    }
    function restorePersonalIfNeeded(){
      if(!smsNumber) return;
      smsNumber.removeAttribute('disabled');
      if(smsNumber.value==='50409'){ smsNumber.value = personalNumber; }
    }
    if(msgMode){
      msgMode.addEventListener('change', ()=>{
        if (window.__CODEDESK_IMPORTING_STATE__ || window.__CODEDESK_APPLYING_TEMPLATE__) return;
        if(msgMode.value === 'Resistbot'){ applyResistbot(); }
        else { restorePersonalIfNeeded(); }
      });
    
  }

// NOTE: Do not apply preset #0 here.
// Initial UI hydration is owned by the qrType change dispatch above,
// and imported state (templates/working files) must never be stomped.

(function () {
  const $ = (id) => document.getElementById(id);

  // expose to the later script
  window.$ = $;
  window.preview = $("qrPreview");
  window.typeSel = $("qrType");

  window.colorHex = function (id, fallback) {
    const node = $(id);
    const v = (node && node.value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : (fallback || "#000000");
  };

  window.val = function (id) {
    const n = $(id);
    return n ? (n.type === "checkbox" ? n.checked : (n.value || "")) : "";
  };
  
})();

  // --- Build QR "text" for each Type (simple, pragmatic encoders for preview) ---
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
          "https://example.org";

        // read optional utm fields (support common variants)
        const s = (val("utmSource")   || val("utm_source")   || "").trim();
        const m = (val("utmMedium")   || val("utm_medium")   || "").trim();
        const c = (val("utmCampaign") || val("utm_campaign") || "").trim();

        // If nothing extra was entered, return as-is
        if (!s && !m && !c) return raw;

        try {
          // Robust path when raw is a valid absolute URL
          const u = new URL(raw);
          if (s) u.searchParams.set("utm_source",   s);
          if (m) u.searchParams.set("utm_medium",   m);
          if (c) u.searchParams.set("utm_campaign", c);
          return u.toString();
        } catch {
          // Fallback for non-absolute or invalid URLs:
          // append query the "old-fashioned" way without breaking existing params
          const join = raw.includes("?") ? "&" : "?";
          const parts = [];
          if (s) parts.push(`utm_source=${encodeURIComponent(s)}`);
          if (m) parts.push(`utm_medium=${encodeURIComponent(m)}`);
          if (c) parts.push(`utm_campaign=${encodeURIComponent(c)}`);
          return parts.length ? `${raw}${join}${parts.join("&")}` : raw;
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
        const num = val("smsNumber") || "5551234567";
        const txt = encodeURIComponent(val("smsText") || "Hello");
        // SMS URI (broadly supported): sms:+15551234567?&body=Hello
        return `sms:${num}?&body=${txt}`;
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
        return "LGBTQRCode";
    }
  }

// === Custom QR → SVG helpers ============================================

// Build a boolean matrix from qrcode.js (rows × cols)
function getMatrix(text, level) {
  if (!window.QRCode || !QRCode.CorrectLevel) {
    console.warn("QRCode lib not ready");
    return null;
  }
  const tmp = document.createElement('div');
  const lvl = QRCode.CorrectLevel[level] ? level : 'M';
  let inst;
  try {
    inst = new QRCode(tmp, { text, width: 1, height: 1, correctLevel: QRCode.CorrectLevel[lvl] });
  } catch (e) {
    console.error("QRCode ctor failed:", e);
    return null;
  }
  const qrm = inst && inst._oQRCode;
  if (!qrm || typeof qrm.getModuleCount !== 'function') {
    console.error("QRCode matrix missing (_oQRCode undefined)");
    return null;
  }
  const n = qrm.getModuleCount();
  const mat = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => qrm.isDark(r, c))
  );
  tmp.remove();
  return mat;
}

// ---------- caption helpers ----------
function normalizeCaption(s){
  return (s || "").replace(/\s+/g, " ").trim();
}

function measureSvgText(ns, family, weight, sizePx, text){
  // create a tiny offscreen SVG just for measuring
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.opacity = '0';
  svg.style.pointerEvents = 'none';

  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', '0');
  t.setAttribute('y', '0');
  t.setAttribute('font-family', family);
  t.setAttribute('font-weight', weight || '600');
  t.setAttribute('font-size', String(sizePx));
  t.textContent = text;

  svg.appendChild(t);
  document.body.appendChild(svg);
  const w = t.getBBox().width;   // now reliable
  svg.remove();
  return w;
}

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
        // shove the remainder into the last line and ellipsize if needed
        let rest = [line].concat(words.slice(i + 1)).filter(Boolean).join(' ');
        let clip = rest;
        while (clip && measure(fs, clip + '…') > maxWidth) clip = clip.slice(0, -1);
        lines[maxLines - 1] = clip ? (clip + '…') : (lines[maxLines - 1] + '…');
        return { ok: true, fs, lines };
      }
    }

    if (line) lines.push(line);

    const fits = lines.length <= maxLines &&
                 lines.every(l => measure(fs, l) <= maxWidth);

    return fits ? { ok: true, fs, lines } : { ok: false };
  }

  // Strategy: if “long-ish”, try wrapping first; else try single line first
  if (s.length > twoLineTrigger) {
    for (let fs = startSize; fs >= minSize; fs--) {
      const r = wrapAt(fs);
      if (r.ok) return { fontSize: r.fs, lines: r.lines };
    }
    for (let fs = startSize; fs >= minSize; fs--) {
      if (measure(fs, s) <= maxWidth) {
        return { fontSize: fs, lines: [s] };
      }
    }
  } else {
    for (let fs = startSize; fs >= minSize; fs--) {
      if (measure(fs, s) <= maxWidth) {
        return { fontSize: fs, lines: [s] };
      }
    }
    for (let fs = startSize; fs >= minSize; fs--) {
      const r = wrapAt(fs);
      if (r.ok) return { fontSize: r.fs, lines: r.lines };
    }
  }

  /* === NEW: final fallback without ellipses for single-line mode ===== */
  // (We never get here when maxLines === 1 because of the early return above.)
  let clip = s;
  while (clip && measure(minSize, clip + '…') > maxWidth) clip = clip.slice(0, -1);
  return { fontSize: minSize, lines: [clip ? clip + '…' : ''] };
  /* ================================================================== */
}

// Build an SVG element for the QR, including background, modules, and eyes
function buildQrSvg({
  text, size, level,
  modulesShape, bodyColor,
  bgColor, transparentBg,
  eyeRingColor, eyeCenterColor,
  eyeRingShape = 'Square',
  eyeCenterShape = 'Square',

  // Module fill mode + scale + emoji
  modulesMode = 'Shape',         // 'Shape' | 'Emoji'
  modulesScale = 1.5,            // 0.1..1
  modulesEmoji = '😀',

  // Center content
  centerMode = 'None',           // 'None' | 'Blank' | 'Emoji'
  centerScale = 0.9,             // 0.1..1
  centerEmoji = '😊',

  // NEW: caption-in-SVG (implicit: caption renders only when captionText is non-empty)
  captionText = '',
  captionColor = '#000000',
  captionFontFamily = 'Work Sans, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", "Noto Sans", sans-serif',
  bare = false
}) {
  const ns   = "http://www.w3.org/2000/svg";
  const mat  = getMatrix(text, level);
  if (!mat) { throw new Error('QR matrix not ready'); }
  const n    = mat.length;
  const cell = Math.floor(size / n);
  const pad  = Math.floor((size - cell * n) / 2);
  const rRnd = Math.round(cell * 1); // rounded corner radius for modules/eyes

  const svg  = document.createElementNS(ns, 'svg');
  
  // ---- Caption pre-layout (compute height before drawing bg/modules) ----
const lineGap   = 1.12;
const marginX   = Math.round(size * 0.08);
const startSize = Math.round(size * 0.18);
const minSize   = Math.round(size * 0.10);

let capLayout = null;
let capPadTop = 0, capPadBot = 0;
let totalH = size;

const showCaption = !!String(captionText || '').trim();

if (showCaption) {
  const maxWidth = size - marginX * 2;
  capLayout = layoutCaptionLines(ns, {
    text:   captionText || "",
    family: captionFontFamily,
    weight: "600",
    maxWidth,
    maxLines: 1,
    startSize,
    minSize: Math.max(5, Math.round(size * 0.04)),
    charBudget: 0,
    twoLineTrigger: 999
  });

  capPadTop = Math.round(size * 0.18);
  capPadBot = Math.round(size * 0.08);
  const blockH = Math.round(capLayout.fontSize * lineGap);

  // vertically center the single line between QR bottom and preview bottom
  const availableH = capPadTop + capPadBot + blockH;
  const topOffset = (capPadTop + capPadBot - blockH) / 2;
  capPadTop = topOffset;
  capPadBot = topOffset;

  totalH = size + availableH;

}

// Set canvas dimensions now that we know total height
svg.setAttribute('width',  size);
svg.setAttribute('height', totalH);
svg.setAttribute('viewBox', `0 0 ${size} ${totalH}`);
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

// ----- Card geometry (used by QR/caption layout; no SVG bg fill here) -----
const inset       = Math.round(size * 0.04);
const strokeWidth = Math.max(1, Math.round(size * 0.02));

let cornerRadius = Math.round(size * 0.07);
const host = document.getElementById('qrPreview');
if (host) {
  const cs    = getComputedStyle(host);
  const w     = host.clientWidth || parseFloat(cs.width) || size;
  const token = parseFloat(cs.borderTopLeftRadius) || 0;
  if (w > 0 && token > 0) {
    const scale = size / w;
    cornerRadius = Math.round(token * scale);
  }
}
const drawable = size - (inset + strokeWidth) * 2;
cornerRadius   = Math.max(1, Math.min(cornerRadius, Math.floor(drawable / 2)));

const cardX = inset;
const cardY = inset;
const cardW = size - inset * 2;
const cardH = showCaption ? totalH : size;
// ⤴️ No background rect. The card fill/stroke is owned by CSS ::before.

// Optional: a soft outer glow for the stroke
function ensureGlowDef() {
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(ns, 'defs'); svg.appendChild(defs); }
  let f = svg.querySelector('#frameGlow');
  if (!f) {
    f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', 'frameGlow');
    f.innerHTML = `
      <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(1, Math.round(size*0.02))}"
        flood-color="rgba(139,92,246,.35)" flood-opacity="1"/>
    `;
    defs.appendChild(f);
  }
  return 'url(#frameGlow)';
}

// Stroke frame (only when transparent background)
if (transparentBg) {
  const frame = document.createElementNS(ns, 'rect');
  frame.setAttribute('class', 'qr-frame');
  frame.setAttribute('x', cardX);
  frame.setAttribute('y', cardY);
  frame.setAttribute('width',  cardW);
  frame.setAttribute('height', cardH);
  frame.setAttribute('rx', cornerRadius);
  frame.setAttribute('ry', cornerRadius);
  frame.setAttribute('fill', 'none');
  svg.appendChild(frame);
}

// Helpers for drawing shapes
  const drawRect = (x, y, w, h, fill, rx = 0, ry = 0) => {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    if (rx || ry) { r.setAttribute('rx', rx); r.setAttribute('ry', ry); }
    r.setAttribute('fill', fill);
    return r;
  };
  const drawCircle = (cx, cy, r, fill) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', fill);
    return c;
  };

// --- Center cutout in *module* coordinates (odd size => whole cells, centered)
const cut = (() => {
  if (centerMode === 'None') return null;

  const baseFrac = 0.25;                  // <= fixed % of the QR
  const s = Math.max(1, Math.round(n * baseFrac));

  // force odd so we never bisect modules
  const side  = s % 2 ? s : (s - 1 || 1);
  const start = Math.floor((n - side) / 2);

  return {
    startRow: start,
    endRow:   start + side - 1,
    startCol: start,
    endCol:   start + side - 1,
    side
  };
})();

  // Data modules (skip the 3 finder 7×7 areas)
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('fill', bodyColor);

    const inFinder = (r, c) =>
    (r <= 6 && c <= 6) ||           // TL
    (r <= 6 && c >= n - 7) ||       // TR
    (r >= n - 7 && c <= 6);         // BL

    const inCenterCut = cut
        ? (r, c) =>
            r >= cut.startRow && r <= cut.endRow &&
            c >= cut.startCol && c <= cut.endCol
        : () => false;


    for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
        if (!mat[r][c] || inFinder(r, c) || inCenterCut(r, c)) continue;

        const x  = pad + c * cell;
        const y  = pad + r * cell;
        const cx = x + cell / 2;
        const cy = y + cell / 2;

        if (modulesMode === 'Emoji') {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', cx);
        t.setAttribute('y', cy);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        const fs = Math.max(1, cell * modulesScale);
        t.setAttribute('font-size', String(fs));
        t.setAttribute('fill', bodyColor); // fallback if emoji renders as glyph
        t.setAttribute(
            'font-family',
            'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, system-ui, sans-serif'
        );
        t.textContent = modulesEmoji || '😀';
        g.appendChild(t);
        } else {
        // Shape mode with scale
        if (modulesShape === 'Circle') {
            const rScaled = (cell * 0.5) * modulesScale * 0.9; // small inset
            g.appendChild(drawCircle(cx, cy, rScaled, bodyColor));
        } else {
            const w  = cell * modulesScale;
            const h  = cell * modulesScale;
            const rx = modulesShape === 'Rounded' ? Math.min(rRnd, w * 0.3) : 0;
            g.appendChild(drawRect(cx - w/2, cy - h/2, w, h, bodyColor, rx, rx));
        }
        }
    }
    }
    svg.appendChild(g);

    // --- Center emoji (optional, no background) ---
    if (centerMode === 'Emoji' && cut) {
    const cx = size / 2;
    const cy = size / 2;

    // base width is the cleared square (in pixels) — fixed (~25% via cut)
    const cw = cut.side * cell;

    // cosmetic scale: allow 0.1 .. 1.5 (150%)
    const cScale = Math.max(0.1, Math.min(3, parseFloat(centerScale) || 1));

    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', cx);
    t.setAttribute('y', cy);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');

    // scale the emoji relative to the cleared square
    t.setAttribute('font-size', String(Math.floor(cw * 1 * cScale)));

    t.setAttribute(
        'font-family',
        'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, system-ui, sans-serif'
    );
    t.textContent = centerEmoji || '😊';
    svg.appendChild(t);
    }

// --- Caption (multi-line, auto-fit, ellipsized) ---
if (showCaption && capLayout) {
  const y0 = size + capPadTop + capLayout.fontSize; // baseline of first line
  capLayout.lines.forEach((ln, i) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", String(size / 2));
    t.setAttribute("y", String(y0 + i * capLayout.fontSize * lineGap));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "alphabetic");
    t.setAttribute("font-size", String(capLayout.fontSize));
    t.setAttribute("font-weight", "600");
    t.setAttribute("fill", captionColor);
    t.setAttribute("font-family", captionFontFamily);
    t.textContent = ln;
    svg.appendChild(t);
  });
}

function drawEye(atCol, atRow) {
  const x = pad + atCol * cell;
  const y = pad + atRow * cell;

  // Unique ids per-eye
  const uid = `eye_${atCol}_${atRow}`;
  const defs = (function ensureDefs(){
    let d = svg.querySelector('defs');
    if (!d) { d = document.createElementNS(ns, 'defs'); svg.appendChild(d); }
    return d;
  })();

  // --- ClipPath: confine all drawing to the 7×7 finder area
  let clip = svg.querySelector(`#clip_${uid}`);
  if (!clip) {
    clip = document.createElementNS(ns, 'clipPath');
    clip.setAttribute('id', `clip_${uid}`);
    const cp = document.createElementNS(ns, 'rect');
    cp.setAttribute('x', x);
    cp.setAttribute('y', y);
    cp.setAttribute('width',  7*cell);
    cp.setAttribute('height', 7*cell);
    defs.appendChild(clip);
    clip.appendChild(cp);
  }

  // --- Mask: outer shape = white (kept), inner shape = black (hole)
  let mask = svg.querySelector(`#mask_${uid}`);
  if (!mask) {
    mask = document.createElementNS(ns, 'mask');
    mask.setAttribute('id', `mask_${uid}`);
    defs.appendChild(mask);

    // Paint the 7×7 area white first (mask "on")
    const on = document.createElementNS(ns, 'rect');
    on.setAttribute('x', x);
    on.setAttribute('y', y);
    on.setAttribute('width',  7*cell);
    on.setAttribute('height', 7*cell);
    on.setAttribute('fill', '#fff');
    mask.appendChild(on);

    // Inner hole (black = mask "off")
    if (eyeRingShape === 'Circle') {
      const hole = document.createElementNS(ns, 'circle');
      hole.setAttribute('cx', x + cell*3.5);
      hole.setAttribute('cy', y + cell*3.5);
      hole.setAttribute('r',  cell*2.5);    // inner edge
      hole.setAttribute('fill', '#000');
      mask.appendChild(hole);
    } else {
      const hole = document.createElementNS(ns, 'rect');
      hole.setAttribute('x', x + cell);
      hole.setAttribute('y', y + cell);
      hole.setAttribute('width',  5*cell);
      hole.setAttribute('height', 5*cell);
      const rx = (eyeRingShape === 'Rounded') ? rRnd : 0;
      if (rx) { hole.setAttribute('rx', rx); hole.setAttribute('ry', rx); }
      hole.setAttribute('fill', '#000');
      mask.appendChild(hole);
    }
  }

  // --- Group everything for this eye, clip to 7×7
  const gEye = document.createElementNS(ns, 'g');
  gEye.setAttribute('clip-path', `url(#clip_${uid})`);
  svg.appendChild(gEye);

  // Draw the ring as a FILLED shape, masked to create the hole
  if (eyeRingShape === 'Circle') {
    const outer = document.createElementNS(ns, 'circle');
    outer.setAttribute('cx', x + cell*3.5);
    outer.setAttribute('cy', y + cell*3.5);
    outer.setAttribute('r',  cell*3.5); // outer edge
    outer.setAttribute('fill', eyeRingColor);
    outer.setAttribute('mask', `url(#mask_${uid})`);
    gEye.appendChild(outer);
  } else {
    const outer = document.createElementNS(ns, 'rect');
    outer.setAttribute('x', x);
    outer.setAttribute('y', y);
    outer.setAttribute('width',  7*cell);
    outer.setAttribute('height', 7*cell);
    const rx = (eyeRingShape === 'Rounded') ? rRnd : 0;
    if (rx) { outer.setAttribute('rx', rx); outer.setAttribute('ry', rx); }
    outer.setAttribute('fill', eyeRingColor);
    outer.setAttribute('mask', `url(#mask_${uid})`);
    gEye.appendChild(outer);
  }

  // Center block stays exactly as before (no bleed)
  if (eyeCenterShape === 'Circle') {
    gEye.appendChild(drawCircle(x + cell*3.5, y + cell*3.5, cell*1.5, eyeCenterColor));
  } else {
    const rx = eyeCenterShape === 'Rounded' ? rRnd : 0;
    gEye.appendChild(drawRect(x + cell*2, y + cell*2, cell*3, cell*3, eyeCenterColor, rx, rx));
  }
}

  // TL, TR, BL
  drawEye(0, 0);
  drawEye(n - 7, 0);
  drawEye(0, n - 7);

  // keep the SVG centered and inside the mount
svg.style.display = 'block';
svg.style.maxWidth = '100%';
svg.style.height = 'auto';

  return svg;
}

// --- New: compose one portrait card SVG with bg/stroke, QR, and caption ---
function composeCardSvg({
  cardWidth,
  transparentBg,

  // gradient inputs
  bgTopColor,
  bgBottomColor,
  bgTopAlpha,    // 0–100
  bgBottomAlpha, // 0–100

  captionHeadline,
  captionBody,
  captionColor,
  ecc,
  // QR look:
  modulesShape, bodyColor,
  eyeRingColor, eyeCenterColor,
  eyeRingShape, eyeCenterShape,
  modulesMode, modulesScale, modulesEmoji,
  centerMode, centerScale, centerEmoji,
}) {
    const NS = "http://www.w3.org/2000/svg";

  // Normalize caption content (max: 1 headline + 2 body lines)
  const headTextRaw = (captionHeadline || '').trim();
  const bodyTextRaw = (captionBody || '').replace(/\r/g, '').trim();

  const bodyParts = bodyTextRaw ? bodyTextRaw.split('\n') : [];
  const bodyLine1 = (bodyParts[0] || '').trim();
  const bodyLine2 = (bodyParts[1] || '').trim();

  const hasHeadline   = !!headTextRaw;
  const hasBody1      = !!bodyLine1;
  const hasBody2      = !!bodyLine2;
  const hasAnyBody    = hasBody1 || hasBody2;
  const hasAnyCaption = hasHeadline || hasAnyBody;

    // Geometry: card height depends on caption mode
  let cardHeight;
  if (!hasAnyCaption) {
    // 1) QR only — perfect square
    cardHeight = cardWidth;
  } else {
    // 2–4) Caption variants — shared wallet card (0.63 : 1 width : height)
    cardHeight = Math.round(cardWidth / 0.63);
  }

  const OUTER_PAD   = Math.round(cardWidth * 0.06); // frame inset
  const CAP_SIDE    = Math.round(cardWidth * 0.08);
  const CAP_TOPPAD  = Math.round(cardWidth * 0.05);
  const CAP_BOTPAD  = Math.round(cardWidth * 0.06);

      // Fixed QR scale across all caption states
  const QR_FRACTION = 0.75;
  
  // Corner radius: read from CSS token so it matches the purple outline
  let RADIUS = Math.round(cardWidth * 0.07); // fallback
  const host2 = document.getElementById('qrPreview');
  if (host2) {
  const cs2    = getComputedStyle(host2);
  const w2     = host2.clientWidth || parseFloat(cs2.width) || cardWidth;
  const token2 = parseFloat(cs2.getPropertyValue('--phone-radius')) ||
                 parseFloat(cs2.borderTopLeftRadius) || 0;

  if (w2 > 0 && token2 > 0) {
    const scale     = cardWidth / w2;                 // CSS px → SVG units
    const drawable  = cardWidth - OUTER_PAD * 2;      // inner rect width/height
    const maxRx     = Math.floor(drawable / 2);       // never exceed half
    RADIUS = Math.max(1, Math.min(Math.round(token2 * scale), maxRx));
  }
}

  // Outer SVG (the card)
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width',  String(cardWidth));
  svg.setAttribute('height', String(cardHeight));
  svg.setAttribute('viewBox', `0 0 ${cardWidth} ${cardHeight}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Card paint is owned by CSS (#qrPreview::before in theme.css).
  // Do NOT emit any background rects or frame strokes from the generator;
  // the mounted SVG must remain transparent so the stroke-at-0% can show.

const qrSize = Math.round(cardWidth * QR_FRACTION);
const qrX = Math.round((cardWidth - qrSize) / 2);

// Equal top + side padding for wallet cards
const PAD  = Math.round(cardWidth * 0.08);       
const SIDE = Math.round((cardWidth - qrSize) / 2); // actual side padding from centering
let qrY;

if (!hasAnyCaption) {
  // square mode — perfectly centered
  qrY = Math.round((cardHeight - qrSize) / 2);
} else {
  // wallet modes — keep QR equidistant from top and sides (static)
  qrY = SIDE;
}

// Build the *inner* QR SVG with no caption and no background
  const innerQR = buildQrSvg({
    text: buildText(),
    size: qrSize,
    level: ecc,

    modulesShape, bodyColor,
    eyeRingColor, eyeCenterColor,
    eyeRingShape, eyeCenterShape,

    modulesMode, modulesScale, modulesEmoji,
    centerMode,  centerScale,  centerEmoji,

    // We compose the card/caption externally:
    transparentBg:  true,    // QR background off (we already drew the card)
    bgColor:        '#000000',// ignored when transparent
    bare:          true     // <- no bg, no stroke on the inner QR
  });

  // Place the inner <svg> at (x,y) inside the card
  innerQR.setAttribute('x', String(qrX));
  innerQR.setAttribute('y', String(qrY));
  innerQR.setAttribute('width',  String(qrSize));
  innerQR.setAttribute('height', String(qrSize));
  svg.appendChild(innerQR);

  // Caption region (only if we actually have caption content)
  if (!hasAnyCaption) {
    return svg; // Mode 1 handled: QR-only card
  }

  const capY0      = qrY + qrSize + CAP_TOPPAD;
  const capWidth   = cardWidth - CAP_SIDE * 2;
  const capMaxH    = (cardHeight - OUTER_PAD) - CAP_BOTPAD - capY0;
  const centerX    = cardWidth / 2;
  const fontFamily = getPreviewFont();
  const lineGap    = 1.15;

  // We build up to three segments: [headline], [body1], [body2]
  const segments = [];
  let totalH = 0;

  // Headline: single line, heavy
  if (hasHeadline) {
    const headLayout = layoutCaptionLines(NS, {
      text: headTextRaw,
      family: fontFamily,
      weight: '700',
      maxWidth: capWidth,
      maxLines: 1,
      startSize: Math.round(cardWidth * 0.16),
      minSize: Math.max(5, Math.round(cardWidth * 0.08)),
      charBudget: 20,
      twoLineTrigger: 999
    });
    if (headLayout && headLayout.lines && headLayout.lines[0]) {
      const size = headLayout.fontSize;
      segments.push({
        text: headLayout.lines[0],
        size,
        weight: '700',
        gapBefore: 0
      });
      totalH += size;
    }
  }

  // Body line 1: optional, its own sizing
  if (hasBody1) {
    const ref = segments.length
      ? segments[0].size * 0.70
      : Math.round(cardWidth * 0.09);
    const body1 = layoutCaptionLines(NS, {
      text: bodyLine1,
      family: fontFamily,
      weight: '400',
      maxWidth: capWidth,
      maxLines: 1,
      startSize: Math.round(ref),
      minSize: Math.max(5, Math.round(cardWidth * 0.045)),
      charBudget: 40,
      twoLineTrigger: 999
    });
    if (body1 && body1.lines && body1.lines[0]) {
      const gap = segments.length ? segments[0].size * 0.40 : 0; // space below headline
      const size = body1.fontSize;
      segments.push({
        text: body1.lines[0],
        size,
        weight: '400',
        gapBefore: gap
      });
      totalH += gap + size;
    }
  }

  // Body line 2: optional, scaled independently from line 1
  if (hasBody2) {
    const prevSize = segments.length
      ? segments[segments.length - 1].size
      : Math.round(cardWidth * 0.06);
    const body2 = layoutCaptionLines(NS, {
      text: bodyLine2,
      family: fontFamily,
      weight: '400',
      maxWidth: capWidth,
      maxLines: 1,
      startSize: Math.round(prevSize * 0.95),
      minSize: Math.max(5, Math.round(cardWidth * 0.045)),
      charBudget: 40,
      twoLineTrigger: 999
    });
    if (body2 && body2.lines && body2.lines[0]) {
      const gap = Math.round(prevSize * 0.25); // subtle space after body1
      const size = body2.fontSize;
      segments.push({
        text: body2.lines[0],
        size,
        weight: '400',
        gapBefore: gap
      });
      totalH += gap + size;
    }
  }

  if (!segments.length || capMaxH <= 0) {
    return svg;
  }

  // Vertically center the entire text stack between QR and bottom inset
  let y = capY0 + (capMaxH - totalH) / 2;

  for (const seg of segments) {
    if (seg.gapBefore) {
      y += seg.gapBefore;
    }
    y += seg.size;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(centerX));
    t.setAttribute('y', String(y));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', String(seg.size));
    t.setAttribute('font-weight', seg.weight);
    t.setAttribute('fill', captionColor || '#000');
    t.setAttribute('font-family', fontFamily);
    t.textContent = seg.text;
    svg.appendChild(t);
  }

  return svg;
}
// --- One-time wiring for Background controls ---
let _bg_wired = false;
function wireBackgroundBindingsOnce() {
  if (_bg_wired) return;

  // Canon wiring lives in wireBackgroundKnobsOnce() (gradient + alpha + stroke gating).
  try { wireBackgroundKnobsOnce(); } catch (e) {}

  _bg_wired = true;
}

let _right_wired = false;

function wireRightAccordionBehaviorOnce() {

  if (_right_wired) return;

  const right = document.getElementById('stepper');
  if (!right) {
    // Stepper may be late-mounted; retry a few times.
    if (!wireRightAccordionBehaviorOnce._retrying) {
      wireRightAccordionBehaviorOnce._retrying = true;
      let tries = 0;
      const maxTries = 40; // ~10s @ 250ms
      const iv = setInterval(function(){
        tries++;
        try {
          const r = document.getElementById('stepper');
          if (r) {
            clearInterval(iv);
            wireRightAccordionBehaviorOnce._retrying = false;
            try { wireRightAccordionBehaviorOnce(); } catch(e){}
            return;
          }
        } catch(e){}
        if (tries >= maxTries) {
          clearInterval(iv);
          wireRightAccordionBehaviorOnce._retrying = false;
        }
      }, 250);
    }
    return;
  }

  const captionCard     = right.querySelector('.step-card[data-step="caption"]');
  const designCard      = right.querySelector('.step-card[data-step="design"]');
  const mechanicalsCard = right.querySelector('.step-card[data-step="mechanicals"]');
  const finishCard      = right.querySelector('.step-card[data-step="finish"]');

  const designBtn      = designCard?.querySelector('[data-step-toggle]');
  const mechanicalsBtn = mechanicalsCard?.querySelector('[data-step-toggle]');
  const finishBtn      = finishCard?.querySelector('[data-step-toggle]');

    function setMode(mode) {
    right.classList.toggle('mech-active',   mode === 'mechanicals');
    right.classList.toggle('finish-active', mode === 'finish');
    if (mode === 'design') right.classList.remove('mech-active', 'finish-active');

  }

  const isOpen = (card) => {
  const panel = card?.querySelector('[data-step-panel]');
  // visible if it participates in layout
  return !!panel && panel.offsetParent !== null;
};

  designBtn     ?.addEventListener('click', () => setMode('design'));
  mechanicalsBtn?.addEventListener('click', () => setMode('mechanicals'));
  finishBtn     ?.addEventListener('click', () => setMode('finish'));

  setMode(isOpen(mechanicalsCard) ? 'mechanicals'
       : isOpen(finishCard)       ? 'finish'
       : 'design');

  _right_wired = true;
}

// ---- Start the app (single, centralized boot) ----
function boot() {
  // 1) Wire one-time bindings
  wireBackgroundBindingsOnce();
  wireRightAccordionBehaviorOnce();

  // Centralized init wiring (idempotent / guarded where needed)
  wireECCPill();
  wireECCLegacySelect();
  wireFontSelect();
  
  // First-pass UI state (so fields/labels enable/disable correctly)
  try { refreshModulesMode?.(); } catch {}
  try { refreshCenter?.(); }      catch {}
  try { refreshBackground?.(); }  catch {}

  // One-time listeners that must never stack
  if (!boot._listenersBound) {
    document.getElementById('modulesMode')?.addEventListener('change', () => {
      sendEvent('modules_mode', currentUiState());
    });

    document.getElementById('centerMode')?.addEventListener('change', () => {
      try { typeof sendEvent === 'function' && sendEvent('center_mode', (typeof currentUiState === 'function' ? currentUiState() : {})); } catch (e) {}
    });

    document.getElementById('bgTransparent')?.addEventListener('change', () => {
      const transparent = !!document.getElementById('bgTransparent')?.checked;
      try { typeof sendEvent === 'function' && sendEvent('bg_mode', Object.assign({ transparent }, (typeof currentUiState === 'function' ? currentUiState() : {}))); } catch (e) {}
    });

    document.getElementById('bgColor')?.addEventListener('input', () => {
      try { refreshBackground?.(); } catch {}
      if (typeof render === 'function') render();
    });

    boot._listenersBound = true;
  }

  // Analytics (view = first meaningful paint session)
  try { typeof sendEvent === 'function' && sendEvent('view', (typeof currentUiState === 'function' ? currentUiState() : {})); } catch (e) {}

  // First render (next frame avoids layout thrash)
  requestAnimationFrame(() => {
    if (typeof render === 'function') render();
    document.documentElement.classList.add('ui-ready');
    // ensure click-through state is correct once the phone is painted
    if (typeof applyClickThroughForMobile === 'function') applyClickThroughForMobile();
  });
}

// Run after DOM is ready (once)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  try { boot(); } catch (e) { console.error('[boot]', e); }
}
// --- Initial global gate: everything off until a QR Type is chosen ---
(function gateUntilTypeChosen(){
  const typeSel = document.getElementById('qrType');
  const stepper = document.getElementById('stepper');

  // All interactive controls outside the top bar that should start disabled:
  const targets = () => [
    ...stepper.querySelectorAll('input, select, textarea, button'),
    ...document.querySelectorAll('.nav-arrow') // prev/next arrows by the preview
  ];

  function setDisabled(allOff){
    // Visual mute for the whole right column (blocks clicks too via CSS)
    stepper.classList.toggle('field-muted', allOff);
    // Flip the actual disabled state on all form-ish controls
    targets().forEach(el => { el.disabled = allOff; });
  }

  // 🔴 Add the start-here highlight on first load if empty
  if (typeSel && !typeSel.value) typeSel.classList.add('start-here');

  // If nothing picked, lock it down; otherwise, proceed normally
  const hasType = !!typeSel?.value;
  setDisabled(!hasType);
  // Hide navigation arrows until a type is chosen
  document.getElementById('prevSubtype')?.classList.toggle('hidden', !hasType);
  document.getElementById('nextSubtype')?.classList.toggle('hidden', !hasType);

  // First real action: selecting a type unlocks everything and wires design gates
  typeSel?.addEventListener('change', () => {
    typeSel.classList.remove('start-here'); // remove highlight once chosen
    setDisabled(false);

    // Hand off to your existing, granular “Design” section gating
    if (typeof wireDesignGatesOnce === 'function') wireDesignGatesOnce();
  }, { once: true, passive: true });

  // If a type is already present (e.g., hot reload), ensure gates wire up
  if (hasType && typeof wireDesignGatesOnce === 'function') wireDesignGatesOnce();
})();

  function colorHex(colorId, fallback = '#000000') {
  const colorEl = document.getElementById(colorId);

  // Try common paired-hex conventions:
  let hexEl = document.getElementById(colorId + 'Hex');                 // bodyColorHex, captionColorHex, eyeRingColorHex...
  if (!hexEl && /Color$/.test(colorId)) {
    hexEl = document.getElementById(colorId.replace(/Color$/, 'Hex'));  // bgTopHex, bgBottomHex
  }

  let v =
    (hexEl && typeof hexEl.value === 'string' && hexEl.value.trim()) ||
    (colorEl && typeof colorEl.value === 'string' && colorEl.value.trim()) ||
    (fallback || '#000000');

  v = String(v).trim();
  if (!v) v = fallback || '#000000';
  if (v[0] !== '#') v = '#' + v;

  // Normalize 3-digit hex to 6-digit
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(v);
  if (m3) {
    v = '#' + m3[1].split('').map(c => c + c).join('');
  }

  // Validate; if bad, fall back
  if (!/^#([0-9a-fA-F]{6})$/.test(v)) return (fallback || '#000000');
  return v;
}

// Toggle visual style on the preview card (for CSS glow/inset)
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

  // QRCode lib loads async; if it isn't ready yet, retry soon.
  // Without this, buildQrSvg() can throw and the preview mounts nothing (blank card).
  if (!window.QRCode || !window.QRCode.CorrectLevel) {
    try { mount.innerHTML = ''; } catch (e) {}
    clearTimeout(render._qrRetry);
    render._qrRetry = setTimeout(render, 60);
    return;
  }

  // ---- helpers (local, no global pollution)
  const toHex = (v) => {
    if (!v) return null;
    v = String(v).trim();
    const short = /^#([0-9a-f]{3})$/i;
    const full  = /^#([0-9a-f]{6})$/i;
    if (short.test(v)) return ('#' + v.slice(1).split('').map(c => c + c).join('')).toUpperCase();
    if (full.test(v))  return v.toUpperCase();
    return null;
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

  // Preview stage must match the same two-state geometry as composeCardSvg()
  // - no caption: square
  // - caption present: wallet card (0.63 : 1 width : height)
  const stageEl = preview.closest('.preview-stage');
  if (stageEl) {
    stageEl.style.aspectRatio = hasCaption ? '0.63 / 1' : '1 / 1';
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

  let svg;
  try {
    svg = composeCardSvg({
      cardWidth,
      transparentBg: isTransparent,

      // gradient pieces
      bgTopColor:     colorHex('bgTopColor',    '#FFFFFF') || '#FFFFFF',
      bgBottomColor:  colorHex('bgBottomColor', '#FFFFFF') || '#FFFFFF',
      bgTopAlpha:     Math.max(0, Math.min(100, parseFloat(document.getElementById('bgTopAlpha')?.value || '100'))),
      bgBottomAlpha:  Math.max(0, Math.min(100, parseFloat(document.getElementById('bgBottomAlpha')?.value || '100'))),

      captionHeadline: hasCaption ? headline : '',
      captionBody:     hasCaption ? body : '',
      captionColor:    colorHex('captionColor', '#000000'),
      ecc,

      // look controls
      modulesShape:   document.getElementById('moduleShape')?.value || 'Square',
      bodyColor:      colorHex('bodyColor',   '#000000'),
      eyeRingColor:   colorHex('eyeRingColor',   '#000000'),
      eyeCenterColor: colorHex('eyeCenterColor', '#000000'),
      eyeRingShape:   document.getElementById('eyeRingShape')?.value   || 'Square',
      eyeCenterShape: document.getElementById('eyeCenterShape')?.value || 'Square',

      modulesMode:    document.getElementById('modulesMode')?.value || 'Shape',
      modulesScale:   parseFloat(document.getElementById('modulesScale')?.value || '0.9'),
      modulesEmoji:   document.getElementById('modulesEmoji')?.value || '😀',

      centerMode:     document.getElementById('centerMode')?.value || 'None',
      centerScale:    parseFloat(document.getElementById('centerScale')?.value || '1'),
      centerEmoji:    document.getElementById('centerEmoji')?.value || '😊',
    });
  } catch (e) {
    console.error('❌ render(): composeCardSvg failed', e);
    mount.innerHTML = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'font: 12px/1.4 system-ui; padding: 10px; color: #b00020;';
    msg.textContent = 'Preview error: ' + (e && e.message ? e.message : String(e));
    mount.appendChild(msg);
    return;
  }

  // MOUNT DEBUG
  console.log('✅ render() running:', { svg, cardWidth });

  // Paint
  mount.innerHTML = '';
  mount.appendChild(svg);

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

// ----- Design panel gating (modules vs emoji) -----
function refreshModulesMode(){
  const mode      = document.getElementById('modulesMode')?.value || 'Shape';
  const emojiInp  = document.getElementById('modulesEmoji');   // emoji picker input
  const scaleInp  = document.getElementById('modulesScale');   // emoji scale input

  // Module "shape" control (whatever your id is — try these in order)
  const shapeSel  =
    document.getElementById('modules') ||
    document.getElementById('moduleShape') ||
    document.querySelector('[name="modules"]');

  // BODY color pair (hex + swatch). Use whatever ids you already have.
  const bodyHex   =
    document.getElementById('bodyHex') ||
    document.querySelector('[data-field="body"] input[type="text"]');
  const bodySwatch=
    document.getElementById('bodyColor') ||
    document.querySelector('[data-field="body"] input[type="color"]');

  // Rows for visual muting
  const emojiRow  = emojiInp?.closest('label');
  const scaleRow  = scaleInp?.closest('label');
  const shapeRow  = shapeSel?.closest('label');
  const bodyRow   = (bodyHex?.closest('label')) || (bodySwatch?.closest('label'));

  const isEmoji = (mode === 'Emoji');

  // Enable Emoji controls only in Emoji mode
  if (emojiInp)  emojiInp.disabled  = !isEmoji;
  if (emojiRow)  emojiRow.classList.toggle('field-muted', !isEmoji);
 

  // Disable SHAPE + BODY when Emoji is selected
  if (shapeSel)  shapeSel.disabled  = isEmoji;
  if (shapeRow)  shapeRow.classList.toggle('field-muted', isEmoji);

  if (bodyHex)    bodyHex.disabled   = isEmoji;
  if (bodySwatch) bodySwatch.disabled= isEmoji;
  if (bodyRow)    bodyRow.classList.toggle('field-muted', isEmoji);
}

// ----- Background gating (transparent toggle) -----
// NOTE: Legacy shim. Background transparency is driven exclusively by the alpha sliders.
// Delegate to the single canonical handler (window.refreshBackground) when available.
function refreshBackground() {
  if (typeof window.refreshBackground === 'function') {
    window.refreshBackground();
    return;
  }
  try { updatePreviewBackground(); } catch (e) {}
}

function refreshCenter(){
  const mode = document.getElementById('centerMode')?.value || 'None';
  const emojiInp = document.getElementById('centerEmoji');
  const scaleInp = document.getElementById('centerScale');

  const emojiRow = emojiInp?.closest('label');
  const scaleRow = scaleInp?.closest('label');

  const isEmoji = (mode === 'Emoji');

  if (emojiInp) emojiInp.disabled = !isEmoji;
  if (scaleInp) scaleInp.disabled = !isEmoji;

  if (emojiRow) emojiRow.classList.toggle('field-muted', !isEmoji);
  if (scaleRow) scaleRow.classList.toggle('field-muted', !isEmoji);
}


// Gate wiring for “Modules fill” and “Center content” controls.
// It only marks _done AFTER the controls exist. If the form
// isn’t in the DOM yet (first paint / type switch), it retries.

function wireDesignGatesOnce() {
  if (wireDesignGatesOnce._done) return;

  const mm = document.getElementById('modulesMode');
  const cm = document.getElementById('centerMode');

  // Form not injected yet → try again next frame
  if (!mm || !cm) {
    requestAnimationFrame(wireDesignGatesOnce);
    return;
  }

  // Listeners (passive, and re-render after gating)
  mm.addEventListener('change', () => { refreshModulesMode(); render(); }, { passive: true });
  cm.addEventListener('change', () => { refreshCenter();      render(); }, { passive: true });

  // Initial gate state
  refreshModulesMode();
  refreshCenter();

  wireDesignGatesOnce._done = true;
}

// ----------------------------------------------------------
// Helper: add phone background to a *copy* of the SVG for export
// ----------------------------------------------------------
function applyPhoneBackgroundForExport(svgEl) {
  const card = document.getElementById('qrPreview');
  const cs   = getComputedStyle(card);

  const isTransparent = !document.getElementById('bgTransparent')?.checked;
  const fillColor     = (cs.getPropertyValue('--frame-color') || '').trim() || '#FFFFFF';
  const radius        = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;

  // Clean any previous rect we might have added (in case of repeated exports)
  svgEl.querySelector('[data-export-bg]')?.remove();

  return; // background now handled in PNG export; keep SVG transparent

  // Size from viewBox (fallback to DOM size if needed)
  const vb = (svgEl.getAttribute('viewBox') || `0 0 ${svgEl.clientWidth} ${svgEl.clientHeight}`)
               .split(/\s+/).map(Number);
  const [, , w, h] = vb;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('data-export-bg', '1');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width',  String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('rx', String(radius));
  rect.setAttribute('ry', String(radius));
  rect.setAttribute('fill', fillColor);

  // Ensure it’s the backmost node
  svgEl.insertBefore(rect, svgEl.firstChild);
}

// --- Export helpers ---
function getCurrentSvgNode() {
  return document.querySelector('#qrMount svg');
}

// --- SVG download
function downloadSvg(filename = 'qr.svg') {
  const src = getCurrentSvgNode();
  if (!src) return;

  const svg = src.cloneNode(true);       // don’t touch the live preview

  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// --- PNG download (paint SVG to canvas)
async function downloadPng(filename = 'qr.png', scale = 3) {
  const src = getCurrentSvgNode();
  if (!src) return;

  const svg = src.cloneNode(true);
  applyPhoneBackgroundForExport(svg);    // <- inject here before serialization

  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));

  const img = new Image();

  // important for SVG-in-canvas
  img.crossOrigin = 'anonymous';

  await new Promise(res => { img.onload = res; img.src = url; });

  const w = img.naturalWidth  || parseInt(svg.getAttribute('width'))  || 512;
  const h = img.naturalHeight || parseInt(svg.getAttribute('height')) || 512;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');

    // Match preview background (gradient vs transparent) before drawing SVG
  // “Transparent mode” is purely: both alphas are 0
  const topA   = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
  const botA   = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);
  const transparent = (topA <= 0 && botA <= 0);

  if (!transparent) {
    // Read the same knobs used by updatePreviewBackground()
    const topHex = document.getElementById('bgTopHex')?.value
                || document.getElementById('bgTopColor')?.value || '#FFFFFF';
    const botHex = document.getElementById('bgBottomHex')?.value
                || document.getElementById('bgBottomColor')?.value || '#FFFFFF';
    const topA   = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
    const botA   = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);

    const hexToRgb = (h) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || '');
      if (!m) return { r: 255, g: 255, b: 255 };
      return {
        r: parseInt(m[1], 16),
        g: parseInt(m[2], 16),
        b: parseInt(m[3], 16),
      };
    };

    const rgba = (hex, pct) => {
      const { r, g, b } = hexToRgb(hex);
      const a = Math.max(0, Math.min(100, Number(pct))) / 100;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    // Vertical gradient, 0% → 100% height, same as CSS 180deg
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, rgba(topHex, topA));
    grad.addColorStop(1, rgba(botHex, botA));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Ensure custom fonts are ready before rasterizing the SVG
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {
      // non-fatal; fall back to whatever is loaded
    }
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  canvas.toBlob((blob) => {
    const dl = document.createElement('a');
    dl.href = URL.createObjectURL(blob);
    dl.download = filename;
    dl.click();
    URL.revokeObjectURL(dl.href);
  }, 'image/png');
}  

  /*// get caption or default
  const caption = document.getElementById('campaign')?.value?.trim() || 'okQRal';

  // sanitize filename (remove illegal chars, trim spaces)
  const safeName = caption
    .replace(/[^\w\d-_]+/g, '_')   // replace spaces/punctuation with _
    .replace(/^_+|_+$/g, '')       // trim leading/trailing underscores
    .substring(0, 40);             // limit to 40 chars max

  const base = safeName || 'okQRal';*/

// --- Sheets reporter (anonymous, no PII) ---
const REPORT_URL = 'https://script.google.com/macros/s/AKfycbx555EZo2jrYhtz7Lvc86GF8kxYE0mktkfCWvysycdSMoVU-c1S60HBpINdq-ooXQQ6nw/exec'

// tiny anon IDs (local/session only)
function getAnonIds(){
  const LS = window.localStorage;
  let uid = LS.getItem('okqral_uid');
  if (!uid) { uid = Math.random().toString(36).slice(2) + Date.now().toString(36); LS.setItem('okqral_uid', uid); }
  // new session when tab opened
  if (!window.__okqral_sid) window.__okqral_sid = Math.random().toString(36).slice(2);
  return { uid, sid: window.__okqral_sid };
}

function getUtm(){
  const p = new URLSearchParams(location.search);
  const g = s => (p.get(s) || '');
  return {
    source: g('utm_source'), medium: g('utm_medium'), campaign: g('utm_campaign'),
    term: g('utm_term'), content: g('utm_content')
  };
}

function uaHints(){
  const uad = navigator.userAgentData || null;
  const brands = uad?.brands?.map(b => `${b.brand} ${b.version}`).join(', ') || '';
  return {
    brands,
    mobile: !!uad?.mobile,
    platform: uad?.platform || navigator.platform || '',
    ua: navigator.userAgent || '' // fallback string (fine for internal analytics)
  };
}

function netHints(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    downlink: c?.downlink ?? null,           // Mbps (approx)
    effectiveType: c?.effectiveType || '',   // '4g','3g'…
    rtt: c?.rtt ?? null,                      // ms (approx)
    saveData: !!c?.saveData
  };
}

function accPrefs(){
  return {
    darkPref: window.matchMedia?.('(prefers-color-scheme: dark)').matches || false,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
  };
}

function pwaState(){
  const m1 = window.matchMedia?.('(display-mode: standalone)').matches;
  const m2 = window.navigator?.standalone; // iOS
  return !!(m1 || m2);
}

// Minimal, reusable event sender
async function sendEvent(name, extra = {}) {
  try {
    const { uid, sid } = getAnonIds();

    const payload = {
      event: name,
      ts: Date.now(),

      // visit/session
      uid, sid,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      lang: navigator.language || '',
      langs: navigator.languages || [],

      // page + acquisition
      page: location.pathname,
      host: location.hostname,
      ref: document.referrer ? new URL(document.referrer).origin : '',
      utm: getUtm(),

      // runtime prefs
      prefs: accPrefs(),
      pwa: pwaState(),

      // merge any call-site specifics (e.g., current type, ecc, caption flag, etc.)
      ...extra
    };

    await fetch(REPORT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  } catch (_) { /* silent */ }
}

// Small helper so listeners can attach consistent context
function currentUiState() {
  return {
    qr: {
      type:        document.getElementById('qrType')?.value || '',
      ecc:         document.getElementById('ecc')?.value || '',
      modulesMode: document.getElementById('modulesMode')?.value || '',
        centerMode:  document.getElementById('centerMode')?.value  || ''
    },
    outputs: {
      png: true,
      svg: false
    }
  };
}

async function reportExport() {
  try {
    const { uid, sid } = getAnonIds();

    const payload = {
      event: 'export',
      ts: Date.now(),

      // visit/session
      uid, sid,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      lang: navigator.language || '',
      langs: navigator.languages || [],

      // page + acquisition
      page: location.pathname,
      host: location.hostname,
      ref: document.referrer ? new URL(document.referrer).origin : '',
      utm: getUtm(),

      // theme + a11y prefs + runtime theme
      prefs: accPrefs(),
      pwa: pwaState(),

      // device / env
      device: {
        ...uaHints(),
        hw: {
          memGB: navigator.deviceMemory ?? null,
          cores: navigator.hardwareConcurrency ?? null
        },
        touchPoints: navigator.maxTouchPoints ?? 0
      },

      // screen & viewport
      screen: {
        w: window.screen?.width ?? null,
        h: window.screen?.height ?? null,
        availW: window.screen?.availWidth ?? null,
        availH: window.screen?.availHeight ?? null,
        colorDepth: window.screen?.colorDepth ?? null,
      },
      viewport: {
        w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1,
        orient: (screen.orientation && screen.orientation.type) || ''
      },

      // network
      net: netHints(),

      // QR structure only (no design/mechanicals)
      qr: {
        type: document.getElementById('qrType')?.value || '',
        ecc:  document.getElementById('ecc')?.value  || '',
        modulesMode: document.getElementById('modulesMode')?.value || '',
        centerMode:  document.getElementById('centerMode')?.value  || '',
        showCaption: !!document.getElementById('showCaption')?.checked
      },

      // outputs
      outputs: {
        png: true,
        svg: false
      }
    };

    // no-cors text/plain keeps it fire-and-forget
    await fetch(REPORT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    /* silent */
  }
}

// =====================================================
// CodeDesk → FileRoom pairing config
// =====================================================
window.CODEDESK_FILEROOM_API_BASE = window.CODEDESK_FILEROOM_API_BASE || window.FILEROOM_API_BASE || '';
window.CODEDESK_FILEROOM_FOLDER_ID = window.CODEDESK_FILEROOM_FOLDER_ID || '1x882jC2h_2YJsIXQrV1K56nqKvCPzJ4N';

// Dirty tracking for navigation safety + autosync
window.__CODEDESK_DIRTY__ = window.__CODEDESK_DIRTY__ || false;

document.getElementById('exportBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('exportBtn');
  const finishOverlay = document.getElementById('finishOverlay');
  let finishOk = false;

  if (finishOverlay) finishOverlay.style.display = '';

  if (btn) {
    btn.dataset._label = btn.textContent || '';
    btn.disabled = true;
    btn.textContent = 'Working…';
  }

  const wantPng = true;
  const wantSvg = false;

  // get filename (required identity)
  const caption =
    document.getElementById('codedeskFilename')?.value?.trim();

  // HARD GATE: no filename, no Finish.
  if (!caption) {
    try { document.getElementById('codedeskFilename')?.focus(); } catch(e){}
    if (btn) {
      btn.disabled = false;
      if (btn.dataset && typeof btn.dataset._label === 'string') btn.textContent = btn.dataset._label;
      if (btn.dataset) delete btn.dataset._label;
    }
    if (finishOverlay) finishOverlay.style.display = 'none';
    return;
  }

  // sanitize filename
  const safeName = caption
    .replace(/[^\w\d-_]+/g, '_')   // replace spaces/punct with _
    .replace(/^_+|_+$/g, '')       // trim leading/trailing _
    .substring(0, 40);             // max 40 chars

  const base = safeName;

  // log to Sheets (non-blocking)
  reportExport().catch(() => { /* silent */ });

  // ==== FINISH: create/update paired FileRoom deliverable ====
  try {
    const svgNode = getCurrentSvgNode();
    if (!svgNode) throw new Error('Finish: no SVG found');

    const workingId = (window.__CODEDESK_CURRENT_WF_ID__ || window.codedeskGetActiveWorkingFileId?.() || '').trim();
    if (!workingId) throw new Error('Finish: no working file id in session');

    const folderId = String(window.CODEDESK_FILEROOM_FOLDER_ID || '').trim();
    if (!folderId) throw new Error('Finish: CODEDESK_FILEROOM_FOLDER_ID is missing');

    const pngDataUrl = await codedeskPngDataUrlFromCurrentSvg(3);
    if (!pngDataUrl) throw new Error('Finish: could not rasterize PNG');

    const rec = window.codedeskGetWorkingFileRecord ? window.codedeskGetWorkingFileRecord(workingId) : null;

    const res = await fetch(window.CODEDESK_FILEROOM_API_BASE, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'upsertQrPngAsset',
        folder_id: folderId,
        png_data_url: pngDataUrl,
        source_id: workingId,
        title: base || 'CODEDESK QR',
        subtitle: 'CODEDESK — FLATTENED (PNG)',
        status: 'delivered',
        owner_email: (window.CODEDESK_ENTRY && window.CODEDESK_ENTRY.user_email) ? window.CODEDESK_ENTRY.user_email : ''
      })
    });

    const j = await res.json();
    if (!j || !j.ok) throw new Error((j && j.error) ? j.error : 'Finish: FileRoom upsert failed');

    const data = j.data || {};
    const driveId = String(data.drive_file_id || '').trim();
    const openUrl = String(data.open_url || '').trim();
    const jobKey  = String(data.ascend_job_key || '').trim();

    // Surface result for UI post-success (button becomes a link)
    window.__CODEDESK_LAST_FILEROOM_OPEN_URL__ = openUrl || '';

    // Persist pairing into the working file record (Finish is repeatable)
    // IMPORTANT: pairing is NOT completion — do not set finishedAt (that can evict from the hopper)
    const _rec =
      rec ||
      (window.codedeskGetWorkingFileRecord ? window.codedeskGetWorkingFileRecord(workingId) : null);

    if (_rec) {
      _rec.fileroom = { drive_file_id: driveId, open_url: openUrl, ascend_job_key: jobKey };
      _rec.updatedAt = Date.now();
      window.codedeskSaveWorkingFile(_rec);
    }

    // Immediately begin quiet lifecycle updates
    try { window.codedeskSyncFileRoomDebounced && window.codedeskSyncFileRoomDebounced('finish'); } catch(e){}

    // Disable the Finish card tab after success (user should not need it again)
    const finishCard = document.getElementById('finishCard');
    const finishHdr = finishCard ? finishCard.querySelector('[data-step-toggle]') : null;
    if (finishHdr) {
      finishHdr.disabled = true;
      finishHdr.setAttribute('aria-disabled', 'true');
      finishHdr.textContent = 'Finished';
    }
    if (finishCard) {
      finishCard.classList.add('is-finished');
      // Lock any controls inside the card
      finishCard.querySelectorAll('input,select,textarea,button').forEach((el) => {
        if (el && el.id !== 'exportBtn') el.disabled = true;
      });
    }

    finishOk = true;
    window.__CODEDESK_DIRTY__ = false;
  } catch (e) {
    alert(String(e && e.message ? e.message : e));
  } finally {
    if (finishOverlay) finishOverlay.style.display = 'none';

    if (btn) {
      if (finishOk) {
        const url = String(window.__CODEDESK_LAST_FILEROOM_OPEN_URL__ || '').trim();
        if (url) {
          btn.disabled = false;
          btn.textContent = 'Open FileRoom PNG';
          btn.onclick = () => { try { window.open(url, '_blank', 'noopener'); } catch(e){} };
        } else {
          btn.disabled = true;
          btn.textContent = 'Done';
        }
      } else {
        btn.disabled = false;
        if (btn.dataset && typeof btn.dataset._label === 'string') btn.textContent = btn.dataset._label;
      }
      if (btn.dataset) delete btn.dataset._label;
    }
  }
});

// === Stacked-mode "park under phone" helper ==========================
(function(){
  const R = document.documentElement;

  function numberVar(cssVar, fallback = 0){
    const v = getComputedStyle(R).getPropertyValue(cssVar).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // Compute where the stepper should "park" its open header under the phone
  function computeParkOffset(){
    const R = document.documentElement;

    const stage = document.querySelector('.preview-stage');
    if (!stage) return null;

    // Use the visible QR card if present; fallback to the stage
    const previewEl = document.getElementById('qrPreview') || stage;
    const previewH  = previewEl.getBoundingClientRect().height;

    const headerH = document.querySelector('.header-bar')
        ?.getBoundingClientRect().height || 56;
    // Make header height available to CSS so scroll-margin/padding can do exact parking
    R.style.setProperty('--header-h', headerH + 'px');

    // Read CSS knobs
    const getNum = (name, fallback) => {
      const v = getComputedStyle(R).getPropertyValue(name).trim();
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const overlap = getNum('--preview-overlap', 180);
    const gap     = getNum('--preview-gap', 8);
    const nudge   = getNum('--park-nudge', 16);

    // Phone height - overlap + gap + nudge
    const park = Math.max(0, Math.round(previewH - overlap + gap + nudge));

    // Expose as CSS var so CSS scroll-* rules can use it if needed
    R.style.setProperty('--park-offset', park + 'px');

    // Helpful if you keep inner scrolling elsewhere; harmless otherwise
    const stepper = document.getElementById('stepper');
    if (stepper){
      stepper.style.scrollPaddingTop = `calc(${headerH}px + ${park}px)`;
    }
    return park;
  }

  // Make it globally callable (you already call window.reflowStepper elsewhere)
  window.reflowStepper = function reflowStepper(){
    computeParkOffset();
  };

  // Keep it fresh
  window.addEventListener('resize', computeParkOffset, { passive: true });
  window.addEventListener('orientationchange', computeParkOffset, { passive: true });
  document.fonts?.ready?.then?.(computeParkOffset);

// --- Uniform "park under QR" on open (stacked only, stable + deterministic) ---
document.removeEventListener?.('click', window.__okqr_park_handler__);
window.__okqr_park_handler__ = function (e) {
  const btn  = e.target.closest?.('[data-step-toggle]');
  const card = btn?.closest?.('.step-card');
  if (!card) return;

  // Respect lock state: buttons are disabled while locked, but we also guard here.
  try {
    if (btn.disabled) return;
    if (btn.getAttribute && btn.getAttribute('aria-disabled') === 'true') return;
    if (document.body && document.body.classList && document.body.classList.contains('codedesk-locked')) return;
  } catch (e) {}

      // --- Accordion behavior: panels ship as display:none in HTML, so we must toggle them here ---
  try {
    const stepper = document.getElementById('stepper') || card.closest('#stepper');
    if (stepper) {
      const panel = card.querySelector('[data-step-panel]');
      const step  = String(card.getAttribute('data-step') || '');

      const isOpen = !!(panel && panel.offsetParent !== null && getComputedStyle(panel).display !== 'none');

      // Close all drawers first (true accordion)
      stepper.querySelectorAll('[data-step-panel]').forEach((p) => { p.style.display = 'none'; });
      stepper.querySelectorAll('[data-step-toggle]').forEach((b) => {
        try { b.setAttribute('aria-expanded', 'false'); } catch(e){}
      });

      // Clear open state tracking (needed for pill visibility + header paint rules)
      stepper.querySelectorAll('.step-card').forEach((c) => { try { c.classList.remove('is-open'); } catch(e){} });

      // Finish should NOT fold down: it never opens a panel; it only toggles finish-active styling.
      if (step === 'finish') {
        stepper.classList.remove('mech-active');
        stepper.classList.add('finish-active');
        return;
      }

      // If it was closed, open it; if it was open, leave everything closed.
      if (panel && !isOpen) {
        panel.style.display = '';
        try { btn.setAttribute('aria-expanded', 'true'); } catch(e){}
        try { card.classList.add('is-open'); } catch(e){}

        // Mode styling parity with wide-mode setMode()
        if (step === 'mechanicals') {
          stepper.classList.remove('finish-active');
          stepper.classList.add('mech-active');
        } else {
          stepper.classList.remove('mech-active', 'finish-active');
        }
      } else {
        // Closing (or clicking an already-open drawer) returns to neutral
        stepper.classList.remove('mech-active', 'finish-active');
      }
    }
  } catch (e) {}

  // Wait one microtask so header pills can expand before measuring
  setTimeout(() => {
    if (!window.matchMedia('(max-width: 1279px)').matches) return;
    window.reflowStepper?.(); // recompute --park-offset after header reflows

    // ✅ scroll to the wrapper (includes pills) — avoids post-scroll jump
    const header = card.querySelector('.step-header-wrap')
                || card.querySelector('.step-header')
                || card;

    const preferSmooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    header.scrollIntoView({
      block: 'start',
      behavior: preferSmooth ? 'smooth' : 'auto'
    });
  }, 0);
};

document.addEventListener('click', window.__okqr_park_handler__);

// --- Safety: ensure headers remain clickable under the phone on mobile ---
function applyClickThroughForMobile() {
  const pass  = window.matchMedia('(max-width: 1279px)').matches;
  const stage = document.querySelector('.preview-stage');
  if (!stage) return;

  const wrap   = stage.querySelector('.absolute'); // inner absolute inset wrapper
  const qr     = stage.querySelector('#qrPreview');
  const mount  = stage.querySelector('#qrMount');
  const svg    = stage.querySelector('#qrMount > svg');
  const arrows = stage.querySelectorAll('.nav-arrow');

  if (pass) {
    // Make the whole preview stack "glass"
    stage.style.pointerEvents = 'none';
    if (wrap)  wrap.style.pointerEvents  = 'none';
    if (qr)    qr.style.pointerEvents    = 'none';
    if (mount) mount.style.pointerEvents = 'none';
    if (svg)   svg.style.pointerEvents   = 'none';

    // …but keep the left/right arrows clickable
    arrows.forEach(a => { a.style.pointerEvents = 'auto'; });
  } else {
    // Desktop: restore defaults
    stage.style.pointerEvents = '';
    if (wrap)  wrap.style.pointerEvents  = '';
    if (qr)    qr.style.pointerEvents    = '';
    if (mount) mount.style.pointerEvents = '';
    if (svg)   svg.style.pointerEvents   = '';
    arrows.forEach(a => { a.style.pointerEvents = ''; });
  }
}
window.addEventListener('resize', applyClickThroughForMobile, { passive: true });
 
})();

// =======================================================
// Color picker / hex text sync (robust pairing, DOM-safe)
// =======================================================
(function bindColorHexSync() {
  const toHex = (v) => {
    if (!v) return null;
    v = String(v).trim();
    const short = /^#([0-9a-f]{3})$/i;
    const full  = /^#([0-9a-f]{6})$/i;
    if (short.test(v)) {
      return '#' + v.slice(1).split('').map(c => c + c).join('').toUpperCase();
    }
    if (full.test(v)) return v.toUpperCase();
    return null;
  };

  const pairTextForColor = (colorEl) => {
    // 1) Fast path: FooColor -> FooHex
    if (colorEl.id && /Color$/.test(colorEl.id)) {
      const guess = document.getElementById(colorEl.id.replace(/Color$/, 'Hex'));
      if (guess && guess.matches?.('input[type="text"]')) return guess;
    }

    // 2) Otherwise: look in a reasonable wrapper, then walk siblings
    const wrapper =
      colorEl.closest?.('.color-field, .field, .control, .form-row, .flex, .grid, div') || colorEl.parentElement;

    let textEl = wrapper && wrapper.querySelector?.('input[type="text"]');

    if (!textEl) {
      let n = colorEl.nextElementSibling;
      while (n) {
        if (n.matches?.('input[type="text"]')) return n;
        const inner = n.querySelector?.('input[type="text"]');
        if (inner) return inner;
        n = n.nextElementSibling;
      }
    }
    return textEl || null;
  };

  const ready = () => {
    document.querySelectorAll('input[type="color"]').forEach((colorEl) => {
      if (colorEl.dataset.hexSyncBound === '1') return;

      const textEl = pairTextForColor(colorEl);
      if (!textEl) return;

      if (textEl.dataset.hexSyncBound === '1') return;

      // mark both sides so rebinding is safe
      colorEl.dataset.hexSyncBound = '1';
      textEl.dataset.hexSyncBound  = '1';

      // initialize: keep whatever the text says if valid, else mirror color
      const initHex = toHex(textEl.value) || toHex(colorEl.value) || '#000000';
      colorEl.value = initHex;
      textEl.value  = initHex;

      // Color -> Hex
      colorEl.addEventListener('input', () => {
        textEl.value = String(colorEl.value || '').toUpperCase();
        if (typeof render === 'function') render();
      });

      // Hex -> Color (input/change/blur)
      const applyHex = () => {
        const hx = toHex(textEl.value);
        if (!hx) return;
        colorEl.value = hx;
        textEl.value  = hx;
        if (typeof render === 'function') render();
      };

      textEl.addEventListener('input',  applyHex);
      textEl.addEventListener('change', applyHex);
      textEl.addEventListener('blur',   applyHex);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }

})();

})();