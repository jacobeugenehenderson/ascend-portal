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

    // Pre-fill email if we have one, but always show the form.
    const rememberedEmail = getStoredEmail();
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
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