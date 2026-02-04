// =====================================================
//  CodeDesk Render Engine
//  - QR matrix generation
//  - SVG composition (QR + caption + card)
//  - Live preview rendering
//  - Design panel gating
//  - Export helpers (PNG/SVG)
// =====================================================
"use strict";
console.log('[qr_render_engine.js] LOADING (v2024-DEBUG)');

// Guard against duplicate loading
if (window.__CODEDESK_RENDER_ENGINE_LOADED__) {
  console.warn('[qr_render_engine] Already loaded, skipping.');
} else {
  window.__CODEDESK_RENDER_ENGINE_LOADED__ = true;

// =====================================================
//  Background gradient helpers
// =====================================================

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
  if (!card) {
    console.warn('[updatePreviewBackground] qrPreview not found!');
    return;
  }
  const g = _bgGradientFromKnobs();
  console.log('[updatePreviewBackground] gradient:', g);

  // Paint BOTH vars: some skins use --bg-paint, some older code uses --frame-bg.
  card.style.setProperty('--bg-paint', g);
  card.style.setProperty('--frame-bg', g);

  // Also paint the dedicated background element directly (fallback for ::before issues)
  const bgEl = document.getElementById('qrBgPaint');
  if (bgEl) {
    bgEl.style.background = g;
    console.log('[updatePreviewBackground] set bgEl.style.background');
  } else {
    console.warn('[updatePreviewBackground] qrBgPaint not found!');
  }
}

// Expose globally so qr_sync_pipeline.js can call it
window.updatePreviewBackground = updatePreviewBackground;

window.refreshBackground = function refreshBackground() {
  console.log('[refreshBackground] called');
  const card = document.getElementById('qrPreview');
  if (!card) {
    console.warn('[refreshBackground] qrPreview not found!');
    return;
  }

  // IMPORTANT: do NOT use `|| 0` here; 0 is valid and must stay 0.
  const topRaw = parseFloat(document.getElementById('bgTopAlpha')?.value);
  const botRaw = parseFloat(document.getElementById('bgBottomAlpha')?.value);
  const topA = (Number.isFinite(topRaw) ? topRaw : 100) / 100;
  const botA = (Number.isFinite(botRaw) ? botRaw : 100) / 100;

  // "Transparent background" = both alphas are 0
  const isTransparent = (topA <= 0.001 && botA <= 0.001);

  // class gating (stroke vs fill)
  card.classList.toggle('card--stroke', isTransparent);
  card.classList.toggle('card--fill', !isTransparent);

  // Show/hide the dedicated background element
  const bgEl = document.getElementById('qrBgPaint');
  if (bgEl) {
    bgEl.style.display = isTransparent ? 'none' : 'block';
  }

  // paint the CSS gradient var used by ::before AND the dedicated element
  updatePreviewBackground();
};

// =====================================================
//  Color hex helper
// =====================================================

function colorHex(colorId, fallback = '#000000') {
  const colorEl = document.getElementById(colorId);

  // Try common paired-hex conventions:
  let hexEl = document.getElementById(colorId + 'Hex');
  if (!hexEl && /Color$/.test(colorId)) {
    hexEl = document.getElementById(colorId.replace(/Color$/, 'Hex'));
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

// Expose globally (used by other modules)
window.colorHex = colorHex;

// =====================================================
//  QR Matrix Generation (using QRCode.js)
// =====================================================

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

// =====================================================
//  Caption Layout Helpers
// =====================================================

function normalizeCaption(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function measureSvgText(ns, family, weight, sizePx, text) {
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
  const w = t.getBBox().width;
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
  charBudget = 0,
  twoLineTrigger = 14
}) {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  const s = charBudget > 0 ? raw.slice(0, charBudget) : raw;

  const measure = (fs, str) => measureSvgText(ns, family, weight, fs, str);

  // Single-line fast path (no ellipses)
  if (maxLines === 1) {
    for (let fs = startSize; fs >= Math.max(5, minSize); fs--) {
      if (measure(fs, s) <= maxWidth) {
        return { fontSize: fs, lines: [s] };
      }
    }
    return { fontSize: Math.max(5, minSize), lines: [s] };
  }

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
        else { lines.push(words[i]); line = ''; }
      }
      if (lines.length === maxLines) {
        let rest = [line].concat(words.slice(i + 1)).filter(Boolean).join(' ');
        let clip = rest;
        while (clip && measure(fs, clip + '...') > maxWidth) clip = clip.slice(0, -1);
        lines[maxLines - 1] = clip ? (clip + '...') : (lines[maxLines - 1] + '...');
        return { ok: true, fs, lines };
      }
    }

    if (line) lines.push(line);

    const fits = lines.length <= maxLines &&
                 lines.every(l => measure(fs, l) <= maxWidth);

    return fits ? { ok: true, fs, lines } : { ok: false };
  }

  // Strategy: if "long-ish", try wrapping first; else try single line first
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

  // Final fallback
  let clip = s;
  while (clip && measure(minSize, clip + '...') > maxWidth) clip = clip.slice(0, -1);
  return { fontSize: minSize, lines: [clip ? clip + '...' : ''] };
}

// =====================================================
//  Build QR SVG (modules, eyes, center, caption)
// =====================================================

function buildQrSvg({
  text, size, level,
  modulesShape, bodyColor,
  bgColor, transparentBg,
  eyeRingColor, eyeCenterColor,
  eyeRingShape = 'Square',
  eyeCenterShape = 'Square',
  eyeCenterMode = 'Shape',
  eyeCenterScale = 0.9,
  eyeCenterEmoji = '👁️',
  modulesMode = 'Shape',
  modulesScale = 1.5,
  modulesEmoji = '😀',
  centerMode = 'None',
  centerScale = 0.9,
  centerEmoji = '😊',
  captionText = '',
  captionColor = '#000000',
  captionFontFamily = 'Work Sans, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", "Noto Sans", sans-serif',
  bare = false
}) {
  const ns = "http://www.w3.org/2000/svg";
  const mat = getMatrix(text, level);
  if (!mat) { throw new Error('QR matrix not ready'); }
  const n = mat.length;
  const cell = Math.floor(size / n);
  const pad = Math.floor((size - cell * n) / 2);
  const rRnd = Math.round(cell * 1);

  const svg = document.createElementNS(ns, 'svg');

  // Caption pre-layout
  const lineGap = 1.12;
  const marginX = Math.round(size * 0.08);
  const startSize = Math.round(size * 0.18);
  const minSize = Math.round(size * 0.10);

  let capLayout = null;
  let capPadTop = 0, capPadBot = 0;
  let totalH = size;

  const showCaption = !!String(captionText || '').trim();

  if (showCaption) {
    const maxWidth = size - marginX * 2;
    capLayout = layoutCaptionLines(ns, {
      text: captionText || "",
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
    const availableH = capPadTop + capPadBot + blockH;
    const topOffset = (capPadTop + capPadBot - blockH) / 2;
    capPadTop = topOffset;
    capPadBot = topOffset;
    totalH = size + availableH;
  }

  svg.setAttribute('width', size);
  svg.setAttribute('height', totalH);
  svg.setAttribute('viewBox', `0 0 ${size} ${totalH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Card geometry
  const inset = Math.round(size * 0.04);
  const strokeWidth = Math.max(1, Math.round(size * 0.02));

  let cornerRadius = Math.round(size * 0.07);
  const host = document.getElementById('qrPreview');
  if (host) {
    const cs = getComputedStyle(host);
    const w = host.clientWidth || parseFloat(cs.width) || size;
    const token = parseFloat(cs.borderTopLeftRadius) || 0;
    if (w > 0 && token > 0) {
      const scale = size / w;
      cornerRadius = Math.round(token * scale);
    }
  }
  const drawable = size - (inset + strokeWidth) * 2;
  cornerRadius = Math.max(1, Math.min(cornerRadius, Math.floor(drawable / 2)));

  const cardX = inset;
  const cardY = inset;
  const cardW = size - inset * 2;
  const cardH = showCaption ? totalH : size;

  // Glow definition
  function ensureGlowDef() {
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS(ns, 'defs'); svg.appendChild(defs); }
    let f = svg.querySelector('#frameGlow');
    if (!f) {
      f = document.createElementNS(ns, 'filter');
      f.setAttribute('id', 'frameGlow');
      f.innerHTML = `
        <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(1, Math.round(size * 0.02))}"
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
    frame.setAttribute('width', cardW);
    frame.setAttribute('height', cardH);
    frame.setAttribute('rx', cornerRadius);
    frame.setAttribute('ry', cornerRadius);
    frame.setAttribute('fill', 'none');
    svg.appendChild(frame);
  }

  // Drawing helpers
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

  // Center cutout
  const cut = (() => {
    if (centerMode === 'None') return null;
    const baseFrac = 0.25;
    const s = Math.max(1, Math.round(n * baseFrac));
    const side = s % 2 ? s : (s - 1 || 1);
    const start = Math.floor((n - side) / 2);
    return {
      startRow: start,
      endRow: start + side - 1,
      startCol: start,
      endCol: start + side - 1,
      side
    };
  })();

  // Data modules
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('fill', bodyColor);

  const inFinder = (r, c) =>
    (r <= 6 && c <= 6) ||
    (r <= 6 && c >= n - 7) ||
    (r >= n - 7 && c <= 6);

  const inCenterCut = cut
    ? (r, c) =>
        r >= cut.startRow && r <= cut.endRow &&
        c >= cut.startCol && c <= cut.endCol
    : () => false;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!mat[r][c] || inFinder(r, c) || inCenterCut(r, c)) continue;

      const x = pad + c * cell;
      const y = pad + r * cell;
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
        t.setAttribute('fill', bodyColor);
        t.setAttribute('font-family', 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, system-ui, sans-serif');
        t.textContent = modulesEmoji || '😀';
        g.appendChild(t);
      } else {
        if (modulesShape === 'Circle') {
          const rScaled = (cell * 0.5) * modulesScale * 0.9;
          g.appendChild(drawCircle(cx, cy, rScaled, bodyColor));
        } else {
          const w = cell * modulesScale;
          const h = cell * modulesScale;
          const rx = modulesShape === 'Rounded' ? Math.min(rRnd, w * 0.3) : 0;
          g.appendChild(drawRect(cx - w / 2, cy - h / 2, w, h, bodyColor, rx, rx));
        }
      }
    }
  }
  svg.appendChild(g);

  // Center emoji
  if (centerMode === 'Emoji' && cut) {
    const cx = size / 2;
    const cy = size / 2;
    const cw = cut.side * cell;
    const cScale = Math.max(0.1, Math.min(3, parseFloat(centerScale) || 1));

    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', cx);
    t.setAttribute('y', cy);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', String(Math.floor(cw * 1 * cScale)));
    t.setAttribute('font-family', 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, system-ui, sans-serif');
    t.textContent = centerEmoji || '😊';
    svg.appendChild(t);
  }

  // Caption
  if (showCaption && capLayout) {
    const y0 = size + capPadTop + capLayout.fontSize;
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

  // Draw eyes
  function drawEye(atCol, atRow) {
    const x = pad + atCol * cell;
    const y = pad + atRow * cell;
    const uid = `eye_${atCol}_${atRow}`;

    const defs = (function ensureDefs() {
      let d = svg.querySelector('defs');
      if (!d) { d = document.createElementNS(ns, 'defs'); svg.appendChild(d); }
      return d;
    })();

    // ClipPath
    let clip = svg.querySelector(`#clip_${uid}`);
    if (!clip) {
      clip = document.createElementNS(ns, 'clipPath');
      clip.setAttribute('id', `clip_${uid}`);
      const cp = document.createElementNS(ns, 'rect');
      cp.setAttribute('x', x);
      cp.setAttribute('y', y);
      cp.setAttribute('width', 7 * cell);
      cp.setAttribute('height', 7 * cell);
      defs.appendChild(clip);
      clip.appendChild(cp);
    }

    // Mask
    let mask = svg.querySelector(`#mask_${uid}`);
    if (!mask) {
      mask = document.createElementNS(ns, 'mask');
      mask.setAttribute('id', `mask_${uid}`);
      defs.appendChild(mask);

      const on = document.createElementNS(ns, 'rect');
      on.setAttribute('x', x);
      on.setAttribute('y', y);
      on.setAttribute('width', 7 * cell);
      on.setAttribute('height', 7 * cell);
      on.setAttribute('fill', '#fff');
      mask.appendChild(on);

      if (eyeRingShape === 'Circle') {
        const hole = document.createElementNS(ns, 'circle');
        hole.setAttribute('cx', x + cell * 3.5);
        hole.setAttribute('cy', y + cell * 3.5);
        hole.setAttribute('r', cell * 2.5);
        hole.setAttribute('fill', '#000');
        mask.appendChild(hole);
      } else {
        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x + cell);
        hole.setAttribute('y', y + cell);
        hole.setAttribute('width', 5 * cell);
        hole.setAttribute('height', 5 * cell);
        const rx = (eyeRingShape === 'Rounded') ? rRnd : 0;
        if (rx) { hole.setAttribute('rx', rx); hole.setAttribute('ry', rx); }
        hole.setAttribute('fill', '#000');
        mask.appendChild(hole);
      }
    }

    const gEye = document.createElementNS(ns, 'g');
    gEye.setAttribute('clip-path', `url(#clip_${uid})`);
    svg.appendChild(gEye);

    // Ring
    if (eyeRingShape === 'Circle') {
      const outer = document.createElementNS(ns, 'circle');
      outer.setAttribute('cx', x + cell * 3.5);
      outer.setAttribute('cy', y + cell * 3.5);
      outer.setAttribute('r', cell * 3.5);
      outer.setAttribute('fill', eyeRingColor);
      outer.setAttribute('mask', `url(#mask_${uid})`);
      gEye.appendChild(outer);
    } else {
      const outer = document.createElementNS(ns, 'rect');
      outer.setAttribute('x', x);
      outer.setAttribute('y', y);
      outer.setAttribute('width', 7 * cell);
      outer.setAttribute('height', 7 * cell);
      const rx = (eyeRingShape === 'Rounded') ? rRnd : 0;
      if (rx) { outer.setAttribute('rx', rx); outer.setAttribute('ry', rx); }
      outer.setAttribute('fill', eyeRingColor);
      outer.setAttribute('mask', `url(#mask_${uid})`);
      gEye.appendChild(outer);
    }

    // Center
    if (eyeCenterMode === 'Emoji') {
      const ecScale = Math.max(0.1, Math.min(3, parseFloat(eyeCenterScale) || 0.9));
      const ecSize = cell * 3 * ecScale;
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', x + cell * 3.5);
      t.setAttribute('y', y + cell * 3.5);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-size', String(Math.floor(ecSize)));
      t.setAttribute('font-family', 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, system-ui, sans-serif');
      t.textContent = eyeCenterEmoji || '👁️';
      gEye.appendChild(t);
    } else if (eyeCenterShape === 'Circle') {
      gEye.appendChild(drawCircle(x + cell * 3.5, y + cell * 3.5, cell * 1.5, eyeCenterColor));
    } else {
      const rx = eyeCenterShape === 'Rounded' ? rRnd : 0;
      gEye.appendChild(drawRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3, eyeCenterColor, rx, rx));
    }
  }

  // TL, TR, BL eyes
  drawEye(0, 0);
  drawEye(n - 7, 0);
  drawEye(0, n - 7);

  svg.style.display = 'block';
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';

  return svg;
}

// =====================================================
//  Compose Card SVG (background + QR + caption)
// =====================================================

function composeCardSvg({
  cardWidth,
  transparentBg,
  bgTopColor,
  bgBottomColor,
  bgTopAlpha,
  bgBottomAlpha,
  captionHeadline,
  captionBody,
  captionColor,
  ecc,
  modulesShape, bodyColor,
  eyeRingColor, eyeCenterColor,
  eyeRingShape, eyeCenterShape,
  eyeCenterMode, eyeCenterScale, eyeCenterEmoji,
  modulesMode, modulesScale, modulesEmoji,
  centerMode, centerScale, centerEmoji,
}) {
  const NS = "http://www.w3.org/2000/svg";

  // Normalize caption content
  const headTextRaw = (captionHeadline || '').trim();
  const bodyTextRaw = (captionBody || '').replace(/\r/g, '').trim();

  const bodyParts = bodyTextRaw ? bodyTextRaw.split('\n') : [];
  const bodyLine1 = (bodyParts[0] || '').trim();
  const bodyLine2 = (bodyParts[1] || '').trim();

  const hasHeadline = !!headTextRaw;
  const hasBody1 = !!bodyLine1;
  const hasBody2 = !!bodyLine2;
  const hasAnyBody = hasBody1 || hasBody2;
  const hasAnyCaption = hasHeadline || hasAnyBody;

  // Geometry
  let cardHeight;
  if (!hasAnyCaption) {
    cardHeight = cardWidth;
  } else {
    cardHeight = Math.round(cardWidth / 0.63);
  }

  const OUTER_PAD = Math.round(cardWidth * 0.06);
  const CAP_SIDE = Math.round(cardWidth * 0.08);
  const CAP_TOPPAD = Math.round(cardWidth * 0.05);
  const CAP_BOTPAD = Math.round(cardWidth * 0.06);
  const QR_FRACTION = 0.75;

  // Corner radius
  let RADIUS = Math.round(cardWidth * 0.07);
  const host2 = document.getElementById('qrPreview');
  if (host2) {
    const cs2 = getComputedStyle(host2);
    const w2 = host2.clientWidth || parseFloat(cs2.width) || cardWidth;
    const token2 = parseFloat(cs2.getPropertyValue('--phone-radius')) ||
                   parseFloat(cs2.borderTopLeftRadius) || 0;
    if (w2 > 0 && token2 > 0) {
      const scale = cardWidth / w2;
      const drawable = cardWidth - OUTER_PAD * 2;
      const maxRx = Math.floor(drawable / 2);
      RADIUS = Math.max(1, Math.min(Math.round(token2 * scale), maxRx));
    }
  }

  // Outer SVG
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(cardWidth));
  svg.setAttribute('height', String(cardHeight));
  svg.setAttribute('viewBox', `0 0 ${cardWidth} ${cardHeight}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const qrSize = Math.round(cardWidth * QR_FRACTION);
  const qrX = Math.round((cardWidth - qrSize) / 2);
  const SIDE = Math.round((cardWidth - qrSize) / 2);
  let qrY;

  if (!hasAnyCaption) {
    qrY = Math.round((cardHeight - qrSize) / 2);
  } else {
    qrY = SIDE;
  }

  // Build inner QR SVG
  const innerQR = buildQrSvg({
    text: buildText(),
    size: qrSize,
    level: ecc,
    modulesShape, bodyColor,
    eyeRingColor, eyeCenterColor,
    eyeRingShape, eyeCenterShape,
    eyeCenterMode, eyeCenterScale, eyeCenterEmoji,
    modulesMode, modulesScale, modulesEmoji,
    centerMode, centerScale, centerEmoji,
    transparentBg: true,
    bgColor: '#000000',
    bare: true
  });

  innerQR.setAttribute('x', String(qrX));
  innerQR.setAttribute('y', String(qrY));
  innerQR.setAttribute('width', String(qrSize));
  innerQR.setAttribute('height', String(qrSize));
  svg.appendChild(innerQR);

  if (!hasAnyCaption) {
    return svg;
  }

  // Caption region
  const capY0 = qrY + qrSize + CAP_TOPPAD;
  const capWidth = cardWidth - CAP_SIDE * 2;
  const capMaxH = (cardHeight - OUTER_PAD) - CAP_BOTPAD - capY0;
  const centerX = cardWidth / 2;
  const fontFamily = typeof window.getPreviewFont === 'function' ? window.getPreviewFont() : 'Work Sans, system-ui, sans-serif';
  const lineGap = 1.15;

  const segments = [];
  let totalH = 0;

  // Headline
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

  // Body line 1
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
      const gap = segments.length ? segments[0].size * 0.40 : 0;
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

  // Body line 2
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
      const gap = Math.round(prevSize * 0.25);
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

  // Vertically center text stack
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

// =====================================================
//  Main Render Function
// =====================================================

function render() {
  let preview = document.getElementById('qrPreview');
  let mount = document.getElementById('qrMount');

  // Self-heal if nodes missing
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

  // QRCode lib loads async; retry if not ready
  if (!window.QRCode || !window.QRCode.CorrectLevel) {
    try { mount.innerHTML = ''; } catch (e) {}
    clearTimeout(render._qrRetry);
    render._qrRetry = setTimeout(render, 60);
    return;
  }

  // Helpers
  const toHex = (v) => {
    if (!v) return null;
    v = String(v).trim();
    const short = /^#([0-9a-f]{3})$/i;
    const full = /^#([0-9a-f]{6})$/i;
    if (short.test(v)) return ('#' + v.slice(1).split('').map(c => c + c).join('')).toUpperCase();
    if (full.test(v)) return v.toUpperCase();
    return null;
  };

  // Background
  try { if (typeof window.refreshBackground === 'function') window.refreshBackground(); } catch (e) {}

  // Caption
  const headline = (document.getElementById('campaign')?.value || '').trim().slice(0, 20);
  const body = (document.getElementById('captionBody')?.value || '').trim().slice(0, 60);
  const hasCaption = !!(headline || body);

  // Aspect ratio
  const stageEl = preview.closest('.preview-stage');
  if (stageEl) {
    stageEl.style.aspectRatio = hasCaption ? '0.63 / 1' : '1 / 1';
  }

  // Transparent check
  const topRaw = parseFloat(document.getElementById('bgTopAlpha')?.value);
  const botRaw = parseFloat(document.getElementById('bgBottomAlpha')?.value);
  const topA = (Number.isFinite(topRaw) ? topRaw : 100) / 100;
  const botA = (Number.isFinite(botRaw) ? botRaw : 100) / 100;
  const isTransparent = (topA <= 0.001 && botA <= 0.001);

  preview.classList.toggle('card--stroke', isTransparent);
  preview.classList.toggle('card--fill', !isTransparent);

  // Card width
  const rect = preview.getBoundingClientRect();
  const cardWidth = Math.max(rect.width || preview.clientWidth || 320, 320);

  // ECC
  const ecc = typeof window.getECC === 'function' ? window.getECC() : 'M';

  // Build text
  const rawTrim = String(typeof window.buildText === 'function' ? window.buildText() : '').trim();
  if (!rawTrim) { try { mount.innerHTML = ''; } catch (e) {} return; }

  let svg;
  try {
    svg = composeCardSvg({
      cardWidth,
      transparentBg: isTransparent,
      bgTopColor: colorHex('bgTopColor', '#FFFFFF') || '#FFFFFF',
      bgBottomColor: colorHex('bgBottomColor', '#FFFFFF') || '#FFFFFF',
      bgTopAlpha: Math.max(0, Math.min(100, parseFloat(document.getElementById('bgTopAlpha')?.value || '100'))),
      bgBottomAlpha: Math.max(0, Math.min(100, parseFloat(document.getElementById('bgBottomAlpha')?.value || '100'))),
      captionHeadline: hasCaption ? headline : '',
      captionBody: hasCaption ? body : '',
      captionColor: colorHex('captionColor', '#000000'),
      ecc,
      modulesShape: document.getElementById('moduleShape')?.value || 'Square',
      bodyColor: colorHex('bodyColor', '#000000'),
      eyeRingColor: colorHex('eyeRingColor', '#000000'),
      eyeCenterColor: colorHex('eyeCenterColor', '#000000'),
      eyeRingShape: document.getElementById('eyeRingShape')?.value || 'Square',
      eyeCenterShape: document.getElementById('eyeCenterShape')?.value || 'Square',
      eyeCenterMode: document.getElementById('eyeCenterMode')?.value || 'Shape',
      eyeCenterScale: parseFloat(document.getElementById('eyeCenterScale')?.value || '0.9'),
      eyeCenterEmoji: document.getElementById('eyeCenterEmoji')?.value || '👁️',
      modulesMode: document.getElementById('modulesMode')?.value || 'Shape',
      modulesScale: parseFloat(document.getElementById('modulesScale')?.value || '0.9'),
      modulesEmoji: document.getElementById('modulesEmoji')?.value || '😀',
      centerMode: document.getElementById('centerMode')?.value || 'None',
      centerScale: parseFloat(document.getElementById('centerScale')?.value || '1'),
      centerEmoji: document.getElementById('centerEmoji')?.value || '😊',
    });
  } catch (e) {
    console.error('render(): composeCardSvg failed', e);
    mount.innerHTML = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'font: 12px/1.4 system-ui; padding: 10px; color: #b00020;';
    msg.textContent = 'Preview error: ' + (e && e.message ? e.message : String(e));
    mount.appendChild(msg);
    return;
  }

  // Mount SVG
  mount.innerHTML = '';
  mount.appendChild(svg);

  // Ensure transparency
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

window.render = render;

// Wire re-render events
if (!render._wired) {
  const _rerender = () => {
    if (window.__CODEDESK_IMPORTING_STATE__ || window.__CODEDESK_APPLYING_TEMPLATE__) return;
    clearTimeout(render._t);
    render._t = setTimeout(render, 30);
  };

  document.addEventListener('input', _rerender, true);
  document.addEventListener('change', _rerender, true);
  document.addEventListener('keyup', (e) => {
    if (!e) return;
    _rerender();
  }, true);

  window.addEventListener('resize', () => _rerender());
  document.getElementById('qrType')?.addEventListener('change', () => setTimeout(_rerender, 0));

  queueMicrotask(() => { try { _rerender(); } catch (e) {} });

  render._wired = true;
}

// =====================================================
//  Design Panel Gating
// =====================================================

function refreshModulesMode() {
  const mode = document.getElementById('modulesMode')?.value || 'Shape';
  const emojiInp = document.getElementById('modulesEmoji');
  const scaleInp = document.getElementById('modulesScale');

  const shapeSel =
    document.getElementById('modules') ||
    document.getElementById('moduleShape') ||
    document.querySelector('[name="modules"]');

  const bodyHex =
    document.getElementById('bodyHex') ||
    document.querySelector('[data-field="body"] input[type="text"]');
  const bodySwatch =
    document.getElementById('bodyColor') ||
    document.querySelector('[data-field="body"] input[type="color"]');

  const emojiRow = emojiInp?.closest('label');
  const scaleRow = scaleInp?.closest('label');
  const shapeRow = shapeSel?.closest('label');
  const bodyRow = (bodyHex?.closest('label')) || (bodySwatch?.closest('label'));

  const isEmoji = (mode === 'Emoji');

  if (emojiInp) emojiInp.disabled = !isEmoji;
  if (emojiRow) emojiRow.classList.toggle('field-muted', !isEmoji);

  if (shapeSel) shapeSel.disabled = isEmoji;
  if (shapeRow) shapeRow.classList.toggle('field-muted', isEmoji);

  if (bodyHex) bodyHex.disabled = isEmoji;
  if (bodySwatch) bodySwatch.disabled = isEmoji;
  if (bodyRow) bodyRow.classList.toggle('field-muted', isEmoji);
}

window.refreshModulesMode = refreshModulesMode;

function refreshCenter() {
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

window.refreshCenter = refreshCenter;

function refreshEyeCenter() {
  const mode = document.getElementById('eyeCenterMode')?.value || 'Shape';
  const emojiInp = document.getElementById('eyeCenterEmoji');
  const scaleInp = document.getElementById('eyeCenterScale');
  const shapeSel = document.getElementById('eyeCenterShape');
  const colorPicker = document.getElementById('eyeCenterColor');
  const colorHex = document.getElementById('eyeCenterColorHex');

  const emojiRow = emojiInp?.closest('label');
  const scaleRow = scaleInp?.closest('label');
  const shapeRow = shapeSel?.closest('label');
  const colorRow = colorPicker?.closest('label');

  const isEmoji = (mode === 'Emoji');

  if (emojiInp) emojiInp.disabled = !isEmoji;
  if (scaleInp) scaleInp.disabled = !isEmoji;
  if (shapeSel) shapeSel.disabled = isEmoji;
  if (colorPicker) colorPicker.disabled = isEmoji;
  if (colorHex) colorHex.disabled = isEmoji;

  if (emojiRow) emojiRow.classList.toggle('field-muted', !isEmoji);
  if (scaleRow) scaleRow.classList.toggle('field-muted', !isEmoji);
  if (shapeRow) shapeRow.classList.toggle('field-muted', isEmoji);
  if (colorRow) colorRow.classList.toggle('field-muted', isEmoji);
}

window.refreshEyeCenter = refreshEyeCenter;

function wireDesignGatesOnce() {
  if (wireDesignGatesOnce._done) return;

  const mm = document.getElementById('modulesMode');
  const cm = document.getElementById('centerMode');
  const ecm = document.getElementById('eyeCenterMode');

  if (!mm || !cm || !ecm) {
    requestAnimationFrame(wireDesignGatesOnce);
    return;
  }

  mm.addEventListener('change', () => { refreshModulesMode(); render(); }, { passive: true });
  cm.addEventListener('change', () => { refreshCenter(); render(); }, { passive: true });
  ecm.addEventListener('change', () => { refreshEyeCenter(); render(); }, { passive: true });

  refreshModulesMode();
  refreshCenter();
  refreshEyeCenter();

  wireDesignGatesOnce._done = true;
}

window.wireDesignGatesOnce = wireDesignGatesOnce;

// =====================================================
//  Export Helpers
// =====================================================

function getCurrentSvgNode() {
  return document.querySelector('#qrMount svg');
}

window.getCurrentSvgNode = getCurrentSvgNode;

function applyPhoneBackgroundForExport(svgEl) {
  svgEl.querySelector('[data-export-bg]')?.remove();
  return; // background now handled in PNG export; keep SVG transparent
}

function downloadSvg(filename = 'qr.svg') {
  const src = getCurrentSvgNode();
  if (!src) return;

  const svg = src.cloneNode(true);
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

window.downloadSvg = downloadSvg;

async function downloadPng(filename = 'qr.png', scale = 3) {
  const src = getCurrentSvgNode();
  if (!src) return;

  const svg = src.cloneNode(true);
  applyPhoneBackgroundForExport(svg);

  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));

  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise(res => { img.onload = res; img.src = url; });

  const w = img.naturalWidth || parseInt(svg.getAttribute('width')) || 512;
  const h = img.naturalHeight || parseInt(svg.getAttribute('height')) || 512;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');

  // Background
  const topA = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
  const botA = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);
  const transparent = (topA <= 0 && botA <= 0);

  if (!transparent) {
    const topHex = document.getElementById('bgTopHex')?.value
                || document.getElementById('bgTopColor')?.value || '#FFFFFF';
    const botHex = document.getElementById('bgBottomHex')?.value
                || document.getElementById('bgBottomColor')?.value || '#FFFFFF';

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

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, rgba(topHex, topA));
    grad.addColorStop(1, rgba(botHex, botA));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) {}
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

window.downloadPng = downloadPng;

// Export PNG as data URL (for FileRoom upsert)
async function codedeskExportPngDataUrl(scale = 3) {
  const src = getCurrentSvgNode();
  if (!src) return '';

  const svg = src.cloneNode(true);
  applyPhoneBackgroundForExport(svg);

  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));

  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });

  const w = img.naturalWidth || parseInt(svg.getAttribute('width')) || 512;
  const h = img.naturalHeight || parseInt(svg.getAttribute('height')) || 512;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');

  // Background
  const topA = Number(document.getElementById('bgTopAlpha')?.value ?? 100);
  const botA = Number(document.getElementById('bgBottomAlpha')?.value ?? 100);
  const transparent = (topA <= 0 && botA <= 0);

  if (!transparent) {
    const topHex = document.getElementById('bgTopHex')?.value
                || document.getElementById('bgTopColor')?.value || '#FFFFFF';
    const botHex = document.getElementById('bgBottomHex')?.value
                || document.getElementById('bgBottomColor')?.value || '#FFFFFF';

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

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, rgba(topHex, topA));
    grad.addColorStop(1, rgba(botHex, botA));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) {}
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[codedeskExportPngDataUrl] toDataURL failed:', e);
    return '';
  }
}

window.codedeskExportPngDataUrl = codedeskExportPngDataUrl;

// =====================================================
//  Boot: Initial render + design gates
// =====================================================

function bootRenderEngine() {
  // Wire design gates after DOM is ready
  try { wireDesignGatesOnce(); } catch (e) {}

  // Initial render
  requestAnimationFrame(() => {
    if (typeof render === 'function') render();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootRenderEngine, { once: true });
} else {
  try { bootRenderEngine(); } catch (e) { console.error('[bootRenderEngine]', e); }
}

} // end guard
