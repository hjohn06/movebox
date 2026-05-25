/**
 * MoveBox AI Proxy — Cloudflare Worker
 *
 * Forwards requests to Anthropic API with your key stored as a
 * Cloudflare secret (never exposed to the browser).
 *
 * SETUP:
 *   1. Deploy this worker (see README)
 *   2. Set secrets:
 *        wrangler secret put ANTHROPIC_API_KEY
 *        wrangler secret put MOVEBOX_SECRET_TOKEN   (generate any random string)
 *   3. Set window.MOVEBOX_AI_TOKEN to the same token value in your app
 *   4. Add your GitHub Pages URL to ALLOWED_ORIGINS below
 */

// ── Config ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://hjohn06.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ── CORS headers ──────────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-MoveBox-Token',
    'Access-Control-Max-Age':       '86400',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Only POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Origin check — block requests not from your app
    if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Secret token check — requires MOVEBOX_SECRET_TOKEN Cloudflare secret to be set
    const expectedToken = env.MOVEBOX_SECRET_TOKEN;
    if (expectedToken) {
      const token = request.headers.get('X-MoveBox-Token') || '';
      if (token !== expectedToken) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders(origin) });
      }
    }

    // API key must be set as a Cloudflare secret
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not configured on this worker.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }

    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }

    // Safety: enforce max_tokens cap so no runaway costs
    if (!body.max_tokens || body.max_tokens > 1024) {
      body.max_tokens = 1024;
    }

    // Forward to Anthropic
    try {
      const upstream = await fetch(ANTHROPIC_URL, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.text();
      return new Response(data, {
        status:  upstream.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Upstream request failed: ' + err.message }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }
  },
};
