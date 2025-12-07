  /**
 * Ascend Studio – Ops Engine
 * Core backend functions for Sprint 1.
 */

const SHEET_NAME_PROJECTS = 'Projects';
const SHEET_NAME_ADSCHEDULE = 'AdSchedule';
const SHEET_NAME_MEDIASPECS = 'MediaSpecs';
const SHEET_NAME_PUBLICATIONS = 'Publications';
const SHEET_NAME_EDITORIAL = 'EditorialSchedule';
const SHEET_NAME_CONTACTS = 'Contacts';
const SHEET_NAME_REQUIRED_ELEMENTS = 'RequiredElements';

const FRONTEND_BASE_URL = 'https://example.com/job'; // (legacy) live layout preview URL – no longer used by ArtStart
const DEFAULT_CLIENT_NAME = 'Nordson';
const OWNER_EMAIL = 'jacob@jacobhenderson.studio';   // Jacob's direct address
const SYSTEM_EMAIL = 'ascend@jacobhenderson.studio'; // Ascend Studio system mailbox

// ArtStart
const ARTSTART_FRONTEND_BASE_URL =
  'https://jacobeugenehenderson.github.io/ascend-portal/artstart/artstart.html';
const PRIMARY_ARTSTART_EMAIL = 'francesca.lendrum@example.com';

// ---------- Utilities ----------

function getSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (h, idx) {
    map[String(h).trim()] = idx;
  });
  return map;
}

function generateDailyId_(prefix, sheet, idColumnName) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = ('0' + (today.getMonth() + 1)).slice(-2);
  const dd = ('0' + today.getDate()).slice(-2);
  const dateStr = yyyy + '-' + mm + '-' + dd;

  const map = getHeaderMap_(sheet);
  const colIdx = map[idColumnName];
  if (colIdx == null) throw new Error('ID column not found: ' + idColumnName);

  const lastRow = sheet.getLastRow();
  let sequence = 0;

  if (lastRow > 1) {
    const range = sheet.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
    range.forEach(function (row) {
      const val = String(row[0] || '');
      if (val.indexOf(prefix + '-' + dateStr) === 0) {
        const parts = val.split('-');
        const seqStr = parts[parts.length - 1];
        const num = parseInt(seqStr, 10);
        if (!isNaN(num) && num > sequence) {
          sequence = num;
        }
      }
    });
  }

  sequence += 1;
  const seqStr = ('000' + sequence).slice(-3);
  return prefix + '-' + dateStr + '-' + seqStr;
}

function addBusinessDays_(startDate, offsetDays) {
  const d = new Date(startDate.getTime());
  let daysRemaining = offsetDays;

  const step = offsetDays >= 0 ? 1 : -1;
  while (daysRemaining !== 0) {
    d.setDate(d.getDate() + step);
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // Mon-Fri
      daysRemaining -= step;
    }
  }
  return d;
}

function countBusinessDays_(startDate, endDate) {
  // counts business days from start (exclusive) to end (inclusive)
  if (!startDate || !endDate) return 0;
  const s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  if (e < s) return 0;
  let count = 0;
  const d = new Date(s.getTime());
  d.setDate(d.getDate() + 1); // start exclusive
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function parseIsoDate_(isoStr) {
  if (!isoStr) return null;
  const parts = String(isoStr).split('-');
  if (parts.length !== 3) return null;
  const yyyy = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10) - 1;
  const dd = parseInt(parts[2], 10);
  return new Date(yyyy, mm, dd);
}

function formatDate_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ---------- Core: createJob ----------

/**
 * createJob(intakePayload)
 *
 * intakePayload is expected to be an object with keys:
 * - nordsonJobId (string, required)
 * - publicationId
 * - issueName
 * - materialsDueDate (ISO string: yyyy-mm-dd)
 * - deliverableType
 * - mediaSpecId
 * - languagePrimary
 * - translationRequired ("Yes"/"No")
 * - translationTargetLanguage
 * - qrIncluded ("Yes"/"No")
 * - createdByContactId
 * - productLine
 * - notes
 * - topic (editorial topic, optional)
 *
 * Writes rows into Projects and AdScheduleNew.
 * Generates AscendJobId and possibly TranslationJobId.
 */
function createJob(intakePayload) {
  if (!intakePayload || !intakePayload.nordsonJobId) {
    throw new Error('nordsonJobId is required in intakePayload');
  }

  const projectsSheet = getSheet_(SHEET_NAME_PROJECTS);
  const adScheduleSheet = getSheet_(SHEET_NAME_ADSCHEDULE);

  const projectsHeader = getHeaderMap_(projectsSheet);
  const adsHeader = getHeaderMap_(adScheduleSheet);

  const now = new Date();
  const materialsDueDate = parseIsoDate_(intakePayload.materialsDueDate);
  const businessDays = countBusinessDays_(now, materialsDueDate);

  // Timeline logic:
  // D = business days between today and materials due.
  // Art Start = today + round(0.4 * D)
  // Touchpoint = today + round(0.2 * D)
  // If D <= 2, treat as rush: both set to today.
  let artStartDate = now;
  let touchpointDate = now;
  if (businessDays > 2) {
    const artOffset = Math.round(0.4 * businessDays);
    const touchOffset = Math.round(0.2 * businessDays);
    artStartDate = addBusinessDays_(now, artOffset);
    touchpointDate = addBusinessDays_(now, touchOffset);
  }

  // Generate IDs
  const ascendJobId = generateDailyId_('ASC', projectsSheet, 'AscendJobId');
  const adScheduleId = generateDailyId_('ADS', adScheduleSheet, 'AdScheduleId');

  // Optional translation job
  let translationJobId = '';
  if (intakePayload.translationRequired === 'Yes') {
    translationJobId = createTranslationJobRow_(ascendJobId, intakePayload);
  }

  // Build Projects row in header order
  const projRow = [];
  const projCols = projectsSheet.getRange(1, 1, 1, projectsSheet.getLastColumn()).getValues()[0];

  projCols.forEach(function (colName) {
    switch (String(colName)) {
      case 'AscendJobId':
        projRow.push(ascendJobId);
        break;
      case 'NordsonJobId':
        projRow.push(intakePayload.nordsonJobId || '');
        break;
      case 'Client':
        projRow.push(DEFAULT_CLIENT_NAME);
        break;
      case 'ProductLine':
        projRow.push(intakePayload.productLine || '');
        break;
      case 'DeliverableType':
        projRow.push(intakePayload.deliverableType || '');
        break;
      case 'PublicationOrChannel':
        projRow.push(intakePayload.publicationId || '');
        break;
      case 'MediaSpecId':
        projRow.push(intakePayload.mediaSpecId || '');
        break;
      case 'MaterialsDueDate':
        projRow.push(materialsDueDate || '');
        break;
      case 'ArtStartDate':
        projRow.push(artStartDate);
        break;
      case 'TouchpointMeetingDate':
        projRow.push(touchpointDate);
        break;
      case 'LanguagePrimary':
        projRow.push(intakePayload.languagePrimary || 'EN');
        break;
      case 'TranslationRequired':
        projRow.push(intakePayload.translationRequired || 'No');
        break;
      case 'TranslationTargetLanguage':
        projRow.push(intakePayload.translationTargetLanguage || '');
        break;
      case 'TranslationJobId':
        projRow.push(translationJobId);
        break;
      case 'QRIncluded':
        projRow.push(intakePayload.qrIncluded || 'No');
        break;
      case 'CreatedByContactId':
        projRow.push(intakePayload.createdByContactId || '');
        break;
      case 'CreatedAt':
        projRow.push(now);
        break;
      case 'Status':
        projRow.push('Draft'); // New jobs start as Draft
        break;
      case 'Notes':
        projRow.push(intakePayload.notes || '');
        break;
      default:
        projRow.push(''); // Unknown/extra column
    }
  });

  const projRowIdx = projectsSheet.getLastRow() + 1;
  projectsSheet.getRange(projRowIdx, 1, 1, projRow.length).setValues([projRow]);

  // Build AdScheduleNew row
  const adsRow = [];
  const adsCols = adScheduleSheet.getRange(1, 1, 1, adScheduleSheet.getLastColumn()).getValues()[0];

  adsCols.forEach(function (colName) {
    switch (String(colName)) {
      case 'AdScheduleId':
        adsRow.push(adScheduleId);
        break;
      case 'AscendJobId':
        adsRow.push(ascendJobId);
        break;
      case 'NordsonJobId':
        adsRow.push(intakePayload.nordsonJobId || '');
        break;
      case 'PublicationId':
        adsRow.push(intakePayload.publicationId || '');
        break;
      case 'IssueName':
        adsRow.push(intakePayload.issueName || '');
        break;
      case 'Topic':
        adsRow.push(intakePayload.topic || '');
        break;
      case 'MaterialDeadline':
        adsRow.push(materialsDueDate || '');
        break;
      case 'PublicationDate':
        adsRow.push(''); // can be added later
        break;
      case 'MediaSpecId':
        adsRow.push(intakePayload.mediaSpecId || '');
        break;
      case 'ConfirmedContactId':
        adsRow.push(''); // to be confirmed later
        break;
      case 'ConfirmedAt':
        adsRow.push('');
        break;
      case 'Notes':
        adsRow.push(intakePayload.notes || '');
        break;
      default:
        adsRow.push('');
    }
  });

  const adsRowIdx = adScheduleSheet.getLastRow() + 1;
  adScheduleSheet.getRange(adsRowIdx, 1, 1, adsRow.length).setValues([adsRow]);

  return {
    success: true,
    ascendJobId: ascendJobId,
    translationJobId: translationJobId,
    projectRow: projRowIdx,
    adScheduleRow: adsRowIdx,
    artStartDate: formatDate_(artStartDate),
    touchpointMeetingDate: formatDate_(touchpointDate),
  };
}

function createTranslationJobRow_(ascendJobId, intakePayload) {
  const sheet = getSheet_('TranslationJobs');
  const header = getHeaderMap_(sheet);
  const now = new Date();
  const translationJobId = generateDailyId_('TRN', sheet, 'TranslationJobId');

  const row = [];
  const cols = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  cols.forEach(function (colName) {
    switch (String(colName)) {
      case 'TranslationJobId':
        row.push(translationJobId);
        break;
      case 'AscendJobId':
        row.push(ascendJobId);
        break;
      case 'SourceLanguage':
        row.push(intakePayload.languagePrimary || 'EN');
        break;
      case 'TargetLanguage':
        row.push(intakePayload.translationTargetLanguage || '');
        break;
      case 'Needed':
        row.push('Yes');
        break;
      case 'TranslatorContactId':
        row.push('');
        break;
      case 'Status':
        row.push('Needed');
        break;
      case 'SourceCopyUrl':
        row.push('');
        break;
      case 'TranslatedCopyUrl':
        row.push('');
        break;
      case 'WordCount':
        row.push('');
        break;
      case 'DueDate':
        row.push(intakePayload.materialsDueDate ? parseIsoDate_(intakePayload.materialsDueDate) : '');
        break;
      case 'CreatedAt':
        row.push(now);
        break;
      case 'Notes':
        row.push('');
        break;
      default:
        row.push('');
    }
  });

  const rowIdx = sheet.getLastRow() + 1;
  sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  return translationJobId;
}

// ---------- Core: getJob ----------

/**
 * getJob(jobId)
 * jobId is AscendJobId.
 * Returns JSON with:
 * - project
 * - adSchedule
 * - mediaSpec
 * - publication
 * - editorialContext
 */
function getJob(jobId) {
  if (!jobId) throw new Error('jobId (AscendJobId) is required');

  const projectsSheet = getSheet_(SHEET_NAME_PROJECTS);
  const projMap = getHeaderMap_(projectsSheet);
  const projData = projectsSheet.getDataRange().getValues();

  let project = null;
  for (let r = 1; r < projData.length; r++) {
    if (String(projData[r][projMap['AscendJobId']]) === String(jobId)) {
      project = rowToObject_(projData[r], projData[0]);
      break;
    }
  }
  if (!project) throw new Error('Project not found: ' + jobId);

  // AdSchedule (first match)
  const adsSheet = getSheet_(SHEET_NAME_ADSCHEDULE);
  const adsData = adsSheet.getDataRange().getValues();
  let adSchedule = null;
  const adsHeader = adsData[0];
  const adsMap = getHeaderMap_(adsSheet);
  for (let r = 1; r < adsData.length; r++) {
    if (String(adsData[r][adsMap['AscendJobId']]) === String(jobId)) {
      adSchedule = rowToObject_(adsData[r], adsHeader);
      break;
    }
  }

  // MediaSpec
  let mediaSpec = null;
  if (project.MediaSpecId) {
    const msSheet = getSheet_(SHEET_NAME_MEDIASPECS);
    const msData = msSheet.getDataRange().getValues();
    const msHeader = msData[0];
    const msMap = getHeaderMap_(msSheet);
    for (let r = 1; r < msData.length; r++) {
      if (String(msData[r][msMap['MediaSpecId']]) === String(project.MediaSpecId)) {
        mediaSpec = rowToObject_(msData[r], msHeader);
        break;
      }
    }
  }

  // Publication
  let publication = null;
  const pubSheet = getSheet_(SHEET_NAME_PUBLICATIONS);
  const pubData = pubSheet.getDataRange().getValues();
  const pubHeader = pubData[0];
  const pubMap = getHeaderMap_(pubSheet);

  const publicationId =
    (mediaSpec && mediaSpec.PublicationId) ||
    project.PublicationOrChannel ||
    (adSchedule && adSchedule.PublicationId);

  if (publicationId) {
    for (let r = 1; r < pubData.length; r++) {
      if (String(pubData[r][pubMap['PublicationId']]) === String(publicationId)) {
        publication = rowToObject_(pubData[r], pubHeader);
        break;
      }
    }
  }

  // Editorial context: match by PublicationId + Month (based on MaterialsDueDate if present)
  let editorialContext = null;
  if (publication && project.MaterialsDueDate) {
    const edSheet = getSheet_(SHEET_NAME_EDITORIAL);
    const edData = edSheet.getDataRange().getValues();
    const edHeader = edData[0];
    const edMap = getHeaderMap_(edSheet);

    const md = new Date(project.MaterialsDueDate);
    const monthName = Utilities.formatDate(md, Session.getScriptTimeZone(), 'MMMM');

    for (let r = 1; r < edData.length; r++) {
      const rowPubId = String(edData[r][edMap['PublicationId']] || '');
      const rowMonth = String(edData[r][edMap['Month']] || '');
      if (rowPubId === String(publication.PublicationId) && rowMonth === monthName) {
        editorialContext = rowToObject_(edData[r], edHeader);
        break;
      }
    }
  }

  return {
    project: project,
    adSchedule: adSchedule,
    mediaSpec: mediaSpec,
    publication: publication,
    editorialContext: editorialContext,
  };
}

function rowToObject_(row, headerRow) {
  const obj = {};
  for (let i = 0; i < headerRow.length; i++) {
    const key = String(headerRow[i]).trim();
    if (!key) continue;
    obj[key] = row[i];
  }
  return obj;
}

// ---------- ArtStart helpers & JSON view ----------

function findProjectRowByAscendJobId_(jobId) {
  const sheet = getSheet_(SHEET_NAME_PROJECTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const map = getHeaderMap_(sheet);
  const colIdx = map['AscendJobId'];
  if (colIdx == null) {
    throw new Error('AscendJobId column not found in Projects sheet');
  }

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][colIdx]) === String(jobId)) {
      return {
        sheet: sheet,
        headers: headers,
        rowIndex: r + 1,
        row: data[r]
      };
    }
  }
  return null;
}

function setProjectFieldIfPresent_(sheet, headers, rowIndex, headerName, value) {
  const idx = headers.indexOf(headerName);
  if (idx === -1) return;
  sheet.getRange(rowIndex, idx + 1).setValue(value || '');
}

/**
 * getArtStartJob_(jobId)
 * Builds a trimmed, ArtStart-friendly view of the job.
 */
function getArtStartJob_(jobId) {
  const data = getJob(jobId); // existing aggregator
  const p = data.project;
  if (!p) {
    throw new Error('Project not found: ' + jobId);
  }
  const ms = data.mediaSpec || {};
  const pub = data.publication || {};
  const ad = data.adSchedule || {};

  function prettyDate(dateOrValue) {
    if (!dateOrValue) return '';
    if (Object.prototype.toString.call(dateOrValue) === '[object Date]') {
      return Utilities.formatDate(dateOrValue, Session.getScriptTimeZone(), 'MMM d, yyyy');
    }
    try {
      const d = new Date(dateOrValue);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy');
      }
    } catch (e) {}
    return String(dateOrValue);
  }

  // Infer job kind from media type
  const mediaType = ms.MediaType || '';
  const jobKind = /print/i.test(mediaType) ? 'PRINT' : 'DIGITAL';

  let colorExportSummary;
  if (jobKind === 'PRINT') {
    colorExportSummary = 'Working: RGB \u2192 Delivery: PDF/X-4 (CMYK handled by vendor RIP).';
  } else {
    colorExportSummary = 'Working: RGB \u2192 Delivery: Digital (no CMYK).';
  }

  // Required elements (names only)
  const requiredItems = getRequiredElementsForJob_(p.DeliverableType || '', ms.MediaType || '');
  const requiredNames = requiredItems
    .map(function (item) { return item.ElementName || ''; })
    .filter(function (s) { return s; });

  // Requester (from Contacts, via CreatedByContactId)
  let requesterName = '';
  let requesterEmail = '';
  try {
    const contactsSheet = getSheet_(SHEET_NAME_CONTACTS);
    const cData = contactsSheet.getDataRange().getValues();
    const cHeader = cData[0];
    const cMap = getHeaderMap_(contactsSheet);
    const contactId = p.CreatedByContactId;
    if (contactId) {
      for (let r = 1; r < cData.length; r++) {
        if (String(cData[r][cMap['ContactId']]) === String(contactId)) {
          const rowObj = rowToObject_(cData[r], cHeader);
          requesterName = rowObj.Name || '';
          requesterEmail = rowObj.Email || '';
          break;
        }
      }
    }
  } catch (e) {
    // best-effort only
  }

  // Orientation: explicit field if present; otherwise infer from W/H
  let orientation = ms.Orientation || '';
  if (!orientation && ms.Width && ms.Height) {
    const w = Number(ms.Width);
    const h = Number(ms.Height);
    if (!isNaN(w) && !isNaN(h)) {
      orientation = w >= h ? 'Landscape' : 'Portrait';
    }
  }

  // Working-draft fields (must exist as columns in Projects)
  const workingHeadline = p.WorkingHeadline || '';
  const workingSubhead = p.WorkingSubhead || '';
  const workingCta = p.WorkingCTA || '';
  const workingBullets = p.WorkingBullets || '';
  const workingNotes = p.WorkingNotes || '';

  return {
    jobId: p.AscendJobId || jobId,
    jobTitle: p.NordsonJobId || '',
    campaignName: p.DeliverableType || '',
    nordsonJobCode: p.NordsonJobId || '',
    requesterName: requesterName,
    requesterEmail: requesterEmail,
    createdDate: prettyDate(p.CreatedAt),

    publication: pub.Name || pub.BaseName || p.PublicationOrChannel || '',
    placement: ms.SoldAs || '',
    trimWidth: ms.Width || '',
    trimHeight: ms.Height || '',
    bleed: ms.Bleed || '',
    orientation: orientation,
    jobKind: jobKind,
    colorExportSummary: colorExportSummary,
    materialsDeadline: prettyDate(p.MaterialsDueDate),
    runDate: prettyDate(ad.PublicationDate),

    requiredElements: requiredNames,

    // Delivery info: to be modeled later
    deliveryRecipientName: '',
    deliveryRecipientEmail: '',
    deliveryInstructions: '',
    deliveryDeadline: '',

    workingHeadline: workingHeadline,
    workingSubhead: workingSubhead,
    workingCta: workingCta,
    workingBullets: workingBullets,
    workingNotes: workingNotes
  };
}

function handleGetArtStartJob_(e) {
  const jobId = e && e.parameter && e.parameter.jobId;
  if (!jobId) {
    return jsonResponse_({ ok: false, error: 'Missing jobId' });
  }
  try {
    const job = getArtStartJob_(jobId);
    return jsonResponse_({ ok: true, job: job });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function handleUpdateArtStartDraftFields_(e) {
  const raw = e.postData && e.postData.contents ? e.postData.contents : '{}';
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON payload' });
  }

  const jobId = payload.jobId;
  if (!jobId) {
    return jsonResponse_({ ok: false, error: 'Missing jobId' });
  }

  const projInfo = findProjectRowByAscendJobId_(jobId);
  if (!projInfo) {
    return jsonResponse_({ ok: false, error: 'Job not found: ' + jobId });
  }

  const sheet = projInfo.sheet;
  const headers = projInfo.headers;
  const rowIndex = projInfo.rowIndex;

  setProjectFieldIfPresent_(sheet, headers, rowIndex, 'WorkingHeadline', payload.workingHeadline);
  setProjectFieldIfPresent_(sheet, headers, rowIndex, 'WorkingSubhead', payload.workingSubhead);
  setProjectFieldIfPresent_(sheet, headers, rowIndex, 'WorkingCTA', payload.workingCta);
  setProjectFieldIfPresent_(sheet, headers, rowIndex, 'WorkingBullets', payload.workingBullets);
  setProjectFieldIfPresent_(sheet, headers, rowIndex, 'WorkingNotes', payload.workingNotes);

  return jsonResponse_({ ok: true });
}

/**
 * listJobs(limit, statusFilter)
 * Returns a lightweight list of jobs for the portal.
 *
 * For now:
 * - limit: max number of rows (optional)
 * - statusFilter: string like "Draft", "In Progress", etc. (optional)
 */
function listJobs_(limit, statusFilter) {
  var projectsSheet = getSheet_(SHEET_NAME_PROJECTS);
  var projData = projectsSheet.getDataRange().getValues();
  if (projData.length < 2) {
    return [];
  }

  var projHeader = projData[0];
  var projMap = getHeaderMap_(projectsSheet);

  var adSheet = getSheet_(SHEET_NAME_ADSCHEDULE);
  var adData = adSheet.getDataRange().getValues();
  var adHeader = adData[0];
  var adMap = getHeaderMap_(adSheet);

  var pubSheet = getSheet_(SHEET_NAME_PUBLICATIONS);
  var pubData = pubSheet.getDataRange().getValues();
  var pubHeader = pubData[0];
  var pubMap = getHeaderMap_(pubSheet);

  // Build quick lookup maps for AdSchedule + Publications
  var adByJobId = {};
  for (var r = 1; r < adData.length; r++) {
    var row = adData[r];
    var ajid = String(row[adMap['AscendJobId']] || '');
    if (!ajid) continue;
    adByJobId[ajid] = rowToObject_(row, adHeader);
  }

  var pubById = {};
  for (var r2 = 1; r2 < pubData.length; r2++) {
    var prow = pubData[r2];
    var pid = String(prow[pubMap['PublicationId']] || '');
    if (!pid) continue;
    pubById[pid] = rowToObject_(prow, pubHeader);
  }

  var results = [];
  var max = limit && limit > 0 ? limit : 200;

  for (var i = 1; i < projData.length; i++) {
    var prow = projData[i];
    var status = String(prow[projMap['Status']] || '');
    if (statusFilter && status !== statusFilter) {
      continue;
    }

    var job = rowToObject_(prow, projHeader);
    var ascendJobId = job.AscendJobId;
    if (!ascendJobId) continue;

    var ad = adByJobId[ascendJobId] || null;

    var publicationName = '';
    var publicationId = '';

    // prefer explicit PublicationId from AdSchedule
    if (ad && ad.PublicationId) {
      publicationId = ad.PublicationId;
    } else if (job.PublicationOrChannel) {
      publicationId = job.PublicationOrChannel;
    }

    if (publicationId && pubById[publicationId]) {
      publicationName = pubById[publicationId].Name || pubById[publicationId].BaseName || publicationId;
    } else if (publicationId) {
      publicationName = publicationId;
    }

    results.push({
      AscendJobId: ascendJobId,
      NordsonJobId: job.NordsonJobId || '',
      Client: job.Client || '',
      ProductLine: job.ProductLine || '',
      DeliverableType: job.DeliverableType || '',
      PublicationId: publicationId,
      PublicationName: publicationName,
      MaterialsDueDate: job.MaterialsDueDate || '',
      ArtStartDate: job.ArtStartDate || '',
      TouchpointMeetingDate: job.TouchpointMeetingDate || '',
      Status: status,
      QRIncluded: job.QRIncluded || '',
      TranslationRequired: job.TranslationRequired || '',
      CreatedAt: job.CreatedAt || ''
    });

    if (results.length >= max) break;
  }

  return results;
}

// ---------- Core: buildArtStartEmail ----------

/**
 * buildArtStartEmail(jobId) -> { subject, html }
 */
function buildArtStartEmail(jobId) {
  const data = getJob(jobId);
  const p = data.project;
  const ms = data.mediaSpec || {};
  const pub = data.publication || {};
  const ed = data.editorialContext || {};
  const materialsDue = p.MaterialsDueDate ? new Date(p.MaterialsDueDate) : null;
  const artStart = p.ArtStartDate ? new Date(p.ArtStartDate) : null;
  const touchDate = p.TouchpointMeetingDate ? new Date(p.TouchpointMeetingDate) : null;

  const subject = 'Art Start: ' +
    (p.NordsonJobId || jobId) + ' – ' +
    (pub.Name || pub.BaseName || p.PublicationOrChannel || 'Publication TBD') + ' – ' +
    (p.DeliverableType || 'Deliverable');

  // Required elements: for now, just list by DeliverableType/MediaType
  const requiredElements = getRequiredElementsForJob_(p.DeliverableType, ms.MediaType);

  const html = `
  <html>
    <body style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
      <h2 style="margin-bottom: 0.2em;">Art Start</h2>
      <p style="margin-top: 0;">Delivered by Ascend Studio</p>

      <hr style="margin: 16px 0;">

      <h3>Job Header</h3>
      <table cellpadding="4" cellspacing="0" style="font-size: 14px;">
        <tr><td><strong>Nordson Job ID:</strong></td><td>${escapeHtml_(p.NordsonJobId || '')}</td></tr>
        <tr><td><strong>Ascend Job ID:</strong></td><td>${escapeHtml_(p.AscendJobId || '')}</td></tr>
        <tr><td><strong>Publication:</strong></td><td>${escapeHtml_(pub.Name || pub.BaseName || p.PublicationOrChannel || 'TBD')}</td></tr>
        <tr><td><strong>Issue / Month:</strong></td><td>${escapeHtml_((data.adSchedule && data.adSchedule.IssueName) || (ed.Month) || '')}</td></tr>
        <tr><td><strong>Deliverable type:</strong></td><td>${escapeHtml_(p.DeliverableType || '')}</td></tr>
        <tr><td><strong>Media spec:</strong></td><td>${escapeHtml_(ms.SoldAs || '')}</td></tr>
      </table>

      <h3>Canvas Specs</h3>
      <div style="border: 1px solid #ccc; padding: 8px; font-size: 13px; max-width: 420px;">
        <p style="margin: 0 0 4px 0;">
          <strong>Working canvas:</strong><br>
          ${escapeHtml_(ms.Width || '')} × ${escapeHtml_(ms.Height || '')} (units per specs)<br>
          <strong>DPI:</strong> ${escapeHtml_(ms.DPI || '')}<br>
          <strong>Bleed:</strong> ${escapeHtml_(ms.Bleed || 'None specified')}<br>
          <strong>Color mode:</strong> Working in RGB. Print output via PDF/X-4.
        </p>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #555;">
          For print, final export will be PDF/X-4 at 300 dpi from RGB working files.
        </p>
      </div>

      <h3>Editorial Context</h3>
      <p style="font-size: 13px;">
        <strong>Editorial Topic:</strong> ${escapeHtml_(ed.EditorialTopic || data.adSchedule?.Topic || 'TBD')}<br>
        <strong>Show Context:</strong> ${escapeHtml_(ed.ShowContext || '')}
      </p>

      <h3>Required Elements Checklist</h3>
      <table cellpadding="4" cellspacing="0" style="font-size: 13px; border-collapse: collapse;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #ddd; text-align:left;">Element</th>
            <th style="border:1px solid #ddd; text-align:left;">Required?</th>
            <th style="border:1px solid #ddd; text-align:left;">Provided?</th>
            <th style="border:1px solid #ddd; text-align:left;">Source</th>
          </tr>
        </thead>
        <tbody>
          ${requiredElements.map(function (el) {
            // For this sprint, assume nothing has been provided yet.
            const provided = 'No';
            const providedStyle = 'color:#b00020; font-weight:bold;';
            const sourceLabel = el.AutofillSource || 'Custom / TBD';

            return `
              <tr>
                <td style="border:1px solid #ddd;">${escapeHtml_(el.ElementName || '')}</td>
                <td style="border:1px solid #ddd;">${escapeHtml_(el.RequiredStatus || '')}</td>
                <td style="border:1px solid #ddd; ${providedStyle}">${provided}</td>
                <td style="border:1px solid #ddd;">${escapeHtml_(sourceLabel)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <p style="font-size:12px; color:#555;">
        Missing items are highlighted. We cannot start art without required elements.
      </p>

      <h3>Timeline Snapshot</h3>
      <table cellpadding="4" cellspacing="0" style="font-size: 13px;">
        <tr>
          <td><strong>Materials due:</strong></td>
          <td>${materialsDue ? formatDate_(materialsDue) : 'TBD'}</td>
        </tr>
        <tr>
          <td><strong>Art Start:</strong></td>
          <td>${artStart ? formatDate_(artStart) : 'TBD'}</td>
        </tr>
        <tr>
          <td><strong>Touchpoint (image planning):</strong></td>
          <td>${touchDate ? formatDate_(touchDate) : 'TBD'} 
            – Discuss image needs for ${escapeHtml_(p.NordsonJobId || '')}
          </td>
        </tr>
      </table>

      <h3>Translation Notes</h3>
      <p style="font-size: 13px;">
        <strong>Primary language:</strong> ${escapeHtml_(p.LanguagePrimary || 'EN')}<br>
        <strong>Translation required:</strong> ${escapeHtml_(p.TranslationRequired || 'No')}<br>
        ${p.TranslationRequired === 'Yes' ? `
          <strong>Target language:</strong> ${escapeHtml_(p.TranslationTargetLanguage || '')}<br>
          Translation will be handled by Ascend Studio / corporate translator. Status: ${escapeHtml_(p.TranslationJobId ? 'Needed' : 'Planned')}.
        ` : `
          No translation planned for this job.
        `}
      </p>

      <h3>QR & Live Layout Preview</h3>
      <p style="font-size: 13px;">
        <strong>QR included in final layout:</strong> ${escapeHtml_(p.QRIncluded || 'No')}
      </p>
      <p style="font-size: 13px;">
        The live layout preview and editing panel is available at the link below.
        QR-based soft login will be added in a later phase.
      </p>
      <p style="margin:16px 0;">
        <a href="${FRONTEND_BASE_URL}?AscendJobId=${encodeURIComponent(p.AscendJobId || '')}"
           style="background:#0057b8; color:#fff; padding:10px 16px; text-decoration:none; border-radius:4px; font-size:14px;">
          Open live layout preview &amp; editing panel
        </a>
      </p>

      <h3>Notes</h3>
      <p style="font-size: 13px;">${escapeHtml_(p.Notes || 'No special notes provided yet.')}</p>

      <hr style="margin: 16px 0;">
      <p style="font-size: 11px; color:#777;">
        Delivered by Ascend Studio.<br>
        All creative is built in RGB and exported to PDF/X-4 for print when needed.
      </p>
    </body>
  </html>
  `;

  return {
    subject: subject,
    html: html
  };
}

function getRequiredElementsForJob_(deliverableType, mediaType) {
  const sheet = getSheet_(SHEET_NAME_REQUIRED_ELEMENTS);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const map = getHeaderMap_(sheet);
  const results = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const dt = String(row[map['DeliverableType']] || '');
    const mt = String(row[map['MediaType']] || '');
    if ((dt === deliverableType || !deliverableType) &&
        (!mediaType || !mt || mt === mediaType)) {
      results.push(rowToObject_(row, header));
    }
  }

  return results;
}

// ---------- Public: getRequiredElementsForJob ----------

/**
 * getRequiredElementsForJobPublic(jobId)
 * Uses the job's DeliverableType + MediaType to return the required elements list.
 */
function getRequiredElementsForJobPublic_(jobId) {
  if (!jobId) {
    throw new Error('jobId (AscendJobId) is required');
  }

  // Re-use existing getJob() logic
  var jobData = getJob(jobId);
  var project = jobData.project || {};
  var mediaSpec = jobData.mediaSpec || {};

  var deliverableType = project.DeliverableType || '';
  var mediaType = mediaSpec.MediaType || '';

  var items = getRequiredElementsForJob_(deliverableType, mediaType);
  return { jobId: jobId, deliverableType: deliverableType, mediaType: mediaType, items: items };
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------- Core: sendArtStartEmail ----------

/**
 * sendArtStartEmail(jobId)
 * Looks up primary contact email from ContactsNew using CreatedByContactId.
 * CCs Jacob (configurable).
 */
/**
 * sendArtStartEmail(jobId)
 * Builds and sends the ArtStart job receipt + prep email.
 */
function sendArtStartEmail(jobId) {
  const data = getJob(jobId);
  const p = data.project;
  if (!p) {
    throw new Error('Project not found: ' + jobId);
  }
  const ms = data.mediaSpec || {};
  const pub = data.publication || {};
  const ad = data.adSchedule || {};
  const ed = data.editorialContext || {};

  function prettyDate(dateOrValue) {
    if (!dateOrValue) return '';
    if (Object.prototype.toString.call(dateOrValue) === '[object Date]') {
      return Utilities.formatDate(dateOrValue, Session.getScriptTimeZone(), 'MMM d, yyyy');
    }
    try {
      const d = new Date(dateOrValue);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy');
      }
    } catch (e) {}
    return String(dateOrValue);
  }

  // Job kind & color/export label (same logic as ArtStart JSON)
  const mediaType = ms.MediaType || '';
  const jobKind = /print/i.test(mediaType) ? 'PRINT' : 'DIGITAL';
  let colorExportSummary;
  if (jobKind === 'PRINT') {
    colorExportSummary = 'Working: RGB \u2192 Delivery: PDF/X-4 (CMYK handled by vendor RIP).';
  } else {
    colorExportSummary = 'Working: RGB \u2192 Delivery: Digital (no CMYK).';
  }

  // Required elements (names only)
  const requiredItems = getRequiredElementsForJob_(p.DeliverableType || '', ms.MediaType || '');
  const requiredNames = requiredItems
    .map(function (item) { return item.ElementName || ''; })
    .filter(function (s) { return s; });

  // Requester from Contacts
  let requesterName = '';
  let requesterEmail = '';
  try {
    const contactsSheet = getSheet_(SHEET_NAME_CONTACTS);
    const cData = contactsSheet.getDataRange().getValues();
    const cHeader = cData[0];
    const cMap = getHeaderMap_(contactsSheet);
    const contactId = p.CreatedByContactId;
    if (contactId) {
      for (let r = 1; r < cData.length; r++) {
        if (String(cData[r][cMap['ContactId']]) === String(contactId)) {
          const rowObj = rowToObject_(cData[r], cHeader);
          requesterName = rowObj.Name || '';
          requesterEmail = rowObj.Email || '';
          break;
        }
      }
    }
  } catch (e) {
    // best-effort only
  }

  const ascendJobId = p.AscendJobId || jobId;
  const jobTitle = p.NordsonJobId || '';
  const campaignName = p.DeliverableType || (ed.EditorialTopic || '');

  const trimSizePretty =
    ms.Width && ms.Height ? ms.Width + '" \u00d7 ' + ms.Height + '"' : '';
  const bleedPretty = ms.Bleed ? ms.Bleed + '"' : '';

  const artStartUrl = ARTSTART_FRONTEND_BASE_URL + '?jobId=' + encodeURIComponent(ascendJobId);

  // Template lives as a file named "artstart_email.html" in the Apps Script project
  const template = HtmlService.createTemplateFromFile('artstart_email');
  template.data = {
    jobTitle: jobTitle,
    campaignName: campaignName,
    ascendJobId: ascendJobId,
    nordsonJobCode: p.NordsonJobId || '',
    createdDate: prettyDate(p.CreatedAt),
    requesterName: requesterName || 'Unknown requester',
    requesterEmail: requesterEmail || '',

    publication: pub.Name || pub.BaseName || p.PublicationOrChannel || '',
    placement: ms.SoldAs || '',
    trimSizePretty: trimSizePretty,
    bleedPretty: bleedPretty,
    orientation: ms.Orientation || '',
    colorExportSummary: colorExportSummary,
    materialsDeadlinePretty: prettyDate(p.MaterialsDueDate),
    runDatePretty: prettyDate(ad.PublicationDate),

    requiredElements: requiredNames,

    deliveryRecipientName: '',
    deliveryRecipientEmail: '',
    deliveryInstructions: '',
    deliveryDeadlinePretty: '',

    artStartUrl: artStartUrl,
    artStartQrUrl: null // hook for optional QR later
  };

  const htmlBody = template.evaluate().getContent();
  const subject = '[ArtStart] ' + (jobTitle || campaignName || ascendJobId);

  // Primary: Francesca; CC Jacob
  const to = PRIMARY_ARTSTART_EMAIL;
  const cc = OWNER_EMAIL;

  MailApp.sendEmail({
    to: to,
    cc: cc,
    subject: subject,
    htmlBody: htmlBody,
    name: 'Ascend Visualization Studio',
    replyTo: SYSTEM_EMAIL
  });

  return { success: true, to: to, subject: subject };
}

// ---------- Minimal JSON endpoint for front-end ----------

function listPublications_() {
  const sheet = getSheet_(SHEET_NAME_PUBLICATIONS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const header = data[0];
  const items = [];

  for (let r = 1; r < data.length; r++) {
    const rowObj = rowToObject_(data[r], header);
    if (!rowObj.PublicationId) continue;

    items.push({
      PublicationId: rowObj.PublicationId,
      Name: rowObj.Name || rowObj.BaseName || '',
      BaseName: rowObj.BaseName || '',
      MediaTypeDefault: rowObj.MediaType || ''
    });
  }
  return items;
}

function listMediaSpecs_() {
  const sheet = getSheet_(SHEET_NAME_MEDIASPECS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const header = data[0];
  const items = [];

  for (let r = 1; r < data.length; r++) {
    const rowObj = rowToObject_(data[r], header);
    if (!rowObj.MediaSpecId) continue;
    
    // We just return the whole row as an object so the front-end can
    // pick what it needs (MediaSpecId, PublicationId, DeliverableType, Width, Height, DPI, MediaType, Name, etc.)
    items.push(rowObj);
  }
  return items;
}

function jsonResponse_(obj, callback) {
  var json = JSON.stringify(obj);
  var output;

  if (callback) {
    // JSONP: wrap in function call
    var wrapped = callback + '(' + json + ');';
    output = ContentService
      .createTextOutput(wrapped)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // Normal JSON
    output = ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Note: CORS headers are intentionally omitted here.
  // JSONP responses don't require CORS, and TextOutput does not support setHeader.
  return output;
}

/**
 * doGet(e)
 * - ?action=getJob&jobId=ASC-... returns JSON
 * - otherwise can be wired to HTML template later.
 */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var callback = e && e.parameter && e.parameter.callback;  // <– NEW

  if (action === 'getJob') {
    var jobId = e.parameter.jobId;
    var data = getJob(jobId);
    return jsonResponse_(data, callback);
  }

  if (action === 'listJobs') {
    var limit = e.parameter.limit ? parseInt(e.parameter.limit, 10) : 100;
    var statusFilter = e.parameter.status || '';
    var jobs = listJobs_(limit, statusFilter);
    return jsonResponse_({ jobs: jobs }, callback);
  }

  if (action === 'getRequiredElementsForJob') {
    var jobId2 = e.parameter.jobId;
    try {
      var payload = getRequiredElementsForJobPublic_(jobId2);
      return jsonResponse_(payload, callback);
    } catch (err) {
      return jsonResponse_({ success: false, error: String(err) }, callback);
    }
  }

  if (action === 'getArtStartJob') {
    // Slim JSON view for the ArtStart workspace
    return handleGetArtStartJob_(e);
  }

  // JSONP-based job creation to avoid CORS preflight from localhost
  if (action === 'createJobFromFormJsonp') {

    var rawPayload = e.parameter && e.parameter.payload ? e.parameter.payload : '{}';
    var payloadObj;
    try {
      payloadObj = JSON.parse(rawPayload);
    } catch (err3) {
      return jsonResponse_({ success: false, error: 'Invalid JSON payload' }, callback);
    }

    try {
      var result = createJob(payloadObj);

      // Attempt to send ArtStart email; log if it fails but don't break the response
      try {
        sendArtStartEmail(result.ascendJobId);
      } catch (emailErr2) {
        Logger.log('Error sending ArtStart email (JSONP): ' + emailErr2);
        result.emailError = String(emailErr2);
      }

      return jsonResponse_(result, callback);
    } catch (err4) {
      return jsonResponse_({ success: false, error: String(err4) }, callback);
    }
  }

  if (action === 'listConfigForIntake') {
    try {
      var pubs = listPublications_();
      var specs = listMediaSpecs_();
      var payload2 = {
        publications: pubs,
        mediaSpecs: specs
      };
      return jsonResponse_(payload2, callback);
    } catch (err2) {
      return jsonResponse_({ success: false, error: String(err2) }, callback);
    }
  }

  if (action === 'getEditorialTopicForJob') {
    try {
      var pubId = e.parameter.publicationId || '';
      var runDateStr = e.parameter.runDate || '';

      if (!pubId || !runDateStr) {
        return jsonResponse_({ success: false, error: 'Missing publicationId or runDate' }, callback);
      }

      var edSheet = getSheet_(SHEET_NAME_EDITORIAL);
      var edData = edSheet.getDataRange().getValues();
      if (edData.length < 2) {
        return jsonResponse_({ success: true, topicText: '', showContext: '' }, callback);
      }

      var edHeader = edData[0];
      var edMap = getHeaderMap_(edSheet);

      // Parse the runDate and convert to Month name, e.g., "September"
      var runDate = new Date(runDateStr);
      if (isNaN(runDate.getTime())) {
        return jsonResponse_({ success: false, error: 'Invalid runDate' }, callback);
      }

      var monthName = Utilities.formatDate(runDate, Session.getScriptTimeZone(), 'MMMM');
      var foundTopic = '';
      var foundShowContext = '';

      for (var r = 1; r < edData.length; r++) {
        var rowPubId = String(edData[r][edMap['PublicationId']] || '');
        var rowMonth = String(edData[r][edMap['Month']] || '');

        if (rowPubId === String(pubId) && rowMonth === monthName) {
          var rowObj = rowToObject_(edData[r], edHeader);

          // Prefer EditorialTopic, fall back to Topic if that exists
          foundTopic = rowObj.EditorialTopic || rowObj.Topic || '';
          foundShowContext = rowObj.ShowContext || '';
          break;
        }
      }

      return jsonResponse_({
        success: true,
        topicText: foundTopic,
        showContext: foundShowContext
      }, callback);
    } catch (err3) {
      return jsonResponse_({ success: false, error: String(err3) }, callback);
    }
  }

  // fallback: no or unknown action – return JSON with CORS instead of bare HTML
  return jsonResponse_({
    ok: false,
    error: 'Unknown or missing action',
    action: action,
    params: e && e.parameter ? e.parameter : null,
    marker: 'fallback-v1'
  }, callback);
}

function doPost(e) {
  var action = e && e.parameter && e.parameter.action;

  if (action === 'updateArtStartDraftFields') {
    return handleUpdateArtStartDraftFields_(e);
  }

  if (action === 'createJobFromForm') {
    // Expect JSON in the POST body
    var raw = e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return jsonResponse_({ success: false, error: 'Invalid JSON payload' });
    }

    try {
      // Create the job in Sheets
      var result = createJob(payload);

      // Send the ArtStart email
      try {
        sendArtStartEmail(result.ascendJobId);
      } catch (emailErr) {
        // log but don't fail the whole response
        Logger.log('Error sending ArtStart email: ' + emailErr);
        result.emailError = String(emailErr);
      }

      return jsonResponse_(result);
    } catch (err2) {
      return jsonResponse_({ success: false, error: String(err2) });
    }
  }

  // Fallback for unknown POST actions
  return jsonResponse_({ success: false, error: 'Unsupported POST action' });
}

function testSendArtStartEmail() {
  var jobId = 'ASC-2025-11-23-001'; // <-- Replace with a real AscendJobId in your sheet
  var result = sendArtStartEmail(jobId);
  Logger.log(JSON.stringify(result, null, 2));
}
