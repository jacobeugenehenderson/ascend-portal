// ===== job-editor.js — English job workspace =====

// Get a query parameter from the URL
function getQueryParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

const SPREADSHEET_ID = getQueryParam('id');

if (!SPREADSHEET_ID) {
  document.body.innerHTML = '<p>Missing ?id= parameter in URL.</p>';
  throw new Error('Missing ?id in URL');
}

// Style labels for the dropdown (must match column A in STYLES sheet)
let STYLE_OPTIONS = [
  'Headline',
  'Subheadline',
  'Body',
  'CTA',
  'Bullet',
  'Section divider'
];

// Dynamic style definition cache from the STYLES sheet
let STYLE_DEFINITIONS = [];

// Fallback map (old behavior) if STYLES sheet doesn't provide a CSS class
const FALLBACK_STYLE_CLASS_MAP = {
  'Headline': 'style-headline',
  'Subheadline': 'style-subheadline',
  'Body': 'style-body',
  'CTA': 'style-cta',
  'Bullet': 'style-bullet',
  'Section divider': 'style-divider'
};

// Look up CSS class for a given style label, based on STYLE_DEFINITIONS,
// with a fallback to the hardcoded map.
function getCssClassForStyle(styleLabel) {
  let css = '';

  // 1) Try dynamic STYLES data first
  if (STYLE_DEFINITIONS && STYLE_DEFINITIONS.length) {
    const def = STYLE_DEFINITIONS.find(
      (s) => s.styleLabel === styleLabel || s.StyleLabel === styleLabel
    );
    if (def) {
      css =
        def.additionalCssClass ||
        def.AdditionalCSSClass ||
        '';
    }
  }

  // 2) Fall back to the legacy map if no CSS class was found
  if (!css) {
    css = FALLBACK_STYLE_CLASS_MAP[styleLabel] || '';
  }

  return css;
}

// Escape text for safe HTML rendering
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Decide what to show in the Committed column.
// - If working text exists, use that as the live preview.
// - Otherwise, show the committed text.
// - For Bullet style, bold the text before the first " - ".
function formatSegmentPreview(committedText, workingText, styleLabel) {
  const committed = committedText == null ? '' : String(committedText);
  const working = workingText == null ? '' : String(workingText);

  // Prefer working text if present; otherwise committed text
  const baseText = working.length ? working : committed;
  const safeText = baseText == null ? '' : String(baseText);

  if (styleLabel === 'Bullet') {
    const dashIndex = safeText.indexOf(' - ');
    if (dashIndex > 0) {
      const before = safeText.slice(0, dashIndex);
      const after = safeText.slice(dashIndex + 3); // skip " - "
      return (
        '<strong>' +
        escapeHtml(before) +
        '</strong> - ' +
        escapeHtml(after)
      );
    }
  }

  // Default: fully escaped plain text
  return escapeHtml(safeText);
}

// Render the header info into #job-header

function formatDateTime(value) {
  if (!value) return '';
  // Apps Script JSON usually serializes Date as ISO string
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function setStatus(message, isError = false) {
  const el = document.getElementById('countdown');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('status-error', !!isError);
}

function renderHeader(header) {
  const nameEl = document.getElementById('job-name');
  const metaEl = document.getElementById('job-meta');

  if (nameEl) {
    nameEl.textContent = header.jobName || '(Untitled job)';
  }

  if (metaEl) {
    const bits = [];

    if (header.jobId) {
      bits.push(`Job ID: ${header.jobId}`);
    }
    if (header.createdAt) {
      bits.push(`Created: ${formatDateTime(header.createdAt)}`);
    }
    if (header.cutoff) {
      bits.push(`Cutoff: ${formatDateTime(header.cutoff)}`);
    }
    if (header.nightly) {
      bits.push(`Nightly time: ${header.nightly}`);
    }
    if (header.timezone) {
      bits.push(`TZ: ${header.timezone}`);
    }
    if (header.collaborators) {
      bits.push(`Collaborators: ${header.collaborators}`);
    }

    metaEl.textContent = bits.join(' • ');
  }
}

function applyStyleClass(textarea, styleLabel) {
  if (!textarea) return;

  // Prefer dynamic CSS class from STYLES sheet
  const cssFromStyles = getCssClassForStyle(styleLabel);
  const cssClass = cssFromStyles || 'style-body';

  // Remove any existing style-* classes
  textarea.classList.forEach(cls => {
    if (cls.startsWith('style-')) {
      textarea.classList.remove(cls);
    }
  });

  // Add the one we want
  if (cssClass) {
    textarea.classList.add(cssClass);
  }
}

function renderSegments(segments) {
  const table = document.getElementById('segments-table');
  const tbody = document.getElementById('segments-body');
  const emptyState = document.getElementById('segments-empty');

  if (!tbody || !table) return;

  tbody.innerHTML = '';

  if (!segments || !segments.length) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  if (emptyState) emptyState.style.display = 'none';

  segments.forEach(seg => {
    const tr = document.createElement('tr');
    tr.dataset.segmentId = seg.segmentId || '';

    // 1. Committed English (locked)
    const committedTd = document.createElement('td');
    committedTd.textContent = seg.committed || '';
    tr.appendChild(committedTd);

    // 2. Style (dropdown)
    const styleTd = document.createElement('td');
    const styleSelect = document.createElement('select');
    styleSelect.className = 'seg-style-select';
    styleSelect.dataset.segmentId = seg.segmentId || '';

    STYLE_OPTIONS.forEach(label => {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      styleSelect.appendChild(opt);
    });

    styleSelect.value = seg.style || STYLE_OPTIONS[0];
    styleTd.appendChild(styleSelect);
    tr.appendChild(styleTd);

    // 3. Working English (textarea)
    const workingTd = document.createElement('td');
    const textarea = document.createElement('textarea');
    textarea.className = 'seg-working-input';
    textarea.value = seg.working || '';
    textarea.dataset.segmentId = seg.segmentId || '';
    textarea.addEventListener('blur', handleWorkingBlur);
    workingTd.appendChild(textarea);
    tr.appendChild(workingTd);

    // Apply initial style class
    applyStyleClass(textarea, seg.style || STYLE_OPTIONS[0]);

    // When dropdown changes, update textarea styling and persist immediately
    styleSelect.addEventListener('change', () => {
      const newStyle = styleSelect.value;
      applyStyleClass(textarea, newStyle);

      const rowEl = textarea.closest('tr');
      const segmentId = textarea.dataset.segmentId;
      const newText = textarea.value;

      saveSegment(rowEl, segmentId, newText, newStyle);
    });

    tbody.appendChild(tr);
  });
}

async function saveSegment(rowEl, segmentId, newText, styleLabel) {
  if (!segmentId) {
    return;
  }

  try {
    setStatus('Saving…');

    const res = await updateSegment(
      SPREADSHEET_ID,
      segmentId,
      newText,
      styleLabel
    );

    if (!res || res.ok === false) {
      console.error('updateSegment error:', res);
      setStatus('Error saving segment.', true);
      return;
    }

    // Optimistically update LastEditor / LastEditTime using the response
    if (rowEl) {
      const editorCell = rowEl.querySelector('.seg-last-editor');
      const timeCell = rowEl.querySelector('.seg-last-edit-time');

      if (editorCell && res.lastEditor) {
        editorCell.textContent = res.lastEditor;
      }

      if (timeCell && res.lastEditTime) {
        timeCell.textContent = formatDateTime(res.lastEditTime);
      }
    }

    setStatus('Saved.');
    // Optional: clear status after a moment
    setTimeout(() => setStatus(''), 1000);
  } catch (err) {
    console.error('updateSegment exception:', err);
    setStatus('Error saving segment.', true);
  }
}

async function handleWorkingBlur(event) {
  const textarea = event.target;
  const rowEl = textarea.closest('tr');
  const segmentId = textarea.dataset.segmentId;
  const newText = textarea.value;

  const styleSelect = rowEl
    ? rowEl.querySelector('.seg-style-select')
    : null;
  const styleLabel = styleSelect ? styleSelect.value : null;

  saveSegment(rowEl, segmentId, newText, styleLabel);
}

async function loadJob() {
  try {
    setStatus('Loading job…');
    const res = await getJob(SPREADSHEET_ID);

    // Capture the latest getJob payload for debugging
    window.__lastGetJob = res;
    console.log('getJob response:', res);

    document.body.setAttribute('data-debug-header', JSON.stringify(res.header || {}));

    if (!res || res.ok === false) {
      console.error('getJob error:', res);
      document.body.innerHTML = '<p>Error loading job.</p>';
      return;
    }

    // Inject dynamic CSS for styles, if provided
    if (res.stylesCss) {
      const styleTag = document.createElement('style');
      styleTag.textContent = res.stylesCss;
      document.head.appendChild(styleTag);
    }

    // Load styles from backend, if present; keep defaults as fallback
    if (Array.isArray(res.styles) && res.styles.length) {
      const labels = res.styles
        .map(s => s.styleLabel || s.StyleLabel)
        .filter(Boolean);

      if (labels.length) {
        STYLE_DEFINITIONS = res.styles;
        STYLE_OPTIONS = labels;
      }
    }

    renderHeader(res.header || {});
    renderSegments(res.segments || []);

    setStatus('');
  } catch (err) {
    console.error('getJob exception:', err);
    document.body.innerHTML = '<p>Error loading job.</p>';
  }
}

// Kick off once DOM is ready
document.addEventListener('DOMContentLoaded', loadJob);