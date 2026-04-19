import { jwtDecode } from "jwt-decode";
export const getUserFromToken = (token: string) => jwtDecode<any>(token);