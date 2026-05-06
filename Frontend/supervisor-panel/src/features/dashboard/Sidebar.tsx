import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <div className="w-64 bg-white/80 backdrop-blur-md p-5 border-r border-white/10">
      <h2 className="text-xl font-bold mb-8 text-green-400">
        EMASEO EP
      </h2>

      <nav className="flex flex-col gap-4">
        <Link className="hover:text-green-400 transition" to="/dashboard/home">Home</Link>
        <Link className="hover:text-green-400 transition" to="/dashboard/users">Usuarios</Link>
        <Link className="hover:text-green-400 transition" to="/dashboard/reports">Reportes</Link>
        <Link className="hover:text-green-400 transition" to="/dashboard/mapa">🗺️ Mapa de zonas</Link>
        <Link className="hover:text-green-400 transition" to="/dashboard/settings">Configuración</Link>
      </nav>
    </div>
  );
}
