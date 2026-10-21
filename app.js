'use strict';

/* =====================================================================
   Rando PWA – Tour du Tanargue : carte, profil topographique, étapes,
   point de départ réglable, géolocalisation, hors ligne
   ===================================================================== */

// Préfixe propre à cette application : plusieurs applications partagent le même
// domaine sur GitHub Pages (mêmes caches et même localStorage).
const APP = 'escreins';
const TILE_CACHE = APP + '-tiles-v1';
const OFFTRACK_M = 50;           // seuil d'alerte hors sentier
const KM_MARK_EVERY = 5;         // un repère kilométrique tous les N km
const START_MAX_M = 300;         // « Ma position » comme départ : distance maximale au tracé
const MIN_DAY_KM = 3;            // une fin d'étape à moins de 3 km du départ ou de l'arrivée est écartée
const DAY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#7b5cd6', '#d6457b'];
const DAY_FILLS = ['rgba(42,120,214,.18)', 'rgba(235,104,52,.18)', 'rgba(27,175,122,.18)', 'rgba(123,92,214,.18)', 'rgba(214,69,123,.18)'];
const POI_ICON = { depart: 'D', col: '▲', refuge: '⌂', village: '●', lac: '≈', eau: '' };
const POI_PRIORITY = { stop: 0, col: 1, refuge: 2, village: 3, depart: 3, lac: 4, eau: 9 };

const BASEMAPS = {
  plan: {
    label: 'Plan IGN',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    nativeMax: 18, avgKB: 22,
    attribution: '© <a href="https://geoservices.ign.fr">IGN</a>',
  },
  ortho: {
    label: 'Photo aérienne IGN',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    nativeMax: 18, avgKB: 28,
    attribution: '© <a href="https://geoservices.ign.fr">IGN</a>',
  },
};
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';   // en ligne uniquement

const $ = id => document.getElementById(id);
const store = {
  get(k, def) { try { const v = localStorage.getItem(APP + '.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(APP + '.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
const fmt = (n, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = n => Math.round(n).toLocaleString('fr-FR');
const fmtHours = h => {
  const m = Math.round(h * 4) * 15;   // arrondi au quart d'heure
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '');
};
// Temps de marche, méthode DIN 33466 : 4 km/h à plat, 300 m/h en montée, 500 m/h en descente
const dinHours = (hKm, up, down) => {
  const a = hKm / 4, b = up / 300 + down / 500;
  return Math.max(a, b) + Math.min(a, b) / 2;
};

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------------------------------------------------------------------
   1. Carte
   --------------------------------------------------------------------- */
const map = L.map('map', { zoomControl: false, maxZoom: 18, tapTolerance: 20, zoomSnap: 0.25 });

const layers = {
  plan: L.tileLayer(BASEMAPS.plan.url, { maxZoom: 18, maxNativeZoom: 18, attribution: BASEMAPS.plan.attribution }),
  ortho: L.tileLayer(BASEMAPS.ortho.url, { maxZoom: 18, maxNativeZoom: 18, attribution: BASEMAPS.ortho.attribution }),
  osm: L.tileLayer(OSM_URL, { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
};
const layerNames = { 'Plan IGN': layers.plan, 'Photo aérienne IGN': layers.ortho, 'OpenStreetMap (en ligne)': layers.osm };
const savedBase = store.get('base', 'plan');
(layers[savedBase] || layers.plan).addTo(map);
L.control.layers(layerNames, null, { position: 'topright', collapsed: true }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.on('baselayerchange', e => {
  const key = Object.keys(layers).find(k => layers[k] === e.layer);
  if (key) store.set('base', key);
});

// Hors ligne : on ne dépasse pas le zoom téléchargé (les tuiles sont agrandies)
function applyZoomMode() {
  const maxes = store.get('offMax', {});
  const offline = !navigator.onLine;
  for (const key of ['plan', 'ortho']) {
    const z = offline && maxes[key] ? maxes[key] : BASEMAPS[key].nativeMax;
    if (layers[key].options.maxNativeZoom !== z) {
      layers[key].options.maxNativeZoom = z;
      if (map.hasLayer(layers[key])) layers[key].redraw();
    }
  }
}
window.addEventListener('online', applyZoomMode);
window.addEventListener('offline', applyZoomMode);
applyZoomMode();

/* ---------------------------------------------------------------------
   2. Données : la boucle telle que livrée (BASE) et la boucle vue depuis
      le départ choisi (ROUTE). Toutes les distances de ROUTE partent de 0.
   --------------------------------------------------------------------- */
let DATA = null;       // contenu de data/parcours.json
let BASE = null;       // profil d'origine (boucle fermée, dernier point = premier)
let ROUTE = null;      // profil tourné pour commencer au départ choisi
let TRACK = null;      // ROUTE projeté en mètres, pour accrocher une position au tracé
let START = null;      // { km (sur BASE), name }
let chart = null;
let cursorIdx = null;  // index de ROUTE survolé / touché
let liveKm = null;     // position GPS projetée sur ROUTE (km)
let cursorMarker = null;
let routeLayer = null; // couleurs des étapes, repères km, marqueur de départ
let picking = false;   // choix du départ en touchant la carte
let nDays = 3;         // nombre d'étapes

async function loadData() {
  const res = await fetch('data/parcours.json');
  DATA = await res.json();
  BASE = DATA.profile;
  BASE.total = BASE.d[BASE.d.length - 1];
  BASE.totalH = BASE.h[BASE.h.length - 1];
  BASE.lat0 = BASE.lat.reduce((s, v) => s + v, 0) / BASE.lat.length;
  BASE.kx = 111320 * Math.cos(BASE.lat0 * Math.PI / 180);
  BASE.ky = 110574;

  const def = DATA.poi.find(p => p.type === 'depart');
  const saved = store.get('start', null);
  START = saved && saved.route === DATA.name ? saved : { km: 0, name: def ? def.name : 'Départ d\'origine' };
  nDays = store.get('days', 3);
  $('days-select').value = nDays;

  drawStaticLayers();
  initChart();
  fillStartSelect();
  setStart(START.km, START.name, { save: false, fit: true });
}

// premier index i tel que arr[i] >= v
function upperIndex(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Valeur interpolée d'une série à la distance km (d = série des distances)
function valueAt(d, series, km) {
  if (km <= d[0]) return series[0];
  if (km >= d[d.length - 1]) return series[series.length - 1];
  const i = upperIndex(d, km);
  const t = (km - d[i - 1]) / ((d[i] - d[i - 1]) || 1);
  return series[i - 1] + (series[i] - series[i - 1]) * t;
}

const wrapKm = km => ((km % BASE.total) + BASE.total) % BASE.total;
const toBaseKm = routeKm => wrapKm(routeKm + ROUTE.offset);
const toRouteKm = baseKm => wrapKm(baseKm - ROUTE.offset);

// Fait tourner la boucle pour qu'elle commence à s0 (km sur BASE)
function buildRoute(s0, nDays) {
  s0 = wrapKm(s0);
  const T = BASE.total, TH = BASE.totalH, n = BASE.d.length;
  const keys = ['alt', 'lat', 'lon'];
  const R = { d: [], h: [], alt: [], lat: [], lon: [], offset: s0 };
  const h0 = valueAt(BASE.d, BASE.h, s0);
  const startPt = Object.fromEntries(keys.map(k => [k, valueAt(BASE.d, BASE[k], s0)]));
  const push = (d, h, p) => { R.d.push(d); R.h.push(h); keys.forEach(k => R[k].push(p[k])); };
  const at = j => Object.fromEntries(keys.map(k => [k, BASE[k][j]]));

  push(0, 0, startPt);
  for (let j = 0; j < n - 1; j++) if (BASE.d[j] > s0) push(BASE.d[j] - s0, BASE.h[j] - h0, at(j));
  for (let j = 0; j < n - 1; j++) if (BASE.d[j] < s0) push(BASE.d[j] + T - s0, BASE.h[j] + TH - h0, at(j));
  push(T, TH, startPt);

  // D+ et D− cumulés depuis le départ choisi
  R.dplus = [0]; R.dminus = [0];
  for (let i = 1; i < R.alt.length; i++) {
    const dz = R.alt[i] - R.alt[i - 1];
    R.dplus.push(R.dplus[i - 1] + Math.max(0, dz));
    R.dminus.push(R.dminus[i - 1] + Math.max(0, -dz));
  }
  R.total = T;
  R.totalH = TH;

  // Points d'intérêt et étapes vus depuis ce départ
  R.poi = DATA.poi.map(p => ({ ...p, rkm: wrapKm(p.km - s0) })).sort((a, b) => a.rkm - b.rkm);
  const stops = chooseStops(R, nDays);
  stops.forEach(p => { p.stop = true; });
  R.days = daysFor(R, stops);
  return R;
}

function dayStats(R, a, b) {
  const v = s => [valueAt(R.d, R.h, s), valueAt(R.d, R.dplus, s), valueAt(R.d, R.dminus, s)];
  const [ha, pa, ma] = v(a), [hb, pb, mb] = v(b);
  return { from: a, to: b, km: b - a, h: hb - ha, dplus: pb - pa, dminus: mb - ma, time: dinHours(hb - ha, pb - pa, mb - ma) };
}

function daysFor(R, stops) {
  const bounds = [0, ...stops.map(p => p.rkm), R.total];
  const ends = [...stops.map(p => p.name), 'arrivée'];
  return bounds.slice(0, -1).map((a, k) => ({ ...dayStats(R, a, bounds[k + 1]), end: ends[k] }));
}

// Fins d'étape : parmi les hébergements, la combinaison qui rend la plus longue
// journée (temps de marche) la plus courte possible, puis la plus régulière.
function chooseStops(R, n) {
  const cands = R.poi.filter(p => p.lodging && p.rkm > MIN_DAY_KM && p.rkm < R.total - MIN_DAY_KM);
  const k = Math.min(n - 1, cands.length);
  let best = null;
  const pick = (from, chosen) => {
    if (chosen.length === k) {
      const times = daysFor(R, chosen).map(dy => dy.time);
      const score = [Math.max(...times), times.reduce((s, t) => s + t * t, 0)];
      if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1])) {
        best = { score, stops: chosen.slice() };
      }
      return;
    }
    for (let i = from; i < cands.length; i++) { chosen.push(cands[i]); pick(i + 1, chosen); chosen.pop(); }
  };
  pick(0, []);
  return best ? best.stops : [];
}

function buildTrack() {
  TRACK = {
    x: ROUTE.lon.map(v => (v - ROUTE.lon[0]) * BASE.kx),
    y: ROUTE.lat.map(v => (v - BASE.lat0) * BASE.ky),
    lon0: ROUTE.lon[0],
    latlngs: ROUTE.lat.map((v, i) => [v, ROUTE.lon[i]]),
  };
}

// Point de ROUTE à la distance km
function pointAt(km) {
  return [valueAt(ROUTE.d, ROUTE.lat, km), valueAt(ROUTE.d, ROUTE.lon, km)];
}

// Projette une position sur le tracé. `lastKm` départage les passages proches
// (aller/retour, lacets, jonction départ/arrivée).
function snapToTrack(lat, lon, lastKm = null) {
  const px = (lon - TRACK.lon0) * BASE.kx;
  const py = (lat - BASE.lat0) * BASE.ky;
  const { x, y } = TRACK, cum = ROUTE.d;
  const cands = [];
  let best = Infinity;
  for (let i = 0; i < x.length - 1; i++) {
    const dx = x[i + 1] - x[i], dy = y[i + 1] - y[i];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x[i]) * dx + (py - y[i]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(x[i] + t * dx - px, y[i] + t * dy - py);
    cands.push([dist, cum[i] + t * (cum[i + 1] - cum[i])]);
    if (dist < best) best = dist;
  }
  let pick = null;
  for (const c of cands) {
    if (c[0] > best + 25) continue;
    if (!pick) { pick = c; continue; }
    if (lastKm === null ? c[0] < pick[0] : Math.abs(c[1] - lastKm) < Math.abs(pick[1] - lastKm)) pick = c;
  }
  return { km: pick[1], dist: pick[0] };
}

function routeIndexAt(km) {
  const d = ROUTE.d;
  const i = upperIndex(d, km);
  return i > 0 && Math.abs(d[i - 1] - km) < Math.abs(d[i] - km) ? i - 1 : i;
}

const dayIndexAt = km => {
  const i = ROUTE.days.findIndex(dy => km < dy.to);
  return i < 0 ? ROUTE.days.length - 1 : i;
};

/* ---------------------------------------------------------------------
   3. Changer de point de départ
   --------------------------------------------------------------------- */
function setStart(baseKm, name, { save = true, fit = false } = {}) {
  START = { km: wrapKm(baseKm), name, route: DATA.name };
  if (save) store.set('start', START);
  ROUTE = buildRoute(START.km, nDays);
  buildTrack();
  cursorIdx = null;
  liveKm = null;
  $('btn-start-here').classList.add('hidden');
  $('readout').textContent = 'Touchez le profil pour situer un point sur la carte';
  if (cursorMarker && map.hasLayer(cursorMarker)) map.removeLayer(cursorMarker);

  drawRouteLayers(fit);
  fillSummary();
  updateChart();
  if (lastFix && watchId !== null) updateLiveStats(lastFix[0], lastFix[1], lastAccuracy);
}

function fillStartSelect() {
  const sel = $('start-select');
  sel.innerHTML = '';
  DATA.poi.filter(p => p.type !== 'eau').forEach(p => {
    const o = document.createElement('option');
    o.value = DATA.poi.indexOf(p);
    o.textContent = `${p.name}${p.lodging ? ' (hébergement)' : ''}`;
    sel.appendChild(o);
  });
}

function startPicking() {
  picking = true;
  $('pick-banner').classList.remove('hidden');
  $('map').style.cursor = 'crosshair';
}
function stopPicking() {
  picking = false;
  $('pick-banner').classList.add('hidden');
  $('map').style.cursor = '';
}

function startFromRouteKm(routeKm, name) {
  const baseKm = toBaseKm(routeKm);
  setStart(baseKm, name || `km ${fmt(baseKm)} de la boucle d'origine`);
  toast(`Départ : ${START.name}`);
}

const dlgStart = $('dlg-start');
const openStartDialog = () => {
  const cur = DATA.poi.findIndex(p => Math.abs(p.km - START.km) < 0.01);
  if (cur >= 0) $('start-select').value = cur;
  dlgStart.showModal();
};
$('btn-start').addEventListener('click', openStartDialog);
$('btn-start-2').addEventListener('click', openStartDialog);
$('days-select').addEventListener('change', () => {
  nDays = +$('days-select').value;
  store.set('days', nDays);
  setStart(START.km, START.name);
});
$('btn-start-apply').addEventListener('click', () => {
  const p = DATA.poi[+$('start-select').value];
  setStart(p.km, p.name);
  dlgStart.close();
  toast(`Départ : ${p.name}`);
});
$('btn-start-reset').addEventListener('click', () => {
  const def = DATA.poi.find(p => p.type === 'depart');
  setStart(0, def ? def.name : 'Départ d\'origine');
  dlgStart.close();
  toast('Départ d\'origine rétabli');
});
$('btn-start-map').addEventListener('click', () => { dlgStart.close(); startPicking(); });
$('btn-pick-cancel').addEventListener('click', stopPicking);
$('btn-start-gps').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('La géolocalisation n\'est pas disponible sur cet appareil.'); return; }
  toast('Recherche de la position GPS…');
  navigator.geolocation.getCurrentPosition(pos => {
    const s = snapToTrack(pos.coords.latitude, pos.coords.longitude);
    if (s.dist > START_MAX_M) {
      toast(`Vous êtes à ${fmt(s.dist / 1000)} km du tracé : départ non modifié.`, 5000);
      return;
    }
    dlgStart.close();
    startFromRouteKm(s.km, 'Ma position');
  }, () => toast('Position indisponible.', 4000), { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
});
$('btn-start-here').addEventListener('click', () => {
  if (cursorIdx === null) return;
  const km = ROUTE.d[cursorIdx];
  const near = nearestPoi(km, 0.15, true);
  startFromRouteKm(km, near ? near.name : null);
});

function nearestPoi(km, maxKm, noStreams = false) {
  let best = null;
  for (const p of ROUTE.poi) {
    if (noStreams && p.type === 'eau') continue;
    const dd = Math.abs(p.rkm - km);
    if (dd <= maxKm && (!best || dd < Math.abs(best.rkm - km))) best = p;
  }
  return best;
}

/* ---------------------------------------------------------------------
   4. Dessin sur la carte
   --------------------------------------------------------------------- */
let fullBounds = null;

function drawStaticLayers() {
  const latlngs = BASE.lat.map((v, i) => [v, BASE.lon[i]]);
  L.polyline(latlngs, { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(map);
  fullBounds = L.latLngBounds(latlngs);

  // zone de clic élargie pour le doigt
  L.polyline(latlngs, { weight: 28, opacity: 0, className: 'track-hit' })
    .on('click', e => {
      L.DomEvent.stopPropagation(e);
      onTrackTap(e.latlng);
    })
    .addTo(map);
  map.on('click', e => { if (picking) onTrackTap(e.latlng); });

  cursorMarker = L.circleMarker([0, 0], { radius: 9, color: '#fff', weight: 3, fillColor: '#222', fillOpacity: 1, interactive: false });
  $('btn-fit').addEventListener('click', fitAll);
  window.addEventListener('load', fitAll, { once: true });   // mise en page finale (panneau du profil)
}

function fitAll() {
  map.invalidateSize();
  map.fitBounds(fullBounds, { padding: [20, 20] });
}

function onTrackTap(latlng) {
  const s = snapToTrack(latlng.lat, latlng.lng);
  if (picking) {
    if (s.dist > 500) { toast('Touchez plus près du tracé.'); return; }
    stopPicking();
    const near = nearestPoi(s.km, 0.15, true);
    startFromRouteKm(s.km, near ? near.name : null);
    return;
  }
  setCursor(routeIndexAt(s.km), { fromMap: true });
}

function drawRouteLayers(fit) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.layerGroup();
  for (const [k, dy] of ROUTE.days.entries()) {
    const i0 = routeIndexAt(dy.from), i1 = routeIndexAt(dy.to);
    L.polyline(TRACK.latlngs.slice(i0, i1 + 1), { color: DAY_COLORS[k % DAY_COLORS.length], weight: 5, opacity: 1, interactive: false })
      .addTo(routeLayer);
  }
  for (let km = KM_MARK_EVERY; km < ROUTE.total - 1; km += KM_MARK_EVERY) {
    L.marker(pointAt(km), {
      icon: L.divIcon({ className: 'km-mark', html: km + ' km', iconSize: [42, 18] }),
      interactive: false, keyboard: false,
    }).addTo(routeLayer);
  }
  // Points d'intérêt
  for (const p of ROUTE.poi) {
    if (p.type === 'depart') continue;
    const size = p.type === 'eau' ? 10 : p.stop ? 24 : 20;
    const m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: `poi ${p.type}${p.stop ? ' stop' : ''}`, html: p.stop ? '★' : p.lodging && p.type !== 'refuge' ? '⌂' : POI_ICON[p.type], iconSize: [size, size] }),
      keyboard: false, zIndexOffset: p.stop ? 400 : p.type === 'eau' ? 0 : 200,
    }).addTo(routeLayer);
    m.bindTooltip(() => `${p.name} · km ${fmt(toRouteKm(p.km))}`, { direction: 'top', offset: [0, -size / 2] });
    if (p.type !== 'eau') {
      m.bindPopup(() => {
        const div = document.createElement('div');
        div.innerHTML = `<b>${p.name}</b><br>km ${fmt(toRouteKm(p.km))} · ${Math.round(valueAt(BASE.d, BASE.alt, p.km))} m${p.stop ? '<br>Fin d\'étape' : p.lodging ? '<br>Hébergement' : ''}<br>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'popup-btn';
        btn.textContent = '⚑ Partir d\'ici';
        btn.onclick = () => { map.closePopup(); setStart(p.km, p.name); toast(`Départ : ${p.name}`); };
        div.appendChild(btn);
        return div;
      });
    }
  }

  L.marker(TRACK.latlngs[0], {
    icon: L.divIcon({ className: 'start-mark', html: 'D', iconSize: [24, 24] }),
    keyboard: false, zIndexOffset: 500,
  }).bindTooltip(`Départ / arrivée : ${START.name}`).addTo(routeLayer);
  routeLayer.addTo(map);
  if (fit) fitAll();
}

function fillSummary() {
  $('start-name').textContent = START.name;
  $('sum-km').textContent = fmt(ROUTE.total);
  $('sum-dplus').textContent = fmtInt(ROUTE.dplus[ROUTE.dplus.length - 1]);
  $('sum-dminus').textContent = fmtInt(ROUTE.dminus[ROUTE.dminus.length - 1]);
  $('sum-alt').textContent = `${DATA.altMin}–${DATA.altMax} m`;
  $('sum-time').textContent = fmtHours(ROUTE.days.reduce((s, dy) => s + dy.time, 0));

  const box = $('days');
  box.innerHTML = '';
  ROUTE.days.forEach((dy, k) => {
    const el = document.createElement('div');
    el.className = 'day';
    el.style.borderColor = DAY_COLORS[k % DAY_COLORS.length];
    el.title = `Jour ${k + 1} : jusqu'à ${dy.end}`;
    el.innerHTML = `<b>J${k + 1}</b> · ${fmt(dy.km)} km<br>≈ ${fmtHours(dy.time)}<br>D+ ${fmtInt(dy.dplus)} · D− ${fmtInt(dy.dminus)}`;
    el.addEventListener('click', () => {
      const i0 = routeIndexAt(dy.from), i1 = routeIndexAt(dy.to);
      map.fitBounds(L.latLngBounds(TRACK.latlngs.slice(i0, i1 + 1)), { padding: [30, 30] });
    });
    box.appendChild(el);
  });
}

/* ---------------------------------------------------------------------
   5. Profil topographique (Chart.js)
   --------------------------------------------------------------------- */
const cursorPlugin = {
  id: 'cursors',
  afterDraw(c) {
    if (!ROUTE) return;
    const { ctx, scales: { x, y } } = c;
    const draw = (km, color) => {
      const px = x.getPixelForValue(km);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom);
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, y.getPixelForValue(valueAt(ROUTE.d, ROUTE.alt, km)), 6, 0, 2 * Math.PI);
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    if (cursorIdx !== null) draw(ROUTE.d[cursorIdx], 'rgba(20,20,20,.85)');
    if (liveKm !== null) draw(liveKm, 'rgba(21,101,192,.95)');
  },
};

// Fins d'étape, numéros de jour et noms des lieux sur le profil
const poiPlugin = {
  id: 'poi',
  afterDatasetsDraw(c) {
    if (!ROUTE) return;
    const { ctx, chartArea: area, scales: { x, y } } = c;
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ROUTE.days.forEach((dy, k) => {
      const xa = x.getPixelForValue(dy.from), xb = x.getPixelForValue(dy.to);
      ctx.fillStyle = DAY_COLORS[k % DAY_COLORS.length];
      ctx.fillRect(xa + 1, area.top, xb - xa - 2, 3);
      ctx.fillText('J' + (k + 1), (xa + xb) / 2, area.top + 5);
      if (k > 0) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.moveTo(xa, area.top); ctx.lineTo(xa, area.bottom);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // noms : les plus importants d'abord, sans chevauchement
    const placed = [];
    const items = ROUTE.poi
      .filter(p => p.type !== 'depart' || p.rkm > 0.2)
      .map(p => ({ p, prio: p.stop ? POI_PRIORITY.stop : POI_PRIORITY[p.type] }))
      .sort((a, b) => a.prio - b.prio);
    ctx.textBaseline = 'middle';
    for (const { p } of items) {
      const px = x.getPixelForValue(p.rkm);
      const py = y.getPixelForValue(valueAt(ROUTE.d, ROUTE.alt, p.rkm));
      if (p.type === 'eau') {   // cours d'eau : petit repère au pied du profil
        ctx.fillStyle = '#4a90c2';
        ctx.beginPath();
        ctx.moveTo(px - 4, area.bottom - 8); ctx.lineTo(px + 4, area.bottom - 8); ctx.lineTo(px, area.bottom - 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = p.stop ? '#111' : '#444';
      ctx.beginPath(); ctx.arc(px, py, p.stop ? 4 : 3, 0, 2 * Math.PI); ctx.fill();
      if (placed.some(q => Math.abs(q - px) < 13)) continue;
      const room = py - 10 - (area.top + 20);
      if (room < 30) continue;
      let label = p.name;
      ctx.font = (p.stop ? '700 ' : '400 ') + '10px system-ui, sans-serif';
      while (ctx.measureText(label).width > room && label.length > 4) label = label.slice(0, -2);
      if (label !== p.name) label = label.trimEnd() + '…';
      placed.push(px);
      ctx.save();
      ctx.translate(px, py - 8);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillRect(-1, -6, ctx.measureText(label).width + 2, 12);
      ctx.fillStyle = '#222';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  },
};

function initChart() {
  chart = new Chart($('chart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [{
        data: [],
        parsing: false,
        borderWidth: 2,
        fill: 'start',
        pointRadius: 0,
        pointHitRadius: 0,
        tension: 0,
        segment: {
          borderColor: ctx => ROUTE && DAY_COLORS[dayIndexAt(ctx.p0.parsed.x) % DAY_COLORS.length],
          backgroundColor: ctx => ROUTE && DAY_FILLS[dayIndexAt(ctx.p0.parsed.x) % DAY_FILLS.length],
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      interaction: { mode: 'index', axis: 'x', intersect: false },
      scales: {
        x: {
          type: 'linear', min: 0, max: BASE.total,
          ticks: { callback: v => (Number.isInteger(v) ? v + ' km' : ''), maxTicksLimit: 8, font: { size: 11 } },
          grid: { display: false },
        },
        y: {
          min: Math.floor((DATA.altMin - 0.05 * (DATA.altMax - DATA.altMin)) / 50) * 50,
          max: Math.ceil((DATA.altMax + 0.9 * (DATA.altMax - DATA.altMin)) / 50) * 50,   // place pour les noms au-dessus du profil
          afterBuildTicks: axis => { axis.ticks = axis.ticks.filter(t => t.value <= DATA.altMax + 0.1 * (DATA.altMax - DATA.altMin)); },
          ticks: { callback: v => v + ' m', maxTicksLimit: 7, font: { size: 11 } },
        },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      onHover: (_e, els) => { if (els.length) setCursor(els[0].index, { fromChart: true }); },
      onClick: (_e, els) => { if (els.length) setCursor(els[0].index, { fromChart: true }); },
    },
    plugins: [poiPlugin, cursorPlugin],
  });
}

function updateChart() {
  chart.data.datasets[0].data = ROUTE.d.map((d, i) => ({ x: d, y: ROUTE.alt[i] }));
  chart.options.scales.x.max = ROUTE.total;
  chart.update('none');
}

function setCursor(idx, { fromChart = false, fromMap = false } = {}) {
  cursorIdx = idx;
  const d = ROUTE.d[idx];
  const lat = ROUTE.lat[idx], lon = ROUTE.lon[idx];
  const a = upperIndex(ROUTE.d, d - 0.05), b = Math.min(ROUTE.d.length - 1, upperIndex(ROUTE.d, d + 0.05));
  const slope = (ROUTE.alt[b] - ROUTE.alt[a]) / (((ROUTE.h[b] - ROUTE.h[a]) * 1000) || 1) * 100;
  const near = nearestPoi(d, 0.3);
  $('readout').textContent =
    `J${dayIndexAt(d) + 1} · km ${fmt(d)} · ${Math.round(ROUTE.alt[idx])} m · pente ${slope >= 0 ? '+' : ''}${Math.round(slope)} % · D+ ${fmtInt(ROUTE.dplus[idx])} m` +
    (near ? ` · ${near.name}` : '');
  $('btn-start-here').classList.remove('hidden');

  cursorMarker.setLatLng([lat, lon]);
  if (!map.hasLayer(cursorMarker)) cursorMarker.addTo(map);
  if (fromChart && !map.getBounds().pad(-0.2).contains([lat, lon])) map.panTo([lat, lon], { animate: true, duration: 0.3 });
  if (fromMap) chart.update('none'); else chart.draw();
}

// Afficher / masquer le profil (mémorisé) : la carte prend alors tout l'écran
function setProfileVisible(show) {
  $('app').classList.toggle('no-profile', !show);
  const btn = $('btn-profile');
  btn.setAttribute('aria-pressed', String(show));
  btn.title = btn.ariaLabel = show ? 'Masquer le profil' : 'Afficher le profil';
  store.set('profile', show);
  map.invalidateSize();
  if (show && chart) chart.resize();
}
$('btn-profile').addEventListener('click', () => setProfileVisible($('app').classList.contains('no-profile')));
$('btn-hide-profile').addEventListener('click', () => setProfileVisible(false));
setProfileVisible(store.get('profile', true));

/* ---------------------------------------------------------------------
   6. Géolocalisation et suivi sur le tracé
   --------------------------------------------------------------------- */
let watchId = null;
let follow = true;
let gpsMarker = null, gpsCircle = null, userTrace = null;
const userPoints = [];
let wakeLock = null;
let lastFix = null;
let lastAccuracy = 0;

async function keepScreenOn() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* refusé */ }
}
document.addEventListener('visibilitychange', () => {
  if (watchId !== null && document.visibilityState === 'visible') keepScreenOn();
});

function startTracking() {
  if (!('geolocation' in navigator)) { toast('La géolocalisation n\'est pas disponible sur cet appareil.'); return; }
  const btn = $('btn-geoloc');
  btn.textContent = '■ Arrêter le suivi';
  btn.classList.add('active');
  $('btn-center').classList.remove('hidden');
  follow = true;
  keepScreenOn();
  toast('Recherche de la position GPS…');
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
}

function stopTracking() {
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  const btn = $('btn-geoloc');
  btn.textContent = '📍 Ma position';
  btn.classList.remove('active');
  $('btn-center').classList.add('hidden');
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  liveKm = null;
  lastFix = null;
  if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
  if (gpsCircle) { map.removeLayer(gpsCircle); gpsCircle = null; }
  $('live-stats').classList.add('hidden');
  $('offtrack').classList.add('hidden');
  if (chart) chart.draw();
}

function onGpsError(err) {
  const msg = {
    1: 'Localisation refusée : autorisez-la dans les réglages du navigateur.',
    2: 'Position indisponible pour le moment.',
    3: 'Le GPS met du temps à répondre…',
  }[err.code] || 'Erreur GPS.';
  toast(msg, 5000);
  if (err.code === 1) stopTracking();
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const ll = [lat, lon];
  lastFix = ll;
  lastAccuracy = accuracy;

  if (!gpsMarker) {
    gpsMarker = L.marker(ll, {
      icon: L.divIcon({ className: 'gps-dot', iconSize: [20, 20] }),
      interactive: false, keyboard: false, zIndexOffset: 1000,
    }).addTo(map);
    gpsCircle = L.circle(ll, { radius: accuracy, weight: 1, color: '#1565c0', fillOpacity: .1, interactive: false }).addTo(map);
    if (!userTrace) userTrace = L.polyline([], { color: '#1565c0', weight: 3, opacity: .7, interactive: false }).addTo(map);
  } else {
    gpsMarker.setLatLng(ll);
    gpsCircle.setLatLng(ll).setRadius(accuracy);
  }
  if (accuracy < 50) { userPoints.push(ll); userTrace.setLatLngs(userPoints); }
  if (follow) map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });

  if (TRACK) updateLiveStats(lat, lon, accuracy);
}

function updateLiveStats(lat, lon, accuracy) {
  const s = snapToTrack(lat, lon, liveKm);
  liveKm = s.km;
  const left = Math.max(0, ROUTE.total - s.km);
  const dplusTotal = ROUTE.dplus[ROUTE.dplus.length - 1];
  $('st-alt').textContent = Math.round(valueAt(ROUTE.d, ROUTE.alt, s.km));
  $('st-done').textContent = fmt(s.km);
  $('st-left').textContent = fmt(left);
  $('st-dplus').textContent = fmtInt(Math.max(0, dplusTotal - valueAt(ROUTE.d, ROUTE.dplus, s.km)));
  $('st-pct').textContent = Math.round(s.km / ROUTE.total * 100) + ' %';
  $('live-stats').classList.remove('hidden');

  const off = $('offtrack');
  if (s.dist > Math.max(OFFTRACK_M, accuracy)) {
    if (off.classList.contains('hidden') && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    off.textContent = `⚠️ Hors sentier (${Math.round(s.dist)} m)`;
    off.classList.remove('hidden');
  } else {
    off.classList.add('hidden');
  }
  chart.draw();
}

$('btn-geoloc').addEventListener('click', () => (watchId === null ? startTracking() : stopTracking()));
map.on('dragstart', () => {
  if (watchId !== null && follow) {
    follow = false;
    toast('Carte libre. Touchez ◎ pour recentrer sur vous.', 3000);
  }
});
$('btn-center').addEventListener('click', () => {
  if (lastFix) { follow = true; map.setView(lastFix, Math.max(map.getZoom(), 15)); }
});

/* ---------------------------------------------------------------------
   7. Hors ligne : téléchargement des tuiles le long du parcours
   --------------------------------------------------------------------- */
const MIN_ZOOM = 8;
const BUFFER_M = 900;

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

// Liste des tuiles (z, x, y) qui couvrent un couloir autour du tracé
function corridorTiles(maxZoom) {
  const out = [];
  const { lon, lat } = BASE;
  for (let z = MIN_ZOOM; z <= maxZoom; z++) {
    const tileM = 40075016.7 * Math.cos(BASE.lat0 * Math.PI / 180) / 2 ** z;
    const b = Math.max(1, Math.ceil(BUFFER_M / tileM));
    const step = Math.max(1, Math.floor(tileM / 2 / 10));   // les points du profil sont espacés d'environ 10 m
    const set = new Set();
    for (let i = 0; i < lon.length; i += step) {
      const [tx, ty] = lonLatToTile(lon[i], lat[i], z);
      for (let dx = -b; dx <= b; dx++) for (let dy = -b; dy <= b; dy++) set.add((tx + dx) + '/' + (ty + dy));
    }
    for (const k of set) { const [x, y] = k.split('/'); out.push([z, +x, +y]); }
  }
  return out;
}

const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const selectedLayers = () => ['plan', 'ortho'].filter(k => $('lay-' + k).checked);

function updateEstimate() {
  if (!DATA) return;
  const keys = selectedLayers();
  if (!keys.length) { $('off-estimate').textContent = 'Sélectionnez au moins un fond de carte.'; $('btn-dl').disabled = true; return; }
  const n = corridorTiles(+$('zoom-max').value).length;
  const mb = keys.reduce((s, k) => s + n * BASEMAPS[k].avgKB, 0) / 1024;
  $('off-estimate').textContent = `≈ ${(n * keys.length).toLocaleString('fr-FR')} tuiles, environ ${Math.round(mb)} Mo.`;
  $('btn-dl').disabled = false;
}

let dlAbort = null;

async function downloadTiles() {
  const keys = selectedLayers();
  const maxZoom = +$('zoom-max').value;
  const tiles = corridorTiles(maxZoom);
  const jobs = [];
  for (const k of keys) for (const [z, x, y] of tiles) jobs.push(tileUrl(BASEMAPS[k].url, z, x, y));

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const cache = await caches.open(TILE_CACHE);
  dlAbort = new AbortController();
  const bar = $('off-progress');
  bar.max = jobs.length; bar.value = 0;
  bar.classList.remove('hidden');
  $('btn-dl').classList.add('hidden');
  $('btn-dl-cancel').classList.remove('hidden');
  $('btn-clear').disabled = true;

  let done = 0, failed = 0, next = 0;
  const worker = async () => {
    while (next < jobs.length && !dlAbort.signal.aborted) {
      const url = jobs[next++];
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors', signal: dlAbort.signal });
          if (res.status === 404) { done++; continue; }   // tuile inexistante : rien à stocker
          if (!res.ok) throw new Error(res.status);
          await cache.put(url, res);
        }
      } catch (e) {
        if (!dlAbort.signal.aborted) failed++;
      }
      done++;
      if (done % 10 === 0 || done === jobs.length) {
        bar.value = done;
        $('off-status').textContent = `${done.toLocaleString('fr-FR')} / ${jobs.length.toLocaleString('fr-FR')} tuiles`;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const aborted = dlAbort.signal.aborted;
  dlAbort = null;
  bar.classList.add('hidden');
  $('btn-dl').classList.remove('hidden');
  $('btn-dl-cancel').classList.add('hidden');
  $('btn-clear').disabled = false;

  if (aborted) {
    $('off-status').textContent = 'Téléchargement interrompu (les tuiles déjà reçues sont conservées).';
  } else if (failed) {
    $('off-status').textContent = `Terminé, mais ${failed} tuile(s) ont échoué. Relancez pour compléter.`;
  } else {
    const maxes = store.get('offMax', {});
    keys.forEach(k => { maxes[k] = Math.max(maxes[k] || 0, maxZoom); });
    store.set('offMax', maxes);
    $('off-status').textContent = '✓ Cartes téléchargées : le parcours est utilisable sans réseau.';
  }
  refreshOfflineInfo();
}

async function clearTiles() {
  if (!confirm('Supprimer toutes les cartes téléchargées ?')) return;
  await caches.delete(TILE_CACHE);
  store.set('offMax', {});
  applyZoomMode();
  $('off-status').textContent = 'Cartes supprimées.';
  refreshOfflineInfo();
}

async function refreshOfflineInfo() {
  let appMsg = '⏳ Mise en cache de l\'application…';
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) appMsg = '✓ Application disponible hors ligne.';
  } else {
    appMsg = '⚠️ Ce navigateur ne gère pas le mode hors ligne.';
  }
  let tilesMsg = '';
  if ('caches' in window && await caches.has(TILE_CACHE)) {
    const n = (await (await caches.open(TILE_CACHE)).keys()).length;
    if (n) tilesMsg = ` ${n.toLocaleString('fr-FR')} tuiles de carte en mémoire.`;
  }
  $('off-app').textContent = appMsg + tilesMsg;
}

const dlg = $('dlg-offline');
$('btn-offline').addEventListener('click', () => { dlg.showModal(); refreshOfflineInfo(); updateEstimate(); });
['lay-plan', 'lay-ortho', 'zoom-max'].forEach(id => $(id).addEventListener('change', updateEstimate));
$('btn-dl').addEventListener('click', () => { $('off-status').textContent = ''; downloadTiles(); });
$('btn-dl-cancel').addEventListener('click', () => dlAbort && dlAbort.abort());
$('btn-clear').addEventListener('click', clearTiles);

/* ---------------------------------------------------------------------
   8. PWA : service worker + installation
   --------------------------------------------------------------------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  $('btn-install').classList.remove('hidden');
});
$('btn-install').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('btn-install').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('Service worker :', err));
  });
}

loadData().catch(err => {
  console.error(err);
  toast('Impossible de charger les données du parcours.', 8000);
});
