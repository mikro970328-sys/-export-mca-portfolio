import crypto from 'node:crypto';
import { fail, ok, readJson, requireAdmin } from './_lib.js';

const BUCKET = 'publication-images';
const MAX_BYTES = 1572864;
const MIME_EXT = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  return { url:url.replace(/\/$/,''), key };
}

function storagePathFromUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  const prefix = `${baseUrl}/storage/v1/object/public/${BUCKET}/`;
  if (!raw.startsWith(prefix)) throw new Error('URL de imagen inválida');
  return decodeURIComponent(raw.slice(prefix.length));
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const { url, key } = config();
    if (req.method === 'POST') {
      const body = await readJson(req);
      const match = String(body.data_url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return fail(res, 400, 'Formato de imagen no permitido');
      const mime = match[1];
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > MAX_BYTES) return fail(res, 400, 'La imagen supera el límite de 1.5 MB');
      const folder = String(body.publication_id || 'draft').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80) || 'draft';
      const path = `${folder}/${Date.now()}-${crypto.randomUUID()}.${MIME_EXT[mime]}`;
      const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
        method:'POST',
        headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':mime, 'x-upsert':'false', 'Cache-Control':'31536000' },
        body:bytes
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`STORAGE_${response.status}:${text}`);
      return ok(res, { url:`${url}/storage/v1/object/public/${BUCKET}/${path}` });
    }
    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const path = storagePathFromUrl(body.url, url);
      const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
        method:'DELETE', headers:{ apikey:key, Authorization:`Bearer ${key}` }
      });
      if (!response.ok && response.status !== 404) throw new Error(`STORAGE_${response.status}:${await response.text()}`);
      return ok(res, { deleted:true });
    }
    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    return fail(res, 400, error.message || 'No se pudo procesar la imagen');
  }
}
