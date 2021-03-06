import * as path from 'path'
import { match } from 'node-match-path'
import { pageWith } from 'page-with'

function createRuntime() {
  return pageWith({
    example: path.resolve(__dirname, 'response-patching.mocks.ts'),
    routes(app) {
      app.post('/headers-proxy', (req, res) => {
        const { authorization } = req.headers

        if (!authorization) {
          return res.status(403).json({ message: 'error' }).end()
        }

        return res.status(200).json({ message: 'success' }).end()
      })

      app.head('/posts', (req, res) => {
        res.status(200).header('x-custom', 'HEAD REQUEST PATCHED').end()
      })

      app.post('/posts', (req, res) => {
        res
          .status(200)
          .header('x-custom', 'POST REQUEST PATCHED')
          .json({ id: 101 })
          .end()
      })

      app.get('/posts', (req, res) => {
        res.status(200).json({ id: 101 }).end()
      })
    },
  })
}

test('responds with a combination of the mocked and original responses', async () => {
  const runtime = await createRuntime()

  const res = await runtime.request('https://test.mswjs.io/user')
  const status = res.status()
  const headers = res.headers()
  const body = await res.json()

  expect(status).toBe(200)
  expect(headers).toHaveProperty('x-powered-by', 'msw')
  expect(body).toEqual({
    name: 'The Octocat',
    location: 'San Francisco',
    mocked: true,
  })
})

test('bypasses the original request when it equals the mocked request', async () => {
  const runtime = await createRuntime()

  const res = await runtime.request(
    'https://api.github.com/repos/mswjs/msw?mocked=true',
    null,
    (res, url) => {
      return (
        // Await for the response from MSW, so that original response
        // from the same URL would not interfere.
        match(url, res.url()).matches && res.headers()['x-powered-by'] === 'msw'
      )
    },
  )
  const status = res.status()
  const headers = res.headers()
  const body = await res.json()

  expect(status).toBe(200)
  expect(headers).toHaveProperty('x-powered-by', 'msw')
  expect(body).toEqual({
    name: 'msw',
    stargazers_count: 9999,
  })
})

test('forwards custom request headers to the original request', async () => {
  const runtime = await createRuntime()

  const reqPromise = runtime.request('https://test.mswjs.io/headers', {
    headers: {
      Authorization: 'token',
    },
  })

  const req = await runtime.page.waitForRequest('https://test.mswjs.io/headers')
  const res = await reqPromise

  expect(req.headers()).toHaveProperty('authorization', 'token')
  expect(req.headers()).not.toHaveProperty('map')

  const status = res.status()
  const body = await res.json()

  expect(status).toEqual(200)
  expect(body).toEqual({ message: 'success' })
})

test('supports patching a HEAD request', async () => {
  const runtime = await createRuntime()

  const res = await runtime.request(
    '/posts',
    {
      method: 'HEAD',
    },
    (res, url) => {
      return (
        match(runtime.makeUrl(url), res.url()).matches &&
        res.headers()['x-powered-by'] === 'msw'
      )
    },
  )

  const status = res.status()
  const headers = res.headers()
  const body = await res.json()

  expect(status).toBe(200)
  expect(headers).toHaveProperty('x-powered-by', 'msw')
  expect(headers).toHaveProperty('x-custom', 'HEAD REQUEST PATCHED')
  expect(body).toEqual({ mocked: true })
})

test('supports patching a GET request', async () => {
  const runtime = await createRuntime()

  const res = await runtime.request(
    '/posts',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    (res, url) => {
      return (
        match(runtime.makeUrl(url), res.url()).matches &&
        res.headers()['x-powered-by'] === 'msw'
      )
    },
  )
  const status = res.status()
  const headers = res.headers()
  const body = await res.json()

  expect(status).toBe(200)
  expect(headers).toHaveProperty('x-powered-by', 'msw')
  expect(body).toEqual({ id: 101, mocked: true })
})

test('supports patching a POST request', async () => {
  const runtime = await createRuntime()

  const res = await runtime.request(
    '/posts',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'foo',
        body: 'bar',
        userId: 1,
      }),
    },
    (res, url) => {
      return (
        match(runtime.makeUrl(url), res.url()).matches &&
        res.headers()['x-powered-by'] === 'msw'
      )
    },
  )
  const status = res.status()
  const headers = res.headers()
  const body = await res.json()

  expect(status).toBe(200)
  expect(headers).toHaveProperty('x-powered-by', 'msw')
  expect(headers).toHaveProperty('x-custom', 'POST REQUEST PATCHED')
  expect(body).toEqual({
    id: 101,
    mocked: true,
  })
})
