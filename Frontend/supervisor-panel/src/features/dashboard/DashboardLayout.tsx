import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-900 via-white to-black">
          <Sidebar />

      <div className="flex-1 flex flex-col">
        <Topbar />

        <div className="p-6 flex-1 overflow-auto">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl shadow-lg animate-fade-in">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}