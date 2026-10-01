# PA Bud

PA Bud is a Chrome and Firefox helper for Power Automate. It shows failure
reasons directly in run history and helps you find the right iteration inside
an **Apply to each** loop.

Under each red **Failed** status it adds a small line like:

> `Action 'Send_email_to_prospect' failed: You are not authorized to send mail
> on behalf of the specified sending account. (clientRequestId: ...)`

## Project layout and builds

- `chrome/` — Chrome manifest and build script (Chrome 111+).
- `firefox/` — Firefox manifest and build script (Firefox 140+).
- `shared/src/` — one shared runtime, including the iteration finder and styles.
- `shared/icons/` and `shared/tests/` — shared icons and code-level tests.

Following the same convention as ADO Lens, build from the repository root:

```powershell
.\chrome\build.ps1
.\firefox\build.ps1
```

Packages are written to `chrome/dist/pa-bud-chrome-0.4.3.zip` and
`firefox/dist/pa-bud-firefox-0.4.3.zip`. Both include the same runtime files,
with `manifest.json` at the archive root. Firefox also includes its add-on ID
and built-in data-collection declaration. Builds exclude tests and `example.html`.
The legacy root `dist/` ZIP is an older release.

### Load for testing

- **Chrome:** extract the Chrome ZIP, open `chrome://extensions`, enable
  Developer mode, and **Load unpacked** using the extracted folder.
- **Firefox:** extract the Firefox ZIP, open `about:debugging`, choose
  **This Firefox → Load Temporary Add-on**, and select its `manifest.json`.

The repository root is no longer an unpacked extension. If you previously
loaded it in Chrome, load the extracted Chrome package instead. After code
changes, rebuild and re-extract your package, reload the extension, and refresh
the Power Automate page. Firefox temporary installations last until restart;
normal distribution requires a Mozilla-signed package.

Both browsers run the scripts in the page's `MAIN` world at `document_start`
so the existing network interception works without a separate injection bridge
([Mozilla documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)).

## Features

- **Find a loop iteration** — open an individual run, expand an **Apply to each**
  card, and click **Find iteration**. Search with `item()['id'] == 3`, then
  choose a match to jump straight to it. You can inspect and visit multiple
  matches.
- **Error under every failed run** — the same message the run-details banner
  shows, without opening the run. Nested failures (Apply to each / Scope /
  Condition) are drilled via the repetitions API, best-effort.
- **Click to copy** — click any error line to copy the full text.
- **Summary bar** above the table — failure count, identical errors grouped
  with counts (request ids are ignored when grouping), plus the controls below.
- **Failed only** toggle — hides succeeded runs (remembered across visits).
- **Export CSV** — run id, start/end, duration, status, error, and a direct
  link for every loaded run. Loads any missing error details first.
- **Bulk resubmit** — tick the checkbox on failed rows (or "Select all
  failed"), then "Resubmit selected". Asks for confirmation first; refresh the
  page afterwards to see the new runs.
- **Flow list pages** — each flow row gets a "Last run: ..." line, including
  the error if the last run failed (capped at 40 flows per page to limit API
  calls).
- **Works on "All runs"** (`.../flows/{id}/runs`) as well as the 28-day list —
  including when that view renders inside a frame, and with date formats that
  carry seconds or narrow no-break spaces. Pages loaded via "Load more" are
  picked up automatically, so the summary bar, CSV export, and bulk resubmit
  cover everything you've scrolled through.

### Iteration finder screenshots

The button appears beneath an expanded **Apply to each** loop:

![Find iteration button in an expanded loop](store-assets/screenshots/screenshot-1-finditerationbutton.png)

Search the loop's items and choose a matching iteration:

![Expression and matching iteration results](store-assets/screenshots/screenshot-2-expressionand%20resultswindow.png)

The run-history toolbar groups failures and offers filtering, CSV export, and
bulk resubmission:

![Run-history controls above the flow runs](store-assets/screenshots/screenshot-3-exportoutputs.png)

## How it works

- The extension runs inside `make.powerautomate.com` in the page's own JS world.
- It wraps `fetch`/`XMLHttpRequest` to capture the **bearer token** the portal
  already sends to the flow API, plus the response of the portal's own
  run-list call (`.../flows/{flowId}/runs?api-version=...`).
- For each run with status `Failed`, it calls the same internal API the
  run-details page uses:
  1. `GET .../runs/{runId}?$expand=properties/actions` → the run with all of
     its actions and their statuses.
  2. For the failed action, it downloads the action's `outputsLink` blob
     (a pre-signed URL) — that's where the real connector error lives, e.g.
     "You are not authorized to send mail on behalf of..." plus the
     clientRequestId / serviceRequestId.
  3. Fallback: the action's `error` object, then the generic run-level error.
- It matches API runs to table rows by the displayed start time (ties within
  the same minute are resolved by order, since both are sorted newest-first)
  and injects the message under the status text.

No data leaves your browser; it only talks to the same Microsoft API the
portal itself uses, with your existing session token.

### Find an Apply to each iteration

On a run page, expand the loop and click **Find iteration**. Enter a condition
such as `item()['id'] == 3`, click **Find matches**, then click **Go to 3** (or
another matching iteration). Results show a preview of each matching item.

| Kind | Supported syntax | Example |
| --- | --- | --- |
| Current item and properties | `item()`, `item().name`, `item()['name']`, `item()[0]`, `item()?['name']` | `item()['id'] == 3` |
| Values | Numbers, quoted strings, `true`, `false`, `null` | `item().active == true` |
| Comparisons | `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=` | `item().amount >= 100` |
| Logic | `&&`, `\|\|`, `!`, parentheses | `item().active && item().amount > 10` |
| Iteration index | `index()` (starts at 0) | `index() == 2` |
| Matching helpers | `equals(a, b)`, `contains(a, b)`, `startsWith(a, b)`, `endsWith(a, b)` | `contains(item().name, 'test')` |
| Value helpers | `empty(a)`, `length(a)`, `toLower(a)` | `toLower(item().status) == 'failed'` |

`==` and `!=` allow normal JavaScript value conversion (for example, `3` and
`'3'` match); `===`, `!==`, and `equals(a, b)` compare without conversion. The
finder supports this small expression set, not arbitrary JavaScript or the full
Power Automate expression language.

The finder downloads the loop's recorded input array once, evaluates the
condition locally, and caches the array for later searches. It does not make
one request per iteration. Secure or unavailable inputs cannot be searched;
nested loops need their current parent iteration loaded first.

Code-level checks: `node --test shared/tests/*.test.cjs`.

## Troubleshooting

Built against the July 2026 portal; Microsoft's internal API and DOM are
undocumented and can change. If nothing appears:

- Open DevTools → Console and inspect `window.__paRunErrorsState`:
  - `runs` empty → the run-list request wasn't captured. Check the Network tab
    for the request that loads run history (filter on `runs?`) and note its
    URL shape — the regex in `shared/src/main.js` (`RUNS_RE`) may need adjusting.
  - `runs` populated but no text in the table → the row matching failed.
    The date parser expects the `Jul 20, 10:07 AM` format; a different locale
    or column layout needs a tweak in `DATE_RE` / `annotate()`.
  - Errors show only the generic `ActionFailed: An action failed. No dependent
    actions succeeded.` → the `$expand` call or the outputs fetch failed; look
    for a `[pa-bud]` line in the Console and check the Network tab
    for the `$expand=properties/actions` request.
  - The failing action sits inside a Condition / Apply-to-each and only the
    container name shows → nested repetitions aren't walked yet; the fix goes
    in `loadError()`.

## Known limitations

- English UI only (matches on the literal text `Failed` and `AM`/`PM` dates).
- Commercial cloud hosts only; add `make.gov.powerautomate.us` etc. to
  both browser manifests for GCC.
- Error text appears a moment after the table renders (one API call per
  failed run, done lazily for visible rows).
