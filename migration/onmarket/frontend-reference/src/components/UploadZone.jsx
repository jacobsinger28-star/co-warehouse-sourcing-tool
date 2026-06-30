import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileSpreadsheet, X } from "lucide-react";

export default function UploadZone({ onFileSelect, file, onClear }) {
  const onDrop = useCallback(
    (accepted) => {
      if (accepted.length > 0) onFileSelect(accepted[0]);
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "text/csv": [".csv"],
    },
    multiple: false,
  });

  if (file) {
    return (
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <FileSpreadsheet className="text-blue-600 shrink-0" size={28} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-blue-800 truncate">{file.name}</p>
          <p className="text-sm text-blue-500">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <button
          onClick={onClear}
          className="p-1.5 rounded-full hover:bg-blue-200 text-blue-500 transition"
          title="Remove file"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center gap-3 p-10 border-2 border-dashed rounded-xl cursor-pointer transition-colors
        ${isDragActive
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50"
        }`}
    >
      <input {...getInputProps()} />
      <UploadCloud
        size={44}
        className={isDragActive ? "text-blue-500" : "text-slate-400"}
      />
      <div className="text-center">
        <p className="font-semibold text-slate-700">
          {isDragActive ? "Drop it here!" : "Drag & drop your leads file"}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          or <span className="text-blue-600 underline">browse</span> — .xlsx, .xls, .csv accepted
        </p>
      </div>
    </div>
  );
}
