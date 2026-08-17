import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizeState,
} from '../lib/shared.js'

test('normalizeConfig keeps valid modes and repairs invalid input', () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig({ mode: 'bundled', customPath: '/tmp/dsh/bin.js' }), {
    version: 1,
    mode: 'bundled',
    customPath: '/tmp/dsh/bin.js',
  })
  assert.deepEqual(normalizeConfig({ mode: 'unknown', customPath: 'x' }), {
    version: 1,
    mode: 'auto',
    customPath: 'x',
  })
  assert.deepEqual(normalizeConfig({ mode: 'custom', customPath: 42 }), {
    version: 1,
    mode: 'custom',
    customPath: '',
  })
})

test('normalizeState repairs broken API payloads', () => {
  const state = normalizeState({
    platform: 'darwin',
    isDesktop: true,
    launcherSupported: true,
    runningVersion: '0.1.0-rc.6',
    bundledVersion: '0.1.0-rc.6',
    bundledPath: '/tmp/dsh/lib/bin.js',
    systemInstalls: [{ path: '/tmp/dsh/lib/bin.js', kind: 'npx', version: '0.1.0-rc.6' }],
    config: { version: 1, mode: 'bundled', customPath: '' },
    customPathExists: false,
    message: 'ok',
  })
  assert.equal(state.platform, 'darwin')
  assert.equal(state.isDesktop, true)
  assert.equal(state.launcherSupported, true)
  assert.equal(state.runningVersion, '0.1.0-rc.6')
  assert.equal(state.config.mode, 'bundled')
  assert.equal(state.systemInstalls.length, 1)

  const broken = normalizeState(undefined)
  assert.equal(broken.isDesktop, false)
  assert.equal(broken.launcherSupported, false)
  assert.equal(broken.runningVersion, null)
  assert.equal(broken.config.mode, 'auto')
})
