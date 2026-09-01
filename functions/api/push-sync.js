const { json, processSync } = require('./_lib/push-lib.js');

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return json(204, {});
  if (context.request.method !== 'POST') return json(405, { ok: false, error: '只支持 POST' });
  const body = await context.request.json().catch(() => null);
  return json(200, await processSync(context.env, body));
}
