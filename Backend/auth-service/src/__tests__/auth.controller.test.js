import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks (hoisted por vitest antes de los imports del módulo) ────────────────

vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/mailer.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/crypto.js', () => ({
  hashToken: (t) => `sha256:${t}`,
  generateOpaqueToken: vi.fn().mockReturnValue('opaque-refresh-token-abc'),
  generateOtp: vi.fn().mockReturnValue('654321'),
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('jwt-access-token-mock'),
    verify: vi.fn(),
  },
}));

// ── Imports del módulo bajo prueba ────────────────────────────────────────────

import { pool } from '../db.js';
import { forgotPassword, resetPassword, verifyResetOtp } from '../controllers/auth.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
};

const makeTxClient = (...queryResults) => {
  const client = { query: vi.fn(), release: vi.fn() };
  queryResults.forEach((r) => client.query.mockResolvedValueOnce(r ?? {}));
  return client;
};

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  const GENERIC_MSG = 'Si el correo está registrado, recibirás un código de verificación.';

  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si falta el campo email', async () => {
    const req = { body: {} };
    const res = mockRes();
    await forgotPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve mensaje genérico cuando el email NO existe (evita enumeración)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { email: 'desconocido@example.com' } };
    const res = mockRes();
    await forgotPassword(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: GENERIC_MSG });
  });

  it('devuelve el mismo mensaje genérico cuando el email SÍ existe', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const req = { body: { email: 'usuario@emaseo.gob.ec' } };
    const res = mockRes();
    await forgotPassword(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: GENERIC_MSG });
  });

  it('la respuesta es idéntica sin importar si el email existe o no (anti-enumeración)', async () => {
    // Email que no existe
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res1 = mockRes();
    await forgotPassword({ body: { email: 'no@existe.com' } }, res1);
    const body1 = res1.json.mock.calls[0][0]; // capturar antes de resetear

    // Resetear solo pool.query para la segunda petición
    pool.query.mockReset();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res2 = mockRes();
    await forgotPassword({ body: { email: 'si@existe.com' } }, res2);
    const body2 = res2.json.mock.calls[0][0];

    expect(body1).toEqual(body2);
  });

  it('almacena el OTP hasheado, no el OTP en claro', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const req = { body: { email: 'usuario@emaseo.gob.ec' } };
    await forgotPassword(req, mockRes());

    // Tercer pool.query = INSERT token; segundo param = [userId, otpHash, expiresAt]
    const insertCall = pool.query.mock.calls[2];
    const storedHash = insertCall[1][1];
    // El hash debe ser 'sha256:654321' (nuestro hashToken mock), no el OTP '654321'
    expect(storedHash).not.toBe('654321');
    expect(storedHash).toContain('sha256:');
  });
});

// ── verifyResetOtp ────────────────────────────────────────────────────────────

describe('verifyResetOtp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan email u otp', async () => {
    const res = mockRes();
    await verifyResetOtp({ body: { email: 'u@e.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 cuando el OTP no coincide o está expirado', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uid' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await verifyResetOtp({ body: { email: 'u@e.com', otp: '000000' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 200 con OTP válido', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uid' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'token-id' }] });
    const res = mockRes();
    await verifyResetOtp({ body: { email: 'u@e.com', otp: '654321' } }, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Código válido' });
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan campos requeridos', async () => {
    const res = mockRes();
    await resetPassword({ body: { email: 'u@e.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza contraseñas de menos de 8 caracteres', async () => {
    const res = mockRes();
    await resetPassword({ body: { email: 'u@e.com', otp: '654321', newPassword: 'Abc1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/8 caracteres/i);
  });

  it('rechaza contraseñas sin mayúsculas', async () => {
    const res = mockRes();
    await resetPassword({ body: { email: 'u@e.com', otp: '654321', newPassword: 'minuscula123' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/mayúscula/i);
  });

  it('rechaza contraseñas sin minúsculas', async () => {
    const res = mockRes();
    await resetPassword({ body: { email: 'u@e.com', otp: '654321', newPassword: 'MAYUSCULA123' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/minúscula/i);
  });

  it('rechaza contraseñas sin dígitos', async () => {
    const res = mockRes();
    await resetPassword({ body: { email: 'u@e.com', otp: '654321', newPassword: 'SinNumeros!' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/número/i);
  });

  it('actualiza la contraseña y devuelve tokens con OTP válido y password fuerte', async () => {
    const client = makeTxClient(
      undefined, // BEGIN
      undefined, // UPDATE password_hash
      undefined, // UPDATE token used
      undefined, // UPDATE refresh_tokens revoked
      undefined, // INSERT refresh_token
      undefined  // COMMIT
    );
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'uid', username: 'usr_abc', rol: 'CIUDADANO', nombre: 'Ana', apellido: 'G' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'token-id' }] });

    const res = mockRes();
    await resetPassword({
      body: { email: 'u@e.com', otp: '654321', newPassword: 'ValidPass1!' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Contraseña actualizada correctamente',
        token: 'jwt-access-token-mock',
        refreshToken: 'opaque-refresh-token-abc',
      })
    );
    // Transacción debe hacer COMMIT
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    client.release();
  });

  it('hace ROLLBACK si algo falla dentro de la transacción', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('DB error simulado')); // UPDATE falla
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'uid', username: 'usr_abc', rol: 'CIUDADANO', nombre: 'Ana', apellido: 'G' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'token-id' }] });

    const res = mockRes();
    await resetPassword({
      body: { email: 'u@e.com', otp: '654321', newPassword: 'ValidPass1!' },
    }, res);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
