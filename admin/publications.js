const $ = id => document.getElementById(id);
const token = localStorage.getItem('export_mca_token') || '';

const state = {
  publications: [],
  workers: [],
  imageUrls: [],
  uploading: false,
  writeAccess: false,
  decisionResolve: null,
  decisionTrigger: null
};

const CATEGORY_LABELS = {
  merchandise_plaza: 'Mercancía en plaza',
  containers_plaza: 'Contenedores en plaza',
  upcoming_shipments: 'Próximos envíos',
  usa_warehouse: 'Almacén de Estados Unidos'
};

const CATEGORY_INPUTS = {
  merchandise_plaza: 'plaza_merchandise',
  containers_plaza: 'plaza_containers',
  usa_warehouse: 'us_warehouse'
};

const STATUS_LABELS = {
  draft: 'Borrador',
  published: 'Publicado',
  hidden: 'Oculto',
  archived: 'Archivado'
};

const SAFE_PUBLICATION_ERRORS = new Set([
  'Categoría inválida',
  'La categoría es obligatoria',
  'El título es obligatorio',
  'Disponibilidad inválida',
  'Estado de publicación inválido',
  'Precio inválido',
  'Cantidad inválida',
  'Para Próximos envíos debes indicar al menos la fecha de salida o la fecha de llegada',
  'El trabajador seleccionado no existe',
  'El trabajador seleccionado está desactivado',
  'Falta el identificador',
  'Publicación no encontrada',
  'Formato de imagen no permitido',
  'La imagen supera el límite de 1.5 MB',
  'URL de imagen inválida',
  'Selecciona únicamente imágenes JPEG, PNG o WebP',
  'No se pudo leer una de las fotos',
  'Espera a que terminen de subir las fotos',
  'Para Próximos envíos debes indicar al menos una fecha'
]);

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem('export_mca_token');
    location.replace('/admin/pwa.html');
    const error = new Error('Sesión vencida');
    error.status = 401;
    error.endpoint = String(path).split('?')[0];
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo completar la operación.');
    error.status = response.status;
    error.code = data.details?.code || data.code || null;
    error.endpoint = String(path).split('?')[0];
    throw error;
  }
  return data;
}

function safePublicationMessage(error, fallback = 'No se pudo completar la acción. Intenta nuevamente.', context = 'operation') {
  const message = String(error?.message || '').trim();
  const status = Number(error?.status || 0);
  if (status === 401 || message === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
  if (status === 403) return 'No tienes permiso para completar esta acción.';
  if (SAFE_PUBLICATION_ERRORS.has(message) && (status === 0 || [400, 404, 409, 422].includes(status))) return message;
  console.error('PUBLICATIONS_UI_FAILED', {
    context,
    status: status || null,
    code: error?.code || null,
    endpoint: error?.endpoint || null,
    error
  });
  return fallback;
}

function setFormMessage(message = '', success = false) {
  const node = $('msg');
  node.textContent = message;
  node.className = `msg publications-form-message${message ? ` ${success ? 'ok' : 'bad'}` : ''}`;
}

function setPageMessage(message = '', success = false) {
  const node = $('pageMessage');
  node.textContent = message;
  node.className = `publications-page-message${message ? ` is-visible ${success ? 'is-success' : 'is-error'}` : ''}`;
}

function setPhotoMessage(message, error = false) {
  const node = $('photoStatus');
  node.textContent = message;
  node.className = `upload-progress${error ? ' is-error' : ''}`;
}

function syncDateRequirement() {
  const required = $('category').value === 'upcoming_shipments';
  $('departureLabel').textContent = required ? 'Fecha de salida *' : 'Fecha de salida';
  $('arrivalLabel').textContent = required ? 'Fecha de llegada *' : 'Fecha de llegada';
  $('dateRequiredNote').classList.toggle('show', required);
}

function fillWorkers() {
  const current = $('assigned_worker_id').value;
  $('assigned_worker_id').innerHTML = '<option value="">Número general de Export MCA</option>' + state.workers.map(worker => (
    `<option value="${esc(worker.id)}">${esc(worker.full_name)}${worker.position ? ` · ${esc(worker.position)}` : ''} · ${esc(worker.phone)}</option>`
  )).join('');
  $('assigned_worker_id').value = current;
}

function renderPhotos() {
  $('photoPreview').innerHTML = state.imageUrls.map((url, index) => `
    <article class="photo">
      <img src="${esc(url)}" alt="Foto ${index + 1} de la publicación">
      <button class="photo-remove" type="button" data-remove-photo="${index}"${!state.writeAccess || state.uploading ? ' disabled' : ''}>Quitar</button>
      ${index === 0 ? '<span class="photo-main">Principal</span>' : ''}
    </article>
  `).join('');

  if (state.uploading) setPhotoMessage('Subiendo fotos…');
  else setPhotoMessage(`${state.imageUrls.length} de 2 fotos. La primera será la principal.`);
}

async function removePhoto(index) {
  if (!state.writeAccess || state.uploading) return;
  const url = state.imageUrls[index];
  if (!url) return;
  state.imageUrls.splice(index, 1);
  renderPhotos();
  if (!url.includes('/storage/v1/object/public/publication-images/')) return;
  try {
    await api('/api/publication-images', { method: 'DELETE', body: JSON.stringify({ url }) });
  } catch (error) {
    state.imageUrls.splice(index, 0, url);
    renderPhotos();
    setPhotoMessage(safePublicationMessage(error, 'No se pudo quitar la foto. Intenta nuevamente.', 'remove_photo'), true);
  }
}

function applyWriteAccess() {
  $('readOnlyNote').hidden = state.writeAccess;
  $('newBtn').disabled = !state.writeAccess;
  $('publicationForm').querySelectorAll('input, select, textarea, button').forEach(control => {
    control.disabled = !state.writeAccess || state.uploading;
  });
  renderPhotos();
}

function resetForm({ focus = false, clearPageMessage = false } = {}) {
  $('publicationForm').reset();
  $('id').value = '';
  state.imageUrls = [];
  $('formTitle').textContent = 'Nueva publicación';
  $('editorMode').textContent = 'Borrador nuevo';
  $('editorMode').className = 'pill';
  setFormMessage();
  if (clearPageMessage) setPageMessage();
  syncDateRequirement();
  applyWriteAccess();
  if (focus && state.writeAccess) $('title').focus();
}

function formData() {
  return {
    id: $('id').value || undefined,
    category: $('category').value,
    title: $('title').value.trim(),
    description: $('description').value,
    price: $('price').value,
    currency: $('currency').value,
    quantity: $('quantity').value,
    unit: $('unit').value,
    assigned_worker_id: $('assigned_worker_id').value || null,
    location_public: $('location_public').value,
    location_internal: $('location_internal').value,
    departure_date: $('departure_date').value,
    arrival_date: $('arrival_date').value,
    image_urls: state.imageUrls,
    availability_status: $('availability_status').value,
    publication_status: $('publication_status').value
  };
}

async function compress(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const maximum = 1600;
        const scale = Math.min(1, maximum / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', .82));
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer una de las fotos'));
    };
    image.src = objectUrl;
  });
}

async function uploadPhotos(event) {
  if (!state.writeAccess) return;
  const files = [...(event.target.files || [])];
  event.target.value = '';
  if (!files.length) return;
  if (state.imageUrls.length + files.length > 2) {
    setPhotoMessage('Selecciona un máximo de 2 fotos por publicación.', true);
    return;
  }

  let failureMessage = '';
  try {
    state.uploading = true;
    applyWriteAccess();
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Selecciona únicamente imágenes JPEG, PNG o WebP');
      }
      const dataUrl = await compress(file);
      const result = await api('/api/publication-images', {
        method: 'POST',
        body: JSON.stringify({ data_url: dataUrl, publication_id: $('id').value || 'draft' })
      });
      state.imageUrls.push(result.url);
      renderPhotos();
    }
  } catch (error) {
    failureMessage = safePublicationMessage(error, 'No se pudieron subir las fotos. Intenta nuevamente.', 'upload_photos');
  } finally {
    state.uploading = false;
    applyWriteAccess();
    if (failureMessage) setPhotoMessage(failureMessage, true);
  }
}

function renderMetrics() {
  $('totalMetric').textContent = String(state.publications.length);
  $('publishedMetric').textContent = String(state.publications.filter(row => row.publication_status === 'published').length);
  $('draftMetric').textContent = String(state.publications.filter(row => row.publication_status === 'draft').length);
  $('offlineMetric').textContent = String(state.publications.filter(row => ['hidden', 'archived'].includes(row.publication_status)).length);
}

function publicationTable(rows, hidden = false) {
  if (!rows.length) {
    return `<div class="empty">${hidden ? 'No hay publicaciones ocultas.' : 'No hay publicaciones registradas.'}</div>`;
  }

  return `<div class="table-wrap"><table>
    <thead><tr><th>Publicación</th><th>Categoría</th><th>Fotos</th><th>Responsable</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map(row => {
      const status = String(row.publication_status || 'draft');
      const statusClass = status === 'published' ? 'published' : status === 'hidden' ? 'hidden' : status === 'archived' ? 'off' : '';
      const title = row.title || 'Publicación sin título';
      const editLabel = state.writeAccess ? 'Editar' : 'Ver';
      const statusAction = hidden
        ? `<button type="button" data-action="status" data-status="published" data-id="${esc(row.id)}">Volver a publicar</button>`
        : status === 'published'
          ? `<button class="alt" type="button" data-action="status" data-status="hidden" data-id="${esc(row.id)}">Ocultar</button>`
          : `<button type="button" data-action="status" data-status="published" data-id="${esc(row.id)}">Publicar</button>`;
      const actions = state.writeAccess
        ? `${statusAction}<button class="danger" type="button" data-action="delete" data-id="${esc(row.id)}">Eliminar</button>`
        : '<span class="muted">Solo lectura</span>';
      return `<tr>
        <td class="publications-title-cell"><b>${esc(title)}</b><span class="muted">${esc(row.location_public || 'Sin ubicación pública')}</span></td>
        <td>${esc(CATEGORY_LABELS[row.category] || 'Sin categoría')}</td>
        <td>${Math.min((row.image_urls || []).length, 2)}/2</td>
        <td>${row.assigned_worker ? `<b>${esc(row.assigned_worker.full_name)}</b><br><span class="muted">${esc(row.assigned_worker.phone || '')}</span>` : '<span class="muted">Número general</span>'}</td>
        <td><span class="pill ${statusClass}">${esc(STATUS_LABELS[status] || 'Sin estado')}</span></td>
        <td><div class="actions publications-table-actions"><button class="alt" type="button" data-action="edit" data-id="${esc(row.id)}">${editLabel}</button>${actions}</div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderLists() {
  $('activeList').innerHTML = publicationTable(state.publications.filter(row => row.publication_status !== 'hidden'));
  $('hiddenList').innerHTML = publicationTable(state.publications.filter(row => row.publication_status === 'hidden'), true);
}

function render() {
  renderMetrics();
  renderLists();
  applyWriteAccess();
}

async function load() {
  try {
    const result = await api('/api/publications');
    state.publications = result.publications || [];
    state.workers = result.workers || [];
    state.writeAccess = result.capabilities?.write === true;
    fillWorkers();
    render();
  } catch (error) {
    const message = safePublicationMessage(error, 'No se pudieron cargar las publicaciones. Intenta nuevamente.', 'load');
    state.publications = [];
    $('activeList').innerHTML = `<div class="empty">${esc(message)}</div>`;
    $('hiddenList').innerHTML = '';
    renderMetrics();
    setPageMessage(message, false);
  }
}

function editPublication(id) {
  const publication = state.publications.find(row => String(row.id) === String(id));
  if (!publication) {
    setPageMessage('La publicación ya no está disponible.', false);
    return;
  }

  $('id').value = publication.id;
  $('category').value = CATEGORY_INPUTS[publication.category] || publication.category;
  ['title', 'description', 'price', 'quantity', 'unit', 'location_public', 'location_internal', 'departure_date', 'arrival_date', 'availability_status', 'publication_status'].forEach(key => {
    $(key).value = publication[key] ?? '';
  });
  $('currency').value = publication.currency || 'USD';
  $('assigned_worker_id').value = publication.assigned_worker_id || '';
  state.imageUrls = (publication.image_urls || []).slice(0, 2);
  $('formTitle').textContent = state.writeAccess ? 'Editar publicación' : 'Detalle de la publicación';
  $('editorMode').textContent = STATUS_LABELS[publication.publication_status] || 'Registrada';
  $('editorMode').className = `pill ${publication.publication_status === 'published' ? 'published' : publication.publication_status === 'hidden' ? 'hidden' : ''}`;
  setFormMessage();
  syncDateRequirement();
  applyWriteAccess();
  scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDecision(result) {
  const modal = $('publicationDecision');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  const resolve = state.decisionResolve;
  const trigger = state.decisionTrigger;
  state.decisionResolve = null;
  state.decisionTrigger = null;
  if (trigger?.isConnected) trigger.focus();
  resolve?.(result);
}

function openDeleteDecision(publication, trigger) {
  if (state.decisionResolve) closeDecision(false);
  $('publicationDecisionTitle').textContent = 'Eliminar publicación';
  $('publicationDecisionCopy').textContent = `Se eliminará “${publication.title || 'esta publicación'}” de forma definitiva. Esta acción no se puede deshacer.`;
  $('publicationDecision').classList.remove('hidden');
  $('publicationDecision').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  state.decisionTrigger = trigger || document.activeElement;
  setTimeout(() => $('publicationDecisionCancel').focus(), 0);
  return new Promise(resolve => {
    state.decisionResolve = resolve;
  });
}

async function handleListAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  const publication = state.publications.find(row => String(row.id) === String(id));

  if (action === 'edit') {
    editPublication(id);
    return;
  }
  if (!state.writeAccess || !publication) return;

  try {
    button.disabled = true;
    if (action === 'status') {
      await api('/api/publications', {
        method: 'PATCH',
        body: JSON.stringify({ id, publication_status: button.dataset.status })
      });
      await load();
      setPageMessage(button.dataset.status === 'published' ? 'Publicación visible en el catálogo.' : 'Publicación retirada del catálogo público.', true);
    }
    if (action === 'delete') {
      const approved = await openDeleteDecision(publication, button);
      if (!approved) return;
      await api(`/api/publications?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      resetForm();
      await load();
      setPageMessage('Publicación eliminada.', true);
    }
  } catch (error) {
    setPageMessage(safePublicationMessage(error, 'No se pudo completar la acción. Intenta nuevamente.', `list_${action}`), false);
  } finally {
    button.disabled = false;
  }
}

async function savePublication(event) {
  event.preventDefault();
  if (!state.writeAccess) return;
  const button = $('saveBtn');
  try {
    button.disabled = true;
    setFormMessage('Guardando publicación…', true);
    if (state.uploading) throw new Error('Espera a que terminen de subir las fotos');
    const body = formData();
    if (!body.title) throw new Error('El título es obligatorio');
    if (body.category === 'upcoming_shipments' && !body.departure_date && !body.arrival_date) {
      throw new Error('Para Próximos envíos debes indicar al menos una fecha');
    }
    const editing = Boolean(body.id);
    await api('/api/publications', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    resetForm();
    await load();
    setPageMessage(editing ? 'Publicación actualizada correctamente.' : 'Publicación creada correctamente.', true);
  } catch (error) {
    setFormMessage(safePublicationMessage(error, 'No se pudo guardar la publicación. Revisa los datos e intenta nuevamente.', 'save'), false);
  } finally {
    button.disabled = !state.writeAccess;
  }
}

function bindEvents() {
  $('publicationForm').addEventListener('submit', savePublication);
  $('category').addEventListener('change', syncDateRequirement);
  $('photoInput').addEventListener('change', uploadPhotos);
  $('photoPreview').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-photo]');
    if (button) removePhoto(Number(button.dataset.removePhoto));
  });
  $('activeList').addEventListener('click', handleListAction);
  $('hiddenList').addEventListener('click', handleListAction);
  $('newBtn').addEventListener('click', () => resetForm({ focus: true, clearPageMessage: true }));
  $('cancelBtn').addEventListener('click', () => resetForm({ focus: true }));
  $('publicationDecisionClose').addEventListener('click', () => closeDecision(false));
  $('publicationDecisionCancel').addEventListener('click', () => closeDecision(false));
  $('publicationDecisionConfirm').addEventListener('click', () => closeDecision(true));
  $('publicationDecision').addEventListener('click', event => {
    if (event.target === $('publicationDecision')) closeDecision(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('publicationDecision').classList.contains('hidden')) closeDecision(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  window.addEventListener('focus', load);
}

function init() {
  bindEvents();
  syncDateRequirement();
  applyWriteAccess();
  load();
}

window.PublicationsModule = Object.freeze({
  owner: 'publications.js',
  safePublicationMessage,
  openDeleteDecision,
  closeDecision,
  resetForm,
  load
});

if (!token) location.replace('/admin/pwa.html');
else init();
