// ===== CONFIG =====
const TEMPLATE_SPREADSHEET_ID = SpreadsheetApp.getActive().getId();  // MASTER_TEMPLATE
const JOB_EN_SHEET_NAME = 'JOB_EN';
const CONTROL_PANEL_SHEET_NAME = 'CONTROL_PANEL';
const STYLES_SHEET_NAME = 'STYLE';

// Bump this any time you want to be SURE the frontend is hitting new code
const COPYDESK_API_VERSION = 'copydesk_API-2025-12-01-v1';

// Where to put new job copies in Drive (for now, parent of template)
function getJobsFolder_() {
  const templateFile = DriveApp.getFileById(TEMPLATE_SPREADSHEET_ID);
  const parent = templateFile.getParents().hasNext()
    ? templateFile.getParents().next()
    : DriveApp.getRootFolder();
  // You can later change this to a specific 'Jobs' subfolder.
  return parent;
}

function jsonResponse_(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};
    const action = body.action;

    if (action === 'createEnglishJob') {
      return jsonResponse_(handleCreateEnglishJob_(body));
    } else if (action === 'updateSegment') {
      return jsonResponse_(handleUpdateSegment_(body));
    } else if (action === 'getJob') {
      return jsonResponse_(handleGetJob_(body));
    } else {
      return jsonResponse_({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse_({ error: err.toString(), stack: err.stack });
  }
}

function handleUpdateSegment_(body) {
  const { spreadsheetId, segmentId, workingText, styleLabel } = body;

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);

  // Read rows 11+ (A–F)
  const startRow = 11;
  const lastRow = sheet.getLastRow();
  const numRows = lastRow - startRow + 1;

  const data = sheet.getRange(startRow, 1, numRows, 6).getValues();

  // Locate the matching segmentId in Column D
  let targetRow = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i][3] === segmentId) {  // Column D index = 3
      targetRow = startRow + i;
      break;
    }
  }

  if (!targetRow) {
    throw new Error("Segment not found: " + segmentId);
  }

  // Update Style (Column B), if provided
  if (styleLabel != null) {
    sheet.getRange(targetRow, 2).setValue(styleLabel);
  }

  // Update Working English (Column C)
  sheet.getRange(targetRow, 3).setValue(workingText);

  // Update LastEditor / LastEditTime (Columns E and F)
  const user = Session.getActiveUser().getEmail() || "SYSTEM";
  const now = new Date();

  sheet.getRange(targetRow, 5).setValue(user);
  sheet.getRange(targetRow, 6).setValue(now);

  return {
    ok: true,
    segmentId,
    row: targetRow,
    styleLabel: styleLabel || null,
    lastEditor: user,
    lastEditTime: now
  };
}

function handleGetJob_(body) {
  try {
    const { spreadsheetId } = body;

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(JOB_EN_SHEET_NAME);

    if (!sheet) {
      return {
        ok: false,
        error: 'JOB_EN sheet not found in spreadsheet ' + spreadsheetId
      };
    }

    // ----- HEADER (B1–B7) -----
    const header = {
      jobId: sheet.getRange("B1").getValue(),
      jobName: sheet.getRange("B2").getValue(),
      createdAt: sheet.getRange("B3").getValue(),
      cutoff: sheet.getRange("B4").getValue(),
      timezone: sheet.getRange("B5").getValue(),
      nightly: sheet.getRange("B6").getValue(),
      collaborators: sheet.getRange("B7").getValue()
    };

    // ----- SEGMENTS -----
    // Read all real data (no guessing with getLastRow).
    const data = sheet.getDataRange().getValues();

    // Row 1 in Sheets = index 0 here; segment table starts at row 11.
    const startRowIndex = 10; // row 11

    const segments = [];

    for (let i = startRowIndex; i < data.length; i++) {
      const row = data[i];

      // A=0, B=1, C=2, D=3, E=4, F=5
      const segmentId = row[3];

      // Only keep real segment rows (must have SegmentID in col D).
      if (!segmentId) {
        continue;
      }

      segments.push({
        committed: row[0],      // Col A
        style: row[1],          // Col B
        working: row[2],        // Col C
        segmentId: segmentId,   // Col D
        lastEditor: row[4],     // Col E
        lastEditTime: row[5]    // Col F
      });
    }

    // ----- STYLES (from this job's STYLE/STYLES sheet) -----
    const styles = buildStylesPayload_(ss);

    return {
      ok: true,
      apiVersion: COPYDESK_API_VERSION,
      header: header,
      segments: segments,
      styles: styles,
      stylesCss: buildStylesCss_(styles),
      stylesDebug: getStylesDebug_(ss),
      // SUPER loud marker so we know this code is running
      testMarker: 'HELLO_FROM_NEW_DEPLOYMENT'
    };
    
  } catch (err) {
    return {
      ok: false,
      error: err.toString(),
      stack: err.stack
    };
  }
}

function handleCreateEnglishJob_(body) {
  const jobName = body.jobName || 'Untitled Job';
  const seedText = body.seedText || '';
  const cutoff = body.cutoff || '';        // ISO string or empty
  const collaborators = body.collaborators || []; // array of emails

  const templateFile = DriveApp.getFileById(TEMPLATE_SPREADSHEET_ID);
  const jobsFolder = getJobsFolder_();
  const newFileName = `JOB_EN_${new Date().toISOString()}_${jobName}`;
  const copyFile = templateFile.makeCopy(newFileName, jobsFolder);
  const ss = SpreadsheetApp.open(copyFile);
  const jobSheet = ss.getSheetByName(JOB_EN_SHEET_NAME);

  // Generate a jobId (you can adjust format later)
  const jobId = 'JOB_' + Utilities.getUuid();

  // Header writes
  jobSheet.getRange('B1').setValue(jobId);
  jobSheet.getRange('B2').setValue(jobName || '');
  jobSheet.getRange('B3').setValue(new Date());
  
  if (cutoff) {
    const cutoffDate = new Date(cutoff);
    jobSheet.getRange('B4').setValue(
      isNaN(cutoffDate.getTime()) ? cutoff : cutoffDate
    );
  }
  jobSheet.getRange('B5').setValue('US/Eastern');
  jobSheet.getRange('B6').setValue('00:00');

  // Collaborators: join with commas for now
  if (collaborators.length) {
    jobSheet.getRange('B7').setValue(collaborators.join(', '));
  }

  // Seed text → segments (simple v0: split by double newline)
  const segments = seedText
    ? seedText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
    : [];

  const startRow = 11;
  const defaultStyle = 'Body';

  if (segments.length) {
    const values = [];
    const now = new Date();
    segments.forEach((segText, idx) => {
      const segId = 'seg_' + (idx + 1);

    values.push([
      segText,       // A: Committed English (initial source text)
      defaultStyle,  // B: StyleLabel
      segText,       // C: Working English (start equal to committed)
      segId,         // D: SegmentID
      Session.getActiveUser().getEmail() || 'SYSTEM', // E: LastEditor
      now            // F: LastEditTime
    ]);

    });

    jobSheet.getRange(startRow, 1, values.length, values[0].length).setValues(values);
  }

    collaborators.forEach(email => {
    copyFile.addEditor(email);
    });

  return {
    ok: true,
    jobId: jobId,
    spreadsheetId: ss.getId(),
    seedSegments: segments.length
  };
}

/**
 * Build a CSS string from the styles array.
 * Each row generates something like:
 * .style-body { font-size: 14px; font-weight: 400; line-height: 1.4; color: #222222; }
 */
function buildStylesCss_(styles) {
  if (!styles || !styles.length) return '';

  // Fallback map from StyleLabel -> class name, mirroring the frontend
  var LABEL_TO_CLASS_MAP = {
    'Headline': 'style-headline',
    'Subheadline': 'style-subheadline',
    'Body': 'style-body',
    'CTA': 'style-cta',
    'Bullet': 'style-bullet',
    'Section divider': 'style-divider'
  };

  var lines = [];

  styles.forEach(function(style) {
    var label = style.StyleLabel || style.styleLabel;
    var cssClass =
      style.AdditionalCSSClass ||
      style.additionalCssClass ||
      (label ? LABEL_TO_CLASS_MAP[label] : '');

    // If we still don't have a class name, skip this row
    if (!cssClass) {
      return;
    }

    var fontFamily = style.FontFamily || '';
    var fontSize = style.FontSize || '';
    var fontWeight = style.FontWeight || '';
    var lineHeight = style.LineHeight || '';
    var color = style.ColorHex || '';

    var rule = '.' + cssClass + ' {';

    if (fontFamily) {
      rule += ' font-family: ' + fontFamily + ';';
    }
    if (fontSize) {
      rule += ' font-size: ' + fontSize + ';';
    }
    if (fontWeight) {
      rule += ' font-weight: ' + fontWeight + ';';
    }
    if (lineHeight) {
      rule += ' line-height: ' + lineHeight + ';';
    }
    if (color) {
      rule += ' color: ' + color + ';';
    }

    rule += ' }';

    lines.push(rule);
  });

  return lines.join('\n');
}

function buildStylesPayload_(ss) {
  // Helper: fuzzy "STYLE"/"STYLES" name finder
  function findStyleSheet_(spreadsheet) {
    // Exact matches first
    var s =
      spreadsheet.getSheetByName(STYLES_SHEET_NAME) ||
      spreadsheet.getSheetByName('STYLES');
    if (s) return s;

    // Fuzzy match: ignore case and whitespace
    var sheets = spreadsheet.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName();
      var norm = name.replace(/\s+/g, '').toUpperCase();
      if (norm === 'STYLE' || norm === 'STYLES') {
        return sheets[i];
      }
    }
    return null;
  }

  // 1) Job spreadsheet STYLE/STYLES, if present
  var jobStyleSheet = findStyleSheet_(ss);

  // 2) MASTER_TEMPLATE STYLE/STYLES (fallback)
  var masterStyleSheet = null;
  try {
    var masterSs = SpreadsheetApp.openById(TEMPLATE_SPREADSHEET_ID);
    masterStyleSheet = findStyleSheet_(masterSs);
  } catch (e) {
    // If TEMPLATE_SPREADSHEET_ID is wrong, we’ll simply skip the fallback.
  }

  // Prefer job STYLE, fall back to MASTER STYLE
  var sheetToUse = jobStyleSheet || masterStyleSheet;
  if (!sheetToUse) {
    return [];
  }

  var values = sheetToUse.getDataRange().getValues() || [];

  // If job STYLE has only a header row, fall back to master if available
  if (jobStyleSheet && sheetToUse === jobStyleSheet && values.length <= 1 && masterStyleSheet) {
    sheetToUse = masterStyleSheet;
    values = sheetToUse.getDataRange().getValues() || [];
  }

  if (!values.length) {
    return [];
  }

  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var label = row[0]; // Column A

    // Skip empty rows and the header row
    if (!label || label === 'StyleLabel') {
      continue;
    }

    var fontFamily = row[1] || '';        // B
    var fontSize = row[2] || '';          // C
    var fontWeight = row[3] || '';        // D
    var colorHex = row[4] || '';          // E
    var lineHeight = row[5] || '';        // F
    var additionalCssClass = row[6] || '';// G
    var notes = row[7] || '';             // H

    out.push({
      // Lowercase keys
      styleLabel: label,
      fontFamily: fontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      colorHex: colorHex,
      lineHeight: lineHeight,
      additionalCssClass: additionalCssClass,
      notes: notes,
      // TitleCase duplicates for existing frontend lookups
      StyleLabel: label,
      FontFamily: fontFamily,
      FontSize: fontSize,
      FontWeight: fontWeight,
      ColorHex: colorHex,
      LineHeight: lineHeight,
      AdditionalCSSClass: additionalCssClass,
      Notes: notes
    });
  }

  return out;
}

function buildStylesCssFromStyles_(styles) {
  if (!styles || !styles.length) return '';

  var LABEL_TO_CLASS_MAP = {
    'Headline': 'style-headline',
    'Subheadline': 'style-subheadline',
    'Body': 'style-body',
    'CTA': 'style-cta',
    'Bullet': 'style-bullet',
    'Section divider': 'style-divider'
  };

  var lines = [];

  styles.forEach(function(style) {
    var label = style.StyleLabel || style.styleLabel;
    var cssClass =
      style.AdditionalCSSClass ||
      style.additionalCssClass ||
      (label ? LABEL_TO_CLASS_MAP[label] : '');

    if (!cssClass) {
      return; // no selector, skip
    }

    var fontFamily = style.FontFamily || style.fontFamily || '';
    var fontSize = style.FontSize || style.fontSize || '';
    var fontWeight = style.FontWeight || style.fontWeight || '';
    var lineHeight = style.LineHeight || style.lineHeight || '';
    var color = style.ColorHex || style.colorHex || '';

    var rule = '.' + cssClass + ' {';

    if (fontFamily) {
      rule += ' font-family: ' + fontFamily + ';';
    }
    if (fontSize) {
      rule += ' font-size: ' + fontSize + ';';
    }
    if (fontWeight) {
      rule += ' font-weight: ' + fontWeight + ';';
    }
    if (lineHeight) {
      rule += ' line-height: ' + lineHeight + ';';
    }
    if (color) {
      rule += ' color: ' + color + ';';
    }

    rule += ' }';

    lines.push(rule);
  });

  return lines.join('\n');
}

/**
 * TEMP debug helper: reports which sheets exist and what STYLE/STYLES
 * sheet (if any) the backend sees, and how many rows it has.
 */
function getStylesDebug_(ss) {
  var debug = {};

  try {
    // Job spreadsheet sheet names
    debug.jobSheets = ss.getSheets().map(function(sh) {
      return sh.getName();
    });

    // Job STYLE/STYLES sheet, if present (using the same fuzzy finder)
    var jobStyleSheet =
      ss.getSheetByName(STYLES_SHEET_NAME) ||
      ss.getSheetByName('STYLES');

    if (!jobStyleSheet) {
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        var name = sheets[i].getName();
        var norm = name.replace(/\s+/g, '').toUpperCase();
        if (norm === 'STYLE' || norm === 'STYLES') {
          jobStyleSheet = sheets[i];
          break;
        }
      }
    }

    if (jobStyleSheet) {
      var jobValues = jobStyleSheet.getDataRange().getValues();
      debug.jobStyleName = jobStyleSheet.getName();
      debug.jobStyleRowCount = jobValues.length;
      debug.jobStyleFirstRow = jobValues[0] || null;
    } else {
      debug.jobStyleName = null;
      debug.jobStyleRowCount = 0;
      debug.jobStyleFirstRow = null;
    }

    // MASTER_TEMPLATE spreadsheet + STYLE/STYLES sheet, if present
    var masterSs = SpreadsheetApp.openById(TEMPLATE_SPREADSHEET_ID);
    debug.masterSheets = masterSs.getSheets().map(function(sh) {
      return sh.getName();
    });

    var masterStyleSheet =
      masterSs.getSheetByName(STYLES_SHEET_NAME) ||
      masterSs.getSheetByName('STYLES');

    if (!masterStyleSheet) {
      var mSheets = masterSs.getSheets();
      for (var j = 0; j < mSheets.length; j++) {
        var mName = mSheets[j].getName();
        var mNorm = mName.replace(/\s+/g, '').toUpperCase();
        if (mNorm === 'STYLE' || mNorm === 'STYLES') {
          masterStyleSheet = mSheets[j];
          break;
        }
      }
    }

    if (masterStyleSheet) {
      var masterValues = masterStyleSheet.getDataRange().getValues();
      debug.masterStyleName = masterStyleSheet.getName();
      debug.masterStyleRowCount = masterValues.length;
      debug.masterStyleFirstRow = masterValues[0] || null;
    } else {
      debug.masterStyleName = null;
      debug.masterStyleRowCount = 0;
      debug.masterStyleFirstRow = null;
    }

  } catch (err) {
    debug.error = err.toString();
  }

  return debug;
}