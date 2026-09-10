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
import { EstrattoClientePage } from "@/pages/cliente/Estratto";
import { IntermediariClientePage } from "@/pages/cliente/IntermediariCliente";
import { FidelizzazionePage } from "@/pages/cliente/Fidelizzazione";
import { ControlloRuiPage } from "@/pages/cliente/ControlloRui";
import { OpportunityPage } from "@/pages/cliente/Opportunity";
import { VOCI, VOCI_CLIENTE } from "@/nav";

function RichiedeAdmin() {
  const { email, ruolo } = useAuth();
  if (!email) return <Navigate to="/login" replace />;
  if (ruolo === "cliente") return <Navigate to="/cliente" replace />;
  if (ruolo !== "admin") return <Navigate to="/login" replace />;
  return (
    <DashboardShell voci={VOCI} homePath="/app">
      <Outlet />
    </DashboardShell>
  );
}

function RichiedeCliente() {
  const { email, ruolo, cliente } = useAuth();
  if (!email) return <Navigate to="/login" replace />;
  if (ruolo === "admin") return <Navigate to="/app" replace />;
  if (ruolo !== "cliente" || !cliente) return <Navigate to="/login" replace />;
  return (
    <DashboardShell
      voci={VOCI_CLIENTE}
      homePath="/cliente"
      titoloMarchio={cliente.denominazione}
      sottotitolo={`Area cliente · ${cliente.rui}`}
    >
      <Outlet />
    </DashboardShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<RichiedeAdmin />}>
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
      <Route path="/cliente" element={<RichiedeCliente />}>
        <Route index element={<EstrattoClientePage />} />
        <Route path="intermediari" element={<IntermediariClientePage />} />
        <Route path="fidelizzazione" element={<FidelizzazionePage />} />
        <Route path="controllo-rui" element={<ControlloRuiPage />} />
        <Route path="opportunity" element={<OpportunityPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
