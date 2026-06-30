import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Play, Square, Loader2, MapPin, Clock, AlertCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Trash2, RefreshCw, Database,
  Search, X, Send, CheckCircle2,
} from "lucide-react";
import DealMap from "./DealMap";

// localStorage key — bump the version if the cached shape ever changes
const CACHE_KEY = "easybay_listings_cache_v1";

function loadCachedState() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.listings)) return null;
    return obj;
  } catch {
    return null;
  }
}

// Whole-row tint by score category — replaces the old per-cell Score badge.
// Subtle bg so cell text stays readable; hover deepens the same hue.
const ROW_TINT = {
  Actionable: "bg-green-50 hover:bg-green-100",
  Tentative:  "bg-yellow-50 hover:bg-yellow-100",
  Pass:       "bg-red-50 hover:bg-red-100",
};

const FILTER_BTNS = [
  { key: "all",        label: "All",        color: "bg-slate-100 text-slate-700" },
  { key: "Actionable", label: "Actionable", color: "bg-green-100 text-green-700" },
  { key: "Tentative",  label: "Tentative",  color: "bg-yellow-100 text-yellow-700" },
  { key: "Pass",       label: "Pass",       color: "bg-red-100 text-red-700" },
];

const ALL_SITES = [
  { key: "cbre",    label: "CBRE" },
  { key: "jll",     label: "JLL" },
  { key: "cushman", label: "Cushman & Wakefield" },
  { key: "colliers",label: "Colliers" },
  { key: "crexi",   label: "Crexi (buy-box markets)" },
  { key: "newmark", label: "Newmark" },
  { key: "nai",     label: "NAI Global" },
];

// Estimated run time per brokerage (minutes)
const SITE_MINUTES = { cbre: 15, jll: 10, cushman: 20, colliers: 15, crexi: 5, newmark: 10, nai: 10 };

// Parse address into { street, city, state }.
// Handles all common formats:
//   "123 Main St, Houston, TX 77001"      → street/city/state ✓
//   "123 Main St, Houston, TX, 77001"     → ZIP is its own segment ✓
//   "123 Main St, Ste 100, Houston, TX"   → suite in street ✓
function parseAddress(raw) {
  if (!raw) return { street: "—", city: "—", state: "—" };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { street: raw, city: "—", state: "—" };

  let idx = parts.length - 1;

  // If the last segment is a standalone ZIP ("77001" or "77001-1234"), skip it
  if (/^\d{5}(-\d{4})?$/.test(parts[idx])) idx--;

  // parts[idx] is now the state (may still contain an embedded ZIP "TX 77001")
  let state = "—";
  if (idx >= 1) {
    state = parts[idx].replace(/\s+\d{5}(-\d{4})?$/, "").trim() || "—";
    idx--;
  }

  // parts[idx] is the city
  let city = "—";
  if (idx >= 1) {
    city = parts[idx];
    idx--;
  }

  // Everything before is the street (join with ", " in case of suite lines)
  const street = parts.slice(0, idx + 1).join(", ") || parts[0];

  return { street, city, state };
}

const COLUMNS = [
  { key: "source",           label: "Source",       sortable: true,  special: "source" },
  { key: "_street",          label: "Street",       sortable: true,  special: "street",  wide: true },
  { key: "_city",            label: "City",         sortable: true,  special: "city" },
  { key: "_state",           label: "State",        sortable: true,  special: "state" },
  { key: "total_sf",         label: "SF",           sortable: true,  fmt: (v) => v ? Number(v).toLocaleString() : "—" },
  { key: "asking_price_psf", label: "$/SF",         sortable: true,  fmt: (v) => v ? `$${Number(v).toFixed(2)}` : "—" },
  { key: "clear_height",     label: "Clear Ht",     sortable: true,  fmt: (v) => v ? `${v}'` : "—" },
  { key: "loading_docks",    label: "Docks",        sortable: true,  fmt: (v) => v != null ? v : "—" },
  { key: "grade_doors",      label: "Grade Doors",  sortable: true,  fmt: (v) => v != null ? v : "—" },
  { key: "sprinklered",      label: "Sprinkler",    sortable: false, fmt: (v) => v ?? "—" },
  { key: "office_pct",       label: "Office %",     sortable: true,  fmt: (v) => v != null ? `${v}%` : "—" },
  { key: "power",            label: "Power",        sortable: false, fmt: (v) => v ?? "—" },
  { key: "occupancy_pct",    label: "Occupancy",    sortable: true,  fmt: (v) => v != null ? `${v}%` : "—" },
  { key: "walt",             label: "WALT (yrs)",   sortable: true,  fmt: (v) => v != null ? `${v}` : "—" },
  { key: "zoning",           label: "Zoning",       sortable: false, fmt: (v) => v ?? "—" },
  { key: "broker",           label: "Broker",       sortable: false, special: "broker" },
  { key: "scoring_reason",   label: "Key Notes",    sortable: false, fmt: (v) => v ?? "—",           wide: true },
];

function SortIcon({ col, sortCol, sortDir }) {
  if (col !== sortCol) return <ArrowUpDown size={11} className="opacity-30 inline ml-1" />;
  return sortDir === "asc"
    ? <ArrowUp   size={11} className="opacity-80 inline ml-1 text-[#1F3864]" />
    : <ArrowDown size={11} className="opacity-80 inline ml-1 text-[#1F3864]" />;
}

// Resolve virtual address sub-fields for sorting
function resolveVal(row, col) {
  if (col === "_street") return parseAddress(row.address).street;
  if (col === "_city")   return parseAddress(row.address).city;
  if (col === "_state")  return parseAddress(row.address).state;
  return row[col];
}

function sortListings(listings, col, dir) {
  if (!col) return listings;
  return [...listings].sort((a, b) => {
    const av = resolveVal(a, col), bv = resolveVal(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
}

function estimateMinutes(sites) {
  if (!sites.length) return Object.values(SITE_MINUTES).reduce((a, b) => a + b, 0);
  return sites.reduce((s, k) => s + (SITE_MINUTES[k] ?? 10), 0);
}

export default function LiveSearch() {
  // Hydrate from localStorage so reloads render instantly without waiting on /live/listings
  const _cached = loadCachedState();
  const [status, setStatus]         = useState(null);
  const [sourceCounts, setSourceCounts] = useState(_cached?.sourceCounts ?? {});
  const [listings, setListings]     = useState(_cached?.listings ?? []);
  const [cachedAt, setCachedAt]     = useState(_cached?.savedAt ?? null);
  const [hasFreshData, setHasFreshData] = useState(false);
  const [filter, setFilter]         = useState("all");
  const [search, setSearch]         = useState("");      // free-text across address/source/zoning/notes
  const [stateFilter, setStateFilter]   = useState("all"); // by US state
  const [sourceFilter, setSourceFilter] = useState("all"); // by brokerage source
  const [view, setView]             = useState("table");
  const [starting, setStarting]     = useState(false);
  const [error, setError]           = useState(null);
  const [sortCol, setSortCol]       = useState("total_sf");
  const [sortDir, setSortDir]       = useState("desc");
  const [selectedSites, setSelectedSites] = useState([]);   // empty = all
  const [forceRefresh, setForceRefresh]   = useState(false);
  const [stopping, setStopping]           = useState(false);
  const [confirmClear, setConfirmClear]   = useState(false);
  const [clearing, setClearing]           = useState(false);
  // Pipedrive send: selected listing_urls + in-flight + result toast
  const [selected, setSelected]           = useState(new Set());
  const [sending, setSending]             = useState(false);
  const [sendResult, setSendResult]       = useState(null);
  // {source: number} — how many listings per source are still flagged
  // as restored-from-backup. Shows a 📦 badge on the source chip.
  const [cachedSourceCounts, setCachedSourceCounts] = useState(_cached?.cachedSourceCounts ?? {});
  const pollRef = useRef(null);

  const isRunning = status?.status === "running";

  const fetchStatus   = async () => {
    try {
      const { data } = await axios.get("/live/status");
      setStatus(data);
      if (data.source_counts) setSourceCounts(data.source_counts);
      if (data.cached_source_counts) setCachedSourceCounts(data.cached_source_counts);
    } catch {}
  };
  const fetchListings = async () => {
    try {
      const { data } = await axios.get("/live/listings");
      setListings(data.listings ?? []);
      setHasFreshData(true);
    } catch {}
  };

  // Load cached results immediately on mount
  useEffect(() => { fetchStatus(); fetchListings(); }, []);

  // Persist listings + sourceCounts to localStorage whenever they change,
  // so reloads show the table instantly while the backend re-fetches.
  useEffect(() => {
    if (listings.length === 0 && Object.keys(sourceCounts).length === 0) return;
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        listings, sourceCounts, cachedSourceCounts, savedAt,
      }));
      setCachedAt(savedAt);
    } catch {}
  }, [listings, sourceCounts, cachedSourceCounts]);

  // Poll while a scrape is running
  useEffect(() => {
    if (isRunning) {
      pollRef.current = setInterval(() => { fetchStatus(); fetchListings(); }, 5000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [isRunning]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const { data } = await axios.post("/live/scrape", { sites: selectedSites, force_refresh: forceRefresh });
      if (data.status === "already_running") {
        setError("A scrape is already in progress.");
      } else {
        // Do NOT clear listings — new results merge into existing cache
        await fetchStatus();
      }
    } catch {
      setError("Failed to start scrape. Is the backend running?");
    } finally {
      setStarting(false);
    }
  };

  const handleRefresh = () => { fetchListings(); fetchStatus(); };

  const handleStop = async () => {
    setStopping(true);
    try {
      await axios.post("/live/stop");
    } catch {}
    // Keep "Stopping…" label until the status poll confirms the job ended
    // (the effect below will setStopping(false) when isRunning goes false)
  };

  // Clear the stopping flag once the scrape actually finishes
  useEffect(() => {
    if (!isRunning && stopping) setStopping(false);
  }, [isRunning, stopping]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await axios.delete("/live/listings");
      setListings([]);
      setConfirmClear(false);
    } catch {
      setError("Failed to clear listings.");
    } finally {
      setClearing(false);
    }
  };

  const toggleSite = (key) =>
    setSelectedSites((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const handleSort = (col) => {
    if (!col) return;
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  // --- Pipedrive: select listings and push them (with broker contact) --------
  const toggleSelect = (url) => {
    if (!url) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  };

  const handleSendPipedrive = async (rows) => {
    if (!rows.length) return;
    setSending(true);
    setSendResult(null);
    try {
      const { data } = await axios.post("/pipedrive/import", { rows });
      setSendResult(data);
      setSelected(new Set());   // clear selection on success
    } catch (err) {
      setSendResult({ error: err.response?.data?.detail ?? "Pipedrive import failed." });
    } finally {
      setSending(false);
    }
  };

  const counts = {
    total:      listings.length,
    actionable: listings.filter((l) => l.score_category === "Actionable").length,
    tentative:  listings.filter((l) => l.score_category === "Tentative").length,
    passed:     listings.filter((l) => l.score_category === "Pass").length,
    mapped:     listings.filter((l) => l.lat && l.lng).length,
  };

  // Dropdown option lists, derived from the data
  const stateOptions  = [...new Set(listings.map((l) => parseAddress(l.address).state).filter(Boolean))].sort();
  const sourceOptions = [...new Set(listings.map((l) => l.source).filter(Boolean))].sort();

  const q = search.trim().toLowerCase();
  const baseFiltered = listings.filter((l) => {
    if (filter !== "all" && l.score_category !== filter) return false;
    if (stateFilter !== "all" && parseAddress(l.address).state !== stateFilter) return false;
    if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
    if (q) {
      const hay = `${l.address ?? ""} ${l.source ?? ""} ${l.zoning ?? ""} ${l.scoring_reason ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const filtered = sortListings(baseFiltered, sortCol, sortDir);
  const visible  = filtered.slice(0, 500);   // table caps at 500 rows
  const selectedRows = filtered.filter((l) => l.listing_url && selected.has(l.listing_url));

  const activeFilterCount =
    (filter !== "all" ? 1 : 0) +
    (stateFilter !== "all" ? 1 : 0) +
    (sourceFilter !== "all" ? 1 : 0) +
    (q ? 1 : 0);
  const clearFilters = () => {
    setFilter("all"); setStateFilter("all"); setSourceFilter("all"); setSearch("");
  };

  // Most recent scraped_at across all listings
  const lastScraped = listings.length
    ? listings.reduce((best, l) => (l.scraped_at > best ? l.scraped_at : best), "")
    : null;

  const estMinutes = estimateMinutes(selectedSites);

  return (
    <div className="space-y-6">

      {/* ── Control bar ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Nationwide Live Search</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              Scrapes major brokerages for industrial for-sale listings across the US
              (75,000–300,000 SF). Results are cached — re-running a brokerage refreshes
              existing listings and adds new ones without wiping your history.
            </p>
            {/* Cached-locally indicator. While the page is hydrating from
                localStorage but hasn't yet fetched fresh data, show an
                amber "refreshing" tag; once fresh data arrives, show a
                quiet green "saved" tag so the user knows the data
                persists across reloads. */}
            {cachedAt && (
              <div className="mt-1.5">
                {!hasFreshData ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                    text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    <Database size={11} />
                    Showing cached results — refreshing…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                    text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                    title={`Saved to your browser at ${new Date(cachedAt).toLocaleString()}`}>
                    <Database size={11} />
                    Saved locally
                  </span>
                )}
              </div>
            )}
            {lastScraped && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <Clock size={12} />
                Last scraped: {new Date(lastScraped + "Z").toLocaleString()}
                &nbsp;·&nbsp;{counts.total.toLocaleString()} listings cached
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRefresh}
              title="Refresh from database"
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700
                hover:border-slate-300 transition"
            >
              <RefreshCw size={15} />
            </button>
            {listings.length > 0 && (
              <button
                onClick={() => setConfirmClear(true)}
                title="Clear all cached listings"
                className="p-2 rounded-lg border border-red-200 text-red-400 hover:text-red-600
                  hover:border-red-400 transition"
              >
                <Trash2 size={15} />
              </button>
            )}
            {isRunning ? (
              <button
                onClick={handleStop}
                disabled={stopping}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm
                  text-white bg-red-600 hover:bg-red-700
                  disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {stopping
                  ? <><Loader2 size={16} className="animate-spin" /> Stopping…</>
                  : <><Square size={16} /> Stop Scrape</>}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={starting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm
                  text-white bg-[#1F3864] hover:bg-[#2E5090]
                  disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {starting
                  ? <><Loader2 size={16} className="animate-spin" /> Starting…</>
                  : <><Play size={16} /> {selectedSites.length === 0 ? "Run All" : "Run Selected"}</>}
              </button>
            )}
          </div>
        </div>

        {/* Brokerage selector */}
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">
            Brokerages to scrape{" "}
            <span className="text-slate-400 font-normal">
              (leave all unchecked to run all · est. ~{estMinutes} min)
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_SITES.map(({ key, label }) => {
              const active = selectedSites.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleSite(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition
                    ${active
                      ? "bg-[#1F3864] text-white border-[#1F3864]"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}
                >
                  {label}
                  {active && (
                    <span className="ml-1.5 text-blue-200">
                      ~{SITE_MINUTES[key]}m
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {selectedSites.length > 0 && (
              <p className="text-xs text-slate-400">
                Estimated run time: ~{estMinutes} minutes
              </p>
            )}
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <div
                onClick={() => setForceRefresh((v) => !v)}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors
                  ${forceRefresh ? "bg-amber-500" : "bg-slate-200"}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform
                  ${forceRefresh ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-xs text-slate-500 group-hover:text-slate-700">
                Force full re-scrape
                <span className="ml-1 text-slate-400">(re-visits every listing page, even cached ones)</span>
              </span>
            </label>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50
            border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Confirm clear dialog */}
        {confirmClear && (
          <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span className="text-red-700 flex-1">
              Delete all {counts.total.toLocaleString()} cached listings? This cannot be undone.
            </span>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold
                hover:bg-red-700 disabled:opacity-50 transition"
            >
              {clearing ? "Clearing…" : "Yes, clear"}
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="px-3 py-1 rounded-lg border border-slate-300 text-slate-600 text-xs
                font-semibold hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          </div>
        )}
      </section>

      {/* ── Status bar ── */}
      {status && status.status !== "idle" && (
        <div className="flex items-center gap-4 flex-wrap text-sm bg-white
          rounded-2xl shadow-sm border border-slate-200 px-5 py-3">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isRunning
              ? "bg-blue-100 text-blue-700 animate-pulse"
              : status.status === "done"
                ? "bg-green-100 text-green-700"
                : status.status === "stopped"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-700"
          }`}>
            {isRunning ? "Running"
              : status.status === "done"    ? "Complete"
              : status.status === "stopped" ? "Stopped"
              : "Error"}
          </span>
          <span className="text-slate-700 font-medium">
            {status.listings_found?.toLocaleString() ?? 0} found this run
          </span>
          {counts.mapped > 0 && (
            <span className="text-slate-500 flex items-center gap-1">
              <MapPin size={12} /> {counts.mapped.toLocaleString()} on map
            </span>
          )}
          {status.started_at && (
            <span className="text-slate-400 ml-auto">
              Started {new Date(status.started_at + "Z").toLocaleTimeString()}
            </span>
          )}
          {status.error && (
            <span className="text-red-500 text-xs ml-2">Error: {status.error}</span>
          )}
        </div>
      )}

      {/* Per-source breakdown — adds a 📦 badge when some/all of the source's
          listings were restored from backup (cached). The badge auto-clears
          once a real scrape upserts those listing_urls. */}
      {Object.keys(sourceCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(sourceCounts).map(([src, n]) => {
            const cachedN = cachedSourceCounts?.[src] ?? 0;
            const allCached = cachedN > 0 && cachedN >= n;
            return (
              <span
                key={src}
                title={
                  cachedN > 0
                    ? `${cachedN} of ${n} restored from backup — will refresh on next scrape`
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full
                  text-xs font-medium capitalize border
                  ${cachedN > 0
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-slate-100 text-slate-600 border-transparent"}`}
              >
                <span>
                  {src}: <strong>{n}</strong>
                </span>
                {cachedN > 0 && (
                  <span className="font-mono text-[10px] tracking-tight">
                    📦 {allCached ? "cached" : `${cachedN} cached`}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Results ── */}
      {listings.length > 0 && (
        <>
          {/* Summary chips + view toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            {FILTER_BTNS.map(({ key, label, color }) => {
              const count =
                key === "all"        ? counts.total      :
                key === "Actionable" ? counts.actionable :
                key === "Tentative"  ? counts.tentative  : counts.passed;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition
                    ${color} ${filter === key
                      ? "ring-2 ring-offset-1 ring-[#1F3864]"
                      : "opacity-60 hover:opacity-100"}`}
                >
                  {label} ({count.toLocaleString()})
                </button>
              );
            })}
            <div className="ml-auto flex rounded-lg overflow-hidden border border-slate-200 text-sm">
              {["table", "map"].map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 capitalize font-medium transition ${
                    view === v ? "bg-[#1F3864] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Filter toolbar — search + state + source, composes with score chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search address, source, zoning, notes…"
                className="pl-8 pr-7 py-1.5 w-72 max-w-full rounded-lg border border-slate-200 text-sm
                  text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#1F3864]
                  focus:ring-1 focus:ring-[#1F3864]"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="py-1.5 px-2.5 rounded-lg border border-slate-200 text-sm text-slate-700
                focus:outline-none focus:border-[#1F3864] focus:ring-1 focus:ring-[#1F3864]"
            >
              <option value="all">All states</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="py-1.5 px-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 capitalize
                focus:outline-none focus:border-[#1F3864] focus:ring-1 focus:ring-[#1F3864]"
            >
              <option value="all">All sources</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <span className="text-xs text-slate-400">
              {filtered.length.toLocaleString()} of {listings.length.toLocaleString()}
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs font-medium text-[#1F3864] hover:underline flex items-center gap-1"
              >
                <X size={12} /> Clear filters
              </button>
            )}
          </div>

          {/* Map */}
          {view === "map" && (
            <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-200">
              {counts.mapped === 0 ? (
                <div className="h-40 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
                  Geocoding addresses… map pins will appear as they complete.
                </div>
              ) : (
                <DealMap listings={filtered} />
              )}
            </div>
          )}

          {/* Pipedrive send bar — appears once listings are selected */}
          {view === "table" && (selectedRows.length > 0 || sendResult) && (
            <div className="flex items-center gap-3 flex-wrap bg-[#1F3864]/5 border border-[#1F3864]/20
              rounded-xl px-4 py-2.5">
              {selectedRows.length > 0 && (
                <>
                  <span className="text-sm text-slate-600">
                    {selectedRows.length} listing{selectedRows.length !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={() => handleSendPipedrive(selectedRows)}
                    disabled={sending}
                    className="ml-auto inline-flex items-center gap-1.5 bg-[#1F3864] text-white text-sm
                      font-medium px-3.5 py-1.5 rounded-lg hover:bg-[#2E5090] transition
                      disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {sending
                      ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
                      : <><Send size={15} /> Send to Pipedrive</>}
                  </button>
                </>
              )}
              {sendResult && !sendResult.error && (
                <span className="inline-flex items-center gap-1.5 text-sm text-green-700 font-medium">
                  <CheckCircle2 size={15} /> {sendResult.imported} sent to Pipedrive
                  {sendResult.failed ? ` · ${sendResult.failed} failed` : ""}
                  {sendResult.skipped_out_of_market?.length
                    ? ` · ${sendResult.skipped_out_of_market.length} skipped (out of buy-box markets)`
                    : ""}
                </span>
              )}
              {sendResult?.error && (
                <span className="inline-flex items-center gap-1.5 text-sm text-red-600">
                  <AlertCircle size={15} /> {sendResult.error}
                </span>
              )}
            </div>
          )}

          {/* Table */}
          {view === "table" && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-3 w-10">
                        <input
                          type="checkbox"
                          title="Select all visible"
                          className="accent-[#1F3864] w-4 h-4 cursor-pointer align-middle"
                          checked={
                            visible.length > 0 &&
                            visible.every((l) => l.listing_url && selected.has(l.listing_url))
                          }
                          onChange={(e) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              visible.forEach((l) => {
                                if (!l.listing_url) return;
                                e.target.checked ? next.add(l.listing_url) : next.delete(l.listing_url);
                              });
                              return next;
                            });
                          }}
                        />
                      </th>
                      {COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => col.sortable && handleSort(col.key)}
                          className={`text-left px-3 py-3 text-xs font-semibold text-slate-500
                            uppercase tracking-wide whitespace-nowrap
                            ${col.sortable ? "cursor-pointer hover:text-slate-700 select-none" : ""}
                            ${col.wide ? "min-w-[180px]" : ""}`}
                        >
                          {col.label}
                          {col.sortable && (
                            <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                          )}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        Link
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((l, i) => (
                      <tr
                        key={l.listing_url ?? i}
                        className={`${ROW_TINT[l.score_category] ?? "hover:bg-slate-50"}
                          ${l.listing_url && selected.has(l.listing_url) ? "bg-[#1F3864]/5" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            disabled={!l.listing_url}
                            checked={!!l.listing_url && selected.has(l.listing_url)}
                            onChange={() => toggleSelect(l.listing_url)}
                            className="accent-[#1F3864] w-4 h-4 cursor-pointer align-middle"
                          />
                        </td>
                        {COLUMNS.map((col) => {
                          const { street, city, state } = parseAddress(l.address);
                          let cellContent;
                          let extraClass = "";

                          if (col.special === "broker") {
                            const phone = l.broker_cell || l.broker_phone;
                            cellContent = (
                              <div className="leading-tight">
                                <div className="text-slate-700">{l.broker_name || "—"}</div>
                                {phone && (
                                  <div className="text-xs">
                                    {l.broker_cell
                                      ? <span className="text-green-700 font-medium">{l.broker_cell} (cell)</span>
                                      : <span className="text-slate-500">{l.broker_phone}</span>}
                                  </div>
                                )}
                              </div>
                            );
                            extraClass = "min-w-[150px]";
                          } else if (col.special === "street") {
                            cellContent = (
                              <div className="truncate font-medium text-slate-800">{street}</div>
                            );
                            extraClass = "max-w-[220px]";
                          } else if (col.special === "city") {
                            cellContent = city;
                          } else if (col.special === "state") {
                            cellContent = state;
                          } else if (col.special === "source") {
                            cellContent = l.source ?? "—";
                            extraClass = "text-xs capitalize";
                          } else if (col.key === "scoring_reason") {
                            cellContent = (
                              <div className="line-clamp-2">{col.fmt(l[col.key])}</div>
                            );
                            extraClass = "max-w-[220px] text-xs text-slate-400";
                          } else {
                            cellContent = col.fmt(l[col.key]);
                          }

                          return (
                            <td
                              key={col.key}
                              className={`px-3 py-2.5 text-slate-600 whitespace-nowrap ${extraClass}`}
                            >
                              {cellContent}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5">
                          {l.listing_url && (
                            <a
                              href={l.listing_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                            >
                              View →
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 500 && (
                <p className="text-center text-sm text-slate-400 py-3 border-t border-slate-100">
                  Showing 500 of {filtered.length.toLocaleString()} listings
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!isRunning && listings.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 py-16 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <p className="text-slate-600 font-medium">No listings cached yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Select brokerages above (or leave all unchecked for a full run) then click Run.
          </p>
        </div>
      )}

      {/* Loading state while scraping but no results yet */}
      {isRunning && listings.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 py-16 text-center">
          <Loader2 size={32} className="animate-spin text-[#1F3864] mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Scraping brokerages…</p>
          <p className="text-slate-400 text-sm mt-1">
            First results typically appear within 5–10 minutes.
          </p>
        </div>
      )}
    </div>
  );
}
