# Store listing copy

## Listing text

**Name:** PA Bud

**Summary:** Debug Power Automate flows: find loop iterations, understand failed runs, and work through run history.

**Description** (paste as plain text):

```text
PA Bud is a debugging companion for Power Automate flows. It helps you find loop iterations, understand failed runs, and work through run history.

Find loop iterations: Enter a condition such as item()['id'] == 3 and jump directly to a match.
See failures inline: Read and copy the error under each failed run without opening it. This works in the 28-day history and All runs view.
Triage runs: Group identical errors, show only failed runs, export loaded runs to CSV, or select failed runs for resubmission.
Scan flow lists: See each flow's last-run status and error.

PA Bud uses your existing Power Automate session to read run details from Microsoft's APIs. It displays and searches them in your browser. There is no PA Bud server or analytics service.

English UI and commercial Power Automate hosts only. PA Bud is an independent project and is not affiliated with Microsoft.
```

**Category:** Workflow & Planning

**Language:** English

## Graphics

| Asset | File | Notes |
|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 |
| Store screenshot | `screenshot-1280x800.png` | 1280×800 |
| README screenshots | `screenshots/` | Feature crops; too small for a store screenshot upload |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee | `promo-marquee-1400x560.png` | 1400×560 |

## Privacy tab answers

- **Purpose:** Help debug Power Automate flows by finding loop iterations, showing failure details, and organizing run history.
- **Site access:** The content script runs on Power Automate pages to read the run view and call Microsoft's Power Automate API with the user's existing session.
- **Remote code:** None; all extension code is in the package.
- **Data handling:** PA Bud has no server or analytics. It keeps run data in browser memory and saves only the “Failed only” preference in the site's local storage. API requests go to Microsoft.

## Privacy policy

Host `privacy-policy.html` from the repository root and use its public URL in the store form.
