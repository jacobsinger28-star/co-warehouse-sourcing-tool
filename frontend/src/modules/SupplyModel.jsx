import { useState } from 'react'
import { css } from '../css.js'
import { SUBMARKETS, SUPPLY_TOTAL_SF } from '../data.js'
import { fmtInt, cardBox as card, kpiLabel, kpiNum } from '../helpers.js'

const maxPct = Math.max(...SUBMARKETS.map((s) => s.pct))

export default function SupplyModel() {
  const [devSF, setDevSF] = useState(250000)
  const [submarket, setSubmarket] = useState('Hilliard')

  const sub = SUBMARKETS.find((s) => s.name === submarket) || SUBMARKETS[0]
  const metroPct = ((devSF / SUPPLY_TOTAL_SF) * 100).toFixed(1)
  const subPct = ((devSF / sub.sf) * 100).toFixed(1)

  return (
    <div className="content-pad" data-screen-label="Supply Model" style={css('flex:1;overflow-y:auto;min-height:0;padding:22px 26px;')}>
      <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:20px;')}>
        <h2 style={css('margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;')}>Supply Model</h2>
        <span style={css('font-size:10.5px;color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:6px;font-weight:500;')}>Internal · CoStar-licensed</span>
        <div style={css('flex:1;')} />
        <select style={css('height:32px;padding:0 12px;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:12.5px;')}>
          <option>Columbus, OH</option>
          <option>Nashville, TN</option>
          <option>Charlotte, NC</option>
          <option>Charleston, SC</option>
        </select>
      </div>

      <div className="supply-kpis" style={css('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;')}>
        <div style={css(card)}><div style={css(kpiLabel)}>Total existing supply</div><div style={css(kpiNum)}>9.83M<span style={css('font-size:14px;color:var(--text3);')}> SF</span></div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Buildings</div><div style={css(kpiNum)}>99</div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Metro vacancy</div><div style={css(kpiNum)}>6.2<span style={css('font-size:14px;color:var(--text3);')}>%</span></div></div>
        <div style={css(card)}><div style={css(kpiLabel)}>Avg asking rent</div><div style={css(kpiNum)}>$8.40<span style={css('font-size:14px;color:var(--text3);')}>/SF</span></div></div>
      </div>

      <div className="supply-grid" style={css('display:grid;grid-template-columns:1.3fr 1fr;gap:16px;')}>
        <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;')}>
          <div style={css('font-size:13px;font-weight:600;margin-bottom:16px;')}>Submarket breakdown</div>
          {SUBMARKETS.map((s) => (
            <div key={s.name} style={css('margin-bottom:14px;')}>
              <div style={css('display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;')}>
                <span>{s.name}</span>
                <span style={css('font-family:var(--mono);color:var(--text2);')}>{s.pct}% · {(s.sf / 1e6).toFixed(2)}M SF</span>
              </div>
              <div style={css('height:9px;border-radius:5px;background:var(--surface3);overflow:hidden;')}>
                <div style={css(`height:100%;width:${(s.pct / maxPct) * 100}%;background:var(--accent);border-radius:5px;`)} />
              </div>
            </div>
          ))}
        </div>

        <div style={css('background:var(--surface);border:1px solid var(--accent-line);border-radius:10px;padding:18px;')}>
          <div style={css('font-size:13px;font-weight:600;margin-bottom:4px;')}>New development impact</div>
          <div style={css('font-size:11.5px;color:var(--text3);margin-bottom:16px;')}>Model a new building against current supply</div>

          <label style={css('display:block;font-size:11px;color:var(--text2);margin-bottom:6px;')}>Building size (SF)</label>
          <input type="number" value={devSF} onChange={(e) => setDevSF(Number(e.target.value) || 0)}
            style={css('width:100%;height:36px;padding:0 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-family:var(--mono);font-size:15px;outline:none;margin-bottom:14px;')} />

          <label style={css('display:block;font-size:11px;color:var(--text2);margin-bottom:6px;')}>Submarket</label>
          <select value={submarket} onChange={(e) => setSubmarket(e.target.value)}
            style={css('width:100%;height:36px;padding:0 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:18px;')}>
            {SUBMARKETS.map((s) => <option key={s.name}>{s.name}</option>)}
          </select>

          <div style={css('background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:16px;')}>
            <div style={css('font-family:var(--mono);font-size:13px;color:var(--text2);margin-bottom:12px;')}>{fmtInt(devSF)} SF added →</div>
            <div style={css('display:flex;gap:20px;')}>
              <div>
                <div style={css('font-family:var(--mono);font-size:24px;font-weight:500;color:var(--accent);')}>+{metroPct}%</div>
                <div style={css('font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;')}>of metro supply</div>
              </div>
              <div>
                <div style={css('font-family:var(--mono);font-size:24px;font-weight:500;color:var(--accent);')}>+{subPct}%</div>
                <div style={css('font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;')}>of {submarket}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
