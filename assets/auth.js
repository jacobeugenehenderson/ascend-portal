  const AUTH_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxfon_qgn5hiQ58xOf8MvYbR9QFglDz27ECYjxcGmzJuQlCaX69hKtIeOiXsF7jZDEt/exec';

  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || 'test';
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
      }
      if (statusEl) {
        statusEl.textContent =
          "Linking this phone to your Ascend session…";
      }

      try {
        const resp = await fetch(AUTH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token, email: email }),
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
          }
          return;
        }

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
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();