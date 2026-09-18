# Respaldo automático de Storage en Cloudflare R2

Worker privado para copiar diariamente los buckets aprobados de Supabase Storage
a un bucket R2 independiente. La agenda se evalúa cada seis horas y solo inicia
una copia cuando la última válida tiene al menos 20 horas.

## Garantías

- Solo lee `erp-documents` y `publication-images`.
- Repite el inventario antes y después de la descarga.
- Verifica tamaño y SHA-256 después de persistir cada objeto en R2.
- Escribe `COMPLETE` únicamente después de comprobar objetos y manifiesto.
- Actualiza `state/latest.json` al final; una ejecución parcial nunca sustituye
  la última copia válida.
- Crea una notificación interna para administradores autorizados cuando falla.
  La alerta es crítica si no existe una copia válida de las últimas 24 horas.
- No elimina copias antiguas. La retención debe aprobarse por separado.

## Recursos y secretos

El binding `BACKUPS` apunta al bucket privado `export-mca-private-backups`.
Los valores no sensibles están en `wrangler.jsonc`. Se requieren dos secretos:

- `SUPABASE_SERVICE_ROLE_KEY`: clave existente del backend de producción.
- `STATUS_TOKEN`: valor aleatorio de 32 bytes o más para `/health` y `/run`.

No guardar esos valores en Git, archivos de variables ni registros. Configurar
con `wrangler secret put` y escribirlos solo en el prompt seguro de Wrangler.

## Validación y despliegue

```sh
npm run test:storage-backup-worker
npm run cf:backup:check
npx wrangler r2 bucket create export-mca-private-backups
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/storage-backup/wrangler.jsonc
npx wrangler secret put STATUS_TOKEN --config workers/storage-backup/wrangler.jsonc
npm run cf:backup:deploy
```

Después del despliegue se ejecuta una copia manual autenticada con `POST /run`.
La verificación final exige `201`, un `state/latest.json` nuevo, `COMPLETE`, dos
buckets, el conteo esperado de objetos y hashes idénticos al releer desde R2.
