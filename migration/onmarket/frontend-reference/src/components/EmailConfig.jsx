import { useState } from "react";
import { Send, CheckCircle2, AlertCircle, Loader2, Plus, X } from "lucide-react";
import axios from "axios";

const DEFAULT_RECIPIENTS = ["jsinger@simicap.com", "easybay@simicap.com"];

export default function EmailConfig({ file, analystName, disabled }) {
  const [recipients, setRecipients] = useState(DEFAULT_RECIPIENTS);
  const [newEmail, setNewEmail]     = useState("");
  const [sender, setSender]         = useState("");
  const [status, setStatus]         = useState(null);
  const [message, setMessage]       = useState("");

  const addRecipient = () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || recipients.includes(trimmed)) { setNewEmail(""); return; }
    setRecipients((prev) => [...prev, trimmed]);
    setNewEmail("");
  };

  const removeRecipient = (email) =>
    setRecipients((prev) => prev.filter((e) => e !== email));

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addRecipient(); }
  };

  const handleSend = async () => {
    if (!file || recipients.length === 0) return;
    setStatus("loading");
    setMessage("");

    const form = new FormData();
    form.append("file", file);
    form.append("recipient_emails", recipients.join(","));
    form.append("analyst_name", analystName || "");
    if (sender) form.append("sender_email", sender);

    try {
      const { data } = await axios.post("/send-email", form);
      setStatus("success");
      setMessage(data.message);
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.detail ?? "Failed to send email.");
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
        <Send size={18} className="text-[#1F3864]" />
        Email Report
      </h3>

      {/* Recipient tags */}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-2">
          Recipients <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {recipients.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 border border-blue-200
                rounded-full text-sm text-blue-800 font-medium"
            >
              {email}
              <button
                onClick={() => removeRecipient(email)}
                className="text-blue-400 hover:text-blue-700 transition"
                title="Remove"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add another email…"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={addRecipient}
            disabled={!newEmail.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300
              text-sm text-slate-600 hover:border-blue-400 hover:text-blue-600
              disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Plus size={15} /> Add
          </button>
        </div>
      </div>

      {/* Sender override */}
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Sender Override <span className="text-slate-400">(optional)</span>
        </label>
        <input
          type="email"
          value={sender}
          onChange={(e) => setSender(e.target.value)}
          placeholder="Defaults to your GMAIL_USER"
          className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {analystName && (
        <p className="text-xs text-slate-500">
          Report will be attributed to <strong className="text-slate-700">{analystName}</strong>.
        </p>
      )}

      <button
        onClick={handleSend}
        disabled={disabled || recipients.length === 0 || status === "loading"}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
          font-semibold text-sm text-white bg-[#1F3864] hover:bg-[#2E5090]
          disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {status === "loading" ? (
          <><Loader2 size={16} className="animate-spin" /> Sending to {recipients.length} recipient{recipients.length > 1 ? "s" : ""}…</>
        ) : (
          <><Send size={16} /> Send to {recipients.length} Recipient{recipients.length > 1 ? "s" : ""}</>
        )}
      </button>

      {status === "success" && (
        <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          {message}
        </div>
      )}
      {status === "error" && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
