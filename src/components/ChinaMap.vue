<template>
  <div ref="container" class="map-container">
    <svg ref="svgEl" class="map-svg">
      <g :transform="mapTransform">
        <path v-if="contextPath" :d="contextPath" class="context" />
        <path
          v-for="r in shownRegions"
          :key="r.adcode"
          :d="r.d"
          :data-adcode="r.adcode"
          class="region"
          :class="{ configured: r.configured, selected: r.adcode === selectedAdcode }"
          :style="{ '--accent': r.accent }"
          fill-rule="evenodd"
          @click="onPick(r)"
        />
      </g>
    </svg>

    <div class="label-layer">
      <div
        v-for="r in shownRegions"
        :key="'l' + r.adcode"
        class="region-label"
        :class="{ selected: r.adcode === selectedAdcode }"
        :style="labelStyle(r)"
      >
        <span v-if="labelNameVisible" class="name">{{ r.name }}</span>
        <div v-if="r.displayMode !== 'bubble' && r.values.length" class="values">
          <span v-for="(v, i) in r.values" :key="i" class="value">{{ v }}</span>
        </div>
      </div>
    </div>

    <div
      v-if="bubbleRegion"
      ref="bubbleEl"
      class="bubble"
      :style="{ left: bubbleStyle.left, top: bubbleStyle.top, '--accent': bubbleRegion.accent }"
    >
      <button class="bubble-close" type="button" title="关闭气泡" aria-label="关闭气泡" @click.stop="closeBubble">
        ×
      </button>
      <div class="bubble-title">{{ bubbleRegion.name }}</div>
      <div v-if="bubbleRegion.bubbleHeadcount != null" class="bubble-row">
        人数：{{ bubbleRegion.bubbleHeadcount }}
      </div>
      <div v-if="bubbleRegion.bubblePositions.length" class="bubble-block">
        <div class="bubble-row bubble-head">岗位</div>
        <div class="bubble-grid">
          <div v-for="(p, i) in bubbleRegion.bubblePositions" :key="i" class="bubble-pos">
            <span class="bubble-pos-name" :title="p.name || '未命名'">{{ p.name || '未命名' }}</span>
            <span v-if="p.count != null" class="bubble-pos-count">{{ p.count }}人</span>
          </div>
        </div>
      </div>
      <div v-if="bubbleRegion.bubbleRosterNames.length" class="bubble-row bubble-roster">
        人员：{{ bubbleRegion.bubbleRosterNames.join('、') }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { geoMercator } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { useDivisions } from '../composables/useDivisions'
import { useTheme } from '../composables/useTheme'

const props = defineProps({
  divisions: { type: Array, default: () => [] },
  config: { type: Object, default: () => ({}) },
  mode: { type: String, default: 'province' },
  provinceAdcode: { type: [String, Number], default: null },
  selectedAdcode: { type: [String, Number], default: null },
  // 分组浏览时只展示这些 adcode；为空表示显示全部
  filterAdcodes: { type: Array, default: () => [] },
  // 地图标签 / 气泡里显示哪些内容（缺省项视为显示）
  displayOptions: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['region-click'])

const { loadProvinces, loadCities } = useDivisions()
const { theme } = useTheme()

const container = ref(null)
const svgEl = ref(null)

const projection = geoMercator()
const PAD = 24
const MIN_ZOOM = 1
const MAX_ZOOM = 32
const DEFAULT_ACCENT = '#00e5ff'

let provinceFC = null
let renderToken = 0
let zoomBehavior = null
let currentFeatures = []
let chinaBounds = [[0, 0], [0, 0]]

const regions = ref([])
// 分组浏览（如北一区）时只保留指定区域
const shownRegions = computed(() => {
  const filter = props.filterAdcodes
  if (!filter || !filter.length) return regions.value
  const set = new Set(filter.map(String))
  return regions.value.filter((r) => set.has(r.adcode))
})
const contextPath = ref('')
const zoomState = reactive({ k: 1, x: 0, y: 0 })

const mapTransform = computed(() => `translate(${zoomState.x},${zoomState.y}) scale(${zoomState.k})`)

// 气泡展示：仅当前选中、且设置为 bubble 的区域显示
const bubbleEl = ref(null)
const bubbleBox = reactive({ w: 300, h: 150 })
// 点右上角 × 后先隐藏气泡，选中状态保留（右侧面板不受影响）
const bubbleDismissed = ref(false)

// 地图标签是否显示区域名称（其余项目在 applyConfig 里按勾选过滤）
const labelNameVisible = computed(() => (props.displayOptions || {}).labelName !== false)

const bubbleRegion = computed(() => {
  if (bubbleDismissed.value) return null
  if (props.selectedAdcode == null) return null
  const key = String(props.selectedAdcode)
  const r = shownRegions.value.find((x) => x.adcode === key)
  if (!r || r.displayMode !== 'bubble' || !r.hasBubbleContent) return null
  return r
})

function closeBubble() {
  bubbleDismissed.value = true
}

// 切换到别的区域时恢复气泡显示
watch(
  () => props.selectedAdcode,
  () => {
    bubbleDismissed.value = false
  }
)

// 气泡居中显示在区域重心上；靠近视口边缘时整体收进来，避免被裁掉
const bubbleStyle = computed(() => {
  const r = bubbleRegion.value
  if (!r) return { left: '0px', top: '0px' }
  const k = zoomState.k
  const x = r.cx * k + zoomState.x
  const y = r.cy * k + zoomState.y
  const cw = container.value ? container.value.clientWidth : 0
  const ch = container.value ? container.value.clientHeight : 0
  const halfW = cw ? Math.min(bubbleBox.w / 2 + 6, cw / 2) : 0
  const halfH = ch ? Math.min(bubbleBox.h / 2 + 6, ch / 2) : 0
  const left = cw ? Math.min(Math.max(x, halfW), cw - halfW) : x
  const top = ch ? Math.min(Math.max(y, halfH), ch - halfH) : y
  return { left: `${left}px`, top: `${top}px` }
})

function measureBubble() {
  const el = bubbleEl.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  if (w && h && (w !== bubbleBox.w || h !== bubbleBox.h)) {
    bubbleBox.w = w
    bubbleBox.h = h
  }
}

// 气泡内容变化后重新量高度，用于边缘收拢
watch(bubbleRegion, async () => {
  await nextTick()
  measureBubble()
})

// ---------- 几何工具 ----------
function polygonsOf(feature) {
  const g = feature.geometry
  if (!g) return []
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates
}

// Ramer–Douglas–Peucker：按容差精简折线 / 多边形环，显著减少 SVG 节点数
function simplifyPoints(points, tolerance) {
  const n = points.length
  if (n <= 4 || tolerance <= 0) return points
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack = [[0, n - 1]]
  const tol2 = tolerance * tolerance
  while (stack.length) {
    const [start, end] = stack.pop()
    const [x1, y1] = points[start]
    const [x2, y2] = points[end]
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    let maxD2 = 0
    let idx = -1
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i]
      let d2
      if (len2 === 0) {
        d2 = (x - x1) * (x - x1) + (y - y1) * (y - y1)
      } else {
        const t = ((x - x1) * dx + (y - y1) * dy) / len2
        const px = x1 + t * dx
        const py = y1 + t * dy
        d2 = (x - px) * (x - px) + (y - py) * (y - py)
      }
      if (d2 > maxD2) {
        maxD2 = d2
        idx = i
      }
    }
    if (maxD2 > tol2 && idx > 0) {
      keep[idx] = 1
      stack.push([start, idx], [idx, end])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

function featureToPathD(feature, tolerance = 0, decimals = 2) {
  let d = ''
  for (const poly of polygonsOf(feature)) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      let pts = []
      for (const [lng, lat] of ring) {
        const p = projection([lng, lat])
        if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(p)
      }
      if (tolerance > 0 && pts.length > 4) pts = simplifyPoints(pts, tolerance)
      if (pts.length < 3) continue
      d += 'M' + pts.map((p) => p[0].toFixed(decimals) + ',' + p[1].toFixed(decimals)).join('L') + 'Z'
    }
  }
  return d
}

// 投影坐标下的面积质心：分组视图按「视觉重心」而不是包围盒居中
function featureAreaCentroid(feature) {
  let crossSum = 0
  let mx = 0
  let my = 0
  for (const poly of polygonsOf(feature)) {
    for (const ring of poly) {
      const pts = ring.map(([lng, lat]) => projection([lng, lat])).filter(Boolean)
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]
        const [x1, y1] = pts[(i + 1) % pts.length]
        const cross = x0 * y1 - x1 * y0
        crossSum += cross
        mx += (x0 + x1) * cross
        my += (y0 + y1) * cross
      }
    }
  }
  if (Math.abs(crossSum) < 1e-9) return { area: 0, x: 0, y: 0 }
  return {
    area: Math.abs(crossSum) / 2,
    x: mx / (3 * crossSum),
    y: my / (3 * crossSum)
  }
}

function featureBounds(feature) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const poly of polygonsOf(feature)) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        const p = projection([lng, lat])
        if (!p) continue
        if (p[0] < x0) x0 = p[0]
        if (p[0] > x1) x1 = p[0]
        if (p[1] < y0) y0 = p[1]
        if (p[1] > y1) y1 = p[1]
      }
    }
  }
  return [[x0, y0], [x1, y1]]
}

// ---------- 投影适配（等比缩放到容器内，居中）----------
function fitProjection(cw, ch) {
  const probe = geoMercator()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const f of provinceFC.features) {
    for (const poly of polygonsOf(f)) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          const p = probe([lng, lat])
          if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
          if (p[0] < x0) x0 = p[0]
          if (p[0] > x1) x1 = p[0]
          if (p[1] < y0) y0 = p[1]
          if (p[1] > y1) y1 = p[1]
        }
      }
    }
  }
  const bw = x1 - x0 || 1
  const bh = y1 - y0 || 1
  const factor = Math.min((cw - 2 * PAD) / bw, (ch - 2 * PAD) / bh)
  const S0 = probe.scale()
  const [baseX, baseY] = probe.translate()
  projection
    .scale(S0 * factor)
    .translate([
      cw / 2 - factor * ((x0 + x1) / 2 - baseX),
      ch / 2 - factor * ((y0 + y1) / 2 - baseY)
    ])
  chinaBounds = [
    [cw / 2 - (factor * bw) / 2, ch / 2 - (factor * bh) / 2],
    [cw / 2 + (factor * bw) / 2, ch / 2 + (factor * bh) / 2]
  ]
}

// ---------- 区域构建 ----------
function buildRegions(features) {
  const arr = []
  for (const f of features) {
    const adcode = String(f.properties.adcode)
    const meta = props.divisions.find((d) => String(d.adcode) === adcode)
    const name = (meta && (meta.shortTitle || meta.title)) || f.properties.name
    const c = projection((f.properties.centroid || f.properties.center)) || [0, 0]
    const mass = featureAreaCentroid(f)
    arr.push({
      adcode,
      name,
      d: featureToPathD(f),
      cx: c[0],
      cy: c[1],
      bounds: featureBounds(f),
      area: mass.area,
      massX: mass.x,
      massY: mass.y,
      configured: false,
      accent: DEFAULT_ACCENT,
      displayMode: 'label',
      values: [],
      bubbleHeadcount: null,
      bubblePositions: [],
      bubbleRosterNames: [],
      hasBubbleContent: false
    })
  }
  regions.value = arr
}

function applyConfig() {
  for (const r of regions.value) {
    const cfg = props.config[r.adcode]
    r.configured = !!(cfg && cfg.color)
    r.accent = (cfg && cfg.color) || DEFAULT_ACCENT
    r.displayMode = cfg && cfg.display === 'bubble' ? 'bubble' : 'label'

    const opt = props.displayOptions || {}
    const positions = cfg && Array.isArray(cfg.positions) ? cfg.positions : []
    const roster = cfg && Array.isArray(cfg.roster) ? cfg.roster : []
    const values = []

    // 标签内容按「显示项」勾选过滤；人员数仅在没显示人数/岗位时补位
    if (opt.labelHeadcount !== false && cfg && cfg.headcount != null) values.push(`人数：${cfg.headcount}`)
    if (opt.labelPositions !== false && positions.length) values.push(`岗位：${positions.length} 类`)
    if (opt.labelRoster !== false && roster.length && !values.length) values.push(`人员：${roster.length} 人`)
    r.values = values

    // 气泡内容：人数、岗位（两列排布）、人员姓名
    const names = roster.map((p) => (p.name || '').trim()).filter(Boolean)
    r.bubbleHeadcount =
      opt.bubbleHeadcount !== false && cfg && cfg.headcount != null ? cfg.headcount : null
    r.bubblePositions = opt.bubblePositions !== false ? positions : []
    r.bubbleRosterNames =
      opt.bubbleRoster !== false
        ? names.length
          ? names
          : roster.length
            ? [`${roster.length} 人`]
            : []
        : []
    r.hasBubbleContent =
      r.bubbleHeadcount != null || r.bubblePositions.length > 0 || r.bubbleRosterNames.length > 0
  }
}

// ---------- 缩放 ----------
function baseTranslateExtent() {
  const m = PAD
  return [[chinaBounds[0][0] - m, chinaBounds[0][1] - m], [chinaBounds[1][0] + m, chinaBounds[1][1] + m]]
}

// 当前视图对应的可平移内容范围（世界坐标）：
//   市级视图 -> 所属省的边界；分组视图 -> 分组整体范围；全国视图 -> null
function focusContentBounds() {
  if (props.mode === 'city' && props.provinceAdcode != null && provinceFC) {
    const parent = provinceFC.features.find(
      (f) => String(f.properties.adcode) === String(props.provinceAdcode)
    )
    if (parent) return featureBounds(parent)
  }
  if (props.filterAdcodes && props.filterAdcodes.length && shownRegions.value.length) {
    return groupBounds()
  }
  return null
}

// 分组/省份视图下，可平移范围以「内容范围」为锚点，四周各留一个视口，并随缩放实时更新。
// 若沿用全国范围，贴近图边的分组（如北一区）拖动一下就会被卡住；
// 若按当前视口计算，缩小视图时 d3 会判定「可平移范围比视口还小」而锁死横向拖动。
function syncTranslateExtent(k = zoomState.k) {
  if (!zoomBehavior) return
  const content = focusContentBounds()
  if (!content) {
    zoomBehavior.translateExtent(baseTranslateExtent())
    return
  }
  const cw = container.value ? container.value.clientWidth : 0
  const ch = container.value ? container.value.clientHeight : 0
  if (!cw || !ch) return
  const vw = cw / k
  const vh = ch / k
  zoomBehavior.translateExtent([
    [content[0][0] - vw, content[0][1] - vh],
    [content[1][0] + vw, content[1][1] + vh]
  ])
}

function zoomToBounds(bounds, animate = true, focus = null) {
  const [[x0, y0], [x1, y1]] = bounds
  const cw = container.value.clientWidth
  const ch = container.value.clientHeight
  const dx = Math.max(x1 - x0, 1)
  const dy = Math.max(y1 - y0, 1)
  const k = Math.max(MIN_ZOOM, Math.min((Math.min(cw / dx, ch / dy)) * 0.8, MAX_ZOOM))
  const fx = focus ? focus[0] : (x0 + x1) / 2
  const fy = focus ? focus[1] : (y0 + y1) / 2
  let tx = cw / 2 - fx * k
  let ty = ch / 2 - fy * k
  // 按视觉重心居中时，仍保证整个范围不超出容器
  tx = Math.min(Math.max(tx, -x0 * k), cw - x1 * k)
  ty = Math.min(Math.max(ty, -y0 * k), ch - y1 * k)
  syncTranslateExtent(k)
  const t = zoomIdentity.translate(tx, ty).scale(k)
  const sel = select(svgEl.value)
  if (animate) sel.transition().duration(700).call(zoomBehavior.transform, t)
  else sel.call(zoomBehavior.transform, t)
}

function zoomToNational(animate = true) {
  if (zoomBehavior) zoomBehavior.translateExtent(baseTranslateExtent())
  const sel = select(svgEl.value)
  if (animate) sel.transition().duration(700).call(zoomBehavior.transform, zoomIdentity)
  else sel.call(zoomBehavior.transform, zoomIdentity)
}

function onPick(r) {
  // 再次点击区域时重新弹出气泡（即使是同一个区域）
  bubbleDismissed.value = false
  zoomToBounds(r.bounds, true)
  emit('region-click', r.adcode)
}

// ---------- 渲染 ----------
async function loadAndRender() {
  const token = ++renderToken
  let features = []
  let focusBounds = null

  if (props.mode === 'city' && props.provinceAdcode != null) {
    const parent = provinceFC.features.find((f) => String(f.properties.adcode) === String(props.provinceAdcode))
    let fc = null
    try {
      fc = await loadCities(props.provinceAdcode)
    } catch (e) {
      console.warn('无该省下属数据:', e.message)
    }
    if (token !== renderToken) return
    features = (fc && fc.features) ? fc.features : []
    contextPath.value = parent ? featureToPathD(parent) : ''
    focusBounds = parent ? featureBounds(parent) : null
  } else {
    features = provinceFC.features.filter((f) => String(f.properties.adcode) !== '100000_JD')
    contextPath.value = ''
    focusBounds = null
  }

  currentFeatures = features
  buildRegions(features)
  applyConfig()
  if (focusBounds) zoomToBounds(focusBounds, false)
  else zoomToNational(false)
}

// ---------- 交互：标签定位 ----------
function labelStyle(r) {
  return {
    transform: `translate(${r.cx * zoomState.k + zoomState.x}px, ${r.cy * zoomState.k + zoomState.y}px) translate(-50%, -50%)`
  }
}

// ---------- 导出图片（用于 PPT）----------
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// 画布文本换行（逐字测量，适配中文）
function wrapCanvasText(ctx, value, maxW) {
  const chars = Array.from(String(value))
  const lines = []
  let cur = ''
  for (const ch of chars) {
    const next = cur + ch
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur)
      cur = ch
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

// 单行文本超宽时用省略号截断
function fitCanvasText(ctx, value, maxW) {
  const str = String(value)
  if (ctx.measureText(str).width <= maxW) return str
  let out = str
  while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1)
  return out + '…'
}

const FONT_FAMILY = "Consolas, 'Microsoft YaHei', 'PingFang SC', monospace"
const NAME_H = 14
const BADGE_H = 15
const BADGE_GAP = 3

// Canvas 与 SVG 共用同一套文本测量，保证两种导出的换行 / 省略一致
let measureCtx = null
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

function num(v) {
  return Math.round(v * 100) / 100
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// SVG 1.1 对 rgba() 支持不稳，拆成 rgb + fill-opacity（PPT 更可靠）
function svgColorParts(css) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    String(css)
  )
  if (!m) return { color: css, opacity: 1 }
  return {
    color: `rgb(${Math.round(+m[1])}, ${Math.round(+m[2])}, ${Math.round(+m[3])})`,
    opacity: m[4] == null ? 1 : +m[4]
  }
}

// 单条 SVG 文本。只使用纯 fill，不加描边：
// PowerPoint 不支持 paint-order，描边会盖在文字上导致颜色被冲掉（尤其是浅色主题下发白）。
function svgText(opts, fill) {
  const { text, x, centerY, fontSize, weight = 400, anchor = 'middle' } = opts
  // PPT 对 dominant-baseline 支持有限，按 0.35em 把垂直中心换算成基线
  const y = centerY + fontSize * 0.35
  const base =
    `x="${num(x)}" y="${num(y)}" font-family="${FONT_FAMILY}" font-size="${fontSize}" ` +
    `font-weight="${weight}" text-anchor="${anchor}"`
  // 同时写 fill 属性和 style：不同版本的 PPT / Office 解析 SVG 时兼容性更好
  return `<text ${base} fill="${fill}" style="fill:${fill};stroke:none">${escapeXml(text)}</text>`
}

// 标签布局：屏幕坐标下的名称 + 各条数值（Canvas / SVG 共用）
function computeLabelLayout(r) {
  // 正在展示气泡的区域由气泡自己显示名称，避免底层标签隔着一层半透明背景透出来
  const shownBubble = bubbleRegion.value
  if (shownBubble && shownBubble.adcode === r.adcode) return []
  const k = zoomState.k
  const lx = r.cx * k + zoomState.x
  const ly = r.cy * k + zoomState.y
  const valueList = r.displayMode === 'bubble' ? [] : r.values
  const showName = labelNameVisible.value
  const valuesH = valueList.length * BADGE_H + Math.max(valueList.length - 1, 0) * BADGE_GAP
  const totalH = (showName ? NAME_H : 0) + (valueList.length ? (showName ? 2 : 0) + valuesH : 0)
  const y = ly - totalH / 2
  const items = []
  if (showName) {
    items.push({ text: r.name, x: lx, centerY: y + NAME_H / 2, fontSize: 12, weight: 400 })
  }
  let by = y + (showName ? NAME_H + 2 : 0)
  for (const v of valueList) {
    items.push({ text: v, x: lx, centerY: by + BADGE_H / 2 + 0.5, fontSize: 11, weight: 600 })
    by += BADGE_H + BADGE_GAP
  }
  return items
}

// 气泡布局：与页面 / Canvas 完全一致的尺寸和位置，供 Canvas 与 SVG 共用
function computeBubbleLayout(br, lx, ly, cw, ch) {
  const ctx = getMeasureCtx()
  const padX = 12
  const padY = 10
  const titleH = 18
  const rowH = 16
  const cellH = rowH + 4
  const cellGapY = 2
  const colGap = 8
  const colW = 112
  const titleFont = `600 12px ${FONT_FAMILY}`
  const rowFont = `600 11px ${FONT_FAMILY}`
  const rosterText = br.bubbleRosterNames.length ? `人员：${br.bubbleRosterNames.join('、')}` : ''
  const headcountText = br.bubbleHeadcount != null ? `人数：${br.bubbleHeadcount}` : ''

  // 气泡宽度随内容自适应：取标题、人数、岗位网格、人员行里最宽的一项
  ctx.font = titleFont
  let desiredW = ctx.measureText(br.name).width + 52
  ctx.font = rowFont
  if (headcountText) desiredW = Math.max(desiredW, ctx.measureText(headcountText).width + padX * 2)
  if (br.bubblePositions.length) desiredW = Math.max(desiredW, colW * 2 + colGap + padX * 2)
  if (rosterText) desiredW = Math.max(desiredW, ctx.measureText(rosterText).width + padX * 2)
  const boxW = Math.min(Math.max(desiredW, 140), Math.max(Math.min(360, cw - 8), 140))

  ctx.font = rowFont
  const rosterLines = rosterText ? wrapCanvasText(ctx, rosterText, boxW - padX * 2) : []
  const posRows = Math.ceil(br.bubblePositions.length / 2)

  let boxH = padY * 2 + titleH
  if (br.bubbleHeadcount != null) boxH += 4 + rowH
  if (br.bubblePositions.length) {
    boxH += 4 + rowH + 3 + posRows * cellH + Math.max(posRows - 1, 0) * cellGapY
  }
  if (rosterLines.length) boxH += 4 + rosterLines.length * rowH

  const bx = Math.min(Math.max(lx - boxW / 2, 4), Math.max(cw - boxW - 4, 4))
  const byTop = Math.min(Math.max(ly - boxH / 2, 4), Math.max(ch - boxH - 4, 4))

  let cursor = byTop + padY + titleH
  const headcount =
    br.bubbleHeadcount != null
      ? { text: headcountText, x: bx + padX, centerY: cursor + 4 + rowH / 2 }
      : null
  if (headcount) cursor += 4 + rowH

  let heading = null
  const cells = []
  if (br.bubblePositions.length) {
    cursor += 4
    heading = { text: '岗位', x: bx + padX, centerY: cursor + rowH / 2 }
    cursor += rowH + 3
    br.bubblePositions.forEach((p, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const cellX = bx + padX + col * (colW + colGap)
      const cellY = cursor + row * (cellH + cellGapY)
      const countText = p.count == null ? '' : `${p.count}人`
      ctx.font = rowFont
      const countW = countText ? ctx.measureText(countText).width : 0
      cells.push({
        x: cellX,
        y: cellY,
        w: colW,
        h: cellH,
        name: fitCanvasText(ctx, p.name || '未命名', colW - 12 - countW - 6),
        count: countText,
        nameX: cellX + 6,
        countX: cellX + colW - 6,
        centerY: cellY + cellH / 2
      })
    })
    cursor += posRows * cellH + Math.max(posRows - 1, 0) * cellGapY
  }

  let roster = null
  if (rosterLines.length) {
    cursor += 4
    roster = {
      x: bx + padX,
      lines: rosterLines,
      firstCenterY: cursor + rowH / 2,
      lineH: rowH
    }
  }

  return {
    bx,
    byTop,
    boxW,
    boxH,
    titleX: bx + boxW / 2,
    titleCenterY: byTop + padY + titleH / 2,
    titleFont,
    rowFont,
    headcount,
    heading,
    cells,
    roster
  }
}

// 按当前视图绘制到离屏 Canvas（PNG 导出与剪贴板共用）
function renderCanvas(scale = 2) {
  const cw = container.value ? container.value.clientWidth : 0
  const ch = container.value ? container.value.clientHeight : 0
  if (!cw || !ch) return false

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cw * scale)
  canvas.height = Math.round(ch * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  const bg = ctx.createLinearGradient(0, 0, 0, ch)
  bg.addColorStop(0, theme.value.bg1)
  bg.addColorStop(1, theme.value.bg2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cw, ch)

  const k = zoomState.k
  const selKey = props.selectedAdcode != null ? String(props.selectedAdcode) : ''

  // 区域面：跟随当前缩放/平移，所见即所得
  ctx.save()
  ctx.translate(zoomState.x, zoomState.y)
  ctx.scale(k, k)

  if (contextPath.value) {
    const p = new Path2D(contextPath.value)
    ctx.fillStyle = theme.value.contextFill
    ctx.globalAlpha = 0.5
    ctx.fill(p, 'evenodd')
    ctx.globalAlpha = 1
  }

  for (const r of shownRegions.value) {
    const p = new Path2D(r.d)
    const selected = r.adcode === selKey
    ctx.fillStyle = r.configured ? r.accent : theme.value.regionFill
    ctx.fill(p, 'evenodd')
    ctx.strokeStyle = selected ? theme.value.selectedStroke : theme.value.regionStroke
    ctx.lineWidth = (selected ? 1.2 : 0.5) / k
    ctx.stroke(p)
  }
  ctx.restore()

  // 标签：与页面上的位置一致
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const r of shownRegions.value) {
    for (const it of computeLabelLayout(r)) {
      ctx.font = `${it.weight} ${it.fontSize}px ${FONT_FAMILY}`
      // 与页面一致：所有标签统一用主题文字色，加背景色描边保证可读
      ctx.fillStyle = theme.value.bubbleText
      ctx.shadowColor = theme.value.bg1
      ctx.shadowBlur = 3
      ctx.fillText(it.text, it.x, it.centerY)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }
  }

  // 气泡方式：导出当前显示的气泡（居中于区域重心，岗位两列排布）
  const br = bubbleRegion.value
  if (br) {
    const L = computeBubbleLayout(
      br,
      br.cx * k + zoomState.x,
      br.cy * k + zoomState.y,
      cw,
      ch
    )

    roundRectPath(ctx, L.bx, L.byTop, L.boxW, L.boxH, 8)
    ctx.fillStyle = theme.value.bubbleBg
    ctx.fill()
    ctx.strokeStyle = br.accent
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textBaseline = 'middle'
    ctx.font = L.titleFont
    ctx.fillStyle = br.accent
    ctx.textAlign = 'center'
    ctx.fillText(br.name, L.titleX, L.titleCenterY)

    ctx.font = L.rowFont
    ctx.fillStyle = theme.value.bubbleText
    ctx.textAlign = 'left'

    if (L.headcount) {
      ctx.fillText(L.headcount.text, L.headcount.x, L.headcount.centerY)
    }
    if (L.heading) {
      ctx.fillText(L.heading.text, L.heading.x, L.heading.centerY)
    }

    for (const cell of L.cells) {
      roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, 3)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.fill()
      ctx.fillStyle = theme.value.bubbleText
      ctx.fillText(cell.name, cell.nameX, cell.centerY)
      if (cell.count) {
        ctx.fillStyle = br.accent
        ctx.textAlign = 'right'
        ctx.fillText(cell.count, cell.countX, cell.centerY)
        ctx.textAlign = 'left'
      }
    }

    if (L.roster) {
      L.roster.lines.forEach((line, i) => {
        ctx.fillText(line, L.roster.x, L.roster.firstCenterY + i * L.roster.lineH)
      })
    }
  }

  return canvas
}

function timestamp() {
  const d = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 导出选项默认值（SVG 设置面板会覆盖这些值）
const EXPORT_SIMPLIFY_TOLERANCE = { none: 0, light: 0.45, standard: 1.0, strong: 2.0 }
const DEFAULT_EXPORT_OPTIONS = {
  adcodes: null, // null = 当前视图全部；数组 = 只导出这些区域
  includeContext: true, // 未导出的区域保留浅色轮廓
  extrude: false, // 立体色块
  depth: 8, // 立体厚度（导出图像像素）
  simplify: 'standard', // none / light / standard / strong
  background: true,
  labels: true, // 标签 + 当前气泡
  labelColor: '', // 标注 / 气泡正文颜色；空 = 跟随主题
  merge: true // 未标注区域合并成一个形状，显著减少 PPT 形状数
}

function isAnnotated(code) {
  const cfg = props.config[code]
  if (!cfg) return false
  return !!(
    cfg.color ||
    cfg.headcount != null ||
    (cfg.positions && cfg.positions.length) ||
    (cfg.roster && cfg.roster.length)
  )
}

// 供导出面板列出的当前视图区域
function getExportRegions() {
  return shownRegions.value.map((r) => ({
    adcode: r.adcode,
    name: r.name,
    color: r.configured ? r.accent : '',
    annotated: isAnnotated(r.adcode)
  }))
}

// 把颜色变暗，用于立体色块的侧面 / 底面
function shadeHex(color, factor) {
  let hex = String(color || '').replace('#', '')
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color
  const n = parseInt(hex, 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('')
  )
}

function countPathPoints(d) {
  const m = String(d).match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)
  return m ? m.length : 0
}

// 生成与当前视图一致的 SVG（矢量，插入 PPT 后可无损缩放）
// 返回 { svg, regions, shapes, texts, points, bytes }，便于界面提示导出体积
function buildSVG(options = {}) {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options }
  const cw = container.value ? container.value.clientWidth : 0
  const ch = container.value ? container.value.clientHeight : 0
  if (!cw || !ch) return null

  const k = zoomState.k
  const t = theme.value
  const selKey = props.selectedAdcode != null ? String(props.selectedAdcode) : ''
  const all = shownRegions.value

  // 范围：只导出勾选的区域；未勾选的按需作为浅色上下文保留
  const filter = Array.isArray(opts.adcodes) ? new Set(opts.adcodes.map(String)) : null
  const chosen = filter ? all.filter((r) => filter.has(r.adcode)) : all.slice()
  if (!chosen.length) return null
  const chosenSet = new Set(chosen.map((r) => r.adcode))
  const context = opts.includeContext ? all.filter((r) => !chosenSet.has(r.adcode)) : []

  // 简化容差按「最终图像像素」定义，再除以缩放比例换算到地图坐标
  const tolPx = EXPORT_SIMPLIFY_TOLERANCE[opts.simplify] || 0
  const tol = tolPx / k
  const ctxTol = tol * 1.5
  const decimals = opts.simplify === 'none' ? 2 : 1
  const featureByCode = new Map(currentFeatures.map((f) => [String(f.properties.adcode), f]))
  const pathCache = new Map()
  let points = 0

  function pathOf(r, tolerance) {
    if (!tolerance) return r.d
    const key = r.adcode + '|' + tolerance
    if (pathCache.has(key)) return pathCache.get(key)
    const f = featureByCode.get(r.adcode)
    const d = f ? featureToPathD(f, tolerance, decimals) : r.d
    pathCache.set(key, d)
    return d
  }

  const mergedPlain = opts.merge
    ? chosen.filter((r) => !isAnnotated(r.adcode) && r.adcode !== selKey)
    : []
  const individual = opts.merge
    ? chosen.filter((r) => isAnnotated(r.adcode) || r.adcode === selKey)
    : chosen

  const baseFill = t.regionFill
  const baseStroke = t.regionStroke
  const labelFill = opts.labelColor || t.bubbleText
  const depthWorld = opts.extrude ? Math.max(0, Math.min(40, Number(opts.depth) || 0)) / k : 0
  const fillOf = (r) => (isAnnotated(r.adcode) ? r.accent : baseFill)

  let baseD = ''
  for (const r of mergedPlain) baseD += pathOf(r, tol)

  const out = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">`
  )
  if (opts.background) {
    out.push(
      '<defs><linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">' +
        `<stop offset="0" stop-color="${t.bg1}"/>` +
        `<stop offset="1" stop-color="${t.bg2}"/>` +
        '</linearGradient></defs>'
    )
    out.push(`<rect width="${cw}" height="${ch}" fill="url(#bgGrad)"/>`)
  }

  out.push(`<g transform="translate(${num(zoomState.x)},${num(zoomState.y)}) scale(${num(k)})">`)

  // 上下文：省轮廓 + 未导出的区域，统一浅色，合并成一个形状
  if (opts.includeContext && contextPath.value) {
    out.push(
      `<path d="${contextPath.value}" fill="${t.contextFill}" fill-opacity="0.22" stroke="${t.regionStroke}" stroke-opacity="0.35" stroke-width="${num(1 / k)}" fill-rule="evenodd"/>`
    )
    points += countPathPoints(contextPath.value)
  }
  if (context.length) {
    let ctxD = ''
    for (const r of context) ctxD += pathOf(r, ctxTol)
    if (ctxD) {
      out.push(
        `<path d="${ctxD}" fill="${t.contextFill}" fill-opacity="0.25" stroke="${t.regionStroke}" stroke-opacity="0.4" stroke-width="${num(0.5 / k)}" fill-rule="evenodd"/>`
      )
      points += countPathPoints(ctxD)
    }
  }

  // 立体：先画所有底面，再画所有顶面，避免相邻区域的侧面盖住顶面
  if (opts.extrude) {
    if (baseD) {
      out.push(
        `<path d="${baseD}" fill="${shadeHex(baseFill, 0.55)}" stroke="${shadeHex(baseFill, 0.45)}" stroke-width="${num(0.4 / k)}" transform="translate(0,${num(depthWorld)})" fill-rule="evenodd" stroke-linejoin="round"/>`
      )
      points += countPathPoints(baseD)
    }
    for (const r of individual) {
      const d = pathOf(r, tol)
      const fill = fillOf(r)
      out.push(
        `<path d="${d}" fill="${shadeHex(fill, 0.55)}" stroke="${shadeHex(fill, 0.45)}" stroke-width="${num(0.4 / k)}" transform="translate(0,${num(depthWorld)})" fill-rule="evenodd" stroke-linejoin="round"/>`
      )
      points += countPathPoints(d)
    }
  }

  // 顶面：合并后的未标注区域
  if (baseD) {
    out.push(
      `<path d="${baseD}" fill="${baseFill}" stroke="${baseStroke}" stroke-width="${num(0.5 / k)}" fill-rule="evenodd" stroke-linejoin="round"/>`
    )
    points += countPathPoints(baseD)
  }

  // 顶面：有标注区域 + 选中区域，逐个导出
  for (const r of individual) {
    const d = pathOf(r, tol)
    const selected = r.adcode === selKey
    out.push(
      `<path d="${d}" fill="${fillOf(r)}" stroke="${selected ? t.selectedStroke : t.regionStroke}" stroke-width="${num((selected ? 1.2 : 0.5) / k)}" fill-rule="evenodd" stroke-linejoin="round"/>`
    )
    points += countPathPoints(d)
  }

  out.push('</g>')

  let textCount = 0
  if (opts.labels) {
    // 标签：只为导出的区域生成；文字保持可编辑
    for (const r of chosen) {
      for (const it of computeLabelLayout(r)) {
        out.push(svgText(it, labelFill))
        textCount++
      }
    }

    // 气泡：当前选中且设置为气泡展示的区域
    const br = bubbleRegion.value
    if (br && chosenSet.has(br.adcode)) {
      const L = computeBubbleLayout(
        br,
        br.cx * k + zoomState.x,
        br.cy * k + zoomState.y,
        cw,
        ch
      )
      const bg = svgColorParts(t.bubbleBg)
      out.push(
        `<rect x="${num(L.bx)}" y="${num(L.byTop)}" width="${num(L.boxW)}" height="${num(L.boxH)}" ` +
          `rx="8" fill="${bg.color}" fill-opacity="${bg.opacity}" stroke="${br.accent}" stroke-width="1"/>`
      )
      out.push(
        svgText(
          { text: br.name, x: L.titleX, centerY: L.titleCenterY, fontSize: 12, weight: 600 },
          br.accent
        )
      )
      textCount++
      if (L.headcount) {
        out.push(svgText({ ...L.headcount, fontSize: 11, weight: 600 }, labelFill))
        textCount++
      }
      if (L.heading) {
        out.push(svgText({ ...L.heading, fontSize: 11, weight: 600 }, labelFill))
        textCount++
      }
      for (const cell of L.cells) {
        out.push(
          `<rect x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.w)}" height="${num(cell.h)}" rx="3" fill="#ffffff" fill-opacity="0.05"/>`
        )
        out.push(
          svgText(
            {
              text: cell.name,
              x: cell.nameX,
              centerY: cell.centerY,
              fontSize: 11,
              weight: 600,
              anchor: 'start'
            },
            labelFill
          )
        )
        textCount++
        if (cell.count) {
          out.push(
            svgText(
              {
                text: cell.count,
                x: cell.countX,
                centerY: cell.centerY,
                fontSize: 11,
                weight: 600,
                anchor: 'end'
              },
              br.accent
            )
          )
          textCount++
        }
      }
      if (L.roster) {
        L.roster.lines.forEach((line, i) => {
          out.push(
            svgText(
              {
                text: line,
                x: L.roster.x,
                centerY: L.roster.firstCenterY + i * L.roster.lineH,
                fontSize: 11,
                weight: 600,
                anchor: 'start'
              },
              labelFill
            )
          )
          textCount++
        })
      }
    }
  }

  out.push('</svg>')
  const svg = out.join('')
  return {
    svg,
    regions: chosen.length,
    shapes: (svg.match(/<path /g) || []).length + (svg.match(/<rect /g) || []).length,
    texts: textCount,
    points,
    bytes: new Blob([svg]).size
  }
}

// 按当前视图导出 2 倍分辨率 PNG，可直接插入 PPT
function exportImage(scale = 2) {
  const canvas = renderCanvas(scale)
  if (!canvas) return false
  canvas.toBlob((blob) => {
    if (blob) download(blob, `区域标注分布-${timestamp()}.png`)
  }, 'image/png')
  return true
}

// 导出 SVG 文件：PPT 中「插入 → 图片」选择该文件，即为可缩放的矢量图
function exportSVG(options = {}) {
  const built = buildSVG(options)
  if (!built) return false
  download(
    new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' }),
    `区域标注分布-${timestamp()}.svg`
  )
  return {
    regions: built.regions,
    shapes: built.shapes,
    texts: built.texts,
    points: built.points,
    bytes: built.bytes
  }
}

// 把 SVG 栅格化成 PNG，用作剪贴板兜底（与导出的 SVG 完全一致）
async function svgToPngBlob(svg, scale = 2) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('SVG 转图片失败'))
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return null
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 复制当前视图：优先写入 SVG（PPT 中保持矢量），同时带 PNG 兜底
async function copyToClipboard(options = {}) {
  if (!container.value) return false
  const ClipboardItemCtor = window.ClipboardItem
  if (!navigator.clipboard || typeof ClipboardItemCtor === 'undefined') return false

  const built = buildSVG(options)
  if (!built) return false
  const svgBlob = new Blob([built.svg], { type: 'image/svg+xml' })
  const pngBlob = await svgToPngBlob(built.svg, 2)
  const canSvg =
    typeof ClipboardItemCtor.supports !== 'function' ||
    ClipboardItemCtor.supports('image/svg+xml')

  const attempts = []
  if (canSvg && pngBlob) attempts.push({ 'image/svg+xml': svgBlob, 'image/png': pngBlob })
  else if (canSvg) attempts.push({ 'image/svg+xml': svgBlob })
  if (pngBlob) attempts.push({ 'image/png': pngBlob })

  for (const types of attempts) {
    try {
      await navigator.clipboard.write([new ClipboardItemCtor(types)])
      return {
        regions: built.regions,
        shapes: built.shapes,
        texts: built.texts,
        points: built.points,
        bytes: built.bytes
      }
    } catch (e) {
      console.warn('写入剪贴板失败:', e)
    }
  }
  return false
}

// ---------- 生命周期 ----------
function setupZoom() {
  zoomBehavior = zoom()
    .scaleExtent([MIN_ZOOM, MAX_ZOOM])
    .translateExtent(baseTranslateExtent())
    .on('zoom', (event) => {
      zoomState.k = event.transform.k
      zoomState.x = event.transform.x
      zoomState.y = event.transform.y
      // 缩放后视口大小变了，重新计算分组/省市视图的可平移范围，避免横向被锁死
      syncTranslateExtent(event.transform.k)
    })
  select(svgEl.value).call(zoomBehavior)
}

function onResize() {
  const cw = container.value.clientWidth || window.innerWidth
  const ch = container.value.clientHeight || window.innerHeight
  fitProjection(cw, ch)
  if (zoomBehavior) zoomBehavior.translateExtent(baseTranslateExtent())
  buildRegions(currentFeatures)
  applyConfig()
  // 投影已按新尺寸重建，焦点范围要重新计算（旧坐标已失效）
  let focusBounds = null
  let focusCenter = null
  if (props.mode === 'city' && props.provinceAdcode != null) {
    const parent = provinceFC.features.find((f) => String(f.properties.adcode) === String(props.provinceAdcode))
    focusBounds = parent ? featureBounds(parent) : null
  } else if (props.filterAdcodes.length) {
    focusBounds = groupBounds()
    focusCenter = groupMassCenter()
  }
  if (focusBounds) zoomToBounds(focusBounds, false, focusCenter)
  else zoomToNational(false)
}

onMounted(async () => {
  provinceFC = await loadProvinces()
  fitProjection(container.value.clientWidth || window.innerWidth, container.value.clientHeight || window.innerHeight)
  setupZoom()
  await loadAndRender()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

watch(() => props.mode, () => { loadAndRender() })
watch(() => props.config, () => applyConfig(), { deep: true })
// 「显示项」勾选变化后重建标签 / 气泡内容
watch(() => props.displayOptions, () => applyConfig(), { deep: true })

function groupBounds() {
  const list = shownRegions.value
  if (!list.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of list) {
    x0 = Math.min(x0, r.bounds[0][0])
    y0 = Math.min(y0, r.bounds[0][1])
    x1 = Math.max(x1, r.bounds[1][0])
    y1 = Math.max(y1, r.bounds[1][1])
  }
  return [[x0, y0], [x1, y1]]
}

// 分组内各区域按面积加权得到的视觉重心
function groupMassCenter() {
  let area = 0
  let mx = 0
  let my = 0
  for (const r of shownRegions.value) {
    if (!r.area) continue
    area += r.area
    mx += r.massX * r.area
    my += r.massY * r.area
  }
  return area ? [mx / area, my / area] : null
}

// 分组浏览切换：缩放到分组范围；退出分组时回到全国
watch(
  () => props.filterAdcodes,
  () => {
    if (props.mode !== 'province') return
    if (props.filterAdcodes.length) {
      const b = groupBounds()
      if (!b) return
      zoomToBounds(b, true, groupMassCenter())
    } else {
      zoomToNational(true)
    }
  }
)

// 随机配色排序：按当前视图里的横向位置（经度方向）排列，
// 多个区域依次取深浅色时，整体看起来就是一条跨区域的渐变。
function sortByPosition(adcodes) {
  const list = Array.isArray(adcodes) ? adcodes.map(String) : []
  const xs = new Map(regions.value.map((r) => [r.adcode, r.cx]))
  return list.sort((a, b) => {
    const ax = xs.has(a) ? xs.get(a) : Infinity
    const bx = xs.has(b) ? xs.get(b) : Infinity
    if (ax === bx) return a.localeCompare(b)
    return ax - bx
  })
}

defineExpose({
  resetView: () => zoomToNational(true),
  refresh: applyConfig,
  exportImage,
  exportSVG,
  copyToClipboard,
  getExportRegions,
  sortByPosition
})
</script>

<style>
.map-container {
  position: absolute;
  /* 从工具栏下方开始，避免地图/标签被工具条遮挡 */
  top: var(--toolbar-h, 60px);
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}
.map-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.region {
  fill: var(--region-fill, #26394d);
  stroke: var(--region-stroke, #0d5f7a);
  stroke-width: 0.5;
  /* 缩放时线宽不跟着放大，避免放大后边线过粗 */
  vector-effect: non-scaling-stroke;
  cursor: pointer;
  transition: filter 0.15s, stroke 0.15s;
}
.region.configured {
  fill: var(--accent);
}
.region:hover {
  /* 不用 drop-shadow 光晕：它按地图坐标缩放，放大后变成大块模糊并被 filter 区域裁掉 */
  stroke: var(--hover-stroke, #00e5ff);
  stroke-width: 1.5;
  stroke-linejoin: round;
  filter: var(--hover-filter, none);
}
.region.selected {
  stroke: var(--selected-stroke, #ffffff);
  stroke-width: 2;
  stroke-linejoin: round;
}
/* 选中时保持真实填充色，不再叠加悬停的明暗变化 */
.region.selected:hover {
  filter: none;
}
.context {
  fill: var(--context-fill, #16334a);
  opacity: 0.5;
  pointer-events: none;
}

.label-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
.region-label {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  white-space: nowrap;
  font-family: 'Consolas', 'Microsoft YaHei', monospace;
}
.region-label .name {
  font-size: 12px;
  /* 所有标签统一用主题文字色，不再按区域填充色深浅变色；用背景色描边保证可读 */
  color: var(--text, #d6ecff);
  text-shadow: 0 0 3px var(--bg, #05070d), 0 1px 2px var(--bg, #05070d);
  letter-spacing: 1px;
}
.region-label .values {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}
.region-label .value {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  /* 不加背景色：随机配色后区域颜色多变，纯文字标签更干净；
     用主题文字色 + 背景色描边，保证落在任何区域颜色上都清晰可读 */
  color: var(--text, #d6ecff);
  text-shadow: 0 0 3px var(--bg, #05070d), 0 1px 2px var(--bg, #05070d);
  font-weight: 600;
}
.region-label.selected .name {
  font-weight: 700;
}

/* 气泡展示：居中于区域重心，位置随缩放同步 */
.bubble {
  position: absolute;
  transform: translate(-50%, -50%);
  /* 宽度随内容自适应，过长的内容在 360px 内换行 */
  width: max-content;
  min-width: 140px;
  max-width: min(360px, calc(100vw - 24px));
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--panel-bg, rgba(10, 18, 28, 0.95));
  border: 1px solid var(--accent, #00e5ff);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.25));
  color: var(--text, #e6f4ff);
  font-family: 'Consolas', 'Microsoft YaHei', monospace;
  white-space: normal;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 15;
}
.bubble-title {
  margin-bottom: 4px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-align: center;
  color: var(--accent, #00e5ff);
}
/* 气泡整体不接收鼠标事件（方便拖动地图），只让关闭按钮可点 */
.bubble-close {
  position: absolute;
  top: 4px;
  right: 5px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim, #7ea6c4);
  font-size: 15px;
  line-height: 18px;
  text-align: center;
  font-family: inherit;
  cursor: pointer;
  pointer-events: auto;
}
.bubble-close:hover {
  color: var(--accent, #00e5ff);
  background: rgba(255, 255, 255, 0.08);
}
.bubble-row {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  text-align: left;
  color: var(--text, #e6f4ff);
}
.bubble-block {
  margin-top: 4px;
}
.bubble-head {
  color: var(--text-dim, #7ea6c4);
}
.bubble-grid {
  display: grid;
  /* 岗位固定窄列宽，长名称省略并通过 title 提示完整内容 */
  grid-template-columns: repeat(2, 82px);
  gap: 3px 8px;
  margin-top: 3px;
}
.bubble-pos {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.14));
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
}
.bubble-pos-name {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text, #e6f4ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 气泡整体不吃鼠标事件，这里单独放开以便悬停查看完整名称 */
  pointer-events: auto;
  cursor: default;
}
.bubble-pos-count {
  flex: 0 0 auto;
  color: var(--accent, #00e5ff);
  white-space: nowrap;
}
.bubble-roster {
  margin-top: 4px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
