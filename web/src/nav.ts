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
    descrizione: "Sintesi del registro. Solo sezioni A, B, E.",
  },
  {
    id: "intermediari",
    label: "Intermediari",
    path: "/app/intermediari",
    icon: Users,
    descrizione: "Anagrafiche A, B, E. Cerca per nome o numero RUI.",
  },
  {
    id: "rete",
    label: "Rete",
    path: "/app/rete",
    icon: GitBranch,
    descrizione: "Principali e collaboratori a un salto. Entrambi gli estremi A/B/E.",
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
