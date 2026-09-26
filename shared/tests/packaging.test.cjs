const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const readManifest = (browser) => JSON.parse(fs.readFileSync(path.join(root, browser, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const chrome = readManifest('chrome');
const firefox = readManifest('firefox');

test('both browsers load the identical shared runtime in dependency order', () => {
  assert.equal(chrome.version, firefox.version);
  assert.deepEqual(chrome.content_scripts, firefox.content_scripts);
  assert.deepEqual(chrome.icons, firefox.icons);
  for (const manifest of [chrome, firefox]) {
    assert.equal(manifest.manifest_version, 3);
    const script = manifest.content_scripts[0];
    assert.deepEqual(script.js, ['src/iteration-expression.js', 'src/iteration-finder.js', 'src/main.js']);
    assert.equal(script.world, 'MAIN');
    assert.equal(script.run_at, 'document_start');
    assert.equal(script.all_frames, true);
    for (const asset of [...script.js, ...script.css, ...Object.values(manifest.icons)]) {
      assert.ok(fs.existsSync(path.join(root, 'shared', asset)), asset);
    }
  }
});

test('browser-specific compatibility settings stay in their own manifests', () => {
  assert.equal(chrome.minimum_chrome_version, '111');
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.equal(firefox.browser_specific_settings.gecko.id, 'pa-bud@example.com');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
});
