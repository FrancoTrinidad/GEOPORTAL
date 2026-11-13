const estado = document.querySelector('#estado');
const ajustar = document.querySelector('#ajustar');
const tema = document.querySelector('#tema');
tema.addEventListener('click', () => {
  const claro = document.documentElement.classList.toggle('claro');
  tema.setAttribute('aria-pressed', claro);
  tema.textContent = claro ? 'Tema oscuro' : 'Tema claro';
});

const definiciones = [
  ['colonias', 'Colonias', '#a48aff', { gasolineras: 'Gasolineras' }],
  ['gasolineras', 'Gasolineras', '#f8db62', { ofrece_diesel: 'Diésel', abierta_24h: 'Abierta 24 h' }],
  ['talleres', 'Talleres', '#37e1cb', { especialidad: 'Especialidad', servicio_a_domicilio: 'Servicio a domicilio' }]
];

async function iniciar() {
  if (!window.L) throw new Error('No se pudo cargar Leaflet. Revisa tu conexión a internet.');
  const mapa = L.map('mapa', { zoomControl: false, zoomSnap: 0.25 }).setView([17.552, -99.500], 13);
  mapa.createPane('colonias').style.zIndex = 390;
  mapa.createPane('servicios').style.zIndex = 410;
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(mapa);

  const respuesta = await fetch('php/capas.php');
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'Error al consultar las capas.');

  const visibles = L.featureGroup().addTo(mapa);
  const contenedor = document.querySelector('#capas');
  const lugares = [];
  let total = 0;
  for (const [clave, nombre, color, campos] of definiciones) {
    const coleccion = datos[clave];
    const disponible = coleccion?.type === 'FeatureCollection' && Array.isArray(coleccion.features);
    const capa = L.geoJSON(disponible ? coleccion : null, {
      bubblingMouseEvents: true,
      pane: clave === 'colonias' ? 'colonias' : 'servicios',
      style: { color, weight: 2, fillOpacity: 0.18 },
      pointToLayer: (_, coordenadas) => L.circleMarker(coordenadas, {
        pane: 'servicios', radius: 8, color: '#17102b', weight: 2, fillColor: color, fillOpacity: 1
      }),
      onEachFeature: ({ properties = {} }, marcador) => {
        const ficha = document.createElement('div');
        const titulo = document.createElement('strong');
        titulo.textContent = properties.nombre ?? nombre;
        ficha.append(titulo);
        for (const [campo, etiqueta] of Object.entries(campos)) {
          const valor = properties[campo];
          if (valor == null) continue;
          const fila = document.createElement('div');
          fila.textContent = etiqueta + ': ' + (typeof valor === 'boolean' ? (valor ? 'Sí' : 'No') : valor);
          ficha.append(fila);
        }
        marcador.bindPopup(ficha);
        lugares.push({ titulo: titulo.textContent, nombre, marcador, capa: clave });
      }
    });

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
    etiqueta.append(casilla, muestra, nombre, contador);
    contenedor.append(etiqueta);

    casilla.dataset.capa = clave;
    casilla.addEventListener('change', () => {
      if (casilla.checked) visibles.addLayer(capa);
      else visibles.removeLayer(capa);
      ajustar.disabled = !visibles.getBounds().isValid();
    });
  }

  ajustar.disabled = !visibles.getBounds().isValid();
  const encuadrar = () => mapa.fitBounds(visibles.getBounds(), { padding: [18, 18], maxZoom: 16 });
  ajustar.addEventListener('click', encuadrar);
  if (!ajustar.disabled) encuadrar();
  configurarBusqueda(mapa, lugares);
  configurarCercania(mapa);
  estado.textContent = total ? total + ' elementos cargados' : 'La consulta no devolvió elementos.';
}

function configurarBusqueda(mapa, lugares) {
  const buscar = document.querySelector('#buscar');
  const resultados = document.querySelector('#resultados');
  const normalizar = texto => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  buscar.disabled = lugares.length === 0;
  buscar.addEventListener('input', () => {
    resultados.replaceChildren();
    const texto = normalizar(buscar.value.trim());
    if (!texto) return;
    const coincidencias = lugares.filter(lugar => normalizar(lugar.titulo).includes(texto)).slice(0, 8);
    for (const { titulo, nombre, marcador, capa } of coincidencias) {
      const fila = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = titulo + ' · ' + nombre;
      boton.addEventListener('click', () => {
        const casilla = document.querySelector(`[data-capa="${capa}"]`);
        if (!casilla.checked) casilla.click();
        if (marcador.getBounds) mapa.fitBounds(marcador.getBounds(), { padding: [32, 32] });
        else mapa.setView(marcador.getLatLng(), Math.max(16, mapa.getZoom()));
        marcador.openPopup();
      });
      fila.append(boton);
      resultados.append(fila);
    }
    if (!coincidencias.length) {
      const fila = document.createElement('li');
      fila.textContent = 'Sin coincidencias.';
      resultados.append(fila);
    }
  });
}

function configurarCercania(mapa) {
  const boton = document.querySelector('#cercanos');
  const respuesta = document.querySelector('#respuesta');
  const radio = L.circle([0, 0], {
    radius: 500, color: '#f23887', fillOpacity: 0.12, interactive: false, pane: 'colonias'
  });
  let activa = false;
  boton.disabled = false;
  boton.addEventListener('click', () => {
    activa = !activa;
    boton.setAttribute('aria-pressed', activa);
    mapa.getContainer().classList.toggle('seleccionando', activa);
    respuesta.textContent = activa ? 'Haz clic en el mapa para elegir el centro.' : '';
  });

  mapa.on('click', async ({ latlng }) => {
    if (!activa) return;
    activa = false;
    boton.setAttribute('aria-pressed', false);
    boton.disabled = true;
    mapa.getContainer().classList.remove('seleccionando');
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
          fila.textContent = taller.nombre + ' · ' + taller.metros + ' m';
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

iniciar().catch(error => {
  estado.textContent = error instanceof SyntaxError
    ? 'PHP no devolvió JSON. Abre el geoportal desde el servidor PHP.'
    : error.message;
});
