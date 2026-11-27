// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Puts the game's licence, and the notices of the libraries bundled into it, beside the built
 * game (LICENSE.txt and THIRD-PARTY-NOTICES.txt). The bundler strips licence comments from the
 * code, and the MIT and Apache licences ask that their notices travel with every copy.
 */
function licences(): Plugin {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').trim();
  const version = (name: string) => (JSON.parse(read(`./node_modules/${name}/package.json`)) as { version: string }).version;
  return {
    name: 'eastfar-licences',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8') });
      const meshopt = read('./node_modules/three/examples/jsm/libs/meshopt_decoder.module.js').split('\n').slice(0, 2).join('\n').replace(/^\/\/ /gm, '');
      const rule = '\n\n' + '='.repeat(78) + '\n\n';
      const notices = [
        'Eastfar is free software under the GNU General Public License, version 3 or later (see LICENSE.txt).\nIts source code is at https://github.com/avocadianmage/Eastfar\n\nThe game as served here also contains the following software, each under its own licence.\nThe art and sound have their own terms: see assets/CREDITS.md.',
        `three.js ${version('three')} (https://threejs.org), including its loaders and utilities\n\n${read('./node_modules/three/LICENSE')}`,
        `meshoptimizer decoder, as distributed with three.js\n\n${meshopt}\nThe MIT License text is given above under three.js.`,
        `Rapier ${version('@dimforge/rapier3d-compat')} (https://rapier.rs)\n\n${read('./node_modules/@dimforge/rapier3d-compat/LICENSE')}`,
      ];
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: notices.join(rule) + '\n' });
    },
  };
}

export default defineConfig({
  plugins: [licences()],
  // Relative base so the build works from any sub-path (GitHub Pages project sites).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Build machines can be several times slower than a desk machine; the tests check results, not speed.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
