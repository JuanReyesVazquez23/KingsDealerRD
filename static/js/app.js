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

// ── Show more / Show less ────────────────────────
const CARDS_INITIAL = 5;
let showingAll      = false;
let isParticulares  = false;
let allParticulares = [];

// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadVehicles();
  loadOfertas();
  initFilters();
  initSortBar();
  initMobileNav();
  initSecretTrigger();
  initFotoPreview();
  updateStatCount();
});

// ══════════════════════════════════════════════════
// CARGA Y RENDER
// ══════════════════════════════════════════════════

async function loadVehicles() {
  const grid = document.getElementById('vehiclesGrid');
  try {
    if (isParticulares) {
      const res = await fetch('/api/particulares');
      if (!res.ok) throw new Error();
      allParticulares = await res.json();
      renderVehicles(allParticulares);
      return;
    }
    const url = activeFilter
      ? `/api/vehiculos?tipo=${encodeURIComponent(activeFilter)}`
      : '/api/vehiculos';
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    allVehicles = await res.json();
    populateMarcaSelect();
    applySort();
    updateStatCount();
  } catch {
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
  const grid     = document.getElementById('vehiclesGrid');
  const moreWrap = document.getElementById('showMoreWrap');
  const gridWrap = document.getElementById('gridWrap');
  if (!grid) return;

  if (gridWrap) gridWrap.classList.toggle('grid-wrap--part', isParticulares);

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state${isParticulares ? ' empty-state--dark' : ''}">
        <div class="es-icon">🚗</div>
        <p>${isParticulares ? 'No hay publicaciones de vendedores particulares.' : 'No hay vehículos en esta categoría.'}</p>
      </div>`;
    if (moreWrap) moreWrap.style.display = 'none';
    return;
  }

  const isTodos     = !activeFilter && !isParticulares;
  const needsToggle = (isTodos || isParticulares) && list.length > CARDS_INITIAL;
  if (!needsToggle) showingAll = false;

  const displayList = needsToggle && !showingAll ? list.slice(0, CARDS_INITIAL) : list;

  if (moreWrap) {
    moreWrap.style.display = needsToggle ? 'flex' : 'none';
    const label = document.getElementById('showMoreLabel');
    const arrow = document.getElementById('showMoreArrow');
    const btn   = document.getElementById('showMoreBtn');
    const txt   = isParticulares ? 'publicaciones' : 'vehículos';
    if (label) label.textContent    = showingAll ? `Ver menos ${txt}` : `Ver más ${txt}`;
    if (arrow) arrow.style.transform = showingAll ? 'rotate(180deg)' : 'rotate(0deg)';
    if (btn)   btn.classList.toggle('btn-show-more--part', isParticulares);
  }

  grid.innerHTML = displayList.map((v, i) => {
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
    return `<img class="card-img" src="/img/${esc(v.imagen)}"
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
      const tipo     = btn.dataset.tipo || '';
      isParticulares = tipo === '__particulares__';
      activeFilter   = isParticulares ? '' : tipo;
      showingAll     = false;
      sortPrecio = ''; sortAnio = ''; filterMarca = '';
      ['sortPrecio', 'sortAnio', 'filterMarca'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.classList.remove('active-filter'); }
      });
      updateClearBtn();
      const sb = document.getElementById('sortBar');
      if (sb) sb.style.display = isParticulares ? 'none' : '';
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
  if (isParticulares) { renderVehicles(allParticulares); return; }

  sortPrecio  = document.getElementById('sortPrecio')?.value  || '';
  sortAnio    = document.getElementById('sortAnio')?.value    || '';
  filterMarca = document.getElementById('filterMarca')?.value || '';

  ['sortPrecio', 'sortAnio', 'filterMarca'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active-filter',
      !!(id === 'sortPrecio' ? sortPrecio : id === 'sortAnio' ? sortAnio : filterMarca));
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

function updateClearBtn() {
  const btn = document.getElementById('sortClearBtn');
  if (btn) btn.style.display = (sortPrecio || sortAnio || filterMarca) ? 'flex' : 'none';
}

function clearSort() {
  sortPrecio = ''; sortAnio = ''; filterMarca = '';
  ['sortPrecio', 'sortAnio', 'filterMarca'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('active-filter'); }
  });
  updateClearBtn();
  renderVehicles(allVehicles.filter(v => v.origen !== 'cliente'));
}

// ── Mostrar más / Mostrar menos ───────────────────
function toggleShowMore() {
  showingAll = !showingAll;
  if (isParticulares) { renderVehicles(allParticulares); }
  else { applySort(); }
  if (!showingAll) {
    document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.toggleShowMore = toggleShowMore;

// ══════════════════════════════════════════════════
// MODAL DETALLE — galería de hasta 7 fotos
// ══════════════════════════════════════════════════

function openModal(id) {
  const v = allVehicles.find(x => x.id === id) || allParticulares.find(x => x.id === id);
  if (!v) return;

  const moneda     = v.moneda || 'DOP';
  const extras     = Array.isArray(v.imagenes_extra) ? v.imagenes_extra : [];
  const todasFotos = [];
  if (v.imagen) todasFotos.push(v.imagen);
  extras.forEach(e => { if (e) todasFotos.push(e); });

  let galeriaHtml = '';
  if (!todasFotos.length) {
    galeriaHtml = `<div class="modal-img-ph">🚗</div>`;
  } else if (todasFotos.length === 1) {
    galeriaHtml = `<img class="modal-img"
                        src="/img/${esc(todasFotos[0])}"
                        alt="${esc(v.marca)} ${esc(v.modelo)}" />`;
  } else {
    galeriaHtml = `
      <div class="modal-gallery">
        <div class="mg-main-wrap">
          <img class="mg-main-img" id="mgMain"
               src="/img/${esc(todasFotos[0])}"
               alt="${esc(v.marca)} ${esc(v.modelo)}" />
          <button class="mg-arrow mg-arrow-l" onclick="mgPrev()" aria-label="Anterior">&#8592;</button>
          <button class="mg-arrow mg-arrow-r" onclick="mgNext()" aria-label="Siguiente">&#8594;</button>
          <div class="mg-counter"><span id="mgCurrent">1</span>/${todasFotos.length}</div>
        </div>
        <div class="mg-thumbs" id="mgThumbs">
          ${todasFotos.map((f, i) => `
            <button class="mg-thumb${i === 0 ? ' active' : ''}" onclick="mgGoTo(${i})" aria-label="Foto ${i+1}">
              <img src="/img/${esc(f)}" alt="Foto ${i+1}" loading="lazy" />
            </button>`).join('')}
        </div>
      </div>`;
  }

  const precioHtml = (v.oferta && v.precio_oferta)
    ? `<p class="modal-price">
         <span class="modal-price-original">${fmtMoneda(v.precio, moneda)}</span>
         ${fmtMoneda(v.precio_oferta, moneda)}
       </p>`
    : `<p class="modal-price">${fmtMoneda(v.precio, moneda)}</p>`;

  document.getElementById('modalContent').innerHTML = `
    ${galeriaHtml}
    <div class="modal-body">
      ${v.oferta ? '<span class="modal-oferta-tag">OFERTA</span>' : ''}
      <div class="modal-tipo-row">
        <p class="modal-tipo">${esc(v.tipo)}</p>
        <span class="modal-moneda-badge modal-moneda-${moneda.toLowerCase()}">${moneda}</span>
      </div>
      <h2 class="modal-title">${esc(v.marca)} ${esc(v.modelo)}</h2>
      <p class="modal-year">Año ${v.anio}</p>
      <p class="modal-desc">${esc(v.descripcion || 'Consulta disponibilidad y financiamiento.')}</p>
      ${precioHtml}
      ${v.origen === 'cliente' && v.nombre_vendedor ? `
        <div class="modal-vendedor">
          <p class="modal-vendedor-label">Vendedor particular</p>
          <p class="modal-vendedor-nombre">${esc(v.nombre_vendedor)}</p>
        </div>
        <div class="modal-cta">
          ${v.whatsapp_vendedor
            ? `<a href="https://wa.me/${v.whatsapp_vendedor.replace(/[^0-9]/g,'')}?text=${encodeURIComponent('Hola ' + v.nombre_vendedor + ', vi tu ' + v.marca + ' ' + v.modelo + ' ' + v.anio + ' en KingsDealer')}" class="btn-primary" target="_blank" rel="noopener">WhatsApp vendedor</a>`
            : ''}
          <a href="tel:${v.telefono_vendedor}" class="btn-ghost" style="color:#333;border-color:#ccc;">Llamar: ${esc(v.telefono_vendedor)}</a>
        </div>` : `
        <div class="modal-cta">
          <a href="https://wa.me/18091234567?text=${encodeURIComponent('Hola, me interesa el ' + v.marca + ' ' + v.modelo + ' ' + v.anio)}"
             class="btn-primary" target="_blank" rel="noopener">WhatsApp</a>
          <a href="tel:+18091234567" class="btn-ghost" style="color:#333;border-color:#ccc;">Llamar</a>
        </div>`}
    </div>`;

  window._mgFotos  = todasFotos.length > 1 ? todasFotos : null;
  window._mgActual = 0;

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function mgGoTo(idx) {
  const fotos = window._mgFotos;
  if (!fotos?.length) return;
  window._mgActual = idx;
  const main   = document.getElementById('mgMain');
  const curr   = document.getElementById('mgCurrent');
  const thumbs = document.querySelectorAll('.mg-thumb');
  if (main)  main.src = `/img/${esc(fotos[idx])}`;
  if (curr)  curr.textContent = idx + 1;
  thumbs.forEach((t, i) => t.classList.toggle('active', i === idx));
}
function mgPrev() {
  const f = window._mgFotos;
  if (f) mgGoTo((window._mgActual - 1 + f.length) % f.length);
}
function mgNext() {
  const f = window._mgFotos;
  if (f) mgGoTo((window._mgActual + 1) % f.length);
}

function closeModal() {
  document.getElementById('modalOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
  window._mgFotos  = null;
  window._mgActual = 0;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape')      closeModal();
  if (e.key === 'ArrowLeft'  && window._mgFotos) mgPrev();
  if (e.key === 'ArrowRight' && window._mgFotos) mgNext();
});

// ══════════════════════════════════════════════════
// SLIDER DE OFERTAS
// ══════════════════════════════════════════════════

let sliderOffers   = [];
let sliderIndex    = 0;
let sliderAutoplay = null;
const SLIDE_MS     = 4500;

async function loadOfertas() {
  try {
    const res = await fetch('/api/ofertas');
    if (!res.ok) return;
    sliderOffers = await res.json();
    if (!sliderOffers.length) return;
    const section = document.getElementById('ofertas-section');
    if (section) section.style.display = '';
    buildSlider();
    startAutoplay();
  } catch { /* silencioso */ }
}

function buildSlider() {
  const track = document.getElementById('sliderTrack');
  const dots  = document.getElementById('sliderDots');
  if (!track || !dots) return;

  track.innerHTML = sliderOffers.map((v, i) => {
    const moneda = v.moneda || 'DOP';
    const img    = v.imagen
      ? `<img class="slide-img" src="/img/${esc(v.imagen)}"
              alt="${esc(v.marca)} ${esc(v.modelo)}" loading="lazy" />`
      : `<div class="slide-img-ph">🚗</div>`;
    const precio = v.precio_oferta
      ? `<div class="slide-prices">
           <span class="slide-price-old">${fmtMoneda(v.precio, moneda)}</span>
           <span class="slide-price-new">${fmtMoneda(v.precio_oferta, moneda)}</span>
         </div>`
      : `<div class="slide-prices">
           <span class="slide-price-new">${fmtMoneda(v.precio, moneda)}</span>
         </div>`;
    return `
      <div class="slide-item${i === 0 ? ' active' : ''}" data-index="${i}">
        <div class="slide-img-wrap">${img}<div class="slide-overlay"></div></div>
        <div class="slide-info">
          <span class="slide-badge">OFERTA ESPECIAL</span>
          <h3 class="slide-name">${esc(v.marca)} ${esc(v.modelo)}</h3>
          <p class="slide-year">${v.anio} · ${esc(v.tipo)}</p>
          ${precio}
          <button class="slide-cta" onclick="openModalFromSlider(${v.id})">Ver detalles</button>
        </div>
      </div>`;
  }).join('');

  dots.innerHTML = sliderOffers.map((_, i) =>
    `<button class="slider-dot${i === 0 ? ' active' : ''}" onclick="goToSlide(${i})" aria-label="Slide ${i+1}"></button>`
  ).join('');

  // Registra listeners solo una vez — clona para evitar duplicados
  const prev = document.getElementById('sliderPrev');
  const next = document.getElementById('sliderNext');
  if (prev) { const np = prev.cloneNode(true); prev.replaceWith(np); np.addEventListener('click', () => { goToSlide((sliderIndex - 1 + sliderOffers.length) % sliderOffers.length); resetAutoplay(); }); }
  if (next) { const nn = next.cloneNode(true); next.replaceWith(nn); nn.addEventListener('click', () => { goToSlide((sliderIndex + 1) % sliderOffers.length); resetAutoplay(); }); }
}

function goToSlide(idx) {
  document.querySelectorAll('.slide-item')[sliderIndex]?.classList.remove('active');
  document.querySelectorAll('.slider-dot')[sliderIndex]?.classList.remove('active');
  sliderIndex = idx;
  document.querySelectorAll('.slide-item')[sliderIndex]?.classList.add('active');
  document.querySelectorAll('.slider-dot')[sliderIndex]?.classList.add('active');
}

function startAutoplay()  { sliderAutoplay = setInterval(() => goToSlide((sliderIndex + 1) % sliderOffers.length), SLIDE_MS); }
function resetAutoplay()  { clearInterval(sliderAutoplay); startAutoplay(); }

function openModalFromSlider(id) {
  // Asegura que el vehículo esté en allVehicles antes de abrir el modal
  if (!allVehicles.find(x => x.id === id)) {
    const v = sliderOffers.find(x => x.id === id);
    if (v) allVehicles = [...allVehicles, v];
  }
  openModal(id);
}

// ══════════════════════════════════════════════════
// ADMIN — FORMULARIO VEHÍCULO
// ══════════════════════════════════════════════════

function togglePrecioOferta(checkbox) {
  const hidden = document.getElementById('fOfertaHidden');
  const wrap   = document.getElementById('precioOfertaWrap');
  if (hidden) hidden.value = checkbox.checked ? '1' : '0';
  if (wrap)   wrap.style.display = checkbox.checked ? 'block' : 'none';
}

function toggleForm() {
  const wrap = document.getElementById('vehicleFormWrap');
  const btn  = document.getElementById('toggleFormBtn');
  if (!wrap) return;
  const open = wrap.style.display === 'none' || wrap.style.display === '';
  wrap.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? '✕ Cerrar formulario' : '+ Agregar vehículo';
  if (!open) resetForm();
}

function resetForm() {
  editingId    = null;
  keepImages   = [];
  pendingFiles = [];

  // Limpiar preview foto principal
  const fImagen = document.getElementById('fImagen');
  if (fImagen) {
    fImagen.value = '';
    const prevCrop = fImagen.parentNode?.querySelector('.crop-previews');
    if (prevCrop) prevCrop.innerHTML = '';
  }
  // Limpiar fotos adicionales
  const fExtra = document.getElementById('fImagenesExtra');
  if (fExtra) fExtra.value = '';
  const pprev = document.getElementById('fotoPendingPreview'); if (pprev) pprev.innerHTML = '';
  const fcnt  = document.getElementById('fotosCount');         if (fcnt)  fcnt.textContent = '';

  const form = document.getElementById('vehicleForm');
  if (form) form.reset();

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('editId', '');
  set('fOfertaHidden', '0');
  set('fMoneda', 'DOP');
  txt('formTitle', 'Nuevo vehículo');
  txt('submitBtn', 'Guardar vehículo');
  txt('formError', '');

  const wrap = document.getElementById('vehicleFormWrap');
  if (wrap) wrap.style.display = 'none';
  const toggleBtn = document.getElementById('toggleFormBtn');
  if (toggleBtn) toggleBtn.textContent = '+ Agregar vehículo';
  const pw = document.getElementById('precioOfertaWrap');
  if (pw) pw.style.display = 'none';

  renderImagenesExistentes([]);

  // Sincronizar botones moneda (pueden existir o no según el rol)
  syncMonedaBtns('DOP');
}

function editVehicle(id) {
  const v = allVehicles.find(x => x.id === id);
  if (!v) return;

  editingId  = id;
  keepImages = Array.isArray(v.imagenes_extra) ? [...v.imagenes_extra] : [];

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('editId',          id);
  set('fMarca',          v.marca);
  set('fModelo',         v.modelo);
  set('fAnio',           v.anio);
  set('fTipo',           v.tipo);
  set('fPrecio',         v.precio);
  set('fDescripcion',    v.descripcion || '');
  set('fOfertaHidden',   v.oferta ? '1' : '0');
  set('fMoneda',         v.moneda || 'DOP');
  set('fPrecioOferta',   v.precio_oferta || '');

  const chk = document.getElementById('fOferta');
  if (chk) {
    chk.checked = !!v.oferta;
    const pw = document.getElementById('precioOfertaWrap');
    if (pw) pw.style.display = v.oferta ? 'block' : 'none';
  }

  txt('formTitle', `Editando: ${v.marca} ${v.modelo}`);
  txt('submitBtn', 'Actualizar vehículo');
  txt('formError', '');

  syncMonedaBtns(v.moneda || 'DOP');
  renderImagenesExistentes(keepImages);

  const wrap = document.getElementById('vehicleFormWrap');
  if (wrap) { wrap.style.display = 'block'; wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  const toggleBtn = document.getElementById('toggleFormBtn');
  if (toggleBtn) toggleBtn.textContent = '✕ Cerrar formulario';
}

// Sincroniza los botones DOP/USD del formulario admin
// Función reutilizable desde aquí y desde el <script> inline del HTML
function syncMonedaBtns(value) {
  const btnDOP = document.getElementById('btnDOP');
  const btnUSD = document.getElementById('btnUSD');
  if (btnDOP) btnDOP.classList.toggle('active', value === 'DOP');
  if (btnUSD) btnUSD.classList.toggle('active', value === 'USD');
}

// Expuesta globalmente para el onclick inline del HTML
window.setMoneda = function(value) {
  const el = document.getElementById('fMoneda');
  if (el) el.value = value;
  syncMonedaBtns(value);
};

function renderImagenesExistentes(lista) {
  const cont = document.getElementById('imagenesExistentes');
  if (!cont) return;
  if (!lista.length) { cont.innerHTML = ''; cont.style.display = 'none'; return; }
  cont.style.display = 'grid';
  cont.className = 'imagenes-existentes foto-preview-grid';
  cont.innerHTML = lista.map((nombre, i) => `
    <div class="foto-preview-item" id="ithumb-${i}">
      <img src="/img/${esc(nombre)}" alt="Foto ${i+1}" loading="lazy" />
      <button type="button" class="foto-preview-del" onclick="eliminarFotoExistente(${i})" aria-label="Eliminar foto ${i+1}">✕</button>
    </div>`).join('');
}

function eliminarFotoExistente(idx) {
  keepImages.splice(idx, 1);
  renderImagenesExistentes(keepImages);
}

async function submitVehicle(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  const btn   = document.getElementById('submitBtn');
  if (errEl) errEl.textContent = '';
  if (btn)   { btn.disabled = true; btn.textContent = 'Guardando…'; }

  const formData = new FormData(document.getElementById('vehicleForm'));
  formData.set('imagenes_extra_keep', JSON.stringify(keepImages));

  try {
    const isEdit = !!editingId;
    const res    = await fetch(
      isEdit ? `/api/vehiculos/${editingId}` : '/api/vehiculos',
      { method: isEdit ? 'PUT' : 'POST', body: formData }
    );
    const data = await res.json();
    if (!res.ok) {
      if (errEl) errEl.textContent = data.error || 'Error al guardar.';
    } else {
      showToast(isEdit ? '✅ Vehículo actualizado' : '✅ Vehículo agregado', 'success');
      resetForm();
      await Promise.all([loadVehicles(), loadOfertas()]);
    }
  } catch {
    if (errEl) errEl.textContent = 'Error de conexión.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = editingId ? 'Actualizar vehículo' : 'Guardar vehículo'; }
  }
}

async function deleteVehicle(id) {
  const v = allVehicles.find(x => x.id === id);
  if (!v || !confirm(`¿Eliminar "${v.marca} ${v.modelo}"? Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch(`/api/vehiculos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('🗑 Vehículo eliminado', 'success');
      await Promise.all([loadVehicles(), loadOfertas()]);
    } else {
      showToast('Error al eliminar', 'error');
    }
  } catch { showToast('Error de conexión', 'error'); }
}

// ══════════════════════════════════════════════════
// MOBILE NAV
// ══════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════
// TRIGGER SECRETO (5 clics en © → /login)
// ══════════════════════════════════════════════════

function initSecretTrigger() {
  const trigger = document.getElementById('secretTrigger');
  if (!trigger) return;
  let clicks = 0, timeout;
  trigger.addEventListener('click', () => {
    clicks++;
    trigger.classList.add('lit');
    clearTimeout(timeout);
    timeout = setTimeout(() => { clicks = 0; trigger.classList.remove('lit'); }, 3000);
    if (clicks >= 5) {
      clicks = 0; clearTimeout(timeout);
      trigger.classList.remove('lit');
      window.location.href = '/login';
    }
  });
}

// ══════════════════════════════════════════════════
// CONTADOR HERO
// ══════════════════════════════════════════════════

function animateCount(el, target) {
  if (!el || !target) return;
  let current = 0;
  const step  = Math.max(1, Math.ceil(target / 20));
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current;
    if (current >= target) clearInterval(timer);
  }, 40);
}

async function updateStatCount() {
  try {
    const res  = await fetch('/api/count');
    if (!res.ok) return;
    const data = await res.json();
    animateCount(document.getElementById('statVehiculos'),    data.dealer      || 0);
    animateCount(document.getElementById('statParticulares'), data.particulares || 0);
  } catch {}
}

// ══════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatPrice(n) {
  return Number(n).toLocaleString('es-DO');
}

let _toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className   = `toast show${type ? ' ' + type : ''}`;
  _toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}
// Exponer globalmente para uso desde scripts inline
window.showToast = showToast;

// ══════════════════════════════════════════════════
// PREVIEW DE FOTOS NUEVAS — sin límite fijo
// Aplica al panel admin Y al formulario de vendedor
// (ambos usan el id "fImagenesExtra")
// ══════════════════════════════════════════════════

// Almacena los File objects seleccionados por el usuario (nuevas fotos)
let pendingFiles = [];

function initFotoPreview() {
  // Aplica para el input del admin panel y del formulario de vendedor (mismo id)
  const input = document.getElementById('fImagenesExtra');
  if (!input) return;

  // Asegurarse de que el input tenga el atributo multiple
  input.setAttribute('multiple', '');

  input.addEventListener('change', () => {
    const newFiles = Array.from(input.files);
    // Acumular — no reemplazar — para permitir selecciones múltiples en iOS/Safari
    newFiles.forEach(f => { if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) pendingFiles.push(f); });
    renderPendingPreviews();
    // Limpiar input para permitir re-selección del mismo archivo
    input.value = '';
  });
}
window.initFotoPreview = initFotoPreview;

function renderPendingPreviews() {
  let previewCont = document.getElementById('fotoPendingPreview');
  if (!previewCont) {
    const input = document.getElementById('fImagenesExtra');
    if (!input) return;
    previewCont = document.createElement('div');
    previewCont.id = 'fotoPendingPreview';
    previewCont.className = 'foto-preview-grid';
    previewCont.style.marginTop = '10px';
    input.parentNode.insertBefore(previewCont, input.nextSibling);
  }

  let countEl = document.getElementById('fotosCount');
  if (!countEl) {
    countEl = document.createElement('p');
    countEl.id = 'fotosCount';
    countEl.className = 'fotos-count';
    const previewCont2 = document.getElementById('fotoPendingPreview');
    if (previewCont2) previewCont2.parentNode.insertBefore(countEl, previewCont2.nextSibling);
  }

  previewCont.innerHTML = pendingFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="foto-preview-item">
      <img src="${url}" alt="Nueva foto ${i+1}" />
      <button type="button" class="foto-preview-del" onclick="removePendingFile(${i})" aria-label="Quitar foto">✕</button>
    </div>`;
  }).join('');

  const total = keepImages.length + pendingFiles.length;
  countEl.textContent = total > 0 ? `${total} foto${total !== 1 ? 's' : ''} en total` : '';
  countEl.className   = 'fotos-count';

  // Sincronizar un DataTransfer con el input para que FormData envíe todos los archivos
  syncFilesToInput();
}

function removePendingFile(idx) {
  pendingFiles.splice(idx, 1);
  renderPendingPreviews();
}
window.removePendingFile = removePendingFile;

function syncFilesToInput() {
  // Rebuild the file input's FileList from pendingFiles using DataTransfer
  try {
    const dt = new DataTransfer();
    pendingFiles.forEach(f => dt.items.add(f));
    const input = document.getElementById('fImagenesExtra');
    if (input) input.files = dt.files;
  } catch (e) {
    // DataTransfer not supported on older browsers — files sent normally
  }
}

// ══════════════════════════════════════════════════
// FORMULARIO DE VENDEDOR PARTICULAR (/vender)
// Submit con soporte de múltiples fotos
// ══════════════════════════════════════════════════

function initVendedorForm() {
  const form = document.getElementById('anuncioForm');
  if (!form) return;

  // Inicializar preview de fotos también en el form de vendedor
  initFotoPreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('anuncioError');
    const btn   = document.getElementById('anuncioSubmitBtn');
    if (errEl) errEl.textContent = '';
    if (btn)   { btn.disabled = true; btn.textContent = 'Enviando…'; }

    // Sincronizar archivos pendientes al input antes de crear FormData
    syncFilesToInput();

    const formData = new FormData(form);

    try {
      const res  = await fetch('/api/anuncios', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (errEl) errEl.textContent = data.error || 'Error al enviar el anuncio.';
      } else {
        // Redirigir o mostrar mensaje de éxito
        const success = document.getElementById('anuncioSuccess');
        if (success) {
          form.style.display = 'none';
          success.style.display = 'block';
        } else {
          showToast('✅ Anuncio enviado correctamente', 'success');
          form.reset();
          pendingFiles = [];
          renderPendingPreviews();
        }
      }
    } catch {
      if (errEl) errEl.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Publicar mi vehículo'; }
    }
  });
}
window.initVendedorForm = initVendedorForm;

// Auto-inicializar el form de vendedor si existe en la página actual
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('anuncioForm')) {
    initVendedorForm();
  }
});
