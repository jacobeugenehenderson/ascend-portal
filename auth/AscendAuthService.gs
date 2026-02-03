const SHEET_NAME = 'HANDSHAKES';
const ACCESS_SHEET_NAME = 'ACCESS';

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

function getAccessSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ACCESS_SHEET_NAME);
  if (!sheet) {
    throw new Error('AscendAuth: Sheet "ACCESS" not found.');
  }
  return sheet;
}

/**
 * Return true if this email is allowed to use Ascend.
 * ACCESS sheet columns:
 *  A = email
 *  B = name
 *  C = status ("active" / "disabled")
 */
function isEmailAllowed_(email) {
  const normalized = (email || '').toString().trim().toLowerCase();
  if (!normalized) return false;

  const sheet = getAccessSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false; // header only

  const range = sheet.getRange(2, 1, lastRow - 1, 3); // A..C
  const values = range.getValues();

  for (let i = 0; i < values.length; i++) {
    const rowEmail = (values[i][0] || '').toString().trim().toLowerCase();
    if (!rowEmail) continue;
    if (rowEmail === normalized) {
      const status = (values[i][2] || 'active').toString().trim().toLowerCase();
      return status !== 'disabled' && status !== 'inactive';
    }
  }

  return false;
}

/**
 * Lookup the name for an email in ACCESS (col B) and return
 * both the full name and the first name.
 */
function getAccessNameForEmail_(email) {
  const normalized = (email || '').toString().trim().toLowerCase();
  if (!normalized) {
    return { fullName: '', firstName: '' };
  }

  const sheet = getAccessSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { fullName: '', firstName: '' };
  }

  const range = sheet.getRange(2, 1, lastRow - 1, 2); // A..B
  const values = range.getValues();

  for (let i = 0; i < values.length; i++) {
    const rowEmail = (values[i][0] || '').toString().trim().toLowerCase();
    if (!rowEmail) continue;
    if (rowEmail === normalized) {
      const full = (values[i][1] || '').toString().trim();
      const first = full ? full.split(/\s+/)[0] : '';
      return { fullName: full, firstName: first };
    }
  }

  return { fullName: '', firstName: '' };
}

/**
 * Helper: find row index (1-based) for a given token, or 0 if not found.
 */
function findTokenRow_(sheet, token) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0; // Only header or empty

  const range = sheet.getRange(2, 1, lastRow - 1, 1); // col A, skip header
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
 * Reset a token row to pending status (called on logout).
 * Clears the email and sets status back to 'pending'.
 */
function resetToken_(token) {
  const sheet = getHandshakeSheet_();
  const row = findTokenRow_(sheet, token);

  if (row === 0) {
    // Token doesn't exist, nothing to reset
    return jsonResponse_({ ok: true, status: 'pending', token: token });
  }

  // Clear email (col B) and set status to pending (col E)
  const now = new Date();
  sheet.getRange(row, 2, 1, 4).setValues([[
    '',       // Clear email
    now,      // Update timestamp
    now,      // Update timestamp
    'pending' // Reset status
  ]]);

  return jsonResponse_({ ok: true, status: 'pending', token: token });
}

/**
 * Phone → POST { token, email } to complete handshake.
 * Terminal → POST { token, action: "reset" } to reset on logout.
 * Supports both JSON body and form-urlencoded.
 */
function doPost(e) {
  try {
    let token, email, action;

    if (!e || !e.postData) {
      return jsonResponse_({ ok: false, error: 'No post data' });
    }

    const contentType = (e.postData.type || '').toLowerCase();
    const contents = e.postData.contents || '';

    if (contentType.indexOf('application/x-www-form-urlencoded') !== -1) {
      // Parse form-urlencoded manually
      const params = {};
      contents.split('&').forEach(function(pair) {
        const parts = pair.split('=');
        if (parts.length === 2) {
          params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
        }
      });
      token = (params.token || '').toString().trim();
      email = (params.email || '').toString().trim().toLowerCase();
      action = (params.action || '').toString().trim().toLowerCase();
    } else {
      // Assume JSON
      const payload = JSON.parse(contents);
      token = (payload.token || '').toString().trim();
      email = (payload.email || '').toString().trim().toLowerCase();
      action = (payload.action || '').toString().trim().toLowerCase();
    }

    // Handle reset action (logout from terminal)
    if (action === 'reset') {
      if (!token) {
        return jsonResponse_({ ok: false, error: 'Missing token' });
      }
      return resetToken_(token);
    }

    if (!token || !email) {
      return jsonResponse_({ ok: false, error: 'Missing token or email' });
    }

    const sheet = getHandshakeSheet_();
    const now = new Date();
    let row = findTokenRow_(sheet, token);

    // Decide if this email is allowed based on ACCESS sheet
    const allowed = isEmailAllowed_(email);
    const nameInfo = getAccessNameForEmail_(email);
    const fullName = nameInfo.fullName;
    const firstName = nameInfo.firstName;

    if (row === 0) {
      // New handshake row
      row = sheet.getLastRow() + 1;
      sheet.getRange(row, 1, 1, 5).setValues([[
        token,
        email,
        now,
        now,
        allowed ? 'complete' : 'denied'
      ]]);
    } else {
      // Update existing row (keep token/created_at as-is, bump completed_at + status)
      sheet.getRange(row, 2, 1, 4).setValues([[
        email,
        now,
        now,
        allowed ? 'complete' : 'denied'
      ]]);
    }

    if (!allowed) {
      // Unauthorized user → tell phone AND give portal something to show LOSS with.
      return jsonResponse_({
        ok: false,
        status: 'denied',
        token: token,
        user_email: email,
        user_name: fullName,
        user_name_first: firstName,
        error: 'unauthorized_user'
      });
    }

    // Normal happy path
    return jsonResponse_({
      ok: true,
      status: 'complete',
      token: token,
      user_email: email,
      user_name: fullName,
      user_name_first: firstName
    });
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
      // No row yet; phone hasn't posted.
      return jsonResponse_({ ok: true, status: 'pending', token: token });
    }

    const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
    const userEmail = values[1];      // col B
    const completedAt = values[3];    // col D
    const handshakeStatus = (values[4] || '').toString().trim().toLowerCase(); // col E

    if (!userEmail) {
      // row exists but email blank → still pending
      return jsonResponse_({ ok: true, status: 'pending', token: token });
    }

    const nameInfo = getAccessNameForEmail_(userEmail);
    const fullName = nameInfo.fullName;
    const firstName = nameInfo.firstName;

    if (handshakeStatus === 'denied') {
      // We know who tried, and they are not allowed
      return jsonResponse_({
        ok: true,
        status: 'denied',
        token: token,
        user_email: userEmail,
        user_name: fullName,
        user_name_first: firstName,
        completed_at: completedAt
      });
    }

    // default: treat as complete/success
    return jsonResponse_({
      ok: true,
      status: 'complete',
      token: token,
      user_email: userEmail,
      user_name: fullName,
      user_name_first: firstName,
      completed_at: completedAt
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}
