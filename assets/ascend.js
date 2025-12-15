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
    "https://jacobeugenehenderson.github.io/ascend-portal/copydesk/frontend/assets/index.html";
  const CODEDESK_URL = "https://okqral.com";
  
  // ArtStart API base – same as art_start.js
  const ARTSTART_API_BASE =
    "https://script.google.com/macros/s/AKfycbw12g89k3qX8DywVn2rrGV2RZxgyS86QrLiqiUP9198J-HJaA7XUfLIoteCtXBEQIPxOQ/exec";

  let pollingTimer = null;

  function nowTs() {
    return Date.now();
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
    if (session.keepLoggedIn) return true;

    const expiresAt = session.expiresAt;
    if (!expiresAt) return false;
    return nowTs() < expiresAt;
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
    if (accountLabel) accountLabel.textContent = `Signed in as ${label}`;
  }

  function updateKeepLoggedInToggle(session) {
    const toggle = document.getElementById("ascend-keep-logged-in");
    if (!toggle) return;
    const keep = !!(session && session.keepLoggedIn !== false);
    toggle.dataset.on = keep ? "true" : "false";
    toggle.setAttribute("aria-pressed", keep ? "true" : "false");
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
    clearArtStartHopper();
  }

  function applyLoggedInUI(session) {
    setAppState("logged-in");
    updateUserChip(session);
    renderSessionStatus(
      `Logged in as ${session.userEmail}. Keep me logged in: ${
        session.keepLoggedIn ? "On" : "Off"
      }.`
    );
    // Refresh the ArtStart hopper lane for this user
    requestArtStartJobs();
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
        const pollUrl = AUTH_ENDPOINT + "?token=" + encodeURIComponent(token);
        console.log("[Ascend] Polling auth at URL:", pollUrl);

        const resp = await fetch(pollUrl, { method: "GET" });

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
          const keepToggle = document.getElementById("ascend-keep-logged-in");
          const keepOn =
            keepToggle && keepToggle.dataset.on === "true" ? true : false;

          const session = {
            userEmail: userEmail,
            userNameFirst: userNameFirst,
            userNameFull: userNameFull,
            keepLoggedIn: keepOn,
            createdAt: nowTs(),
            expiresAt: keepOn
              ? null
              : nowTs() + SESSION_DEFAULT_DURATION_MINUTES * 60 * 1000,
          };

          saveSession(session);
          updateKeepLoggedInToggle(session);
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

  function initKeepLoggedInToggle() {
    const toggle = document.getElementById("ascend-keep-logged-in");
    if (!toggle) return;

    toggle.addEventListener("click", () => {
      const current = toggle.dataset.on === "true";
      const next = !current;
      toggle.dataset.on = next ? "true" : "false";
      toggle.setAttribute("aria-pressed", next ? "true" : "false");

      const session = loadSession();
      if (session) {
        session.keepLoggedIn = next;
        if (!next) {
          session.expiresAt =
            nowTs() + SESSION_DEFAULT_DURATION_MINUTES * 60 * 1000;
        } else {
          session.expiresAt = null;
        }
        saveSession(session);
        applyLoggedInUI(session);
      }
    });
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

  function buildUrlWithUser(baseUrl) {
    const session = loadSession();
    if (!session || !session.userEmail || !baseUrl) return baseUrl;

    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("user_email", session.userEmail);

    if (session.userNameFirst) {
      url.searchParams.set("user_name_first", session.userNameFirst);
    }
    if (session.userNameFull) {
      url.searchParams.set("user_name", session.userNameFull);
    }

    return url.toString();
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
        window.open(CODEDESK_URL, "_blank", "noopener");
      });
    }

    const fileroomBtn = document.getElementById("ascend-fileroom-open");
    if (fileroomBtn) {
      // For now: disabled. We’ll grey it out in CSS and no-op the click.
      fileroomBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
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

  function renderArtStartHopper(jobs) {
    const lane = document.getElementById("ascend-artstart-list");
    if (!lane) return;

    lane.innerHTML = "";

    if (!jobs || !jobs.length) {
      const empty = document.createElement("div");
      empty.className = "ascend-job-list-empty";
      empty.textContent = "No ArtStart jobs yet.";
      lane.appendChild(empty);
      return;
    }

    jobs.forEach((job) => {
      const card = document.createElement("div");
      card.className = "ascend-job-card";

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "ascend-job-card-main";

      const title = document.createElement("div");
      title.className = "ascend-job-card-title";
      title.textContent = job.NordsonJobId || job.AscendJobId || "Untitled job";

      const meta = document.createElement("div");
      meta.className = "ascend-job-card-meta";

      const metaParts = [];
      if (job.PublicationName) {
        metaParts.push(job.PublicationName);
      }
      const runDatePretty = formatShortDate(
        job.PublicationDate || job.MaterialsDueDate
      );
      if (runDatePretty) {
        metaParts.push("Runs " + runDatePretty);
      }

      meta.textContent = metaParts.join(" • ");

      mainBtn.appendChild(title);
      mainBtn.appendChild(meta);

      mainBtn.addEventListener("click", () => {
        const base =
          ARTSTART_JOB_URL +
          "?jobId=" +
          encodeURIComponent(job.AscendJobId || "");
        const target = buildUrlWithUser(base);
        console.log("[Ascend] Opening ArtStart job URL:", target);
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
      renderArtStartHopper([]);
      return;
    }

    const callbackName = "ascendArtStartJobsCallback";

    // JSONP callback: must be on window
    window[callbackName] = function (payload) {
      try {
        const jobs = payload && payload.jobs ? payload.jobs : [];
        renderArtStartHopper(jobs);
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

  // ---- bootstrap ----

  function bootstrap() {
    initKeepLoggedInToggle();
    initLogoutButton();
    initPrimaryButtons();

    const existing = loadSession();
    if (isSessionValid(existing)) {
      updateKeepLoggedInToggle(existing);
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