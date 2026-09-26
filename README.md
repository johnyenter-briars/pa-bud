# PA Bud

Chrome and Firefox extension for Power Automate that shows **why** each failed flow run
failed, directly in the
28-day run history table (and the "All runs" page), so you don't have to open
every failed run one by one.

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

Packages are written to `chrome/dist/pa-bud-chrome-0.4.0.zip` and
`firefox/dist/pa-bud-firefox-0.4.0.zip`. Both include the same runtime files,
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

- **Find a loop iteration** — on an individual run, each Apply to each card
  has a **Find iteration** button. Enter `item()['id'] == 3`, search, then click
  **Go to 3** to select that iteration in the existing viewer. Matches include
  an item preview; multiple matches can be visited individually.
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

### Finding loop items

Reload the unpacked extension after updating, then refresh the Power Automate
run page. Open a specific run (`.../flows/{flowId}/runs/{runId}`), expand an
Apply to each, and click **Find iteration**. If the finder is waiting for the
API address, click a loop arrow once and search again.

The finder searches the loop's recorded `foreachItems` input array, not a
child action's potentially transformed output. It uses the portal's captured
API address and downloads the input through its signed link. Searches do not
resubmit or execute the flow. Run data is held in memory and cleared when the
run changes. Secure/unavailable inputs cannot be searched. Nested loops need
their current parent repetition loaded in the viewer.

Supported expressions include property/index access, `==`, `===`, `!=`, `!==`,
`<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, and parentheses. Available functions:
`item()`, zero-based `index()`, `equals`, `contains`, `startsWith`, `endsWith`,
`empty`, `length`, and `toLower`. This is a small JSON expression language,
not arbitrary JavaScript or the full Power Automate expression language.

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
