<template>
  <div class="roster-mask" @click.self="$emit('close')">
    <section class="roster-dialog">
      <header class="dialog-head">
        <div class="head-title">
          <h2>人员表格管理</h2>
          <span class="count">共 {{ rows.length }} 人</span>
        </div>
        <button class="close" title="关闭" @click="$emit('close')">×</button>
      </header>

      <!-- 筛选：人员搜索 + 省份 + 城市 -->
      <div class="filters">
        <SearchSelect
          v-model="filterProvince"
          class="filter-province"
          :options="provinceSelectOptions"
          placeholder="全部省份"
          empty-label="全部省份"
          title="按省份筛选，可输入名称查找"
        />
        <SearchSelect
          v-model="filterCity"
          class="city-filter"
          :groups="filterCitySelectGroups"
          placeholder="全部城市"
          empty-label="全部城市"
          title="按市/区筛选（含负责医院在该市/区的人员），可输入名称查找"
        />
        <input
          ref="searchInput"
          v-model.trim="keyword"
          class="search"
          type="search"
          placeholder="搜索姓名 / 岗位 / 电话 / 备注 / 医院"
        />

        <button class="primary add-btn" @click="openAdd">+ 新增人员</button>
        <span class="result">{{ filteredRows.length }} 条结果</span>
      </div>

      <!-- 新增 / 编辑表单 -->
      <div v-if="formOpen" class="editor">
        <div class="editor-head">
          <h3>{{ editingKey ? '修改人员' : '新增人员' }}</h3>
          <div class="editor-actions">
            <span v-if="formError" class="form-error">{{ formError }}</span>
            <button class="ghost" @click="closeForm">取消</button>
            <button class="primary" @click="submitForm">保存</button>
          </div>
        </div>

        <div class="form-grid">
          <div class="fld">
            <span>所属省</span>
            <SearchSelect
              v-model="form.provinceAdcode"
              class="f-province"
              :options="provinceSelectOptions"
              placeholder="请选择省份"
              :allow-empty="false"
            />
          </div>
          <div class="fld">
            <span>所属市/区</span>
            <SearchSelect
              v-model="form.city"
              class="f-city"
              :options="formCitySelectOptions"
              placeholder="不指定市/区"
              empty-label="不指定市/区"
            />
          </div>
          <label class="fld">
            <span>姓名</span>
            <input v-model.trim="form.name" type="text" placeholder="姓名" />
          </label>
          <label class="fld">
            <span>岗位</span>
            <input v-model.trim="form.position" type="text" placeholder="如：总经理 / 代表" />
          </label>
          <label class="fld">
            <span>联系方式</span>
            <input v-model.trim="form.phone" type="text" placeholder="电话 / 微信" />
          </label>
          <label class="fld wide">
            <span>备注</span>
            <input v-model.trim="form.note" type="text" placeholder="备注，如：常驻北京 / 负责xx院区" />
          </label>
        </div>

        <div class="form-hospitals">
          <div class="fh-title">
            <span>负责医院（可多家，可跨市/区）</span>
            <button class="mini-add" @click="form.hospitals.push({ name: '', city: '' })">+ 医院</button>
          </div>
          <div class="fh-list">
            <div v-for="(h, i) in form.hospitals" :key="'fh' + i" class="fh-row">
              <input v-model.trim="h.name" type="text" placeholder="医院名称，如：协和医院" />
              <SearchSelect
                v-model="h.city"
                :options="formCitySelectOptions"
                :placeholder="form.city ? '同所属市/区' : '不指定市/区'"
                :empty-label="form.city ? '同所属市/区' : '不指定市/区'"
              />
              <button class="row-del" title="删除这家医院" @click="form.hospitals.splice(i, 1)">×</button>
            </div>
            <p v-if="!form.hospitals.length" class="fh-empty">暂无医院，点击「+ 医院」添加</p>
          </div>
        </div>
      </div>

      <!-- 人员表格 -->
      <div class="table-wrap">
        <table class="roster-table">
          <thead>
            <tr>
              <th class="col-province">省份</th>
              <th class="col-city">市/区</th>
              <th>姓名</th>
              <th>岗位</th>
              <th>联系方式</th>
              <th class="col-hospitals">负责医院</th>
              <th class="col-note">备注</th>
              <th class="col-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.key">
              <td class="col-province">{{ row.provinceName }}</td>
              <td class="col-city">{{ cityName(row.person.city) || '—' }}</td>
              <td class="name">{{ row.person.name || '未命名' }}</td>
              <td>{{ row.person.position || '—' }}</td>
              <td class="phone">{{ row.person.phone || '—' }}</td>
              <td class="col-hospitals">
                <span v-if="!row.person.hospitals || !row.person.hospitals.length" class="dim">—</span>
                <span v-for="(h, i) in row.person.hospitals" :key="'rh' + i" class="hospital-chip">
                  {{ h.name || '未命名医院' }}<em v-if="cityName(h.city)">{{ cityName(h.city) }}</em>
                </span>
              </td>
              <td class="col-note">{{ row.person.note || '—' }}</td>
              <td class="col-ops">
                <template v-if="confirmKey === row.key">
                  <button class="danger" @click="removeRow(row)">确认删除</button>
                  <button class="ghost small" @click="confirmKey = ''">取消</button>
                </template>
                <template v-else>
                  <button class="ghost small" @click="openEdit(row)">编辑</button>
                  <button class="danger small" @click="confirmKey = row.key">删除</button>
                </template>
              </td>
            </tr>
            <tr v-if="!filteredRows.length">
              <td class="empty-row" colspan="8">
                {{ rows.length ? '没有符合条件的人员' : '暂无人员，点击「+ 新增人员」开始录入' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="dialog-foot">
        <span>表格修改后保存到本地配置，地图与右侧面板会同步更新。</span>
        <button class="ghost" @click="$emit('close')">关闭</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SearchSelect from './SearchSelect.vue'

const props = defineProps({
  // 区划索引（省 / 市 / 区）
  divisions: { type: Array, default: () => [] },
  // 全量配置：{ [adcode]: { color, display, headcount, positions, roster } }
  config: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['save', 'close'])

const keyword = ref('')
const filterProvince = ref('')
const filterCity = ref('')
const confirmKey = ref('')
const searchInput = ref(null)

const formOpen = ref(false)
const editingKey = ref('')
const formError = ref('')
const form = ref({
  provinceAdcode: '',
  name: '',
  position: '',
  phone: '',
  note: '',
  city: '',
  hospitals: []
})

const provinceOptions = computed(() =>
  props.divisions
    .filter((d) => d.level === 'province')
    .map((d) => ({ adcode: String(d.adcode), name: d.shortTitle || d.title || String(d.adcode) }))
)

const provinceSelectOptions = computed(() =>
  provinceOptions.value.map((p) => ({ value: p.adcode, label: p.name }))
)

const provinceNameMap = computed(() => {
  const m = new Map()
  for (const p of provinceOptions.value) m.set(p.adcode, p.name)
  return m
})

// 全部市/区，按省分组（用于「城市查询」下拉）
const cityGroups = computed(() => {
  const groups = []
  const byParent = new Map()
  for (const d of props.divisions) {
    if (d.level !== 'city' && d.level !== 'district') continue
    const parent = String(d.parentNode || '')
    if (!byParent.has(parent)) {
      byParent.set(parent, [])
      groups.push({ adcode: parent, name: provinceNameMap.value.get(parent) || parent, cities: byParent.get(parent) })
    }
    byParent.get(parent).push({
      adcode: String(d.adcode),
      name: d.shortTitle || d.title || String(d.adcode)
    })
  }
  return groups
})

const filterCityGroups = computed(() =>
  filterProvince.value
    ? cityGroups.value.filter((g) => g.adcode === filterProvince.value)
    : cityGroups.value
)

const filterCitySelectGroups = computed(() =>
  filterCityGroups.value.map((g) => ({
    label: g.name,
    options: g.cities.map((c) => ({ value: c.adcode, label: c.name }))
  }))
)

// 城市 / 区县 adcode -> 名称（不含省名）
const cityNameMap = computed(() => {
  const m = new Map()
  for (const g of cityGroups.value) {
    for (const c of g.cities) m.set(c.adcode, c.name)
  }
  return m
})
function cityName(adcode) {
  const key = String(adcode || '').trim()
  return key ? cityNameMap.value.get(key) || key : ''
}

// 扁平化所有省级人员：一条人员记录 = 所属省下 roster 的一项
const rows = computed(() => {
  const out = []
  for (const [adcode, cfg] of Object.entries(props.config || {})) {
    if (!provinceNameMap.value.has(adcode)) continue
    const roster = cfg && Array.isArray(cfg.roster) ? cfg.roster : []
    roster.forEach((person, index) => {
      out.push({
        key: `${adcode}:${index}`,
        provinceAdcode: adcode,
        provinceName: provinceNameMap.value.get(adcode),
        index,
        person
      })
    })
  }
  // 按省、再按人员录入顺序展示
  out.sort((a, b) => a.provinceName.localeCompare(b.provinceName, 'zh') || a.index - b.index)
  return out
})

// 人员是否属于某市/区：登记在该市/区，或负责的医院在该市/区
function inCity(person, cityKey) {
  if (String(person.city || '') === cityKey) return true
  return (person.hospitals || []).some((h) => String(h.city || '') === cityKey)
}

const filteredRows = computed(() => {
  const q = keyword.value.toLowerCase()
  return rows.value.filter(({ person, provinceAdcode }) => {
    if (filterProvince.value && provinceAdcode !== filterProvince.value) return false
    if (filterCity.value && !inCity(person, filterCity.value)) return false
    if (!q) return true
    const haystack = [
      person.name,
      person.position,
      person.phone,
      person.note,
      ...(person.hospitals || []).map((h) => h && h.name)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

// 省变化时，城市筛选里已选但不再属于该省的市/区自动清空
watch(filterProvince, () => {
  const valid = new Set(filterCityGroups.value.flatMap((g) => g.cities.map((c) => c.adcode)))
  if (filterCity.value && !valid.has(filterCity.value)) filterCity.value = ''
})

/* ---------------- 新增 / 编辑 ---------------- */

const formCityOptions = computed(() => {
  const parent = form.value.provinceAdcode
  if (!parent) return []
  return props.divisions
    .filter(
      (d) =>
        String(d.parentNode) === parent && (d.level === 'city' || d.level === 'district')
    )
    .map((d) => ({ adcode: String(d.adcode), name: d.shortTitle || d.title || String(d.adcode) }))
})

const formCitySelectOptions = computed(() =>
  formCityOptions.value.map((c) => ({ value: c.adcode, label: c.name }))
)

function resetForm(provinceAdcode = '') {
  form.value = {
    provinceAdcode: provinceAdcode || filterProvince.value || '',
    name: '',
    position: '',
    phone: '',
    note: '',
    city: '',
    hospitals: []
  }
  formError.value = ''
}

function openAdd() {
  editingKey.value = ''
  // 新增时默认放到当前筛选的省；没有筛选则让用户自己选
  resetForm(filterProvince.value || '')
  formOpen.value = true
  nextTick(() => {
    const el = document.querySelector('.roster-dialog .form-grid input')
    if (el) el.focus()
  })
}

function openEdit(row) {
  editingKey.value = row.key
  formError.value = ''
  form.value = {
    provinceAdcode: row.provinceAdcode,
    name: row.person.name || '',
    position: row.person.position || '',
    phone: row.person.phone || '',
    note: row.person.note || '',
    city: row.person.city || '',
    hospitals: (row.person.hospitals || []).map((h) => ({ name: h.name || '', city: h.city || '' }))
  }
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingKey.value = ''
  formError.value = ''
}

// 表单里切换省份后，清掉不属于新省份的市/区选择
function onFormProvinceChange() {
  const known = new Set(formCityOptions.value.map((c) => c.adcode))
  if (form.value.city && !known.has(form.value.city)) form.value.city = ''
  form.value.hospitals.forEach((h) => {
    if (h.city && !known.has(h.city)) h.city = ''
  })
}
watch(() => form.value.provinceAdcode, () => onFormProvinceChange())

function buildPerson() {
  const person = {
    name: form.value.name.trim(),
    position: form.value.position.trim(),
    phone: form.value.phone.trim(),
    note: form.value.note.trim(),
    city: form.value.city || ''
  }
  const hospitals = form.value.hospitals
    .map((h) => ({ name: String(h.name || '').trim(), city: String(h.city || '').trim() }))
    .filter((h) => h.name || h.city)
  if (hospitals.length) person.hospitals = hospitals
  return person
}

// 复制整份配置，按需更新某个省的名单（人数若原本与名单数一致则跟着变）
function cloneConfig() {
  const next = {}
  for (const [adcode, cfg] of Object.entries(props.config || {})) {
    next[adcode] = {
      ...cfg,
      roster: Array.isArray(cfg && cfg.roster) ? cfg.roster.map((p) => ({ ...p })) : []
    }
  }
  return next
}

function getProvinceCfg(next, adcode) {
  if (!next[adcode]) next[adcode] = { color: '', display: 'label', roster: [] }
  const cfg = next[adcode]
  if (!('color' in cfg)) cfg.color = ''
  if (!cfg.display) cfg.display = 'label'
  if (!Array.isArray(cfg.roster)) cfg.roster = []
  return cfg
}

function pruneProvince(next, adcode) {
  const cfg = next[adcode]
  if (!cfg) return
  if (Array.isArray(cfg.roster) && !cfg.roster.length) delete cfg.roster
  const hasData =
    cfg.color ||
    cfg.display === 'bubble' ||
    cfg.headcount != null ||
    (cfg.positions && cfg.positions.length) ||
    (cfg.roster && cfg.roster.length)
  if (!hasData) delete next[adcode]
}

// 名单长度变化时，如果 headcount 正等于原名单人数，就同步，避免显示不一致
function syncHeadcount(cfg, oldLen, newLen) {
  if (cfg.headcount != null && Number(cfg.headcount) === oldLen) cfg.headcount = newLen
}

function submitForm() {
  const person = buildPerson()
  const province = form.value.provinceAdcode
  if (!province) {
    formError.value = '请选择所属省份'
    return
  }
  if (!person.name) {
    formError.value = '姓名不能为空'
    return
  }

  const next = cloneConfig()

  if (editingKey.value) {
    const [oldProvince, oldIndexRaw] = editingKey.value.split(':')
    const oldIndex = Number(oldIndexRaw)
    // 同省内修改：原地替换，保持名单顺序
    if (oldProvince === province) {
      const cfg = getProvinceCfg(next, oldProvince)
      if (oldIndex >= 0 && oldIndex < cfg.roster.length) cfg.roster[oldIndex] = person
      else cfg.roster.push(person)
      emit('save', next)
      closeForm()
      return
    }
    // 换了省份：从原省名单移除，人数若与名单数一致则同步
    const oldCfg = getProvinceCfg(next, oldProvince)
    const oldLen = oldCfg.roster.length
    if (oldIndex >= 0 && oldIndex < oldLen) {
      oldCfg.roster.splice(oldIndex, 1)
      syncHeadcount(oldCfg, oldLen, oldCfg.roster.length)
      pruneProvince(next, oldProvince)
    }
  }

  const cfg = getProvinceCfg(next, province)
  const before = cfg.roster.length
  cfg.roster.push(person)
  syncHeadcount(cfg, before, cfg.roster.length)

  emit('save', next)
  closeForm()
}

function removeRow(row) {
  const next = cloneConfig()
  const cfg = getProvinceCfg(next, row.provinceAdcode)
  const before = cfg.roster.length
  if (row.index >= 0 && row.index < before) {
    cfg.roster.splice(row.index, 1)
    syncHeadcount(cfg, before, cfg.roster.length)
  }
  pruneProvince(next, row.provinceAdcode)
  confirmKey.value = ''
  emit('save', next)
}

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (formOpen.value) closeForm()
  else emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  nextTick(() => searchInput.value && searchInput.value.focus())
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.roster-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 6, 12, 0.62);
  backdrop-filter: blur(3px);
  box-sizing: border-box;
}
.roster-dialog {
  width: min(1180px, 100%);
  max-height: min(860px, 92vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--panel-bg, rgba(10, 18, 28, 0.96));
  border: 1px solid var(--panel-border, rgba(0, 229, 255, 0.35));
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55), 0 0 24px var(--accent-soft, rgba(0, 229, 255, 0.15));
  color: var(--text, #cfe3f5);
  font-family: 'Consolas', 'Microsoft YaHei', monospace;
  box-sizing: border-box;
  /* 允许筛选/表单里的可搜索下拉浮层超出弹窗，避免被裁掉 */
  overflow: visible;
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--input-border, rgba(0, 229, 255, 0.2));
}
.head-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.dialog-head h2 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 2px;
  color: var(--accent, #00e5ff);
}
.dialog-head .count {
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
}
.close {
  background: none;
  border: none;
  color: var(--text-dim, #7ea6c4);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  color: var(--text, #d6ecff);
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--input-border, rgba(0, 229, 255, 0.15));
  flex-wrap: wrap;
}
.filters input {
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  background: var(--input-bg, rgba(4, 12, 20, 0.7));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.filters input:focus {
  border-color: var(--accent, #00e5ff);
  box-shadow: 0 0 8px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.filters .search {
  flex: 1 1 260px;
  min-width: 180px;
}
/* 可搜索下拉：筛选栏里按内容取宽，不被 flex 拉伸 */
.filters .filter-province,
.filters .city-filter {
  width: auto;
  flex: 0 0 auto;
}
.filters .filter-province {
  min-width: 126px;
}
.filters .city-filter {
  min-width: 158px;
}
.filters .result {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
  white-space: nowrap;
}
.primary {
  padding: 7px 16px;
  border: 1px solid var(--accent, #00e5ff);
  border-radius: 6px;
  background: var(--accent, #00e5ff);
  color: #04121a;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: 1px;
  cursor: pointer;
}
.primary:hover {
  box-shadow: 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.55));
}
.ghost {
  padding: 6px 14px;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.4));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.ghost:hover {
  color: var(--accent, #00e5ff);
  border-color: var(--accent, #00e5ff);
}
.ghost.small,
.danger.small {
  padding: 3px 9px;
  font-size: 11px;
}
.danger {
  border: 1px solid rgba(255, 107, 107, 0.5);
  border-radius: 6px;
  background: rgba(255, 107, 107, 0.14);
  color: #ff8a8a;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.danger:hover {
  background: rgba(255, 107, 107, 0.24);
}

/* -------- 新增 / 编辑表单 -------- */
.editor {
  padding: 12px 20px 14px;
  border-bottom: 1px solid var(--input-border, rgba(0, 229, 255, 0.15));
  background: rgba(0, 229, 255, 0.03);
}
.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.editor-head h3 {
  margin: 0;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--accent, #00e5ff);
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-error {
  color: #ff8a8a;
  font-size: 11px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 12px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.fld span {
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
  letter-spacing: 0.5px;
}
.fld.wide {
  grid-column: span 2;
}
.fld input,
.fh-row input {
  box-sizing: border-box;
  height: 30px;
  min-width: 0;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.25));
  background: var(--input-bg, rgba(4, 12, 20, 0.65));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.fld input:focus,
.fh-row input:focus {
  border-color: var(--accent, #00e5ff);
}
/* 表单内的可搜索下拉与输入框同高 */
.fld .ss,
.fh-row .ss {
  width: 100%;
  --ss-h: 30px;
}
.form-hospitals {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px dashed var(--input-border, rgba(0, 229, 255, 0.25));
  border-radius: 6px;
}
.fh-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
}
.mini-add {
  padding: 3px 9px;
  border: 1px dashed var(--accent, #00e5ff);
  border-radius: 5px;
  background: transparent;
  color: var(--accent, #00e5ff);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.mini-add:hover {
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
}
/* 医院列表固定最大高度，超出后列表内滚动 */
.fh-list {
  max-height: 132px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--input-border, rgba(0, 229, 255, 0.3)) rgba(255, 255, 255, 0.04);
  scrollbar-gutter: stable;
}
.fh-list::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.fh-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
}
.fh-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--input-border, rgba(0, 229, 255, 0.3));
}
.fh-list::-webkit-scrollbar-thumb:hover {
  background: var(--accent, #00e5ff);
}
.fh-row {
  display: grid;
  grid-template-columns: 1fr 150px 28px;
  gap: 6px;
  margin-bottom: 6px;
}
.fh-list .fh-row:last-child {
  margin-bottom: 0;
}
.fh-row .row-del {
  border: 1px solid rgba(255, 107, 107, 0.4);
  border-radius: 6px;
  background: rgba(255, 107, 107, 0.12);
  color: #ff8a8a;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.fh-empty {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-dim, #5f7d95);
}

/* -------- 表格 -------- */
/* 头 / 筛选 / 编辑区 / 底栏固定，只有表格区域滚动 */
.dialog-head,
.filters,
.editor,
.dialog-foot {
  flex: 0 0 auto;
}
.table-wrap {
  /* 以内容高度参与布局，弹窗到达最大高度时只压缩表格区域并出现滚动条 */
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: scroll;
  overflow-x: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--input-border, rgba(0, 229, 255, 0.3)) rgba(255, 255, 255, 0.04);
  scrollbar-gutter: stable;
}
.table-wrap::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}
.table-wrap::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 5px;
}
.table-wrap::-webkit-scrollbar-thumb {
  border-radius: 5px;
  border: 2px solid transparent;
  background: var(--input-border, rgba(0, 229, 255, 0.3));
  background-clip: padding-box;
}
.table-wrap::-webkit-scrollbar-thumb:hover {
  background: var(--accent, #00e5ff);
  background-clip: padding-box;
}
.table-wrap::-webkit-scrollbar-corner {
  background: transparent;
}
.roster-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.roster-table th,
.roster-table td {
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--input-border, rgba(126, 166, 196, 0.14));
}
.roster-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel-bg, rgba(10, 18, 28, 0.98));
  color: var(--text-dim, #7ea6c4);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--input-border, rgba(0, 229, 255, 0.25));
}
.roster-table tbody tr:hover {
  background: var(--accent-soft, rgba(0, 229, 255, 0.05));
}
.roster-table .name {
  color: var(--text, #e6f4ff);
  font-weight: 600;
  white-space: nowrap;
}
.roster-table .phone {
  color: var(--text-dim, #8fb8d8);
  white-space: nowrap;
}
.roster-table .dim {
  color: var(--text-dim, #5f7d95);
}
.col-province {
  width: 84px;
  white-space: nowrap;
}
.col-city {
  width: 82px;
  white-space: nowrap;
}
.col-hospitals {
  min-width: 190px;
}
.col-note {
  min-width: 120px;
  color: var(--text-dim, #8fb8d8);
}
.col-ops {
  width: 112px;
  white-space: nowrap;
}
.col-ops button + button {
  margin-left: 4px;
}
.hospital-chip {
  display: inline-block;
  margin: 0 4px 4px 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.18));
  font-size: 11px;
  color: var(--text, #e6f4ff);
}
.hospital-chip em {
  margin-left: 4px;
  font-style: normal;
  color: var(--text-dim, #7ea6c4);
}
.empty-row {
  padding: 32px 10px !important;
  text-align: center !important;
  color: var(--text-dim, #5f7d95);
}
.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid var(--input-border, rgba(0, 229, 255, 0.15));
  font-size: 11px;
  color: var(--text-dim, #5f7d95);
}
</style>
