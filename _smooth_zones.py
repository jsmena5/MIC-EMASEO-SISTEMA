# -*- coding: utf-8 -*-
"""
Zonas DMQ suaves y SOLIDAS (estilo Uber), recortadas al area metropolitana.

Por que falla el clip por landuse (migracion 054): intersecta cada zona con la
union de poligonos landuse, que tiene HUECOS entre manzanas -> las zonas quedan
con huecos y fragmentadas (Los Chillos 7 partes, Calderon 4).

Enfoque correcto aqui:
1. Zonas administrativas (parroquias OSM unidas) = contiguas, sin huecos, comparten
   bordes -> NO generan gaps entre zonas.
2. ENVELOPE METROPOLITANO SOLIDO: union de landuse + buffer grande (fusiona todo en
   un solo blob) + RELLENAR TODOS LOS HUECOS -> footprint urbano solido y simple.
3. Por zona: cierre morfologico (rellena entrantes como el hueco de Sangolqui) ->
   interseccion con el envelope (recorta montana/Pichincha) -> rellenar huecos.
Resultado: zonas solidas, contiguas, sin huecos, recortadas al borde urbano.
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
HEADERS = {"User-Agent": "emaseo-zone-smooth/1.0 (academic)"}
BBOX = (-0.45, -78.62, -0.02, -78.35)  # S, W, N, E

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
        return p.buffer(0) if not p.is_valid else p
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
        merged = unary_union(outer)
        if merged.geom_type == "LineString":
            merged = MultiLineString([merged])
        polys = [p for p in polygonize(merged) if p.is_valid and not p.is_empty]
        return unary_union(polys) if polys else None
    except Exception:
        return None


def fill_holes(g):
    """Devuelve la geometria sin huecos interiores (solido)."""
    if g.is_empty:
        return g
    t = g.geom_type
    if t == "Polygon":
        return Polygon(g.exterior)
    if t == "MultiPolygon":
        return unary_union([Polygon(p.exterior) for p in g.geoms])
    if t == "GeometryCollection":
        polys = [s for s in g.geoms if s.geom_type in ("Polygon", "MultiPolygon")]
        return fill_holes(unary_union(polys)) if polys else g
    return g


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
    # 1. Zonas administrativas fuente
    with open("Backend/database/dmq_zones.geojson", encoding="utf-8") as f:
        fc = json.load(f)
    zones = {feat["properties"]["nombre"]: shape(feat["geometry"]).buffer(0)
             for feat in fc["features"]}
    print("Zonas fuente: %d" % len(zones), file=sys.stderr)

    # 2. Landuse -> envelope metropolitano SOLIDO
    s, w, n, e = BBOX
    q = ("[out:json][timeout:180];("
         'way["landuse"~"residential|commercial|industrial|retail"](%f,%f,%f,%f);'
         'relation["landuse"~"residential|commercial|industrial|retail"](%f,%f,%f,%f);'
         ");out geom;" % (s, w, n, e, s, w, n, e))
    els = fetch(q)
    polys = []
    for el in els:
        g = way_to_poly(el) if el.get("type") == "way" else rel_to_poly(el)
        if g is not None and not g.is_empty:
            polys.append(g)
    print("Landuse polygons: %d" % len(polys), file=sys.stderr)
    if len(polys) < 100:
        print("Pocos landuse, abortando", file=sys.stderr)
        sys.exit(1)

    base = unary_union(polys)
    # buffer grande para fusionar TODO en pocos blobs solidos; pull back parcial
    envelope = base.buffer(0.020).buffer(-0.012)   # net +0.008deg (~890m)
    envelope = fill_holes(envelope.buffer(0))
    env_parts = poly_parts(envelope)
    env_area = sum(p.area for p in env_parts) * (111320**2) / 1e6
    print("Envelope: %d blobs solidos, ~%.0f km2" % (len(env_parts), env_area), file=sys.stderr)

    # 3. Por zona: cierre morfologico -> clip al envelope -> resolver solapes.
    #    El cierre expande cada zona; para evitar solapes restamos (a) el territorio
    #    ADMINISTRATIVO de las otras zonas y (b) lo ya reclamado. Asi el relleno solo
    #    ocupa tierra de nadie (hueco de Sangolqui, quebradas) sin pisar vecinos.
    #    Orden: nucleos urbanos primero, valles al final.
    order = ["Manuela Sáenz", "Eloy Alfaro", "Quitumbe", "Eugenio Espejo",
             "La Delicia", "Calderón", "Tumbaco", "Los Chillos"]
    order = [n for n in order if n in zones] + [n for n in zones if n not in order]

    clipped = {}
    claimed = None  # union de lo ya asignado
    for name in order:
        z = zones[name]
        closed = fill_holes(z.buffer(0.008).buffer(-0.008).buffer(0))
        inter = fill_holes(closed.intersection(envelope))
        # restar territorio administrativo de las demas zonas
        others = unary_union([zones[o] for o in zones if o != name])
        final = inter.difference(others)
        if claimed is not None and not claimed.is_empty:
            final = final.difference(claimed)
        final = final.buffer(0)
        parts = [p for p in poly_parts(final) if p.area > 2.5e-5]  # >~0.3 km2
        if not parts:
            parts = poly_parts(final)
        result = fill_holes(unary_union(parts).buffer(0))
        clipped[name] = result
        claimed = result if claimed is None else unary_union([claimed, result]).buffer(0)
        before = z.area * (111320**2) / 1e6
        after = result.area * (111320**2) / 1e6
        nparts = len(poly_parts(result))
        print("  %-16s: %.0f -> %.0f km2 (%d parts)" % (name, before, after, nparts), file=sys.stderr)

    # 4. Migration 055
    lines = [
        "-- =========================================================================",
        "-- Migration 055: Zonas DMQ solidas y suaves recortadas al area metropolitana",
        "-- Envelope urbano SOLIDO (landuse buffer+fill) ∩ zonas con cierre morfologico.",
        "-- Sin huecos, sin fragmentos sueltos, recortadas a la ciudad. Reemplaza 054.",
        "-- Generado por _smooth_zones.py — " + date.today().isoformat(),
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
    with open("Backend/database/055_zones_smooth.sql", "w", encoding="utf-8") as f:
        f.write(sql)
    print("\n[OK] Backend/database/055_zones_smooth.sql (%d bytes)" % len(sql), file=sys.stderr)

    out = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"codigo": ZONE_CODES[n], "nombre": n},
         "geometry": json.loads(gj(g))} for n, g in sorted(clipped.items())]}
    with open("Backend/database/dmq_zones.geojson", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("[OK] dmq_zones.geojson", file=sys.stderr)


if __name__ == "__main__":
    main()
