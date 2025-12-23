"use strict";

(function () {
  const SESSION_KEY = "ascend_session_v1";
  const STATE_ATTR = "data-ascend-state";

  // Knobs/config grouped together:
  const SESSION_DEFAULT_DURATION_MINUTES = 8 * 60; // 8 hours
  const POLLING_INTERVAL_MS = 4000; // poll backend for QR-auth handshake

  // Auth + routing knobs (single source of truth)
  const AUTH_ENDPOINT = "https://api.jacobhenderson.studio/auth";
  // NOTE: token is currently baked into the static QR as "test". Need to update
  const HANDSHAKE_TOKEN = "test";

  // App destinations – always point to the live GitHub Pages workspace
  const ARTSTART_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/artstart/job_intake.html"; // "New job" intake
  const ARTSTART_JOB_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/artstart/assets/artstart.html"; // Existing job view
  const COPYDESK_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/copydesk/frontend/index.html";
  const COPYDESK_JOB_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/copydesk/frontend/job.html";
    
  const CODEDESK_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/codedesk/index.html";

  // CodeDesk template manifest (static JSON; hopper templates must read from this)
  // Relative so it works on jacobhenderson.studio/ascend/ (and any mirrored host).
  const CODEDESK_MANIFEST_URL = "codedesk/qr_templates.json";

  // FileRoom (output / delivery layer)
  const FILEROOM_URL =
    "https://jacobeugenehenderson.github.io/ascend-portal/fileroom/frontend/index.html";

  const FILEROOM_API_BASE =
    "https://script.google.com/macros/s/AKfycbyZauMq2R6mIElFnAWVbWRDVgJqT713sT_PTdsixNi9IyZx-a3yiFT7bjk8XE_Fd709/exec";
  
  // ArtStart API base – same as art_start.js
  const ARTSTART_API_BASE =
    "https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec";

  // Copydesk API (hopper parity)
  const COPYDESK_API_BASE =
    "https://script.google.com/macros/s/AKfycbwW7nb_iJiZJBKeUIQtpp_GOY4tnLQidefDyOHqZDpQkfMympH2Ip4kvgv8bE1or9O9/exec";
    let pollingTimer = null;

  // --- URL helper: carry session identity + token into downstream apps ---
  function buildUrlWithUser(baseUrl) {
    if (!baseUrl || String(baseUrl).indexOf("http") !== 0) return baseUrl;

    const session = loadSession();
    const url = new URL(String(baseUrl));

    // propagate portal token if present
    try {
      const t = new URLSearchParams(window.location.search).get("token");
      if (t) url.searchParams.set("token", t);
    } catch (e) {}

    if (session && session.userEmail) url.searchParams.set("user_email", session.userEmail);
    if (session && session.userNameFirst) url.searchParams.set("user_name_first", session.userNameFirst);
    if (session && session.userNameFull) url.searchParams.set("user_name", session.userNameFull);

    return url.toString();
  }  

  function nowTs() {
    return Date.now();
  }

  // --- Time helpers (EOFD Eastern) ---
  // Rule: A due/cutoff DATE remains "in play" through End Of Day Eastern,
  // then rolls to "past due" immediately after.
  const EASTERN_TZ = "America/New_York";

  function easternYmdFromValue_(value) {
    if (!value) return null;
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return null;

      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: EASTERN_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });

      const parts = dtf.formatToParts(d);
      const out = {};
      parts.forEach((p) => {
        if (p.type !== "literal") out[p.type] = p.value;
      });

      const y = Number(out.year);
      const m = Number(out.month);
      const day = Number(out.day);
      if (!y || !m || !day) return null;

      return { y, m, d: day };
    } catch (e) {
      return null;
    }
  }

  function tzOffsetMinutesAt_(date, timeZone) {
    // Returns minutes to add to local "wall time" in the zone to reach UTC.
    // Positive means zone is behind UTC (e.g., -0500 => +300 minutes).
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const parts = dtf.formatToParts(date);
    const out = {};
    parts.forEach((p) => {
      if (p.type !== "literal") out[p.type] = p.value;
    });

    const asUtc =
      Date.UTC(
        Number(out.year),
        Number(out.month) - 1,
        Number(out.day),
        Number(out.hour),
        Number(out.minute),
        Number(out.second),
        0
      );

    // If the formatter says the zoned wall time is "asUtc",
    // compare to the actual instant to infer the offset.
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  function zonedWallTimeToUtcMs_(y, m, d, hh, mm, ss, ms, timeZone) {
    // Two-pass conversion to handle DST boundaries without dependencies.
    let guess = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
    let offset = tzOffsetMinutesAt_(new Date(guess), timeZone);
    guess = guess - offset * 60000;
    offset = tzOffsetMinutesAt_(new Date(guess), timeZone);
    return Date.UTC(y, m - 1, d, hh, mm, ss, ms) - offset * 60000;
  }

  function endOfDayEasternMs_(value) {
    const ymd = easternYmdFromValue_(value);
    if (!ymd) return null;

    // Compute start of next day (00:00:00.000 ET), then minus 1 ms.
    const nextDayUtc = zonedWallTimeToUtcMs_(
      ymd.y,
      ymd.m,
      ymd.d + 1,
      0,
      0,
      0,
      0,
      EASTERN_TZ
    );

    return nextDayUtc - 1;
  }

  function isPastEofdEastern_(value, nowMs) {
    const endMs = endOfDayEasternMs_(value);
    if (endMs == null) return false;
    return (nowMs != null ? nowMs : Date.now()) > endMs;
  }

  // --- FileRoom upsert helpers (clock-driven exits) ---
  const FILEROOM_UPSERTED_KEY = "ascend_fileroom_upserted_v1";

  function loadUpsertedMap_() {
    try {
      const raw = localStorage.getItem(FILEROOM_UPSERTED_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveUpsertedMap_(m) {
    try {
      localStorage.setItem(FILEROOM_UPSERTED_KEY, JSON.stringify(m || {}));
    } catch (e) {
      // ignore
    }
  }

  function ascendJobKey_(app, sourceId) {
    return String(app || "").toUpperCase() + ":" + String(sourceId || "");
  }

  function upsertFileRoomJob_(params) {
    if (!params) return;

    const callbackName =
      "ascendFileRoomUpsertCallback_" + String(Date.now()) + "_" + String(Math.floor(Math.random() * 100000));

    window[callbackName] = function (payload) {
      try {
        // Best-effort; no UI side effects here.
        // eslint-disable-next-line no-unused-vars
        const _ = payload;
      } catch (e) {
        // ignore
      } finally {
        try {
          delete window[callbackName];
        } catch (e2) {
          // ignore
        }
      }
    };

    const url = new URL(FILEROOM_API_BASE);
    url.searchParams.set("action", "upsertJob");
    url.searchParams.set("callback", callbackName);

    Object.keys(params).forEach((k) => {
      if (params[k] == null) return;
      url.searchParams.set(k, String(params[k]));
    });

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

  function maybeUpsertToFileRoomOnce_(app, sourceId, params) {
    const key = ascendJobKey_(app, sourceId);
    const m = loadUpsertedMap_();
    if (m[key]) return false;
    m[key] = 1;
    saveUpsertedMap_(m);
    upsertFileRoomJob_(params);
    return true;
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed || null;
    } catch (e) {
      console.warn("Ascend: failed to parse session", e);
      return null;
    }
  }

  function saveSession(session) {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function isSessionValid(session) {
    if (!session) return false;
    if (!session.userEmail) return false;
    return true;
  }

  function setAppState(state) {
    document.documentElement.setAttribute(STATE_ATTR, state);
  }

  function updateUserChip(session) {
    const chipLabel = document.getElementById("ascend-user-label");
    const accountLabel = document.getElementById("ascend-account-label");

    const email = session && session.userEmail ? session.userEmail : null;
    const firstName =
      session && session.userNameFirst ? session.userNameFirst : null;
    const fullName =
      session && session.userNameFull ? session.userNameFull : null;

    const label = firstName || fullName || email;

    if (!label) {
      if (chipLabel) chipLabel.textContent = "Not logged in";
      if (accountLabel) accountLabel.textContent = "Not logged in";
      return;
    }

    if (chipLabel) chipLabel.textContent = label;
    if (accountLabel) accountLabel.textContent = "";
  }

  function renderSessionStatus(message) {
    const el = document.getElementById("ascend-session-status");
    if (!el) return;
    el.textContent = message;
  }

  function clearArtStartHopper() {
    const lane = document.getElementById("ascend-artstart-list");
    if (!lane) return;
    lane.innerHTML = "";
  }

  function applyLoggedOutUI() {
    setAppState("logged-out");
    renderSessionStatus("Waiting for login via QR…");
    // NOTE: Do NOT clear hopper lanes on logout.
    // Keep the last-rendered rows in place so the dashboard doesn't "wipe" visually.
  }

  function applyLoggedInUI(session) {
    setAppState("logged-in");
    updateUserChip(session);
    renderSessionStatus(`Logged in as ${session.userEmail}.`);

    // Immediately paint empty-states so lanes never appear "blank" while JSONP loads/fails.
    renderArtStartHopper([]);
    renderCopydeskHopper([]);
    renderCodeDeskHopper([]); // safe no-op if lane not present yet
    renderFileRoomHopper([]);

    // Refresh hopper lanes for this user
    requestArtStartJobs();
    requestCopydeskJobs();
    requestCodeDeskTemplates(); // templates are static; still refresh on login
    requestFileRoomOutput();
  }

  function startPollingForLogin() {
    if (pollingTimer) {
      console.log("Starting polling loop for login…");
      clearInterval(pollingTimer);
      pollingTimer = null;
    }

    // Prefer ?token=… from the URL, fall back to our baked-in default.
    const urlToken = new URLSearchParams(window.location.search).get("token");
    const token = urlToken || HANDSHAKE_TOKEN;

    console.log("[Ascend] Using handshake token:", token);

    async function checkOnce() {
      try {
        const pollUrl =
          AUTH_ENDPOINT +
          "?token=" +
          encodeURIComponent(token) +
          "&_ts=" +
          String(Date.now());

        console.log("[Ascend] Polling auth at URL:", pollUrl);

        const resp = await fetch(pollUrl, { method: "GET", cache: "no-store" });

        // Hard HTTP failure (network / 4xx / 5xx)
        if (!resp.ok) {
          console.warn(
            "Ascend: handshake HTTP error",
            resp.status,
            resp.statusText
          );
          return;
        }

        const data = await resp.json();
        console.log("[Ascend] Poll response:", data);

        if (!data || typeof data !== "object") {
          console.warn("Ascend: unexpected handshake payload", data);
          return;
        }

        // --- Normalize legacy / alternate shapes ---

        // If backend returns { ok: true, email: "…" } without status,
        // treat that as a completed login.
        if (data.ok && !data.status) {
          console.log("[Ascend] Normalizing legacy auth payload");
          data.status = "complete";
        }

        // Try multiple possible email fields
        const userEmail =
          data.user_email || data.userEmail || data.email || null;

        const userNameFirst =
          data.user_name_first || data.userNameFirst || null;
        const userNameFull = data.user_name || data.userName || null;

        // Pending / initialized → keep waiting
        if (data.status === "pending" || data.status === "initialized") {
          renderSessionStatus("Waiting for login via QR…");
          return;
        }

        // Explicitly denied
        if (data.status === "denied") {
          console.warn("Ascend: phone login denied");
          renderSessionStatus("Phone login denied. Try again.");
          return;
        }

        // Completed
        if (data.status === "complete" && userEmail) {
          const session = {
            userEmail: userEmail,
            userNameFirst: userNameFirst,
            userNameFull: userNameFull,
            keepLoggedIn: true,
            createdAt: nowTs(),
            expiresAt: null,
          };

          saveSession(session);
          applyLoggedInUI(session);

          if (pollingTimer) {
            console.log("Stopping polling loop (login complete).");
            clearInterval(pollingTimer);
            pollingTimer = null;
          }

          return;
        }

        // Anything else → treat as "no change yet", let the next interval try again
        console.log(
          "Ascend: handshake state not recognized yet; will re-check.",
          data
        );
      } catch (err) {
        console.warn("Ascend: handshake check failed", err);
      }
    }

    // Initial immediate check, then interval polling.
    checkOnce();
    pollingTimer = setInterval(checkOnce, POLLING_INTERVAL_MS);
  }

    function initLogoutButton() {
      const btn = document.getElementById("ascend-logout-btn");
      if (!btn) return;
      btn.addEventListener("click", () => {
        // Clear any existing session
        saveSession(null);

        // Put the UI back into logged-out mode
        applyLoggedOutUI();
        updateUserChip(null);

        // IMPORTANT: start listening again for a new QR login
        startPollingForLogin();
      });
    }



  function buildCodeDeskUrl_(mode, extraParams) {
    // Always start from the user-carrying URL (token + user_email + names).
    const base = buildUrlWithUser(CODEDESK_URL);
    const url = new URL(base, window.location.href);

    // Required lifecycle signal: where did CodeDesk come from?
    url.searchParams.set("origin", "ascend");

    // Required lifecycle signal: which creation path?
    // - "new"      => ephemeral (no Hopper artifact)
    // - "template" => persistent working-file (implicit duplication)
    url.searchParams.set("mode", String(mode || "new"));

    // Optional extra params (template ids, parent job keys, etc.)
    if (extraParams && typeof extraParams === "object") {
      Object.keys(extraParams).forEach((k) => {
        const v = extraParams[k];
        if (v == null) return;
        const s = String(v).trim();
        if (!s) return;
        url.searchParams.set(k, s);
      });
    }

    return url.toString();
  }

  function openCodeDeskNew_() {
    const target = buildCodeDeskUrl_("new", {});
    if (!CODEDESK_URL || CODEDESK_URL.indexOf("http") !== 0) {
      alert("[Codedesk] Destination URL not configured yet.");
      return;
    }
    window.open(target, "_blank", "noopener");
  }

  // CodeDesk template-open → "working file creation" seam
function openCodeDeskFromTemplate_(tpl, parentAscendJobKey) {
  const templateId = (tpl && (tpl.id || tpl.template_id || tpl.TemplateId)) || "";
  const tid = String(templateId || "").trim();

  // Make the full template payload available to CodeDesk at open time.
  // (Wiring-only: no schema changes; CodeDesk can read whichever key it already supports.)
  try {
    const payload = JSON.stringify(tpl || {});
    localStorage.setItem("codedesk_template_bootstrap_v1", payload);
    localStorage.setItem("codedesk_template_bootstrap", payload);
    localStorage.setItem("ascend_codedesk_template_bootstrap_v1", payload);
  } catch (e) {}

  const target = buildCodeDeskUrl_("template", {
    template_id: tid,
    templateId: tid,
    template: tid,

    // Optional hint for CodeDesk (harmless if unused).
    bootstrap_key: "codedesk_template_bootstrap_v1",

    parent_ascend_job_key: parentAscendJobKey || ""
  });

  if (!CODEDESK_URL || CODEDESK_URL.indexOf("http") !== 0) {
    alert("[Codedesk] Destination URL not configured yet.");
    return;
  }
  window.open(target, "_blank", "noopener");
}

  // ---- Hopper: CodeDesk templates (manifest-driven) ----

  function renderCodeDeskHopper(items) {
    const lane = document.getElementById("ascend-codedesk-list");
    if (!lane) return;

    lane.innerHTML = "";

    if (!items || !items.length) {
      const empty = document.createElement("div");
      empty.className = "ascend-job-list-empty";
      empty.textContent = "";
      lane.appendChild(empty);
      return;
    }

    items.forEach((tpl) => {
      const templateId = (tpl && (tpl.id || tpl.template_id || tpl.TemplateId)) || "";
      const titleText = (tpl && (tpl.name || tpl.title || tpl.label || tpl.Name)) || "QR Template";

      const card = document.createElement("div");
      card.className = "ascend-job-card";
      card.dataset.codedesk = "template";
      if (templateId) card.dataset.templateId = String(templateId);

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "ascend-job-card-main";

      // Use the existing progress footprint for consistent layout,
      // but force all three dots to render in the "step 3" color (Ascend blue).
      const progress = buildHopperProgress_(3);
      const dots = progress.querySelectorAll(".ascend-hopper-progress-dot");
      dots.forEach((d) => (d.dataset.step = "3"));

      const textStack = document.createElement("div");
      textStack.className = "ascend-job-card-stack";

      const title = document.createElement("div");
      title.className = "ascend-job-card-title";
      title.textContent = titleText;

      textStack.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "ascend-job-card-context";
      meta.textContent = "TEMPLATE";
      textStack.appendChild(meta);

      mainBtn.appendChild(progress);
      mainBtn.appendChild(textStack);

      mainBtn.addEventListener("click", () => {
      // Parent job association is a later wiring step (needs Ascend job context).
      openCodeDeskFromTemplate_(tpl, "");
    });

      card.appendChild(mainBtn);
      lane.appendChild(card);
    });
  }

  function requestCodeDeskTemplates() {
    // Templates are static + global; still only load if logged in (parity with other lanes).
    const session = loadSession();
    if (!session || !session.userEmail) return;

    // If the lane doesn't exist in the shell yet, do nothing.
    const lane = document.getElementById("ascend-codedesk-list");
    if (!lane) return;

    fetch(CODEDESK_MANIFEST_URL, { method: "GET", cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Manifest HTTP " + r.status);
        return r.json();
      })
      .then((manifest) => {
        // Accept either:
        //  - [ ... ] (raw array)
        //  - { templates: [...] }
        let arr = [];

        if (Array.isArray(manifest)) arr = manifest;
        else if (manifest && Array.isArray(manifest.templates)) arr = manifest.templates;

        renderCodeDeskHopper(arr);
      })
      .catch((e) => {
        console.warn("Ascend: CodeDesk manifest load failed", e);
        renderCodeDeskHopper([]);
      });
  }

  function initPrimaryButtons() {
    
    const artstartBtn = document.getElementById("ascend-artstart-new");
    if (artstartBtn) {
      artstartBtn.addEventListener("click", () => {
        const target = buildUrlWithUser(ARTSTART_URL);
        if (!ARTSTART_URL) {
          alert("[Art Start] Destination URL not configured yet.");
          return;
        }
        window.open(target, "_blank", "noopener");
      });
    }

    const copydeskBtn = document.getElementById("ascend-copydesk-open");
    if (copydeskBtn) {
      copydeskBtn.addEventListener("click", () => {
        const target = buildUrlWithUser(COPYDESK_URL);
        if (!COPYDESK_URL) {
          alert("[Copydesk] Destination URL not configured yet.");
          return;
        }
        window.open(target, "_blank", "noopener");
      });
    }

    const codedeskBtn = document.getElementById("ascend-codedesk-open");
    if (codedeskBtn) {
      codedeskBtn.addEventListener("click", () => {
        if (!CODEDESK_URL || CODEDESK_URL.indexOf("http") !== 0) {
          alert("[Codedesk] Destination URL not configured yet.");
          return;
        }
        openCodeDeskNew_();
      });
    }

    const fileroomBtn = document.getElementById("ascend-fileroom-open");
    if (fileroomBtn) {
      fileroomBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (!FILEROOM_URL || FILEROOM_URL.indexOf("http") !== 0) {
          alert("[FileRoom] Destination URL not configured yet.");
          return;
        }
        window.open(FILEROOM_URL, "_blank", "noopener");
      });
    }
  }

  // ---- Hopper: ArtStart job cards ----

  function formatShortDate(value) {
    if (!value) return "";
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function normalizeStatus_(value) {
    if (value == null) return "";
    return String(value).trim().toLowerCase();
  }

  function buildHopperProgress_(stage) {
    const el = document.createElement("div");
    el.className = "ascend-hopper-progress";
    el.dataset.stage = String(stage || 1);

    for (let i = 1; i <= 3; i++) {
      const dot = document.createElement("span");
      dot.className = "ascend-hopper-progress-dot";
      dot.dataset.step = String(i);
      el.appendChild(dot);
    }
    return el;
  }

  function artStartStageForJob_(job) {
    // Stage 1: job created (default)
    // Stage 2: meeting scheduled (any meeting/touchpoint date present)
    // Stage 3: delivered OR past Materials Due (EOFD Eastern) (exit hopper)
    const status = normalizeStatus_(job && job.Status);

    // Date-driven exit (EOFD Eastern): once Materials Due day has passed,
    // the work window is over and the item must leave the Hopper.
    if (job && job.MaterialsDueDate && isPastEofdEastern_(job.MaterialsDueDate)) {
      return 3;
    }

    // Status-driven exit remains valid.
    if (status === "delivered") return 3;

    const meeting =
      (job && (job.TouchpointMeetingDate || job.MeetingDate || job.MeetingAt)) ||
      "";
    if (meeting) return 2;

    return 1;
  }

  function copydeskItemKind_(job) {
    // Attempt to detect subjobs without inventing schemas.
    const hasLang =
      !!(job && (job.Language || job.Lang || job.LanguageCode || job.Locale));
    const hasParent =
      !!(job && (job.ParentJobId || job.ParentJobID || job.ParentId || job.Parent));
    return hasLang || hasParent ? "subjob" : "job";
  }

  function copydeskStageForJob_(job) {
    const kind = copydeskItemKind_(job);
    const status = normalizeStatus_(job && job.Status);

    if (kind === "subjob") {
      // Subjobs enter the Hopper already "in progress":
      // Stage 2 by default, Stage 3 only when finished.
      if (status === "finished") return 3;
      return 2;
    }

    // Copydesk job
    // Stage 1: open
    // Stage 2: within closing window
    // Stage 3: closed OR past Cutoff (EOFD Eastern) (exit hopper)

    // Date-driven exit (EOFD Eastern): once Cutoff day has passed,
    // the committed artifact belongs in FileRoom, not the Hopper.
    if (job && job.Cutoff && isPastEofdEastern_(job.Cutoff)) return 3;

    if (status === "closed") return 3;
    if (status.indexOf("closing") !== -1) return 2;
    return 1;
  }

  // ---- Hopper: FileRoom output rows ----

    function renderFileRoomHopper(items) {
    const lane = document.getElementById("ascend-fileroom-list");
    if (!lane) return;

    lane.innerHTML = "";

    if (!items || !items.length) {
      const empty = document.createElement("div");
      empty.className = "ascend-job-list-empty";
      empty.textContent = "";
      lane.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const originRaw =
        (item &&
          (item.Origin ||
            item.origin ||
            item.Source ||
            item.source ||
            item.App ||
            item.app ||
            item.Type ||
            item.type ||
            item.Kind ||
            item.kind)) ||
        "";
      const origin = String(originRaw).trim().toLowerCase();

      const isArtStart =
        origin === "artstart" || origin === "art start" || origin === "art";
      const isCopydesk =
        origin === "copydesk" || origin === "copy desk" || origin === "copy";

      const title =
        item.title ||
        item.Title ||
        item.name ||
        item.Name ||
        item.FileName ||
        item.file_name ||
        item.Filename ||
        item.filename ||
        item.AssetName ||
        item.asset_name ||
        item.NordsonJobId ||
        item.AssetId ||
        item.asset_id ||
        item.JobId ||
        item.job_id ||
        "Untitled";

      // Display rules (per your spec):
      // - ArtStart: Name, Publication, SoldAs, Published Date
      // - Copydesk: Name, Revised: {date}
      const publication =
        item.PublicationName || item.Publication || item.PublicationId || "";
      const soldAs = item.SoldAs || item.DeliverableType || item.Deliverable || "";

      const publishedDate = formatShortDate(
        item.PublicationDate || item.PublishDate || item.PublishedAt
      );

      const revisedDate = formatShortDate(
        item.RevisedAt || item.UpdatedAt || item.CreatedAt
      );

      // FileRoom display requirement:
      // Show destination URL text (QR target) alongside thumbnails.
      // IMPORTANT: this is display-only; no job association is inferred.
      const destUrl =
        item.DestinationUrl ||
        item.DestinationURL ||
        item.destination_url ||
        item.dest_url ||
        item.DestUrl ||
        item.TargetUrl ||
        item.target_url ||
        item.Target ||
        item.Link ||
        item.link ||
        "";

      const contextText = isArtStart
        ? [publication, soldAs].filter(Boolean).join(" · ")
        : "";

      const timeText = isArtStart
        ? (publishedDate ? "PUBLISHED " + publishedDate.toUpperCase() : "")
        : (revisedDate ? "REVISED: " + revisedDate.toUpperCase() : "");

      const card = document.createElement("div");
      card.className = "ascend-job-card ascend-fileroom-card";

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "ascend-job-card-main";

      // Provenance badge (single gradient field + lettermark)
      const prov = document.createElement("div");
      prov.className = "ascend-job-card-provenance";

      if (isArtStart) prov.className += " is-artstart";
      if (isCopydesk) prov.className += " is-copydesk";

      const provText = document.createElement("span");
      provText.textContent = isCopydesk ? "C" : "A";
      prov.appendChild(provText);

      const textStack = document.createElement("div");
      textStack.className = "ascend-job-card-stack";

      const titleEl = document.createElement("div");
      titleEl.className = "ascend-job-card-title";
      titleEl.textContent = title;

      const contextEl = document.createElement("div");
      contextEl.className = "ascend-job-card-context";
      contextEl.textContent = contextText;

      const timeEl = document.createElement("div");
      timeEl.className = "ascend-job-card-time";
      timeEl.textContent = timeText;

      const urlEl = document.createElement("div");
      urlEl.className = "ascend-job-card-url";
      urlEl.textContent = destUrl ? String(destUrl) : "";

      textStack.appendChild(titleEl);
      if (contextText) textStack.appendChild(contextEl);
      if (destUrl) textStack.appendChild(urlEl);
      if (timeText) textStack.appendChild(timeEl);

      mainBtn.appendChild(prov);
      mainBtn.appendChild(textStack);

      // Open behavior (if url exists)
      mainBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const url =
          item.OpenUrl ||
          item.open_url ||
          item.Url ||
          item.url ||
          item.URL ||
          item.FileUrl ||
          item.file_url ||
          item.PreviewUrl ||
          item.preview_url ||
          "";
        if (url && String(url).indexOf("http") === 0) {
          window.open(String(url), "_blank", "noopener");
        }
      });

      // Delete row “x” (best-effort; removes from UI immediately)
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ascend-job-card-delete";
      deleteBtn.textContent = "×";
      deleteBtn.setAttribute("aria-label", "Remove row");

      deleteBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();

        // Immediate UI removal (authoritative visual behavior)
        card.remove();

        // Best-effort backend delete if an API exists (safe no-op if not)
        try {
          const id =
            item.RowId || item.Id || item.JobId || item.AssetId || item.FileId || "";
          if (FILEROOM_API_BASE && id) {
            fetch(FILEROOM_API_BASE, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", id: String(id) }),
            }).catch(() => {});
          }
        } catch (e) {}
      });

      card.appendChild(mainBtn);
      card.appendChild(deleteBtn);
      lane.appendChild(card);
    });
  }

  // ---- Hopper: Copydesk docs ----

  function renderCopydeskHopper(jobs) {
    const lane = document.getElementById("ascend-copydesk-list");
    if (!lane) return;

    lane.innerHTML = "";

    const visible = (jobs || []).filter((job) => copydeskStageForJob_(job) !== 3);

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "ascend-job-list-empty";
      empty.textContent = "";
      lane.appendChild(empty);
      return;
    }

    visible.forEach((job) => {
      const stage = copydeskStageForJob_(job);
      const kind = copydeskItemKind_(job);

      const card = document.createElement("div");
      card.className = "ascend-job-card";

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "ascend-job-card-main";

      const progress = buildHopperProgress_(stage);

      const textStack = document.createElement("div");
      textStack.className = "ascend-job-card-stack";

      const title = document.createElement("div");
      title.className = "ascend-job-card-title";
      title.textContent = job.JobName || job.JobId || "Untitled doc";

      const context = document.createElement("div");
      context.className = "ascend-job-card-context";

      const contextParts = [];
      if (kind === "subjob") {
        const lang = job.Language || job.Lang || job.LanguageCode || job.Locale || "";
        if (lang) contextParts.push(lang);
        const parent =
          job.ParentJobName ||
          job.ParentJobId ||
          job.ParentJobID ||
          job.ParentId ||
          job.Parent ||
          "";
        if (parent) contextParts.push(parent);
      }
      context.textContent = contextParts.join(" • ");

      const time = document.createElement("div");
      time.className = "ascend-job-card-time";
      const cutoffPretty = formatShortDate(job.Cutoff);
      time.textContent = cutoffPretty ? "CUTOFF: " + cutoffPretty.toUpperCase() : "";

      textStack.appendChild(title);
      if (context.textContent) textStack.appendChild(context);
      if (time.textContent) textStack.appendChild(time);

      mainBtn.appendChild(progress);
      mainBtn.appendChild(textStack);

      mainBtn.addEventListener("click", () => {
        const url =
          COPYDESK_JOB_URL +
          "?jobid=" +
          encodeURIComponent(job.JobId || "");
        const target = buildUrlWithUser(url);
        window.open(target, "_blank", "noopener");
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ascend-job-card-delete";
      deleteBtn.setAttribute("aria-label", "Remove doc from dashboard");
      deleteBtn.textContent = "×";

      deleteBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        dismissCopydeskJob(job.JobId);
      });

      card.appendChild(mainBtn);
      card.appendChild(deleteBtn);
      lane.appendChild(card);
    });
  }

  function requestCopydeskJobs() {
    const session = loadSession();
    if (!session || !session.userEmail) return;

    const callbackName = "ascendCopydeskJobsCallback";

    window[callbackName] = function (payload) {
      try {
        const jobs = payload && payload.jobs ? payload.jobs : [];
        const session2 = loadSession();
        const nowMs = Date.now();

        const inPlay = [];
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];

          // Clock-driven exit: once Cutoff day has passed (EOFD Eastern),
          // the job leaves Copydesk lane and appears in FileRoom.
          if (job && job.Cutoff && isPastEofdEastern_(job.Cutoff, nowMs)) {
            const sourceId = job.JobId || "";
            const title =
              job.JobName ||
              job.Name ||
              job.Title ||
              job.DocumentName ||
              job.NordsonJobId ||
              job.AscendJobId ||
              job.JobId ||
              "Untitled job";

            const subtitleParts = [];
            if (job.PublicationName) subtitleParts.push(job.PublicationName);
            if (job.SoldAs) subtitleParts.push(job.SoldAs);
            const subtitle = subtitleParts.join(" · ");

            const openUrlRaw =
              COPYDESK_JOB_URL + "?jobid=" + encodeURIComponent(job.JobId || "");
            const openUrl = buildUrlWithUser(openUrlRaw);

            maybeUpsertToFileRoomOnce_("copydesk", sourceId, {
              app: "copydesk",
              source_id: sourceId,
              title: title,
              subtitle: subtitle,
              open_url: openUrl,
              owner_email: (session2 && session2.userEmail) ? session2.userEmail : ""
            });

            // Do not show in Copydesk lane once it has exited.
            continue;
          }

          inPlay.push(job);
        }

        renderCopydeskHopper(inPlay);

        // Optional: refresh FileRoom lane sooner after upserts.
        requestFileRoomOutput();
      } catch (e) {
        console.warn("Ascend: error in Copydesk jobs callback", e);
        renderCopydeskHopper([]);
      }
    };

    const url = new URL(COPYDESK_API_BASE);
    url.searchParams.set("action", "listCopydeskJobsForUser");
    url.searchParams.set("user_email", session.userEmail);
    url.searchParams.set("limit", "50");
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

  function dismissCopydeskJob(jobId) {
    const session = loadSession();
    if (!session || !session.userEmail) return;
    if (!jobId) return;

    const confirmed = window.confirm(
      "Remove this document from your dashboard?"
    );
    if (!confirmed) return;

    const callbackName = "ascendDismissCopydeskJobCallback";

    window[callbackName] = function (payload) {
      try {
        // Regardless of success/failure, re-sync hopper state
        requestCopydeskJobs();
      } catch (e) {
        console.warn("Ascend: error in dismissCopydeskJob callback", e);
        requestCopydeskJobs();
      }
    };

    const url = new URL(COPYDESK_API_BASE);
    url.searchParams.set("action", "dismissCopydeskJob");
    url.searchParams.set("jobId", jobId);
    url.searchParams.set("user_email", session.userEmail);
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

    function renderArtStartHopper(jobs) {
    const lane = document.getElementById("ascend-artstart-list");
    if (!lane) return;

    lane.innerHTML = "";

    const visible = (jobs || []).filter((job) => artStartStageForJob_(job) !== 3);

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "ascend-job-list-empty";
      empty.textContent = "";
      lane.appendChild(empty);
      return;
    }

    visible.forEach((job) => {
      const stage = artStartStageForJob_(job);

      const card = document.createElement("div");
      card.className = "ascend-job-card";

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "ascend-job-card-main";

      const progress = buildHopperProgress_(stage);

      const textStack = document.createElement("div");
      textStack.className = "ascend-job-card-stack";

      const title = document.createElement("div");
      title.className = "ascend-job-card-title";
      title.textContent = job.NordsonJobId || job.AscendJobId || "Untitled job";

      const context = document.createElement("div");
      context.className = "ascend-job-card-context";

      const contextParts = [];
      if (job.PublicationName) contextParts.push(job.PublicationName);
      if (job.SoldAs) contextParts.push(job.SoldAs);
      context.textContent = contextParts.join(", ");

      const time = document.createElement("div");
      time.className = "ascend-job-card-time";

      const parts = [];
      const materialsDue = formatShortDate(job.MaterialsDueDate);
      const publishDate = formatShortDate(job.PublicationDate);

      if (materialsDue) parts.push("Materials Due " + materialsDue);
      if (publishDate) parts.push("Publish " + publishDate);

      time.textContent = parts.join(" · ");

      textStack.appendChild(title);
      if (context.textContent) textStack.appendChild(context);
      if (time.textContent) textStack.appendChild(time);

      mainBtn.appendChild(progress);
      mainBtn.appendChild(textStack);

      mainBtn.addEventListener("click", () => {
        const url =
          ARTSTART_JOB_URL + "?jobid=" + encodeURIComponent(job.AscendJobId || "");
        const target = buildUrlWithUser(url);
        window.open(target, "_blank", "noopener");
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ascend-job-card-delete";
      deleteBtn.setAttribute("aria-label", "Remove job from dashboard");
      deleteBtn.textContent = "×";

      deleteBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        deleteArtStartJob(job.AscendJobId);
      });

      card.appendChild(mainBtn);
      card.appendChild(deleteBtn);
      lane.appendChild(card);
    });
  }

  function requestArtStartJobs() {
    const session = loadSession();
    if (!session || !session.userEmail) {
      // NOTE: Do NOT clear hopper lanes when logged out / session missing.
      return;
    }

    const callbackName = "ascendArtStartJobsCallback";

    // JSONP callback: must be on window
    window[callbackName] = function (payload) {
      try {
        const jobs = payload && payload.jobs ? payload.jobs : [];
        const session2 = loadSession();
        const nowMs = Date.now();

        const inPlay = [];
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];

          // Clock-driven exit: once MaterialsDueDate day has passed (EOFD Eastern),
          // the job leaves ArtStart lane and appears in FileRoom.
          if (job && job.MaterialsDueDate && isPastEofdEastern_(job.MaterialsDueDate, nowMs)) {
            const sourceId = job.AscendJobId || "";
            const title = job.NordsonJobId || job.AscendJobId || "Untitled job";

            const subtitleParts = [];
            if (job.PublicationName) subtitleParts.push(job.PublicationName);
            if (job.DeliverableType) subtitleParts.push(job.DeliverableType);
            const subtitle = subtitleParts.join(" · ");

            const openUrlRaw =
              ARTSTART_JOB_URL + "?jobid=" + encodeURIComponent(job.AscendJobId || "");
            const openUrl = buildUrlWithUser(openUrlRaw);

            maybeUpsertToFileRoomOnce_("artstart", sourceId, {
              app: "artstart",
              source_id: sourceId,
              title: title,
              subtitle: subtitle,
              open_url: openUrl,
              owner_email: (session2 && session2.userEmail) ? session2.userEmail : ""
            });

            // Do not show in ArtStart lane once it has exited.
            continue;
          }

          inPlay.push(job);
        }

        renderArtStartHopper(inPlay);

        // Optional: refresh FileRoom lane sooner after upserts.
        requestFileRoomOutput();
      } catch (e) {
        console.warn("Ascend: error in ArtStart jobs callback", e);
      }
    };

    const url = new URL(ARTSTART_API_BASE);
    url.searchParams.set("action", "listArtStartJobsForUser");
    url.searchParams.set("user_email", session.userEmail);
    url.searchParams.set("limit", "50");
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

  function requestFileRoomOutput() {
    const session = loadSession();
    if (!session || !session.userEmail) {
      // NOTE: Do NOT clear hopper lanes when logged out / session missing.
      return;
    }

    const callbackName = "ascendFileRoomOutputCallback";

    window[callbackName] = function (payload) {
      try {
        // Accept either {items:[...]} or {assets:[...]} or {deliverables:[...]} or {jobs:[...]}
        // OR FileRoom Registry v0 shape: { data: { jobs:[...] } }
        const items =
          (payload && payload.items) ||
          (payload && payload.assets) ||
          (payload && payload.deliverables) ||
          (payload && payload.jobs) ||
          (payload && payload.data && payload.data.jobs) ||
          [];
        renderFileRoomHopper(items);
      } catch (e) {
        console.warn("Ascend: error in FileRoom output callback", e);
      }
    };

    const url = new URL(FILEROOM_API_BASE);
    // FileRoom Registry v0
    url.searchParams.set("action", "listJobsForUser");
    url.searchParams.set("user_email", session.userEmail);
    url.searchParams.set("limit", "5000");
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

  function deleteArtStartJob(jobId) {
    const session = loadSession();
    if (!session || !session.userEmail) {
      alert("Please log in again before removing jobs.");
      return;
    }
    if (!jobId) return;

    const confirmed = window.confirm(
      "Remove this job from your dashboard? This won't delete any working files."
    );
    if (!confirmed) return;

    const callbackName = "ascendDeleteArtStartJobCallback";

    window[callbackName] = function (payload) {
      if (!payload || payload.success === false) {
        console.warn("Ascend: deleteArtStartJob failed", payload);
      }
      // In all cases, refresh the list so the UI stays in sync
      requestArtStartJobs();
    };

    const url = new URL(ARTSTART_API_BASE);
    url.searchParams.set("action", "deleteArtStartJob");
    url.searchParams.set("jobId", jobId);
    url.searchParams.set("user_email", session.userEmail);
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    document.body.appendChild(script);
  }

    // ---- Debug hooks (safe, read-only) ----
  window.AscendDebug = window.AscendDebug || {};
  window.AscendDebug.requestArtStartJobs = requestArtStartJobs;
  window.AscendDebug.requestCopydeskJobs = requestCopydeskJobs;
  window.AscendDebug.requestFileRoomOutput = requestFileRoomOutput;
  window.AscendDebug.requestCodeDeskTemplates = requestCodeDeskTemplates;
  window.AscendDebug.CODEDESK_MANIFEST_URL = CODEDESK_MANIFEST_URL;
  window.AscendDebug.loadSession = loadSession;

    // ---- bootstrap ----

  function bootstrap() {
    initLogoutButton();
    initPrimaryButtons();

    const existing = loadSession();
    if (isSessionValid(existing)) {
      applyLoggedInUI(existing);
    } else {
      // No valid session yet: stay logged out, show QR, and begin polling
      // for the phone-side handshake.
      saveSession(null);
      applyLoggedOutUI();
      startPollingForLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();