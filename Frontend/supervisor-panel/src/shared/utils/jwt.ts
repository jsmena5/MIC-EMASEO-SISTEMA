import { jwtDecode } from "jwt-decode";

export type AuthUser = {
  nombre: string;
  rol: string;
};

export const getUserFromToken = (token: string) => jwtDecode<AuthUser>(token);

export const getStoredUser = () => {
  const token = localStorage.getItem("token");

  if (!token) {
    return null;
  }

  try {
    return getUserFromToken(token);
  } catch {
    localStorage.removeItem("token");
    return null;
  }
};
