import {
  BarChart3,
  Building2,
  GitBranch,
  Handshake,
  RefreshCw,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type VoceMenu = {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  descrizione: string;
};

export const VOCI: VoceMenu[] = [
  {
    id: "overview",
    label: "Overview",
    path: "/app",
    icon: BarChart3,
    descrizione: "Sintesi del registro. I numeri arriveranno al primo caricamento.",
  },
  {
    id: "intermediari",
    label: "Intermediari",
    path: "/app/intermediari",
    icon: Users,
    descrizione: "Anagrafiche iscritte al RUI. La tabella è pronta, i dati no.",
  },
  {
    id: "rete",
    label: "Rete",
    path: "/app/rete",
    icon: GitBranch,
    descrizione: "Collaborazioni fra intermediari. Il grafo si popola dopo l'import.",
  },
  {
    id: "sedi",
    label: "Sedi",
    path: "/app/sedi",
    icon: Building2,
    descrizione: "Sedi legali e operative dichiarate in registro.",
  },
  {
    id: "mandati",
    label: "Mandati",
    path: "/app/mandati",
    icon: Handshake,
    descrizione: "Rapporti con le compagnie assicurative.",
  },
  {
    id: "cariche",
    label: "Cariche",
    path: "/app/cariche",
    icon: UserCog,
    descrizione: "Cariche societarie delle persone giuridiche iscritte.",
  },
  {
    id: "aggiornamento",
    label: "Aggiornamento",
    path: "/app/aggiornamento",
    icon: RefreshCw,
    descrizione: "L'export IVASS si ricarica solo a richiesta, mai in automatico.",
  },
];
