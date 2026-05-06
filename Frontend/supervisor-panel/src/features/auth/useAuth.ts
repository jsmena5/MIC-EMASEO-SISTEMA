import { useState } from "react";
import { loginRequest } from "./authService";
import { getUserFromToken } from "../../shared/utils/jwt";
import type { AuthUser } from "../../shared/utils/jwt";
import { getStoredUser, logoutStoredSession, storeAuthTokens } from "./authSession";

export const useAuth = () => {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  const login = async (email: string, password: string) => {
    const data = await loginRequest(email, password);
    storeAuthTokens(data);

    const decoded = getUserFromToken(data.token);
    setUser(decoded);

    return decoded;
  };

  const logout = async () => {
    await logoutStoredSession();
    setUser(null);
  };

  return { user, login, logout };
};
