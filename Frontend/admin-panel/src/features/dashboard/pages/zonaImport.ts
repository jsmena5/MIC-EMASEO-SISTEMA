// Lógica pura del import de zonas desde GeoJSON: plantilla descargable y análisis
// de colisiones contra la BD. Separada de Zonas.tsx para poder testearla sin DOM.
import type { Feature, Polygon, MultiPolygon } from "geojson"
import type { Zona } from "../../../services/zona.service"

// GeoJSON mínimo válido que el usuario puede abrir, editar y volver a subir.
// El polígono es un cuadrado pequeño de ejemplo (no corresponde a una zona real);
// lo importante es la ESTRUCTURA: codigo + nombre + descripcion + geometry.
export const TEMPLATE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        codigo: "ZN-EJEMPLO",                    // ÚNICO, máx 20 chars. Si ya existe → ACTUALIZA esa zona.
        nombre: "Zona de ejemplo",               // Nombre visible en el panel.
        descripcion: "Reemplaza esta geometría por la de tu zona real.",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-78.50, -0.20], [-78.45, -0.20], [-78.45, -0.25], [-78.50, -0.25], [-78.50, -0.20],
        ]],
      },
    },
  ],
}

export function descargarPlantilla() {
  const blob = new Blob([JSON.stringify(TEMPLATE_GEOJSON, null, 2)], { type: "application/geo+json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "plantilla-zona.geojson"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Normaliza un código tal como lo hará el backend (mismo recorte a 20 chars).
// El backend NO fuerza mayúsculas, pero los códigos del repo son MAYÚS, así que
// comparamos en mayúsculas para detectar colisiones reales de forma robusta.
export const normCodigo = (c?: string | null) => (c ?? "").trim().slice(0, 20)

export interface FilaPreview {
  feature: Feature<Polygon | MultiPolygon>
  codigo: string
  nombre: string
  existe: Zona | undefined   // zona existente con el mismo código (→ actualizará), si la hay
  errores: string[]          // problemas que impedirían/dañarían el import
}

// Analiza los Features contra las zonas existentes para mostrar qué creará/actualizará
// y qué tiene problemas. Esto responde "¿coincidirá con la BD?, ¿la corromperá?".
export function analizarPreview(
  features: Feature<Polygon | MultiPolygon>[],
  zonasExistentes: Zona[],
): FilaPreview[] {
  const porCodigo = new Map(zonasExistentes.map((z) => [normCodigo(z.codigo).toUpperCase(), z]))
  const vistos = new Map<string, number>()  // detectar códigos duplicados dentro del MISMO archivo

  return features.map((f) => {
    const codigoRaw = (f.properties?.codigo as string | undefined) ?? ""
    const codigo = normCodigo(codigoRaw)
    const nombre = (f.properties?.nombre as string | undefined)?.trim() ?? ""
    const key = codigo.toUpperCase()
    const errores: string[] = []

    if (!codigo) errores.push("Falta 'codigo' (se generaría uno automático y no podrás actualizarla luego)")
    if ((codigoRaw ?? "").length > 20) errores.push(`'codigo' supera 20 caracteres y se recortará a "${codigo}"`)
    if (!nombre) errores.push("Falta 'nombre'")

    const dupCount = (vistos.get(key) ?? 0) + 1
    vistos.set(key, dupCount)
    if (codigo && dupCount > 1) errores.push("Código repetido dentro de este mismo archivo")

    return { feature: f, codigo, nombre, existe: codigo ? porCodigo.get(key) : undefined, errores }
  })
}
