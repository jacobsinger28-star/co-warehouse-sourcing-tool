import { CheckCircle2, AlertTriangle, XCircle, Building2 } from "lucide-react";

const cards = [
  {
    key: "total",
    label: "Total Reviewed",
    icon: Building2,
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
  },
  {
    key: "actionable",
    label: "Actionable",
    icon: CheckCircle2,
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  {
    key: "tentative",
    label: "Tentative",
    icon: AlertTriangle,
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
  {
    key: "passed",
    label: "Pass",
    icon: XCircle,
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
];

export default function SummaryCards({ summary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map(({ key, label, icon: Icon, bg, text, border }) => (
        <div
          key={key}
          className={`flex flex-col items-center p-5 rounded-xl border ${bg} ${border}`}
        >
          <Icon className={`${text} mb-2`} size={28} />
          <span className={`text-3xl font-bold ${text}`}>{summary[key] ?? 0}</span>
          <span className={`text-sm mt-1 font-medium ${text} opacity-80`}>{label}</span>
        </div>
      ))}
    </div>
  );
}
