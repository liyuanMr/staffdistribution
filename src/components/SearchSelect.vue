<template>
  <div ref="root" class="ss" :class="{ open: isOpen }">
    <button
      ref="triggerEl"
      type="button"
      class="ss-trigger"
      :title="selectedLabel || placeholder"
      @click="toggle"
      @keydown.down.prevent="openPanel"
    >
      <span class="ss-value" :class="{ ph: !selectedLabel }">{{ selectedLabel || placeholder }}</span>
      <span class="ss-caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="isOpen" ref="popEl" class="ss-pop" :style="popStyle">
      <input
        ref="searchEl"
        v-model="query"
        class="ss-search"
        type="text"
        placeholder="输入名称筛选"
        @keydown="stopEvent"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="chooseHighlighted"
        @keydown.esc.prevent="close(true)"
      />
      <ul ref="listEl" class="ss-list">
        <li
          v-if="allowEmpty"
          class="ss-option"
          :class="{ active: !modelValue }"
          @click="choose('')"
        >
          {{ emptyLabel || placeholder }}
        </li>
        <template v-for="(g, gi) in filteredGroups" :key="'g' + gi">
          <li v-if="g.label" class="ss-group">{{ g.label }}</li>
          <li
            v-for="o in g.options"
            :key="o.value"
            class="ss-option"
            :class="{ active: o.value === modelValue, hl: isHighlighted(o) }"
            :title="o.label"
            @mouseenter="hlIndex = flatFiltered.indexOf(o)"
            @click="choose(o.value)"
          >
            {{ o.label }}
          </li>
        </template>
        <li v-if="!flatFiltered.length" class="ss-empty">无匹配项</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // [{ value, label }]
  options: { type: Array, default: () => [] },
  // 可选分组：[{ label, options: [{ value, label }] }]，优先于 options
  groups: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
  // 下拉里「清空」这一项的文案
  emptyLabel: { type: String, default: '' },
  allowEmpty: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'change'])

const root = ref(null)
const triggerEl = ref(null)
const popEl = ref(null)
const searchEl = ref(null)
const listEl = ref(null)
const isOpen = ref(false)
const query = ref('')
const hlIndex = ref(0)
const popStyle = ref({})

const sourceGroups = computed(() =>
  props.groups && props.groups.length ? props.groups : [{ label: '', options: props.options || [] }]
)
const allOptions = computed(() => sourceGroups.value.flatMap((g) => g.options || []))

const selectedLabel = computed(() => {
  const v = String(props.modelValue || '')
  if (!v) return ''
  const hit = allOptions.value.find((o) => String(o.value) === v)
  return hit ? hit.label : v
})

// 输入关键字按名称筛选；匹配到省名时保留该省全部市/区
const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return sourceGroups.value.filter((g) => (g.options || []).length)
  return sourceGroups.value
    .map((g) => {
      const groupHit = g.label && String(g.label).toLowerCase().includes(q)
      const options = (g.options || []).filter(
        (o) => groupHit || String(o.label || '').toLowerCase().includes(q)
      )
      return { label: g.label, options }
    })
    .filter((g) => g.options.length)
})
const flatFiltered = computed(() => filteredGroups.value.flatMap((g) => g.options))

function isHighlighted(o) {
  return flatFiltered.value[hlIndex.value] === o
}

function scrollHl() {
  nextTick(() => {
    const list = listEl.value
    if (!list) return
    const el = list.querySelector('.ss-option.hl')
    if (!el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  })
}

// 下拉面板用 fixed 定位：既不会被表单里的滚动容器裁掉，又能跟随触发器
function updatePosition(fallbackHeight = 0) {
  const el = triggerEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const gap = 4
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const maxW = Math.min(300, viewportW - 24)
  const popH = popEl.value ? popEl.value.offsetHeight : fallbackHeight
  const spaceBelow = viewportH - rect.bottom - 8
  const spaceAbove = rect.top - 8
  const openUp = popH > 0 && spaceBelow < Math.min(popH, 180) && spaceAbove > spaceBelow
  let top = openUp ? rect.top - gap - popH : rect.bottom + gap
  if (popH > 0) top = Math.max(8, Math.min(top, viewportH - 8 - popH))
  const left = Math.max(8, Math.min(rect.left, viewportW - maxW - 8))
  popStyle.value = {
    position: 'fixed',
    top: `${Math.max(8, top)}px`,
    left: `${left}px`,
    minWidth: `${rect.width}px`,
    maxWidth: `${maxW}px`
  }
}

function onViewportChange(e) {
  if (!isOpen.value) return
  // 下拉列表自身滚动时不用重新定位
  if (e.type === 'scroll' && popEl.value && e.target instanceof Node && popEl.value.contains(e.target)) return
  updatePosition()
}

function openPanel() {
  if (isOpen.value) return
  isOpen.value = true
  query.value = ''
  const selectedIdx = flatFiltered.value.findIndex((o) => String(o.value) === String(props.modelValue || ''))
  hlIndex.value = selectedIdx >= 0 ? selectedIdx : 0
  updatePosition(260)
  nextTick(() => {
    if (searchEl.value) searchEl.value.focus()
    updatePosition()
    scrollHl()
  })
}

function close(refocus = false) {
  isOpen.value = false
  query.value = ''
  if (refocus && triggerEl.value) triggerEl.value.focus()
}

function toggle() {
  if (isOpen.value) close()
  else openPanel()
}

function choose(value) {
  const v = value == null ? '' : String(value)
  close(true)
  if (String(props.modelValue || '') !== v) {
    emit('update:modelValue', v)
    emit('change', v)
  }
}

function move(step) {
  const n = flatFiltered.value.length
  if (!n) return
  hlIndex.value = (hlIndex.value + step + n) % n
  scrollHl()
}

function chooseHighlighted() {
  const opt = flatFiltered.value[hlIndex.value]
  if (opt) choose(opt.value)
  else if (props.allowEmpty) choose('')
}

function stopEvent(e) {
  // 避免 Esc / 方向键冒泡到外层弹窗（外层 Esc 会关闭编辑表单）
  e.stopPropagation()
}

watch(query, () => {
  hlIndex.value = 0
  nextTick(() => {
    updatePosition()
    scrollHl()
  })
})

function onDocMouseDown(e) {
  if (!isOpen.value) return
  if (root.value && !root.value.contains(e.target)) close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<style scoped>
.ss {
  position: relative;
  width: 100%;
  min-width: 0;
  font-family: inherit;
}
.ss-trigger {
  box-sizing: border-box;
  width: 100%;
  height: var(--ss-h, 32px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  background: var(--input-bg, rgba(4, 12, 20, 0.7));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
}
.ss-trigger:hover {
  border-color: var(--accent, #00e5ff);
}
.ss.open .ss-trigger {
  border-color: var(--accent, #00e5ff);
  box-shadow: 0 0 8px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.ss-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ss-value.ph {
  color: var(--text-dim, #7ea6c4);
}
.ss-caret {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-dim, #7ea6c4);
  transition: transform 0.15s;
}
.ss.open .ss-caret {
  transform: rotate(180deg);
}

/* 下拉面板 */
.ss-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 90;
  width: max-content;
  min-width: 100%;
  max-width: min(300px, calc(100vw - 48px));
  padding: 6px;
  border-radius: 8px;
  background: var(--panel-bg, rgba(10, 18, 28, 0.98));
  border: 1px solid var(--panel-border, rgba(0, 229, 255, 0.35));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 14px var(--accent-soft, rgba(0, 229, 255, 0.12));
  /* 浮在表格上方时避免透出底下文字 */
  backdrop-filter: blur(14px) saturate(1.2);
  box-sizing: border-box;
}
.ss-search {
  box-sizing: border-box;
  width: 100%;
  height: calc(var(--ss-h, 32px) - 3px);
  padding: 0 9px;
  margin-bottom: 6px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  background: var(--input-bg, rgba(4, 12, 20, 0.8));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.ss-search:focus {
  border-color: var(--accent, #00e5ff);
  box-shadow: 0 0 8px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.ss-search::placeholder {
  color: var(--text-dim, #5f7d95);
}

/* 下拉列表滚动条：细、圆角、跟随主题 */
.ss-list {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 224px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--input-border, rgba(0, 229, 255, 0.3)) rgba(255, 255, 255, 0.04);
  scrollbar-gutter: stable;
}
.ss-list::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.ss-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
}
.ss-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--input-border, rgba(0, 229, 255, 0.3));
}
.ss-list::-webkit-scrollbar-thumb:hover {
  background: var(--accent, #00e5ff);
}

.ss-option {
  padding: 6px 8px;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text, #e6f4ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.ss-option:hover,
.ss-option.hl {
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
}
.ss-option.active {
  color: var(--accent, #00e5ff);
  font-weight: 600;
}
.ss-group {
  position: sticky;
  top: 0;
  z-index: 1;
  margin-top: 4px;
  padding: 5px 8px 3px;
  background: var(--panel-bg, rgba(10, 18, 28, 0.98));
  color: var(--text-dim, #7ea6c4);
  font-size: 10px;
  letter-spacing: 1px;
}
.ss-empty {
  padding: 14px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim, #5f7d95);
}
</style>
