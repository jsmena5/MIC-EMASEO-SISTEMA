export interface RegisterUser {
  nombre: string
  apellido: string
  username: string
  email: string
  password: string
  ciudad: string
  cedula: string
}
export interface LoginUser {
  username: string
  password: string
}