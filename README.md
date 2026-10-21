# Rando Haut-Allier

Application web installable (PWA) pour une boucle de 86,4 km autour de Monistrol-d'Allier (Haute-Loire),
par le GR470 (gorges de l'Allier), le GR70, le GR40 (Tour du Velay) et le GR65 (Saint-Jacques) :
carte, profil topographique par étapes, **point de départ réglable**, géolocalisation et
**fonctionnement 100 % hors ligne**.

> Le dépôt s'appelle encore `Rando-Val-d-Escreins` : l'application a d'abord servi pour une boucle dans le Queyras.

## Fonctionnalités

- **Carte** Leaflet : Plan IGN, photo aérienne IGN, OpenStreetMap (en ligne). Tracé coloré par étape, repères tous les 5 km,
  villages, hébergements, lacs et cours d'eau (noms OpenStreetMap). Toucher un lieu affiche son kilomètre et son altitude.
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

## Chiffres de la boucle (départ Monistrol-d'Allier, 3 étapes)

| Étape | Arrivée | Distance 3D | D+ | D− | Marche (DIN) |
|---|---|---|---|---|---|
| J1 | Saint-Vénérand | 28,7 km | 1 619 m | 1 233 m | ≈ 11 h 30 |
| J2 | Le Bouchet-Saint-Nicolas | 28,9 km | 1 020 m | 817 m | ≈ 9 h 45 |
| J3 | Monistrol-d'Allier | 28,8 km | 675 m | 1 265 m | ≈ 9 h 30 |
| **Total** | | **86,4 km** | **3 314 m** | **3 314 m** | **≈ 30 h 45** |

Temps de marche : méthode DIN 33466 (4 km/h à plat, 300 m/h en montée, 500 m/h en descente), pauses non comprises.
Altitudes : MNT échantillonné en bilinéaire, lissé sur 50 m pour retirer le bruit du MNT (sans lissage, le D+ monte à environ 4 000 m).
La boucle est fermée par un raccord de 330 m en ligne droite entre la fin du GR65 et le début du GR470, près de Monistrol-d'Allier.

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

Les données viennent de la boucle (GeoPackage, EPSG:2154, couche `boucle`), du MNT (EPSG:2154) et de `tools/poi.csv`.

```bash
pip install geopandas pyproj numpy rasterio shapely
python tools/build_data.py rando_temp_boucle.gpkg mnt.tif   # régénère data/parcours.json
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
