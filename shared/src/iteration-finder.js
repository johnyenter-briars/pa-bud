// Find JSON items in the recorded input of an Apply to each action.
(() => {
  'use strict';
  window.__paCreateIterationFinder = ({ fetch: request, tokenFor }) => {
    const RUN = /\/environments\/([^/]+)\/(?:solutions\/[^/]+\/)?flows\/([^/]+)\/runs\/([^/?#]+)/i;
    const API = /^(.*\/providers\/Microsoft\.(?:Flow|ProcessSimple)\/environments\/([^/]+)\/flows\/([^/]+)\/runs\/([^/?#]+))(?:\/actions\/([^/?#]+)(?:\/repetitions\/([^/?#]+))?)?/i;
    let context = '', endpoint = null, dialog = null, controller = null;
    const records = new Map();
    const arrays = new Map();
    let lastCandidate = null, capturedRequests = 0, discoverySource = null;
    const log = (event, details = {}) => console.info('[pa-bud:iterations]', event, details);
    // Deliberately excludes auth headers, signed URLs, expressions, and item data.
    const getDiagnostics = () => ({ pageRun: context, apiRun: endpoint?.key || null,
      capturedRequests, discoverySource, lastCandidate });
    window.__paIterationFinderDebug = getDiagnostics;

    function sync() {
      const m = location.pathname.match(RUN);
      const next = m ? m.slice(1).join('/').toLowerCase() : '';
      if (next !== context) {
        context = next; endpoint = null; records.clear(); arrays.clear();
        lastCandidate = null; capturedRequests = 0; discoverySource = null;
        controller?.abort(); dialog?.remove(); dialog = null;
        document.querySelectorAll('.pa-find-iteration').forEach((el) => el.remove());
      }
      return Boolean(context);
    }

    function parse(url) {
      try {
        const u = new URL(url, location.href);
        // Only capture API addresses actually used by the Microsoft portal.
        if (!/(^|\.)(microsoft\.com|powerautomate\.com|powerplatform\.com)$/.test(u.hostname)) return null;
        const m = u.href.match(API);
        if (!m) return null;
        return { base: m[1], key: m.slice(2, 5).join('/').toLowerCase(),
          action: m[5] && decodeURIComponent(m[5]), repetition: m[6],
          query: u.searchParams.has('api-version') ? `?api-version=${encodeURIComponent(u.searchParams.get('api-version'))}` : '' };
      } catch { return null; }
    }

    function matchesRun(route) {
      if (!route || !context) return false;
      const page = context.split('/'), api = route.key.split('/');
      // A solution's displayed flow identifier may differ from its API ID.
      // Environment AND exact run ID must still match; never use another run.
      return page[0] === api[0] && page[2] === api[2];
    }

    function acceptRoute(route, source) {
      const matches = matchesRun(route);
      const candidate = { apiRun: route.key, matchesPageRun: matches };
      if (JSON.stringify(candidate) !== JSON.stringify(lastCandidate)) {
        lastCandidate = candidate;
        log(matches ? 'Run API captured' : 'Ignoring API request for a different run',
          { pageRun: context, ...candidate, source });
      }
      if (matches) { endpoint = route; discoverySource = source; }
    }

    function observeRequest(url) {
      if (!sync()) return;
      const route = parse(url);
      if (route) { capturedRequests++; acceptRoute(route, 'network hook'); }
    }

    function recoverEndpoint() {
      if (!sync() || endpoint) return;
      // The portal may retain an earlier fetch reference or fetch while its
      // SPA route is changing. Resource timing still records those requests.
      const entries = window.performance?.getEntriesByType('resource') || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const route = parse(entries[i].name);
        if (matchesRun(route)) { acceptRoute(route, 'resource timing'); break; }
      }
    }

    function observeResponse(url, json) {
      observeRequest(url);
      const route = parse(url);
      if (!matchesRun(route) || !json) return;
      const p = json.properties || json;
      if (route.action && !/\/scopeRepetitions(?:[/?]|$)/i.test(url)) {
        if (!Array.isArray(json.value)) records.set(route.action, { data: p, repetition: route.repetition });
      }
      if (p.actions) {
        for (const [name, action] of Object.entries(p.actions)) {
          // An expanded run can arrive after a more specific repetition.
          if (!records.has(name)) records.set(name, { data: action.properties || action });
        }
      }
    }

    const interested = (url) => Boolean(parse(url));
    function loopCards() {
      // The exported viewer uses stable React Flow IDs and the foreach icon;
      // generated Fluent CSS class names are intentionally not used.
      return [...document.querySelectorAll('.react-flow__node[data-id]')].filter((card) =>
        card.getAttribute('data-id').endsWith('-#scope') &&
        card.querySelector('img[src*="foreach."]'));
    }
    const loopName = (card) => card.getAttribute('data-id').replace(/-#scope$/, '');
    const pager = (card) => [...card.querySelectorAll('input')].find((input) =>
      input.min === '1' && Number(input.max) >= 1 || /^\d+\s+of\s+\d+$/i.test(input.getAttribute('aria-label') || ''));
    const snapshot = (name) => loopCards().filter((c) => loopName(c) !== name)
      .map((c) => `${loopName(c)}:${pager(c)?.value || ''}`).join('|');

    async function jsonGet(url, signal, auth) {
      const options = { signal };
      if (auth) {
        const token = tokenFor(url);
        if (!token) throw new Error('Waiting for the portal session. Click a loop arrow once, then search again.');
        options.headers = { authorization: token };
      } else {
        options.credentials = 'omit';
        options.referrerPolicy = 'no-referrer';
      }
      const response = await request(url, options);
      if (!response.ok) throw new Error(`Could not read the recorded loop inputs (HTTP ${response.status}). Try opening the loop and searching again.`);
      return response.json();
    }

    async function loadItems(name, signal) {
      recoverEndpoint();
      if (!endpoint) {
        log('No matching run API captured', getDiagnostics());
        throw new Error('No API request for this run was captured. Click the loop’s next arrow and retry. Console diagnostics: [pa-bud:iterations].');
      }
      let record = records.get(name);
      // Nested loops must use a repetition recorded in the current parent context.
      // Never substitute a child Compose output for the actual foreach item.
      if (!record?.data.inputsLink?.uri && !record?.data.inputs) {
        const url = `${endpoint.base}/actions/${encodeURIComponent(name)}${endpoint.query}`;
        const result = await jsonGet(url, signal, true);
        record = { data: result.properties || result };
        records.set(name, record);
      }
      const data = record.data;
      if (record.repetition && data.repetitionIndexes) {
        for (const parent of data.repetitionIndexes) {
          const card = loopCards().find((c) => loopName(c) === parent.scopeName);
          if (card && Number(pager(card)?.value) !== parent.itemIndex + 1) {
            throw new Error('The parent iteration changed. Open this loop in the current parent iteration, then search again.');
          }
        }
      }
      const uri = data.inputsLink?.uri;
      const cacheKey = `${name}/${record.repetition || ''}/${uri || ''}`;
      if (arrays.has(cacheKey)) return arrays.get(cacheKey);
      const inputs = uri ? await jsonGet(uri, signal, false) : data.inputs;
      const items = Array.isArray(inputs) ? inputs : inputs?.foreachItems;
      if (!Array.isArray(items)) throw new Error('The recorded foreach input array is unavailable. Open the loop’s Inputs and try again. Nested loops need their current repetition loaded; secure inputs cannot be searched.');
      arrays.set(cacheKey, items);
      return items;
    }

    function element(tag, className, text) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text != null) el.textContent = text;
      return el;
    }

    async function jump(name, index, originalContext, parentState) {
      sync();
      if (context !== originalContext || snapshot(name) !== parentState) throw new Error('The run or another loop iteration changed. Search again in the current context.');
      const card = loopCards().find((c) => loopName(c) === name);
      const input = card && pager(card);
      if (!input) throw new Error('Expand this Apply to each loop first, then click the match again.');
      const target = index + 1;
      const max = Number(input.max) || Number((input.getAttribute('aria-label') || '').match(/of\s+(\d+)/i)?.[1]);
      if (target > max) throw new Error('The loop iteration count changed. Search again.');
      // Use the native setter so React sees an actual input change. Allow its
      // controlled value to render before committing with Enter and blur.
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(target));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.blur();
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function open(name, sourceButton) {
      recoverEndpoint();
      log('Opening finder', getDiagnostics());
      controller?.abort(); dialog?.remove();
      const runContext = context;
      dialog = element('dialog', 'pa-iteration-dialog');
      dialog.setAttribute('aria-labelledby', 'pa-iteration-title');
      const title = element('h2', '', 'Find iteration'); title.id = 'pa-iteration-title';
      const subtitle = element('p', '', name.replace(/_/g, ' '));
      const close = element('button', 'pa-btn', 'Close'); close.type = 'button';
      const heading = element('div', 'pa-iteration-heading'); heading.append(title, close);
      const label = element('label', '', 'Match condition'); label.htmlFor = 'pa-iteration-expression';
      const expression = element('input'); expression.id = 'pa-iteration-expression';
      expression.type = 'text'; expression.value = "item()['id'] == 3"; expression.spellcheck = false;
      const help = element('p', 'pa-iteration-help', "Examples: item()['id'] == 3 · item().status == 'Failed' · contains(item().name, 'test'). Use && / || to combine conditions. index() is zero-based.");
      const form = element('form');
      const find = element('button', 'pa-btn', 'Find matches'); find.type = 'submit';
      const cancel = element('button', 'pa-btn', 'Cancel search'); cancel.type = 'button'; cancel.hidden = true;
      const actions = element('div', 'pa-iteration-actions'); actions.append(find, cancel);
      const status = element('p', 'pa-iteration-status', 'Search the actual items recorded in this loop’s inputs.');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const results = element('div', 'pa-iteration-results');
      form.append(label, expression, help, actions);
      dialog.append(heading, subtitle, form, status, results);
      const thisDialog = dialog;
      const dismiss = () => { controller?.abort(); thisDialog.close(); thisDialog.remove(); if (dialog === thisDialog) dialog = null; sourceButton.focus(); };
      close.addEventListener('click', dismiss);
      thisDialog.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); });
      cancel.addEventListener('click', () => controller?.abort());
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        controller?.abort(); controller = new AbortController();
        const signal = controller.signal;
        results.replaceChildren();
        try {
          const predicate = window.__paIterationExpression.compile(expression.value);
          log('Search started', getDiagnostics());
          const parentState = snapshot(name);
          find.disabled = true; cancel.hidden = false; status.textContent = 'Reading recorded loop inputs…';
          const items = await loadItems(name, signal);
          log('Loop inputs loaded', { itemCount: items.length });
          const matches = [];
          for (let i = 0; i < items.length; i++) {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (predicate(items[i], i)) matches.push(i);
            if (i % 1000 === 999) {
              status.textContent = `Searched ${i + 1} of ${items.length} items…`;
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (!sync() || context !== runContext || snapshot(name) !== parentState) throw new Error('The run or parent iteration changed. Search again.');
          status.textContent = `${matches.length} matching iteration(s) out of ${items.length}.`;
          log('Search complete', { itemCount: items.length, matchCount: matches.length });
          // Render results in pages so a broad predicate on a large loop stays responsive.
          let shown = 0;
          const more = element('button', 'pa-btn', 'Show more matches'); more.type = 'button';
          const showMore = () => {
            more.remove();
            const end = Math.min(shown + 100, matches.length);
            for (; shown < end; shown++) {
              const index = matches[shown];
              const row = element('div', 'pa-iteration-match');
              const go = element('button', 'pa-btn', `Go to ${index + 1}`); go.type = 'button';
              const preview = element('code', '', JSON.stringify(items[index]).slice(0, 500));
              go.addEventListener('click', async () => {
                try {
                  // A non-modal dialog lets focus reach the portal pager.
                  await jump(name, index, runContext, parentState);
                  log('Jump requested', { iteration: index + 1 });
                  status.textContent = `Requested iteration ${index + 1} · ${matches.length} match(es).`;
                } catch (err) { log('Jump failed', { message: err.message }); status.textContent = err.message; }
              });
              row.append(go, preview); results.append(row);
            }
            if (shown < matches.length) results.append(more);
          };
          more.addEventListener('click', showMore); showMore();
        } catch (err) {
          log('Search stopped', { message: err.message });
          status.textContent = err.name === 'AbortError' ? 'Search cancelled.' : err.message;
        } finally { find.disabled = false; cancel.hidden = true; }
      });
      document.body.append(thisDialog);
      thisDialog.show();
      expression.focus(); expression.select();
    }

    function annotate() {
      if (!sync()) return;
      for (const card of loopCards()) {
        if (card.querySelector('.pa-find-iteration')) continue;
        const name = loopName(card);
        const btn = element('button', 'pa-btn pa-find-iteration nodrag nopan', 'Find iteration'); btn.type = 'button';
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(name, btn); });
        card.append(btn);
      }
    }
    return { interested, observeRequest, observeResponse, annotate, getDiagnostics, recoverEndpoint };
  };
})();
