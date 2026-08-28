# B7.4 validation

- Invoice → Expediente is explicit and limited to Expedientes for the Sales Order client.
- `create_invoice_plan` and `replace_invoice_plan` reject cross-client Expedientes.
- `transition_invoice(..., 'issue')` rejects invoices without `operation_id`.
- RPC EXECUTE remains limited to `postgres` and `service_role`.
- Invoice UI injects the selected `operation_id` on create/replace and guards legacy draft issue attempts.
- Generated documents remain immutable in backend and are marked `GENERADO` without a delete action in Expedientes.
- Container bundle reads the existing `documents` scopes without filtering `generated`, so generated Commercial Invoice/Packing List versions participate automatically when applicable.
- Production currently has no invoices and no generated documents; no business records were fabricated to test generation.
- Current loads are not in `loaded|dispatched`, so Packing List generation was not forced against real data.
- Preview SHA `6c8ee1690a75039b22f966099c458bbc3d671d40` built successfully on Vercel.
