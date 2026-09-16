# Aceptación de Tracking y tareas en dos navegadores

Base PR #314. Resultado definitivo y despliegue en la PR asociada.

Nueva suite tracking-workflow: PostgreSQL 17.6 vacío, PostgREST, handlers y sesiones
reales. Reutiliza las migraciones de la aceptación SQL, registra triggers de live
sync después de crear las tablas operativas y simula únicamente Storage en memoria.
No hay mocks de auth/API/SQL. Bloquea tráfico externo del browser y backend.

- TW-01: operador asignado ve tarea pendiente, no ve controles de gestión y marca
  leída su notificación personal desde el inbox.
- TW-02: al subir ambos documentos desde A, B ve la tarea completada sin recargar.
- TW-03: retirar Packing List reabre la misma tarea en B, sin nueva tarea/asignación.
- TW-04: A reasigna desde la edición real; B pierde la tarea y A recibe su aviso.
- TW-05: A cambia estado a Llegó al puerto desde UI; B ve el aviso correspondiente
  y se comprueba historial persistido. Ese hito no envía WhatsApp.

Screenshots por operador y JSON saneado por job; cero errores JS/5xx y tráfico
externo. No se graban credenciales. Matriz ampliada a ocho suites × dos motores.
WebKit emulado no acredita iPhone real/PWA instalada/push. Estas pruebas no cierran
por sí solas todas las variantes financieras/reportes ni aceptación final diaria.
