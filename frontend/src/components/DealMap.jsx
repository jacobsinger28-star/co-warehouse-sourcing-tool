import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Tooltip, ZoomControl, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css'
import PropPopup from './PropPopup.jsx'
// Real Leaflet map (ported from the general-scraping sourcing tool, restyled to
// this console's tokens). Markers are clustered and colored by score category;
// off-market = ring, on-market = filled teardrop — matching the map legend.

const CAT_HEX = { Actionable: '#22c55e', Tentative: '#f59e0b', Pass: '#ef4444' }

function markerIcon(p) {
  const color = CAT_HEX[p.cat] ?? '#94a3b8'
  const html =
    p.channel === 'off'
      ? `<div style="width:15px;height:15px;border-radius:50%;background:transparent;border:2.5px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`
      : `<div style="width:14px;height:14px;border-radius:50% 50% 50% 0;background:${color};border:1.5px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`
  return L.divIcon({ className: '', html, iconSize: [15, 15], iconAnchor: [8, 8], popupAnchor: [0, -10] })
}

// Tile sources keyed by the console's map-style + theme toggle.
function tiles(mapStyle, theme) {
  if (mapStyle === 'sat')
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    }
  const v = theme === 'light' ? 'light_all' : 'dark_all'
  return {
    url: `https://{s}.basemaps.cartocdn.com/${v}/{z}/{x}/{y}{r}.png`,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  }
}

// Fit the viewport to the markers the first time real points arrive (and when
// going from empty → populated), but not on every filter toggle.
function FitBounds({ points }) {
  const map = useMap()
  const wasEmpty = useRef(true)
  useEffect(() => {
    if (!points.length) { wasEmpty.current = true; return }
    if (wasEmpty.current) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.12), { animate: false })
      wasEmpty.current = false
    }
  }, [points, map])
  return null
}

export default function DealMap({ props = [], meta, mapStyle = 'clean', theme = 'dark', onOpen }) {
  const points = useMemo(() => props.filter((p) => p.lat != null && p.lng != null), [props])
  const t = tiles(mapStyle, theme)

  return (
    <MapContainer
      center={[37.5, -85]}
      zoom={5}
      zoomControl={false}
      preferCanvas
      style={{ height: '100%', width: '100%', background: 'var(--map-land)' }}
    >
      <TileLayer key={`${mapStyle}-${theme}`} url={t.url} attribution={t.attribution} />
      <ZoomControl position="bottomright" />
      <FitBounds points={points} />
      <MarkerClusterGroup chunkedLoading maxClusterRadius={48} showCoverageOnHover={false}>
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={markerIcon(p)}>
            <Tooltip direction="top">{p.addr}</Tooltip>
            <Popup maxWidth={360} minWidth={280} maxHeight={430}>
              <PropPopup p={p} meta={meta} onOpen={onOpen} />
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  )
}
