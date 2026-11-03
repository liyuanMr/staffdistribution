<template>
  <div class="app" :style="theme.vars">
    <header class="toolbar">
      <div class="brand">
        <span class="dot"></span>
        <span class="title">区域标注分布 · {{ groupLabel || '全国' }}</span>
      </div>

      <div class="tabs">
        <button :class="{ active: mode === 'province' && !activeGroup }" @click="setMode('province')">省</button>
        <button
          :class="{ active: mode === 'city' }"
          :disabled="!currentProvinceAdcode"
          :title="currentProvinceAdcode ? '' : '请先点击选择一个省'"
          @click="setMode('city')"
        >
          市
        </button>
        <span class="tab-divider"></span>
        <button
          :class="{ active: activeGroup === 'north1' }"
          title="只看北京、天津、河北、内蒙古、辽宁、吉林、黑龙江"
          @click="toggleGroup('north1')"
        >
          北一区
        </button>
      </div>

      <div v-if="mode === 'city' && currentProvinceName" class="tip">
        当前省：{{ currentProvinceName }}
      </div>

      <div class="tool-actions">
        <label class="theme-picker" title="切换整体风格">
          <span>风格</span>
          <select v-model="themeKey">
            <option v-for="t in THEMES" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
        </label>
        <label class="theme-picker" title="随机配色方式：多彩，或让多个区域共同铺开一条同色系渐变">
          <span>配色</span>
          <select v-model="colorMode">
            <option v-for="m in RANDOM_COLOR_MODES" :key="m.key" :value="m.key">{{ m.label }}</option>
          </select>
        </label>
        <div ref="displayPicker" class="display-picker">
          <button
            class="ghost"
            :class="{ on: displayOpen }"
            title="勾选地图标签和气泡里要显示的内容"
            @click="displayOpen = !displayOpen"
          >
            显示项<span class="caret">▾</span>
          </button>
          <div v-if="displayOpen" class="display-pop">
            <div v-for="g in DISPLAY_GROUPS" :key="g.key" class="dp-group">
              <div class="dp-head">{{ g.title }}</div>
              <label v-for="it in g.items" :key="it.key" class="dp-item">
                <input v-model="displayOptions[it.key]" type="checkbox" />
                <span>{{ it.label }}</span>
              </label>
            </div>
          </div>
        </div>
        <button class="ghost" title="用表格查看、筛选、新增、修改、删除所有人员" @click="rosterOpen = true">
          表格管理
        </button>
        <button class="ghost" title="为所有带标注的区域随机分配协调色" @click="randomizeColors">随机配色</button>
        <button class="ghost export" @click="onExport">导出图片</button>
        <button class="ghost" @click="resetView">回到全国</button>
        <button class="ghost" @click="reloadConfig">重新加载配置</button>
      </div>

      <div v-if="notice" class="notice">{{ notice }}</div>
    </header>

    <div v-if="loading" class="state">加载地图数据…</div>
    <div v-else-if="error" class="state error-text">{{ error }}</div>
    <ChinaMap
      v-else
      ref="map"
      :divisions="divisions"
      :config="config"
      :mode="mode"
      :province-adcode="currentProvinceAdcode"
      :selected-adcode="selectedAdcode"
      :filter-adcodes="filterAdcodes"
      :display-options="displayOptions"
      @region-click="onRegionClick"
    />

    <RegionPanel
      v-if="panelRegion"
      :region="panelRegion"
      :value="panelValue"
      :city-options="cityOptions"
      :city-adcode="panelScope.cityAdcode"
      :province-adcode="panelScope.provinceAdcode"
      :province-name="panelScope.provinceName"
      @save="onSave"
      @clear="onClear"
      @close="closePanel"
    />

    <RosterManager
      v-if="rosterOpen"
      :divisions="divisions"
      :config="config"
      @save="onRosterSave"
      @close="rosterOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import ChinaMap from './components/ChinaMap.vue'
import RegionPanel from './components/RegionPanel.vue'
import RosterManager from './components/RosterManager.vue'
import { useDivisions } from './composables/useDivisions'
import { shuffledPalette, gradientShades, RANDOM_PALETTE } from './composables/colorPalette'
import { useTheme } from './composables/useTheme'
import { useColorMode } from './composables/useColorMode'
import { useDisplayOptions } from './composables/useDisplayOptions'

const { divisions, config, loadDivisions, loadConfig, saveConfig, findDivision } = useDivisions()
const { themeKey, theme, THEMES } = useTheme()
const { colorMode, RANDOM_COLOR_MODES } = useColorMode()
const { displayOptions, DISPLAY_GROUPS } = useDisplayOptions()

// 「显示项」设置弹层：点外部关闭
const displayOpen = ref(false)
const displayPicker = ref(null)
function onDocMouseDown(e) {
  if (!displayOpen.value) return
  if (displayPicker.value && !displayPicker.value.contains(e.target)) displayOpen.value = false
}

// 北一区：北京、天津、河北、内蒙古、东三省
const GROUPS = {
  north1: {
    label: '北一区',
    adcodes: ['110000', '120000', '130000', '150000', '210000', '220000', '230000']
  }
}

const map = ref(null)
const mode = ref('province')
const activeGroup = ref('')
const selectedAdcode = ref(null)
const currentProvinceAdcode = ref(null)
const loading = ref(true)
const error = ref(null)
const notice = ref('')
const rosterOpen = ref(false)

const panelRegion = computed(() =>
  selectedAdcode.value != null ? findDivision(selectedAdcode.value) : null
)

// 市级视图下选中的是市/区：人员数据仍存放在所属省下，这里换算成「省 + 市/区」作用域
const panelScope = computed(() => {
  const d = panelRegion.value
  if (!d) return { cityAdcode: '', provinceAdcode: '', provinceName: '' }
  if (mode.value === 'city' && d.level !== 'province' && d.parentNode) {
    const parent = findDivision(d.parentNode)
    return {
      cityAdcode: String(d.adcode),
      provinceAdcode: String(d.parentNode),
      provinceName: parent ? parent.shortTitle || parent.title : ''
    }
  }
  return { cityAdcode: '', provinceAdcode: String(d.adcode), provinceName: '' }
})

// 市级视图：人员名单取所属省配置，颜色取该市自己的配置（市级可以单独配色）
const panelValue = computed(() => {
  const scope = panelScope.value
  const provinceCfg = config.value[scope.provinceAdcode] || null
  if (!scope.cityAdcode) return provinceCfg
  const cityCfg = config.value[scope.cityAdcode] || null
  return {
    ...(provinceCfg || {}),
    color: (cityCfg && cityCfg.color) || '',
    display: (cityCfg && cityCfg.display) || 'label'
  }
})

// 可选的市/区：省级面板取本省下辖市/区；市级面板同样取所属省的市/区（用于医院所在市/区）
const cityOptions = computed(() => {
  const d = panelRegion.value
  if (!d) return []
  let parentKey = ''
  if (d.level === 'province') parentKey = String(d.adcode)
  else if (mode.value === 'city' && d.parentNode) parentKey = String(d.parentNode)
  if (!parentKey) return []
  return divisions.value
    .filter(
      (x) => String(x.parentNode) === parentKey && (x.level === 'city' || x.level === 'district')
    )
    .map((x) => ({ adcode: String(x.adcode), name: x.shortTitle || x.title || String(x.adcode) }))
})
const currentProvinceName = computed(() => {
  const d = findDivision(currentProvinceAdcode.value)
  return d ? d.shortTitle || d.title : ''
})
const groupLabel = computed(() => (activeGroup.value ? GROUPS[activeGroup.value].label : ''))
// 分组只在省级视图中生效，市级视图展示的是该省下属区县
const filterAdcodes = computed(() =>
  mode.value === 'province' && activeGroup.value ? GROUPS[activeGroup.value].adcodes : []
)

onMounted(async () => {
  document.addEventListener('mousedown', onDocMouseDown)
  try {
    await loadDivisions()
    await loadConfig()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

function setMode(m) {
  if (m === 'city' && !currentProvinceAdcode.value) return
  mode.value = m
  // 切换省/市视图时退出分组（北一区只在省级视图下有效）
  activeGroup.value = ''
  if (m === 'province' && currentProvinceAdcode.value) {
    selectedAdcode.value = currentProvinceAdcode.value
  }
}

function toggleGroup(key) {
  if (activeGroup.value === key) {
    activeGroup.value = ''
    return
  }
  activeGroup.value = key
  mode.value = 'province'
  selectedAdcode.value = null
  currentProvinceAdcode.value = null
}

function onRegionClick(adcode) {
  selectedAdcode.value = String(adcode)
  const d = findDivision(adcode)
  if (d && d.level === 'province') currentProvinceAdcode.value = String(adcode)
}

function closePanel() {
  selectedAdcode.value = null
}

function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 1500)
}

async function onSave(payload) {
  try {
    let next
    if (payload.scope === 'city') {
      // 市级/区级：颜色写在该市自己的配置下；
      // 人员名单仍属于所属省，只替换本市登记的人员，其他市保持不变
      const provinceKey = String(payload.provinceAdcode)
      const cityKey = String(payload.adcode)
      next = { ...config.value }

      const provinceCfg = { ...(next[provinceKey] || {}) }
      const oldRoster = Array.isArray(provinceCfg.roster) ? provinceCfg.roster : []
      // 市级面板提交的是「原始下标 -> 修改后的人员」；不在 edits 里的已展示人员走 removals：
      // person 为 null 表示整条删除，否则是从本市/区解绑后保留的人员
      const origin = new Set((payload.originIndices || []).map(Number))
      const edits = new Map((payload.edits || []).map((e) => [Number(e.index), e.person]))
      const removals = new Map((payload.removals || []).map((r) => [Number(r.index), r.person]))
      const merged = []
      for (let i = 0; i < oldRoster.length; i++) {
        if (!origin.has(i)) {
          merged.push(oldRoster[i])
        } else if (edits.has(i)) {
          merged.push(edits.get(i))
        } else if (removals.has(i)) {
          if (removals.get(i)) merged.push(removals.get(i))
        } else {
          // 兼容旧请求：已展示但既没修改也没声明移除，视为删除
        }
      }
      if (merged.length) provinceCfg.roster = merged
      else delete provinceCfg.roster
      if (Object.keys(provinceCfg).length) next[provinceKey] = provinceCfg
      else delete next[provinceKey]

      const cityCfg = { ...(next[cityKey] || {}) }
      if (payload.color) cityCfg.color = payload.color
      else delete cityCfg.color
      if (Object.keys(cityCfg).length) next[cityKey] = cityCfg
      else delete next[cityKey]
    } else {
      next = {
        ...config.value,
        [payload.adcode]: {
          color: payload.color,
          display: payload.display,
          headcount: payload.headcount,
          positions: payload.positions,
          roster: payload.roster
        }
      }
    }
    await saveConfig(next)
    flash('已保存')
  } catch (e) {
    flash('保存失败：' + e.message)
  }
}

// 表格管理弹窗：整份配置保存，保存后地图与右侧面板自动刷新
async function onRosterSave(next) {
  try {
    await saveConfig(next)
    flash('已保存')
  } catch (e) {
    flash('保存失败：' + e.message)
  }
}

async function onClear(adcode) {
  try {
    const next = { ...config.value }
    delete next[adcode]
    await saveConfig(next)
    flash('已清除')
  } catch (e) {
    flash('清除失败：' + e.message)
  }
}

function hasAnnotations(cfg) {
  // 市/区级可能只有颜色没有人员数据，这类区域也应参与随机配色
  return !!(
    cfg.color ||
    cfg.headcount != null ||
    (cfg.positions && cfg.positions.length) ||
    (cfg.roster && cfg.roster.length)
  )
}

// 只给「带标注」的区域重新配色，无标注区域保持原样（灰色/原色）。
//   多彩随机 —— 每个区域从色板取不同的颜色
//   同色渐变 —— 所有区域共用一种颜色，按地图横向顺序依次取浅/深色，
//               区域之间连起来就是一条渐变（每个区域本身仍是纯色）
async function randomizeColors() {
  const targets = Object.entries(config.value).filter(([, cfg]) => hasAnnotations(cfg))
  if (!targets.length) {
    flash('没有带标注的区域')
    return
  }
  const next = { ...config.value }

  if (colorMode.value === 'multi') {
    let pool = []
    let last = ''
    for (const [adcode, cfg] of targets) {
      if (!pool.length) pool = shuffledPalette()
      let idx = pool.length - 1
      // 洗完牌后避免和上一个区域撞色
      if (pool[idx] === last && pool.length > 1) idx -= 1
      const [color] = pool.splice(idx, 1)
      last = color
      next[adcode] = { ...cfg, color }
    }
  } else {
    const base = RANDOM_PALETTE[Math.floor(Math.random() * RANDOM_PALETTE.length)]
    const adcodes = targets.map(([adcode]) => adcode)
    // 按当前视图里的横向位置排序，深浅依次铺开；不在当前视图里的区域排在最后
    const ordered = map.value && map.value.sortByPosition ? map.value.sortByPosition(adcodes) : adcodes
    const shades = gradientShades(base, ordered.length, colorMode.value === 'gradient1' ? 1 : -1)
    ordered.forEach((adcode, i) => {
      next[adcode] = { ...next[adcode], color: shades[i] }
    })
  }

  try {
    await saveConfig(next)
    flash(colorMode.value === 'multi' ? '已随机配色' : '已按同色渐变配色')
  } catch (e) {
    flash('配色失败：' + e.message)
  }
}

function onExport() {
  if (map.value && map.value.exportImage(2)) {
    flash('图片已导出（2 倍分辨率 PNG）')
  } else {
    flash('导出失败')
  }
}

function resetView() {
  mode.value = 'province'
  activeGroup.value = ''
  selectedAdcode.value = null
  currentProvinceAdcode.value = null
  if (map.value) map.value.resetView()
}

async function reloadConfig() {
  try {
    await loadConfig()
    if (map.value) map.value.refresh()
    flash('已重新加载配置')
  } catch (e) {
    flash('加载失败：' + e.message)
  }
}
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  background: #05070d;
  overflow: hidden;
  font-family: 'Consolas', 'Microsoft YaHei', 'PingFang SC', monospace;
}
.app {
  position: relative;
  height: 100vh;
  width: 100vw;
  /* 工具栏高度：地图容器、面板据此让出顶部空间 */
  --toolbar-h: 60px;
  background: linear-gradient(180deg, var(--bg, #05070d), var(--bg2, #081321));
  color: var(--text, #d6ecff);
}

.toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--toolbar-h, 60px);
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
  background: var(--toolbar-bg, rgba(6, 12, 20, 0.9));
  border-bottom: 1px solid var(--toolbar-border, rgba(0, 229, 255, 0.25));
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  z-index: 30;
  box-sizing: border-box;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #00e5ff);
  box-shadow: 0 0 10px var(--accent, #00e5ff);
}
.brand .title {
  color: var(--text, #d6ecff);
  font-size: 15px;
  letter-spacing: 2px;
}
.tabs {
  display: flex;
  gap: 6px;
}
.tabs button {
  padding: 7px 22px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #8fb8d8);
  cursor: pointer;
  font-size: 14px;
  letter-spacing: 2px;
  font-family: inherit;
  transition: all 0.2s;
}
.tabs button.active {
  background: var(--accent-soft, rgba(0, 229, 255, 0.16));
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
  box-shadow: 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.4));
}
.tabs button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.tab-divider {
  width: 1px;
  height: 20px;
  align-self: center;
  margin: 0 4px;
  background: var(--input-border, rgba(126, 166, 196, 0.35));
}
.tool-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-actions .ghost {
  padding: 7px 14px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 1px;
  font-family: inherit;
}
.tool-actions .ghost:hover {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.tool-actions .ghost.export {
  border-color: var(--accent, #00e5ff);
  color: var(--accent, #00e5ff);
}
.tool-actions .ghost.export:hover {
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
  box-shadow: 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
/* 「显示项」勾选弹层 */
.display-picker {
  position: relative;
}
.display-picker .ghost .caret {
  margin-left: 5px;
  font-size: 9px;
  color: var(--text-dim, #7ea6c4);
}
.display-picker .ghost.on {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
}
.display-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  display: flex;
  gap: 20px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--panel-border, rgba(0, 229, 255, 0.35));
  background: var(--panel-bg, rgba(10, 18, 28, 0.96));
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 14px var(--accent-soft, rgba(0, 229, 255, 0.12));
  box-sizing: border-box;
  white-space: nowrap;
}
.dp-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dp-head {
  margin-bottom: 2px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--accent, #00e5ff);
}
.dp-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text, #d6ecff);
  cursor: pointer;
  user-select: none;
}
.dp-item input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent, #00e5ff);
}
.theme-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
  letter-spacing: 1px;
}
.theme-picker select {
  padding: 6px 8px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  color: var(--text, #d6ecff);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}
.theme-picker select:hover {
  border-color: var(--accent, #00e5ff);
}
.tip {
  color: var(--text-dim, #7ea6c4);
  font-size: 12px;
}
.notice {
  color: #22c55e;
  font-size: 12px;
  font-weight: 600;
}

.state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim, #9fb6cc);
  letter-spacing: 2px;
  font-size: 14px;
}
.error-text {
  color: #ef4444;
}
</style>
