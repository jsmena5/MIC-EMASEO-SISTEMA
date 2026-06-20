from dataclasses import dataclass


@dataclass(frozen=True)
class WasteClass:
    canonical: str   # Clave canónica usada en todo el sistema (ej. "RECICLABLE")
    name: str        # Nombre legible en español para el frontend
    aliases: tuple   # Nombres que emite el modelo (lowercase) que resuelven a esta clase
    weight: float    # Multiplicador de severidad aplicado sobre effective_ratio
    icon: str        # Ícono/emoji para UI
    description: str # Contexto operativo para equipos de campo


# ── Registry: única fuente de verdad ─────────────────────────────────────────
# Para agregar una nueva clase (ej. VIDRIO), basta con añadir una entrada aquí.
# El resto del sistema (ALIAS_MAP, VALID_ALIASES, CLASS_WEIGHTS) se actualiza solo.
WASTE_REGISTRY: tuple[WasteClass, ...] = (
    WasteClass(
        canonical="PELIGROSO",
        name="Peligroso",
        aliases=("peligroso", "hazardous"),
        weight=1.30,
        icon="☣️",
        description="Residuos tóxicos/químicos — máxima escalada de prioridad",
    ),
    WasteClass(
        canonical="ESCOMBROS",
        name="Escombros",
        aliases=("escombros", "debris"),
        weight=1.20,
        icon="🧱",
        description="Bloquean vías y requieren maquinaria pesada",
    ),
    WasteClass(
        canonical="MIXTO",
        name="Mixto",
        aliases=("garbage", "basura", "mixto"),
        weight=1.00,
        icon="🗑️",
        description="Mezcla heterogénea — línea base de severidad",
    ),
    WasteClass(
        canonical="DOMESTICO",
        name="Doméstico",
        aliases=("domestico", "domestic"),
        weight=0.90,
        icon="🏠",
        description="Basura doméstica común",
    ),
    WasteClass(
        canonical="ORGANICO",
        name="Orgánico",
        aliases=("organico", "organic"),
        weight=0.95,
        icon="🌿",
        description="Descomposición natural, menor urgencia operativa",
    ),
    WasteClass(
        canonical="RECICLABLE",
        name="Reciclable",
        aliases=("reciclable", "recyclable"),
        weight=0.85,
        icon="♻️",
        description="Menor urgencia operativa — material recuperable",
    ),
    WasteClass(
        canonical="VIDRIO",
        name="Vidrio",
        aliases=("vidrio", "glass"),
        weight=0.90,
        icon="🍶",
        description="Residuo frágil — prioridad media, riesgo de corte",
    ),
)

# Fallback para salidas del modelo no reconocidas por ninguna clase del registry
_FALLBACK = WasteClass(
    canonical="OTRO",
    name="Otro",
    aliases=(),
    weight=1.00,
    icon="❓",
    description="Clase no reconocida por el modelo",
)


# ── Vistas derivadas: generadas automáticamente al importar el módulo ─────────
# No editar directamente. Modificar WASTE_REGISTRY y éstas se recalculan solas.

def _build_alias_map() -> dict[str, str]:
    return {
        alias: wc.canonical
        for wc in WASTE_REGISTRY
        for alias in wc.aliases
    }


def _build_valid_set() -> frozenset[str]:
    return frozenset(alias for wc in WASTE_REGISTRY for alias in wc.aliases)


def _build_weights() -> dict[str, float]:
    return {wc.canonical: wc.weight for wc in (*WASTE_REGISTRY, _FALLBACK)}


# Mapeo alias → canónico  (ej. "hazardous" → "PELIGROSO")
ALIAS_MAP: dict[str, str] = _build_alias_map()

# Conjunto de nombres válidos emitidos por el modelo (filtro de detecciones)
VALID_ALIASES: frozenset[str] = _build_valid_set()

# Pesos por categoría canónica  (ej. {"PELIGROSO": 1.30, ...})
CLASS_WEIGHTS: dict[str, float] = _build_weights()
