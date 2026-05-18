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

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { pool } from '../db.js';
import { analyzeImage } from '../services/image.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Coordenadas válidas dentro de Ecuador (Quito)
const QUITO = { latitude: -0.1807, longitude: -78.4678 };
const USER_ID = 'citizen-uuid-123';

// Base64 minimal válido (contenido arbitrario — validateImageBufferDeep está mockeado)
const VALID_IMAGE_B64 = Buffer.alloc(2000, 0xff).toString('base64');

// ── Tests ─────────────────────────────────────────────────────────────────────

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
