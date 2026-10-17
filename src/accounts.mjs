import fs from 'node:fs'
import path from 'node:path'
import { createStore, resolveStateDir, resolveWorkspaceDir } from './creds.mjs'

export const DEFAULT_ACCOUNT_ID = 'default'

const ACCOUNT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RESERVED_ACCOUNT_IDS = new Set([
  'status', 'logs', 'qr.svg', 'login', 'verifycode', 'logout', 'send',
])
const WINDOWS_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
])

export function assertAccountId(id) {
  const value = String(id ?? '')
  const deviceBase = value.split('.')[0].toUpperCase()
  if (
    !ACCOUNT_ID_RE.test(value)
    || value.endsWith('.')
    || value === '.'
    || value === '..'
    || RESERVED_ACCOUNT_IDS.has(value.toLowerCase())
    || WINDOWS_DEVICE_NAMES.has(deviceBase)
  ) {
    throw new Error('账号 ID 只能包含字母、数字、点、下划线和连字符，且不能以符号开头')
  }
  return value
}

export function accountStateDir(stateDir, accountId) {
  const root = path.resolve(stateDir, 'accounts')
  const dir = path.resolve(root, assertAccountId(accountId))
  if (path.dirname(dir) !== root) throw new Error('账号 ID 不能指向状态目录之外')
  return dir
}

export function normalizeAccounts(config = {}) {
  const stateDir = resolveStateDir(config.stateDir)
  const configured = Array.isArray(config.accounts) ? config.accounts : []
  const entries = configured.length
    ? configured
    : [{ id: DEFAULT_ACCOUNT_ID, cwd: config.cwd }]

  const seen = new Set()
  const accounts = entries.map((entry, index) => {
    const id = assertAccountId(entry?.id)
    const key = id.toLowerCase()
    if (seen.has(key)) throw new Error(`账号 ID 重复：${id}`)
    seen.add(key)

    const state = accountStateDir(stateDir, id)
    const fallbackCwd = !configured.length && index === 0 ? config.cwd : ''
    return {
      id,
      stateDir: state,
      cwd: resolveWorkspaceDir(entry?.cwd || fallbackCwd, state),
    }
  })

  const requestedDefault = assertAccountId(
    config.defaultAccount || accounts[0].id,
  )
  const defaultAccount = accounts.find(
    (account) => account.id.toLowerCase() === requestedDefault.toLowerCase(),
  )
  if (!defaultAccount) {
    throw new Error(`默认账号不存在：${requestedDefault}`)
  }

  return { stateDir, defaultAccountId: defaultAccount.id, accounts }
}

const LEGACY_FILES = ['credentials.json', 'session-map.json', 'updates-buf.json']

export function createAccountStore(stateDir, accountId, { migrateLegacy = false } = {}) {
  const root = path.resolve(stateDir)
  const dir = accountStateDir(root, accountId)
  if (migrateLegacy) {
    for (const name of LEGACY_FILES) {
      const source = path.join(root, name)
      const destination = path.join(dir, name)
      if (!fs.existsSync(source) || fs.existsSync(destination)) continue
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.renameSync(source, destination)
      if (process.platform !== 'win32') fs.chmodSync(destination, 0o600)
    }
  }
  if (process.platform !== 'win32') {
    if (fs.existsSync(dir)) fs.chmodSync(dir, 0o700)
    for (const name of LEGACY_FILES) {
      const file = path.join(dir, name)
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600)
    }
  }
  return createStore(dir)
}
