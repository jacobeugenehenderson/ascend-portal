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
  const baseText = committed;
  const safeText = baseText == null ? '' : String(baseText);

  if (styleLabel === 'Bullet') {
    // Support " - ", " – ", or " — " patterns
    const dashVariants = [' - ', ' – ', ' — '];
    let foundVariant = null;
    let dashIndex = -1;

    for (let i = 0; i < dashVariants.length; i++) {
      const v = dashVariants[i];
      const idx = safeText.indexOf(v);
      if (idx > 0) {
        dashIndex = idx;
        foundVariant = v;
        break;
      }
    }

    if (dashIndex > 0 && foundVariant) {
      const before = safeText.slice(0, dashIndex);
      const after = safeText.slice(dashIndex + foundVariant.length);
      const dashChar = foundVariant.trim(); // '-', '–', or '—'
      return (
        '<strong>' +
        escapeHtml(before) +
        '</strong> ' +
        escapeHtml(dashChar) +
        ' ' +
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

function parseCutoffDate(value) {
  if (!value) return null;

  // Already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();

  // 1) Handle "YYYY-MM-DD" *and* "YYYY-MM-DDTHH:mm:ss.sssZ" etc
  //    by using only the date portion and ignoring time / timezone.
  const isoPrefixMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoPrefixMatch) {
    const year = parseInt(isoPrefixMatch[1], 10);
    const month = parseInt(isoPrefixMatch[2], 10) - 1; // 0-based
    const day = parseInt(isoPrefixMatch[3], 10);
    const d = new Date(year, month, day); // local midnight
    return isNaN(d.getTime()) ? null : d;
  }

  // 2) Handle "MM/DD/YY" or "MM/DD/YYYY" from Sheets-style display
  const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const month = parseInt(mdyMatch[1], 10) - 1;
    const day = parseInt(mdyMatch[2], 10);
    let year = parseInt(mdyMatch[3], 10);
    if (year < 100) {
      // Assume 20xx for 2-digit years
      year += 2000;
    }
    const d = new Date(year, month, day); // local midnight
    return isNaN(d.getTime()) ? null : d;
  }

  // 3) Fallback: let Date try its best
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateOnly(value) {
  const d = parseCutoffDate(value);
  if (!d) {
    return value ? String(value) : '';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}

function formatNightlyHuman(nightlyStr, timezone) {
  if (!nightlyStr && !timezone) return '';

  const tzLabel = timezone || 'US/Eastern';

  if (!nightlyStr) {
    return `Schedule: nightly (timezone ${tzLabel})`;
  }

  const parts = nightlyStr.split(':');
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1] || '0', 10);

  if (isNaN(hour)) {
    return `Nightly commit at ${nightlyStr} (${tzLabel})`;
  }

  // Special case: midnight
  if (hour === 0 && minute === 0) {
    return `Nightly commit at midnight (${tzLabel})`;
  }

  const ampm = hour < 12 ? 'AM' : 'PM';
  let h12 = hour % 12;
  if (h12 === 0) h12 = 12;
  const minutePadded = minute.toString().padStart(2, '0');

  return `Nightly commit at ${h12}:${minutePadded} ${ampm} (${tzLabel})`;
}

function setStatus(message, isError = false) {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('status-error', !!isError);
}

function renderHeader(header) {
  const nameEl = document.getElementById('job-name');
  const metaEl = document.getElementById('job-meta');
  const urgencyEl = document.getElementById('job-urgency');

  // Title
  if (nameEl) {
    nameEl.textContent = header.jobName || '(Untitled job)';
  }

  // Calm meta line: nightly schedule + collaborators
  if (metaEl) {
    const bits = [];

    const nightlyLine = formatNightlyHuman(header.nightly, header.timezone);
    if (nightlyLine) {
      bits.push(nightlyLine);
    }

    if (header.collaborators) {
      bits.push(`Collaborators: ${header.collaborators}`);
    }

    metaEl.textContent = bits.join(' • ');
  }

    // Urgency line: countdown to cutoff
  if (urgencyEl) {
    if (header.cutoff) {
      const cutoffDate = parseCutoffDate(header.cutoff);

      if (cutoffDate) {
        // For you: "cutoff" means the gate shuts at 00:00
        // at the start of that day (local time).
        const cutoffMoment = cutoffDate; // already 00:00 local
        const now = new Date();
        const diffMs = cutoffMoment.getTime() - now.getTime();

        if (diffMs <= 0) {
          urgencyEl.textContent =
            `Cutoff has passed (${formatDateOnly(cutoffDate)})`;
          urgencyEl.classList.add('cutoff-passed');
        } else {
          const totalMinutes = Math.floor(diffMs / 60000);
          const minutesPerDay = 60 * 24;
          const days = Math.floor(totalMinutes / minutesPerDay);
          const hours = Math.floor((totalMinutes % minutesPerDay) / 60);
          const minutes = totalMinutes % 60;

          const pieces = [];
          if (days > 0) {
            pieces.push(days === 1 ? '1 day' : `${days} days`);
          }
          if (hours > 0) {
            pieces.push(hours === 1 ? '1 hour' : `${hours} hours`);
          }
          // Only bother showing minutes once we're under a day
          if (days === 0 && minutes > 0) {
            pieces.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
          }
          if (pieces.length === 0) {
            pieces.push('less than 1 minute');
          }

          urgencyEl.textContent =
            `Cutoff in ${pieces.join(' ')} (${formatDateOnly(cutoffDate)})`;
          urgencyEl.classList.remove('cutoff-passed');
        }
      } else {
        // If cutoff wasn't parseable, fall back to plain text
        urgencyEl.textContent = `Cutoff: ${formatDateOnly(header.cutoff)}`;
        urgencyEl.classList.remove('cutoff-passed');
      }
    } else {
      urgencyEl.textContent = '';
      urgencyEl.classList.remove('cutoff-passed');
    }
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

    // Working vs committed style
    const committedStyleLabel = seg.styleCommitted || seg.style || STYLE_OPTIONS[0];
    const workingStyleLabel = seg.style || committedStyleLabel;

    // ===== Section divider special case (working style) =====
    if (workingStyleLabel === 'Section divider') {
      const dividerTd = document.createElement('td');
      // For now we keep 3 visible columns; this will become 4 once we add a delete column.
      dividerTd.colSpan = 3;
      dividerTd.className = 'seg-divider-cell';

      const dividerLine = document.createElement('hr');
      dividerLine.className = 'seg-divider-line';

      dividerTd.appendChild(dividerLine);
      tr.appendChild(dividerTd);
      tbody.appendChild(tr);
      return;
    }

    // ===== Normal segment row =====

    // 1. Committed English (display only, uses frozen committed style)
    const committedTd = document.createElement('td');
    committedTd.className = 'seg-committed';

    const initialPreviewHtml = formatSegmentPreview(
      seg.committed || '',
      '',  // committed view ignores working text
      committedStyleLabel
    );
    committedTd.innerHTML = initialPreviewHtml;

    // Apply style class to committed cell as well (purely presentational)
    const committedCssClass = getCssClassForStyle(committedStyleLabel);
    if (committedCssClass) {
      committedTd.classList.add(committedCssClass);
    }

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

    styleSelect.value = workingStyleLabel;
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

    // Apply initial style class to the working textarea
    applyStyleClass(textarea, workingStyleLabel);

    // When dropdown changes, update textarea styling and persist immediately
    styleSelect.addEventListener('change', () => {
      const newStyle = styleSelect.value;
      applyStyleClass(textarea, newStyle);

      const rowEl = textarea.closest('tr');
      const segmentId = textarea.dataset.segmentId;
      const newText = textarea.value;

      // Committed view remains frozen: keep using committedStyleLabel
      const previewHtml = formatSegmentPreview(
        seg.committed || '',
        '',
        committedStyleLabel
      );
      committedTd.innerHTML = previewHtml;

      // Re-apply committed style class in case anything else touched it
      committedTd.className = 'seg-committed';
      const frozenCssClass = getCssClassForStyle(committedStyleLabel);
      if (frozenCssClass) {
        committedTd.classList.add(frozenCssClass);
      }

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