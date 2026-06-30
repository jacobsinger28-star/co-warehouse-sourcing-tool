import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

const SCORE_STYLES = {
  Actionable: {
    badge: "bg-green-100 text-green-800 border border-green-300",
    row:   "hover:bg-green-50",
  },
  Tentative: {
    badge: "bg-yellow-100 text-yellow-800 border border-yellow-300",
    row:   "hover:bg-yellow-50",
  },
  Pass: {
    badge: "bg-red-100 text-red-800 border border-red-300",
    row:   "hover:bg-red-50",
  },
};

const FILTER_OPTIONS = ["All", "Actionable", "Tentative", "Pass"];

const ENRICHMENT_COLS = [
  "Score_Category",
  "Implied_Purchase_Price",
  "Power_Density",
  "Truck_Court_Depth",
  "Pricing_Delta",
  "Scoring_Reason",
];

function fmt(val) {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "number" && val > 1000) return val.toLocaleString();
  return val;
}

export default function ResultsTable({ rows, onSelectionChange }) {
  const [filter, setFilter]     = useState("All");
  const [sortKey, setSortKey]   = useState("Score_Category");
  const [sortAsc, setSortAsc]   = useState(true);
  const [selected, setSelected] = useState(new Set());

  if (!rows || rows.length === 0) return null;

  const actionableRows = rows.filter((r) => r.Score_Category === "Actionable");
  const allKeys        = Object.keys(rows[0]);
  const dataCols       = allKeys.filter((k) => !ENRICHMENT_COLS.includes(k)).slice(0, 7);
  const displayCols    = [...dataCols, ...ENRICHMENT_COLS.filter((c) => allKeys.includes(c))];

  const filtered = filter === "All" ? rows : rows.filter((r) => r.Score_Category === filter);
  const sorted   = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(true); }
  };

  const toggleRow = (row, idx) => {
    const key = idx;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    onSelectionChange?.(rows.filter((_, i) => next.has(i)));
  };

  const allActionableSelected =
    actionableRows.length > 0 &&
    actionableRows.every((_, i) => selected.has(rows.indexOf(actionableRows[i])));

  const toggleAllActionable = () => {
    const next = new Set(selected);
    if (allActionableSelected) {
      actionableRows.forEach((r) => next.delete(rows.indexOf(r)));
    } else {
      actionableRows.forEach((r) => next.add(rows.indexOf(r)));
    }
    setSelected(next);
    onSelectionChange?.(rows.filter((_, i) => next.has(i)));
  };

  const colLabel = (col) => ({
    Score_Category:         "Score",
    Implied_Purchase_Price: "Implied Price ($/SF)",
    Power_Density:          "Power Density",
    Truck_Court_Depth:      "Truck Court",
    Pricing_Delta:          "Pricing Delta",
    Scoring_Reason:         "Scoring Reason",
  }[col] ?? col.replace(/_/g, " "));

  const isActionable = (row) => row.Score_Category === "Actionable";

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap items-center">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => setFilter(opt)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition
              ${filter === opt
                ? "bg-[#1F3864] text-white border-[#1F3864]"
                : "bg-white text-slate-600 border-slate-300 hover:border-[#1F3864] hover:text-[#1F3864]"
              }`}
          >
            {opt}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-400">
          {sorted.length} of {rows.length} properties
          {selected.size > 0 && (
            <span className="ml-2 text-green-700 font-medium">
              · {selected.size} selected
            </span>
          )}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm scrollbar-thin">
        <table className="min-w-full text-sm">
          <thead className="bg-[#1F3864] text-white">
            <tr>
              {/* Checkbox header — only shown when Actionable rows exist */}
              {actionableRows.length > 0 && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    title="Select all actionable"
                    checked={allActionableSelected}
                    onChange={toggleAllActionable}
                    className="accent-green-400 w-4 h-4 cursor-pointer"
                  />
                </th>
              )}
              {displayCols.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-3 py-3 text-left font-semibold whitespace-nowrap cursor-pointer
                    select-none hover:bg-[#2E5090] transition"
                >
                  <span className="flex items-center gap-1">
                    {colLabel(col)}
                    {sortKey === col
                      ? sortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                      : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sorted.map((row, sortedIdx) => {
              const originalIdx = rows.indexOf(row);
              const styles      = SCORE_STYLES[row.Score_Category] ?? { badge: "", row: "" };
              const actionable  = isActionable(row);
              const checked     = selected.has(originalIdx);
              return (
                <tr
                  key={sortedIdx}
                  className={`transition ${styles.row} ${checked ? "bg-green-50" : ""}`}
                >
                  {actionableRows.length > 0 && (
                    <td className="px-3 py-2.5 align-top">
                      {actionable && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(row, originalIdx)}
                          className="accent-green-600 w-4 h-4 cursor-pointer mt-0.5"
                        />
                      )}
                    </td>
                  )}
                  {displayCols.map((col) => (
                    <td key={col} className="px-3 py-2.5 align-top max-w-xs">
                      {col === "Score_Category" ? (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${styles.badge}`}>
                          {row[col]}
                        </span>
                      ) : col === "Scoring_Reason" ? (
                        <span className="text-slate-500 text-xs leading-relaxed">{fmt(row[col])}</span>
                      ) : (
                        <span className="text-slate-700">{fmt(row[col])}</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
