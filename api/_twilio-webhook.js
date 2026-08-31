import twilio from 'twilio';

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function parseTwilioFormBody(rawBody) {
  const form = new URLSearchParams(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || ''));
  const params = {};
  for (const [key, value] of form.entries()) {
    if (!(key in params)) {
      params[key] = value;
      continue;
    }
    params[key] = Array.isArray(params[key]) ? [...params[key], value] : [params[key], value];
  }
  return params;
}

export function validateTwilioRequest({ authToken, signature, callbackUrl, params }) {
  const token = String(authToken || '').trim();
  const header = String(signature || '').trim();
  const url = String(callbackUrl || '').trim();
  if (!token || !header || !url || !params || typeof params !== 'object') return false;
  return twilio.validateRequest(token, header, url, params);
}
