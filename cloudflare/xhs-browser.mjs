import {extractXhs} from './platforms.mjs';

// Anonymous public-share rendering. No platform login or user cookies are stored.
export async function renderXhs(url, browser) {
  const response = await browser.quickAction('content', {
    url,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    rejectResourceTypes: ['image', 'media', 'font'],
    gotoOptions: {waitUntil: 'domcontentloaded', timeout: 20000}
  });
  if (!response.ok) return null;
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 4 * 1024 * 1024) { await reader.cancel(); return null; }
    chunks.push(part.value);
  }
  const payload = JSON.parse(await new Blob(chunks).text());
  if (!payload.success || typeof payload.result !== 'string') return null;
  const data = extractXhs(payload.result, url);
  return data && (data.url || data.images.length || data.live_photo.length) ? data : null;
}
