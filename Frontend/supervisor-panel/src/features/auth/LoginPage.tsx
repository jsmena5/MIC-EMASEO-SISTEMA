import { useCallback, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Location } from "react-router-dom";
import { useAuth } from "./useAuth";
import { getAuthenticatedUser } from "./authSession";

const ALLOWED_ROLES = ["ADMIN", "SUPERVISOR"];
const DEFAULT_PANEL_ROUTE = "/dashboard/home";

type LoginRouteState = {
  from?: Location;
};

export default function LoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [showSplash, setShowSplash] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const getSafeRedirectPath = useCallback(() => {
    const state = location.state as LoginRouteState | null;
    const from = state?.from;

    if (!from?.pathname.startsWith("/dashboard")) {
      return DEFAULT_PANEL_ROUTE;
    }

    return `${from.pathname}${from.search}${from.hash}`;
  }, [location.state]);

  useEffect(() => {
    const timeout = setTimeout(() => setShowSplash(false), 2500);

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAuthenticatedUser(ALLOWED_ROLES).then((user) => {
      if (!cancelled && user) {
        navigate(getSafeRedirectPath(), { replace: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [getSafeRedirectPath, navigate]);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Todos los campos son obligatorios");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const user = await login(email, password);

      if (ALLOWED_ROLES.includes(user.rol)) {
        navigate(getSafeRedirectPath(), { replace: true });
      } else {
        await logout();
        setError("No autorizado");
      }
    } catch {
      setError("Error en el login");
    } finally {
      setIsSubmitting(false);
    }
  };

  // SPLASH SCREEN
  if (showSplash) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-white to-black text-white animate-fade-in">
        <div className="text-center animate-pulse">
          <h1 className="text-3xl md:text-4xl font-bold mb-4 text-black md:text-black">
            Bienvenido
          </h1>
          <p className="text-lg text-black md:text-black">
            Panel Administrativo EMASEO EP
          </p>
          <p className="text-sm opacity-70 mt-2 text-black md:text-black">
            Solucionador de Problemas
          </p>
        </div>
      </div>
    );
  }

  // LOGIN
  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-white to-black px-4">

      <div className="w-full max-w-md bg-white/20 backdrop-blur-xl p-8 rounded-3xl shadow-2xl animate-slide-up border border-white/30">
        
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-6">
          Ingreso al Sistema
        </h1>

        {error && (
          <p className="text-red-500 text-sm mb-3 text-center">{error}</p>
        )}

        {/* EMAIL */}
        <input
          className="w-full p-3 mb-4 rounded-xl bg-white/70 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          placeholder="Correo electrónico"
          type="email"
          autoComplete="email"
          onChange={e => setEmail(e.target.value)}
        />

        {/* PASSWORD */}
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            className="w-full p-3 rounded-xl bg-white/70 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            placeholder="Contraseña"
            onChange={e => setPassword(e.target.value)}
          />

          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-sm text-gray-700 hover:text-black"
          >
            {showPassword ? "Ocultar" : "Ver"}
          </button>
        </div>

        {/* BUTTON */}
        <button
          onClick={handleLogin}
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-blue-700 to-black text-white p-3 rounded-xl font-semibold hover:scale-105 transition-transform duration-300 shadow-lg"
        >
          {isSubmitting ? "Ingresando..." : "Ingresar"}
        </button>
      </div>
    </div>
  );
}
