// Tiny CSS-string → React-style-object parser.
// Lets us port the design's inline style strings near-verbatim:
//   <div style={css("display:flex;gap:8px;background:var(--surface)")} />
// CSS custom properties (--x) are passed through untouched so var(--accent) etc. work.
const cache = new Map()

export function css(str) {
  if (!str) return undefined
  const cached = cache.get(str)
  if (cached) return cached
  const obj = {}
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':')
    if (i === -1) continue
    let prop = decl.slice(0, i).trim()
    const val = decl.slice(i + 1).trim()
    if (!prop || !val) continue
    if (prop.startsWith('--')) {
      obj[prop] = val // CSS variable — keep as-is
    } else {
      prop = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      obj[prop] = val
    }
  }
  cache.set(str, obj)
  return obj
}
