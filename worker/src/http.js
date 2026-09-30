// Responses, CORS and the bearer token.

export const DEFAULT_ORIGIN = 'https://spowlf.github.io';

/** An error whose message is written for the user. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const refuse = (message, status = 400) => new HttpError(status, `Nothing changed: ${message}`);

export const json = (data, status = 200) => Response.json(data, { status });

export const text = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Adds CORS headers when the request comes from the app's own origin. */
export function withCors(response, request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) return response;
  const res = new Response(response.body, response);
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.append('Vary', 'Origin');
  return res;
}

/** Compares the bearer token in constant time. No token configured means nobody gets in. */
export function authorised(request, env) {
  const expected = env.API_TOKEN ?? '';
  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* falls through */ }
  throw refuse('send the details as JSON.');
}
