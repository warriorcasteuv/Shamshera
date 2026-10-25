import type { IncomingMessage, ServerResponse } from 'node:http'

export const config = {
  api: {
    bodyParser: false,
  },
}

const MAX_REQUEST_BYTES = 32 * 1024
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

function sendError(response: ServerResponse, status: number, message: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ error: message }))
}

async function readBody(request: IncomingMessage) {
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    request.resume()
    throw new RangeError('Request body exceeds the 32 KB limit.')
  }

  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) {
      tooLarge = true
      chunks.length = 0
    } else if (!tooLarge) {
      chunks.push(buffer)
    }
  }

  if (tooLarge) throw new RangeError('Request body exceeds the 32 KB limit.')
  return Buffer.concat(chunks)
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const configuredOrigin = process.env.API_ORIGIN
  if (!configuredOrigin) {
    sendError(response, 503, 'The API service is not configured.')
    return
  }

  const method = request.method ?? 'GET'
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE')
    sendError(response, 405, 'This API method is not supported.')
    return
  }

  let apiOrigin: URL
  let target: URL
  try {
    apiOrigin = new URL(configuredOrigin)
    if (apiOrigin.pathname !== '/' || apiOrigin.search || apiOrigin.hash) {
      throw new TypeError('API_ORIGIN must contain only the API server origin.')
    }
    if (process.env.NODE_ENV === 'production' && apiOrigin.protocol !== 'https:') {
      throw new TypeError('API_ORIGIN must use HTTPS in production.')
    }

    target = new URL(request.url ?? '/', apiOrigin.origin)
    if (target.origin !== apiOrigin.origin || !target.pathname.startsWith('/api/')) {
      sendError(response, 400, 'Invalid API path.')
      return
    }
  } catch (error) {
    console.error('Invalid API_ORIGIN configuration.', error)
    sendError(response, 500, 'The API service is misconfigured.')
    return
  }

  let body: Buffer | undefined
  if (method !== 'GET') {
    try {
      body = await readBody(request)
    } catch (error) {
      if (error instanceof RangeError) {
        sendError(response, 413, error.message)
        return
      }
      console.error('Could not read the incoming API request.', error)
      sendError(response, 400, 'Could not read the API request.')
      return
    }
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
    })
    response.statusCode = upstream.status
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) response.setHeader(name, value)
    })
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    console.error('Could not reach the configured API service.', error)
    sendError(response, 502, 'The API service could not be reached.')
  }
}
