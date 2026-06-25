#!/usr/bin/env python3
"""
Genera un GeoJSON de la zona "Los Chillos" FUSIONADA con Sangolquí (cantón
Rumiñahui), listo para subir desde el panel admin
(Importar zonas desde GeoJSON → POST /api/users/zonas/import).

DECISIÓN (2026-06-25)
Los Chillos (DMQ, cantón Quito) y Sangolquí (cantón Rumiñahui) son valles vecinos
contiguos que EMASEO gestiona como una sola área operativa. Se fusionan en una
única zona `ZN-LOS-CHILLOS` con un solo supervisor, en vez de mantener dos zonas
separadas. (El intento previo de zona separada ZN-SANGOLQUI se revierte: tras subir
este archivo se elimina ZN-SANGOLQUI desde el panel — botón "Eliminar zona".)

POR QUÉ ESTE SCRIPT
El import hace upsert por `codigo` y REEMPLAZA la geometría completa de la zona.
Para no perder el polígono real de Los Chillos en producción (que incluye ajustes
en vivo, p. ej. el fix La Merced), hay que partir de la geometría ACTUAL de prod y
unirle Sangolquí. Este script hace esa unión localmente.

USO
1) Exporta las geometrías ACTUALES de Los Chillos y Sangolquí desde producción
   (solo lectura) a un JSON con forma:
       { "ZN-LOS-CHILLOS": <geometry>, "ZN-SANGOLQUI": <geometry> }
   (p. ej. con ST_AsGeoJSON sobre operations.zones). Guárdalo como zonas_prod.json.

2) Ejecuta:
       python scripts/extend_los_chillos_sangolqui.py zonas_prod.json

   Sin argumento, usa el límite OSM cacheado de Sangolquí (scripts/sangolqui_osm_geom.json)
   unido a la geometría de Los Chillos del repo — NO recomendado para prod porque
   no tiene los ajustes en vivo.

3) Se genera `los_chillos_fusion.geojson`. Súbelo desde el panel admin.
   Como conserva el `codigo` ZN-LOS-CHILLOS, el import ACTUALIZA esa zona (no crea
   otra). Luego: panel → Re-zonificar (mueve los incidentes de Sangolquí a Los
   Chillos) → eliminar ZN-SANGOLQUI.

REQUISITOS: shapely (ya presente en el entorno de scripts del repo).
"""
import json
import sys
from pathlib import Path

from shapely.geometry import shape, mapping, MultiPolygon, Point
from shapely.ops import unary_union

# Identidad de la zona resultante. El `codigo` debe coincidir con el de producción
# para que el import ACTUALICE la zona existente en vez de crear una nueva.
ZONA_CODIGO = "ZN-LOS-CHILLOS"
ZONA_NOMBRE = "Los Chillos"
ZONA_DESC = "Valle de Los Chillos + Sangolquí (Rumiñahui)"

# Puntos de control: el resultado DEBE contener ambos (lon, lat) WGS84.
CHILLOS_CENTER = (-78.46, -0.31)     # Conocoto / Los Chillos
SANGOLQUI_CENTER = (-78.4481, -0.3308)  # cabecera de Sangolquí

CACHE_SANGOLQUI = Path(__file__).resolve().parent / "sangolqui_osm_geom.json"
OUTPUT = Path(__file__).resolve().parent.parent / "los_chillos_fusion.geojson"


def cargar_geoms(args):
    """Devuelve (geom_los_chillos, geom_sangolqui) como geometrías shapely."""
    if len(args) >= 2:
        export = json.loads(Path(args[1]).read_text(encoding="utf-8"))
        chillos = export.get("ZN-LOS-CHILLOS")
        sango = export.get("ZN-SANGOLQUI")
        if not chillos:
            sys.exit("El export no trae 'ZN-LOS-CHILLOS'. Revisa el archivo.")
        print("[OK] Geometrias tomadas del export de produccion.")
        # Sangolquí: del export si está; si no, del cache OSM.
        if not sango:
            print("[AVISO] El export no trae Sangolqui; usando cache OSM del repo.")
            sango = json.loads(CACHE_SANGOLQUI.read_text(encoding="utf-8"))
        return shape(chillos), shape(sango)

    # Fallback sin export: Los Chillos del repo + Sangolquí del cache OSM.
    print("[AVISO] Sin export de produccion: usando geometria del repo + cache OSM.")
    repo_geojson = Path(__file__).resolve().parent.parent / "Backend" / "database" / "migrations" / "dmq_zones.geojson"
    fc = json.loads(repo_geojson.read_text(encoding="utf-8"))
    chillos = None
    for f in fc.get("features", []):
        props = f.get("properties", {})
        cod = (props.get("codigo") or props.get("CODE") or "").upper()
        nom = (props.get("nombre") or props.get("name") or "").lower()
        if cod == "ZN-LOS-CHILLOS" or "chillos" in nom:
            chillos = shape(f["geometry"])
            break
    if chillos is None:
        sys.exit("No se encontró 'Los Chillos' en el GeoJSON del repo.")
    sango = shape(json.loads(CACHE_SANGOLQUI.read_text(encoding="utf-8")))
    return chillos, sango


def main() -> None:
    chillos, sango = cargar_geoms(sys.argv)

    fused = unary_union([chillos, sango])
    if not fused.is_valid:
        fused = fused.buffer(0)  # repara auto-intersecciones
    if fused.geom_type == "Polygon":
        fused = MultiPolygon([fused])

    # Verificación dura: debe cubrir AMBOS valles.
    for nombre, (lon, lat) in (("Los Chillos", CHILLOS_CENTER), ("Sangolqui", SANGOLQUI_CENTER)):
        p = Point(lon, lat)
        if not (fused.contains(p) or fused.distance(p) < 0.001):
            sys.exit(f"[ERROR] la geometria fusionada NO cubre el centro de {nombre}. Abortando.")

    feature = {
        "type": "Feature",
        "properties": {"codigo": ZONA_CODIGO, "nombre": ZONA_NOMBRE, "descripcion": ZONA_DESC},
        "geometry": mapping(fused),
    }
    fc = {"type": "FeatureCollection", "features": [feature]}
    OUTPUT.write_text(json.dumps(fc), encoding="utf-8")

    print(f"[OK] Generado: {OUTPUT}")
    print(f"  Codigo: {ZONA_CODIGO}  |  Tipo: {fused.geom_type}")
    print("  Cubre Los Chillos y Sangolqui: si")
    print("  Subelo desde el panel admin -> Zonas -> Importar zonas desde GeoJSON.")
    print(f"  El codigo '{ZONA_CODIGO}' hara que ACTUALICE Los Chillos (no crea otra).")
    print("  Luego: Re-zonificar (mueve incidentes de Sangolqui) y eliminar ZN-SANGOLQUI.")


if __name__ == "__main__":
    main()
