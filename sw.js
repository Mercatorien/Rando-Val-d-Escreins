'use strict';

// Incrémenter VERSION à chaque modification des fichiers de l'application.
const VERSION = 'v3';
// Préfixe propre à l'application : le domaine GitHub Pages est partagé avec d'autres applications.
const APP = 'escreins';
const SHELL_CACHE = APP + '-shell-' + VERSION;
const TILE_CACHE = APP + '-tiles-v1';   // rempli par app.js (bouton « Télécharger »)

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'data/parcours.json',
  'lib/leaflet.js',
  'lib/leaflet.css',
  'lib/chart.umd.js',
  'lib/images/layers.png',
  'lib/images/layers-2x.png',
  'lib/images/marker-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const TILE_HOSTS = ['data.geopf.fr', 'tile.openstreetmap.org'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(APP + '-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles de carte : cache d'abord (téléchargées à l'avance), sinon réseau
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE)
        .then(c => c.match(req.url))
        .then(hit => hit || fetch(req))
        .catch(() => new Response('', { status: 504 }))
    );
    return;
  }

  // Fichiers de l'application : cache d'abord, repli sur le réseau
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => {
        if (hit) return hit;
        return fetch(req).catch(() =>
          req.mode === 'navigate' ? caches.match('index.html') : new Response('', { status: 504 })
        );
      })
    );
  }
});
