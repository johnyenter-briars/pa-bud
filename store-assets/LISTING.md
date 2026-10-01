# Chrome Web Store listing kit

Everything to paste into the [developer dashboard](https://chrome.google.com/webstore/devconsole)
(one-time $5 registration fee per developer account).

## Package

Run `.\chrome\build.ps1`, then upload `chrome/dist/pa-bud-chrome-0.4.3.zip`
(manifest + shared runtime, including the iteration finder + styles + icons).
For Firefox, run `.\firefox\build.ps1`; its separate package is
`firefox/dist/pa-bud-firefox-0.4.3.zip` for Mozilla Add-ons signing/distribution.

## Store listing fields

**Name:** PA Bud

**Summary (132 chars max):**
> See why every failed Power Automate run failed — right in the run history,
> with grouping, filtering, CSV export, and bulk resubmit.

**Description:**
> Stop opening failed flow runs one by one. This extension shows the real
> failure reason for every failed run directly in the Power Automate run
> history — the same error message you'd see in the banner after clicking
> into the run, including the failed action's name and request IDs.
>
> Features:
> • Error message under every Failed row, in the 28-day history and the All
>   runs page (nested Apply to each / Scope failures are drilled into)
> • Click any error to copy it
> • Summary bar groups identical errors with counts
> • "Failed only" filter to hide successful runs
> • Export all loaded runs (with errors and links) to CSV
> • Select failed runs and bulk-resubmit them with one click
> • Flow list pages show each flow's last-run status and error
>
> Privacy: the extension runs entirely in your browser. It reuses your
> existing Power Automate session to call the same Microsoft API the portal
> itself uses, and sends no data anywhere else. No analytics, no tracking,
> no external servers.
>
> Not affiliated with or endorsed by Microsoft. Power Automate is a trademark
> of Microsoft Corporation.

**Category:** Workflow & Planning (or Developer Tools)

**Language:** English

## Graphics (all in this folder)

| Asset | File | Notes |
|---|---|---|
| Store icon (128×128, required) | `store-icon-128.png` | |
| Screenshot (1280×800, ≥1 required) | `screenshot-1280x800.png` | Feature overview card. **Strongly recommended:** add a real screenshot of the run history with errors showing — crop/blur tenant names, flow names, and request IDs first. Real screenshots convert better and reviewers prefer them. |
| Small promo tile (440×280, optional) | `promo-small-440x280.png` | |
| Marquee (1400×560, optional) | `promo-marquee-1400x560.png` | Needed only if featured |

## Privacy tab answers

- **Single purpose:** Displays the failure reason of failed Power Automate
  flow runs inline in the run history, with related triage tools (grouping,
  filtering, CSV export, resubmit).
- **Permission justifications:**
  - *Content scripts on make.powerautomate.com / flow.microsoft.com:* required
    to read the run history table and display error details in it. The
    extension calls the same Microsoft Power Automate API the portal uses,
    authenticated by the user's existing session.
  - *No host permissions, no storage, no background service worker are
    requested.*
- **Remote code:** No — all code is packaged; nothing is loaded from servers.
- **Data usage:** Does not collect, transmit, or sell any user data. All
  processing happens locally in the browser. (Check "None" for every data
  category.)

## Privacy policy

The dashboard requires a privacy policy URL. A ready-to-host page is at
`privacy-policy.html` in the project root. Easiest way to get a URL:

1. Create a public GitHub repo (e.g. `pa-bud`), add the file
2. Repo → Settings → Pages → Deploy from branch → `main`, root
3. URL becomes `https://<user>.github.io/pa-bud/privacy-policy.html`

(Or open a gist at gist.github.com, paste the file, and use the gist link —
the dashboard accepts any public URL.)

## Submission checklist

1. Zip uploaded, all fields above pasted in
2. At least one screenshot uploaded (add a real one if possible)
3. Privacy policy URL set
4. Visibility: choose **Unlisted** if this is just for you/colleagues —
   it skips no review but avoids cluttering search
5. Submit for review — content-script-only extensions typically clear review
   in a few days
