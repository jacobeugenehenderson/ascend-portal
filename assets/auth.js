const AUTH_ENDPOINT = 'https://api.jacobhenderson.studio/auth';
  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || 'test';
  }

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
    if (!email) return;
    window.localStorage &&
      window.localStorage.setItem("ascendEmail", email);
  } catch (e) {
    // ignore storage failures
  }
}  

"use strict";

(function () {
  function getTokenFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || null;
  }

    function bootstrap() {
    const form = document.getElementById("ascend-auth-form");
    const emailInput = document.getElementById("ascend-auth-email");
    const statusEl = document.getElementById("ascend-auth-status");

    if (!form || !emailInput || !statusEl) return;

    // Prefill from previous successful login, if any
    const rememberedEmail = getStoredEmail();
    if (rememberedEmail && !emailInput.value.trim()) {
      emailInput.value = rememberedEmail;
      statusEl.textContent =
        `You’re about to log in as ${rememberedEmail}. ` +
        `Tap "Log me in" to continue.`;
    }

        const initialToken = getTokenFromUrl();

        if (!initialToken) {
          statusEl.textContent =
            "Missing token in URL. Try scanning the QR from the Ascend screen again.";
        }

                form.addEventListener("submit", async function (evt) {
          evt.preventDefault();

          const button = document.getElementById("ascend-auth-submit");
          const email = emailInput.value.trim();
          const token = getTokenFromUrl() || initialToken || "test";

          if (!email) {
            if (statusEl) {
              statusEl.textContent = "Please enter your Nordson email.";
            } else {
              alert("Please enter your Nordson email.");
            }
            return;
          }

          if (button) {
            button.disabled = true;
            button.textContent = "Linking…";
          }
          if (statusEl) {
            statusEl.textContent =
              "Linking this phone to your Ascend session…";
          }

          try {
            const deviceId = getOrCreateDeviceId();
            const payload = { token: token, email: email };
            if (deviceId) {
              payload.deviceId = deviceId;
            }

            const resp = await fetch(AUTH_ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            const data = await resp.json();
            console.log("Ascend auth: response", resp.status, data);

            if (!resp.ok || !data || data.ok === false) {
              const msg =
                (data && data.error) ?
                  data.error :
                  `Handshake failed (status ${resp.status})`;
              if (statusEl) {
                statusEl.textContent = msg;
              } else {
                alert(msg);
              }
              if (button) {
                button.disabled = false;
                button.textContent = "Log me in";
              }
              return;
            }

            // success path
            saveStoredEmail(email);

            if (statusEl) {
              statusEl.textContent =
                "You’re all set. You can return to the terminal.";
            }
            if (button) {
              button.textContent = "Linked ✅";
            }
          } catch (err) {
            console.warn("Ascend auth: failed to post handshake", err);
            const msg =
              (err && err.message) ?
                err.message :
                "Unexpected error during handshake.";
            if (statusEl) {
              statusEl.textContent = msg;
            } else {
              alert(msg);
            }
            if (button) {
              button.disabled = false;
              button.textContent = "Log me in";
            }
          }
        });  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();