import { ref } from 'vue'

const DIVISIONS_URL = 'map/divisions/all-divisions.json'
const PROVINCES_URL = 'map/divisions/provinces.json'
const CITIES_DIR = 'map/divisions/cities'
const CONFIG_URL = 'data/region-config.json'
const SAVE_URL = 'api/region-config'

// 合并后的省级 GeoJSON（含 34 省 + 全国边界 100000_JD）
let provincesCache = null
// 各省下属市/区 GeoJSON 缓存（省份 adcode -> FeatureCollection）
const citiesCache = new Map()

export function useDivisions() {
  const divisions = ref([])
  const config = ref({})
  const loading = ref(false)
  const error = ref(null)

  async function loadDivisions() {
    const res = await fetch(DIVISIONS_URL)
    if (!res.ok) throw new Error(`加载区划索引失败: ${res.status}`)
    divisions.value = await res.json()
    return divisions.value
  }

  async function loadConfig() {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`加载配置失败: ${res.status}`)
    config.value = normalizeConfig(await res.json())
    return config.value
  }

  async function saveConfig(next) {
    const res = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    })
    if (!res.ok) throw new Error(`保存配置失败: ${res.status}`)
    config.value = next
    return next
  }

  async function loadProvinces() {
    if (provincesCache) return provincesCache
    const res = await fetch(PROVINCES_URL)
    if (!res.ok) throw new Error(`加载省级边界失败: ${res.status}`)
    provincesCache = await res.json()
    return provincesCache
  }

  async function loadCities(provinceAdcode) {
    const key = String(provinceAdcode)
    if (citiesCache.has(key)) return citiesCache.get(key)
    const res = await fetch(`${CITIES_DIR}/${key}.json`)
    if (!res.ok) throw new Error(`加载市级边界失败: ${key} (${res.status})`)
    const fc = await res.json()
    citiesCache.set(key, fc)
    return fc
  }

  function findDivision(adcode) {
    const key = String(adcode)
    return divisions.value.find((d) => String(d.adcode) === key || String(d.id) === key)
  }

  function normalizeCount(value) {
    if (value === '' || value == null) return null
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
  }

  // 岗位：{ name, count }
  function normalizePositions(list) {
    if (!Array.isArray(list)) return []
    return list
      .filter((p) => p && (p.name || p.count != null))
      .map((p) => ({
        name: String(p.name || '').trim(),
        count: normalizeCount(p.count)
      }))
  }

  // 一个人可能负责多家医院，每家医院可单独指定所在市/区
  function normalizeHospitals(list) {
    if (!Array.isArray(list)) return []
    return list
      .filter((h) => h && (h.name || h.city))
      .map((h) => ({
        name: String(h.name || '').trim(),
        city: String(h.city || '').trim()
      }))
  }

  // 人员名单：{ name, position, phone, note, city, hospitals }
  //   city       —— 所属市/区 adcode，可留空（表示省本级/不指定）
  //   hospitals  —— 负责的医院 [{ name, city }]，一个人可以负责多个市/区的多家医院
  function normalizeRoster(list) {
    if (!Array.isArray(list)) return []
    return list
      .filter((p) => {
        if (!p) return false
        const hospitals = normalizeHospitals(p.hospitals)
        return !!(p.name || p.position || p.phone || p.note || hospitals.length)
      })
      .map((p) => {
        const person = {
          name: String(p.name || '').trim(),
          position: String(p.position || '').trim(),
          phone: String(p.phone || '').trim(),
          note: String(p.note || '').trim(),
          city: String(p.city || '').trim()
        }
        const hospitals = normalizeHospitals(p.hospitals)
        if (hospitals.length) person.hospitals = hospitals
        return person
      })
  }

  // 每个区域只保留人员相关数据：
  //   color / display —— 区域配色与标签展示方式
  //   headcount / positions / roster —— 人数、岗位、人员名单
  // 旧的 items / attrs 标注结构不再读取，保存时会自然写回新结构。
  function normalizeConfig(raw) {
    const out = {}
    if (!raw || typeof raw !== 'object') return out
    for (const [adcode, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue
      const headcount = normalizeCount(v.headcount)
      const positions = normalizePositions(v.positions)
      const roster = normalizeRoster(v.roster)
      out[adcode] = {
        color: v.color || '',
        // 展示方式：label = 常显地图标签（默认），bubble = 点击后在区域中间展示气泡
        display: v.display === 'bubble' ? 'bubble' : 'label'
      }
      // 只有存在时才写入，避免把没有人员数据的区域撑大
      if (headcount != null) out[adcode].headcount = headcount
      if (positions.length) out[adcode].positions = positions
      if (roster.length) out[adcode].roster = roster
    }
    return out
  }

  return {
    divisions,
    config,
    loading,
    error,
    loadDivisions,
    loadConfig,
    saveConfig,
    loadProvinces,
    loadCities,
    findDivision
  }
}
