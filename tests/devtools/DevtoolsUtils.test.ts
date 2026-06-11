/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import sinon from 'sinon';

import {UniverseManager} from '../../src/devtools/DevtoolsUtils.js';
import {DevTools} from '../../src/third_party/index.js';
import type {Browser} from '../../src/third_party/index.js';
import {serverHooks} from '../server.js';
import {
  getMockBrowser,
  getMockPage,
  html,
  mockListener,
  withBrowser,
} from '../utils.js';

describe('UniverseManager', () => {
  const server = serverHooks();

  afterEach(() => {
    sinon.restore();
  });

  it('does not create universes during initialization', async () => {
    const browser = getMockBrowser();
    const factory = sinon.stub().resolves({});
    const manager = new UniverseManager(browser, factory);
    manager.init();

    sinon.assert.notCalled(factory);
  });

  it('calls the factory only once for concurrent requests', async () => {
    const browser = {
      ...mockListener(),
    } as unknown as Browser;
    const factory = sinon.stub().resolves({});
    const manager = new UniverseManager(browser, factory);
    const page = getMockPage();

    await Promise.all([
      manager.getOrCreate(page),
      manager.getOrCreate(page),
      manager.getOrCreate(page),
    ]);

    sinon.assert.calledOnceWithExactly(factory, page);
  });

  it('works with a real browser', async () => {
    await withBrowser(async (browser, page) => {
      const manager = new UniverseManager(browser);
      manager.init();
      await manager.getOrCreate(page);

      assert.notStrictEqual(manager.get(page), null);
    });
  });

  it('ignores pauses', async () => {
    await withBrowser(async (browser, page) => {
      const manager = new UniverseManager(browser);
      manager.init();
      await manager.getOrCreate(page);
      const targetUniverse = manager.get(page);
      assert.ok(targetUniverse);
      const model = targetUniverse.target.model(DevTools.DebuggerModel);
      assert.ok(model);

      const pausedSpy = sinon.stub();
      model.addEventListener('DebuggerPaused' as any, pausedSpy); // eslint-disable-line

      const result = await page.evaluate('debugger; 1 + 1');
      assert.strictEqual(result, 2);

      sinon.assert.notCalled(pausedSpy);
    });
  });

  it('disables network domain', async () => {
    server.addHtmlRoute('/test', html`<div>Test</div>`);

    await withBrowser(async (browser, page) => {
      const manager = new UniverseManager(browser);
      manager.init();
      await manager.getOrCreate(page);
      const targetUniverse = manager.get(page);
      assert.ok(targetUniverse);

      const networkManager = targetUniverse.target.model(
        DevTools.NetworkManager.NetworkManager,
      );
      assert.ok(networkManager);

      const requestStartedSpy = sinon.stub();
      networkManager.addEventListener(
        DevTools.NetworkManager.Events.RequestStarted,
        requestStartedSpy,
      );

      await page.goto(server.getRoute('/test'));

      sinon.assert.notCalled(requestStartedSpy);
    });
  });
});
