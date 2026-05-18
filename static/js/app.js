/* ═══════════════════════════════════════════════
   KingsDealer — app.js
   Gestión de vehículos, filtros, modal, admin, slider ofertas
═══════════════════════════════════════════════ */

'use strict';

// ── Estado ───────────────────────────────────────
let allVehicles = [];
let activeFilter = '';
let editingId = null;

// Estado de ordenamiento / búsqueda
let sortPrecio = '';   // 'asc' | 'desc' | ''
let sortAnio   = '';   // 'asc' | 'desc' | ''
let filterMarca = '';  // nombre de marca | ''

// ── Inicialización ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadVehicles();
  loadOfertas();
  initFilters();
  initSortBar();
  initMobileNav();
  initSecretTrigger();
  animateHeroStats();
});

// ── Carga de vehículos ───────────────────────────
async function loadVehicles() {
  try {
    const url = activeFilter
      ? `/api/vehiculos?tipo=${encodeURIComponent(activeFilter)}`
      : '/api/vehiculos';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar');
    allVehicles = await res.json();
    populateMarcaSelect();
    applySort();                  // renderiza con el orden activo
    updateStatCount(allVehicles.length);
  } catch (err) {
    document.getElementById('vehiclesGrid').innerHTML =
      '<div class="empty-state"><div class="es-icon">⚠️</div><p>No se pudo cargar el catálogo.</p></div>';
  }
}

// ── Render tarjetas ──────────────────────────────
function renderVehicles(list) {
  const grid = document.getElementById('vehiclesGrid');
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="es-icon"></div>
        <p>No hay vehículos en esta categoría.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((v, i) => `
    <article class="vehicle-card${v.oferta ? ' card-en-oferta' : ''}" style="animation-delay:${i * 60}ms">
      ${v.oferta ? '<div class="card-oferta-ribbon"> Oferta</div>' : ''}
      ${buildCardImage(v)}
      <div class="card-body">
        <span class="card-tipo">${esc(v.tipo)}</span>
        <div class="card-name">${esc(v.marca)} ${esc(v.modelo)}<span class="card-year">${v.anio}</span></div>
        <p class="card-desc">${esc(v.descripcion || 'Consulta disponibilidad y condiciones.')}</p>
      </div>
      <div class="card-footer">
        <div class="card-price">
          ${v.oferta && v.precio_oferta
            ? `<span class="price-original">RD$ ${formatPrice(v.precio)}</span>
               <span class="price-oferta">RD$ ${formatPrice(v.precio_oferta)}</span>`
            : `<span>RD$</span>${formatPrice(v.precio)}`
          }
        </div>
        <div class="card-actions">
          <button class="card-btn card-btn-detail" onclick="openModal(${v.id})">Ver</button>
          ${ROLE === 'admin' ? `
            <button class="card-btn card-btn-edit" onclick="editVehicle(${v.id})">✏️</button>
            <button class="card-btn card-btn-delete" onclick="deleteVehicle(${v.id})">🗑</button>
          ` : ''}
        </div>
      </div>
    </article>
  `).join('');
}

function buildCardImage(v) {
  if (v.imagen) {
    return `<img class="card-img" src="/static/uploads/${esc(v.imagen)}" alt="${esc(v.marca)} ${esc(v.modelo)}" loading="lazy" />`;
  }
  return `<div class="card-img-placeholder"><span class="ph-icon"></span><span>${esc(v.marca)} ${esc(v.modelo)}</span></div>`;
}

// ── Filtros tipo (botones) ───────────────────────
function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.tipo;
      loadVehicles();
    });
  });
}

// ══════════════════════════════════════════════════
// ── ORDENAMIENTO / BÚSQUEDA POR MARCA Y AÑO ───────
// ══════════════════════════════════════════════════

/** Rellena el <select> de marcas con las marcas únicas de allVehicles */
function populateMarcaSelect() {
  const sel = document.getElementById('filterMarca');
  if (!sel) return;
  const current = sel.value;
  const marcas  = [...new Set(allVehicles.map(v => v.marca))].sort();
  sel.innerHTML = '<option value="">Todas</option>' +
    marcas.map(m => `<option value="${esc(m)}"${m === current ? ' selected' : ''}>${esc(m)}</option>`).join('');
}

/** Inicializa la sort-bar leyendo los selects por si el browser restaura el valor */
function initSortBar() {
  sortPrecio  = document.getElementById('sortPrecio')?.value  || '';
  sortAnio    = document.getElementById('sortAnio')?.value    || '';
  filterMarca = document.getElementById('filterMarca')?.value || '';
  updateClearBtn();
}

/** Lee los selects, filtra y ordena allVehicles, luego renderiza */
function applySort() {
  sortPrecio  = document.getElementById('sortPrecio')?.value  || '';
  sortAnio    = document.getElementById('sortAnio')?.value    || '';
  filterMarca = document.getElementById('filterMarca')?.value || '';

  // Resaltar visualmente los selects activos
  ['sortPrecio','sortAnio','filterMarca'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active-filter', !!el.value);
  });

  updateClearBtn();

  let list = [...allVehicles];

  // 1. Filtro por marca
  if (filterMarca) {
    list = list.filter(v => v.marca === filterMarca);
  }

  // 2. Ordenamiento (precio tiene prioridad sobre año si ambos están activos)
  if (sortPrecio) {
    list.sort((a, b) => {
      const pa = a.precio_oferta && a.oferta ? a.precio_oferta : a.precio;
      const pb = b.precio_oferta && b.oferta ? b.precio_oferta : b.precio;
      return sortPrecio === 'desc' ? pb - pa : pa - pb;
    });
  } else if (sortAnio) {
    list.sort((a, b) => sortAnio === 'desc' ? b.anio - a.anio : a.anio - b.anio);
  }

  renderVehicles(list);
}

/** Muestra u oculta el botón "Limpiar filtros" */
function updateClearBtn() {
  const btn = document.getElementById('sortClearBtn');
  if (!btn) return;
  const active = sortPrecio || sortAnio || filterMarca;
  btn.style.display = active ? 'flex' : 'none';
}

/** Reinicia todos los selects y vuelve a renderizar */
function clearSort() {
  sortPrecio  = '';
  sortAnio    = '';
  filterMarca = '';
  const sp = document.getElementById('sortPrecio');
  const sa = document.getElementById('sortAnio');
  const fm = document.getElementById('filterMarca');
  if (sp) { sp.value = ''; sp.classList.remove('active-filter'); }
  if (sa) { sa.value = ''; sa.classList.remove('active-filter'); }
  if (fm) { fm.value = ''; fm.classList.remove('active-filter'); }
  updateClearBtn();
  renderVehicles(allVehicles);
}

// ── Modal detalle ────────────────────────────────
function openModal(id) {
  const v = allVehicles.find(x => x.id === id);
  if (!v) return;

  const imgHtml = v.imagen
    ? `<img class="modal-img" src="/static/uploads/${esc(v.imagen)}" alt="${esc(v.marca)} ${esc(v.modelo)}" />`
    : `<div class="modal-img-ph">🚗</div>`;

  const precioHtml = v.oferta && v.precio_oferta
    ? `<p class="modal-price">
         <span class="modal-price-original">RD$ ${formatPrice(v.precio)}</span>
         RD$ ${formatPrice(v.precio_oferta)}
       </p>`
    : `<p class="modal-price">RD$ ${formatPrice(v.precio)}</p>`;

  document.getElementById('modalContent').innerHTML = `
    ${imgHtml}
    <div class="modal-body">
      ${v.oferta ? '<span class="modal-oferta-tag"> En Oferta</span>' : ''}
      <p class="modal-tipo">${esc(v.tipo)}</p>
      <h2 class="modal-title">${esc(v.marca)} ${esc(v.modelo)}</h2>
      <p class="modal-year">Año ${v.anio}</p>
      <p class="modal-desc">${esc(v.descripcion || 'Consulta disponibilidad y financiamiento.')}</p>
      ${precioHtml}
      <div class="modal-cta">
        <a href="https://wa.me/18091234567?text=${encodeURIComponent('Hola, estoy interesado en el ' + v.marca + ' ' + v.modelo + ' ' + v.anio)}"
           class="btn-primary" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a href="tel:+18091234567" class="btn-ghost" style="color:#0A0A0A;border-color:#ccc;">📞 Llamar</a>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ════════════════════════════════════════════════
// ── SLIDER DE OFERTAS ────────────────────────────
// ════════════════════════════════════════════════
let sliderOffers   = [];
let sliderIndex    = 0;
let sliderAutoplay = null;
const SLIDE_INTERVAL = 4500; // ms

async function loadOfertas() {
  try {
    const res = await fetch('/api/ofertas');
    if (!res.ok) return;
    sliderOffers = await res.json();
    if (!sliderOffers.length) return;

    // Mostrar sección
    const section = document.getElementById('ofertas-section');
    if (section) section.style.display = '';

    buildSlider();
    startSliderAutoplay();
  } catch { /* silencioso */ }
}

function buildSlider() {
  const track = document.getElementById('sliderTrack');
  const dots  = document.getElementById('sliderDots');
  if (!track || !dots) return;

  track.innerHTML = sliderOffers.map((v, i) => {
    const imgHtml = v.imagen
      ? `<img class="slide-img" src="/static/uploads/${esc(v.imagen)}" alt="${esc(v.marca)} ${esc(v.modelo)}" loading="lazy" />`
      : `<div class="slide-img-ph">🚗</div>`;

    const precioHtml = v.precio_oferta
      ? `<div class="slide-prices">
           <span class="slide-price-old">RD$ ${formatPrice(v.precio)}</span>
           <span class="slide-price-new">RD$ ${formatPrice(v.precio_oferta)}</span>
         </div>`
      : `<div class="slide-prices">
           <span class="slide-price-new">RD$ ${formatPrice(v.precio)}</span>
         </div>`;

    return `
      <div class="slide-item${i === 0 ? ' active' : ''}" data-index="${i}">
        <div class="slide-img-wrap">
          ${imgHtml}
          <div class="slide-overlay"></div>
        </div>
        <div class="slide-info">
          <span class="slide-badge"> Oferta especial</span>
          <h3 class="slide-name">${esc(v.marca)} ${esc(v.modelo)}</h3>
          <p class="slide-year">${v.anio} · ${esc(v.tipo)}</p>
          ${precioHtml}
          <button class="slide-cta" onclick="openModalFromSlider(${v.id})">Ver detalles</button>
        </div>
      </div>`;
  }).join('');

  dots.innerHTML = sliderOffers.map((_, i) =>
    `<button class="slider-dot${i === 0 ? ' active' : ''}" data-i="${i}" onclick="goToSlide(${i})" aria-label="Slide ${i+1}"></button>`
  ).join('');

  // Controles
  document.getElementById('sliderPrev')?.addEventListener('click', () => {
    goToSlide((sliderIndex - 1 + sliderOffers.length) % sliderOffers.length);
    resetAutoplay();
  });
  document.getElementById('sliderNext')?.addEventListener('click', () => {
    goToSlide((sliderIndex + 1) % sliderOffers.length);
    resetAutoplay();
  });
}

function goToSlide(idx) {
  const items = document.querySelectorAll('.slide-item');
  const dots  = document.querySelectorAll('.slider-dot');
  if (!items.length) return;

  items[sliderIndex]?.classList.remove('active');
  dots[sliderIndex]?.classList.remove('active');
  sliderIndex = idx;
  items[sliderIndex]?.classList.add('active');
  dots[sliderIndex]?.classList.add('active');
}

function startSliderAutoplay() {
  sliderAutoplay = setInterval(() => {
    goToSlide((sliderIndex + 1) % sliderOffers.length);
  }, SLIDE_INTERVAL);
}

function resetAutoplay() {
  clearInterval(sliderAutoplay);
  startSliderAutoplay();
}

// Abre modal desde el slider (allVehicles puede no estar cargado aún, lo busca en sliderOffers)
function openModalFromSlider(id) {
  // Intentar en allVehicles primero, luego en sliderOffers
  let v = allVehicles.find(x => x.id === id) || sliderOffers.find(x => x.id === id);
  if (!v) return;

  // Si allVehicles está cargado, delegar al openModal normal
  if (allVehicles.find(x => x.id === id)) {
    openModal(id);
    return;
  }

  // Fallback: agregar temporalmente a allVehicles
  allVehicles.push(v);
  openModal(id);
}

// ── Admin: toggle precio oferta ──────────────────
function togglePrecioOferta(checkbox) {
  const hiddenInput = document.getElementById('fOfertaHidden');
  const wrap        = document.getElementById('precioOfertaWrap');
  hiddenInput.value = checkbox.checked ? '1' : '0';
  wrap.style.display = checkbox.checked ? 'block' : 'none';
}

// ── Admin: formulario ────────────────────────────
function toggleForm() {
  const wrap = document.getElementById('vehicleFormWrap');
  const btn  = document.getElementById('toggleFormBtn');
  const open = wrap.style.display === 'none' || wrap.style.display === '';
  wrap.style.display = open ? 'block' : 'none';
  btn.textContent = open ? '✕ Cerrar formulario' : '+ Agregar vehículo';
  if (!open) resetForm();
}

function resetForm() {
  editingId = null;
  document.getElementById('editId').value = '';
  document.getElementById('vehicleForm').reset();
  document.getElementById('formTitle').textContent = 'Nuevo vehículo';
  document.getElementById('submitBtn').textContent = 'Guardar vehículo';
  document.getElementById('formError').textContent = '';
  document.getElementById('fOfertaHidden').value = '0';
  const wrap = document.getElementById('vehicleFormWrap');
  const btn  = document.getElementById('toggleFormBtn');
  wrap.style.display = 'none';
  btn.textContent = '+ Agregar vehículo';
  const pw = document.getElementById('precioOfertaWrap');
  if (pw) pw.style.display = 'none';
}

function editVehicle(id) {
  const v = allVehicles.find(x => x.id === id);
  if (!v) return;

  editingId = id;
  document.getElementById('editId').value        = id;
  document.getElementById('fMarca').value         = v.marca;
  document.getElementById('fModelo').value        = v.modelo;
  document.getElementById('fAnio').value          = v.anio;
  document.getElementById('fTipo').value          = v.tipo;
  document.getElementById('fPrecio').value        = v.precio;
  document.getElementById('fDescripcion').value   = v.descripcion || '';
  document.getElementById('fOfertaHidden').value  = v.oferta ? '1' : '0';

  const chk = document.getElementById('fOferta');
  if (chk) {
    chk.checked = !!v.oferta;
    const pw = document.getElementById('precioOfertaWrap');
    if (pw) pw.style.display = v.oferta ? 'block' : 'none';
  }

  const poInput = document.getElementById('fPrecioOferta');
  if (poInput) poInput.value = v.precio_oferta || '';

  document.getElementById('formTitle').textContent  = `Editando: ${v.marca} ${v.modelo}`;
  document.getElementById('submitBtn').textContent  = 'Actualizar vehículo';
  document.getElementById('formError').textContent  = '';

  const wrap = document.getElementById('vehicleFormWrap');
  const btn  = document.getElementById('toggleFormBtn');
  wrap.style.display = 'block';
  btn.textContent = '✕ Cerrar formulario';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitVehicle(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  const btn   = document.getElementById('submitBtn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const formData = new FormData(document.getElementById('vehicleForm'));

  try {
    const isEdit = !!editingId;
    const url    = isEdit ? `/api/vehiculos/${editingId}` : '/api/vehiculos';
    const method = isEdit ? 'PUT' : 'POST';

    const res  = await fetch(url, { method, body: formData });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Error al guardar.';
    } else {
      showToast(isEdit ? '✅ Vehículo actualizado' : '✅ Vehículo agregado', 'success');
      resetForm();
      await Promise.all([loadVehicles(), loadOfertas()]);
    }
  } catch {
    errEl.textContent = 'Error de conexión.';
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Actualizar vehículo' : 'Guardar vehículo';
  }
}

async function deleteVehicle(id) {
  const v = allVehicles.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`¿Eliminar "${v.marca} ${v.modelo}"? Esta acción no se puede deshacer.`)) return;

  try {
    const res = await fetch(`/api/vehiculos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('🗑 Vehículo eliminado', 'success');
      await Promise.all([loadVehicles(), loadOfertas()]);
    } else {
      showToast('Error al eliminar', 'error');
    }
  } catch {
    showToast('Error de conexión', 'error');
  }
}

// ── Mobile nav ────────────────────────────────────
function initMobileNav() {
  const toggle = document.getElementById('menuToggle');
  const nav    = document.getElementById('mobileNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.classList.toggle('open', open);
  });
}

function closeMobile() {
  document.getElementById('mobileNav')?.classList.remove('open');
  document.getElementById('menuToggle')?.classList.remove('open');
}

// ── Trigger secreto: 5 clics en © ─────────────────
function initSecretTrigger() {
  const trigger = document.getElementById('secretTrigger');
  if (!trigger) return;

  let clickCount = 0;
  let timeout;

  trigger.addEventListener('click', () => {
    clickCount++;
    trigger.classList.add('lit');

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      clickCount = 0;
      trigger.classList.remove('lit');
    }, 3000);

    if (clickCount >= 5) {
      clickCount = 0;
      clearTimeout(timeout);
      trigger.classList.remove('lit');
      window.location.href = '/login';
    }
  });
}

// ── Animación contador hero ──────────────────────
function animateHeroStats() {
  const el = document.getElementById('statVehiculos');
  if (!el) return;
}

function updateStatCount(total) {
  const el = document.getElementById('statVehiculos');
  if (!el) return;
  let current = 0;
  const step  = Math.ceil(total / 20);
  const timer = setInterval(() => {
    current = Math.min(current + step, total);
    el.textContent = current;
    if (current >= total) clearInterval(timer);
  }, 40);
}

// ── Utilidades ────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(n) {
  return Number(n).toLocaleString('es-DO');
}

let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `toast show${type ? ' ' + type : ''}`;
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}
