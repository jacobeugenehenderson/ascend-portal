"use strict";

(function () {
  const SESSION_KEY = "ascend_session_v1";
  const STATE_ATTR = "data-ascend-state";

  // Knobs/config grouped together:
  const SESSION_DEFAULT_DURATION_MINUTES = 8 * 60; // 8 hours
  const POLLING_INTERVAL_MS = 4000; // later: poll backend for QR-auth handshake

  const AUTH_ENDPOINT = 'https://api.jacobhenderson.studio/auth';
  const HANDSHAKE_TOKEN = 'test'; // for now; later this can be unique per terminal

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
    if (!chipLabel) return;
    if (!session || !session.userEmail) {
      chipLabel.textContent = "Not logged in";
      return;
    }
    chipLabel.textContent = session.userEmail;
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
      clearInterval(pollingTimer);
      pollingTimer = null;
    }

    const token = HANDSHAKE_TOKEN;

    async function checkOnce() {
      try {
        const resp = await fetch(
          AUTH_ENDPOINT + '?token=' + encodeURIComponent(token),
          { method: 'GET' }
        );
        const data = await resp.json();

        if (!resp.ok || !data.ok) {
          console.warn('Ascend: handshake check error', data);
          return;
        }

        if (data.status === 'pending') {
          renderSessionStatus('Waiting for login via QR…');
          return;
        }

        if (data.status === 'complete' && data.user_email) {
          const keepToggle = document.getElementById('ascend-keep-logged-in');
          const keepOn =
            keepToggle && keepToggle.dataset.on === 'true' ? true : false;

          const session = {
            userEmail: data.user_email,
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
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
        }
      } catch (err) {
        console.warn('Ascend: handshake check failed', err);
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
      saveSession(null);
      applyLoggedOutUI();
      updateUserChip(null);
    });
  }

  function initPrimaryButtons() {
    const artstartBtn = document.getElementById("ascend-artstart-new");
    if (artstartBtn) {
      artstartBtn.addEventListener("click", () => {
        alert(
          "[Art Start] This will eventually launch the job intake flow for a new Nordson asset."
        );
      });
    }

    const copydeskBtn = document.getElementById("ascend-copydesk-open");
    if (copydeskBtn) {
      copydeskBtn.addEventListener("click", () => {
        alert("[Copydesk] This will open the editorial + translation UI.");
      });
    }

    const codedeskBtn = document.getElementById("ascend-codedesk-open");
    if (codedeskBtn) {
      codedeskBtn.addEventListener("click", () => {
        alert("[Codedesk] Internal utilities and prototype tools live here.");
      });
    }

    const fileroomBtn = document.getElementById("ascend-fileroom-open");
    if (fileroomBtn) {
      fileroomBtn.addEventListener("click", () => {
        alert(
          "[FileRoom] Future view into AI/PSD/INDD assets tied to Art Start jobs."
        );
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