export interface PreRegisterUser {
  nombre: string
  apellido: string
  cedula: string
  email: string
}

export interface LoginUser {
  username: string
  password: string
}

export interface OtpVerify {
  email: string
  otp: string
}

export interface SetPasswordData {
  email: string
  password: string
}

/** @deprecated Reemplazado por el wizard de 3 pasos */
export interface RegisterUser extends PreRegisterUser {
  username: string
  password: string
}
