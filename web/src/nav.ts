import {
  BarChart3,
  BookOpen,
  Building2,
  GitBranch,
  Handshake,
  Heart,
  Lightbulb,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserCog,
  UserPlus,
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
    descrizione: "Sintesi del registro: agenti (A), broker (B) e collaboratori (E).",
  },
  {
    id: "intermediari",
    label: "Intermediari",
    path: "/app/intermediari",
    icon: Users,
    descrizione: "Agenti, broker e collaboratori iscritti. Cerca per nome o numero RUI.",
  },
  {
    id: "rete",
    label: "Rete",
    path: "/app/rete",
    icon: GitBranch,
    descrizione: "Per chi lavora un intermediario e chi lavora per lui. Cerca per nome o numero RUI.",
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
    descrizione: "Fai domande in italiano sul registro. Se la risposta non basta, approfondisci con l'AI.",
  },
  {
    id: "utenti",
    label: "Utenti",
    path: "/app/utenti",
    icon: UserPlus,
    descrizione: "Crea e gestisci gli accessi dei clienti.",
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
    descrizione: "Aggiorna i dati dal registro IVASS quando vuoi: non parte mai da solo.",
  },
];

export const VOCI_CLIENTE: VoceMenu[] = [
  {
    id: "estratto",
    label: "Estratto",
    path: "/cliente",
    icon: BarChart3,
    descrizione: "La tua iscrizione e i collaboratori A/B/E collegati direttamente nel RUI.",
  },
  {
    id: "intermediari",
    label: "Intermediari",
    path: "/cliente/intermediari",
    icon: Users,
    descrizione: "La tua rete, oppure cerca broker e agenti per zona e mandato.",
  },
  {
    id: "fidelizzazione",
    label: "Fidelizzazione",
    path: "/cliente/fidelizzazione",
    icon: Heart,
    descrizione: "Con chi lavora la tua rete, grafici e avvisi sui broker sorvegliati.",
  },
  {
    id: "controllo",
    label: "Controllo RUI interno",
    path: "/cliente/controllo-rui",
    icon: ShieldCheck,
    descrizione: "Controlli sull'estratto: inoperativi, sedi, mandati, qualifiche.",
  },
  {
    id: "opportunity",
    label: "Opportunity",
    path: "/cliente/opportunity",
    icon: Lightbulb,
    descrizione: "I potenziali clienti che hai salvato, con i recapiti trovati sul web e lo stato di lavoro.",
  },
];
