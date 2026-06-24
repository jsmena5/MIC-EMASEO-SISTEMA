#!/usr/bin/env python3
"""
Genera un GeoJSON de la zona "Los Chillos" EXTENDIDA para cubrir Sangolquí
(cantón Rumiñahui), listo para subir desde el panel admin
(Importar zonas desde GeoJSON → POST /api/users/zonas/import).

POR QUÉ ESTE SCRIPT
El import hace upsert por `codigo` y REEMPLAZA la geometría completa de la zona.
Para no perder el polígono real de Los Chillos (que en producción incluye ajustes
hechos en vivo, p. ej. el fix La Merced 2026-06-18), hay que partir de la geometría
ACTUAL de producción y unirle Sangolquí. Este script hace esa unión localmente.

USO
1) Exporta la geometría actual de Los Chillos desde producción (solo lectura):
       GET /api/users/zonas
   Guarda la respuesta JSON completa en un archivo, p. ej. zonas_prod.json
   (Es el objeto { "zonas": [...] } tal cual lo devuelve la API.)

2) Ejecuta:
       python scripts/extend_los_chillos_sangolqui.py zonas_prod.json

   Sin argumento, usa la geometría del repo (migración 053) como fallback
   — NO recomendado para producción porque no tiene los ajustes en vivo.

3) Se genera `los_chillos_sangolqui.geojson`. Súbelo desde el panel admin.
   Como conserva el `codigo` ZN-LOS-CHILLOS, el import ACTUALIZA esa zona
   (no crea una nueva).

REQUISITOS: shapely (ya presente en el entorno de scripts del repo).
"""
import json
import sys
from pathlib import Path

from shapely.geometry import box, shape, mapping
from shapely.ops import unary_union

# Bounding box del casco urbano del cantón Rumiñahui:
# Sangolquí, San Rafael, San Pedro del Tingo, Alangasí (N), Cotogchoa (S).
# (xmin/lon, ymin/lat, xmax/lon, ymax/lat) en WGS84 / EPSG:4326.
SANGOLQUI_BBOX = (-78.470, -0.375, -78.395, -0.270)

# Punto de control: centro de Sangolquí. El resultado DEBE contenerlo.
SANGOLQUI_CENTER = (-78.448, -0.332)  # (lon, lat)

# Identidad de la zona en la BD. El `codigo` debe coincidir con el de producción
# para que el import actualice la zona existente en vez de crear una nueva.
ZONA_CODIGO = "ZN-LOS-CHILLOS"
ZONA_NOMBRE = "Los Chillos"
ZONA_DESC = "Valle de Los Chillos + Sangolquí (Rumiñahui) para cobertura de pruebas"

OUTPUT = Path(__file__).resolve().parent.parent / "los_chillos_sangolqui.geojson"


def cargar_geom_actual(args) -> "shapely.geometry.base.BaseGeometry":
    """Devuelve la geometría actual de Los Chillos.

    - Con argumento: la lee del export de la API ({ "zonas": [...] }), buscando
      por codigo ZN-LOS-CHILLOS o por nombre 'Los Chillos'.
    - Sin argumento: fallback al GeoJSON del repo (migración 053). Avisa que NO
      incluye ajustes hechos en vivo en producción.
    """
    if len(args) >= 2:
        export = json.loads(Path(args[1]).read_text(encoding="utf-8"))
        zonas = export.get("zonas", export if isinstance(export, list) else [])
        for z in zonas:
            cod = (z.get("codigo") or "").upper()
            nom = (z.get("nombre") or "").lower()
            if cod in ("ZN-LOS-CHILLOS", "ZN-ORIENTE-01") or "los chillos" in nom:
                if not z.get("geom"):
                    sys.exit(f"La zona '{z.get('nombre')}' no trae geometría en el export.")
                print(f"[OK] Geometria tomada del export de produccion: {z.get('nombre')} ({cod})")
                return shape(z["geom"])
        sys.exit("No se encontró 'Los Chillos' en el export. Revisa el archivo.")

    # Fallback: repo (sin ajustes en vivo)
    print("[AVISO] Sin export de produccion: usando geometria del repo (migracion 053).")
    print("  Esto NO incluye ajustes hechos en vivo (p. ej. fix La Merced).")
    repo_geojson = Path(__file__).resolve().parent.parent / "Backend" / "database" / "migrations" / "dmq_zones.geojson"
    fc = json.loads(repo_geojson.read_text(encoding="utf-8"))
    for f in fc.get("features", []):
        props = f.get("properties", {})
        nom = (props.get("nombre") or props.get("name") or "").lower()
        cod = (props.get("codigo") or props.get("CODE") or "").upper()
        if cod == "ZN-LOS-CHILLOS" or "los chillos" in nom or "chillos" in nom:
            return shape(f["geometry"])
    sys.exit("No se encontró 'Los Chillos' en el GeoJSON del repo tampoco.")


def main() -> None:
    actual = cargar_geom_actual(sys.argv)
    sangolqui = box(*SANGOLQUI_BBOX)

    # Unión y normalización a MultiPolygon válido.
    extendida = unary_union([actual, sangolqui])
    if not extendida.is_valid:
        extendida = extendida.buffer(0)  # repara auto-intersecciones

    # Verificación: el resultado debe contener el centro de Sangolquí.
    from shapely.geometry import Point
    if not extendida.contains(Point(*SANGOLQUI_CENTER)):
        sys.exit("[ERROR] la geometria resultante NO cubre el centro de Sangolqui. Abortando.")

    feature = {
        "type": "Feature",
        "properties": {"codigo": ZONA_CODIGO, "nombre": ZONA_NOMBRE, "descripcion": ZONA_DESC},
        "geometry": mapping(extendida),
    }
    fc = {"type": "FeatureCollection", "features": [feature]}
    OUTPUT.write_text(json.dumps(fc), encoding="utf-8")

    print(f"[OK] Generado: {OUTPUT}")
    print(f"  Tipo geometria: {extendida.geom_type}")
    print(f"  Cubre Sangolqui: si")
    print("  Subelo desde el panel admin -> Zonas -> Importar zonas desde GeoJSON.")
    print(f"  El codigo '{ZONA_CODIGO}' hara que ACTUALICE la zona existente (no crea otra).")


if __name__ == "__main__":
    main()
