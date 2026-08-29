# CodeDesk — the QR studio

The generator behind the Ward's printed codes and the marketing site's contact code.
Static, no build step. Live at **https://jacobeugenehenderson.github.io/ascend-portal/**.

```
./publish.sh          commit everything and force-push to origin/main → Pages
./deploy-pages.sh     Cloudflare Pages variant (moves local asset symlinks aside first)
```

⚠️ `deploy-pages.sh` hard-codes `REPO_DIR="/Volumes/Today/ascend-portal"` and the old
`README.txt` told you to `cd` there. **This checkout is not that path.** Fix the path or
run the script from the volume; do not assume it works from here.

---

## The one thing to understand: there are TWO payload builders

Both answer "what string does this QR encode?", and they do not agree.

| | file | reached when |
|---|---|---|
| `buildText()` | `qr_ui_toolkit.js` (~line 988) | cases keyed `URL` `EMAIL` `PHONE` `SMS` `WIFI` `VCARD` `MAP` |
| the pipeline's builder | `qr_sync_pipeline.js` (~line 1500) | cases keyed `URL` `Payment` `WiFi` `Contact` `Message` `Event` `Map` |

⛔ **The case labels have DRIFTED from the manifest.** `qr_type_manifest.json` declares the
types — `URL · Payment · WiFi · Contact · Message · Event · Map` — so the pipeline's
labels match it and **`buildText`'s do not**. Its `SMS`, `VCARD`, `EMAIL` and `PHONE`
cases are keyed to type names no manifest offers, which makes them **dead twins**: they
look like the implementation, they read correctly, and nothing calls them.

⭐ **That is not academic. It is exactly how the 2026-08-29 bug survived:** the dead
`SMS` twin built a correct `sms:` URI, while the live `Message` case built a broken one.
Anyone who grepped for `sms:` found the good code first.

**If you change one, change both, or delete the twin.**

---

## Fields come from the manifest, and they render in **Mechanicals**

`qr_type_manifest.json` has three sections: `types` (which field ids each type shows),
`fields` (each id's label/kind/options), and `presets`. `renderTypeForm()` paints them
into `#detailsPanel`, which lives inside the **Mechanicals** drawer in `index.html` —
closed by default, along with Caption, Design and Finish.

⚠️ So a type whose fields you cannot find is not missing; the drawer is shut.

---

## SMS payloads — the rules, learned the hard way

The Message type builds an `sms:` URI. Three rules, each of which was once broken:

1. ⛔ **`?body=`, never `?&body=`.** RFC 5724 is `sms:<number>?body=<text>`. The stray
   ampersand makes the query malformed; combined with a pasted URI in the number field it
   produced `sms:N?body=A?&body=B` — two bodies, and the phone takes the last one.
2. ⛔ **No placeholder fallbacks.** `val("smsNumber") || "5551234567"` and
   `val("smsText") || "Hello"` meant an **empty form produced a working QR** — one that
   scans, addresses a stranger's number and says "Hello". A blank field must yield a blank
   payload, so the preview is visibly empty rather than plausibly wrong.
3. ⛔ **Strip the number, and never accept a whole URI in the number field.** `[^\d+]` is
   the filter; a pasted `sms:...?body=...` now reduces to its digits instead of nesting.

⚠️ **`?body=` is the RFC and what Android needs. iOS historically accepted `&body=`** and
takes `?` on current versions — but this is the one thing to re-test on a real handset of
each kind after any change here, because getting it wrong works perfectly on the phone in
your hand and fails on everyone else's.

---

## Two ways to make an SMS code, and when each is right

⭐ **The URL type already carries an `sms:` URI**, and this is often the quickest path:
paste the whole thing into **URL** and leave the UTM fields empty. `case "URL"` returns
the string verbatim when no UTM is set, so nothing is parsed and nothing is added.

✅ **A UTM tag on a non-http URI is now DROPPED, not smuggled in** *(guard added
2026-08-29)*. It used to corrupt the payload: `new URL()` parses `sms:` perfectly well, so
the branch did not throw — it re-encoded the query and appended the param.

    sms:+18773351917?body=Hi%20-%20about…                     what you pasted
    sms:+18773351917?body=Hi+-+about…&utm_source=yardsign     what you used to get

Spaces arrived as literal `+` in the message body, and the UTM landed in the body too.
⛔ The guard **says so** — a console warning, and the UTM inputs you filled get a `title`
explaining why they were ignored — because silently skipping would be a quieter version
of the same bug. `http`/`https` are untouched, and so is a relative path like `/host`.

⚠️ **So UTM is not the attribution channel for an SMS code.** Put the placement in the
body text — `…(theward.online)` vs `…(yard sign)` — which is the only field the recipient
and the sender both see anyway, and the only one you control at all (US carriers do not
allow an alphanumeric sender ID, so the "from" is always a bare number).

**The Message type** is the other path, and the better one once you want the number and
the text as separate fields — it builds the URI for you and sanitises the number.
⛔ Never paste a whole URI into Message's **Phone #** field; it is a number field.

---

## Verifying a code before it ships

⛔ **Do not judge a QR by looking at it.** Decode it, and note how hard it was:

- Chrome has `BarcodeDetector` built in — load the PNG in a page and call
  `new BarcodeDetector({formats:['qr_code']}).detect(img)`.
- Try several thresholds and scales. **The count matters as much as the answer:** the
  2026-08-29 pair decoded on 6-of-7 preprocessing variants (28-char payload) and
  **1-of-24** (151-char payload). Same size on screen, same logo, far less margin.

⭐ **Payload length is the scanning budget.** Every character adds modules to the same
square, so each module gets smaller, while a centre logo keeps occluding the same *area*
and eats a larger share of the error correction. A long friendly message can make a code
that a phone reads at 6 inches and a laptop screen does not read at all.
