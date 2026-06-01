export interface PreRegisterUser {
  primer_nombre:   string
  segundo_nombre?: string
  primer_apellido: string
  segundo_apellido: string
  cedula: string
  email:  string
}

export interface LoginUser {
  email:    string
  password: string
}

export interface OtpVerify {
  email: string
  otp:   string
}

export interface SetPasswordData {
  email:    string
  password: string
}

export interface PasswordResetData {
  email:       string
  otp:         string
  newPassword: string
}

export type Sexo = "Masculino" | "Femenino" | "Otro" | "Prefiero no decir"

export interface CitizenProfile {
  primer_nombre:    string
  segundo_nombre:   string | null
  primer_apellido:  string
  segundo_apellido: string | null
  cedula_masked:    string
  email:            string
  username:         string
  telefono:         string | null
  fecha_nacimiento: string | null  // ISO date YYYY-MM-DD
  sexo:             Sexo | null
  created_at:       string
}

export interface UpdateProfileData {
  telefono?:         string | null
  fecha_nacimiento?: string | null
  sexo?:             Sexo | null
}

/** @deprecated Reemplazado por PreRegisterUser con 4 campos de nombre */
export interface RegisterUser extends PreRegisterUser {
  username: string
  password: string
}
