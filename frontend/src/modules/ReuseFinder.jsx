import { useState } from 'react'
import { css } from '../css.js'
import Icon from '../Icon.jsx'
import { REUSE_CANDIDATES, REUSE_AREAS, BUYBOX_CANDIDATES, BUYBOX_TARGET, SEED_LISTINGS } from '../data.js'
import { catVar, catTintVar, scDot, scLabel, fmtSF } from '../helpers.js'

// likelihood → the shared score category (drives the green/amber/red coloring)
const catOf = (l) => (l >= 0.5 ? 'Actionable' : l > 0.15 ? 'Tentative' : 'Pass')
const BAND_LABEL = { very_low: 'Very low', low: 'Low', medium: 'Medium', high: 'High' }
const verdictOf = (c) =>
  c.needsReview
    ? { label: 'Needs review', cat: 'Tentative' }
    : c.useMismatch
    ? { label: 'Reuse confirmed', cat: 'Actionable' }
    : { label: 'Pass · original use', cat: 'Pass' }

const inBand = (sf) => sf >= BUYBOX_TARGET.sfMin

// provenance: where a listing came from. seed = founder example pasted from Teams
// (defines the buy-box); found = the agent discovered it online.
const PROV = {
  seed: { label: 'Seed', tip: 'Founder example pasted from Teams — the agent learns the buy-box from these.', color: 'var(--accent)', tint: 'var(--accent-dim)', icon: 'flag' },
  found: { label: 'Found', tip: 'Discovered online by the agent (LoopNet sourcing pass) — not user-provided.', color: 'var(--green)', tint: 'var(--green-tint)', icon: 'search' },
}
function ProvTag({ source, ml = true }) {
  const p = PROV[source] || PROV.found
  return (
    <span title={p.tip} style={css(`display:inline-flex;align-items:center;gap:4px;${ml ? 'margin-left:8px;' : ''}font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:${p.color};background:${p.tint};border:1px solid var(--border);padding:1px 6px;border-radius:4px;vertical-align:middle;font-weight:600;`)}>
      <Icon name={p.icon} size={9} sw={2} />{p.label}
    </span>
  )
}
const seg = (active) =>
  `display:flex;align-items:center;gap:6px;height:28px;padding:0 12px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;${active ? 'background:var(--surface3);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2);' : 'background:transparent;color:var(--text2);'}`
const card = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;'
const kpiLabel = 'font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);'
const kpiNum = 'font-family:var(--mono);font-size:26px;font-weight:500;margin-top:7px;'
const th = (align = 'left', cls = '') => ({ cls, s: `text-align:${align};padding:9px 10px;font-weight:600;color:var(--text2);font-size:10.5px;letter-spacing:.04em;border-bottom:1px solid var(--border);` })
const sectionLabel = 'font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:8px;'
const sectionHead = 'display:flex;align-items:center;gap:10px;margin:28px 0 4px;flex-wrap:wrap;'
const sectionH3 = 'margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em;'
const sectionIntro = 'font-size:12px;color:var(--text3);margin-bottom:14px;max-width:820px;'

function LikelihoodBar({ l }) {
  const cat = catOf(l)
  return (
    <div style={css('display:flex;align-items:center;gap:8px;')}>
      <div style={css('flex:1;min-width:48px;height:5px;border-radius:3px;background:var(--surface3);overflow:hidden;')}>
        <div style={css(`height:100%;width:${Math.round(l * 100)}%;background:var(${catVar(cat)});border-radius:3px;`)} />
      </div>
      <span style={css('font-family:var(--mono);font-size:11.5px;color:var(--text2);')}>{l.toFixed(2)}</span>
    </div>
  )
}

function GateBadge({ ok }) {
  return (
    <span style={css(`display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid var(--border);${ok ? 'color:var(--green);background:var(--green-tint);' : 'color:var(--text3);background:var(--surface2);'}`)}>
      {ok ? <Icon name="check" size={11} sw={2.4} /> : <Icon name="x" size={11} sw={2.4} />}
      {ok ? 'Use-mismatch' : 'Original use'}
    </span>
  )
}

const METROS = ['All', 'Orlando', 'Nashville']

export default function ReuseFinder() {
  const [selId, setSelId] = useState(REUSE_CANDIDATES[0]?.id)
  const sel = REUSE_CANDIDATES.find((c) => c.id === selId) || REUSE_CANDIDATES[0]

  const flagged = REUSE_CANDIDATES.filter((c) => c.needsReview).length
  const confirmed = REUSE_CANDIDATES.filter((c) => c.useMismatch && c.likelihood >= 0.5).length

  const seedSFs = SEED_LISTINGS.map((s) => s.sf)
  const seedMin = Math.min(...seedSFs)
  const seedMax = Math.max(...seedSFs)
  const seedYard = SEED_LISTINGS.filter((s) => !/^none/i.test(s.yard)).length

  const [bbMetro, setBbMetro] = useState('All')
  const [bbBandOnly, setBbBandOnly] = useState(false)
  const bbRows = BUYBOX_CANDIDATES
    .filter((d) => (bbMetro === 'All' || d.metro === bbMetro) && (!bbBandOnly || inBand(d.sf)))
    .sort((a, b) => b.sf - a.sf)
  const bbBandCount = BUYBOX_CANDIDATES.filter((d) => inBand(d.sf)).length

  return (
    <div className="content-pad" data-screen-label="Reuse Finder" style={css('flex:1;overflow-y:auto;min-height:0;padding:22px 26px;')}>
      {/* page header */}
      <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap;')}>
        <h2 style={css('margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;')}>Adaptive Reuse Finder</h2>
        <span style={css('font-size:10.5px;color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:6px;font-weight:500;')}>Sourcing + reuse detection</span>
      </div>
      <div style={css('font-size:12.5px;color:var(--text3);margin-bottom:22px;max-width:820px;')}>
        Trained on a buy-box of seed example properties, the agent scrapes the market for matching deals and sweeps Google
        Street View for buildings already adaptively reused. Below, in order: <strong style={css('color:var(--text2);')}>what the agent
        found</strong>, the <strong style={css('color:var(--text2);')}>seed buy-box</strong> it learned from, then the <strong style={css('color:var(--text2);')}>Street View sweep</strong>.
      </div>

      {/* ===================== 1 · AGENT-FOUND CANDIDATES ===================== */}
      <div style={css(sectionHead)}>
        <h3 style={css(sectionH3)}>Agent-found candidates</h3>
        <span title="Deals the agent discovered online (LoopNet sourcing pass) by applying the seed buy-box — not user-provided." style={css('display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--green);background:var(--green-tint);border:1px solid var(--border);padding:3px 9px;border-radius:6px;')}><Icon name="search" size={11} sw={1.8} />Found online by the agent</span>
      </div>
      <div style={css(sectionIntro)}>
        Deals the agent <strong style={css('color:var(--text2);')}>found online</strong> (LoopNet sourcing pass) by applying the seed
        buy-box (below) — on / near-market for-sale, older mid-large industrial, ranked by size. Each is flagged
        <strong style={css('color:var(--green);')}> Found</strong>. Explicitly excludes the {SEED_LISTINGS.length} seed examples.
        <strong style={css('color:var(--accent);')}> ★ in-band</strong> = SF ≥ {fmtSF(BUYBOX_TARGET.sfMin)}; yard/IOS not yet confirmed per-property. SF/year from LoopNet cards — verify.
      </div>

      <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;')}>
        <div style={css('display:flex;gap:2px;padding:3px;background:var(--surface);border:1px solid var(--border);border-radius:8px;')}>
          {METROS.map((m) => <button key={m} className="hov" onClick={() => setBbMetro(m)} style={css(seg(bbMetro === m))}>{m}</button>)}
        </div>
        <label style={css('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;')}>
          <input type="checkbox" checked={bbBandOnly} onChange={() => setBbBandOnly((v) => !v)} style={css('accent-color:var(--accent);width:15px;height:15px;')} />
          In-band only (≥ {fmtSF(BUYBOX_TARGET.sfMin)} SF)
        </label>
        <div style={css('flex:1;')} />
        <span style={css('font-size:12px;color:var(--text2);')}><span style={css('font-family:var(--mono);color:var(--text);')}>{bbRows.length}</span> shown · <span style={css('font-family:var(--mono);color:var(--accent);')}>{bbBandCount}</span> in-band</span>
      </div>

      <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;')}>
        <div className="data-table-wrap" style={css('overflow-x:auto;')}>
          <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
            <thead>
              <tr style={css('background:var(--surface2);')}>
                {[th('left'), th('left'), th('right'), th('right', 'col-secondary'), th('left'), th('left'), th('right')].map((c, i) => (
                  <th key={i} className={c.cls} style={css(c.s)}>{['ADDRESS', 'METRO', 'SF', 'YEAR', 'STATUS', 'BAND', 'LISTING'][i]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bbRows.map((d) => {
                const band = inBand(d.sf)
                return (
                  <tr key={d.id} className="hov" style={css(`border-top:1px solid var(--border);${band ? 'background:var(--accent-dim);' : ''}`)}>
                    <td style={css('padding:10px;font-weight:500;white-space:nowrap;')}>{d.addr}{d.note && <span style={css('color:var(--text3);font-weight:400;')}> · {d.note}</span>}<ProvTag source={d.source} /></td>
                    <td style={css('padding:10px;color:var(--text2);')}>{d.metro}</td>
                    <td style={css('padding:10px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;')}>{fmtSF(d.sf)}</td>
                    <td className="col-secondary" style={css('padding:10px;text-align:right;font-family:var(--mono);color:var(--text2);')}>{d.year ?? '—'}</td>
                    <td style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{d.status}</td>
                    <td style={css('padding:10px;')}>{band ? <span style={css('display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:2px 8px;border-radius:5px;white-space:nowrap;')}>★ In-band</span> : <span style={css('color:var(--text3);')}>—</span>}</td>
                    <td style={css('padding:10px;text-align:right;white-space:nowrap;')}><a href={d.url} target="_blank" rel="noreferrer" className="hov" style={css('display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--accent);text-decoration:none;')}>LoopNet<Icon name="cite" size={12} sw={1.8} /></a></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* mobile cards */}
        <div className="card-list" style={css('flex-direction:column;')}>
          {bbRows.map((d) => {
            const band = inBand(d.sf)
            return (
              <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={css(`display:flex;flex-direction:column;gap:7px;padding:14px;border-top:1px solid var(--border);text-decoration:none;color:inherit;${band ? 'background:var(--accent-dim);' : ''}`)}>
                <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css('font-weight:600;font-size:14px;flex:1;')}>{d.addr}{d.note ? ` · ${d.note}` : ''}</span><ProvTag source={d.source} ml={false} />{band && <span style={css('font-size:11px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:2px 7px;border-radius:5px;')}>★ In-band</span>}</div>
                <div style={css('display:flex;gap:14px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{d.metro}</span><span style={css('font-family:var(--mono);')}>{fmtSF(d.sf)} SF</span><span>{d.year ?? '—'}</span><span>{d.status}</span></div>
              </a>
            )
          })}
        </div>
      </div>

      {/* ===================== 2 · SEED EXAMPLES (THE BUY-BOX) ===================== */}
      <div style={css(sectionHead)}>
        <h3 style={css(sectionH3)}>The buy-box · seed examples</h3>
        <span title="Founder example properties you pasted from a Teams chat — the agent learns the target profile from these, then scrapes for matches." style={css('display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:3px 9px;border-radius:6px;')}><Icon name="flag" size={11} sw={1.8} />From Teams · trains the agent</span>
      </div>
      <div style={css(sectionIntro)}>
        The founder's example properties you pasted from Teams — the agent learns the buy-box from these, then scrapes for the
        candidates above. <strong style={css('color:var(--text2);')}>{SEED_LISTINGS.length} examples · {fmtSF(seedMin)}–{fmtSF(seedMax)} SF · 1950s–1970s industrial / manufacturing · {seedYard} of {SEED_LISTINGS.length} with a fenced yard / laydown (IOS)</strong> —
        the dominant throughline. Each is flagged <strong style={css('color:var(--accent);')}>Seed</strong> (not a deal the agent found).
      </div>

      <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;')}>
        <div className="data-table-wrap" style={css('overflow-x:auto;')}>
          <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
            <thead>
              <tr style={css('background:var(--surface2);')}>
                {[th('left'), th('left'), th('right'), th('right', 'col-secondary'), th('right', 'col-secondary'), th('left'), th('left', 'col-secondary'), th('left'), th('left')].map((c, i) => (
                  <th key={i} className={c.cls} style={css(c.s)}>{['ADDRESS', 'METRO', 'SF', 'LAND', 'BUILT', 'CLEAR HT', 'ZONING', 'YARD / IOS', 'STATUS'][i]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEED_LISTINGS.map((d) => {
                const noYard = /^none/i.test(d.yard)
                return (
                  <tr key={d.id} className="hov" style={css('border-top:1px solid var(--border);')}>
                    <td style={css('padding:10px;')}>
                      <div style={css('font-weight:500;white-space:nowrap;')}>{d.addr}<ProvTag source="seed" /></div>
                      {d.note && <div style={css('font-size:10.5px;color:var(--text3);margin-top:3px;max-width:300px;line-height:1.45;')}>{d.note}</div>}
                    </td>
                    <td style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{d.metro}, {d.st}</td>
                    <td style={css('padding:10px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;')}>{fmtSF(d.sf)}</td>
                    <td className="col-secondary" style={css('padding:10px;text-align:right;font-family:var(--mono);color:var(--text2);white-space:nowrap;')}>{d.landAc != null ? `${d.landAc} AC` : '—'}{d.coveragePct != null ? ` · ${d.coveragePct}%` : ''}</td>
                    <td className="col-secondary" style={css('padding:10px;text-align:right;font-family:var(--mono);color:var(--text2);')}>{d.built ?? '—'}</td>
                    <td style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{d.clearHt ?? '—'}</td>
                    <td className="col-secondary" style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{d.zoning}</td>
                    <td style={css(`padding:10px;font-size:11.5px;max-width:200px;${noYard ? 'color:var(--text3);' : 'color:var(--green);'}`)}>{d.yard}</td>
                    <td style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{d.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* mobile cards */}
        <div className="card-list" style={css('flex-direction:column;')}>
          {SEED_LISTINGS.map((d) => (
            <div key={d.id} style={css('display:flex;flex-direction:column;gap:7px;padding:14px;border-top:1px solid var(--border);')}>
              <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css('font-weight:600;font-size:14px;flex:1;')}>{d.addr}</span><ProvTag source="seed" ml={false} /></div>
              <div style={css('display:flex;gap:14px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{d.metro}, {d.st}</span><span style={css('font-family:var(--mono);')}>{fmtSF(d.sf)} SF</span><span>{d.built ?? '—'}</span><span>{d.clearHt ?? '—'} · {d.zoning}</span><span>{d.status}</span></div>
              <div style={css('font-size:11.5px;color:var(--text3);')}>Yard / IOS: {d.yard}</div>
              {d.note && <div style={css('font-size:11px;color:var(--text3);')}>{d.note}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ===================== 3 · STREET VIEW REUSE SWEEP ===================== */}
      <div style={css(sectionHead)}>
        <h3 style={css(sectionH3)}>Street View reuse sweep</h3>
        <span title="Area sweep of Google Street View via the Claude-in-Chrome extension (human-VLM) to flag buildings already adaptively reused." style={css('display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);padding:3px 9px;border-radius:6px;')}><Icon name="recycle" size={11} sw={1.8} />human-VLM · {REUSE_CANDIDATES.length} stops</span>
      </div>
      <div style={css(sectionIntro)}>
        Sweeps an area in Google Street View and flags buildings that have <strong style={css('color:var(--text2);')}>already been adaptively reused</strong> —
        former warehouses, garages, gas-stations now used as homes, cafés, offices. The gate: a building counts as reuse only when its
        <em> current</em> use ≠ what the envelope was built for; if the original use is still operating, likelihood is capped low.
      </div>

      {/* KPIs */}
      <div className="supply-kpis" style={css('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;')}>
        <div style={css(card)}><div style={css(kpiLabel)}>Areas swept</div><div style={css(kpiNum)}>{REUSE_AREAS.length}</div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Stops classified</div><div style={css(kpiNum)}>{REUSE_CANDIDATES.length}</div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Flagged for review</div><div style={css(kpiNum + 'color:var(--amber);')}>{flagged}</div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Reuse confirmed</div><div style={css(kpiNum)}>{confirmed}</div></div>
      </div>

      {/* gate explainer */}
      <div style={css('display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:20px;')}>
        <Icon name="alert" size={15} sw={1.8} stroke="var(--text2)" style={css('flex:0 0 auto;margin-top:1px;')} />
        <span style={css('font-size:12px;color:var(--text2);line-height:1.6;')}>
          <strong style={css('color:var(--text);')}>Use-mismatch is the gate.</strong> Both swept stops fail it — one is a maintained
          1962 factory still in industrial use, the other is industrial-aesthetic new-build (pending a Franklin County GIS year-built
          check). Faithful result: candidates surfaced, <strong>zero confirmed conversions</strong> yet.
        </span>
      </div>

      {/* table + detail */}
      <div className="reuse-grid" style={css('display:grid;grid-template-columns:1.5fr 340px;gap:16px;align-items:start;')}>
        <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;')}>
          <div style={css('display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--border);')}>
            <span style={css('font-size:11.5px;font-weight:600;color:var(--text2);')}>Sweep candidates</span>
            <span style={css('font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;')}>Real sweep · 2026-06-25</span>
          </div>

          <div className="data-table-wrap" style={css('overflow-x:auto;')}>
            <table style={css('width:100%;border-collapse:collapse;font-size:12.5px;')}>
              <thead>
                <tr style={css('background:var(--surface2);')}>
                  {[th('left'), th('left'), th('left'), th('left'), th('left'), th('left', 'col-secondary'), th('left')].map((c, i) => (
                    <th key={i} className={c.cls} style={css(c.s)}>{['ADDRESS', 'MARKET', 'LIKELIHOOD', 'CONFIDENCE', 'ORIGINAL → CURRENT USE', 'GATE', 'VERDICT'][i]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REUSE_CANDIDATES.map((c) => {
                  const cat = catOf(c.likelihood)
                  const v = verdictOf(c)
                  return (
                    <tr key={c.id} className="hov" tabIndex={0} role="button" onClick={() => setSelId(c.id)}
                      style={css(`cursor:pointer;border-top:1px solid var(--border);background:var(${c.id === selId ? catTintVar(cat) : '--surface'});`)}>
                      <td style={css('padding:10px;font-weight:500;white-space:nowrap;')}>{c.addr}</td>
                      <td style={css('padding:10px;color:var(--text2);white-space:nowrap;')}>{c.mkt}, {c.st}</td>
                      <td style={css('padding:10px;min-width:120px;')}><LikelihoodBar l={c.likelihood} /></td>
                      <td style={css('padding:10px;')}><span style={css('font-size:11px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:5px;white-space:nowrap;')}>{BAND_LABEL[c.band] || c.band}</span></td>
                      <td style={css('padding:10px;color:var(--text2);font-size:11.5px;max-width:280px;')}>{c.originalUse} <span style={css('color:var(--text3);')}>→</span> {c.currentUse}</td>
                      <td className="col-secondary" style={css('padding:10px;')}><GateBadge ok={c.useMismatch} /></td>
                      <td style={css('padding:10px;white-space:nowrap;')}><span style={css('display:inline-flex;align-items:center;gap:6px;')}><span style={css(scDot(v.cat))} /><span style={css(scLabel(v.cat))}>{v.label}</span></span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <div className="card-list" style={css('flex-direction:column;')}>
            {REUSE_CANDIDATES.map((c) => {
              const cat = catOf(c.likelihood)
              const v = verdictOf(c)
              return (
                <div key={c.id} className="hov" tabIndex={0} role="button" onClick={() => setSelId(c.id)}
                  style={css(`display:flex;flex-direction:column;gap:8px;padding:14px;border-top:1px solid var(--border);cursor:pointer;background:var(${c.id === selId ? catTintVar(cat) : '--surface'});`)}>
                  <div style={css('display:flex;align-items:center;gap:9px;')}><span style={css(scDot(v.cat))} /><span style={css('font-weight:600;font-size:14px;flex:1;')}>{c.addr}</span><span style={css(scLabel(v.cat) + 'font-size:11.5px;')}>{v.label}</span></div>
                  <div style={css('display:flex;gap:14px;font-size:12px;color:var(--text2);flex-wrap:wrap;')}><span>{c.mkt}, {c.st}</span><span style={css('font-family:var(--mono);')}>likelihood {c.likelihood.toFixed(2)}</span><span>{BAND_LABEL[c.band] || c.band}</span></div>
                  <div style={css('font-size:11.5px;color:var(--text3);')}>{c.originalUse} → {c.currentUse}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* detail card */}
        {sel && (() => {
          const v = verdictOf(sel)
          return (
            <div style={css(card + 'position:sticky;top:0;')}>
              <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:3px;')}>
                <span style={css(scDot(v.cat))} /><span style={css(scLabel(v.cat) + 'font-size:11.5px;font-weight:600;')}>{v.label}</span>
                <span style={css('margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text3);')}>{sel.likelihood.toFixed(2)} · {BAND_LABEL[sel.band] || sel.band}</span>
              </div>
              <div style={css('font-size:16px;font-weight:600;letter-spacing:-.01em;')}>{sel.addr}</div>
              <div style={css('color:var(--text2);font-size:12px;margin-bottom:14px;')}>{sel.area} · {sel.mkt}, {sel.st}</div>

              <div style={css(sectionLabel)}>Use-mismatch gate</div>
              <div style={css('margin-bottom:14px;')}><GateBadge ok={sel.useMismatch} /></div>

              {sel.signals.length > 0 && (
                <>
                  <div style={css(sectionLabel)}>Visual signals</div>
                  <div style={css('display:flex;flex-direction:column;gap:5px;margin-bottom:14px;font-size:11.5px;color:var(--text2);')}>
                    {sel.signals.map((s, i) => <div key={i}>• {s}</div>)}
                  </div>
                </>
              )}

              <div style={css(sectionLabel)}>Reasoning</div>
              <div style={css('font-size:11.5px;color:var(--text2);line-height:1.65;margin-bottom:14px;')}>{sel.reasoning}</div>

              {sel.reviewReason && (
                <>
                  <div style={css(sectionLabel)}>Why review is needed</div>
                  <div style={css('font-size:11.5px;color:var(--text2);line-height:1.65;background:var(--amber-tint);border:1px solid var(--border);border-radius:8px;padding:10px 11px;margin-bottom:14px;')}>{sel.reviewReason}</div>
                </>
              )}

              <div style={css('display:flex;gap:14px;font-size:11px;color:var(--text3);margin-bottom:14px;')}>
                <span>Assessed {sel.assessedAt}</span><span>Imagery {sel.captureDate}</span>
              </div>

              <a href={sel.streetviewUrl} target="_blank" rel="noreferrer" className="tap hov"
                style={css('display:flex;align-items:center;justify-content:center;gap:7px;height:38px;border-radius:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:12px;text-decoration:none;')}>
                <Icon name="map" size={14} sw={1.8} />Open Street View pano
              </a>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
