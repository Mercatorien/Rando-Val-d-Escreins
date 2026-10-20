# Rando Val d'Escreins

Application web installable (PWA) pour une boucle de 77,9 km dans le Queyras et la haute Ubaye
(Guillestre, Furfande, Bramousse, Ceillac, col Girardin, col des Houerts, Val d'Escreins) :
carte, profil topographique par étapes, **point de départ réglable**, géolocalisation et
**fonctionnement 100 % hors ligne**.

## Fonctionnalités

- **Carte** Leaflet : Plan IGN, photo aérienne IGN, OpenStreetMap (en ligne). Tracé coloré par étape, repères tous les 5 km,
  cols, refuges, villages, lacs et cours d'eau (noms OpenStreetMap). Toucher un lieu affiche son kilomètre et son altitude.
- **Profil topographique** (Chart.js) coloré par étape, avec les noms des lieux, les fins d'étape et les cours d'eau traversés.
  Toucher le profil place le point sur la carte, toucher le tracé place le curseur sur le profil.
- **Chiffres clés** : distance 3D, D+, D−, altitudes, temps de marche, et le détail de chaque étape.
- **Point de départ réglable** (bouton **⚑**) : la boucle peut commencer n'importe où.
  - choisir un lieu dans la liste, toucher la carte, partir de sa position GPS, ou toucher le profil puis **⚑ Partir d'ici** ;
    on peut aussi partir d'un lieu depuis sa fenêtre sur la carte ;
  - le profil, les kilomètres, les repères, les chiffres clés et les étapes sont recalculés depuis ce point ;
  - les fins d'étape sont choisies parmi les hébergements, pour que la plus longue journée soit la plus courte possible ;
  - le nombre d'étapes (1 à 6 jours) se règle dans la même fenêtre ;
  - le choix est mémorisé sur le téléphone.
- **Géolocalisation** : position, trace du parcours effectué, puis altitude, km parcourus et restants, D+ restant,
  % d'avancement depuis le départ choisi, alerte « hors sentier » (> 50 m) avec vibration. L'écran reste allumé pendant le suivi.
- **Hors ligne** : l'application (code, bibliothèques, données) est mise en cache à la première visite. Le bouton ⬇ télécharge
  les fonds de carte dans un couloir d'environ 1 km autour du tracé (à faire une fois, en Wi-Fi).

## Chiffres de la boucle (départ La Font d'Eygliers, 3 étapes)

| Étape | Arrivée | Distance 3D | D+ | D− | Marche (DIN) |
|---|---|---|---|---|---|
| J1 | Gîte Le Riou Vert (Bramousse) | 27,8 km | 2 578 m | 2 183 m | ≈ 16 h 15 |
| J2 | La Barge | 24,1 km | 2 145 m | 1 684 m | ≈ 13 h 30 |
| J3 | La Font d'Eygliers | 26,0 km | 1 455 m | 2 312 m | ≈ 12 h 45 |
| **Total** | | **77,9 km** | **6 178 m** | **6 178 m** | **≈ 42 h 30** |

Temps de marche : méthode DIN 33466 (4 km/h à plat, 300 m/h en montée, 500 m/h en descente), pauses non comprises.
Altitudes : MNT échantillonné en bilinéaire, lissé sur 50 m pour retirer le bruit du MNT (sans lissage, le D+ monte à environ 7 100 m).

## Utilisation

1. Ouvrir l'application en HTTPS (la géolocalisation et le mode hors ligne l'exigent) ; en local, `http://localhost` convient.
2. Bouton **⬇** → choisir les fonds de carte et le zoom maximum → **Télécharger**.
3. Installer l'application depuis le menu du navigateur (« Ajouter à l'écran d'accueil ») ou depuis la fenêtre ⬇.
4. Bouton **⚑** → choisir le point de départ et le nombre d'étapes.
5. Sur le terrain : **📍 Ma position**. En déplaçant la carte, le suivi cesse de la recentrer ; **◎** la recentre.

Hors ligne, la carte ne peut pas zoomer plus que le niveau téléchargé.

## Publier sur GitHub Pages

Dépôt → *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`.
Le site est alors servi en HTTPS à `https://<utilisateur>.github.io/<dépôt>/`.

Les caches et le stockage local portent le préfixe `escreins` : l'application cohabite avec les autres
applications publiées sur le même domaine `github.io`.

## Test en local

```bash
python -m http.server 8080
# puis http://localhost:8080
```

## Mettre à jour le parcours

Les données viennent de la boucle (GeoPackage, EPSG:2154, couche `boucle`), du MNT (EPSG:2154) et de `tools/poi.csv`.

```bash
pip install geopandas pyproj numpy rasterio shapely
python tools/build_data.py ligne_3d_sans_doublons.gpkg mnt.tif   # régénère data/parcours.json
```

`tools/poi.csv` liste les lieux affichés : `nom, type (depart, col, refuge, village, lac, eau), lon, lat, hebergement`.
La ligne `depart` fixe le départ par défaut ; `hebergement = 1` marque les lieux où une étape peut finir.
Les noms et positions viennent d'OpenStreetMap.

Après toute modification des fichiers de l'application, **incrémenter `VERSION` dans `sw.js`** pour que les
téléphones récupèrent la nouvelle version. `python tools/make_icons.py` régénère les icônes.

## Structure

```
index.html · style.css · app.js     application
sw.js · manifest.webmanifest        PWA (cache hors ligne, installation)
data/parcours.json                  boucle + profil (distance 3D et 2D, altitude) + points d'intérêt
lib/                                Leaflet et Chart.js embarqués (aucun CDN)
tools/                              génération des données, liste des lieux, icônes
```

Fonds de carte : © IGN (Géoplateforme), © contributeurs OpenStreetMap. Toponymes : © contributeurs OpenStreetMap (ODbL).
