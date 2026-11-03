import { ref, watch } from 'vue'
import { RANDOM_COLOR_MODES } from './colorPalette'

// 随机配色方式（多彩 / 同色渐变）是全局展示选项，不是区域数据，单独存本地即可
const STORAGE_KEY = 'map-color-mode'
const KEYS = RANDOM_COLOR_MODES.map((m) => m.key)

let stored = null
try {
  stored = localStorage.getItem(STORAGE_KEY)
} catch (e) {
  stored = null
}

const colorMode = ref(KEYS.includes(stored) ? stored : 'multi')

watch(colorMode, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch (e) {
    // 忽略存储异常
  }
})

export function useColorMode() {
  return { colorMode, RANDOM_COLOR_MODES }
}
