import { getStoredUser } from "../../auth/authSession";

export default function Home() {
  const user = getStoredUser();

  return (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-100 to-white">
      
      <div className="bg-white shadow-xl p-8 rounded-2xl animate-slide-up border border-gray-200">
        
        <h1 className="text-2xl font-bold text-blue-900 mb-2">
          Bienvenido
        </h1>

        <p className="text-gray-700">{user?.nombre ?? "Usuario no autenticado"}</p>

        <p className="text-sm text-gray-500 mt-1">
          Rol: {user?.rol ?? "Sin rol"}
        </p>

      </div>
    </div>
  );
}
