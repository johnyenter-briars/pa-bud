// Power Automate run-history error annotator.
//
// Runs in the page's MAIN world so it can piggyback on the portal's own
// bearer token and call the same internal API the run-details page uses.
// Features:
//   - shows the real failure reason under each Failed row (leaf action error
//     from the outputs blob, with nested/repetition drilling)
//   - click an error to copy it
//   - summary bar: failure counts grouped by distinct error, failed-only
//     filter, CSV export, bulk resubmit of selected runs
//   - flow list pages: last-run status + error per flow
(() => {
  if (window.__paRunErrors) return;
  window.__paRunErrors = true;

  const state = {
    tokens: {},        // host -> Authorization header value
    lastToken: null,
    apiHost: null,     // e.g. us.api.flow.microsoft.com
    runsUrl: null,     // .../flows/{flowId}/runs  (no query string)
    apiVersion: '2016-11-01',
    runs: new Map(),   // runId -> { startTime, endTime, status, errorText, runLevelError, triggerName, runsUrl, fetching }
    flows: new Map(),  // flowId -> { status, startTime, errorText, fetching }
    selected: new Set(),
    failedOnly: localStorage.getItem('paErrCol.failedOnly') === '1',
    resubmitMsg: null,
    barEl: null,
  };
  // Debug hook: inspect from DevTools console via window.__paRunErrorsState
  window.__paRunErrorsState = state;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const RUNS_RE = /^(https:\/\/[^?]*\/flows\/[^/?]+\/runs)(?:\?|$)/i;
  // Tolerant of optional seconds and the narrow no-break spaces newer date
  // formatting inserts before AM/PM ("Jul 20, 10:07:32 AM").
  const DATE_RE = /([A-Za-z]{3})[\s\u00A0\u202F]+(\d{1,2}),?[\s\u00A0\u202F]+(\d{1,2}):(\d{2})(?::\d{2})?[\s\u00A0\u202F]*([AP]M)/i;
  const FLOW_PATH_RE = /\/flows\/([0-9a-f-]{36})/i;
  const FLOW_LINK_RE = /\/environments\/([^/]+)\/flows\/([0-9a-f-]{36})(?:\/|$)/i;
  const GENERIC_ERR = /An action failed\. No dependent actions succeeded/i;

  function fmtErr(err) {
    if (!err) return null;
    if (typeof err === 'string') return err;
    const parts = [];
    if (err.code) parts.push(err.code);
    if (err.message) parts.push(err.message);
    return parts.join(': ') || null;
  }

  function isGeneric(msg) {
    return !msg || GENERIC_ERR.test(msg);
  }

  // ---------- network interception ----------

  function sawRequest(url, auth) {
    iterationFinder?.observeRequest(url);
    if (!auth) return;
    try {
      const u = new URL(url, location.href);
      if (/flow\.microsoft\.com|powerautomate|powerplatform/i.test(u.host)) {
        state.tokens[u.host] = auth;
        state.lastToken = auth;
        if (/api\.flow\.microsoft\.com$/i.test(u.host) &&
            u.pathname.includes('/providers/Microsoft.ProcessSimple/')) {
          state.apiHost = u.host;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function sawRunsResponse(url, json) {
    const abs = new URL(url, location.href).href;
    const m = abs.match(RUNS_RE);
    if (!m || !json || !Array.isArray(json.value)) return;
    state.runsUrl = m[1];
    const av = new URL(abs).searchParams.get('api-version');
    if (av) state.apiVersion = av;
    for (const run of json.value) {
      const p = run.properties || {};
      if (!p.startTime) continue;
      const rec = state.runs.get(run.name) || {};
      rec.startTime = new Date(p.startTime);
      rec.endTime = p.endTime ? new Date(p.endTime) : rec.endTime;
      rec.status = p.status;
      rec.runsUrl = m[1];
      rec.triggerName = (p.trigger && p.trigger.name) || rec.triggerName;
      // Run-level error from the list is always the generic "ActionFailed"
      // text — keep it only as a last-resort fallback, never as the answer.
      rec.runLevelError = fmtErr(p.error) || rec.runLevelError || null;
      state.runs.set(run.name, rec);
    }
    scheduleAnnotate();
  }

  function headerAuth(headers) {
    if (!headers) return null;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return headers.get('authorization');
    }
    if (Array.isArray(headers)) {
      const h = headers.find(([k]) => /^authorization$/i.test(k));
      return h ? h[1] : null;
    }
    for (const k of Object.keys(headers)) {
      if (/^authorization$/i.test(k)) return headers[k];
    }
    return null;
  }

  const origFetch = window.fetch;
  const iterationFinder = window.__paCreateIterationFinder?.({ fetch: (...args) => origFetch(...args), tokenFor });
  window.fetch = function (input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
      const auth = (init && headerAuth(init.headers)) ||
        (typeof Request !== 'undefined' && input instanceof Request
          ? input.headers.get('authorization') : null);
      sawRequest(url, auth);
    } catch (e) { /* never break the page */ }
    const p = origFetch.apply(this, arguments);
    p.then((resp) => {
      try {
        if (RUNS_RE.test(new URL(url, location.href).href) || iterationFinder?.interested(url)) {
          resp.clone().json().then((j) => {
            sawRunsResponse(url, j);
            iterationFinder?.observeResponse(url, j);
            scheduleAnnotate();
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    }).catch(() => {});
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__paUrl = String(url);
    try { iterationFinder?.observeRequest(this.__paUrl); } catch (e) { /* never break the portal */ }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (/^authorization$/i.test(name)) sawRequest(this.__paUrl || '', value);
    } catch (e) { /* ignore */ }
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      const abs = new URL(this.__paUrl || '', location.href).href;
      if (RUNS_RE.test(abs) || iterationFinder?.interested(abs)) {
        this.addEventListener('load', () => {
          try {
            const json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            sawRunsResponse(abs, json);
            iterationFinder?.observeResponse(abs, json);
            scheduleAnnotate();
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    return origSend.apply(this, arguments);
  };

  // ---------- error detail fetching ----------

  function tokenFor(url) {
    try { return state.tokens[new URL(url).host] || state.lastToken; }
    catch (e) { return state.lastToken; }
  }

  async function api(url) {
    const resp = await origFetch(url, { headers: { authorization: tokenFor(url) } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return resp.json();
  }

  // A failed leaf action carries the real connector error in its outputs blob,
  // reachable via a pre-signed URL (no auth header needed).
  async function outputsMessage(link) {
    if (!link || !link.uri) return null;
    try {
      const resp = await origFetch(link.uri);
      if (!resp.ok) return null;
      const out = await resp.json();
      const body = out && out.body;
      const msg = (body && body.error && body.error.message) ||
        (body && body.message) ||
        (typeof body === 'string' ? body : null);
      if (!msg) return null;
      const raw = JSON.stringify(out);
      const ids = [];
      const cid = raw.match(/"(?:x-ms-)?client-?request-?id"\s*:\s*"([^"]+)"/i);
      const sid = raw.match(/"(?:x-ms-)?service-?request-?id"\s*:\s*"([^"]+)"/i);
      if (cid) ids.push(`clientRequestId: ${cid[1]}`);
      if (sid) ids.push(`serviceRequestId: ${sid[1]}`);
      return ids.length ? `${msg} (${ids.join(', ')})` : msg;
    } catch (e) {
      return null;
    }
  }

  // Prefer leaf failures (real outputs / specific error object) over generic
  // containers like a failed Condition or Scope.
  function actionScore(a) {
    let s = 0;
    if (a.outputsLink && a.outputsLink.uri) s += 2;
    if (!isGeneric(fmtErr(a.error))) s += 1;
    return s;
  }

  // Nested failures (Apply to each / Scope / Condition): drill into the
  // container's repetitions to find the iteration that actually failed.
  async function repetitionMessage(base, runId, actionName) {
    try {
      const reps = await api(`${base}/${runId}/actions/${encodeURIComponent(actionName)}/repetitions?api-version=${state.apiVersion}`);
      const all = reps.value || [];
      const failed = all.filter((r) =>
        /^(Failed|TimedOut|Aborted)$/i.test((r.properties || {}).status));
      for (const r of failed) {
        const p = r.properties || {};
        const m = (await outputsMessage(p.outputsLink)) ||
          (!isGeneric(fmtErr(p.error)) ? fmtErr(p.error) : null);
        if (m) {
          return all.length > 1 ? `${m} (failed on ${failed.length} of ${all.length} iterations)` : m;
        }
      }
    } catch (e) {
      console.debug('[pa-bud] repetitions fetch failed:', actionName, e);
    }
    return null;
  }

  async function loadError(runId, rec) {
    const base = rec.runsUrl || state.runsUrl;
    if (rec.fetching || rec.errorText || !base || !state.lastToken) return;
    rec.fetching = true;
    let msg = null;
    try {
      // Same call the run-details page makes: the run expanded with its actions.
      const run = await api(`${base}/${runId}?$expand=properties%2Factions&api-version=${state.apiVersion}`);
      const p = run.properties || {};
      rec.runLevelError = fmtErr(p.error) || fmtErr((p.trigger || {}).error) ||
        p.code || rec.runLevelError;
      rec.triggerName = (p.trigger && p.trigger.name) || rec.triggerName;
      const failed = Object.entries(p.actions || {})
        .map(([name, a]) => [name, a.properties || a])
        .filter(([, a]) => /^(Failed|TimedOut|Aborted)$/i.test(a.status || ''))
        .sort((x, y) => actionScore(y[1]) - actionScore(x[1]));
      for (const [name, a] of failed) {
        const m = (await outputsMessage(a.outputsLink)) ||
          (!isGeneric(fmtErr(a.error)) ? fmtErr(a.error) : null);
        if (m) {
          msg = `Action '${name}' failed: ${m}`;
          break;
        }
      }
      if (!msg) {
        for (const [name] of failed) {
          const m = await repetitionMessage(base, runId, name);
          if (m) {
            msg = `Action '${name}' failed: ${m}`;
            break;
          }
        }
      }
      if (!msg && failed.length) {
        const [name, a] = failed[0];
        msg = `Action '${name}' failed: ${fmtErr(a.error) || a.code || a.status}`;
      }
    } catch (e) {
      console.debug('[pa-bud] run $expand fetch failed:', e);
    }
    rec.errorText = msg || rec.runLevelError ||
      'Failed (no error details returned by the API)';
    rec.fetching = false;
    scheduleAnnotate();
  }

  // ---------- bulk resubmit ----------

  async function resubmitSelected(btn) {
    const ids = [...state.selected].filter((id) => state.runs.has(id));
    if (!ids.length) return;
    if (!window.confirm(`Resubmit ${ids.length} failed run(s)? Each one re-executes the flow for real.`)) return;
    btn.disabled = true;
    let ok = 0, bad = 0;
    for (const id of ids) {
      const rec = state.runs.get(id);
      const flowBase = (rec.runsUrl || state.runsUrl || '').replace(/\/runs$/, '');
      const trig = rec.triggerName || 'manual';
      try {
        const resp = await origFetch(
          `${flowBase}/triggers/${encodeURIComponent(trig)}/histories/${id}/resubmit?api-version=${state.apiVersion}`,
          { method: 'POST', headers: { authorization: tokenFor(flowBase) } });
        if (resp.ok) {
          ok++;
          state.selected.delete(id);
        } else {
          bad++;
          console.debug('[pa-bud] resubmit failed:', id, resp.status, await resp.text());
        }
      } catch (e) {
        bad++;
        console.debug('[pa-bud] resubmit failed:', id, e);
      }
    }
    state.resubmitMsg = `Resubmitted ${ok} run(s)` +
      (bad ? `, ${bad} failed — details in the DevTools console` : '') +
      '. Refresh the run history to see the new runs.';
    btn.disabled = false;
    scheduleAnnotate();
  }

  // ---------- CSV export ----------

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  async function exportCsv() {
    const pending = [...state.runs.entries()]
      .filter(([, r]) => r.status === 'Failed' && !r.errorText);
    await Promise.all(pending.map(([id, r]) => loadError(id, r)));
    for (let i = 0; i < 50 && [...state.runs.values()].some((r) => r.fetching); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const flowBase = (location.pathname.match(/.*\/flows\/[^/]+/) || [''])[0];
    const rows = [['runId', 'start', 'end', 'durationSeconds', 'status', 'error', 'link']];
    [...state.runs.entries()]
      .sort((a, b) => b[1].startTime - a[1].startTime)
      .forEach(([id, r]) => {
        rows.push([
          id,
          r.startTime ? r.startTime.toISOString() : '',
          r.endTime ? r.endTime.toISOString() : '',
          r.endTime && r.startTime ? Math.round((r.endTime - r.startTime) / 1000) : '',
          r.status || '',
          r.errorText || '',
          flowBase ? `${location.origin}${flowBase}/runs/${id}` : '',
        ]);
      });
    const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')],
      { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flow-run-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- summary bar ----------

  function updateResubmitCount() {
    if (!state.barEl) return;
    const btn = state.barEl.querySelector('.pa-resubmit');
    if (btn) btn.textContent = `Resubmit selected (${state.selected.size})`;
  }

  function renderSummary(grid) {
    let bar = state.barEl;
    if (!bar || !bar.isConnected) {
      if (bar) bar.remove();
      bar = document.createElement('div');
      bar.className = 'pa-err-summary';
      bar.innerHTML = `
        <div class="pa-err-summary-top">
          <span class="pa-err-counts"></span>
          <span class="pa-err-tools">
            <label class="pa-toggle"><input type="checkbox" class="pa-failed-only"> Failed only</label>
            <button type="button" class="pa-btn pa-export">Export CSV</button>
            <button type="button" class="pa-btn pa-select-failed">Select all failed</button>
            <button type="button" class="pa-btn pa-resubmit">Resubmit selected (0)</button>
          </span>
        </div>
        <div class="pa-err-groups"></div>
        <div class="pa-err-note"></div>`;
      const cb = bar.querySelector('.pa-failed-only');
      cb.checked = state.failedOnly;
      cb.addEventListener('change', () => {
        state.failedOnly = cb.checked;
        localStorage.setItem('paErrCol.failedOnly', state.failedOnly ? '1' : '0');
        scheduleAnnotate();
      });
      bar.querySelector('.pa-export').addEventListener('click', () => exportCsv());
      bar.querySelector('.pa-select-failed').addEventListener('click', () => {
        [...state.runs.entries()]
          .filter(([, r]) => r.status === 'Failed')
          .forEach(([id]) => state.selected.add(id));
        scheduleAnnotate();
      });
      bar.querySelector('.pa-resubmit').addEventListener('click', (e) => resubmitSelected(e.target));
      grid.parentElement.insertBefore(bar, grid);
      state.barEl = bar;
    }

    const failed = [...state.runs.values()].filter((r) => r.status === 'Failed');
    const groups = new Map();
    failed.forEach((r) => {
      if (!r.errorText) return;
      // Ignore per-run request ids when grouping identical errors.
      const k = r.errorText
        .replace(/\s*\((clientRequestId|serviceRequestId)[^)]*\)\s*$/i, '')
        .replace(/\b(clientRequestId|serviceRequestId):\s*[0-9a-f-]+\b/gi, '')
        .trim();
      groups.set(k, (groups.get(k) || 0) + 1);
    });

    const sig = JSON.stringify([[...groups], failed.length, state.selected.size, state.resubmitMsg]);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;

    bar.querySelector('.pa-err-counts').textContent =
      `${failed.length} failed run(s) loaded` +
      (groups.size ? ` · ${groups.size} distinct error(s)` : '');
    const g = bar.querySelector('.pa-err-groups');
    g.textContent = '';
    [...groups.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([msg, count]) => {
        const row = document.createElement('div');
        row.className = 'pa-err-group';
        const b = document.createElement('b');
        b.textContent = `${count} × `;
        row.appendChild(b);
        row.appendChild(document.createTextNode(msg));
        row.title = msg;
        g.appendChild(row);
      });
    bar.querySelector('.pa-err-note').textContent = state.resubmitMsg || '';
    updateResubmitCount();
  }

  // ---------- run-history annotation ----------

  function minuteKey(d) {
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  }

  function attachCopy(tag) {
    tag.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = tag.title || tag.textContent;
      const done = () => {
        tag.classList.add('pa-copied');
        setTimeout(() => tag.classList.remove('pa-copied'), 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(() => {});
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = t;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          done();
        } catch (err) { /* ignore */ }
      }
    });
  }

  function annotateRunHistory() {
    if (!state.runs.size) return;
    const curFlow = (location.pathname.match(FLOW_PATH_RE) || [])[1];
    // Failed runs grouped by displayed minute, newest first — same sort as the
    // table, so runs sharing a minute get assigned to rows in encounter order.
    const queues = new Map();
    [...state.runs.entries()]
      .filter(([, r]) => r.status === 'Failed' &&
        (!curFlow || !r.runsUrl || r.runsUrl.toLowerCase().includes(curFlow.toLowerCase())))
      .sort((a, b) => b[1].startTime - a[1].startTime)
      .forEach(([id, rec]) => {
        const k = minuteKey(rec.startTime);
        if (!queues.has(k)) queues.set(k, []);
        queues.get(k).push({ id, rec });
      });

    let grid = null;
    for (const row of document.querySelectorAll('[role="row"]')) {
      const text = row.textContent || '';
      const m = text.match(DATE_RE);
      if (!m) continue;
      if (!grid) grid = row.closest('[role="grid"]') || row.parentElement;
      const isFailed = /Failed/.test(text);
      row.classList.toggle('pa-hide', state.failedOnly && !isFailed);
      if (!isFailed) continue;
      const mon = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      const key = `${mon} ${parseInt(m[2], 10)}, ${parseInt(m[3], 10)}:${m[4]} ${m[5].toUpperCase()}`;
      const q = queues.get(key);
      if (!q || !q.length) continue;
      const { id, rec } = q.shift();

      const cells = row.querySelectorAll('[role="gridcell"], [role="cell"], td');
      let statusCell = null;
      for (const c of cells) {
        if ((c.textContent || '').trim().startsWith('Failed')) statusCell = c;
      }
      if (!statusCell) statusCell = cells[cells.length - 1] || row;

      // resubmit checkbox in the first cell
      const firstCell = cells[0];
      if (firstCell) {
        let cb = firstCell.querySelector('.pa-resubmit-cb');
        if (!cb) {
          cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'pa-resubmit-cb';
          cb.title = 'Select for resubmit';
          cb.addEventListener('click', (e) => e.stopPropagation());
          cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) state.selected.add(cb.dataset.runId);
            else state.selected.delete(cb.dataset.runId);
            updateResubmitCount();
          });
          firstCell.insertBefore(cb, firstCell.firstChild);
        }
        cb.dataset.runId = id;
        cb.checked = state.selected.has(id);
      }

      let tag = statusCell.querySelector('.pa-run-error');
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'pa-run-error';
        attachCopy(tag);
        statusCell.appendChild(tag);
      }
      if (rec.errorText) {
        if (tag.title !== rec.errorText) {
          tag.textContent = rec.errorText;
          tag.title = rec.errorText;
        }
      } else {
        if (!tag.textContent) tag.textContent = '…';
        loadError(id, rec);
      }
    }
    if (grid) renderSummary(grid);
  }

  // ---------- flow list annotation ----------

  async function fetchLastRun(envId, flowId, rec) {
    if (rec.fetching) return;
    rec.fetching = true;
    try {
      const base = `https://${state.apiHost}/providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}/runs`;
      const j = await api(`${base}?api-version=${state.apiVersion}&$top=1`);
      const run = (j.value || [])[0];
      if (run) {
        const p = run.properties || {};
        rec.status = p.status;
        rec.startTime = p.startTime ? new Date(p.startTime) : null;
        if (p.status === 'Failed') {
          const r2 = {
            startTime: rec.startTime,
            status: 'Failed',
            runsUrl: base,
            runLevelError: fmtErr(p.error),
            triggerName: p.trigger && p.trigger.name,
          };
          await loadError(run.name, r2);
          rec.errorText = r2.errorText;
        }
      } else {
        rec.status = 'No runs yet';
      }
    } catch (e) {
      console.debug('[pa-bud] last-run fetch failed:', flowId, e);
      rec.status = null;
    }
    rec.fetching = false;
    scheduleAnnotate();
  }

  function annotateFlowList() {
    if (!state.apiHost || !state.lastToken) return;
    let budget = 40; // cap API fan-out on long flow lists
    for (const aEl of document.querySelectorAll('a[href*="/flows/"]')) {
      const m = (aEl.getAttribute('href') || '').match(FLOW_LINK_RE);
      if (!m) continue;
      const row = aEl.closest('[role="row"]');
      if (!row || row.querySelector('.pa-run-error')) continue;
      if (budget-- <= 0) break;
      const envId = m[1], flowId = m[2];
      let rec = state.flows.get(flowId);
      if (!rec) {
        rec = { fetching: false };
        state.flows.set(flowId, rec);
        fetchLastRun(envId, flowId, rec);
      }
      if (!rec.status) continue;
      const cell = aEl.closest('[role="gridcell"], [role="cell"], td') || aEl.parentElement;
      let tag = cell.querySelector('.pa-flow-lastrun');
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'pa-flow-lastrun';
        attachCopy(tag);
        cell.appendChild(tag);
      }
      const when = rec.startTime ? minuteKey(rec.startTime) : '';
      const txt = rec.status === 'Failed'
        ? `Last run failed (${when}): ${rec.errorText || '…'}`
        : `Last run: ${rec.status}${when ? ` (${when})` : ''}`;
      if (tag.title !== txt) {
        tag.textContent = txt;
        tag.title = txt;
      }
      tag.classList.toggle('pa-flow-failed', rec.status === 'Failed');
    }
  }

  // ---------- scheduling ----------

  function annotate() {
    iterationFinder?.annotate();
    const path = location.pathname;
    // Run views: the flow details page, the "All runs" page (/flows/{id}/runs),
    // and legacy run-history frames whose own URL mentions runs.
    if (FLOW_PATH_RE.test(path) || /\/runs\b|runhistory/i.test(path)) {
      annotateRunHistory();
    } else {
      annotateFlowList();
    }
  }

  let scheduled = false;
  function scheduleAnnotate() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try { annotate(); } catch (e) { console.debug('[pa-bud]', e); }
    }, 300);
  }

  new MutationObserver((muts) => {
    for (const mu of muts) {
      const t = mu.target;
      const el = t && t.nodeType === 1 ? t : (t && t.parentElement);
      if (el && el.closest &&
          el.closest('.pa-run-error, .pa-err-summary, .pa-flow-lastrun, .pa-iteration-dialog, .pa-find-iteration')) continue;
      scheduleAnnotate();
      return;
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  scheduleAnnotate();
})();
