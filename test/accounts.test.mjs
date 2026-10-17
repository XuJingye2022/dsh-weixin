import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  accountStateDir,
  createAccountStore,
  normalizeAccounts,
} from '../src/accounts.mjs'

test('account configuration rejects duplicate IDs', () => {
  assert.throws(
    () => normalizeAccounts({
      stateDir: '/tmp/dsh-weixin',
      accounts: [
        { id: 'primary', cwd: '/tmp/primary' },
        { id: 'primary', cwd: '/tmp/duplicate' },
      ],
    }),
    /重复/,
  )
})

test('account IDs cannot escape their state directory', () => {
  for (const id of ['', '.', '..', '../other', 'a/b', 'a\\b']) {
    assert.throws(
      () => accountStateDir('/tmp/dsh-weixin', id),
      /账号 ID/,
      `应拒绝不安全账号 ID：${JSON.stringify(id)}`,
    )
  }

  const dir = accountStateDir('/tmp/dsh-weixin', 'family-2')
  assert.equal(dir, path.resolve('/tmp/dsh-weixin/accounts/family-2'))
})

test('account IDs reject route names and case-insensitive duplicates', () => {
  for (const id of ['status', 'login', 'send', 'qr.svg', 'CON', 'name.']) {
    assert.throws(
      () => accountStateDir('/tmp/dsh-weixin', id),
      /账号 ID/,
      `应拒绝保留或不安全的账号 ID：${JSON.stringify(id)}`,
    )
  }
  assert.throws(
    () => normalizeAccounts({
      stateDir: '/tmp/dsh-weixin',
      accounts: [{ id: 'Primary' }, { id: 'primary' }],
    }),
    /重复/,
  )
})

test('default account resolves to the configured account spelling', () => {
  const normalized = normalizeAccounts({
    stateDir: '/tmp/dsh-weixin',
    defaultAccount: 'PRIMARY',
    accounts: [{ id: 'primary' }, { id: 'family' }],
  })
  assert.equal(normalized.defaultAccountId, 'primary')
})

test('legacy single-account state migrates once into the default account', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-weixin-accounts-'))
  try {
    fs.writeFileSync(path.join(root, 'credentials.json'), JSON.stringify({ bot_token: 'legacy-token' }))
    fs.writeFileSync(path.join(root, 'session-map.json'), JSON.stringify({ 'user@im.wechat': 'session-legacy' }))
    fs.writeFileSync(path.join(root, 'updates-buf.json'), JSON.stringify({ buf: 'cursor-legacy' }))

    const store = createAccountStore(root, 'default', { migrateLegacy: true })
    assert.equal(store.loadCredentials().bot_token, 'legacy-token')
    assert.deepEqual(store.loadSessionMap(), { 'user@im.wechat': 'session-legacy' })
    assert.equal(store.loadBuf(), 'cursor-legacy')
    if (process.platform !== 'win32') {
      assert.equal(
        fs.statSync(path.join(accountStateDir(root, 'default'), 'credentials.json')).mode & 0o777,
        0o600,
      )
    }

    const second = createAccountStore(root, 'default', { migrateLegacy: true })
    assert.equal(second.loadBuf(), 'cursor-legacy')
    assert.equal(fs.existsSync(path.join(root, 'session-map.json')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('legacy migration never overwrites an existing account file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-weixin-collision-'))
  try {
    const account = accountStateDir(root, 'default')
    fs.mkdirSync(account, { recursive: true })
    fs.writeFileSync(path.join(account, 'session-map.json'), JSON.stringify({ 'new@im.wechat': 'session-new' }))
    fs.writeFileSync(path.join(root, 'session-map.json'), JSON.stringify({ 'old@im.wechat': 'session-old' }))

    const store = createAccountStore(root, 'default', { migrateLegacy: true })
    assert.deepEqual(store.loadSessionMap(), { 'new@im.wechat': 'session-new' })
    assert.equal(fs.existsSync(path.join(root, 'session-map.json')), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
