import { authorizeAdmin, fail, upstreamFailureStatus } from './_lib.js';
import { streamContainerDocumentBundle } from './_document-bundle.js';

// Public validation text is selected only by an exact match against owned literals.
const PUBLIC_ERRORS = new Map([
  ["Contenedor no encontrado", "Contenedor no encontrado"],
  ["Este contenedor todavía no pertenece a un expediente", "Este contenedor todavía no pertenece a un expediente"],
  ["Expediente no encontrado", "Expediente no encontrado"],
  ["El contenedor no pertenece al cliente del expediente", "El contenedor no pertenece al cliente del expediente"],
  ["Este contenedor todavía no tiene documentación para descargar", "Este contenedor todavía no tiene documentación para descargar"],
  ["JSON_INVALID", "Solicitud inválida"],
  ["Contenedor inválido", "Contenedor inválido"]
]);

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
    const friendly = PUBLIC_ERRORS.get(error?.message);
    return fail(res, upstreamFailureStatus(error, friendly ? 400 : 500), friendly || "No se pudo preparar la documentación del contenedor");
  }
}
