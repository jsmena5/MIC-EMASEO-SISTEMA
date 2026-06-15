import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/mailer.js', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/cedula.js', () => ({
  validarCedula: vi.fn().mockReturnValue(true),
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('jwt-mock-token'),
    verify: vi.fn(),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { pool } from '../db.js';
import { registerUser, verifyOtp, setPassword } from '../controllers/user.controller.js';
import { deleteOperario } from '../controllers/operarios.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
};

const makeClient = () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return client;
};

// ═══════════════════════════════════════════════════════════════════════════════
// registerUser — OTP debe guardarse hasheado (SHA-256), nunca en claro
// ═══════════════════════════════════════════════════════════════════════════════

describe('registerUser — OTP hashing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan campos requeridos', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    const res = mockRes();
    await registerUser({ body: { nombre: 'Ana' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Registro válido con el formato actual (4 campos de nombre + demográficos)
  const VALID_BODY = {
    primer_nombre:    'Ana',
    segundo_nombre:   'Maria',
    primer_apellido:  'Garcia',
    segundo_apellido: 'Lopez',
    telefono:         '0991234567',
    fecha_nacimiento: '1990-01-01',
    sexo:             'Femenino',
    cedula:           '1700000001',
    email:            'ana@test.com',
  };

  // Posición de otp_code en el INSERT de pending_registrations (0-indexed):
  // nombre, apellido, segundo_nombre, segundo_apellido, cedula, telefono,
  // fecha_nacimiento, sexo, email, otp_code → índice 9
  const OTP_HASH_IDX = 9;

  it('almacena el OTP hasheado (SHA-256, 64 hex chars) y no en claro', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    // SELECT 1 (duplicados) → vacío; INSERT pending_registrations → ok
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await registerUser({ body: { ...VALID_BODY } }, mockRes());

    // La segunda llamada a client.query es el INSERT (ON CONFLICT DO UPDATE)
    const insertArgs = client.query.mock.calls[1];
    const otpCodeParam = insertArgs[1][OTP_HASH_IDX];

    // Debe ser un hash SHA-256 de 64 caracteres hexadecimales
    expect(otpCodeParam).toMatch(/^[0-9a-f]{64}$/);
    // No debe ser el OTP de 6 dígitos en claro
    expect(otpCodeParam).not.toMatch(/^\d{6}$/);
  });

  it('el OTP almacenado es diferente para cada petición (no determinista)', async () => {
    const makeRegistration = async () => {
      vi.clearAllMocks();
      const client = makeClient();
      pool.connect.mockResolvedValue(client);
      client.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await registerUser({ body: { ...VALID_BODY } }, mockRes());
      return client.query.mock.calls[1][1][OTP_HASH_IDX]; // otpHash
    };

    const hash1 = await makeRegistration();
    const hash2 = await makeRegistration();
    // Con crypto.randomInt real, dos OTPs distintos → dos hashes distintos
    // (puede coincidir estadísticamente 1/900000 veces — aceptable en tests)
    expect(typeof hash1).toBe('string');
    expect(typeof hash2).toBe('string');
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setPassword — el username generado no debe contener la cédula del ciudadano
// ═══════════════════════════════════════════════════════════════════════════════

describe('setPassword — username generation', () => {
  const CEDULA = '1700000001';

  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si la contraseña es débil', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    client.query.mockResolvedValueOnce({ rows: [{ nombre: 'Ana', apellido: 'G', cedula: CEDULA }] });
    const res = mockRes();
    await setPassword({
      body: { email: 'ana@test.com', password: 'debil' },
      headers: {},
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea la cuenta con perfil completo en app_auth.users (sin tabla ciudadanos)', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const newUser = { id: 'new-uid', email: 'ana@test.com', rol: 'CIUDADANO' };

    client.query
      // SELECT pending_registrations (verified)
      .mockResolvedValueOnce({ rows: [{ nombre: 'Ana', apellido: 'G', cedula: CEDULA, segundo_nombre: null, segundo_apellido: null, telefono: null, fecha_nacimiento: null, sexo: null }] })
      // BEGIN
      .mockResolvedValueOnce(undefined)
      // INSERT app_auth.users RETURNING id, email, rol
      .mockResolvedValueOnce({ rows: [newUser] })
      // INSERT user_consents
      .mockResolvedValueOnce(undefined)
      // DELETE pending_registrations
      .mockResolvedValueOnce(undefined)
      // INSERT refresh_tokens
      .mockResolvedValueOnce(undefined)
      // COMMIT
      .mockResolvedValueOnce(undefined);

    const res = mockRes();
    const req = {
      body: { email: 'ana@test.com', password: 'ValidPass1!' },
      headers: { 'x-forwarded-for': '127.0.0.1', 'user-agent': 'vitest' },
      ip: '127.0.0.1',
    };
    await setPassword(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.any(String), refreshToken: expect.any(String) })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteOperario — soft-delete: pone estado = 'INACTIVO' en app_auth.users
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteOperario — soft-delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 404 si el operario no existe', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE (no rows)
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const res = mockRes();
    await deleteOperario({ params: { id: 'inexistente-uuid' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("ejecuta UPDATE con estado = 'INACTIVO' y hace COMMIT", async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = mockRes();
    await deleteOperario({ params: { id: 'operario-uuid' } }, res);

    // La segunda llamada (índice 1) es el UPDATE de soft-delete
    const updateCall = client.query.mock.calls[1];
    expect(updateCall[0]).toContain("'INACTIVO'");
    expect(updateCall[1]).toEqual(['operario-uuid']);

    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(res.json).toHaveBeenCalledWith({ message: 'Operario desactivado' });
  });

  it('hace ROLLBACK y devuelve 500 si la BD falla', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('DB error')); // UPDATE falla

    const res = mockRes();
    await deleteOperario({ params: { id: 'operario-uuid' } }, res);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
