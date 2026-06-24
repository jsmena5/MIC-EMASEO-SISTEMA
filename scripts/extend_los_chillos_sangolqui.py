#!/usr/bin/env python3
"""
Genera un GeoJSON de la zona "Valle de Sangolquí" (cantón Rumiñahui) como zona
PROPIA e independiente, lista para subir desde el panel admin
(Importar zonas desde GeoJSON → POST /api/users/zonas/import).

POR QUÉ ESTE SCRIPT
Sangolquí (cantón Rumiñahui) está FUERA del DMQ, así que no es una de las 8
administraciones zonales del repo. Se agrega como una zona nueva más —igual que
ya se hizo con otros valles para demostrar que la cobertura se expande vía import
GeoJSON desde el panel, sin tocar la BD a mano.

Como el import hace upsert por `codigo` y el código ZN-SANGOLQUI no existe aún,
el import CREA la zona nueva sin afectar Los Chillos ni ninguna zona existente
(cero riesgo de sobrescribir geometría ajustada en vivo en producción).

GEOMETRÍA
Se usa el LÍMITE ADMINISTRATIVO REAL del cantón desde OpenStreetMap
(relation 113713, admin_level=6), no un rectángulo. En OSM el cantón Rumiñahui
está mapeado con el nombre de su cabecera, "Sangolqui".
El script descarga la geometría en vivo de OSM y, si no hay red, cae al GeoJSON
cacheado en el repo (scripts/sangolqui_osm_geom.json), reproducible.

USO
    python scripts/extend_los_chillos_sangolqui.py

Se genera `sangolqui.geojson`. Súbelo desde el panel admin
(Zonas → Importar zonas desde GeoJSON). Como el `codigo` es ZN-SANGOLQUI y no
existe, el import CREA la zona (no toca las demás).

REQUISITOS: shapely (ya presente en el entorno de scripts del repo).
"""
import json
import sys
import urllib.request
from pathlib import Path

from shapely.geometry import shape, mapping, Point, MultiPolygon

# Cantón Rumiñahui en OSM = relation 113713 (admin_level=6, name "Sangolqui").
OSM_RELATION_ID = 113713
NOMINATIM_LOOKUP = (
    "https://nominatim.openstreetmap.org/lookup"
    f"?osm_ids=R{OSM_RELATION_ID}&format=json&polygon_geojson=1"
)
USER_AGENT = "mic-emaseo-zones/1.0 (baortiz7@espe.edu.ec)"

# Identidad de la zona en la BD. El `codigo` no debe colisionar con los existentes
# (ZN-CALDERON, ZN-LOS-CHILLOS, ZN-TUMBACO, ...) para que el import CREE una zona
# nueva. Máx 20 chars (límite de la columna operations.zones.codigo).
ZONA_CODIGO = "ZN-SANGOLQUI"
ZONA_NOMBRE = "Valle de Sangolquí"
ZONA_DESC = "Cantón Rumiñahui (Sangolquí), fuera del DMQ — cobertura ampliada vía import"

# Punto de control: cabecera cantonal de Sangolquí. El resultado DEBE contenerlo.
SANGOLQUI_CENTER = (-78.4481, -0.3308)  # (lon, lat) WGS84 / EPSG:4326

CACHE = Path(__file__).resolve().parent / "sangolqui_osm_geom.json"
OUTPUT = Path(__file__).resolve().parent.parent / "sangolqui.geojson"


def cargar_geom_osm() -> "shapely.geometry.base.BaseGeometry":
    """Geometría del cantón desde OSM (en vivo); si falla la red, usa el cache del repo."""
    try:
        req = urllib.request.Request(NOMINATIM_LOOKUP, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        geom_json = data[0]["geojson"]
        print(f"[OK] Geometria descargada de OSM (relation {OSM_RELATION_ID}).")
        # Refresca el cache para futuras corridas offline.
        CACHE.write_text(json.dumps(geom_json, separators=(",", ":")), encoding="utf-8")
    except Exception as e:  # red caída, rate limit, etc.
        if not CACHE.exists():
            sys.exit(f"[ERROR] Sin red y sin cache ({CACHE}). Detalle: {e}")
        print(f"[AVISO] No se pudo consultar OSM ({e}). Usando cache del repo.")
        geom_json = json.loads(CACHE.read_text(encoding="utf-8"))
    return shape(geom_json)


def main() -> None:
    geom = cargar_geom_osm()

    # Repara auto-intersecciones si las hubiera.
    if not geom.is_valid:
        geom = geom.buffer(0)

    # Normaliza a MultiPolygon (lo que la BD/PostGIS espera de forma consistente).
    if geom.geom_type == "Polygon":
        geom = MultiPolygon([geom])

    # Verificación dura: el resultado debe contener la cabecera de Sangolquí.
    if not geom.contains(Point(*SANGOLQUI_CENTER)):
        sys.exit("[ERROR] la geometria NO cubre el centro de Sangolqui. Abortando.")

    feature = {
        "type": "Feature",
        "properties": {"codigo": ZONA_CODIGO, "nombre": ZONA_NOMBRE, "descripcion": ZONA_DESC},
        "geometry": mapping(geom),
    }
    fc = {"type": "FeatureCollection", "features": [feature]}
    OUTPUT.write_text(json.dumps(fc), encoding="utf-8")

    print(f"[OK] Generado: {OUTPUT}")
    print(f"  Codigo: {ZONA_CODIGO}  |  Nombre: {ZONA_NOMBRE}")
    print(f"  Tipo geometria: {geom.geom_type}")
    print(f"  Cubre Sangolqui: si")
    print("  Subelo desde el panel admin -> Zonas -> Importar zonas desde GeoJSON.")
    print(f"  El codigo '{ZONA_CODIGO}' es nuevo: el import CREA la zona (no toca las demas).")


if __name__ == "__main__":
    main()
