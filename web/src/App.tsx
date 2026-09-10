import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { DashboardShell } from "@/components/DashboardShell";
import { LandingPage } from "@/pages/Landing";
import { LoginPage } from "@/pages/Login";
import { OverviewPage } from "@/pages/Overview";
import {
  CarichePage,
  IntermediariPage,
  IntermediarioPage,
  MandatiPage,
  RetePage,
  SediPage,
} from "@/pages/Liste";
import { AggiornamentoPage } from "@/pages/Aggiornamento";
import { QueryPage } from "@/pages/Query";
import { DocumentazionePage } from "@/pages/Documentazione";

function RichiedeAccesso() {
  const { email, ruolo } = useAuth();
  if (!email || ruolo !== "admin") return <Navigate to="/login" replace />;
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<RichiedeAccesso />}>
        <Route index element={<OverviewPage />} />
        <Route path="intermediari" element={<IntermediariPage />} />
        <Route path="intermediari/:rui" element={<IntermediarioPage />} />
        <Route path="rete" element={<RetePage />} />
        <Route path="sedi" element={<SediPage />} />
        <Route path="mandati" element={<MandatiPage />} />
        <Route path="cariche" element={<CarichePage />} />
        <Route path="query" element={<QueryPage />} />
        <Route path="documentazione" element={<DocumentazionePage />} />
        <Route path="aggiornamento" element={<AggiornamentoPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
