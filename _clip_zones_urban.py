# -*- coding: utf-8 -*-
"""
Clip DMQ zone polygons to the actual urban built-up footprint.

Why: the parish (admin) boundaries extend into mountains/farmland (Pichincha
slopes west, rural east). The user wants zones to cover the CITY only, not
empty non-city territory, and to fill small internal gaps (parks, the Sangolqui
notch) so the populated area is fully colored.

How: fetch OSM landuse=residential/commercial/industrial/retail in the DMQ bbox,
union into an "urban mask", buffer it (connect blocks + fill holes), then
intersect each zone with the mask. Result hugs the built-up area cleanly.
"""
import json, requests, sys
from shapely.geometry import shape, Polygon, MultiPolygon, mapping, LineString, MultiLineString
from shapely.ops import unary_union, polygonize
from datetime import date

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "emaseo-zone-clip/1.0 (academic)"}

# DMQ urban bbox (S, W, N, E)
BBOX = (-0.45, -78.62, -0.02, -78.35)

ZONE_CODES = {
    "Calderón": "ZN-CALDERON", "Eloy Alfaro": "ZN-ELOY-ALFARO",
    "Eugenio Espejo": "ZN-EUGENIO-ESPEJO", "La Delicia": "ZN-LA-DELICIA",
    "Los Chillos": "ZN-LOS-CHILLOS", "Manuela Sáenz": "ZN-MANUELA-SAENZ",
    "Quitumbe": "ZN-QUITUMBE", "Tumbaco": "ZN-TUMBACO",
}


def fetch(query):
    for url in OVERPASS_SERVERS:
        try:
            print("Querying %s..." % url, file=sys.stderr)
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=180)
            r.raise_for_status()
            return r.json().get("elements", [])
        except Exception as e:
            print("  failed: %s" % e, file=sys.stderr)
    return []


def way_to_poly(el):
    if "geometry" not in el:
        return None
    coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
    if len(coords) < 4:
        return None
    try:
        p = Polygon(coords)
        if not p.is_valid:
            p = p.buffer(0)
        return p if (not p.is_empty and p.is_valid) else None
    except Exception:
        return None


def rel_to_poly(el):
    outer = []
    for m in el.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        coords = [(p["lon"], p["lat"]) for p in m["geometry"]]
        if len(coords) >= 2 and m.get("role") in ("outer", ""):
            outer.append(LineString(coords))
    if not outer:
        return None
    try:
        merged = unary_union(outer)  # nodes the segments
        if merged.geom_type == "LineString":
            merged = MultiLineString([merged])
        polys = [p for p in polygonize(merged) if p.is_valid and not p.is_empty]
        return unary_union(polys) if polys else None
    except Exception:
        return None


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
    # 1. Load current zones
    with open("Backend/database/dmq_zones.geojson", encoding="utf-8") as f:
        fc = json.load(f)
    zones = {feat["properties"]["nombre"]: shape(feat["geometry"]) for feat in fc["features"]}
    print("Loaded %d zones" % len(zones), file=sys.stderr)

    # 2. Fetch urban landuse
    s, w, n, e = BBOX
    query = (
        "[out:json][timeout:180];("
        'way["landuse"~"residential|commercial|industrial|retail"](%f,%f,%f,%f);'
        'relation["landuse"~"residential|commercial|industrial|retail"](%f,%f,%f,%f);'
        ");out geom;" % (s, w, n, e, s, w, n, e)
    )
    els = fetch(query)
    print("Fetched %d landuse elements" % len(els), file=sys.stderr)

    polys = []
    for el in els:
        g = way_to_poly(el) if el.get("type") == "way" else rel_to_poly(el)
        if g is not None and not g.is_empty:
            polys.append(g)
    print("Valid landuse polygons: %d" % len(polys), file=sys.stderr)

    if len(polys) < 50:
        print("Too few landuse polygons, aborting (Overpass issue?)", file=sys.stderr)
        sys.exit(1)

    # 3. Urban mask: union + buffer to connect blocks & fill holes, then pull back.
    #    Buffer grande (+0.009deg ~1km) fusiona barrios/parques/quebradas en blobs
    #    contiguos suaves estilo Uber; -0.005 (~550m) recorta el exceso. Net +450m:
    #    footprint suave que cubre el valle poblado sin las montanas lejanas.
    urban = unary_union([p.buffer(0) for p in polys])
    urban = urban.buffer(0.009).buffer(-0.005)
    urban = urban.buffer(0)
    # Rellenar huecos internos (parques, lotes) para zonas solidas
    urban = unary_union([
        Polygon(g.exterior) if g.geom_type == "Polygon" else g
        for g in (urban.geoms if urban.geom_type == "MultiPolygon" else [urban])
    ])
    print("Urban mask area ~%.0f km2" % (urban.area * (111320**2) / 1e6), file=sys.stderr)

    def poly_parts(g):
        if g.is_empty:
            return []
        t = g.geom_type
        if t == "Polygon":
            return [g]
        if t in ("MultiPolygon", "GeometryCollection"):
            out = []
            for sub in g.geoms:
                out += poly_parts(sub)
            return out
        return []

    # 4. Clip each zone, keep significant parts (>0.15 km2 ~ 1.2e-5 deg2)
    clipped = {}
    for name, zgeom in zones.items():
        zg = zgeom.buffer(0)
        inter = zg.intersection(urban)
        parts = [p for p in poly_parts(inter) if p.area > 1.2e-5]
        if not parts:
            print("  %-16s: clip vacio, conserva original" % name, file=sys.stderr)
            clipped[name] = zg
            continue
        result = unary_union(parts).buffer(0)
        clipped[name] = result
        before = zg.area * (111320**2) / 1e6
        after = result.area * (111320**2) / 1e6
        nparts = len(result.geoms) if result.geom_type == "MultiPolygon" else 1
        print("  %-16s: %.0f -> %.0f km2 (%d parts)" % (name, before, after, nparts), file=sys.stderr)

    # 5. Emit migration 054
    lines = [
        "-- =========================================================================",
        "-- Migration 054: Zonas DMQ recortadas al area urbana construida (OSM landuse)",
        "-- Clip de zonas a residential/commercial/industrial/retail bufferizado.",
        "-- Quita laderas/montana/campo; rellena huecos internos. Reemplaza 053.",
        "-- Generado por _clip_zones_urban.py — " + date.today().isoformat(),
        "-- =========================================================================",
        "",
        "BEGIN;",
        "",
        "ALTER TABLE operations.zones",
        "  ALTER COLUMN geom TYPE geometry(Geometry, 4326) USING ST_SetSRID(geom, 4326);",
        "",
        "DELETE FROM operations.zones;",
        "",
        "INSERT INTO operations.zones (codigo, nombre, geom, activa)",
        "VALUES",
    ]
    inserts = []
    for name in sorted(clipped):
        codigo = ZONE_CODES[name]
        nombre = name.replace("'", "''")
        gjson = gj(clipped[name]).replace("'", "''")
        inserts.append(
            "  ('" + codigo + "', '" + nombre + "',\n"
            "   ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('" + gjson + "'), 4326)),\n"
            "   true)"
        )
    lines.append(",\n\n".join(inserts) + ";")
    lines += [
        "",
        "UPDATE operations.zones SET geom = ST_Multi(ST_CollectionExtract(geom, 3))",
        "  WHERE ST_GeometryType(geom) = 'ST_GeometryCollection';",
        "",
        "UPDATE incidents.incidents i SET zona_id = (",
        "  SELECT z.id FROM operations.zones z",
        "  WHERE ST_Within(i.ubicacion::geometry, z.geom) AND z.activa = TRUE",
        "  ORDER BY z.id LIMIT 1) WHERE i.ubicacion IS NOT NULL;",
        "UPDATE incidents.incidents i SET zona_id = (",
        "  SELECT z.id FROM operations.zones z WHERE z.activa = TRUE",
        "  ORDER BY ST_Distance(i.ubicacion::geography, z.geom::geography) LIMIT 1)",
        "  WHERE zona_id IS NULL AND i.ubicacion IS NOT NULL;",
        "",
        "SELECT codigo, nombre, ROUND((ST_Area(geom::geography)/1e6)::numeric,1) AS km2,",
        "  ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS tipo",
        "FROM operations.zones ORDER BY nombre;",
        "",
        "COMMIT;",
    ]
    sql = "\n".join(lines)
    with open("Backend/database/054_zones_urban_clip.sql", "w", encoding="utf-8") as f:
        f.write(sql)
    print("\n[OK] Backend/database/054_zones_urban_clip.sql (%d bytes)" % len(sql), file=sys.stderr)

    out_fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"codigo": ZONE_CODES[n], "nombre": n},
         "geometry": json.loads(gj(g))} for n, g in sorted(clipped.items())]}
    with open("Backend/database/dmq_zones.geojson", "w", encoding="utf-8") as f:
        json.dump(out_fc, f, ensure_ascii=False)
    print("[OK] Backend/database/dmq_zones.geojson", file=sys.stderr)


if __name__ == "__main__":
    main()
