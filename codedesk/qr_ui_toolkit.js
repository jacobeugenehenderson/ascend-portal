// =====================================================
//  Render-plane invariant: buildText() must always exist
//  - Prevents render() structural block if earlier UI wiring throws.
//  - Real buildText() (below) will overwrite this once reached.
// =====================================================
if (typeof window.buildText !== 'function') {
  window.buildText = function buildText() {
    try {
      const sel = document.getElementById('qrType');
      const t = sel ? String(sel.value || '') : '';

      // Minimal always-on payload; mirrors canonical URL fallback behavior.
      if (t === 'URL') {
        const el =
          document.getElementById('urlData') ||
          document.getElementById('url') ||
          document.getElementById('URL');
        const raw = el ? String(el.value || '') : '';
        const s = raw.trim();
        return s || 'https://jacobhenderson.studio';
      }
    } catch (_e) {}

    return 'https://jacobhenderson.studio';
  };
}

console.log('[PROBE ui_toolkit]', { href: String(location && location.href || ''), topEqSelf: (window === window.top), selfName: String(window.name || ''), hasWinBuildText: (typeof window.buildText === 'function'), hasLexBuildText: (typeof buildText === 'function') });

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

// Wire ECC after DOM is ready (add-only; safe if nodes absent)
(function wireECCOnceOnReady(){
  if (window.__CODEDESK_ECC_WIRED__) return;
  window.__CODEDESK_ECC_WIRED__ = true;

  const run = function(){
    try { wireECCPill(); } catch(e){}
    try { wireECCLegacySelect(); } catch(e){}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();

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

// Wire Font after DOM is ready (add-only; safe if nodes absent)
(function wireFontOnceOnReady(){
  if (window.__CODEDESK_FONT_WIRED__) return;
  window.__CODEDESK_FONT_WIRED__ = true;

  const run = function(){
    try { wireFontSelect(); } catch(e){}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();

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

// Live re-paint when user moves any background knob
// Also: default-link top/bottom (alpha + color), and prevent 0% → 100% snapback
let _bg_knobs_wired = false;
function wireBackgroundKnobsOnce() {
  if (_bg_knobs_wired) return;
  if (window.__CODEDESK_BG_KNOBS_WIRED__) return;
  window.__CODEDESK_BG_KNOBS_WIRED__ = true;

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

  // Not present in minimal builds; bail safely.
  if (!topA || !botA) return;

  // One source of truth: checkbox "bgTransparent" (if present) owns the transparent mode.
  // NOTE: bgTransparent is used in buildText() to decide whether to omit bg.
  const bgTransparent = document.getElementById('bgTransparent');

  // Helper: parse numeric, preserving 0 (no `||` traps).
  function num(v, fallback){
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function paintAlphaNums(){
    try {
      if (topANum) topANum.value = String(clamp01(num(topA.value, 1)).toFixed(2));
      if (botANum) botANum.value = String(clamp01(num(botA.value, 1)).toFixed(2));
    } catch (e) {}
  }

  function syncHexAndColor(fromEl, toEl){
    try {
      if (!fromEl || !toEl) return;
      const v = String(fromEl.value || '').trim();
      if (!v) return;
      if (toEl.value !== v) toEl.value = v;
    } catch (e) {}
  }

  function repaint(){
    // IMPORTANT: do not trigger preset application during import/template apply
    try {
      if (window.__CODEDESK_IMPORTING_STATE__) return;
      if (window.__CODEDESK_APPLYING_TEMPLATE__) return;
    } catch (e) {}

    try { if (typeof refreshBackground === 'function') refreshBackground(); } catch (e) {}
    try { if (typeof render === 'function') render(); } catch (e) {}
  }

  function isLinked(){
    try { return localStorage.getItem(LINK_KEY) === '1'; } catch (e) { return false; }
  }
  function setLinked(on){
    try { localStorage.setItem(LINK_KEY, on ? '1' : '0'); } catch (e) {}
  }

  // Default: linked unless explicitly disabled
  try {
    if (localStorage.getItem(LINK_KEY) == null) setLinked(true);
  } catch (e) {}

  function linkPair(source, target, transform){
    try {
      if (!isLinked()) return;
      if (!source || !target) return;
      const v = transform ? transform(source.value) : source.value;
      if (target.value !== v) target.value = v;
    } catch (e) {}
  }

  // Capture-phase interception for alpha sliders (defeat inline handlers)
  function bindAlpha(el, otherEl, numEl, otherNumEl){
    if (!el) return;

    el.addEventListener('input', function(e){
      try { e.stopImmediatePropagation(); } catch (e) {}
      try { e.stopPropagation(); } catch (e) {}

      // Preserve 0; clamp
      const v = clamp01(num(el.value, 1));
      el.value = String(v);

      // Link top/bottom
      linkPair(el, otherEl, (x) => String(clamp01(num(x, 1))));

      // Sync numeric boxes
      paintAlphaNums();

      repaint();
    }, true);

    // Numeric input drives slider
    if (numEl){
      numEl.addEventListener('input', function(e){
        try { e.stopImmediatePropagation(); } catch (e) {}
        try { e.stopPropagation(); } catch (e) {}

        const v = clamp01(num(numEl.value, 1));
        numEl.value = String(v.toFixed(2));
        el.value = String(v);

        // Link
        linkPair(el, otherEl, (x) => String(clamp01(num(x, 1))));

        paintAlphaNums();
        repaint();
      }, true);
    }
  }

  // Capture-phase interception for colors / hex
  function bindColor(colorEl, hexEl, otherColorEl, otherHexEl){
    if (colorEl){
      colorEl.addEventListener('input', function(e){
        try { e.stopImmediatePropagation(); } catch (e) {}
        try { e.stopPropagation(); } catch (e) {}
        syncHexAndColor(colorEl, hexEl);
        linkPair(colorEl, otherColorEl, (x) => x);
        syncHexAndColor(otherColorEl, otherHexEl);
        repaint();
      }, true);
    }

    if (hexEl){
      hexEl.addEventListener('input', function(e){
        try { e.stopImmediatePropagation(); } catch (e) {}
        try { e.stopPropagation(); } catch (e) {}
        syncHexAndColor(hexEl, colorEl);
        linkPair(hexEl, otherHexEl, (x) => x);
        syncHexAndColor(otherHexEl, otherColorEl);
        repaint();
      }, true);
    }
  }

  // Transparent checkbox owns the mode; repaint only.
  if (bgTransparent){
    bgTransparent.addEventListener('change', function(){
      repaint();
    });
  }

  bindColor(topColor, topHex, botColor, botHex);
  bindColor(botColor, botHex, topColor, topHex);

  bindAlpha(topA, botA, topANum, botANum);
  bindAlpha(botA, topA, botANum, topANum);

  // Initialize numeric boxes
  try { paintAlphaNums(); } catch (e) {}

  _bg_knobs_wired = true;
}

try { wireBackgroundKnobsOnce(); } catch (e) {}

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
          "";

        // If empty, export empty (no placeholder payloads)
        const rawTrim = String(raw || "").trim();
        if (!rawTrim) return "https://jacobhenderson.studio";

        // read optional utm fields (support common variants)
        const s = (val("utmSource")   || val("utm_source")   || "").trim();
        const m = (val("utmMedium")   || val("utm_medium")   || "").trim();
        const c = (val("utmCampaign") || val("utm_campaign") || "").trim();
        const t = (val("utmTerm")     || val("utm_term")     || "").trim();
        const k = (val("utmContent")  || val("utm_content")  || "").trim();

        // If no UTMs, return raw as-is
        const has = (s || m || c || t || k);
        if (!has) return rawTrim;

        // Append/merge UTMs preserving existing query/hash
        try{
          const u = new URL(rawTrim);
          if (s) u.searchParams.set("utm_source", s);
          if (m) u.searchParams.set("utm_medium", m);
          if (c) u.searchParams.set("utm_campaign", c);
          if (t) u.searchParams.set("utm_term", t);
          if (k) u.searchParams.set("utm_content", k);
          return u.toString();
        }catch(e){
          // If raw isn't a valid URL for URL(), do a pragmatic string append
          const parts = rawTrim.split("#");
          const base = parts[0];
          const hash = parts.length > 1 ? ("#" + parts.slice(1).join("#")) : "";
          const hasQ = base.indexOf("?") >= 0;
          const q = [];
          if (s) q.push("utm_source=" + encodeURIComponent(s));
          if (m) q.push("utm_medium=" + encodeURIComponent(m));
          if (c) q.push("utm_campaign=" + encodeURIComponent(c));
          if (t) q.push("utm_term=" + encodeURIComponent(t));
          if (k) q.push("utm_content=" + encodeURIComponent(k));
          return base + (hasQ ? "&" : "?") + q.join("&") + hash;
        }
      }

      case "EMAIL": {
        const to = (val("emailTo") || val("to") || val("email") || "").trim();
        const subj = (val("emailSubject") || val("subject") || "").trim();
        const body = (val("emailBody") || val("body") || val("message") || "").trim();
        const qp = [];
        if (subj) qp.push("subject=" + encodeURIComponent(subj));
        if (body) qp.push("body=" + encodeURIComponent(body));
        return "mailto:" + encodeURIComponent(to) + (qp.length ? ("?" + qp.join("&")) : "");
      }

      case "PHONE": {
        const p = (val("phoneNumber") || val("phone") || val("tel") || "").trim();
        return p ? ("tel:" + p.replace(/[^\d+]/g, "")) : "tel:";
      }

      case "SMS": {
        const p = (val("smsNumber") || val("phoneNumber") || val("phone") || val("tel") || "").trim();
        const msg = (val("smsMessage") || val("message") || val("body") || "").trim();
        const base = p ? ("sms:" + p.replace(/[^\d+]/g, "")) : "sms:";
        return msg ? (base + "?body=" + encodeURIComponent(msg)) : base;
      }

      case "WIFI": {
        const ssid = (val("wifiSsid") || val("ssid") || "").trim();
        const pass = (val("wifiPassword") || val("password") || val("pass") || "").trim();
        const sec  = (val("wifiSecurity") || val("security") || val("encryption") || "WPA").trim();
        const hidden = !!val("wifiHidden");
        if (!ssid) return "";
        return `WIFI:T:${sec};S:${ssid};P:${pass};H:${hidden ? "true" : "false"};;`;
      }

      case "VCARD": {
        const fn   = (val("vcardName") || val("name") || "").trim();
        const org  = (val("vcardOrg") || val("org") || "").trim();
        const title= (val("vcardTitle") || val("title") || "").trim();
        const tel  = (val("vcardPhone") || val("phone") || "").trim();
        const email= (val("vcardEmail") || val("email") || "").trim();
        const url  = (val("vcardUrl") || val("url") || "").trim();

        // Minimal vCard 3.0
        return [
          "BEGIN:VCARD",
          "VERSION:3.0",
          fn ? ("FN:" + fn) : "",
          org ? ("ORG:" + org) : "",
          title ? ("TITLE:" + title) : "",
          tel ? ("TEL:" + tel) : "",
          email ? ("EMAIL:" + email) : "",
          url ? ("URL:" + url) : "",
          "END:VCARD"
        ].filter(Boolean).join("\n");
      }

      case "MAP": {
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
        return "CODEDESK";
    }
  }

// Ensure buildText is global (render-plane invariant)
window.buildText = buildText;

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

        // Prevent stray pointer events on the rail itself
        stepper.style.pointerEvents = locked ? 'none' : 'auto';
      }
    } catch(e){}
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

  // Mark wired so we don’t duplicate listeners
  _right_wired = true;
}

function computeParkOffset(){
    const R = document.documentElement;
    const stage = document.querySelector('.preview-stage');
    if (!stage) return null;

    // Use the visible QR card if present
    const preview = document.getElementById('qrPreview');
    const previewH = preview?.getBoundingClientRect().height || 0;

    // Header height
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

  console.log('[PROBE render]', { href: String(location && location.href || ''), topEqSelf: (window === window.top), selfName: String(window.name || ''), hasWinBuildText: (typeof window.buildText === 'function'), hasLexBuildText: (typeof buildText === 'function') });
  
  if (!stage) return;

  const wrap   = stage.querySelector('.absolute'); // inner absolute inset wrapper
  const qr     = stage.querySelector('#qrPreview');
  const mount  = stage.querySelector('#qrMount');
  const svg    = stage.querySelector('#qrMount > svg');
  const arrows = stage.querySelectorAll('.nav-arrow');

  // Allow clicks to pass through overlayed preview area except for QR itself + nav arrows
  // so accordion headers remain tappable.
  try {
    if (wrap) wrap.style.pointerEvents = pass ? 'none' : '';
    if (qr)   qr.style.pointerEvents   = pass ? 'auto' : '';
    if (mount) mount.style.pointerEvents = pass ? 'auto' : '';
    if (svg)  svg.style.pointerEvents  = pass ? 'auto' : '';
    arrows.forEach(a => { try { a.style.pointerEvents = pass ? 'auto' : ''; } catch(e){} });
  } catch(e){}
}

window.addEventListener('resize', applyClickThroughForMobile, { passive: true });
window.addEventListener('orientationchange', applyClickThroughForMobile, { passive: true });