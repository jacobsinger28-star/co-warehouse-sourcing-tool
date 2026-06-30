import { useState } from "react";
import axios from "axios";
import { FileDown, Loader2, RotateCcw, Zap, User, Send, TableProperties, Sparkles } from "lucide-react";
import UploadZone from "./components/UploadZone";
import SummaryCards from "./components/SummaryCards";
import ResultsTable from "./components/ResultsTable";
import EmailConfig from "./components/EmailConfig";
import LiveSearch from "./components/LiveSearch";

export default function App() {
  const [tab, setTab] = useState("score");

  // Score Leads state
  const [file, setFile]               = useState(null);
  const [analystName, setAnalystName] = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [result, setResult]           = useState(null);
  const [downloading, setDownloading]         = useState(false);
  const [selectedRows, setSelectedRows]       = useState([]);
  const [importing, setImporting]             = useState(false);
  const [importResult, setImportResult]       = useState(null);
  const [demoing, setDemoing]                 = useState(false);

  const handleFileSelect = (f) => { setFile(f); setResult(null); setError(null); };
  const handleClear      = () => { setFile(null); setResult(null); setError(null); setSelectedRows([]); setImportResult(null); };

  const handleLoadDemo = async () => {
    setDemoing(true);
    setError(null);
    setResult(null);
    setFile(null);
    try {
      const { data } = await axios.post("/demo/score");
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail ?? "Could not load demo. Is the backend running?");
    } finally {
      setDemoing(false);
    }
  };

  const handleScore = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    form.append("analyst_name", analystName);
    try {
      const { data } = await axios.post("/score", form);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail ?? "Scoring failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const handlePipedrive = async () => {
    if (!selectedRows.length) return;
    setImporting(true);
    setImportResult(null);
    try {
      const { data } = await axios.post("/pipedrive/import", { rows: selectedRows, analyst_name: analystName });
      setImportResult(data);
    } catch (err) {
      setImportResult({ error: err.response?.data?.detail ?? "Import failed." });
    } finally {
      setImporting(false);
    }
  };

  const handleDownload = async () => {
    if (!file) return;
    setDownloading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("analyst_name", analystName);
    try {
      const response = await axios.post("/download", form, { responseType: "blob" });
      const cd = response.headers["content-disposition"] ?? "";
      const match = cd.match(/filename="(.+?)"/);
      const filename = match ? match[1] : "Scored_Opportunities.xlsx";
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-[#1F3864] text-white shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <span className="text-2xl">🏭</span>
          <div>
            <h1 className="text-xl font-bold leading-tight">Easybay Sourcing Tool</h1>
            <p className="text-blue-200 text-xs">Industrial Acquisition Platform</p>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 flex">
          {[
            { key: "score", label: "Score Leads" },
            { key: "live",  label: "Live Search" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-3.5 text-sm font-medium border-b-2 transition -mb-px ${
                tab === key
                  ? "border-[#1F3864] text-[#1F3864]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* ── Score Leads tab ── */}
        {tab === "score" && (
          <div className="space-y-8">
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">Upload Leads File</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleLoadDemo}
                    disabled={demoing}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
                      text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200
                      disabled:opacity-50 disabled:cursor-not-allowed transition"
                    title="Score the bundled Test_Leads_v2.xlsx to see how this works"
                  >
                    {demoing
                      ? <><Loader2 size={14} className="animate-spin" /> Loading…</>
                      : <><Sparkles size={14} /> Load Demo</>}
                  </button>
                  <a
                    href="/template"
                    download
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#1F3864] transition"
                  >
                    <TableProperties size={14} /> Download Template
                  </a>
                  {result && (
                    <button
                      onClick={handleClear}
                      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition"
                    >
                      <RotateCcw size={14} /> Start Over
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <User size={13} /> Analyst Name{" "}
                  <span className="text-slate-400">(included in Excel export &amp; email)</span>
                </label>
                <input
                  type="text"
                  value={analystName}
                  onChange={(e) => setAnalystName(e.target.value)}
                  placeholder="e.g. Sarah Chen"
                  className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <UploadZone onFileSelect={handleFileSelect} file={file} onClear={handleClear} />

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={handleScore}
                  disabled={!file || loading}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg
                    font-semibold text-sm text-white bg-[#1F3864] hover:bg-[#2E5090]
                    disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {loading
                    ? <><Loader2 size={16} className="animate-spin" /> Scoring…</>
                    : <><Zap size={16} /> Score Leads</>}
                </button>

                {result && (
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg
                      font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-700
                      disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {downloading
                      ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
                      : <><FileDown size={16} /> Download Excel</>}
                  </button>
                )}

                {result && (
                  <button
                    onClick={handlePipedrive}
                    disabled={importing || selectedRows.length === 0}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg
                      font-semibold text-sm text-white bg-violet-600 hover:bg-violet-700
                      disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title={selectedRows.length === 0 ? "Select actionable deals in the table below" : ""}
                  >
                    {importing
                      ? <><Loader2 size={16} className="animate-spin" /> Importing…</>
                      : <><Send size={16} /> Send to Pipedrive{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}</>}
                  </button>
                )}
              </div>
            </section>

            {result && (
              <>
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-slate-800">
                    Summary
                    {result.analyst_name && (
                      <span className="ml-2 text-sm font-normal text-slate-500">
                        — uploaded by{" "}
                        <span className="font-medium text-slate-700">{result.analyst_name}</span>
                      </span>
                    )}
                  </h2>
                  <SummaryCards summary={result.summary} />
                </section>

                {importResult && !importResult.error && (
                  <div className={`p-3 rounded-lg text-sm border space-y-1
                    ${importResult.failed === 0
                      ? "bg-green-50 border-green-200 text-green-800"
                      : "bg-yellow-50 border-yellow-200 text-yellow-800"}`}>
                    <div className="flex items-center gap-2 font-medium">
                      <Send size={14} />
                      {importResult.imported > 0 && (
                        <span>{importResult.imported} deal{importResult.imported !== 1 ? "s" : ""} sent to Pipedrive.</span>
                      )}
                      {importResult.failed > 0 && (
                        <span>{importResult.failed} failed.</span>
                      )}
                    </div>
                    {(importResult.results ?? []).filter((r) => !r.success).map((r, i) => (
                      <div key={i} className="text-xs pl-5 opacity-80">
                        {r.title}: {r.error}
                      </div>
                    ))}
                  </div>
                )}
                {importResult?.error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    Pipedrive import failed: {importResult.error}
                  </div>
                )}

                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-slate-800">Scored Properties</h2>
                  <ResultsTable rows={result.rows} onSelectionChange={setSelectedRows} />
                </section>

                <section>
                  <EmailConfig file={file} analystName={analystName} disabled={!file} />
                </section>
              </>
            )}

            {/* Buy Box reference */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Acquisition Criteria</h2>
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                  <p className="font-bold text-green-800 mb-2">✅ Actionable</p>
                  <ul className="space-y-1 text-green-700 list-disc list-inside">
                    <li>50k–250k SF (Single/Dual)</li>
                    <li>&lt;250k SF (Multi-tenant)</li>
                    <li>Clear Height ≥ 14'</li>
                    <li>Office &lt; 10%</li>
                    <li>Industrial Zoning</li>
                    <li>≥15A / 1,000 SF</li>
                    <li>1 dock / 15k SF</li>
                    <li>Parking ≥ 1.0/1k SF</li>
                  </ul>
                </div>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                  <p className="font-bold text-yellow-800 mb-2">⚠️ Tentative</p>
                  <ul className="space-y-1 text-yellow-700 list-disc list-inside">
                    <li>Power &lt; 15A/1k SF</li>
                    <li>Parking &lt; 1.0/1k SF</li>
                    <li>Insufficient docks</li>
                    <li>Not Sprinklered (capex to add)</li>
                    <li>Truck Court &lt; 100 ft</li>
                    <li>Office 10–15%</li>
                    <li>Missing specs</li>
                  </ul>
                </div>
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="font-bold text-red-800 mb-2">❌ Pass</p>
                  <ul className="space-y-1 text-red-700 list-disc list-inside">
                    <li>Clear Height &lt; 14'</li>
                    <li>Office &gt; 15%</li>
                    <li>Non-Industrial Zoning</li>
                    <li>Size &lt; 50k SF</li>
                    <li>Size &gt; 250k SF</li>
                  </ul>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                * HVAC is <strong>not required</strong>. Clear height below 14 ft is a hard pass.
              </p>
            </section>
          </div>
        )}

        {/* ── Live Search tab ── */}
        {tab === "live" && <LiveSearch />}
      </main>
    </div>
  );
}
