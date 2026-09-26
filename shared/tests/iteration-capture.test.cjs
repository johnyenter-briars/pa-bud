const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/iteration-finder.js'), 'utf8');
const env = '530c1620-7832-42ed-a285-8c333542c7c0';
const flow = '4fe61db2-ca28-162e-7225-1bce37a92eb4';
const run = '08584111478464749444648317818CU29';
const api = `https://us.api.flow.microsoft.com//providers/Microsoft.Flow/environments/${env}/flows/${flow}/runs/${run}/actions/Compose/repetitions/000001?api-version=2016-11-01`;
function setup(pageFlow = flow, resources = []) {
  const pathname = `/environments/${env}/solutions/test-solution/flows/${pageFlow}/runs/${run}`;
  const logs = [];
  const sandbox = { URL, location: { pathname, href: `https://make.powerautomate.com${pathname}` },
    document: { querySelectorAll: () => [] }, console: { info: (...args) => logs.push(args) },
    window: { performance: { getEntriesByType: () => resources.map(name => ({ name })) } } };
  vm.runInNewContext(source, sandbox);
  const finder = sandbox.window.__paCreateIterationFinder({ fetch: () => { throw new Error('Unexpected network request'); }, tokenFor: () => null });
  return { finder, logs, sandbox };
}
test('captures the reported double-slash URL and matching run', () => {
  const { finder } = setup();
  assert.equal(finder.interested(api), true);
  finder.observeRequest(api);
  assert.equal(finder.getDiagnostics().apiRun, `${env}/${flow}/${run}`.toLowerCase());
});
test('accepts an API flow ID alias only for the exact environment and run', () => {
  const { finder } = setup('f9cbaa40-dba8-4d6e-892d-36c2c887dd87');
  finder.observeRequest(api.replace(run, 'another-run'));
  assert.equal(finder.getDiagnostics().apiRun, null);
  finder.observeRequest(api.replace(env, 'another-environment'));
  assert.equal(finder.getDiagnostics().apiRun, null);
  finder.observeRequest(api);
  assert.equal(finder.getDiagnostics().apiRun, `${env}/${flow}/${run}`.toLowerCase());
});
test('recovers an already completed request missed by network hooks', () => {
  const { finder } = setup(flow, [api, api.replace(run, 'another-run')]);
  finder.recoverEndpoint();
  assert.equal(finder.getDiagnostics().apiRun, `${env}/${flow}/${run}`.toLowerCase());
  assert.equal(finder.getDiagnostics().discoverySource, 'resource timing');
});
test('navigation drops the previous run and refuses stale resource timing', () => {
  const { finder, sandbox } = setup(flow, [api]);
  finder.observeRequest(api);
  sandbox.location.pathname = sandbox.location.pathname.replace(run, 'next-run');
  finder.recoverEndpoint();
  assert.equal(finder.getDiagnostics().apiRun, null);
});
test('ignores settings requests and keeps query secrets out of diagnostics', () => {
  const { finder, logs } = setup();
  finder.observeRequest('https://tenant.api.powerplatform.com/powerapps/userSettings/PAutoModernLeftNavToolbox_prod?api-version=1');
  assert.equal(finder.getDiagnostics().apiRun, null);
  finder.observeRequest(api + '&sig=secret-value');
  assert.equal(JSON.stringify([finder.getDiagnostics(), logs]).includes('secret-value'), false);
});
