import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css'
import { css } from '../css.js'
import { fmtSF, fmtInt, fmtMoney2, fmtPhone, scDot, scLabel } from '../helpers.js'

// Signal chips that explain an off-market score at a glance (mirrors the
// off-market tool's popup: out-of-state / violations / no-permits / manual-review).
function sigChips(p) {
  const c = []
  if (p.oos) c.push(['out-of-state', '#7c6fd6'])
  if (p.nViol > 0) c.push([`${p.nViol} violation${p.nViol > 1 ? 's' : ''}`, '#dc2626'])
  if (p.nPermit > 0) c.push(['no recent permits', '#d97706'])
  if (p.bucket && p.bucket !== 'universe') c.push(['manual review', '#64748b'])
  return c
}
function factLine(p) {
  const f = [`${fmtSF(p.sf)} SF${p.buildings > 1 ? ` · ${p.buildings} bldgs` : ''}`]
  if (p.clear != null) f.push(`${p.clear}′ clear`)
  if (p.year) f.push(`built ${p.year}`)
  if (p.channel === 'on' && p.ask != null) f.push(`${fmtMoney2(p.ask)}/SF`)
  if (p.distMi != null) f.push(`${p.distMi} mi to core`)
  if (p.holdYears != null) f.push(`held ${p.holdYears}y`)
  return f.join(' · ')
}

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

export default function DealMap({ props = [], mapStyle = 'clean', theme = 'dark', onOpen }) {
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
            <Popup>
              <div style={css('min-width:216px;max-width:264px;font-family:inherit;')}>
                <div style={css('font-weight:600;font-size:13px;color:#0f172a;')}>{p.addr}</div>
                <div style={css('font-size:11px;color:#64748b;margin-bottom:6px;')}>{p.mkt}{p.st ? `, ${p.st}` : ''}{p.landUse ? ` · ${p.landUse}` : ''}</div>

                <div style={css('display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;')}>
                  <span style={css(scDot(p.cat))} />
                  <span style={css(scLabel(p.cat) + 'font-weight:600;')}>{p.cat}</span>
                  <span style={css('color:#94a3b8;')}>{p.score}</span>
                  <span style={css('color:#94a3b8;')}>· {p.channel === 'off' ? 'Off-market' : 'On-market'}</span>
                </div>

                {p.channel === 'off' && sigChips(p).length > 0 && (
                  <div style={css('display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px;')}>
                    {sigChips(p).map(([t, c], i) => (
                      <span key={i} style={css(`font-size:10px;padding:1px 6px;border-radius:4px;background:${c}1a;color:${c};border:1px solid ${c}55;`)}>{t}</span>
                    ))}
                  </div>
                )}

                <div title={p.clear != null ? 'Clear height is a roof estimate — interior is ~2–4 ft less' : undefined} style={css('font-size:11px;color:#475569;margin-bottom:6px;line-height:1.5;')}>{factLine(p)}</div>

                {p.channel === 'off' ? (
                  <div style={css('font-size:11px;color:#475569;margin-bottom:7px;line-height:1.5;')}>
                    <div style={css('color:#0f172a;')}>{p.owner}{p.ownerType ? ` · ${p.ownerType}` : ''}</div>
                    {(p.phones?.length || p.emails?.length) ? (
                      <div style={css('margin-top:2px;')}>
                        {p.phones?.length > 0 && <a href={`tel:${String(p.phones[0]).replace(/\D/g, '')}`} style={css('color:#2563eb;text-decoration:none;')}>{fmtPhone(p.phones[0])}</a>}
                        {p.phones?.length > 0 && p.emails?.length > 0 && <span style={css('color:#cbd5e1;')}> · </span>}
                        {p.emails?.length > 0 && <a href={`mailto:${p.emails[0]}`} style={css('color:#2563eb;text-decoration:none;')}>{p.emails[0]}</a>}
                        {p.contactConf && <span style={css('color:#94a3b8;')}> · {p.contactConf}</span>}
                      </div>
                    ) : (
                      <div style={css('margin-top:2px;color:#94a3b8;')}>— no source-backed contact yet</div>
                    )}
                    {(p.lastSale || p.assessed > 0) && (
                      <div style={css('margin-top:3px;font-size:10.5px;color:#94a3b8;')}>
                        {p.lastSale ? `Last sale ${p.lastSale}` : ''}{p.lastSale && p.assessed > 0 ? ' · ' : ''}{p.assessed > 0 ? `Assessed $${fmtInt(p.assessed)}` : ''}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={css('font-size:11px;color:#475569;margin-bottom:7px;')}>{p.broker} · {p.firm}</div>
                )}

                {onOpen && (
                  <button
                    onClick={() => onOpen(p.id)}
                    style={css('width:100%;height:28px;background:var(--accent);border:none;border-radius:6px;color:#06120F;font-weight:600;font-size:11.5px;cursor:pointer;')}
                  >
                    Open record
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  )
}
