// ===== copydesk API client =====
const API_URL = 'https://script.google.com/macros/s/AKfycbwW7nb_iJiZJBKeUIQtpp_GOY4tnLQidefDyOHqZDpQkfMympH2Ip4kvgv8bE1or9O9/exec';

// Generic helper for POSTing JSON to Apps Script.
// IMPORTANT: no custom headers, so there is no CORS preflight.
async function apiPost(action, payload) {
  const body = { action, ...payload };

  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error('API request failed: ' + res.status);
  }

  const json = await res.json();
  return json;
}

// ---- Public helpers ----

// Fetch English job (header + segments)
async function getJob(spreadsheetId) {
  return apiPost('getJob', { spreadsheetId });
}

// Update a single English segment's working text
async function updateSegment(spreadsheetId, segmentId, workingText, styleLabel) {
  return apiPost('updateSegment', {
    spreadsheetId,
    segmentId,
    workingText,
    styleLabel
  });
}