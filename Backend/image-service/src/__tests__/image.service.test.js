import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/imageValidation.js', () => ({
  validateImageBufferDeep: vi.fn().mockResolvedValue({ valid: true }),
  validateImageBuffer: vi.fn().mockReturnValue({ valid: true }),
  MIN_FILE_BYTES: 512,
  MIN_SIDE_PX: 64,
  getImageDimensions: vi.fn().mockReturnValue({ width: 640, height: 480 }),
}));

vi.mock('../mlCircuitBreaker.js', () => ({
  mlBreaker: {
    fire: vi.fn().mockResolvedValue({ task_id: 'celery-task-uuid' }),
  },
  ML_DEGRADED_CODE: 'EOPENBREAKER',
  // Mock positivo por defecto (has_waste=true); se sobreescribe en tests individuales
  pollMlTask: vi.fn().mockResolvedValue({
    has_waste: true,
    prioridad: 'ALTA',
    nivel_acumulacion: 'ALTO',
    tipo_residuo: 'MIXTO',
    volumen_estimado_m3: 1.2,
    confianza: 0.91,
    detecciones: [],
    tiempo_inferencia_ms: 450,
    modelo_nombre: 'yolov8-test',
  }),
  checkMlTaskStatus: vi.fn(),
  POLL_TIMEOUT_MS: 120000,
}));

// ── Fixtures de resultados ML ─────────────────────────────────────────────────
// Definidas DESPUÉS de los vi.mock para evitar el error de hoisting.

// ML positivo (has_waste=true)
const mlPositiveResult = {
  has_waste: true,
  prioridad: 'ALTA',
  nivel_acumulacion: 'ALTO',
  tipo_residuo: 'MIXTO',
  volumen_estimado_m3: 1.2,
  confianza: 0.91,
  detecciones: [],
  tiempo_inferencia_ms: 450,
  modelo_nombre: 'yolov8-test',
};

// ML negativo — confianza alta → debe generar DESCARTADO
const mlNegativeHighConf = {
  has_waste: false,
  confianza: 0.88,
  detecciones: [],
  tiempo_inferencia_ms: 320,
  modelo_nombre: 'yolov8-test',
  tipo_residuo: null,
  nivel_acumulacion: null,
  volumen_estimado_m3: null,
};

// ML negativo — confianza baja → debe generar EN_REVISION
const mlNegativeLowConf = {
  has_waste: false,
  confianza: 0.45,
  detecciones: [],
  tiempo_inferencia_ms: 310,
  modelo_nombre: 'yolov8-test',
  tipo_residuo: null,
  nivel_acumulacion: null,
  volumen_estimado_m3: null,
};

// PutObjectCommand es el único comando S3 usado ahora (DeleteObjectCommand fue eliminado)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  PutObjectCommand: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { pool } from '../db.js';
import { analyzeImage } from '../services/image.service.js';
import { pollMlTask } from '../mlCircuitBreaker.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Coordenadas válidas dentro de Ecuador (Quito)
const QUITO = { latitude: -0.1807, longitude: -78.4678 };
const USER_ID = 'citizen-uuid-123';

// Base64 minimal válido (contenido arbitrario — validateImageBufferDeep está mockeado)
const VALID_IMAGE_B64 = Buffer.alloc(2000, 0xff).toString('base64');

// Mock de pool.connect para transacciones (finalizeIncident / finalizeNegativeCase)
function mockPoolConnect(queryFn) {
  const client = {
    query:   queryFn ?? vi.fn().mockResolvedValue({ rows: [{ created_at: new Date() }], rowCount: 1 }),
    release: vi.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

// ── Tests: analyzeImage (validación de entrada) ───────────────────────────────

describe('analyzeImage — flujo de reporte de incidente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevenir que setImmediate dispare runMlAnalysis durante los tests
    vi.spyOn(global, 'setImmediate').mockImplementation(() => {});
    // Mock de pool.query para el INSERT de incidents
    pool.query.mockResolvedValue({ rows: [{ id: 'incident-uuid-abc' }] });
  });

  it('retorna 202 con task_id y poll_url para una imagen válida en Ecuador', async () => {
    const result = await analyzeImage({
      image: VALID_IMAGE_B64,
      ...QUITO,
      userId: USER_ID,
    });

    expect(result.httpStatus).toBe(202);
    expect(result.estado).toBe('PROCESANDO');
    expect(result.task_id).toBe('incident-uuid-abc');
    expect(result.poll_url).toContain('incident-uuid-abc');
  });

  it('ejecuta INSERT en incidents.incidents con los datos correctos', async () => {
    await analyzeImage({
      image: VALID_IMAGE_B64,
      ...QUITO,
      descripcion: 'Basura en esquina',
      userId: USER_ID,
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO incidents.incidents'),
      expect.any(Array)
    );
    const insertParams = pool.query.mock.calls[0][1];
    expect(insertParams[0]).toBe(USER_ID); // $1 = reportado_por
  });

  it('persiste ubicacion_aproximada = true cuando el GPS es inexacto', async () => {
    await analyzeImage({
      image: VALID_IMAGE_B64,
      ...QUITO,
      userId: USER_ID,
      ubicacion_aproximada: true,
    });

    const insertParams = pool.query.mock.calls[0][1];
    // $7 = ubicacion_aproximada
    expect(insertParams[6]).toBe(true);
  });

  it('persiste ubicacion_aproximada = false por defecto', async () => {
    await analyzeImage({
      image: VALID_IMAGE_B64,
      ...QUITO,
      userId: USER_ID,
    });

    const insertParams = pool.query.mock.calls[0][1];
    expect(insertParams[6]).toBe(false);
  });

  it('lanza error 422 con coordenadas fuera de Ecuador (Nueva York)', async () => {
    await expect(
      analyzeImage({
        image: VALID_IMAGE_B64,
        latitude: 40.7128,
        longitude: -74.006,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('lanza error 401 si falta el userId', async () => {
    await expect(
      analyzeImage({
        image: VALID_IMAGE_B64,
        ...QUITO,
        userId: null,
      })
    ).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('lanza error 400 si falta la imagen', async () => {
    await expect(
      analyzeImage({ latitude: QUITO.latitude, longitude: QUITO.longitude, userId: USER_ID })
    ).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('lanza error 400 si faltan las coordenadas', async () => {
    await expect(
      analyzeImage({ image: VALID_IMAGE_B64, userId: USER_ID })
    ).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('lanza error 413 si la imagen supera el límite de tamaño (> 10 MB base64)', async () => {
    const tooBig = 'A'.repeat(11 * 1024 * 1024);
    await expect(
      analyzeImage({ image: tooBig, ...QUITO, userId: USER_ID })
    ).rejects.toMatchObject({ httpStatus: 413 });
  });

  it('lanza error 422 si validateImageBufferDeep rechaza la imagen', async () => {
    const { validateImageBufferDeep } = await import('../utils/imageValidation.js');
    validateImageBufferDeep.mockResolvedValueOnce({ valid: false, message: 'Imagen corrupta' });

    await expect(
      analyzeImage({ image: VALID_IMAGE_B64, ...QUITO, userId: USER_ID })
    ).rejects.toMatchObject({ httpStatus: 422 });
  });
});

// ── Tests: getTaskStatus — respuestas API para nuevos estados (migración 032) ─
//
// Verifican que la API devuelve los campos correctos para cada estado del
// nuevo ciclo de vida (EN_REVISION, DESCARTADO, FALLIDO con decision_automatica).
// Usa mocks directos de pool.query para simular cada estado de BD sin tocar
// el pipeline asíncrono ML.

describe('getTaskStatus — respuestas API para nuevos estados (migración 032)', () => {
  const TASK_ID = 'incident-uuid-test';
  const USER_ID_POLL = 'citizen-uuid-poll';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: construye un mock de fila de BD para getTaskStatus
  function mockDbRow(overrides = {}) {
    return {
      id: TASK_ID,
      estado: 'PENDIENTE',
      prioridad: null,
      descripcion: null,
      nota_fallo: null,
      decision_automatica: null,
      confianza_decision: null,
      imagen_auditoria_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      latitud: -0.18,
      longitud: -78.47,
      image_url: null,
      nivel_acumulacion: null,
      volumen_estimado_m3: null,
      tipo_residuo: null,
      confianza: null,
      tiempo_inferencia_ms: null,
      num_detecciones: null,
      ...overrides,
    };
  }

  it('estado EN_REVISION → devuelve 200 con decision_automatica=REVISION_REQUERIDA e imagen_auditoria_url', async () => {
    const { getTaskStatus } = await import('../services/image.service.js');
    const auditUrl = 'https://minio.example.com/bucket/incidents/test.jpg';
    pool.query.mockResolvedValueOnce({
      rows: [mockDbRow({
        estado: 'EN_REVISION',
        decision_automatica: 'REVISION_REQUERIDA',
        confianza_decision: 0.45,
        imagen_auditoria_url: auditUrl,
        nota_fallo: 'ML no detectó residuos (confianza: 45.0 %)',
      })],
    });

    const result = await getTaskStatus(TASK_ID, USER_ID_POLL);

    expect(result.httpStatus).toBe(200);
    expect(result.estado).toBe('EN_REVISION');
    expect(result.decision_automatica).toBe('REVISION_REQUERIDA');
    expect(result.confianza_decision).toBe(0.45);
    expect(result.imagen_auditoria_url).toBe(auditUrl);
    expect(result.message).toContain('supervisor');
  });

  it('estado DESCARTADO → devuelve 200 con decision_automatica=RECHAZO_CONFIABLE e imagen_auditoria_url', async () => {
    const { getTaskStatus } = await import('../services/image.service.js');
    const auditUrl = 'https://minio.example.com/bucket/incidents/reject.jpg';
    pool.query.mockResolvedValueOnce({
      rows: [mockDbRow({
        estado: 'DESCARTADO',
        decision_automatica: 'RECHAZO_CONFIABLE',
        confianza_decision: 0.88,
        imagen_auditoria_url: auditUrl,
        nota_fallo: 'ML no detectó residuos (confianza: 88.0 %)',
      })],
    });

    const result = await getTaskStatus(TASK_ID, USER_ID_POLL);

    expect(result.httpStatus).toBe(200);
    expect(result.estado).toBe('DESCARTADO');
    expect(result.decision_automatica).toBe('RECHAZO_CONFIABLE');
    expect(result.confianza_decision).toBe(0.88);
    expect(result.imagen_auditoria_url).toBe(auditUrl);
  });

  it('estado FALLIDO → devuelve 200 con decision_automatica=ERROR_TECNICO y mensaje de error técnico', async () => {
    const { getTaskStatus } = await import('../services/image.service.js');
    pool.query.mockResolvedValueOnce({
      rows: [mockDbRow({
        estado: 'FALLIDO',
        decision_automatica: 'ERROR_TECNICO',
        nota_fallo: 'health check: ECONNREFUSED',
        imagen_auditoria_url: null,
      })],
    });

    const result = await getTaskStatus(TASK_ID, USER_ID_POLL);

    expect(result.httpStatus).toBe(200);
    expect(result.estado).toBe('FALLIDO');
    expect(result.decision_automatica).toBe('ERROR_TECNICO');
    expect(result.nota_fallo).toBe('health check: ECONNREFUSED');
    // Mensaje diferenciado de "no se detectaron residuos"
    expect(result.message).toContain('error técnico');
  });

  it('estado FALLIDO con imagen guardada → expone imagen_auditoria_url para auditoría', async () => {
    const { getTaskStatus } = await import('../services/image.service.js');
    const auditUrl = 'https://minio.example.com/bucket/incidents/failed.jpg';
    pool.query.mockResolvedValueOnce({
      rows: [mockDbRow({
        estado: 'FALLIDO',
        decision_automatica: 'ERROR_TECNICO',
        nota_fallo: 'ML polling: ML inference failed: OOM',
        imagen_auditoria_url: auditUrl,  // imagen preservada aunque falló
      })],
    });

    const result = await getTaskStatus(TASK_ID, USER_ID_POLL);

    expect(result.httpStatus).toBe(200);
    expect(result.imagen_auditoria_url).toBe(auditUrl);
  });

  it('estado PENDIENTE → devuelve decision_automatica=INCIDENTE_VALIDO', async () => {
    const { getTaskStatus } = await import('../services/image.service.js');
    pool.query.mockResolvedValueOnce({
      rows: [mockDbRow({
        estado: 'PENDIENTE',
        prioridad: 'ALTA',
        decision_automatica: 'INCIDENTE_VALIDO',
        image_url: 'https://minio.example.com/bucket/incidents/valid.jpg',
        nivel_acumulacion: 'ALTO',
        tipo_residuo: 'MIXTO',
        confianza: 0.91,
        num_detecciones: 3,
      })],
    });

    const result = await getTaskStatus(TASK_ID, USER_ID_POLL);

    expect(result.httpStatus).toBe(200);
    expect(result.estado).toBe('PENDIENTE');
    expect(result.decision_automatica).toBe('INCIDENTE_VALIDO');
    expect(result.prioridad).toBe('ALTA');
  });
});
