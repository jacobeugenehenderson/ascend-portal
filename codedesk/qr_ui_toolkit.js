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