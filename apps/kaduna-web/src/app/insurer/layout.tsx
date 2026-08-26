import RequireAuth from "@/lib/auth";
import { TokenSync } from "./TokenSync";
import "@/styles/insurer/variables.css";
import "@/styles/insurer/dashboard.css";
import "@/styles/insurer/three.css";
import "@/styles/insurer/admin.css";

export default function InsurerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth role="ops">
      <TokenSync />
      <div className="insurer-root">
        {children}
      </div>
    </RequireAuth>
  );
}
