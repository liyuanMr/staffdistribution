import { reactive, watch } from 'vue'

// 地图标签 / 气泡里显示哪些内容，是全局展示选项，存本地即可
const STORAGE_KEY = 'map-display-options'

const DEFAULTS = {
  labelName: true,
  labelHeadcount: true,
  labelPositions: true,
  labelRoster: true,
  bubbleHeadcount: true,
  bubblePositions: true,
  bubbleRoster: true
}

// 供设置面板渲染：分组 + 每项文案
export const DISPLAY_GROUPS = [
  {
    key: 'label',
    title: '地图标签',
    items: [
      { key: 'labelName', label: '区域名称' },
      { key: 'labelHeadcount', label: '人数' },
      { key: 'labelPositions', label: '岗位' },
      { key: 'labelRoster', label: '人员' }
    ]
  },
  {
    key: 'bubble',
    title: '气泡内容',
    items: [
      { key: 'bubbleHeadcount', label: '人数' },
      { key: 'bubblePositions', label: '岗位' },
      { key: 'bubbleRoster', label: '人员' }
    ]
  }
]

let stored = null
try {
  stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
} catch (e) {
  stored = null
}

const displayOptions = reactive({ ...DEFAULTS })
if (stored && typeof stored === 'object') {
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof stored[k] === 'boolean') displayOptions[k] = stored[k]
  }
}

watch(
  displayOptions,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
    } catch (e) {
      // 忽略存储异常
    }
  },
  { deep: true }
)

export function useDisplayOptions() {
  return { displayOptions, DISPLAY_GROUPS }
}
