# PA Bud

Chrome extension for Power Automate that shows **why** each failed flow run
failed, directly in the
28-day run history table (and the "All runs" page), so you don't have to open
every failed run one by one.

Under each red **Failed** status it adds a small line like:

> `Action 'Send_email_to_prospect' failed: You are not authorized to send mail
> on behalf of the specified sending account. (clientRequestId: ...)`

## Features

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

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder (`pa-bud`)
4. Reload the Power Automate flow page (full reload, F5 — the extension must be
   in place before the page loads so it can see the run-list request)

Works in Edge too (`edge://extensions`).

## Troubleshooting

Built against the July 2026 portal; Microsoft's internal API and DOM are
undocumented and can change. If nothing appears:

- Open DevTools → Console and inspect `window.__paRunErrorsState`:
  - `runs` empty → the run-list request wasn't captured. Check the Network tab
    for the request that loads run history (filter on `runs?`) and note its
    URL shape — the regex in `main.js` (`RUNS_RE`) may need adjusting.
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
  `manifest.json` for GCC.
- Error text appears a moment after the table renders (one API call per
  failed run, done lazily for visible rows).
