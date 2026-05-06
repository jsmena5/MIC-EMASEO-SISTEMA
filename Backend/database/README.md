# EMASEO DB Migrations

Gestión de migraciones de base de datos usando [node-pg-migrate](https://salsita.github.io/node-pg-migrate/).

## Configuración inicial

```bash
cd Backend/database
npm install
```

Copia el archivo de entorno y configura tu conexión:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales reales:

```
DATABASE_URL=postgresql://postgres:tu_password@localhost:5432/emaseo_db
```

> `.env` está en `.gitignore`. Nunca lo subas al repositorio.

## Comandos

### Aplicar todas las migraciones pendientes

```bash
npm run migrate:up
```

### Revertir la última migración

```bash
npm run migrate:down
```

### Crear una nueva migración

```bash
npm run migrate:create -- nombre-de-la-migracion
```

Esto genera un archivo en `migrations/` con timestamp, por ejemplo:
`migrations/1715000000000_nombre-de-la-migracion.js`

Edita ese archivo para definir los cambios `up` y `down`:

```js
exports.up = (pgm) => {
  pgm.createTable('ejemplo', {
    id: 'id',
    nombre: { type: 'varchar(100)', notNull: true },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('ejemplo');
};
```

## Estado de migraciones

node-pg-migrate crea automáticamente la tabla `pgmigrations` en la base de datos
para registrar qué migraciones se han aplicado y cuándo.

## Migraciones SQL existentes

Los archivos `.sql` en este directorio (`01_init_schema.sql`, etc.) son migraciones
manuales anteriores a la adopción de este tooling. No se ejecutan con `npm run migrate:up`.
Su conversión al formato node-pg-migrate es una tarea pendiente separada.
