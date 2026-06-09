# -*- coding: utf-8 -*-
"""
Build clean DMQ zone polygons from a SINGLE source (OpenStreetMap).

Key insight vs old script:
- Urban parishes = admin_level=9 in OSM
- Rural parishes = admin_level=8 in OSM
- BOTH from OSM -> shared node topology -> unary_union is clean (NO slivers)
- The old script mixed a GitHub gist (urban) + Overpass (rural) with different
  coordinate precision, producing slivers and triangular artifacts.

Scope: urban core + Calderon + Los Chillos valley + Tumbaco valley + NW urban.
Excludes remote cloud-forest noroccidente parishes (no EMASEO operations there).
"""
import json, requests, sys
from shapely.geometry import shape, Polygon, MultiPolygon, mapping, LineString
from shapely.ops import unary_union, linemerge, polygonize
from datetime import date

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "emaseo-zone-builder/2.0 (academic)"}

# Urban parishes (admin_level=9) -> zone
URBAN_TO_ZONE = {
    89703:  "Manuela Saenz", 90094: "Manuela Saenz", 89788: "Manuela Saenz",
    89692:  "Manuela Saenz", 89519: "Manuela Saenz",
    89488:  "Eloy Alfaro", 89682: "Eloy Alfaro", 89209: "Eloy Alfaro",
    89199:  "Eloy Alfaro", 89196: "Eloy Alfaro", 89165: "Eloy Alfaro",
    89515:  "Eloy Alfaro", 89179: "Eloy Alfaro",
    90095:  "Quitumbe", 89097: "Quitumbe", 89212: "Quitumbe",
    89246:  "Quitumbe", 89234: "Quitumbe",
    89717:  "Eugenio Espejo", 89816: "Eugenio Espejo", 12114828: "Eugenio Espejo",
    89754:  "Eugenio Espejo", 90044: "Eugenio Espejo", 89989: "Eugenio Espejo",
    6135201:"Eugenio Espejo", 90050: "Eugenio Espejo", 90083: "Eugenio Espejo",
    90065:  "La Delicia", 90068: "La Delicia", 90081: "La Delicia",
    90014:  "La Delicia", 90084: "La Delicia",
}

# Rural parishes (admin_level=8) -> zone (near-valley / peri-urban only)
RURAL_TO_ZONE = {
    2673275: "Los Chillos", 2673303: "Los Chillos", 2673274: "Los Chillos",
    2673245: "Los Chillos", 2673247: "Los Chillos", 8009658: "Los Chillos",
    2673304: "Tumbaco", 2673307: "Tumbaco", 2673409: "Tumbaco",
    2673246: "Tumbaco", 2673415: "Tumbaco", 2673411: "Tumbaco",
    2673412: "Tumbaco", 2673416: "Tumbaco", 2673363: "Tumbaco",
    2673329: "Calderon", 2673318: "Calderon",
    2673310: "Eugenio Espejo", 2673315: "Eugenio Espejo",
    2673440: "La Delicia", 2673446: "La Delicia", 2673480: "La Delicia",
}

ZONE_CODES = {
    "Calderon": "ZN-CALDERON", "Eloy Alfaro": "ZN-ELOY-ALFARO",
    "Eugenio Espejo": "ZN-EUGENIO-ESPEJO", "La Delicia": "ZN-LA-DELICIA",
    "Los Chillos": "ZN-LOS-CHILLOS", "Manuela Saenz": "ZN-MANUELA-SAENZ",
    "Quitumbe": "ZN-QUITUMBE", "Tumbaco": "ZN-TUMBACO",
}
ZONE_DISPLAY = {
    "Calderon": "Calderon", "Eloy Alfaro": "Eloy Alfaro",
    "Eugenio Espejo": "Eugenio Espejo", "La Delicia": "La Delicia",
    "Los Chillos": "Los Chillos", "Manuela Saenz": "Manuela Saenz",
    "Quitumbe": "Quitumbe", "Tumbaco": "Tumbaco",
}
# Display names with accents
ZONE_DISPLAY["Calderon"] = "Calderón"
ZONE_DISPLAY["Manuela Saenz"] = "Manuela Sáenz"


def fetch_geometries(rel_ids):
    ids = ",".join(str(i) for i in rel_ids)
    query = "[out:json][timeout:180];relation(id:" + ids + ");out geom;"
    for url in OVERPASS_SERVERS:
        try:
            print("Fetching %d relations from %s..." % (len(rel_ids), url), file=sys.stderr)
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=180)
            r.raise_for_status()
            return r.json().get("elements", [])
        except Exception as e:
            print("  failed: %s" % e, file=sys.stderr)
    return []


def relation_to_shape(rel):
    """Assemble OSM boundary relation member ways into polygons.

    OSM boundary members are LINE segments, not closed rings. We stitch them
    with linemerge, then polygonize to form closed areas. This is the correct
    way to build polygons from admin boundary relations (the naive
    Polygon(each-way) approach produces garbage fragments).
    """
    outer_lines, inner_lines = [], []
    for m in rel.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        coords = [(p["lon"], p["lat"]) for p in m["geometry"]]
        if len(coords) < 2:
            continue
        role = m.get("role", "outer")
        if role == "inner":
            inner_lines.append(LineString(coords))
        else:
            outer_lines.append(LineString(coords))
    if not outer_lines:
        return None

    def lines_to_polys(lines):
        if not lines:
            return []
        merged = linemerge(unary_union(lines))
        return [p for p in polygonize(merged) if p.is_valid and not p.is_empty]

    outer_polys = lines_to_polys(outer_lines)
    if not outer_polys:
        return None
    geom = unary_union(outer_polys)

    # Subtract holes if any
    inner_polys = lines_to_polys(inner_lines)
    if inner_polys:
        holes = unary_union(inner_polys)
        geom = geom.difference(holes)

    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom


def gj(geom):
    def rnd(o):
        if isinstance(o, list):
            return [rnd(x) for x in o]
        if isinstance(o, float):
            return round(o, 6)
        return o
    d = json.loads(json.dumps(mapping(geom)))
    d["coordinates"] = rnd(d["coordinates"])
    return json.dumps(d, separators=(",", ":"))


def main():
    all_ids = list(URBAN_TO_ZONE) + list(RURAL_TO_ZONE)
    id_to_zone = {}
    id_to_zone.update(URBAN_TO_ZONE)
    id_to_zone.update(RURAL_TO_ZONE)

    elements = fetch_geometries(all_ids)
    print("\nFetched %d relation geometries" % len(elements), file=sys.stderr)

    zone_polys = {}
    found = set()
    for el in elements:
        rid = el.get("id")
        if rid not in id_to_zone:
            continue
        geom = relation_to_shape(el)
        if geom is None or geom.is_empty:
            print("  [!] empty geom for rel/%s" % rid, file=sys.stderr)
            continue
        found.add(rid)
        zone_polys.setdefault(id_to_zone[rid], []).append(geom)

    missing = set(all_ids) - found
    if missing:
        print("  [!] missing: %s" % sorted(missing), file=sys.stderr)

    dissolved = {}
    for zone, geoms in zone_polys.items():
        union = unary_union([g.buffer(0.00003) for g in geoms]).buffer(-0.00003)
        union = union.buffer(0)
        if union.is_empty:
            union = unary_union(geoms).buffer(0)
        dissolved[zone] = union
        area = union.area * (111320 ** 2) / 1e6
        parts = len(union.geoms) if union.geom_type == "MultiPolygon" else 1
        print("  %-16s: %d parroquias -> %s (%d parts, ~%.0f km2)"
              % (zone, len(geoms), union.geom_type, parts, area), file=sys.stderr)

    lines = [
        "-- =========================================================================",
        "-- Migration 052: Zonas DMQ desde fuente unica OSM (sin slivers)",
        "-- Urbanas admin_level=9 + rurales admin_level=8, todas de OSM.",
        "-- Topologia consistente => unary_union limpio. Reemplaza migracion 051.",
        "-- Generado por _build_zones_v2.py — " + date.today().isoformat(),
        "-- =========================================================================",
        "",
        "BEGIN;",
        "",
        "ALTER TABLE operations.zones",
        "  ALTER COLUMN geom TYPE geometry(Geometry, 4326)",
        "  USING ST_SetSRID(geom, 4326);",
        "",
        "DELETE FROM operations.zones;",
        "",
        "INSERT INTO operations.zones (codigo, nombre, geom, activa)",
        "VALUES",
    ]
    inserts = []
    for zk in sorted(dissolved):
        geom = dissolved[zk]
        codigo = ZONE_CODES[zk]
        nombre = ZONE_DISPLAY[zk].replace("'", "''")
        gjson = gj(geom).replace("'", "''")
        inserts.append(
            "  ('" + codigo + "', '" + nombre + "',\n"
            "   ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('" + gjson + "'), 4326)),\n"
            "   true)"
        )
    lines.append(",\n\n".join(inserts) + ";")
    lines += [
        "",
        "UPDATE incidents.incidents i SET zona_id = (",
        "  SELECT z.id FROM operations.zones z",
        "  WHERE ST_Within(i.ubicacion::geometry, z.geom) AND z.activa = TRUE",
        "  ORDER BY z.id LIMIT 1)",
        "WHERE i.ubicacion IS NOT NULL;",
        "",
        "UPDATE incidents.incidents i SET zona_id = (",
        "  SELECT z.id FROM operations.zones z WHERE z.activa = TRUE",
        "  ORDER BY ST_Distance(i.ubicacion::geography, z.geom::geography) LIMIT 1)",
        "WHERE zona_id IS NULL AND i.ubicacion IS NOT NULL;",
        "",
        "SELECT codigo, nombre,",
        "  ROUND((ST_Area(geom::geography)/1e6)::numeric,1) AS area_km2,",
        "  ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS tipo",
        "FROM operations.zones ORDER BY nombre;",
        "",
        "COMMIT;",
    ]
    sql = "\n".join(lines)
    with open("Backend/database/052_zones_osm_clean.sql", "w", encoding="utf-8") as f:
        f.write(sql)
    print("\n[OK] Backend/database/052_zones_osm_clean.sql (%d bytes)" % len(sql), file=sys.stderr)

    # Also emit a geojson for inspection
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "properties": {"codigo": ZONE_CODES[k], "nombre": ZONE_DISPLAY[k]},
         "geometry": json.loads(gj(g))}
        for k, g in sorted(dissolved.items())
    ]}
    with open("Backend/database/dmq_zones.geojson", "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print("[OK] Backend/database/dmq_zones.geojson", file=sys.stderr)


if __name__ == "__main__":
    main()
