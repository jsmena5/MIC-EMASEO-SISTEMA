"""
Genera el ERD del sistema EMASEO como PNG de alta resolución.
Uso: python scripts/generate_erd.py
Salida: ERD.png en la raíz del proyecto
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patheffects as pe
import numpy as np

# ─── Paleta de colores por schema ──────────────────────────────────────────────
COLORS = {
    "app_auth":      {"header": "#4F46E5", "body": "#EEF2FF", "border": "#4F46E5"},
    "public":        {"header": "#059669", "body": "#ECFDF5", "border": "#059669"},
    "operations":    {"header": "#D97706", "body": "#FFFBEB", "border": "#D97706"},
    "incidents":     {"header": "#2563EB", "body": "#EFF6FF", "border": "#2563EB"},
    "ai":            {"header": "#0891B2", "body": "#ECFEFF", "border": "#0891B2"},
    "notifications": {"header": "#DC2626", "body": "#FEF2F2", "border": "#DC2626"},
    "audit":         {"header": "#6B7280", "body": "#F9FAFB", "border": "#6B7280"},
    "supabase_auth": {"header": "#9CA3AF", "body": "#F3F4F6", "border": "#9CA3AF"},
}

# ─── Definición de tablas ──────────────────────────────────────────────────────
# Cada tabla: (schema, nombre, [(columna, tipo, nota)])
TABLES = {
    # ── app_auth ──
    "users": ("app_auth", "users", [
        ("id", "uuid", "PK"),
        ("email", "varchar", "UNIQUE"),
        ("username", "varchar", "UNIQUE"),
        ("password_hash", "text", ""),
        ("rol", "ENUM", "CIUDADANO|OPERARIO|SUPERVISOR|ADMIN"),
        ("estado", "ENUM", "ACTIVO|INACTIVO|SUSPENDIDO"),
        ("created_at", "timestamptz", ""),
    ]),
    "refresh_tokens": ("app_auth", "refresh_tokens", [
        ("id", "uuid", "PK"),
        ("user_id", "uuid", "FK → users"),
        ("token_hash", "text", "SHA-256"),
        ("expires_at", "timestamptz", "7 días"),
        ("revoked_at", "timestamptz", "nullable"),
    ]),
    "password_reset_tokens": ("app_auth", "password_reset_tokens", [
        ("id", "uuid", "PK"),
        ("user_id", "uuid", "FK → users"),
        ("token_hash", "text", "bcrypt"),
        ("expires_at", "timestamptz", "15 min"),
        ("used_at", "timestamptz", "nullable"),
    ]),
    "device_tokens": ("app_auth", "device_tokens", [
        ("id", "uuid", "PK"),
        ("user_id", "uuid", "FK → users"),
        ("token", "text", "FCM/APNs"),
        ("platform", "varchar", "android|ios"),
    ]),
    # ── public ──
    "ciudadanos": ("public", "ciudadanos", [
        ("user_id", "uuid", "PK, FK → users"),
        ("nombre", "varchar", ""),
        ("apellido", "varchar", ""),
        ("cedula_cifrada", "text", "pgcrypto"),
        ("telefono_cifrado", "text", "pgcrypto"),
    ]),
    # ── operations ──
    "zones": ("operations", "zones", [
        ("id", "uuid", "PK"),
        ("nombre", "varchar", ""),
        ("codigo", "varchar", "UNIQUE"),
        ("geom", "geometry", "PostGIS EPSG:4326"),
        ("supervisor_id", "uuid", "FK → users nullable"),
        ("activa", "boolean", ""),
    ]),
    "operarios": ("operations", "operarios", [
        ("id", "uuid", "PK"),
        ("user_id", "uuid", "FK → users"),
        ("nombre", "varchar", ""),
        ("cargo", "varchar", ""),
        ("telefono", "varchar", ""),
        ("zona_id", "uuid", "FK → zones nullable"),
    ]),
    "config": ("operations", "config", [
        ("clave", "varchar", "PK"),
        ("valor", "text", ""),
        ("descripcion", "text", ""),
        ("updated_at", "timestamptz", ""),
    ]),
    # ── incidents ──
    "incidents": ("incidents", "incidents", [
        ("id", "uuid", "PK"),
        ("reportado_por", "uuid", "FK → users"),
        ("zona_id", "uuid", "FK → zones (trigger)"),
        ("estado", "ENUM", "8 estados"),
        ("prioridad", "ENUM", "BAJA|MEDIA|ALTA|CRITICA"),
        ("ubicacion", "geometry", "PostGIS POINT"),
        ("decision_automatica", "ENUM", "4 vías ML"),
        ("confianza_decision", "float", "0–1"),
        ("imagen_auditoria_url", "text", "R2 preservada"),
        ("nivel_acumulacion", "ENUM", "ML output"),
        ("celery_task_id", "text", "recovery"),
        ("cierre_lat/lon", "float", "GPS cierre"),
        ("cierre_distancia_m", "numeric", "geocerca"),
        ("created_at", "timestamptz", ""),
    ]),
    "incident_images": ("incidents", "incident_images", [
        ("id", "uuid", "PK"),
        ("incident_id", "uuid", "FK → incidents"),
        ("image_url", "text", "Cloudflare R2"),
        ("es_principal", "boolean", ""),
    ]),
    "status_history": ("incidents", "status_history", [
        ("id", "uuid", "PK"),
        ("incident_id", "uuid", "FK → incidents"),
        ("actor_id", "uuid", "FK → users"),
        ("estado_anterior", "ENUM", ""),
        ("estado_nuevo", "ENUM", ""),
        ("observaciones", "text", "nullable"),
        ("motivo_rechazo", "ENUM", "5 motivos"),
    ]),
    "assignments": ("incidents", "assignments", [
        ("id", "uuid", "PK"),
        ("incident_id", "uuid", "FK → incidents"),
        ("operario_id", "uuid", "FK → users"),
        ("completada", "boolean", ""),
        ("fecha_esperada", "date", "nullable"),
        ("notas", "text", "nullable"),
    ]),
    # ── ai ──
    "analysis_results": ("ai", "analysis_results", [
        ("id", "uuid", "PK"),
        ("incident_id", "uuid", "FK → incidents"),
        ("nivel_acumulacion", "ENUM", "ML"),
        ("confianza", "float", "0–1"),
        ("tipo_residuo", "ENUM", "7 tipos"),
        ("detecciones", "jsonb", "bboxes RT-DETR"),
        ("volumen_estimado_m3", "float", "MiDaS"),
        ("ia_fue_correcta", "boolean", "supervisor"),
        ("nivel_acumulacion_supervisor", "ENUM", "corrección"),
        ("supervisado_por", "uuid", "FK → users"),
        ("supervisado_at", "timestamptz", ""),
    ]),
    "analysis_feedback": ("ai", "analysis_feedback", [
        ("id", "uuid", "PK"),
        ("analysis_result_id", "uuid", "FK → analysis_results"),
        ("reportado_por", "uuid", "FK → users"),
        ("es_correcta", "boolean", ""),
        ("comentario", "text", "nullable"),
    ]),
    "image_audit": ("ai", "image_audit", [
        ("id", "uuid", "PK"),
        ("incident_id", "uuid", "FK → incidents UNIQUE"),
        ("etiqueta", "ENUM", "VÁLIDA|DUDOSA|EXCLUIR|PENDIENTE"),
        ("comentario", "text", "nullable"),
        ("etiquetado_por", "uuid", "FK → users"),
        ("etiquetado_at", "timestamptz", ""),
    ]),
    # ── notifications ──
    "notifications": ("notifications", "notifications", [
        ("id", "uuid", "PK"),
        ("user_id", "uuid", "FK → users"),
        ("incident_id", "uuid", "FK → incidents nullable"),
        ("titulo", "varchar", ""),
        ("mensaje", "text", ""),
        ("estado", "ENUM", "PENDIENTE|ENVIADA|LEIDA|FALLIDA"),
        ("canal", "varchar", "PUSH|IN_APP"),
        ("created_at", "timestamptz", ""),
    ]),
    # ── audit ──
    "audit_log": ("audit", "audit_log", [
        ("id", "uuid", "PK"),
        ("actor_id", "uuid", "FK → users"),
        ("accion", "varchar", "LOGIN|CHANGE_PW|..."),
        ("actor_ip", "inet", ""),
        ("user_agent", "text", ""),
        ("created_at", "timestamptz", "particionada/mes"),
    ]),
    # ── supabase auth (no usada) ──
    "supabase_auth_users": ("supabase_auth", "auth.users", [
        ("id", "uuid", "PK (Supabase GoTrue)"),
        ("email", "varchar", ""),
        ("encrypted_password", "text", ""),
        ("...", "...", "Gestionado por Supabase"),
    ]),
}

# ─── Posiciones de cada tabla (x, y) — en unidades de axes ───────────────────
# Canvas: x ∈ [0, 44], y ∈ [0, 34]
POS = {
    # app_auth — fila superior
    "users":                   ( 8.0, 28.5),
    "refresh_tokens":          ( 0.2, 28.5),
    "password_reset_tokens":   ( 0.2, 23.5),
    "device_tokens":           (15.5, 28.5),
    # supabase auth — esquina superior derecha (nota)
    "supabase_auth_users":     (38.5, 28.5),
    # public
    "ciudadanos":              ( 0.2, 18.5),
    # operations
    "zones":                   ( 0.2, 13.2),
    "operarios":               ( 0.2,  8.0),
    "config":                  ( 0.2,  3.5),
    # incidents — columna central
    "incidents":               (10.0, 12.0),
    "incident_images":         (10.0, 21.5),
    "status_history":          (10.0,  4.5),
    "assignments":             (16.5, 18.0),
    # ai — columna derecha
    "analysis_results":        (23.0, 14.0),
    "analysis_feedback":       (23.0,  7.0),
    "image_audit":             (23.0, 21.0),
    # notifications
    "notifications":           (31.5, 14.0),
    # audit
    "audit_log":               (31.5, 21.0),
}

# ─── Relaciones (origen, destino, etiqueta, color_flecha) ─────────────────────
RELATIONS = [
    # users → dominios de perfil
    ("users", "ciudadanos",            "1:1 perfil",           "#059669"),
    ("users", "refresh_tokens",        "1:N sesiones",         "#4F46E5"),
    ("users", "password_reset_tokens", "1:N OTP reset",        "#4F46E5"),
    ("users", "device_tokens",         "1:N push tokens",      "#4F46E5"),
    ("users", "operarios",             "1:1 perfil operario",  "#D97706"),
    ("zones", "operarios",             "zona_id",              "#D97706"),
    ("users", "zones",                 "supervisor_id",        "#D97706"),
    # users → incidents
    ("users", "incidents",             "reportado_por",        "#2563EB"),
    ("zones", "incidents",             "zona_id (trigger)",    "#2563EB"),
    # incidents → hijos
    ("incidents", "incident_images",   "1:N imágenes",         "#2563EB"),
    ("incidents", "status_history",    "1:N historial",        "#2563EB"),
    ("incidents", "assignments",       "1:N asignaciones",     "#2563EB"),
    ("incidents", "analysis_results",  "1:1 resultado ML",     "#0891B2"),
    ("incidents", "image_audit",       "1:1 etiqueta",         "#0891B2"),
    ("incidents", "notifications",     "1:N notificaciones",   "#DC2626"),
    # users → transversales
    ("users", "status_history",        "actor_id",             "#6B7280"),
    ("users", "assignments",           "operario_id",          "#6B7280"),
    ("users", "analysis_results",      "supervisado_por",      "#6B7280"),
    ("users", "analysis_feedback",     "reportado_por",        "#6B7280"),
    ("users", "image_audit",           "etiquetado_por",       "#6B7280"),
    ("users", "notifications",         "user_id",              "#6B7280"),
    ("users", "audit_log",             "actor_id",             "#6B7280"),
    # ai
    ("analysis_results", "analysis_feedback", "1:N feedback",  "#0891B2"),
]

# ─── Helpers ───────────────────────────────────────────────────────────────────
TABLE_W    = 8.2    # ancho de cada tabla
ROW_H      = 0.55   # alto de cada fila de columna
HEADER_H   = 0.75   # alto del encabezado
COL_FONT   = 6.5    # tamaño fuente columnas
HEAD_FONT  = 7.5    # tamaño fuente encabezado

def table_height(key):
    _, _, cols = TABLES[key]
    return HEADER_H + len(cols) * ROW_H + 0.10

def draw_table(ax, key):
    x, y = POS[key]
    schema, name, cols = TABLES[key]
    c = COLORS[schema]
    h = table_height(key)

    # Sombra
    shadow = FancyBboxPatch((x+0.08, y - h - 0.08), TABLE_W, h,
                             boxstyle="round,pad=0.05",
                             linewidth=0, facecolor="#CBD5E1", zorder=1)
    ax.add_patch(shadow)

    # Cuerpo
    body = FancyBboxPatch((x, y - h), TABLE_W, h,
                           boxstyle="round,pad=0.05",
                           linewidth=1.2, edgecolor=c["border"],
                           facecolor=c["body"], zorder=2)
    ax.add_patch(body)

    # Encabezado
    header = FancyBboxPatch((x, y - HEADER_H), TABLE_W, HEADER_H,
                             boxstyle="round,pad=0.05",
                             linewidth=0, facecolor=c["header"], zorder=3)
    ax.add_patch(header)

    # Etiqueta schema (pequeña) + nombre tabla
    schema_label = schema.replace("supabase_auth", "auth (Supabase)")
    ax.text(x + TABLE_W / 2, y - 0.22, schema_label,
            ha="center", va="center", fontsize=5.0,
            color="white", alpha=0.8, zorder=4, style="italic")
    ax.text(x + TABLE_W / 2, y - 0.55, name,
            ha="center", va="center", fontsize=HEAD_FONT,
            fontweight="bold", color="white", zorder=4)

    # Línea separadora
    sep_y = y - HEADER_H
    ax.plot([x + 0.1, x + TABLE_W - 0.1], [sep_y, sep_y],
            color=c["border"], linewidth=0.6, zorder=4)

    # Filas de columnas
    for i, (col, dtype, note) in enumerate(cols):
        cy = sep_y - (i + 0.5) * ROW_H
        # Fondo alternado
        if i % 2 == 0:
            row_bg = FancyBboxPatch((x + 0.05, cy - ROW_H / 2 + 0.01),
                                     TABLE_W - 0.10, ROW_H - 0.02,
                                     boxstyle="square,pad=0",
                                     linewidth=0, facecolor="#FFFFFF",
                                     alpha=0.5, zorder=3)
            ax.add_patch(row_bg)

        is_pk = "PK" in note
        is_fk = "FK" in note
        icon = "PK" if is_pk else ("FK" if is_fk else "  ")
        col_color = "#1E40AF" if is_pk else ("#065F46" if is_fk else "#374151")

        ax.text(x + 0.25, cy, icon, ha="left", va="center",
                fontsize=5.0, zorder=4)
        ax.text(x + 0.70, cy, col, ha="left", va="center",
                fontsize=COL_FONT, color=col_color,
                fontweight="bold" if is_pk else "normal", zorder=4)
        ax.text(x + TABLE_W - 0.15, cy, dtype, ha="right", va="center",
                fontsize=5.2, color="#6B7280", style="italic", zorder=4)

def get_anchor(key, side="center"):
    x, y = POS[key]
    h = table_height(key)
    cx = x + TABLE_W / 2
    cy = y - h / 2
    if side == "top":    return cx, y
    if side == "bottom": return cx, y - h
    if side == "left":   return x, cy
    if side == "right":  return x + TABLE_W, cy
    return cx, cy

def best_anchors(k1, k2):
    x1, y1 = POS[k1]
    x2, y2 = POS[k2]
    h1 = table_height(k1)
    h2 = table_height(k2)
    cx1, cy1 = x1 + TABLE_W/2, y1 - h1/2
    cx2, cy2 = x2 + TABLE_W/2, y2 - h2/2
    dx = cx2 - cx1
    dy = cy2 - cy1
    if abs(dx) > abs(dy):
        if dx > 0:
            return get_anchor(k1, "right"), get_anchor(k2, "left")
        else:
            return get_anchor(k1, "left"), get_anchor(k2, "right")
    else:
        if dy > 0:
            return get_anchor(k1, "top"), get_anchor(k2, "bottom")
        else:
            return get_anchor(k1, "bottom"), get_anchor(k2, "top")

def draw_relations(ax, relations):
    for k1, k2, label, color in relations:
        if k1 not in POS or k2 not in POS:
            continue
        (x1, y1), (x2, y2) = best_anchors(k1, k2)
        ax.annotate("",
                    xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(
                        arrowstyle="-|>",
                        color=color,
                        lw=0.9,
                        connectionstyle="arc3,rad=0.06",
                    ),
                    zorder=0)
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx, my + 0.15, label,
                ha="center", va="bottom", fontsize=4.5,
                color=color, fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.05", fc="white",
                          ec=color, lw=0.5, alpha=0.85),
                zorder=5)

# ─── Figura principal ─────────────────────────────────────────────────────────
FIG_W, FIG_H = 50, 38
fig, ax = plt.subplots(figsize=(FIG_W, FIG_H), dpi=120)
ax.set_xlim(-1, 49)
ax.set_ylim(-1, 37)
ax.axis("off")
fig.patch.set_facecolor("#F8FAFC")
ax.set_facecolor("#F8FAFC")

# ─── Fondos de schemas ────────────────────────────────────────────────────────
def schema_bg(ax, x, y, w, h, label, color, alpha=0.08):
    bg = FancyBboxPatch((x, y), w, h,
                         boxstyle="round,pad=0.3",
                         linewidth=1.5,
                         edgecolor=color, linestyle="--",
                         facecolor=color, alpha=alpha, zorder=0)
    ax.add_patch(bg)
    ax.text(x + 0.35, y + h - 0.45, label,
            ha="left", va="top", fontsize=9,
            fontweight="bold", color=color, alpha=0.7, zorder=1)

schema_bg(ax, -0.5, 22.0, 20.0, 14.5, "schema: app_auth",     "#4F46E5")
schema_bg(ax, -0.5, -0.5,  9.5, 22.0, "schema: operations / public", "#D97706")
schema_bg(ax,  9.0, -0.5, 13.0, 29.0, "schema: incidents",    "#2563EB")
schema_bg(ax, 22.0,  4.0, 10.0, 20.0, "schema: ai",           "#0891B2")
schema_bg(ax, 30.5, 11.5, 10.5, 12.0, "schema: notifications + audit", "#DC2626")
schema_bg(ax, 36.5, 25.5, 12.5,  9.0,
          "schema: auth (Supabase GoTrue)\n⚠ NO usada por este sistema",
          "#9CA3AF", alpha=0.05)

# ─── Relaciones (primero, para quedar debajo de las tablas) ───────────────────
draw_relations(ax, RELATIONS)

# ─── Tablas ───────────────────────────────────────────────────────────────────
for key in TABLES:
    draw_table(ax, key)

# ─── Nota sobre auth de Supabase ─────────────────────────────────────────────
note_x, note_y = 38.5, 24.8
ax.text(note_x, note_y,
        "[i] Este proyecto usa app_auth (custom)\n"
        "  para toda la autenticación.\n"
        "  El schema auth (GoTrue de Supabase)\n"
        "  viene con todo proyecto Supabase\n"
        "  pero NO está en uso aquí.",
        ha="left", va="top", fontsize=6.5,
        color="#374151",
        bbox=dict(boxstyle="round,pad=0.4", fc="#FEF3C7", ec="#D97706", lw=1.2),
        zorder=6)

# ─── Nota sobre supabase auth gris ───────────────────────────────────────────

# ─── Título ───────────────────────────────────────────────────────────────────
ax.text(24, 36.3,
        "ERD — Sistema EMASEO EP  ·  MIC-EMASEO-SISTEMA",
        ha="center", va="center", fontsize=18,
        fontweight="bold", color="#1E293B",
        bbox=dict(boxstyle="round,pad=0.5", fc="white", ec="#CBD5E1", lw=1.5))

ax.text(24, 35.4,
        "Plataforma de detección y gestión de acumulaciones de basura  ·  Quito, Ecuador",
        ha="center", va="center", fontsize=10, color="#64748B")

# ─── Leyenda ──────────────────────────────────────────────────────────────────
legend_x, legend_y = 30.5, 10.2
ax.add_patch(FancyBboxPatch((legend_x - 0.2, legend_y - 5.2), 10.2, 5.6,
                             boxstyle="round,pad=0.2", linewidth=1,
                             edgecolor="#CBD5E1", facecolor="white", zorder=5))
ax.text(legend_x + 4.9, legend_y + 0.1, "Leyenda",
        ha="center", va="bottom", fontsize=8, fontweight="bold", color="#374151", zorder=6)
schemas_legend = [
    ("app_auth",      "Autenticación (custom)"),
    ("operations",    "Operaciones / Zonas"),
    ("incidents",     "Incidencias (núcleo)"),
    ("ai",            "Resultados ML / IA"),
    ("notifications", "Notificaciones ciudadano"),
    ("audit",         "Auditoría LOPDP"),
    ("supabase_auth", "auth Supabase (NO usada)"),
]
for i, (s, label) in enumerate(schemas_legend):
    cy = legend_y - 0.45 - i * 0.72
    rect = FancyBboxPatch((legend_x, cy - 0.22), 0.55, 0.44,
                           boxstyle="round,pad=0.02",
                           linewidth=0, facecolor=COLORS[s]["header"], zorder=6)
    ax.add_patch(rect)
    ax.text(legend_x + 0.7, cy, label,
            ha="left", va="center", fontsize=6.5, color="#374151", zorder=6)

ax.text(legend_x + 0.3, legend_y - 5.0, "PK = Clave Primaria  FK = Clave Foranea",
        ha="left", va="center", fontsize=6.0, color="#6B7280", zorder=6)

# ─── Guardar ──────────────────────────────────────────────────────────────────
out = "ERD.png"
plt.tight_layout(pad=0.5)
plt.savefig(out, dpi=120, bbox_inches="tight",
            facecolor=fig.get_facecolor())
print(f"ERD guardado en {out}")
plt.close()
