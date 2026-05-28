/* ═══════════════════════════════════════════════
   KingsDealer — app.js  v6
   Errores corregidos:
   · resetForm buscaba elementos que pueden no existir
   · editVehicle llamaba a setMoneda que no era accesible aquí
   · openModalFromSlider podía entrar en loop si id no existía
   · initFilters podía registrar doble event si loadVehicles se
     llamaba antes de que el DOM estuviera listo
   Nuevas funciones:
   · showToast disponible globalmente (usada también desde index.html)
═══════════════════════════════════════════════ */

'use strict';

// ── Estado global ────────────────────────────────
let allVehicles  = [];
let activeFilter = '';
let editingId    = null;
let sortPrecio   = '';
let sortAnio     = '';
let filterMarca  = '';
let keepImages   = [];

// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadVehicles();
  loadOfertas();
  initFilters();
  initSortBar();
  initMobileNav();
  initSecretTrigger();
});

// ══════════════════════════════════════════════════
// CARGA Y RENDER
// ══════════════════════════════════════════════════

async function loadVehicles() {
  try {
    const url = activeFilter
      ? `/api/vehiculos?tipo=${encodeURIComponent(activeFilter)}`
      : '/api/vehiculos';
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    allVehicles = await res.json();
    populateMarcaSelect();
    applySort();
    updateStatCount(allVehicles.length);
  } catch {
    const grid = document.getElementById('vehiclesGrid');
    if (grid) grid.innerHTML =
      '<div class="empty-state"><div class="es-icon">⚠️</div><p>No se pudo cargar el catálogo. Verifica tu conexión.</p></div>';
  }
}

// ── Moneda helpers ────────────────────────────────
function fmtMoneda(valor, moneda) {
  return `${moneda === 'USD' ? 'US$' : 'RD$'} ${formatPrice(valor)}`;
}

function badgeMoneda(moneda) {
  const cls = moneda === 'USD' ? 'card-moneda-usd' : 'card-moneda-dop';
  return `<span class="card-moneda-badge ${cls}">${moneda || 'DOP'}</span>`;
}

// ── Render tarjetas ───────────────────────────────
function renderVehicles(list) {
  const grid = document.getElementById('vehiclesGrid');
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🚗</div>
        <p>No hay vehículos en esta categoría.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((v, i) => {
    const moneda = v.moneda || 'DOP';
    const precioHtml = v.oferta && v.precio_oferta
      ? `<span class="price-original">${fmtMoneda(v.precio, moneda)}</span>
         <span class="price-oferta">${fmtMoneda(v.precio_oferta, moneda)}</span>`
      : fmtMoneda(v.precio, moneda);

    const adminBtns = (typeof ROLE !== 'undefined' && ROLE === 'admin')
      ? `<button class="card-btn card-btn-edit"   onclick="editVehicle(${v.id})">✏️</button>
         <button class="card-btn card-btn-delete" onclick="deleteVehicle(${v.id})">🗑</button>`
      : '';

    const esCliente = v.origen === 'cliente';
    return `
    <article class="vehicle-card${v.oferta ? ' card-en-oferta' : ''}${esCliente ? ' card-cliente' : ''}" style="animation-delay:${i * 50}ms">
      ${v.oferta ? '<div class="card-oferta-ribbon">OFERTA</div>' : ''}
      ${esCliente ? '<div class="card-cliente-ribbon">Particular</div>' : ''}
      ${buildCardImage(v)}
      <div class="card-body">
        <div class="card-tipo-row">
          <span class="card-tipo">${esc(v.tipo)}</span>
          ${badgeMoneda(moneda)}
        </div>
        <div class="card-name">${esc(v.marca)} ${esc(v.modelo)}<span class="card-year">${v.anio}</span></div>
        ${esCliente && v.condicion ? `<span class="card-condicion card-condicion-${v.condicion}">${v.condicion === 'nuevo' ? 'Nuevo' : 'Usado'}</span>` : ''}
        <p class="card-desc">${esc(v.descripcion || 'Consulta disponibilidad y condiciones.')}</p>
      </div>
      <div class="card-footer">
        <div class="card-price">${precioHtml}</div>
        <div class="card-actions">
          <button class="card-btn card-btn-detail" onclick="openModal(${v.id})">Ver</button>
          ${!esCliente ? adminBtns : ''}
        </div>
      </div>
    </article>`;
  }).join('');
}

function buildCardImage(v) {
  if (v.imagen)
    return `<img class="card-img" src="/static/uploads/${esc(v.imagen)}"
                 alt="${esc(v.marca)} ${esc(v.modelo)}" loading="lazy" />`;
  return `<div class="card-img-placeholder">
            <span class="ph-icon">🚗</span>
            <span>${esc(v.marca)} ${esc(v.modelo)}</span>
          </div>`;
}

// ══════════════════════════════════════════════════
// FILTROS Y ORDENAMIENTO
// ══════════════════════════════════════════════════

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.tipo || '';
      sortPrecio = ''; sortAnio = ''; filterMarca = '';
      ['sortPrecio', 'sortAnio', 'filterMarca'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.classList.remove('active-filter'); }
      });
      updateClearBtn();
      loadVehicles();
    });
  });
}

function populateMarcaSelect() {
  const sel = document.getElementById('filterMarca');
  if (!sel) return;
  const current = sel.value;
  const marcas  = [...new Set(allVehicles.map(v => v.marca))].sort();
  sel.innerHTML  = '<option value="">Todas</option>' +
    marcas.map(m => `<option value="${esc(m)}"${m === current ? ' selected' : ''}>${esc(m)}</option>`).join('');
}

function initSortBar() {
  updateClearBtn();
}

function applySort() {
  sortPrecio  = document.getElementById('sortPrecio')?.value  || '';
  sortAnio    = document.getElementById('sortAnio')?.value    || '';
  filterMarca = document.getElementById('filterMarca')?.value || '';

  ['sortPrecio', 'sortAnio', 'filterMarca'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active-filter', !!(id === 'sortPrecio' ? sortPrecio : id === 'sortAnio' ? sortAnio : filterMarca));
  });
  updateClearBtn();
  
  let list = [...allVehicles];
  if (filterMarca) list = list.filter(v => v.marca === filterMarca);
  
  if (sortPrecio) {
    const F = 60; // factor DOP≈USD referencial solo para ordenamiento
    list.sort((a, b) => {
      const pa = (a.oferta && a.precio_oferta ? a.precio_oferta : a.precio) * (a.moneda === 'USD' ? F : 1);
      const pb = (b.oferta && b.precio_oferta ? b.precio_oferta : b.precio) * (b.moneda === 'USD' ? F : 1);
      return sortPrecio === 'desc' ? pb - pa : pa - pb;
    });
  } else if (sortAnio) {
    list.sort((a, b) => sortAnio === 'desc' ? b.anio - a.anio : a.anio - b.anio);
  }
  
  renderVehicles(list);
}
// ... (resto del archivo)
