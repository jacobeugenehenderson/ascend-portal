const SHEET_NAME = 'HANDSHAKES';

/**
 * Helper: get the handshake sheet.
 */
function getHandshakeSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('AscendAuth: Sheet "HANDSHAKES" not found.');
  }
  return sheet;
}

/**
 * Helper: find row index (1-based) for a given token, or 0 if not found.
 */
function findTokenRow_(sheet, token) {
  const range = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1); // col A, skip header
  const values = range.getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === token) {
      return i + 2; // +2 = compensate for 0-index + header row
    }
  }
  return 0;
}

/**
 * Helper: standard JSON response wrapper.
 */
function jsonResponse_(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Phone → POST { token, email } to complete handshake.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: 'No post data' });
    }

    const payload = JSON.parse(e.postData.contents);
    const token = (payload.token || '').toString().trim();
    const email = (payload.email || '').toString().trim().toLowerCase();

    if (!token || !email) {
      return jsonResponse_({ ok: false, error: 'Missing token or email' });
    }

    const sheet = getHandshakeSheet_();
    const now = new Date();
    let row = findTokenRow_(sheet, token);

    if (row === 0) {
      // New handshake row
      row = sheet.getLastRow() + 1;
      sheet.getRange(row, 1, 1, 4).setValues([[token, email, now, now]]);
    } else {
      // Update existing row
      sheet.getRange(row, 2, 1, 3).setValues([[email, now, now]]);
    }

    return jsonResponse_({ ok: true, status: 'complete', token: token, user_email: email });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/**
 * Desktop → GET ?token=... to check handshake status.
 */
function doGet(e) {
  try {
    const token = (e && e.parameter && e.parameter.token || '').toString().trim();
    if (!token) {
      return jsonResponse_({ ok: false, error: 'Missing token parameter' });
    }

    const sheet = getHandshakeSheet_();
    const row = findTokenRow_(sheet, token);

    if (row === 0) {
      // No row yet; phone hasn’t posted.
      return jsonResponse_({ ok: true, status: 'pending', token: token });
    }

    const values = sheet.getRange(row, 1, 1, 4).getValues()[0];
    const userEmail = values[1];      // col B
    const completedAt = values[3];    // col D

    if (!userEmail) {
      return jsonResponse_({ ok: true, status: 'pending', token: token });
    }

    return jsonResponse_({
      ok: true,
      status: 'complete',
      token: token,
      user_email: userEmail,
      completed_at: completedAt
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}
