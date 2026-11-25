/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./init-game.mjs', import.meta.url));
const PACKAGE_NAME = 'title-regression';

function withScaffold({ title, description }, inspect) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'init-game-title-'));
  const target = path.join(temporaryDirectory, 'game');

  try {
    const args = [SCRIPT, '--dir', target, '--name', PACKAGE_NAME, '--title', title, '--skip-install'];
    if (description !== undefined) args.push('--description', description);
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const read = (relativePath) => readFileSync(path.join(target, relativePath), 'utf8');
    inspect({ read, summary: JSON.parse(result.stdout) });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

// The expected HTML is explicit so the test exercises the CLI's output rather
// than repeating its escaping implementation.
const titles = [
  { name: 'plain text', title: 'Orbit Runner', html: 'Orbit Runner' },
  { name: 'quotation marks', title: 'Pilot "Ace"', html: 'Pilot &quot;Ace&quot;' },
  { name: 'backslash', title: 'Orbit\\Runner', html: 'Orbit\\Runner' },
  { name: 'newline', title: 'Orbit\nRunner', html: 'Orbit\nRunner' },
  { name: 'ampersand', title: 'Orbit & Stars', html: 'Orbit &amp; Stars' },
  { name: 'entity-shaped text', title: 'Orbit &amp; Stars', html: 'Orbit &amp;amp; Stars' },
  { name: 'HTML-like text', title: '<Orbit>', html: '&lt;Orbit&gt;' },
  {
    name: 'closing title element',
    title: 'Orbit </title><script>alert("x")</script>',
    html: 'Orbit &lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  },
  { name: 'Unicode', title: '星の旅 🚀 — café', html: '星の旅 🚀 — café' },
  { name: 'literal replacement syntax', title: 'Orbit $&', html: 'Orbit $&amp;' },
];

for (const { name, title, html } of titles) {
  test(`scaffolds a title containing ${name}`, () => {
    withScaffold({ title }, ({ read, summary }) => {
      const translations = JSON.parse(read('src/i18n/en.json'));
      assert.equal(translations.title, title, 'JSON must preserve the original title');

      const indexHtml = read('src/index.html');
      assert.ok(
        indexHtml.includes(`<title data-i18n="title">${html}</title>`),
        'HTML must encode the title without changing its text',
      );
      assert.equal(
        (indexHtml.match(/<\/title\s*>/gi) || []).length,
        1,
        'title text must not create an extra closing element',
      );

      assert.ok(read('README.md').startsWith(`# ${title}\n`));
      assert.ok(read('docs/design.md').startsWith(`# ${title} — design\n`));
      assert.ok(read('CLAUDE.md').startsWith(`# ${title} — LLM orientation\n`));

      assert.equal(JSON.parse(read('package.json')).name, PACKAGE_NAME);
      const packageLock = JSON.parse(read('package-lock.json'));
      assert.equal(packageLock.name, PACKAGE_NAME);
      assert.equal(packageLock.packages[''].name, PACKAGE_NAME);

      assert.equal(summary.title, title);
      assert.equal(summary.name, PACKAGE_NAME);
      assert.equal(summary.install, 'skipped');
      assert.deepEqual(summary.gate, {
        typecheck: 'skipped',
        test: 'skipped',
        validate: 'skipped',
      });
    });
  });
}

test('preserves description escaping alongside a title with special characters', () => {
  const title = 'Pilot "Ace" & Stars';
  const description = 'Dodge & duck <asteroids> "now" — earn $&.';
  withScaffold({ title, description }, ({ read, summary }) => {
    assert.ok(
      read('src/index.html').includes(
        '<meta name="description" content="Dodge &amp; duck &lt;asteroids&gt; &quot;now&quot; — earn $&amp;." />',
      ),
    );
    assert.equal(JSON.parse(read('src/i18n/en.json')).title, title);
    assert.equal(summary.description, description);
    assert.equal(summary.title, title);
  });
});
