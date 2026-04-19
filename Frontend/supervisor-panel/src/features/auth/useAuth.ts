import { useState } from "react";
import { loginRequest } from "./authService";
import { getUserFromToken } from "../../shared/utils/jwt";

export const useAuth = () => {
  const [user, setUser] = useState<any>(null);

  const login = async (username: string, password: string) => {
    const data = await loginRequest(username, password);
    localStorage.setItem("token", data.token);

    const decoded = getUserFromToken(data.token);
    setUser(decoded);

    return decoded;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return { user, login, logout };
};