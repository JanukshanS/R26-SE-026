import RequireAuth from "@/lib/auth";
import { TokenSync } from "./TokenSync";
import "@/styles/insurer/three.css";

export default function InsurerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth role="ops">
      <TokenSync />
      {children}
    </RequireAuth>
  );
}
