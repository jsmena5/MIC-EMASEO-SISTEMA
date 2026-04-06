export interface RegisterUser {
  nombre: string
  apellido: string
  username: string
  email: string
  password: string
  cedula: string
}
export interface LoginUser {
  username: string
  password: string
}