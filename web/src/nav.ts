import {
  BarChart3,
  BookOpen,
  Building2,
  GitBranch,
  Handshake,
  MessageSquare,
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
    id: "query",
    label: "Query",
    path: "/app/query",
    icon: MessageSquare,
    descrizione: "Domande in italiano sulle dimensioni del registro.",
  },
  {
    id: "documentazione",
    label: "API e documenti",
    path: "/app/documentazione",
    icon: BookOpen,
    descrizione: "Documentazione e API per software esterni.",
  },
  {
    id: "aggiornamento",
    label: "Aggiornamento",
    path: "/app/aggiornamento",
    icon: RefreshCw,
    descrizione: "L'export IVASS si ricarica solo a richiesta, mai in automatico.",
  },
];
