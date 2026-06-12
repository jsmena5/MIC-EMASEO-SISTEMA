# EMASEO DB — Migraciones

Migraciones SQL manuales del sistema MIC-EMASEO. Se aplican directamente sobre PostgreSQL/Supabase en orden numérico.

## Estructura

```
Backend/database/
├── migrations/          # Todos los scripts SQL, ordenados numéricamente
│   ├── 001_init_schema.sql          # Esquema completo inicial (reemplaza 001–007)
│   ├── 002_seed_data.sql            # Datos iniciales del sistema
│   ├── 008_refresh_tokens.sql
│   │   ...
│   ├── 053_zones_compact.sql
│   ├── 054_fix_supervisado_fk.sql   # (era 040b — renumerada para evitar conflicto)
│   └── dmq_zones.geojson            # Datos geoespaciales para migración 051–053
├── scripts/
│   └── 012_db_users_isolation.sh    # Crea usuarios PostgreSQL por microservicio
├── seeds/
│   └── insert_qa_user.sql           # Usuario de prueba (QA)
├── package.json                     # node-pg-migrate (para migraciones futuras en JS)
└── .env.example
```

## Aplicar migraciones

Las migraciones se ejecutan de forma **manual y secuencial** directamente en la base de datos:

```bash
psql $DATABASE_URL -f Backend/database/migrations/001_init_schema.sql
psql $DATABASE_URL -f Backend/database/migrations/002_seed_data.sql
# ... continuar en orden numérico
```

## node-pg-migrate (migraciones futuras)

Para crear nuevas migraciones usando el tooling:

```bash
cd Backend/database
cp .env.example .env   # configurar DATABASE_URL
npm install
npm run migrate:create -- nombre-de-la-migracion
```

Genera un archivo en `migrations/` con timestamp. Las nuevas migraciones JS coexisten con los archivos SQL existentes.

## Notas

- `001_init_schema.sql` consolida los esquemas originales 001–007 en estado final.
- La migración `054` corresponde a la original `040_fix_supervisado_fk` (renumerada para evitar conflicto con `040_register_profile_fields`).
- `docs/queries_reference.sql` contiene consultas de referencia frecuentes (no es una migración).
