import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createPanelHandler, parsePanelRoute } from '../src/panel.mjs'

test('legacy and account-scoped panel routes resolve to the intended operation', () => {
  assert.deepEqual(parsePanelRoute('/weixin'), { accountId: null, action: 'page' })
  assert.deepEqual(parsePanelRoute('/weixin/status'), { accountId: null, action: 'status' })
  assert.deepEqual(parsePanelRoute('/weixin/send'), { accountId: null, action: 'send' })
  assert.deepEqual(parsePanelRoute('/weixin/family'), { accountId: 'family', action: 'page' })
  assert.deepEqual(parsePanelRoute('/weixin/family/status'), { accountId: 'family', action: 'status' })
  assert.deepEqual(parsePanelRoute('/weixin/family/send'), { accountId: 'family', action: 'send' })
  assert.equal(parsePanelRoute('/weixin/family/unknown'), null)
})

function request(handler, method, url, body = '') {
  const req = Readable.from(body ? [body] : [])
  req.method = method
  req.url = url
  let status = 200
  let payload = ''
  const res = {
    writeHead(code) { status = code },
    end(chunk = '') { payload += chunk },
  }
  return handler(req, res).then(() => ({ status, payload: JSON.parse(payload) }))
}

function requestText(handler, method, url) {
  const req = Readable.from([])
  req.method = method
  req.url = url
  let status = 200
  let payload = ''
  const res = {
    writeHead(code) { status = code },
    end(chunk = '') { payload += chunk },
  }
  return handler(req, res).then(() => ({ status, payload }))
}

test('panel handler keeps legacy and named account operations isolated', async () => {
  const calls = []
  const channels = {
    primary: {
      accountId: 'primary',
      logs: ['primary log'],
      statusView: () => ({ accountId: 'primary' }),
      push: async (to, text) => { calls.push({ account: 'primary', to, text }); return { sent: 1 } },
    },
    family: {
      accountId: 'family',
      logs: ['family log'],
      statusView: () => ({ accountId: 'family' }),
      push: async (to, text) => { calls.push({ account: 'family', to, text }); return { sent: 1 } },
    },
  }
  const manager = {
    defaultAccountId: 'primary',
    accountIds: () => ['primary', 'family'],
    account(id = '') { return channels[id || this.defaultAccountId] },
  }
  const handler = createPanelHandler(manager)

  const page = await requestText(handler, 'GET', '/weixin')
  assert.equal(page.status, 200)
  assert.match(page.payload, /const BASE = "\/weixin\/primary"/)
  assert.match(page.payload, /href="\/weixin\/family"/)
  assert.deepEqual((await request(handler, 'GET', '/weixin/status')).payload, { accountId: 'primary' })
  assert.deepEqual((await request(handler, 'GET', '/weixin/family/status')).payload, { accountId: 'family' })
  assert.deepEqual(
    (await request(handler, 'POST', '/weixin/family/send', JSON.stringify({ to: 'family-user', text: 'hi' }))).payload,
    { sent: 1 },
  )
  assert.deepEqual(calls, [{ account: 'family', to: 'family-user', text: 'hi' }])
})
