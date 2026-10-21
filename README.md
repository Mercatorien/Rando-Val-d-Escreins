# Rando Tour du Tanargue

Application web installable (PWA) pour le Tour du Tanargue (Ardèche), une boucle de 62,4 km
au départ de Largentière, par le col de Meyrand, le col des Langoustines et le col du Merle :
carte, profil topographique par étapes (masquable), **point de départ réglable**, géolocalisation et
**fonctionnement 100 % hors ligne**.

> Le dépôt s'appelle encore `Rando-Val-d-Escreins` : l'application a d'abord servi pour une boucle dans le Queyras.

## Fonctionnalités

- **Carte** Leaflet : Plan IGN, photo aérienne IGN, OpenStreetMap (en ligne). Tracé coloré par étape, repères tous les 5 km,
  villages, hébergements, lacs et cours d'eau (noms OpenStreetMap). Toucher un lieu affiche son kilomètre et son altitude.
- **Profil topographique** (Chart.js) coloré par étape, avec les noms des lieux, les fins d'étape et les cours d'eau traversés.
  Toucher le profil place le point sur la carte, toucher le tracé place le curseur sur le profil.
  Le bouton **⛰** (ou **▾** dans le panneau) masque le profil pour donner tout l'écran à la carte ; le choix est mémorisé.
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

## Chiffres de la boucle (départ Largentière, 3 étapes)

| Étape | Arrivée | Distance 3D | D+ | D− | Marche (DIN) |
|---|---|---|---|---|---|
| J1 | La Roche | 14,6 km | 1 114 m | 775 m | ≈ 7 h |
| J2 | Loubaresse | 14,1 km | 1 042 m | 400 m | ≈ 6 h |
| J3 | Largentière | 33,8 km | 1 199 m | 2 181 m | ≈ 12 h 30 |
| **Total** | | **62,4 km** | **3 356 m** | **3 356 m** | **≈ 25 h 45** |

Entre Loubaresse (km 28) et Joannas (km 56), OpenStreetMap ne signale aucun hébergement le long du tracé :
la dernière étape est donc longue. En 4 étapes, l'application propose un autre découpage.

Temps de marche : méthode DIN 33466 (4 km/h à plat, 300 m/h en montée, 500 m/h en descente), pauses non comprises.
Altitudes : MNT échantillonné en bilinéaire, lissé sur 50 m pour retirer le bruit du MNT.
La boucle est fermée par un raccord de 121 m en ligne droite à Largentière.

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

Les caches et le stockage local portent le préfixe `escreins` (historique) : l'application cohabite avec les autres
applications publiées sur le même domaine `github.io`.

## Test en local

```bash
python -m http.server 8080
# puis http://localhost:8080
```

## Mettre à jour le parcours

Les données viennent de la boucle (GeoPackage, EPSG:2154, couche `boucle` ou première couche), du MNT (EPSG:2154) et de `tools/poi.csv`.
Le nom du parcours est `ROUTE_NAME` en tête de `tools/build_data.py`.

```bash
pip install geopandas pyproj numpy rasterio shapely
python tools/build_data.py ligne_3d_fusion.gpkg mnt.tif   # régénère data/parcours.json
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
