// assets/auth.js
"use strict";

const AUTH_ENDPOINT = "https://api.jacobhenderson.studio/auth";

/**
 * Grab the ?token=... from the URL.
 */
function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || null;
}

/**
 * Stable device ID, stored in localStorage.
 */
function getOrCreateDeviceId() {
  try {
    const storageKey = "ascendDeviceId";
    let id =
      window.localStorage &&
      window.localStorage.getItem(storageKey);

    if (!id) {
      if (window.crypto && window.crypto.randomUUID) {
        id = window.crypto.randomUUID();
      } else {
        id =
          "dev_" +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);
      }
      window.localStorage &&
        window.localStorage.setItem(storageKey, id);
    }
    return id;
  } catch (e) {
    return null;
  }
}

/**
 * Remembered email on this device.
 */
function getStoredEmail() {
  try {
    return (
      (window.localStorage &&
        window.localStorage.getItem("ascendEmail")) ||
      ""
    );
  } catch (e) {
    return "";
  }
}

function saveStoredEmail(email) {
  try {
    const clean = (email || "").trim().toLowerCase();
    if (!clean) return;
    window.localStorage &&
      window.localStorage.setItem("ascendEmail", clean);
  } catch (e) {
    // ignore storage failures
  }
}

(function () {
  function bootstrap() {
    const form = document.getElementById("ascend-auth-form");
    const emailInput = document.getElementById("ascend-auth-email");
    const statusEl = document.getElementById("ascend-auth-status");
    const button = document.getElementById("ascend-auth-submit");

    if (!form || !emailInput || !statusEl || !button) return;

const initialToken = getTokenFromUrl();

if (!initialToken) {
  statusEl.textContent =
    "Missing token in URL. Try scanning the QR from the Ascend screen again.";
}

// Pre-fill email if we have one, and offer a one-click "log in as" button.
const rememberedEmail = getStoredEmail();
if (rememberedEmail) {
  emailInput.value = rememberedEmail;

  const quick = document.getElementById("ascend-auth-quick");
  if (quick) {
    quick.style.display = "block";
    quick.innerHTML = `
      <button
        type="button"
        id="ascend-auth-quick-btn"
        style="
          border-radius: 999px;
          border: none;
          padding: 0.4rem 0.9rem;
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 500;
          background: rgba(79, 209, 197, 0.12);
          color: #e2e8f0;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        "
      >
        <span>Log in as ${rememberedEmail}</span>
        <span>✓</span>
      </button>
    `;

    const quickBtn = document.getElementById("ascend-auth-quick-btn");
    if (quickBtn) {
      quickBtn.addEventListener("click", function () {
        // Make sure the field is synced, then reuse the normal submit path
        emailInput.value = rememberedEmail;
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
      });
    }
  }
}

    form.addEventListener("submit", async function (evt) {
      evt.preventDefault();

      const email = emailInput.value.trim().toLowerCase();
      const token = getTokenFromUrl() || initialToken || "test";

      if (!email) {
        statusEl.textContent = "Please enter your Nordson email.";
        return;
      }

      button.disabled = true;
      button.textContent = "Linking…";
      statusEl.textContent =
        "Linking this phone to your Ascend session…";

      try {
        const deviceId = getOrCreateDeviceId();
        const payload = { token, email };
        if (deviceId) payload.deviceId = deviceId;

        const resp = await fetch(AUTH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        let data = null;
        try {
          data = await resp.json();
        } catch (_) {
          // ignore JSON parse errors; treat as failure below
        }

        console.log("Ascend auth: response", resp.status, data);

        if (
          !resp.ok ||
          !data ||
          data.ok === false ||
          data.status === "denied"
        ) {
          const msg =
            (data && data.error)
              ? data.error
              : `Handshake failed (status ${resp.status})`;

          statusEl.textContent = msg;
          button.disabled = false;
          button.textContent = "Log me in";
          return;
        }

        // Success – remember this email on this device
        saveStoredEmail(email);

        statusEl.textContent =
          "You’re all set. You can return to the terminal.";
        button.textContent = "Linked ✅";

        // Try to close the tab after a short beat
        setTimeout(() => {
          window.close();
          // Fallback if window.close() is blocked
          window.location.href = "about:blank";
        }, 450);
      } catch (err) {
        console.warn("Ascend auth: failed to post handshake", err);
        const msg =
          (err && err.message)
            ? err.message
            : "Unexpected error during handshake.";

        statusEl.textContent = msg;
        button.disabled = false;
        button.textContent = "Log me in";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();