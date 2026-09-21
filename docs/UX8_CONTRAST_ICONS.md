# Contraste de cabeceras e iconos

Continuación de UX8 desde `cdcdbaa` (PR #341), a petición de Daniel tras una
captura de Ventas en iPhone con el título blanco sobre una tarjeta blanca.

## Corrección

- La base `.erp-module-page .head.module-hero` tenía más especificidad que los
  estilos de Ventas y Compras. Imponía blanco al fondo sin cambiar sus textos
  claros. Se conserva únicamente `.erp-module-page .module-hero`, permitiendo
  que cada owner posterior aplique conjuntamente su fondo y tipografía.
- El botón móvil de la cabecera recibe el tratamiento claro de los demás
  controles superiores; su icono vuelve a ser azul oscuro sobre blanco.
- Las 31 geometrías SVG aprobadas se integran en `ui-icon-system.js`, con plano
  suave, trazo de 1.7 y paletas para fondos claros/oscuros. Dashboard conserva
  sus tamaños pero comparte la clase y el estilo canónicos. Se completan los
  mapeos Recepciones (WR), Existencias y Logística.
- Se versionan solo los recursos modificados y el loader que los referencia.
  Los contratos estáticos conservan sus reglas y comprueban las revisiones nuevas.

## Evidencia y límites

`header-contrast.spec.mjs` usa el HTML real de las 12 páginas integradas y sus
hojas de estilo en el orden original, retirando los scripts comerciales. Mide
colores calculados, composición alfa y límites conservadores de degradados en
Chromium de escritorio y WebKit móvil. Exige 4.5:1 a textos de cabecera y 3:1 a
iconos, comprueba anchura y adjunta capturas y mediciones. La navegación usa
sus owners reales con el harness sintético existente; no contacta APIs.

Esto verifica presentación y regresiones de navegación. No equivale a probar
Safari en un iPhone físico, una PWA instalada o nuevas operaciones de negocio.
La PR registra los resultados de CI y la vista previa correspondiente al commit.
No se escriben datos comerciales en producción ni Preview.

Los SVG proceden de la propuesta editable aprobada, no de un archivo diseñado
en Figma. No es necesario cambiar la suscripción de Figma para esta integración.
