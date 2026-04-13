/**
 * Validador de cédula ecuatoriana (personas naturales).
 * Implementa el algoritmo de módulo 10 del Registro Civil del Ecuador.
 *
 * Reglas:
 *  - Exactamente 10 dígitos numéricos
 *  - Primeros 2 dígitos = código de provincia (01-24)
 *  - Tercer dígito < 6 (cédulas de personas naturales)
 *  - Checksum: coeficientes [2,1,2,1,2,1,2,1,2] sobre los primeros 9 dígitos;
 *    si resultado >= 10 se resta 9; suma total + dígito verificador ≡ 0 (mod 10)
 *
 * @param {string} cedula - Cadena de 10 dígitos
 * @returns {boolean}
 */
export const validarCedula = (cedula) => {
  if (!cedula || !/^\d{10}$/.test(cedula)) return false

  const provincia = parseInt(cedula.substring(0, 2))
  if (provincia < 1 || provincia > 24) return false

  const tercerDigito = parseInt(cedula[2])
  if (tercerDigito >= 6) return false // Solo personas naturales

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let suma = 0

  for (let i = 0; i < 9; i++) {
    let valor = parseInt(cedula[i]) * coeficientes[i]
    if (valor >= 10) valor -= 9
    suma += valor
  }

  const digitoVerificador = parseInt(cedula[9])
  const residuo           = suma % 10
  const digitoCalculado   = residuo === 0 ? 0 : 10 - residuo

  return digitoCalculado === digitoVerificador
}
