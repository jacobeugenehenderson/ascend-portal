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
