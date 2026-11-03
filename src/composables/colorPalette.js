// 深色科技风协调配色：
// 统一中高明度 + 相近饱和度，既能彼此协调，也保证徽标上的深色文字（#04121a）可读。
export const RANDOM_PALETTE = [
  '#00e5ff',
  '#38bdf8',
  '#60a5fa',
  '#818cf8',
  '#a78bfa',
  '#e879f9',
  '#f472b6',
  '#fb7185',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#2dd4bf'
]

// 洗牌，用于批量随机配色时避免重复
export function shuffledPalette() {
  const arr = [...RANDOM_PALETTE]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 单区域随机取色：尽量避开当前颜色
export function randomColor(exclude) {
  const pool = RANDOM_PALETTE.filter((c) => c !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]
}

// 随机配色方式：多彩随机，或让多个区域共同铺开一条同色系渐变
export const RANDOM_COLOR_MODES = [
  { key: 'multi', label: '多彩随机' },
  { key: 'gradient1', label: '同色渐变·浅到深' },
  { key: 'gradient2', label: '同色渐变·深到浅' }
]

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// 与目标色（白/黑）按比例混合，得到同色系的更浅/更深色
function mixColor(hex, target, amount) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const t = Math.max(0, Math.min(1, amount))
  return rgbToHex(rgb.map((v, i) => v + (target[i] - v) * t))
}

export function lightenColor(hex, amount = 0.3) {
  return mixColor(hex, [255, 255, 255], amount)
}

export function darkenColor(hex, amount = 0.3) {
  return mixColor(hex, [0, 0, 0], amount)
}

// 两个颜色之间按比例插值
function mixHex(a, b, t) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  const p = Math.max(0, Math.min(1, t))
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * p))
}

// 以 base 为基准生成 count 个同色系渐变色（每个区域仍是纯色填充）：
//   direction > 0：浅 -> 深；direction < 0：深 -> 浅
// 多个区域按这个顺序取色，整体就是一条跨区域的连续渐变。
export function gradientShades(base, count, direction = 1) {
  const n = Math.max(0, Math.floor(count))
  if (!n) return []
  if (n === 1) return [base]
  const light = lightenColor(base, 0.62)
  const dark = darkenColor(base, 0.45)
  const from = direction > 0 ? light : dark
  const to = direction > 0 ? dark : light
  return Array.from({ length: n }, (_, i) => mixHex(from, to, i / (n - 1)))
}
