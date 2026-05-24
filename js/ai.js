/**
 * ai.js — Claude-powered photo content identification
 *
 * SETUP: After deploying your Cloudflare Worker, paste its URL below.
 * It looks like: https://movebox-ai-proxy.YOUR-SUBDOMAIN.workers.dev
 */

const AI = (() => {
  // ── Set this after deploying your Cloudflare Worker ──────────────
  const WORKER_URL = window.MOVEBOX_AI_PROXY || 'https://movebox-ai-proxy.YOUR-SUBDOMAIN.workers.dev';

  function isConfigured() {
    return !WORKER_URL.includes('YOUR-SUBDOMAIN');
  }

  async function callProxy(body) {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI proxy error ${res.status}: ${err}`);
    }
    return res.json();
  }

  async function identifyContents(photos) {
    if (!photos || photos.length === 0) {
      return 'No photos to analyze. Add some photos of the box contents first.';
    }
    if (!isConfigured()) {
      throw new Error('AI proxy not configured. Set WORKER_URL in js/ai.js.');
    }

    const imageContent = photos.slice(0, 4).map(p => {
      const [header, data] = p.data.split(',');
      const mediaType = header.match(/:(.*?);/)[1];
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
    });

    const d = await callProxy({
      model:      'claude-opus-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `You are helping someone catalog moving boxes. Look at ${photos.length > 1 ? 'these photos' : 'this photo'} of box contents and provide a concise inventory.

Return a short list of items you can identify (be specific — "red KitchenAid mixer" not just "appliance"). Group similar items. Note anything fragile or valuable. Keep it under 80 words.

Format: Start directly with the item list, no preamble. Use short lines.`
          }
        ]
      }]
    });

    return d.content?.find(c => c.type === 'text')?.text || 'Could not identify contents.';
  }

  async function suggestBoxName(photos) {
    if (!photos?.length || !isConfigured()) return null;
    const [header, data] = photos[0].data.split(',');
    const mediaType = header.match(/:(.*?);/)[1];
    try {
      const d = await callProxy({
        model:      'claude-opus-4-5',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: 'Look at this photo of box contents. Suggest a short, descriptive box label (3-5 words max). Just output the label, nothing else. Example: "Kitchen appliances & pots"' }
          ]
        }]
      });
      return d.content?.find(c => c.type === 'text')?.text?.trim() || null;
    } catch { return null; }
  }

  return { isConfigured, identifyContents, suggestBoxName };
})();
