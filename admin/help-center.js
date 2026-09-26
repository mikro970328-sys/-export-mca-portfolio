(() => {
  'use strict';
  if (window.ExportMcaHelpCenter) return;
  const root = document.getElementById('helpRoot');
  const content = window.ExportMcaHelpContent;
  if (!root || !Array.isArray(content?.articles)) return;

  const articles = content.articles;
  const byId = new Map(articles.map(article => [article.id, article]));
  const categories = [...new Set(articles.map(article => article.category))];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9\s]/g, ' ').trim();
  const searchFillers = new Set(['como','el','la','los','las','un','una','unos','unas','de','del','en','al','con','para','por','mi','mis','que','quiero','necesito']);
  const index = articles.map(article => ({article, text: normalize([article.title, article.summary, article.category, article.tags, ...article.steps, article.result, article.note].join(' '))}));
  let category = '', activeArticle = null;
  const reportTemplate = 'Módulo y acción:\nReferencia de la operación:\nFecha y hora:\nUsuario afectado (sin contraseña):\nNavegador:\nQué esperaba:\nQué ocurrió y mensaje exacto:\n¿Quedó guardado?:\n¿Afecta a otros usuarios?:\nPasos para reproducirlo:';

  root.innerHTML = `<div class="help-workspace">
    <header class="help-hero"><span class="help-kicker">Guía de trabajo · Export MCA</span><h1>Centro de ayuda</h1><p>Aprende cada paso y encuentra qué hacer cuando algo no sale como esperabas.</p></header>
    <div id="helpIndex">
      <section class="help-search-panel" aria-label="Buscar ayuda"><label for="helpSearch">¿Qué necesitas hacer?</label><div class="help-search-row"><input id="helpSearch" type="search" placeholder="Busca: recibir compra, Direct Ship, no puedo guardar…" autocomplete="off" maxlength="180"><button id="helpClear" type="button">Limpiar</button></div><p id="helpCount" role="status" aria-live="polite"></p></section>
      <div class="help-layout"><aside class="help-categories" aria-label="Temas de ayuda"><h2>Explorar por tema</h2><div id="helpCategories">${['', ...categories].map(label => `<button type="button" data-help-category="${escape(label)}" aria-pressed="${label === ''}">${escape(label || 'Todas las guías')}</button>`).join('')}</div><p>¿Es tu primer día?</p><button type="button" class="help-text-button" data-help-article="empezar">Empieza aquí →</button></aside><section aria-label="Guías disponibles"><div id="helpResults" class="help-results"></div><div id="helpEmpty" class="help-empty" hidden><h2>No encontramos una guía con esa búsqueda</h2><p>Prueba con el módulo, la acción o una palabra del mensaje de error.</p><button type="button" data-help-reset>Ver todas las guías</button><button type="button" data-help-article="reportar">Cómo reportar el problema</button></div></section></div>
    </div>
    <article id="helpArticle" class="help-article" hidden></article>
    <footer class="help-footer">Guía de escritorio · Revisada el 26 de septiembre de 2026. Las acciones disponibles dependen de tus permisos y del estado de cada operación.</footer>
  </div>`;
  const element = id => document.getElementById(id);
  const search = element('helpSearch');

  function renderResults() {
    const terms = normalize(search.value).split(/\s+/).filter(term => term && !searchFillers.has(term));
    const matches = index.filter(item => (!category || item.article.category === category) && terms.every(term => item.text.includes(term)));
    element('helpCount').textContent = `${matches.length} ${matches.length === 1 ? 'guía disponible' : 'guías disponibles'}${category ? ' · ' + category : ''}`;
    element('helpResults').innerHTML = matches.map(({article}) => `<button type="button" class="help-card" data-help-article="${escape(article.id)}"><span class="help-card-category">${escape(article.category)}</span><span class="help-card-title">${escape(article.title)}</span><span class="help-card-summary">${escape(article.summary)}</span><span class="help-card-link">Ver guía <span aria-hidden="true">→</span></span></button>`).join('');
    element('helpEmpty').hidden = matches.length > 0;
    root.querySelectorAll('[data-help-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.helpCategory === category)));
  }

  function canOpenSection(section) {
    return Boolean(section && document.getElementById(section)?.classList.contains('app-section') && window.ExportMcaAccessControl?.sectionAllowed?.(section) === true);
  }

  function showIndex() {
    activeArticle = null;
    element('helpArticle').hidden = true;
    element('helpIndex').hidden = false;
    renderResults();
    search.focus();
  }

  function openArticle(id) {
    const article = byId.get(id);
    if (!article) return false;
    activeArticle = article;
    const allowed = canOpenSection(article.section);
    element('helpIndex').hidden = true;
    const panel = element('helpArticle');
    panel.hidden = false;
    panel.innerHTML = `<div class="help-article-actions"><button type="button" data-help-back>← Volver a las guías</button><button type="button" data-help-print>Imprimir guía</button></div>
      <span class="help-kicker">${escape(article.category)}</span><h2 id="helpArticleTitle" tabindex="-1">${escape(article.title)}</h2><p class="help-lead">${escape(article.summary)}</p>
      <h3>Paso a paso</h3><ol class="help-steps">${article.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
      <section class="help-result"><h3>Cómo comprobar que terminaste</h3><p>${escape(article.result)}</p></section>
      ${article.note ? `<aside class="help-note"><h3>Ten en cuenta</h3><p>${escape(article.note)}</p></aside>` : ''}
      ${article.section ? `<div class="help-module"><button type="button" class="help-primary" data-help-module="${escape(article.section)}" ${allowed ? '' : 'disabled'}>Ir al módulo</button><p id="helpModuleStatus" role="status">${allowed ? 'Abre la sección; no ejecuta ni guarda ninguna operación.' : 'Este módulo no está disponible para tu cuenta. Consulta al administrador.'}</p></div>` : ''}
      ${article.id === 'reportar' ? `<section class="help-report"><h3>Plantilla para pedir ayuda</h3><p>Copia y completa esta plantilla para enviarla al administrador por el canal acordado. No se envía automáticamente.</p><label for="helpReportTemplate">Información del problema</label><textarea id="helpReportTemplate" rows="11" readonly>${escape(reportTemplate)}</textarea><button type="button" data-help-copy>Copiar plantilla</button><p id="helpCopyStatus" role="status" aria-live="polite"></p></section>` : ''}
      ${article.related.length ? `<section class="help-related"><h3>Continúa con estas guías</h3><div>${article.related.map(id => byId.get(id)).filter(Boolean).map(related => `<button type="button" data-help-article="${escape(related.id)}">${escape(related.title)} →</button>`).join('')}</div></section>` : ''}`;
    element('helpArticleTitle').focus();
    element('helpArticleTitle').scrollIntoView?.({block:'start'});
    return true;
  }

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-help-article')) openArticle(button.dataset.helpArticle);
    else if (button.hasAttribute('data-help-category')) { category = button.dataset.helpCategory; renderResults(); }
    else if (button.hasAttribute('data-help-reset') || button.id === 'helpClear') { category = ''; search.value = ''; renderResults(); search.focus(); }
    else if (button.hasAttribute('data-help-back')) showIndex();
    else if (button.hasAttribute('data-help-print')) window.print();
    else if (button.hasAttribute('data-help-module')) {
      const section = button.dataset.helpModule;
      // Recheck when clicked: a role may have changed while the guide was open.
      if (!canOpenSection(section)) {
        button.disabled = true;
        element('helpModuleStatus').textContent = 'Tu acceso a este módulo cambió. Consulta al administrador.';
        return;
      }
      window.showSection?.(section);
    } else if (button.hasAttribute('data-help-copy')) {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(reportTemplate);
        if (activeArticle?.id === 'reportar') element('helpCopyStatus').textContent = 'Plantilla copiada. Complétala antes de enviarla al administrador.';
      } catch {
        if (activeArticle?.id !== 'reportar') return;
        element('helpReportTemplate').focus();
        element('helpReportTemplate').select();
        element('helpCopyStatus').textContent = 'No se pudo copiar automáticamente. La plantilla está seleccionada: cópiala con el menú de tu navegador.';
      }
    }
  });
  search.addEventListener('input', renderResults);
  window.addEventListener('export-mca:section-changed', event => {
    if (event.detail?.id === 'helpSection' && activeArticle) {
      const button = root.querySelector('[data-help-module]');
      if (button) {
        button.disabled = !canOpenSection(button.dataset.helpModule);
        element('helpModuleStatus').textContent = button.disabled ? 'Este módulo no está disponible para tu cuenta. Consulta al administrador.' : 'Abre la sección; no ejecuta ni guarda ninguna operación.';
      }
    }
  });
  renderResults();
  window.ExportMcaHelpCenter = Object.freeze({owner:'help-center.js', openArticle, showIndex});
})();
