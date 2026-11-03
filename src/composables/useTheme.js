import { ref, computed, watch } from 'vue'

// 三套整体风格。vars 会挂到 .app 上，供各组件用 CSS 变量取色；
// 其余字段给 Canvas 导出用（Canvas 读不到 CSS 变量）。
export const THEMES = [
  {
    key: 'tech',
    label: '科技深色',
    vars: {
      '--bg': '#05070d',
      '--bg2': '#081321',
      '--toolbar-bg': 'rgba(6, 12, 20, 0.9)',
      '--toolbar-border': 'rgba(0, 229, 255, 0.25)',
      '--accent': '#00e5ff',
      '--accent-soft': 'rgba(0, 229, 255, 0.16)',
      '--text': '#d6ecff',
      '--text-dim': '#7ea6c4',
      '--panel-bg': 'rgba(10, 18, 28, 0.85)',
      '--panel-border': 'rgba(0, 229, 255, 0.35)',
      '--input-bg': 'rgba(4, 12, 20, 0.6)',
      '--input-border': 'rgba(0, 229, 255, 0.25)',
      '--region-fill': '#26394d',
      '--region-stroke': '#0d5f7a',
      '--context-fill': '#16334a',
      '--hover-stroke': '#00e5ff',
      '--hover-filter': 'brightness(1.18)',
      '--selected-stroke': '#ffffff'
    },
    regionFill: '#26394d',
    regionStroke: '#0d5f7a',
    contextFill: '#16334a',
    selectedStroke: '#ffffff',
    bg1: '#05070d',
    bg2: '#081321',
    bubbleBg: 'rgba(10, 18, 28, 0.95)',
    bubbleText: '#e6f4ff'
  },
  {
    key: 'light',
    label: '浅色简约',
    vars: {
      '--bg': '#eef2f7',
      '--bg2': '#dfe7f0',
      '--toolbar-bg': 'rgba(255, 255, 255, 0.92)',
      '--toolbar-border': 'rgba(15, 60, 90, 0.18)',
      '--accent': '#0284c7',
      '--accent-soft': 'rgba(2, 132, 199, 0.12)',
      '--text': '#0f2a3a',
      '--text-dim': '#5b7288',
      '--panel-bg': 'rgba(255, 255, 255, 0.94)',
      '--panel-border': 'rgba(2, 132, 199, 0.3)',
      '--input-bg': 'rgba(255, 255, 255, 0.95)',
      '--input-border': 'rgba(2, 132, 199, 0.25)',
      '--region-fill': '#d7e1ec',
      '--region-stroke': '#94a9bf',
      '--context-fill': '#c3d2e2',
      '--hover-stroke': '#64748b',
      '--hover-filter': 'brightness(0.96)',
      '--selected-stroke': '#0284c7'
    },
    regionFill: '#d7e1ec',
    regionStroke: '#94a9bf',
    contextFill: '#c3d2e2',
    selectedStroke: '#0f172a',
    bg1: '#eef2f7',
    bg2: '#dfe7f0',
    bubbleBg: 'rgba(255, 255, 255, 0.97)',
    bubbleText: '#0f2a3a'
  },
  {
    key: 'violet',
    label: '暗紫霓虹',
    vars: {
      '--bg': '#0b0716',
      '--bg2': '#170a28',
      '--toolbar-bg': 'rgba(18, 8, 32, 0.9)',
      '--toolbar-border': 'rgba(168, 85, 247, 0.32)',
      '--accent': '#a855f7',
      '--accent-soft': 'rgba(168, 85, 247, 0.18)',
      '--text': '#eadcff',
      '--text-dim': '#a78bc4',
      '--panel-bg': 'rgba(20, 10, 34, 0.88)',
      '--panel-border': 'rgba(168, 85, 247, 0.4)',
      '--input-bg': 'rgba(12, 6, 22, 0.7)',
      '--input-border': 'rgba(168, 85, 247, 0.28)',
      '--region-fill': '#2c1f45',
      '--region-stroke': '#5b3f86',
      '--context-fill': '#221536',
      '--hover-stroke': '#a855f7',
      '--hover-filter': 'brightness(1.18)',
      '--selected-stroke': '#f3e8ff'
    },
    regionFill: '#2c1f45',
    regionStroke: '#5b3f86',
    contextFill: '#221536',
    selectedStroke: '#f3e8ff',
    bg1: '#0b0716',
    bg2: '#170a28',
    bubbleBg: 'rgba(20, 10, 34, 0.97)',
    bubbleText: '#eadcff'
  }
]

const STORAGE_KEY = 'map-theme'
let stored = null
try {
  stored = localStorage.getItem(STORAGE_KEY)
} catch (e) {
  stored = null
}

const themeKey = ref(THEMES.some((t) => t.key === stored) ? stored : 'tech')

watch(themeKey, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch (e) {
    // 忽略存储异常
  }
})

export function useTheme() {
  const theme = computed(() => THEMES.find((t) => t.key === themeKey.value) || THEMES[0])
  return { themeKey, theme, THEMES }
}
