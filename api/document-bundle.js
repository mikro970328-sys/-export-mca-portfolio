import { authorizeAdmin, fail } from './_lib.js';
import { streamContainerDocumentBundle } from './_document-bundle.js';

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'documents.read');
  if (!admin) return;

  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const shipmentId = String(req.query?.shipment_id || '').trim();
    if (!shipmentId) return fail(res, 400, 'Contenedor requerido');
    await streamContainerDocumentBundle(admin, shipmentId, res);
  } catch (error) {
    console.error('[document-bundle]', error);
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error);
      return;
    }
    return fail(res, 400, error.message || 'No se pudo preparar la documentación del contenedor');
  }
}
