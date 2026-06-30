import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "react-leaflet-cluster/lib/assets/MarkerCluster.css";
import "react-leaflet-cluster/lib/assets/MarkerCluster.Default.css";

const COLORS = {
  Actionable: "#22c55e",
  Tentative:  "#f59e0b",
  Pass:       "#ef4444",
};

function makeIcon(score) {
  const color = COLORS[score] ?? "#94a3b8";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;
      background:${color};
      border-radius:50%;
      border:2px solid rgba(255,255,255,0.85);
      box-shadow:0 1px 4px rgba(0,0,0,0.45)
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

const SCORE_TEXT = {
  Actionable: "text-green-700",
  Tentative:  "text-amber-600",
  Pass:       "text-red-600",
};

export default function DealMap({ listings }) {
  const mapped = useMemo(
    () => listings.filter((l) => l.lat && l.lng),
    [listings]
  );

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      style={{ height: "520px", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <MarkerClusterGroup chunkedLoading>
        {mapped.map((l, i) => (
          <Marker key={i} position={[l.lat, l.lng]} icon={makeIcon(l.score_category)}>
            <Popup maxWidth={280}>
              <div className="text-sm space-y-1.5 py-1">
                <p className="font-semibold text-slate-800 leading-snug">{l.address}</p>
                <p className="text-xs text-slate-400 uppercase tracking-wide">{l.source}</p>

                <div className="flex gap-3 text-slate-600 text-xs">
                  {l.total_sf && (
                    <span>{Number(l.total_sf).toLocaleString()} SF</span>
                  )}
                  {l.asking_price_psf && (
                    <span>${l.asking_price_psf}/SF</span>
                  )}
                  {l.clear_height && (
                    <span>{l.clear_height}' clear</span>
                  )}
                </div>

                {l.score_category && (
                  <p className={`font-semibold text-xs ${SCORE_TEXT[l.score_category] ?? "text-slate-500"}`}>
                    {l.score_category}
                  </p>
                )}

                {l.scoring_reason && (
                  <p className="text-xs text-slate-500 leading-snug line-clamp-3">
                    {l.scoring_reason}
                  </p>
                )}

                {l.listing_url && (
                  <a
                    href={l.listing_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-blue-600 hover:underline"
                  >
                    View listing →
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
