const { json, getPublicKey } = require('./_lib/push-lib.js');

export async function onRequest(context) {
  return json(200, { publicKey: getPublicKey(context.env) });
}
