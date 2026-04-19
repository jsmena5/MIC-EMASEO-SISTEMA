import { useNavigate } from "react-router-dom";
import { getUserFromToken } from "../../shared/utils/jwt";

export default function Topbar() {
  const navigate = useNavigate();

  const token = localStorage.getItem("token")!;
  const user = getUserFromToken(token);

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/");
  };

  return (
    <div className="bg-black/60 backdrop-blur-md p-4 flex justify-between items-center border-b border-white/10">
      
      {/* IZQUIERDA */}
      <h1 className="text-sm md:text-base text-white font-semibold">
        Panel Administrativo
      </h1>

      {/* DERECHA */}
      <div className="flex items-center gap-4">
        
        <span className="text-sm text-blue-300 font-medium">
          {user.nombre} ({user.rol})
        </span>

        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm transition"
        >
          Salir
        </button>

      </div>
    </div>
  );
}