"""Génère data/parcours.json à partir de la boucle (GeoPackage, EPSG:2154), du MNT et des points d'intérêt.

Usage :
    python tools/build_data.py ligne_3d_fusion.gpkg mnt.tif

- couche lignes : la boucle (une ou plusieurs lignes qui se raccordent), couche `boucle` ou à défaut
  la première couche du fichier ; un trou de moins de CLOSE_MAX_M entre l'arrivée et le départ
  est refermé par une ligne droite
- mnt.tif       : MNT en EPSG:2154, échantillonné en bilinéaire sur chaque sommet
- tools/poi.csv : points d'intérêt (nom, type, lon, lat, hebergement, info) ; la ligne de type
  `depart` fixe le départ par défaut, `hebergement = 1` marque les lieux où une étape
  peut finir (l'application y choisit les fins d'étape)
"""
import csv
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import shapely
from pyproj import Geod, Transformer
from shapely.geometry import LineString, Point
from shapely.ops import linemerge

ROUTE_NAME = "Tour du Tanargue"
LINE_LAYER = "boucle"   # couche de lignes dans le GeoPackage (sinon : la première couche)
CLOSE_MAX_M = 200       # trou maximal refermé automatiquement entre l'arrivée et le départ
DENSIFY_M = 20          # écart maximal entre deux points du profil
SMOOTH_M = 50           # lissage de l'altitude (fenêtre glissante, en m) contre le bruit du MNT
POI_MAX_M = 500         # un point d'intérêt plus loin du tracé est ignoré

ROOT = Path(__file__).resolve().parent.parent


def bilinear(src, band, x, y):
    r, c = rasterio.transform.rowcol(src.transform, x, y, op=lambda v: v)
    r = np.asarray(r) - 0.5
    c = np.asarray(c) - 0.5
    r0, c0 = np.floor(r).astype(int), np.floor(c).astype(int)
    fr, fc = r - r0, c - c0
    return (band[r0, c0] * (1 - fr) * (1 - fc) + band[r0, c0 + 1] * (1 - fr) * fc
            + band[r0 + 1, c0] * fr * (1 - fc) + band[r0 + 1, c0 + 1] * fr * fc)


def read_loop(path):
    layers = gpd.list_layers(path)["name"].tolist()
    lines = gpd.read_file(path, layer=LINE_LAYER if LINE_LAYER in layers else layers[0])
    assert lines.crs.to_epsg() == 2154, "la couche de lignes doit être en EPSG:2154"
    line = linemerge(shapely.force_2d(shapely.MultiLineString(
        [g for geom in lines.geometry for g in getattr(geom, "geoms", [geom])])))
    assert line.geom_type == "LineString", "les lignes ne forment pas un tracé continu"
    gap = Point(line.coords[0]).distance(Point(line.coords[-1]))
    assert gap < CLOSE_MAX_M, f"la boucle n'est pas fermée (trou de {gap:.0f} m)"
    if gap > 0:
        print(f"boucle refermée : raccord de {gap:.0f} m en ligne droite")
        line = LineString(list(line.coords) + [line.coords[0]])
    return line


def read_poi(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main(line_path, dem_path, out_path):
    to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)
    to_wgs = Transformer.from_crs(2154, 4326, always_xy=True)
    geod = Geod(ellps="GRS80")

    line = read_loop(line_path)
    pois = read_poi(ROOT / "tools" / "poi.csv")

    # --- départ par défaut : le sommet le plus proche du point « depart » ---
    dep = next(p for p in pois if p["type"] == "depart")
    start = Point(to_l93.transform(float(dep["lon"]), float(dep["lat"])))
    coords = list(line.coords)[:-1]
    k = int(np.argmin([start.distance(Point(c)) for c in coords]))
    line = LineString(coords[k:] + coords[:k] + [coords[k]])

    # --- profil : sommets densifiés, altitude MNT lissée, distance 3D cumulée ---
    xy = np.array(shapely.segmentize(line, DENSIFY_M).coords)
    with rasterio.open(dem_path) as src:
        assert src.crs.to_epsg() == 2154, "le MNT doit être en EPSG:2154"
        band = src.read(1).astype(float)
        if src.nodata is not None:
            band[band == src.nodata] = np.nan
        z_raw = bilinear(src, band, xy[:, 0], xy[:, 1])
    assert not np.isnan(z_raw).any(), "le tracé sort du MNT"

    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
    L = s[-1]
    ss = np.concatenate([s[:-1] - L, s[:-1], s[:-1] + L])          # boucle : lissage circulaire
    cz = np.concatenate([[0], np.cumsum(np.tile(z_raw[:-1], 3))])
    i0 = np.searchsorted(ss, s - SMOOTH_M / 2)
    i1 = np.searchsorted(ss, s + SMOOTH_M / 2, side="right")
    alt = (cz[i1] - cz[i0]) / (i1 - i0)

    lon, lat = to_wgs.transform(xy[:, 0], xy[:, 1])
    d2 = np.array(geod.inv(lon[:-1], lat[:-1], lon[1:], lat[1:])[2])
    dz = np.diff(alt)
    d3 = np.sqrt(d2 ** 2 + dz ** 2)
    cum = np.concatenate([[0], np.cumsum(d3)]) / 1000
    cum_h = np.concatenate([[0], np.cumsum(d2)]) / 1000

    # --- points d'intérêt : position le long de la boucle (km 3D) ---
    out_poi = []
    for p in pois:
        pt = Point(to_l93.transform(float(p["lon"]), float(p["lat"])))
        if line.distance(pt) > POI_MAX_M:
            print("ignoré (trop loin du tracé) :", p["nom"])
            continue
        km = 0.0 if p["type"] == "depart" else float(np.interp(line.project(pt), s, cum))
        item = {"name": p["nom"], "type": p["type"], "km": round(km, 3),
                "lon": float(p["lon"]), "lat": float(p["lat"]), "lodging": p["hebergement"] == "1"}
        if p.get("info"):
            item["info"] = p["info"]
        out_poi.append(item)
    out_poi.sort(key=lambda p: p["km"])

    r = lambda a, n: [round(float(v), n) for v in a]
    data = {
        "name": ROUTE_NAME,
        "loop": True,
        "totalKm": round(float(cum[-1]), 3),
        "horizontalKm": round(float(cum_h[-1]), 3),
        "dplus": round(float(dz[dz > 0].sum())),
        "dminus": round(float(-dz[dz < 0].sum())),
        "altMin": int(alt.min()),
        "altMax": int(np.ceil(alt.max())),
        "smoothM": SMOOTH_M,
        "profile": {   # points de la boucle, le dernier = le premier ; d = distance 3D cumulée (km)
            "d": r(cum, 4),
            "h": r(cum_h, 4),
            "alt": r(alt, 1),
            "lon": r(lon, 6),
            "lat": r(lat, 6),
        },
        "poi": out_poi,
    }
    Path(out_path).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{out_path} : {len(cum)} points, {data['totalKm']} km (3D), {data['horizontalKm']} km (2D), "
          f"D+ {data['dplus']} m, D- {data['dminus']} m, {len(out_poi)} points d'intérêt")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    out = ROOT / "data" / "parcours.json"
    out.parent.mkdir(exist_ok=True)
    main(sys.argv[1], sys.argv[2], out)
