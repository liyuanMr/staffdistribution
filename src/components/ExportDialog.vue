<template>
  <div class="ed-mask" @mousedown.self="$emit('close')">
    <div class="ed-dialog" role="dialog" aria-label="导出 SVG 设置">
      <div class="ed-head">
        <div>
          <div class="ed-title">导出 SVG</div>
          <div class="ed-sub">
            插入 PPT 后是矢量图；简化边界 + 合并未标注区域可显著减少节点数，避免 PPT 卡顿
          </div>
        </div>
        <button class="ed-close" type="button" title="关闭" @click="$emit('close')">×</button>
      </div>

      <div class="ed-body">
        <section class="ed-section">
          <div class="ed-label">导出范围</div>
          <div class="ed-seg">
            <button
              v-for="s in SCOPES"
              :key="s.key"
              type="button"
              :class="{ on: scope === s.key }"
              :disabled="s.disabled"
              :title="s.title || ''"
              @click="scope = s.key"
            >
              {{ s.label }}
            </button>
          </div>

          <div v-if="scope === 'custom'" class="ed-regions">
            <div class="ed-regions-tools">
              <button type="button" @click="selectAll">全选</button>
              <button type="button" @click="selectNone">清空</button>
              <button type="button" @click="invert">反选</button>
              <span class="ed-count">已选 {{ selectedCodes.length }} / {{ regions.length }}</span>
            </div>
            <div class="ed-region-list">
              <label v-for="r in regions" :key="r.adcode" class="ed-region">
                <input
                  type="checkbox"
                  :checked="selectedCodes.includes(r.adcode)"
                  @change="toggle(r.adcode)"
                />
                <span
                  class="ed-swatch"
                  :class="{ empty: !r.color }"
                  :style="r.color ? { background: r.color } : null"
                ></span>
                <span class="ed-region-name">{{ r.name }}</span>
                <span v-if="r.annotated" class="ed-anno">有标注</span>
              </label>
            </div>
          </div>

          <label class="ed-check">
            <input v-model="includeContext" type="checkbox" />
            <span>未导出的区域保留浅色轮廓（保持地图上下文）</span>
          </label>
        </section>

        <section class="ed-section">
          <div class="ed-label">立体色块</div>
          <div class="ed-row">
            <label class="ed-check">
              <input v-model="extrude" type="checkbox" />
              <span>给区域增加 2.5D 厚度（导出即完成，无需在 PPT 里加效果）</span>
            </label>
          </div>
          <div v-if="extrude" class="ed-slider">
            <span>厚度</span>
            <input v-model.number="depth" type="range" min="2" max="20" step="1" />
            <span class="ed-depth">{{ depth }} px</span>
          </div>
        </section>

        <section class="ed-section">
          <div class="ed-label">标注颜色</div>
          <div class="ed-colors">
            <button
              type="button"
              class="ed-color-chip"
              :class="{ on: !labelColor }"
              @click="labelColor = ''"
            >
              跟随主题
            </button>
            <button
              v-for="c in LABEL_COLORS"
              :key="c"
              type="button"
              class="ed-color-dot"
              :class="{ on: labelColor.toLowerCase() === c }"
              :style="{ background: c }"
              :title="c"
              @click="labelColor = c"
            ></button>
            <label
              class="ed-color-chip ed-color-custom"
              :class="{ on: !!labelColor && !LABEL_COLORS.includes(labelColor.toLowerCase()) }"
              title="自定义颜色"
            >
              <input
                type="color"
                :value="labelColor || '#d6ecff'"
                @input="labelColor = $event.target.value"
                @change="labelColor = $event.target.value"
              />
              自定义
            </label>
            <span class="ed-color-value">{{ labelColor || '主题默认' }}</span>
          </div>
          <div class="ed-hint">作用于区域名称、人数、岗位、名单及气泡正文；气泡标题保持区域色。</div>
        </section>

        <section class="ed-grid">
          <div>
            <div class="ed-label">边界精度</div>
            <select v-model="simplify" class="ed-select">
              <option value="none">原始（节点最多，PPT 容易卡）</option>
              <option value="light">轻度简化</option>
              <option value="standard">标准简化（推荐）</option>
              <option value="strong">强力简化（最流畅）</option>
            </select>
          </div>
          <div class="ed-checks">
            <label class="ed-check">
              <input v-model="merge" type="checkbox" />
              <span>合并未标注区域为一个形状</span>
            </label>
            <label class="ed-check">
              <input v-model="background" type="checkbox" />
              <span>包含主题背景</span>
            </label>
            <label class="ed-check">
              <input v-model="labels" type="checkbox" />
              <span>包含标签 / 气泡文字</span>
            </label>
          </div>
        </section>

        <div class="ed-tip">
          PPT 中导入后是“图片”，右键“转换为形状”再取消组合即可改色改字。
          节点数过多是卡顿主因：建议保持标准/强力简化，范围较大时再勾选“合并未标注区域”。
        </div>
      </div>

      <div
        v-if="status"
        class="ed-status"
        :class="{ ok: isOkStatus, warn: isWarnStatus, err: isErrorStatus }"
      >
        {{ status }}
      </div>

      <div class="ed-foot">
        <span class="ed-summary">将导出 {{ previewCount }} 个区域</span>
        <button class="ed-btn" type="button" @click="$emit('close')">取消</button>
        <button class="ed-btn" type="button" :disabled="!canExport || busy" @click="onCopy">
          {{ busy ? '复制中…' : '复制到剪贴板' }}
        </button>
        <button
          class="ed-btn primary"
          type="button"
          :disabled="!canExport || busy"
          @click="onExport"
        >
          导出 SVG
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // 当前视图里的区域：{ adcode, name, color, annotated }
  regions: { type: Array, default: () => [] },
  selectedAdcode: { type: [String, Number], default: null },
  busy: { type: Boolean, default: false },
  status: { type: String, default: '' }
})
const emit = defineEmits(['close', 'export', 'copy'])

const LABEL_COLORS = ['#f2faff', '#00e5ff', '#fbbf24', '#34d399', '#fb7185', '#0f172a']

const scope = ref('all')
const includeContext = ref(true)
const extrude = ref(false)
const depth = ref(8)
const simplify = ref('standard')
const background = ref(true)
const labels = ref(true)
const labelColor = ref('')
const merge = ref(true)

const selectedCodes = ref(props.regions.map((r) => r.adcode))

const annotatedCodes = computed(() =>
  props.regions.filter((r) => r.annotated).map((r) => r.adcode)
)
const hasSelected = computed(
  () =>
    props.selectedAdcode != null &&
    props.regions.some((r) => r.adcode === String(props.selectedAdcode))
)

const SCOPES = computed(() => [
  { key: 'all', label: '全部区域' },
  {
    key: 'annotated',
    label: '仅带标注',
    disabled: annotatedCodes.value.length === 0,
    title: annotatedCodes.value.length ? '' : '当前视图没有带标注的区域'
  },
  {
    key: 'selected',
    label: '仅选中',
    disabled: !hasSelected.value,
    title: hasSelected.value ? '' : '请先在地图上选中一个区域'
  },
  { key: 'custom', label: '自定义' }
])

const resolvedAdcodes = computed(() => {
  if (scope.value === 'all') return null
  if (scope.value === 'annotated') return annotatedCodes.value
  if (scope.value === 'selected') return [String(props.selectedAdcode)]
  return selectedCodes.value.slice()
})

const previewCount = computed(() => {
  const codes = resolvedAdcodes.value
  if (codes == null) return props.regions.length
  const set = new Set(codes.map(String))
  return props.regions.filter((r) => set.has(r.adcode)).length
})

const canExport = computed(() => previewCount.value > 0)
const isOkStatus = computed(() => props.status.startsWith('已复制'))
const isWarnStatus = computed(() => props.status.startsWith('当前环境'))
const isErrorStatus = computed(() => props.status.startsWith('复制失败'))

function selectAll() {
  selectedCodes.value = props.regions.map((r) => r.adcode)
}
function selectNone() {
  selectedCodes.value = []
}
function invert() {
  const set = new Set(selectedCodes.value)
  selectedCodes.value = props.regions
    .map((r) => r.adcode)
    .filter((code) => !set.has(code))
}
function toggle(code) {
  const i = selectedCodes.value.indexOf(code)
  if (i >= 0) selectedCodes.value.splice(i, 1)
  else selectedCodes.value.push(code)
}

function options() {
  return {
    adcodes: resolvedAdcodes.value,
    includeContext: includeContext.value,
    extrude: extrude.value,
    depth: depth.value,
    simplify: simplify.value,
    background: background.value,
    labels: labels.value,
    labelColor: labelColor.value,
    merge: merge.value
  }
}

function onExport() {
  if (!canExport.value) return
  emit('export', options())
}
function onCopy() {
  if (!canExport.value) return
  emit('copy', options())
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.ed-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  box-sizing: border-box;
}
.ed-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: 88vh;
  border-radius: 12px;
  border: 1px solid var(--panel-border, rgba(0, 229, 255, 0.35));
  background: var(--panel-bg, rgba(10, 18, 28, 0.98));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 24px var(--accent-soft, rgba(0, 229, 255, 0.12));
  color: var(--text, #d6ecff);
  font-family: 'Consolas', 'Microsoft YaHei', 'PingFang SC', monospace;
  box-sizing: border-box;
}
.ed-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--input-border, rgba(126, 166, 196, 0.25));
}
.ed-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--accent, #00e5ff);
}
.ed-sub {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-dim, #7ea6c4);
}
.ed-close {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim, #7ea6c4);
  font-size: 20px;
  line-height: 26px;
  cursor: pointer;
}
.ed-close:hover {
  color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
}
.ed-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px 18px;
}
.ed-section {
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--input-border, rgba(126, 166, 196, 0.18));
}
.ed-section:last-child {
  margin-bottom: 0;
  border-bottom: none;
}
.ed-label {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--accent, #00e5ff);
}
.ed-seg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ed-seg button {
  padding: 6px 12px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ed-seg button:hover:not(:disabled) {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.ed-seg button.on {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.14));
}
.ed-seg button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.ed-regions {
  margin-top: 10px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.25));
  border-radius: 8px;
  background: var(--input-bg, rgba(4, 12, 20, 0.5));
}
.ed-regions-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--input-border, rgba(126, 166, 196, 0.18));
}
.ed-regions-tools button {
  padding: 2px 8px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.3));
  border-radius: 4px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ed-regions-tools button:hover {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.ed-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
}
.ed-region-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 2px 12px;
  max-height: 190px;
  overflow-y: auto;
  padding: 8px 10px;
}
.ed-region {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.ed-region:hover {
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
}
.ed-region input {
  margin: 0;
  accent-color: var(--accent, #00e5ff);
}
.ed-swatch {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.4));
}
.ed-swatch.empty {
  background: transparent;
}
.ed-region-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ed-anno {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
}
.ed-check {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text, #d6ecff);
  cursor: pointer;
  user-select: none;
}
.ed-check input {
  flex: 0 0 auto;
  margin: 0;
  accent-color: var(--accent, #00e5ff);
}
.ed-row {
  margin-top: -2px;
}
.ed-colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ed-color-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ed-color-chip:hover {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.ed-color-chip.on {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.14));
}
.ed-color-dot {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.ed-color-dot:hover {
  transform: scale(1.08);
}
.ed-color-dot.on {
  outline: 2px solid var(--accent, #00e5ff);
  outline-offset: 2px;
}
.ed-color-custom input[type='color'] {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.ed-color-custom input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.ed-color-custom input[type='color']::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}
.ed-color-value {
  font-family: 'Consolas', monospace;
  font-size: 11px;
  color: var(--text, #d6ecff);
}
.ed-hint {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim, #7ea6c4);
}
.ed-status {
  padding: 9px 18px;
  border-top: 1px solid var(--input-border, rgba(126, 166, 196, 0.25));
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  font-size: 12px;
  line-height: 1.5;
  color: var(--accent, #00e5ff);
}
.ed-status.ok {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.08);
}
.ed-status.warn {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
}
.ed-status.err {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
.ed-slider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
}
.ed-slider input[type='range'] {
  flex: 1 1 auto;
  accent-color: var(--accent, #00e5ff);
}
.ed-depth {
  min-width: 42px;
  text-align: right;
  color: var(--text, #d6ecff);
}
.ed-grid {
  display: grid;
  grid-template-columns: minmax(180px, 0.9fr) 1.1fr;
  gap: 18px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--input-border, rgba(126, 166, 196, 0.18));
}
.ed-checks .ed-check {
  margin-top: 6px;
}
.ed-checks .ed-check:first-child {
  margin-top: 0;
}
.ed-select {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  color: var(--text, #d6ecff);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
.ed-select:hover {
  border-color: var(--accent, #00e5ff);
}
.ed-tip {
  padding: 9px 11px;
  border-radius: 6px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-dim, #9fb6cc);
}
.ed-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 14px;
  border-top: 1px solid var(--input-border, rgba(126, 166, 196, 0.25));
}
.ed-summary {
  margin-right: auto;
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
}
.ed-btn {
  padding: 7px 16px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text, #d6ecff);
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
}
.ed-btn:hover:not(:disabled) {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.ed-btn.primary {
  border-color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.18));
  color: var(--accent, #00e5ff);
  font-weight: 700;
}
.ed-btn.primary:hover:not(:disabled) {
  box-shadow: 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.ed-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
@media (max-width: 560px) {
  .ed-grid {
    grid-template-columns: 1fr;
  }
}
</style>
