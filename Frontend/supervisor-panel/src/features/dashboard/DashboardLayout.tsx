import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top_left,_rgba(0,91,172,0.16),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eff4f8_100%)]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        <div className="flex-1 overflow-auto p-6">
          <div className="min-h-full rounded-[32px] border border-white/60 bg-white/55 p-6 shadow-[0_25px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
