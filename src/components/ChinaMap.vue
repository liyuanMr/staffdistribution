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

function featureToPathD(feature) {
  let d = ''
  for (const poly of polygonsOf(feature)) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      d += 'M' + ring.map(([lng, lat]) => {
        const p = projection([lng, lat])
        return p[0].toFixed(2) + ',' + p[1].toFixed(2)
      }).join('L') + 'Z'
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

// 按当前视图导出 2 倍分辨率 PNG，可直接插入 PPT
function exportImage(scale = 2) {
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
  const fontFamily = "Consolas, 'Microsoft YaHei', 'PingFang SC', monospace"
  const nameH = 14
  const badgeH = 15
  const badgeGap = 3
  for (const r of shownRegions.value) {
    const lx = r.cx * k + zoomState.x
    const ly = r.cy * k + zoomState.y
    const valueList = r.displayMode === 'bubble' ? [] : r.values
    const showName = labelNameVisible.value
    const valuesH = valueList.length * badgeH + Math.max(valueList.length - 1, 0) * badgeGap
    const totalH = (showName ? nameH : 0) + (valueList.length ? (showName ? 2 : 0) + valuesH : 0)
    const y = ly - totalH / 2

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (showName) {
      ctx.font = `12px ${fontFamily}`
      // 与页面一致：所有标签统一用主题文字色，加背景色描边保证可读
      ctx.fillStyle = theme.value.bubbleText
      ctx.shadowColor = theme.value.bg1
      ctx.shadowBlur = 3
      ctx.fillText(r.name, lx, y + nameH / 2)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }

    let by = y + (showName ? nameH + 2 : 0)
    ctx.font = `600 11px ${fontFamily}`
    for (const v of valueList) {
      // 与页面一致：不加背景色，用主题文字色 + 背景色描边保证可读
      ctx.fillStyle = theme.value.bubbleText
      ctx.shadowColor = theme.value.bg1
      ctx.shadowBlur = 3
      ctx.fillText(v, lx, by + badgeH / 2 + 0.5)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      by += badgeH + badgeGap
    }
  }

  // 气泡方式：导出当前显示的气泡（居中于区域重心，岗位两列排布）
  const br = bubbleRegion.value
  if (br) {
    const lx = br.cx * k + zoomState.x
    const ly = br.cy * k + zoomState.y
    const padX = 12
    const padY = 10
    const titleH = 18
    const rowH = 16
    const cellH = rowH + 4
    const cellGapY = 2
    const colGap = 8
    // 岗位固定窄列宽（与页面 CSS 一致），超长名称省略号截断
    const colW = 112
    const titleFont = `600 12px ${fontFamily}`
    const rowFont = `600 11px ${fontFamily}`
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

    roundRectPath(ctx, bx, byTop, boxW, boxH, 8)
    ctx.fillStyle = theme.value.bubbleBg
    ctx.fill()
    ctx.strokeStyle = br.accent
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textBaseline = 'middle'
    ctx.font = titleFont
    ctx.fillStyle = br.accent
    ctx.textAlign = 'center'
    ctx.fillText(br.name, bx + boxW / 2, byTop + padY + titleH / 2)

    ctx.font = rowFont
    ctx.fillStyle = theme.value.bubbleText
    ctx.textAlign = 'left'
    let cursor = byTop + padY + titleH

    if (br.bubbleHeadcount != null) {
      cursor += 4
      ctx.fillText(`人数：${br.bubbleHeadcount}`, bx + padX, cursor + rowH / 2)
      cursor += rowH
    }

    if (br.bubblePositions.length) {
      cursor += 4
      ctx.fillText('岗位', bx + padX, cursor + rowH / 2)
      cursor += rowH + 3
      br.bubblePositions.forEach((p, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const cellX = bx + padX + col * (colW + colGap)
        const cellY = cursor + row * (cellH + cellGapY)
        roundRectPath(ctx, cellX, cellY, colW, cellH, 3)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        ctx.fill()
        const countText = p.count == null ? '' : `${p.count}人`
        ctx.font = rowFont
        const countW = countText ? ctx.measureText(countText).width : 0
        ctx.fillStyle = theme.value.bubbleText
        ctx.fillText(
          fitCanvasText(ctx, p.name || '未命名', colW - 12 - countW - 6),
          cellX + 6,
          cellY + cellH / 2
        )
        if (countText) {
          ctx.fillStyle = br.accent
          ctx.textAlign = 'right'
          ctx.fillText(countText, cellX + colW - 6, cellY + cellH / 2)
          ctx.textAlign = 'left'
        }
      })
      cursor += posRows * cellH + Math.max(posRows - 1, 0) * cellGapY
    }

    if (rosterLines.length) {
      cursor += 4
      rosterLines.forEach((line, i) => {
        ctx.fillText(line, bx + padX, cursor + rowH / 2 + i * rowH)
      })
    }
  }

  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `区域标注分布-${stamp}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
  return true
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
