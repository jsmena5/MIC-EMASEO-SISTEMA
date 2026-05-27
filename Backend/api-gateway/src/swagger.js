import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MIC-EMASEO API',
      version: '1.0.0',
      description:
        'API del sistema de detección de acumulación de basura para EMASEO EP (Quito, Ecuador). ' +
        'Todos los endpoints protegidos requieren el header `Authorization: Bearer <token>`.',
      contact: { name: 'EMASEO EP', email: 'sistemas@emaseo.gob.ec' },
    },
    servers: [
      {
        url: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
        description: process.env.NODE_ENV === 'production' ? 'Producción' : 'Desarrollo local',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT emitido por /api/auth/login (TTL 15 min)',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Descripción del error' },
          },
        },
        TokenPair: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'JWT de acceso (15 min)' },
            refreshToken: { type: 'string', description: 'Refresh token opaco (7 días)' },
          },
        },
        IncidentList: {
          type: 'object',
          properties: {
            incidents: { type: 'array', items: { $ref: '#/components/schemas/Incident' } },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                pages: { type: 'integer' },
              },
            },
          },
        },
        Incident: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            estado: { type: 'string', enum: ['PROCESANDO', 'PENDIENTE', 'EN_ATENCION', 'RESUELTA', 'RECHAZADA', 'FALLIDO'] },
            prioridad: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
            descripcion: { type: 'string', nullable: true },
            latitud: { type: 'number' },
            longitud: { type: 'number' },
            image_url: { type: 'string', nullable: true },
            nivel_acumulacion: { type: 'string', nullable: true },
            tipo_residuo: { type: 'string', nullable: true },
            confianza: { type: 'number', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación y gestión de sesiones' },
      { name: 'Image', description: 'Análisis de imágenes e incidentes (ciudadano)' },
      { name: 'Incidents', description: 'Historial de incidentes del ciudadano autenticado' },
      { name: 'Operario', description: 'Acciones del operario en campo' },
    ],
    paths: {
      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Inicio de sesión',
          description:
            'Devuelve un par de tokens (access + refresh). El access token expira en 15 min; ' +
            'usa `/api/auth/refresh` para renovarlo sin volver a autenticarse.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email', example: 'admin@emaseo.gob.ec' },
                    password: { type: 'string', example: 'Test1234!' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Autenticación exitosa',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } },
            },
            400: { description: 'Campos requeridos ausentes', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Credenciales incorrectas', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Cuenta suspendida o inactiva', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      '/api/image/analyze': {
        post: {
          tags: ['Image'],
          summary: 'Enviar imagen para análisis de acumulación de residuos',
          description:
            'Acepta una imagen en Base64 junto con coordenadas GPS dentro de Ecuador. ' +
            'La respuesta es inmediata (202); el análisis ML ocurre en background. ' +
            'Hacer polling a `/api/image/status/{task_id}` para obtener el resultado.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['image', 'latitude', 'longitude'],
                  properties: {
                    image: { type: 'string', description: 'Imagen JPEG/PNG codificada en Base64 (máx. 10 MB)' },
                    latitude: { type: 'number', example: -0.1807, description: 'Latitud WGS84 — debe estar dentro de Ecuador' },
                    longitude: { type: 'number', example: -78.4678, description: 'Longitud WGS84 — debe estar dentro de Ecuador' },
                    descripcion: { type: 'string', example: 'Basura acumulada frente al parque', nullable: true },
                    ubicacion_aproximada: {
                      type: 'boolean',
                      default: false,
                      description: 'true cuando el GPS no pudo obtener ubicación exacta',
                    },
                  },
                },
              },
            },
          },
          responses: {
            202: {
              description: 'Análisis iniciado — hacer polling a poll_url',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      task_id: { type: 'string', format: 'uuid' },
                      estado: { type: 'string', example: 'PROCESANDO' },
                      message: { type: 'string' },
                      poll_url: { type: 'string', example: '/api/image/status/uuid' },
                    },
                  },
                },
              },
            },
            400: { description: 'Imagen o campos requeridos ausentes', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Token ausente o inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            413: { description: 'Imagen supera 10 MB', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            422: { description: 'Imagen inválida o coordenadas fuera de Ecuador', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      '/api/image/status/{task_id}': {
        get: {
          tags: ['Image'],
          summary: 'Consultar estado del análisis',
          description:
            'Devuelve 202 mientras el ML procesa, y 200 cuando termina (PENDIENTE o FALLIDO). ' +
            'Hacer polling cada 3-5 segundos.',
          parameters: [
            {
              in: 'path',
              name: 'task_id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'UUID del incidente retornado por /api/image/analyze',
            },
          ],
          responses: {
            200: {
              description: 'Análisis completado (incidente en estado PENDIENTE o FALLIDO)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } },
            },
            202: { description: 'Aún en procesamiento' },
            401: { description: 'Token ausente o inválido' },
            404: { description: 'Tarea no encontrada o no pertenece al usuario' },
          },
        },
      },

      '/api/incidents': {
        get: {
          tags: ['Incidents'],
          summary: 'Historial de incidentes del ciudadano autenticado',
          description: 'Lista paginada de todos los incidentes reportados por el usuario autenticado.',
          parameters: [
            { in: 'query', name: 'page', schema: { type: 'integer', default: 1, minimum: 1 }, description: 'Número de página' },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 }, description: 'Registros por página (máx. 50)' },
          ],
          responses: {
            200: {
              description: 'Lista paginada de incidentes',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/IncidentList' } } },
            },
            401: { description: 'Token ausente o inválido' },
          },
        },
      },

      '/api/operario/feedback/{incident_id}': {
        post: {
          tags: ['Operario'],
          summary: 'Enviar retroalimentación sobre un incidente',
          description:
            'El operario registra si el incidente estaba activo al llegar a la zona. ' +
            'Esta información alimenta el ciclo de reentrenamiento del modelo ML.',
          parameters: [
            {
              in: 'path',
              name: 'incident_id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['estado_real'],
                  properties: {
                    estado_real: {
                      type: 'string',
                      enum: ['CONFIRMADO', 'FALSO_POSITIVO', 'PARCIAL'],
                      description: 'Verificación en campo del incidente reportado',
                    },
                    comentario: { type: 'string', example: 'Residuos parcialmente retirados por vecinos' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Retroalimentación registrada correctamente' },
            400: { description: 'Datos inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Token ausente o inválido' },
            403: { description: 'Solo operarios, supervisores y admins pueden dar retroalimentación' },
            404: { description: 'Incidente no encontrado' },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
