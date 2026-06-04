"""
Build SQL migration 048 for DMQ Administraciones Zonales.

Strategy:
1. Fetch 28 urban parishes from GitHub Gist (has zone mapping property)
2. Fetch rural parish geometries from Overpass (by known relation IDs)
3. Merge urban + rural using hardcoded parroquia->zona mapping
4. Union polygons per zone using shapely
5. Generate 048_seed_zones_dmq.sql
"""
import json, requests
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

PARISHES_URL = (
    "https://gist.githubusercontent.com/emamut/d2f91f3b72196480ba3032b453145a0b"
    "/raw/ed966247bbb5cbe8de6b8db0d3872f85207e3eed/parroquias-pichincha.geojson"
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "emaseo-zone-builder/1.0 (academic research)"}

# Complete parroquia -> zona mapping for DMQ
# Source: Ordenanza Metropolitana 171 (2011) + EMASEO operational zones
PARROQUIA_ZONA = {
    # -- Calderon
    "Calderon":          "Calderon",
    "Calderón":          "Calderon",
    "Llano Chico":       "Calderon",
    # -- Eloy Alfaro (urban)
    "Chilibulo":         "Eloy Alfaro",
    "Chimbacalle":       "Eloy Alfaro",
    "La Argelia":        "Eloy Alfaro",
    "La Ferroviaria":    "Eloy Alfaro",
    "La Magdalena":      "Eloy Alfaro",
    "La Mena":           "Eloy Alfaro",
    "San Bartolo":       "Eloy Alfaro",
    "Solanda":           "Eloy Alfaro",
    # -- Eugenio Espejo (urban + 2 rural)
    "Cochapamba":        "Eugenio Espejo",
    "Inaquito":          "Eugenio Espejo",
    "Iñaquito":          "Eugenio Espejo",
    "Kennedy":           "Eugenio Espejo",
    "La Concepcion":     "Eugenio Espejo",
    "La Concepción":     "Eugenio Espejo",
    "Mariscal Sucre":    "Eugenio Espejo",
    "Nayon":             "Eugenio Espejo",
    "Nayón":             "Eugenio Espejo",
    "Rumipamba":         "Eugenio Espejo",
    "Zambiza":           "Eugenio Espejo",
    "Zámbiza":           "Eugenio Espejo",
    # -- La Delicia (urban + rural noroccidental)
    "Carcelen":          "La Delicia",
    "Carcelén":          "La Delicia",
    "Comite del Pueblo": "La Delicia",
    "El Condado":        "La Delicia",
    "Pisuli":            "La Delicia",
    "Ponceano":          "La Delicia",
    "Cotocollao":        "La Delicia",
    "Calacali":          "La Delicia",
    "Calacalí":          "La Delicia",
    "Gualea":            "La Delicia",
    "Nanegal":           "La Delicia",
    "Nanegalito":        "La Delicia",
    "Nono":              "La Delicia",
    "Pacto":             "La Delicia",
    "Pomasqui":          "La Delicia",
    "San Antonio":       "La Delicia",
    "San Jose de Minas": "La Delicia",
    "San José de Minas": "La Delicia",
    # -- Los Chillos
    "Alangasi":          "Los Chillos",
    "Alangasí":          "Los Chillos",
    "Amaguana":          "Los Chillos",
    "Amaguaña":          "Los Chillos",
    "Conocoto":          "Los Chillos",
    "Guangopolo":        "Los Chillos",
    "La Merced":         "Los Chillos",
    "Pintag":            "Los Chillos",
    # -- Manuela Saenz (urban historic core)
    "Centro Historico":  "Manuela Saenz",
    "Centro Histórico":  "Manuela Saenz",
    "Itchibia":          "Manuela Saenz",
    "Itchimbía":         "Manuela Saenz",
    "Puengasi":          "Manuela Saenz",
    "Puengasí":          "Manuela Saenz",
    "San Juan":          "Manuela Saenz",
    # -- Quitumbe (urban south)
    "Chillogallo":       "Quitumbe",
    "Guamani":           "Quitumbe",
    "Guamaní":           "Quitumbe",
    "La Ecuatoriana":    "Quitumbe",
    "Quitumbe":          "Quitumbe",
    "Turubamba":         "Quitumbe",
    # -- Tumbaco (valley east)
    "Cumbaya":           "Tumbaco",
    "Cumbayá":           "Tumbaco",
    "Tumbaco":           "Tumbaco",
    "Checa - Chilpa":    "Tumbaco",
    "Checa":             "Tumbaco",
    "El Quinche":        "Tumbaco",
    "Guayllabamba":      "Tumbaco",
    "Lloa":              "Tumbaco",
    "Pifo":              "Tumbaco",
    "Puembo":            "Tumbaco",
    "Tababela":          "Tumbaco",
    "Yaruqui":           "Tumbaco",
    "Atahualpa (Babaspamba)": "Tumbaco",
    "Chavezpamba":       "Tumbaco",
    "Perucho":           "Tumbaco",
    "Puellaro":          "Tumbaco",
    "Puelaro":           "Tumbaco",
}

ZONE_CODES = {
    "Calderon":       "ZN-CALDERON",
    "Eloy Alfaro":    "ZN-ELOY-ALFARO",
    "Eugenio Espejo": "ZN-EUGENIO-ESPEJO",
    "La Delicia":     "ZN-LA-DELICIA",
    "Los Chillos":    "ZN-LOS-CHILLOS",
    "Manuela Saenz":  "ZN-MANUELA-SAENZ",
    "Quitumbe":       "ZN-QUITUMBE",
    "Tumbaco":        "ZN-TUMBACO",
}

ZONE_DISPLAY = {
    "Calderon":       "Calderón",
    "Eloy Alfaro":    "Eloy Alfaro",
    "Eugenio Espejo": "Eugenio Espejo",
    "La Delicia":     "La Delicia",
    "Los Chillos":    "Los Chillos",
    "Manuela Saenz":  "Manuela Sáenz",
    "Quitumbe":       "Quitumbe",
    "Tumbaco":        "Tumbaco",
}

# Overpass relation IDs — only peri-urban parishes close to Quito city
# (excludes remote rural: Nanegal, Nanegalito, Nono, Pacto, Gualea, etc.)
RURAL_RELATION_IDS = [
    2673274,  # Alangasi     -> Los Chillos
    8009658,  # Amaguana     -> Los Chillos
    2673480,  # Calacali     -> La Delicia (close peri-urban)
    2673329,  # Calderon     -> Calderon
    2673415,  # Checa-Chilpa -> Tumbaco
    2673275,  # Conocoto     -> Los Chillos
    2673307,  # Cumbaya      -> Tumbaco (already in gist too)
    2673416,  # El Quinche   -> Tumbaco
    2673303,  # Guangopolo   -> Los Chillos (already in gist)
    2673363,  # Guayllabamba -> Tumbaco
    2673245,  # La Merced    -> Los Chillos (already in gist)
    2673318,  # Llano Chico  -> Calderon
    2673425,  # Lloa         -> Eloy Alfaro (near)
    2673310,  # Nayon        -> Eugenio Espejo (already in gist)
    2673246,  # Pifo         -> Tumbaco
    2673247,  # Pintag       -> Los Chillos (already in gist)
    2673440,  # Pomasqui     -> La Delicia (peri-urban)
    2673409,  # Puembo       -> Tumbaco
    2673446,  # San Antonio  -> La Delicia (peri-urban)
    2673411,  # Tababela     -> Tumbaco
    2673304,  # Tumbaco      -> Tumbaco (already in gist)
    2673412,  # Yaruqui      -> Tumbaco
    2673315,  # Zambiza      -> Eugenio Espejo (already in gist)
]

def fetch_parishes():
    print("Fetching urban parishes (gist)...")
    r = requests.get(PARISHES_URL, timeout=30)
    r.raise_for_status()
    text = r.text
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        print("  [!] File truncated -- repairing...")
        last_close = text.rfind('\n    }')
        if last_close == -1:
            last_close = text.rfind('\n  }')
        repaired = text[:last_close + 6] + "\n  ]\n}"
        data = json.loads(repaired)
    features = data.get("features", [])
    print(f"  -> {len(features)} urban parishes")
    return features


OVERPASS_CACHE = "_overpass_rural_cache.json"

def fetch_rural_from_overpass():
    import os
    # Use cached response if available
    if os.path.exists(OVERPASS_CACHE):
        with open(OVERPASS_CACHE, encoding="utf-8") as f:
            elements = json.load(f)
        print(f"  -> {len(elements)} rural parish elements (from cache)")
        return elements

    ids_str = ",".join(str(i) for i in RURAL_RELATION_IDS)
    query = f"[out:json][timeout:90];\nrelation(id:{ids_str});\nout geom;"
    print(f"Fetching {len(RURAL_RELATION_IDS)} rural parishes from Overpass...")
    for url in [OVERPASS_URL, "https://overpass.kumi.systems/api/interpreter",
                "https://overpass.openstreetmap.ru/api/interpreter"]:
        try:
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=90)
            r.raise_for_status()
            elements = r.json().get("elements", [])
            print(f"  -> {len(elements)} rural parish elements")
            with open(OVERPASS_CACHE, "w", encoding="utf-8") as f:
                json.dump(elements, f)
            print(f"  -> cached to {OVERPASS_CACHE}")
            return elements
        except Exception as e:
            print(f"  [!] {url} failed: {e}")
    return []


def relation_to_shape(rel):
    """Convert Overpass relation geometry to Shapely polygon."""
    from shapely.geometry import Polygon
    outer_rings, inner_rings = [], []
    for member in rel.get("members", []):
        if "geometry" not in member:
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in member["geometry"]]
        if len(coords) < 4:
            continue
        role = member.get("role", "outer")
        (outer_rings if role == "outer" else inner_rings).append(coords)
    if not outer_rings:
        return None
    polys = [Polygon(ring) for ring in outer_rings]
    polys = [p.buffer(0) for p in polys if not p.is_empty]
    if not polys:
        return None
    return unary_union(polys)


def lookup_zone(name):
    """Normalize and look up zone for a parish name."""
    n = name.strip()
    if n in PARROQUIA_ZONA:
        return PARROQUIA_ZONA[n]
    # Try stripping accents manually
    for key, zone in PARROQUIA_ZONA.items():
        if key.lower() == n.lower():
            return zone
    return None


def build_zone_polygons(urban_features, rural_elements):
    zone_geoms = {}

    # Urban parishes from gist
    for feat in urban_features:
        props = feat.get("properties", {})
        name = props.get("name", "")
        # Use gist zone property if available, otherwise look up
        zone = (props.get("administracion_zonal") or
                props.get("Administrative Zone") or
                lookup_zone(name))
        if not zone:
            print(f"  [?] No zone for urban parish: {name}")
            continue
        zone = zone.strip()
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        zone_geoms.setdefault(zone, []).append((name, geom))

    # Rural parishes from Overpass
    for el in rural_elements:
        if el.get("type") != "relation":
            continue
        name = el.get("tags", {}).get("name", "")
        zone = lookup_zone(name)
        if not zone:
            print(f"  [?] No zone mapping for rural parish: {name}")
            continue
        geom = relation_to_shape(el)
        if geom and not geom.is_empty:
            zone_geoms.setdefault(zone, []).append((name, geom))

    # Union per zone, then ensure single Polygon for column constraint
    dissolved = {}
    for zone, items in zone_geoms.items():
        names = [n for n, _ in items]
        geoms = [g for _, g in items]
        union = unary_union(geoms)
        geom_type = union.geom_type
        # Column is GEOMETRY(Polygon, 4326) — take convex hull to ensure single Polygon
        # Convex hull covers full zone extent and is always a Polygon
        if union.geom_type == "MultiPolygon":
            hull = union.convex_hull
            dissolved[zone] = hull
            print(f"  {zone}: {len(items)} parishes -> convex hull Polygon "
                  f"(area {hull.area:.4f} deg2)")
        else:
            dissolved[zone] = union
            print(f"  {zone}: {len(items)} parishes -> {union.geom_type} "
                  f"(area {union.area:.4f} deg2)")
    return dissolved


def geom_to_geojson_str(geom):
    def round_coords(obj):
        if isinstance(obj, list):
            return [round_coords(x) for x in obj]
        if isinstance(obj, float):
            return round(obj, 6)
        return obj
    d = json.loads(json.dumps(mapping(geom)))
    if "coordinates" in d:
        d["coordinates"] = round_coords(d["coordinates"])
    return json.dumps(d, separators=(",", ":"))


def build_sql(zones):
    lines = [
        "-- =========================================================================",
        "-- Migration 048: Zonas operativas reales — DMQ Administraciones Zonales",
        "-- Fuentes: parroquias-pichincha.geojson (github.com/emamut) +",
        "--          Overpass API (OSM rural parishes)",
        "-- Generado por _build_zones_migration.py — 2026-06-03",
        "-- =========================================================================",
        "",
        "BEGIN;",
        "",
        "-- Eliminar zonas placeholder del seed inicial",
        "DELETE FROM operations.zones;",
        "",
        "INSERT INTO operations.zones (codigo, nombre, geom, activa)",
        "VALUES",
    ]

    inserts = []
    for zone_key in sorted(zones.keys()):
        geom = zones[zone_key]
        codigo = ZONE_CODES.get(zone_key, "ZN-" + zone_key.upper().replace(" ", "-"))
        nombre = ZONE_DISPLAY.get(zone_key, zone_key)
        gj = geom_to_geojson_str(geom).replace("'", "''")
        nombre_esc = nombre.replace("'", "''")
        inserts.append(
            f"  ('{codigo}', '{nombre_esc}',\n"
            f"   ST_SetSRID(ST_GeomFromGeoJSON('{gj}'), 4326),\n"
            f"   true)"
        )

    lines.append(",\n\n".join(inserts) + ";")
    lines += [
        "",
        "-- Verificacion post-import",
        "SELECT codigo, nombre,",
        "       ROUND((ST_Area(geom::geography)/1e6)::numeric, 1) AS area_km2,",
        "       ST_IsValid(geom) AS valid",
        "FROM operations.zones",
        "ORDER BY nombre;",
        "",
        "COMMIT;",
    ]
    return "\n".join(lines)


def main():
    urban = fetch_parishes()
    rural = fetch_rural_from_overpass()

    print("\nBuilding zone polygons...")
    zones = build_zone_polygons(urban, rural)

    print(f"\nFinal: {len(zones)} zones: {sorted(zones.keys())}")

    sql = build_sql(zones)
    sql_path = "Backend/database/048_seed_zones_dmq.sql"
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"[OK] {sql_path} ({len(sql):,} bytes)")

    geojson_out = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "codigo": ZONE_CODES.get(k),
                    "nombre": ZONE_DISPLAY.get(k, k),
                },
                "geometry": json.loads(geom_to_geojson_str(g)),
            }
            for k, g in sorted(zones.items())
        ],
    }
    gj_path = "Backend/database/dmq_zones.geojson"
    with open(gj_path, "w", encoding="utf-8") as f:
        json.dump(geojson_out, f, ensure_ascii=False, indent=2)
    print(f"[OK] {gj_path}")


if __name__ == "__main__":
    main()
