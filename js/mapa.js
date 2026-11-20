const $ = selector => document.querySelector(selector);
const estado = $('#estado');
const ajustar = $('#ajustar');
const tema = $('#tema');
const app = { modo: null }; // null | 'cercania' | 'medir'

/* ---------- Tema (se recuerda entre visitas) ---------- */
function aplicarTema(claro) {
  document.documentElement.classList.toggle('claro', claro);
  tema.setAttribute('aria-pressed', claro);
  tema.textContent = claro ? 'Tema oscuro' : 'Tema claro';
  try { localStorage.setItem('tema', claro ? 'claro' : 'oscuro'); } catch { /* sin almacenamiento */ }
}
try { if (localStorage.getItem('tema') === 'claro') aplicarTema(true); } catch { /* sin almacenamiento */ }
tema.addEventListener('click', () => aplicarTema(!document.documentElement.classList.contains('claro')));

/* ---------- Configuración ---------- */
// [clave, nombre, color, campos que se muestran en el popup]
// En colonias, _gas y _tal se calculan en el navegador (punto en polígono).
const definiciones = [
  ['colonias', 'Colonias', '#a48aff', { _gas: 'Gasolineras', _tal: 'Talleres' }],
  ['gasolineras', 'Gasolineras', '#f8db62', { ofrece_diesel: 'Diésel', abierta_24h: 'Abierta 24 h' }],
  ['talleres', 'Talleres', '#37e1cb', { especialidad: 'Especialidad', servicio_a_domicilio: 'Servicio a domicilio' }]
];
const COLOR_COLONIAS = definiciones[0][2];
const ESCALA = ['#2b2252', '#4a3a9c', '#6c55d4', '#a48aff', '#e0d6ff'];
const BASES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 },
  claro: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', atribucion: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 20, subdominios: 'abcd' },
  satelite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', atribucion: 'Imágenes &copy; Esri', maxZoom: 19 }
};
const ESTILO_PUNTO = { color: '#17102b', weight: 2 };
const RESALTE = { color: '#f23887', weight: 4 };
const AYUDA_CERCANIA = 'Haz clic en el mapa para elegir el centro.';

/* ---------- Utilidades ---------- */
const normalizar = texto => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const formatoDistancia = m => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');

function dentroDeAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function dentroDePoligono(punto, geometria) {
  const poligonos = geometria?.type === 'Polygon' ? [geometria.coordinates]
    : geometria?.type === 'MultiPolygon' ? geometria.coordinates : [];
  return poligonos.some(([exterior, ...huecos]) =>
    dentroDeAnillo(punto, exterior) && !huecos.some(hueco => dentroDeAnillo(punto, hueco)));
}

function crearFicha(propiedades, nombre, campos) {
  const ficha = document.createElement('div');
  const titulo = document.createElement('strong');
  titulo.textContent = propiedades.nombre ?? nombre;
  ficha.append(titulo);
  for (const [campo, etiqueta] of Object.entries(campos)) {
    const valor = propiedades[campo];
    if (valor == null) continue;
    const fila = document.createElement('div');
    fila.textContent = etiqueta + ': ' + (typeof valor === 'boolean' ? (valor ? 'Sí' : 'No') : valor);
    ficha.append(fila);
  }
  return ficha;
}

// Centra el mapa en un elemento, enciende su capa si estaba apagada y abre el popup.
function irA(mapa, { clave, marcador }) {
  const casilla = $(`[data-capa="${clave}"]`);
  if (casilla && !casilla.checked) casilla.click();
  if (marcador.getBounds) mapa.fitBounds(marcador.getBounds(), { padding: [32, 32] });
  else mapa.setView(marcador.getLatLng(), Math.max(16, mapa.getZoom()));
  marcador.openPopup();
}

// Un solo modo activo a la vez: consulta de 500 m o regla.
function fijarModo(mapa, modo) {
  app.modo = modo;
  $('#cercanos').setAttribute('aria-pressed', modo === 'cercania');
  $('#medir').setAttribute('aria-pressed', modo === 'medir');
  mapa.getContainer().classList.toggle('seleccionando', modo !== null);
  const respuesta = $('#respuesta');
  if (modo !== 'cercania' && respuesta.textContent === AYUDA_CERCANIA) respuesta.textContent = '';
}

function leerHash() {
  const [zoom, lat, lng] = location.hash.slice(1).split('/').map(Number);
  return [zoom, lat, lng].every(Number.isFinite) ? { zoom, centro: [lat, lng] } : null;
}

/* ---------- Aplicación ---------- */
async function iniciar() {
  if (!window.L) throw new Error('No se pudo cargar Leaflet. Revisa tu conexión a internet.');
  const hash = leerHash();
  const mapa = L.map('mapa', { zoomControl: false, zoomSnap: 0.25 })
    .setView(hash ? hash.centro : [17.552, -99.500], hash ? hash.zoom : 13);
  mapa.createPane('colonias').style.zIndex = 390;
  mapa.createPane('servicios').style.zIndex = 410;
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  configurarMapaBase(mapa);
  configurarCoordenadas(mapa);
  mapa.on('moveend', () => {
    const { lat, lng } = mapa.getCenter();
    history.replaceState(null, '', `#${mapa.getZoom()}/${lat.toFixed(5)}/${lng.toFixed(5)}`);
  });

  const respuesta = await fetch('php/capas.php');
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'Error al consultar las capas.');

  const visibles = L.featureGroup().addTo(mapa);
  const contenedor = $('#capas');
  const elementos = { colonias: [], gasolineras: [], talleres: [] };
  const capas = {};
  const contadores = {};
  const filtros = { diesel: false, h24: false, domicilio: false, especialidad: '' };
  let coropleta = false;
  let maxGas = 0;

  for (const [clave] of definiciones) {
    for (const f of datos[clave]?.features ?? []) f.properties ??= {};
  }

  const pasa = (clave, p) => {
    if (clave === 'gasolineras') return (!filtros.diesel || p.ofrece_diesel) && (!filtros.h24 || p.abierta_24h);
    if (clave === 'talleres') return (!filtros.domicilio || p.servicio_a_domicilio) && (!filtros.especialidad || p.especialidad === filtros.especialidad);
    return true;
  };

  // Cuenta cuántos servicios (que cumplen los filtros) caen dentro de cada colonia.
  const recalcular = () => {
    const puntos = clave => (datos[clave]?.features ?? [])
      .filter(f => f.geometry?.type === 'Point' && pasa(clave, f.properties));
    const gas = puntos('gasolineras');
    const tal = puntos('talleres');
    for (const c of datos.colonias?.features ?? []) {
      c.properties._gas = gas.filter(g => dentroDePoligono(g.geometry.coordinates, c.geometry)).length;
      c.properties._tal = tal.filter(t => dentroDePoligono(t.geometry.coordinates, c.geometry)).length;
    }
    maxGas = Math.max(0, ...(datos.colonias?.features ?? []).map(c => c.properties._gas));
  };
  recalcular();

  const estiloColonia = ({ properties }) => (coropleta
    ? {
      color: COLOR_COLONIAS, weight: 2, fillOpacity: 0.7,
      fillColor: ESCALA[Math.round((properties._gas / (maxGas || 1)) * (ESCALA.length - 1))]
    }
    : { color: COLOR_COLONIAS, weight: 2, fillOpacity: 0.18 });

  let total = 0;
  for (const [clave, nombre, color, campos] of definiciones) {
    const coleccion = datos[clave];
    const disponible = coleccion?.type === 'FeatureCollection' && Array.isArray(coleccion.features);
    const capa = L.geoJSON(disponible ? coleccion : null, {
      bubblingMouseEvents: true,
      pane: clave === 'colonias' ? 'colonias' : 'servicios',
      style: clave === 'colonias' ? estiloColonia : { color, weight: 2, fillOpacity: 0.18 },
      pointToLayer: (_, coordenadas) => L.circleMarker(coordenadas, {
        pane: 'servicios', radius: 8, ...ESTILO_PUNTO, fillColor: color, fillOpacity: 1
      }),
      onEachFeature: (feature, marcador) => {
        const propiedades = feature.properties;
        // El popup se arma al abrirse, así siempre refleja los filtros actuales.
        marcador.bindPopup(() => crearFicha(propiedades, nombre, campos));
        elementos[clave].push({
          clave, nombre, feature, marcador, titulo: propiedades.nombre ?? nombre, activo: true
        });
      }
    });
    capas[clave] = capa;

    const cantidad = disponible ? coleccion.features.length : 0;
    total += cantidad;
    if (cantidad) visibles.addLayer(capa);

    const etiqueta = document.createElement('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = cantidad > 0;
    casilla.disabled = cantidad === 0;
    const muestra = document.createElement('span');
    muestra.className = clave === 'colonias' ? 'muestra poligono' : 'muestra';
    etiqueta.style.setProperty('--capa', color);
    muestra.setAttribute('aria-hidden', 'true');
    muestra.style.backgroundColor = color;
    const contador = document.createElement('span');
    contador.className = 'total';
    contador.textContent = disponible ? cantidad : 'Sin datos';
    contadores[clave] = contador;
    etiqueta.append(casilla, muestra, nombre, contador);
    contenedor.append(etiqueta);

    casilla.dataset.capa = clave;
    casilla.addEventListener('change', () => {
      if (casilla.checked) visibles.addLayer(capa);
      else visibles.removeLayer(capa);
      ajustar.disabled = !visibles.getBounds().isValid();
    });
  }

  /* --- Leyenda de la coropleta --- */
  const leyenda = L.control({ position: 'bottomleft' });
  leyenda.onAdd = () => L.DomUtil.create('div', 'leyenda');
  const pintarLeyenda = () => {
    const caja = leyenda.getContainer();
    if (!caja) return;
    const titulo = document.createElement('strong');
    titulo.textContent = 'Gasolineras por colonia';
    const barra = document.createElement('div');
    barra.className = 'barra-escala';
    for (const tono of ESCALA) {
      const tramo = document.createElement('i');
      tramo.style.backgroundColor = tono;
      barra.append(tramo);
    }
    const extremos = document.createElement('div');
    extremos.className = 'extremos';
    const minimo = document.createElement('span');
    minimo.textContent = '0';
    const maximo = document.createElement('span');
    maximo.textContent = String(maxGas);
    extremos.append(minimo, maximo);
    caja.replaceChildren(titulo, barra, extremos);
  };
  $('#coropleta').addEventListener('change', ({ target }) => {
    coropleta = target.checked;
    capas.colonias.setStyle(estiloColonia);
    if (coropleta) { leyenda.addTo(mapa); pintarLeyenda(); } else leyenda.remove();
  });

  /* --- Contadores, estadísticas y filtros --- */
  const actualizarContadores = () => {
    let cargados = 0;
    let mostrados = 0;
    for (const clave of Object.keys(elementos)) {
      const lista = elementos[clave];
      const n = lista.filter(i => i.activo).length;
      cargados += lista.length;
      mostrados += n;
      if (lista.length) contadores[clave].textContent = n === lista.length ? n : n + ' / ' + lista.length;
    }
    estado.textContent = !cargados ? 'La consulta no devolvió elementos.'
      : mostrados === cargados ? cargados + ' elementos cargados'
        : mostrados + ' de ' + cargados + ' elementos con los filtros actuales';
  };

  const renderEstadisticas = () => {
    const activos = clave => elementos[clave].filter(i => i.activo);
    const cuenta = (clave, campo) => activos(clave).filter(i => i.feature.properties[campo]).length;
    const datosKpi = [
      ['Colonias', elementos.colonias.length],
      ['Gasolineras', activos('gasolineras').length],
      ['Con diésel', cuenta('gasolineras', 'ofrece_diesel')],
      ['Abiertas 24 h', cuenta('gasolineras', 'abierta_24h')],
      ['Talleres', activos('talleres').length],
      ['A domicilio', cuenta('talleres', 'servicio_a_domicilio')]
    ];
    const cuadricula = document.createElement('dl');
    cuadricula.className = 'kpis';
    for (const [etiqueta, valor] of datosKpi) {
      const bloque = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = etiqueta;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      bloque.append(dd, dt);
      cuadricula.append(bloque);
    }

    const titulo = document.createElement('h3');
    titulo.textContent = 'Colonias con más gasolineras';
    const lista = document.createElement('ol');
    lista.className = 'ranking';
    const ranking = [...elementos.colonias]
      .sort((a, b) => b.feature.properties._gas - a.feature.properties._gas)
      .slice(0, 5);
    for (const item of ranking) {
      const n = item.feature.properties._gas;
      const fila = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      const nombre = document.createElement('span');
      nombre.textContent = item.titulo;
      const barra = document.createElement('span');
      barra.className = 'barra';
      barra.setAttribute('aria-hidden', 'true');
      const relleno = document.createElement('i');
      relleno.style.width = (maxGas ? (n / maxGas) * 100 : 0) + '%';
      barra.append(relleno);
      const cifra = document.createElement('b');
      cifra.textContent = n;
      boton.append(nombre, barra, cifra);
      boton.addEventListener('click', () => irA(mapa, item));
      fila.append(boton);
      lista.append(fila);
    }
    $('#estadisticas').replaceChildren(cuadricula, titulo, ...(elementos.colonias.length ? [lista] : []));
  };

  const aplicarFiltros = () => {
    for (const clave of ['gasolineras', 'talleres']) {
      for (const item of elementos[clave]) {
        item.activo = Boolean(pasa(clave, item.feature.properties));
        if (item.activo) capas[clave].addLayer(item.marcador);
        else capas[clave].removeLayer(item.marcador);
      }
    }
    recalcular();
    capas.colonias.setStyle(estiloColonia);
    if (coropleta) pintarLeyenda();
    actualizarContadores();
    renderEstadisticas();
    ajustar.disabled = !visibles.getBounds().isValid();
  };

  const especialidades = [...new Set(elementos.talleres.map(i => i.feature.properties.especialidad).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  for (const especialidad of especialidades) {
    const opcion = document.createElement('option');
    opcion.value = especialidad;
    opcion.textContent = especialidad;
    $('#f-especialidad').append(opcion);
  }
  $('#f-diesel').addEventListener('change', ({ target }) => { filtros.diesel = target.checked; aplicarFiltros(); });
  $('#f-24h').addEventListener('change', ({ target }) => { filtros.h24 = target.checked; aplicarFiltros(); });
  $('#f-domicilio').addEventListener('change', ({ target }) => { filtros.domicilio = target.checked; aplicarFiltros(); });
  $('#f-especialidad').addEventListener('change', ({ target }) => { filtros.especialidad = target.value; aplicarFiltros(); });
  $('#f-limpiar').addEventListener('click', () => {
    Object.assign(filtros, { diesel: false, h24: false, domicilio: false, especialidad: '' });
    for (const id of ['#f-diesel', '#f-24h', '#f-domicilio']) $(id).checked = false;
    $('#f-especialidad').value = '';
    aplicarFiltros();
  });

  /* --- Exportar lo que se ve --- */
  $('#exportar').addEventListener('click', () => {
    const features = [];
    for (const clave of Object.keys(elementos)) {
      if (!$(`[data-capa="${clave}"]`).checked) continue;
      for (const item of elementos[clave]) {
        if (!item.activo) continue;
        const propiedades = Object.fromEntries(
          Object.entries(item.feature.properties).filter(([campo]) => !campo.startsWith('_'))
        );
        features.push({ type: 'Feature', geometry: item.feature.geometry, properties: { capa: clave, ...propiedades } });
      }
    }
    if (!features.length) { estado.textContent = 'No hay elementos visibles para exportar.'; return; }
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(
      [JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' }
    ));
    enlace.download = 'geoportal-chilpancingo.geojson';
    enlace.click();
    URL.revokeObjectURL(enlace.href);
    estado.textContent = features.length + ' elementos exportados.';
  });

  ajustar.disabled = !visibles.getBounds().isValid();
  const encuadrar = () => mapa.fitBounds(visibles.getBounds(), { padding: [18, 18], maxZoom: 16 });
  ajustar.addEventListener('click', encuadrar);
  if (!ajustar.disabled && !hash) encuadrar();

  const contexto = { mapa, elementos };
  configurarBusqueda(contexto);
  configurarCercania(contexto);
  configurarUbicacion(contexto);
  configurarMedicion(mapa);
  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape') fijarModo(mapa, null);
  });

  actualizarContadores();
  renderEstadisticas();
}

/* ---------- Mapa base ---------- */
function configurarMapaBase(mapa) {
  const selector = $('#base');
  let actual = null;
  const poner = clave => {
    const base = BASES[clave] ?? BASES.osm;
    if (actual) mapa.removeLayer(actual);
    actual = L.tileLayer(base.url, {
      maxZoom: base.maxZoom, attribution: base.atribucion, subdomains: base.subdominios ?? 'abc'
    }).addTo(mapa);
    for (const nombre of Object.keys(BASES)) mapa.getContainer().classList.toggle('base-' + nombre, nombre === clave);
    selector.value = clave;
    try { localStorage.setItem('base', clave); } catch { /* sin almacenamiento */ }
  };
  let guardada = 'osm';
  try { guardada = localStorage.getItem('base') ?? 'osm'; } catch { /* sin almacenamiento */ }
  poner(guardada);
  selector.addEventListener('change', () => poner(selector.value));
}

/* ---------- Coordenadas del cursor (clic derecho copia) ---------- */
function configurarCoordenadas(mapa) {
  const control = L.control({ position: 'bottomright' });
  control.onAdd = () => {
    const caja = L.DomUtil.create('div', 'coordenadas');
    caja.textContent = 'Mueve el cursor sobre el mapa';
    return caja;
  };
  control.addTo(mapa);
  const caja = control.getContainer();
  const texto = ({ lat, lng }) => lat.toFixed(5) + ', ' + lng.toFixed(5);
  mapa.on('mousemove', ({ latlng }) => { caja.textContent = texto(latlng); });
  mapa.on('contextmenu', ({ latlng, originalEvent }) => {
    originalEvent.preventDefault();
    navigator.clipboard?.writeText(texto(latlng))
      .then(() => { caja.textContent = 'Copiado: ' + texto(latlng); })
      .catch(() => { /* el navegador no permitió copiar */ });
  });
}

/* ---------- Búsqueda ---------- */
function configurarBusqueda({ mapa, elementos }) {
  const buscar = $('#buscar');
  const resultados = $('#resultados');
  const todos = () => Object.values(elementos).flat();
  buscar.disabled = todos().length === 0;

  const coincidencias = () => {
    const texto = normalizar(buscar.value.trim());
    return texto ? todos().filter(i => i.activo && normalizar(i.titulo).includes(texto)).slice(0, 8) : [];
  };

  buscar.addEventListener('input', () => {
    resultados.replaceChildren();
    if (!buscar.value.trim()) return;
    const lista = coincidencias();
    for (const item of lista) {
      const fila = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = item.titulo + ' · ' + item.nombre;
      boton.addEventListener('click', () => irA(mapa, item));
      fila.append(boton);
      resultados.append(fila);
    }
    if (!lista.length) {
      const fila = document.createElement('li');
      fila.textContent = 'Sin coincidencias.';
      resultados.append(fila);
    }
  });

  // Enter abre el primer resultado; "/" enfoca el buscador desde cualquier parte.
  buscar.addEventListener('keydown', evento => {
    if (evento.key !== 'Enter') return;
    const [primero] = coincidencias();
    if (primero) irA(mapa, primero);
  });
  document.addEventListener('keydown', evento => {
    if (evento.key !== '/' || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    evento.preventDefault();
    buscar.focus();
  });
}

/* ---------- Talleres a 500 m ---------- */
function configurarCercania({ mapa, elementos }) {
  const boton = $('#cercanos');
  const respuesta = $('#respuesta');
  const radio = L.circle([0, 0], {
    radius: 500, color: '#f23887', fillOpacity: 0.12, interactive: false, pane: 'colonias'
  });
  let resaltados = [];
  const limpiar = () => {
    radio.remove();
    for (const item of resaltados) item.marcador.setStyle(ESTILO_PUNTO);
    resaltados = [];
  };

  boton.disabled = false;
  boton.addEventListener('click', () => {
    const activar = app.modo !== 'cercania';
    fijarModo(mapa, activar ? 'cercania' : null);
    if (activar) { limpiar(); respuesta.textContent = AYUDA_CERCANIA; }
  });

  mapa.on('click', async ({ latlng }) => {
    if (app.modo !== 'cercania') return;
    fijarModo(mapa, null);
    boton.disabled = true;
    limpiar();
    radio.setLatLng(latlng).addTo(mapa);
    respuesta.textContent = 'Consultando talleres…';
    try {
      const parametros = new URLSearchParams({ lat: latlng.lat, lon: latlng.lng });
      const peticion = await fetch('php/cercanos.php?' + parametros);
      const talleres = await peticion.json();
      if (!peticion.ok) throw new Error(talleres.error);
      respuesta.textContent = talleres.length ? '' : 'No hay talleres en un radio de 500 m.';
      if (talleres.length) {
        const lista = document.createElement('ol');
        for (const taller of talleres) {
          const fila = document.createElement('li');
          const texto = taller.nombre + ' · ' + taller.metros + ' m';
          const item = elementos.talleres.find(i => i.activo && i.titulo === taller.nombre);
          if (item) {
            item.marcador.setStyle(RESALTE);
            item.marcador.bringToFront();
            resaltados.push(item);
            const enlace = document.createElement('button');
            enlace.type = 'button';
            enlace.className = 'enlace';
            enlace.textContent = texto;
            enlace.addEventListener('click', () => irA(mapa, item));
            fila.append(enlace);
          } else fila.textContent = texto;
          lista.append(fila);
        }
        respuesta.append(lista);
      }
    } catch (error) {
      respuesta.textContent = error.message || 'No se pudieron consultar los talleres.';
    } finally {
      boton.disabled = false;
    }
  });
}

/* ---------- Mi ubicación y lugares más cercanos ---------- */
function configurarUbicacion({ mapa, elementos }) {
  const boton = $('#ubicacion');
  const salida = $('#respuesta-ubicacion');
  const capa = L.layerGroup().addTo(mapa);

  const masCercano = (origen, lista) => lista
    .filter(i => i.activo)
    .map(item => ({ item, metros: origen.distanceTo(item.marcador.getLatLng()) }))
    .sort((a, b) => a.metros - b.metros)[0];

  boton.addEventListener('click', () => {
    if (!navigator.geolocation) { salida.textContent = 'Tu navegador no permite obtener la ubicación.'; return; }
    boton.disabled = true;
    salida.textContent = 'Obteniendo tu ubicación…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      boton.disabled = false;
      const yo = L.latLng(coords.latitude, coords.longitude);
      capa.clearLayers();
      L.circle(yo, { radius: coords.accuracy, color: '#37a8ff', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(capa);
      L.circleMarker(yo, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#37a8ff', fillOpacity: 1, interactive: false }).addTo(capa);

      const lista = document.createElement('ul');
      const puntos = [yo];
      for (const [clave, rotulo] of [['gasolineras', 'Gasolinera'], ['talleres', 'Taller']]) {
        const cercano = masCercano(yo, elementos[clave]);
        if (!cercano) continue;
        puntos.push(cercano.item.marcador.getLatLng());
        L.polyline([yo, cercano.item.marcador.getLatLng()], { color: '#37a8ff', weight: 2, dashArray: '5 6', interactive: false }).addTo(capa);
        const fila = document.createElement('li');
        const enlace = document.createElement('button');
        enlace.type = 'button';
        enlace.className = 'enlace';
        enlace.textContent = rotulo + ' más cercano: ' + cercano.item.titulo + ' · ' + formatoDistancia(cercano.metros);
        enlace.addEventListener('click', () => irA(mapa, cercano.item));
        fila.append(enlace);
        lista.append(fila);
      }
      salida.replaceChildren(lista.children.length ? lista : 'No hay lugares visibles para comparar.');
      if (puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 16 });
      else mapa.setView(yo, 16);
    }, error => {
      boton.disabled = false;
      salida.textContent = error.code === 1
        ? 'Permiso de ubicación denegado. Actívalo en la barra de direcciones.'
        : 'No se pudo obtener tu ubicación.';
    }, { enableHighAccuracy: true, timeout: 10000 });
  });
}

/* ---------- Regla de distancia ---------- */
function configurarMedicion(mapa) {
  const boton = $('#medir');
  const salida = $('#medicion');
  const capa = L.layerGroup().addTo(mapa);
  let linea = null;
  let vertices = [];

  boton.addEventListener('click', () => {
    if (app.modo === 'medir') { fijarModo(mapa, null); return; }
    capa.clearLayers();
    linea = null;
    vertices = [];
    fijarModo(mapa, 'medir');
    salida.textContent = 'Haz clic para agregar puntos. Pulsa el botón otra vez para terminar.';
  });

  mapa.on('click', ({ latlng }) => {
    if (app.modo !== 'medir') return;
    mapa.closePopup();
    vertices.push(latlng);
    L.circleMarker(latlng, { radius: 4, color: '#f23887', fillOpacity: 1, interactive: false }).addTo(capa);
    if (linea) linea.setLatLngs(vertices);
    else linea = L.polyline(vertices, { color: '#f23887', weight: 3, dashArray: '6 6', interactive: false }).addTo(capa);
    const metros = vertices.slice(1).reduce((suma, punto, i) => suma + vertices[i].distanceTo(punto), 0);
    salida.textContent = 'Distancia: ' + formatoDistancia(metros) + ' · ' + vertices.length + ' puntos';
  });
}

iniciar().catch(error => {
  estado.textContent = error instanceof SyntaxError
    ? 'PHP no devolvió JSON. Abre el geoportal desde el servidor PHP.'
    : error.message;
});