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

// App destinations (replace with real URLs when ready)
const ARTSTART_URL = "/ascend/artstart/assets/job_intake.html";
const COPYDESK_URL = "https://script.google.com/macros/s/AKfycbwW7nb_iJiZJBKeUIQtpp_GOY4tnLQidefDyOHqZDpQkfMympH2Ip4kvgv8bE1or9O9/exec";
const CODEDESK_URL = "https://okqral.com";

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
  const firstName = session && session.userNameFirst ? session.userNameFirst : null;
  const fullName = session && session.userNameFull ? session.userNameFull : null;

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

  function applyLoggedOutUI() {
    setAppState("logged-out");
    renderSessionStatus("Waiting for login via QR…");
  }

  function applyLoggedInUI(session) {
    setAppState("logged-in");
    updateUserChip(session);
    renderSessionStatus(
      `Logged in as ${session.userEmail}. Keep me logged in: ${
        session.keepLoggedIn ? "On" : "Off"
      }.`
    );
  }

  function simulateServerHandshake(callback) {
    // TODO: Replace this with real backend polling.
    // For now, we simulate an immediate success when called.
    setTimeout(callback, 500);
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
        const userNameFull =
          data.user_name || data.userName || null;

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