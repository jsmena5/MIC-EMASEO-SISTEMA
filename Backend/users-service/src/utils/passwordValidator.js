/**
 * Valida que una contraseña cumpla los requisitos mínimos de seguridad:
 *   - Al menos 8 caracteres
 *   - Al menos 1 letra mayúscula
 *   - Al menos 1 letra minúscula
 *   - Al menos 1 dígito numérico
 *
 * @param {string} password
 * @returns {{ valid: boolean, message?: string }}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'La contraseña es requerida.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'La contraseña debe contener al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'La contraseña debe contener al menos una letra minúscula.' };
  }
  if (!/d/.test(password)) {
    return { valid: false, message: 'La contraseña debe contener al menos un número.' };
  }
  return { valid: true };
}
