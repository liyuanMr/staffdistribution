<template>
  <aside class="panel">
    <div class="panel-head">
      <h2>{{ title }}</h2>
      <div class="head-actions">
        <button v-if="!editing" class="edit" @click="startEdit">编辑</button>
        <button v-else-if="editing" class="edit cancel" @click="editing = false">取消</button>
        <button class="close" @click="$emit('close')">×</button>
      </div>
    </div>

    <!-- 市级视图：展示所属省内登记在本市/区，或在本市/区有负责医院的人员 -->
    <p v-if="isCityScope" class="scope-hint">
      所属省：{{ provinceName || '—' }} · 显示登记在「{{ title }}」或在该市/区有负责医院的人员
    </p>

    <div class="field">
      <label>区域颜色</label>
      <div class="color-row">
        <span v-if="!editing" class="swatch" :style="{ background: displayColor }"></span>
        <input v-else v-model="color" type="color" class="color-input" @input="colorTouched = true" />
        <span class="color-hex">{{ editing ? color : displayColor || '未设置' }}</span>
        <button
          v-if="editing"
          class="random-color"
          title="从协调色板中随机取色"
          @click="color = randomColor(color); colorTouched = true"
        >
          随机
        </button>
      </div>
    </div>

    <div v-if="!isCityScope" class="field">
      <label>标注显示方式</label>
      <div class="seg">
        <button :class="{ active: shownDisplay === 'label' }" :disabled="!editing" @click="displayMode = 'label'">
          地图标签
        </button>
        <button :class="{ active: shownDisplay === 'bubble' }" :disabled="!editing" @click="displayMode = 'bubble'">
          气泡展示
        </button>
      </div>
      <p class="hint-inline">{{ editing ? '保存后生效' : shownDisplay === 'bubble' ? '点击区域居中展示气泡' : '标注常显在地图上' }}</p>
    </div>

    <!-- 人员：人数 / 岗位 / 人员名单 -->
    <div class="tab-body people">
      <template v-if="!editing">
        <div class="stat-row">
          <div class="stat">
            <span class="num">{{ shownHeadcount == null ? '—' : shownHeadcount }}</span>
            <span class="cap">当前人数</span>
          </div>
          <div class="stat">
            <span class="num">{{ shownPositions.length }}</span>
            <span class="cap">岗位</span>
          </div>
          <div class="stat">
            <span class="num">{{ shownRoster.length }}</span>
            <span class="cap">人员</span>
          </div>
        </div>

        <div class="section-title">岗位</div>
        <ul v-if="shownPositions.length" class="info-list">
          <li v-for="(p, i) in shownPositions" :key="'sp' + i">
            <span class="k">{{ p.name || '未命名岗位' }}</span>
            <span class="v">{{ p.count == null ? '—' : p.count + ' 人' }}</span>
          </li>
        </ul>
        <p v-else class="empty">{{ isCityScope ? '该市暂无岗位信息' : '暂无岗位信息，点击「编辑」添加' }}</p>

        <div class="section-title">人员名单</div>
        <ul v-if="shownRoster.length" class="person-list">
          <li v-for="(p, i) in shownRoster" :key="'sr' + i">
            <span class="person-name">{{ p.name || '未命名' }}</span>
            <span v-if="!isCityScope && cityLabel(p.city)" class="person-city">{{ cityLabel(p.city) }}</span>
            <span v-if="p.position" class="person-pos">{{ p.position }}</span>
            <span v-if="p.phone" class="person-phone">{{ p.phone }}</span>
            <span v-if="p.note" class="person-note">{{ p.note }}</span>
            <ul v-if="p.hospitals && p.hospitals.length" class="hospital-list">
              <li v-for="(h, hi) in p.hospitals" :key="'h' + hi" class="hospital-chip">
                <span class="h-name">{{ h.name || '未命名医院' }}</span>
                <span v-if="hospitalCityLabel(h)" class="h-city">{{ hospitalCityLabel(h) }}</span>
              </li>
            </ul>
          </li>
        </ul>
        <p v-else class="empty">
          {{ isCityScope ? '该市暂无人员，请在省级面板中添加并选择所属市/区' : '暂无人员名单，点击「编辑」添加' }}
        </p>
      </template>

      <template v-else>
        <div v-if="!isCityScope" class="headcount-edit">
          <div class="headcount-top">
            <label>当前地区人数</label>
            <input v-model="headcountInput" type="number" min="0" step="1" placeholder="留空按名单人数" />
          </div>
          <div v-if="roster.length" class="headcount-link">
            <span>人员名单已登记 {{ roster.length }} 人</span>
            <button
              class="sync-count"
              type="button"
              :disabled="String(roster.length) === String(headcountInput)"
              @click="headcountInput = String(roster.length)"
            >
              同步
            </button>
          </div>
        </div>

        <template v-if="!isCityScope">
          <div class="section-title">
            岗位
            <button class="mini-add" @click="addPosition">+ 添加岗位</button>
          </div>
          <div v-for="(p, i) in positions" :key="'ep' + i" class="position-row">
            <input v-model="p.name" type="text" placeholder="岗位名称，如：总经理" />
            <input v-model="p.count" type="number" min="0" step="1" class="count-input" placeholder="人数" />
            <button class="row-del" title="删除此行" @click="removePeopleRow(positions, i)">×</button>
          </div>
        </template>

        <p v-if="isCityScope" class="city-edit-hint">
          市级/区级可修改区域颜色和已有人员信息；新增岗位、人员请到所属省的省级面板。删除人员表示不再负责本市/区，他在其他市/区的医院会保留。
        </p>

        <div class="section-title">
          人员名单
          <button v-if="!isCityScope" class="mini-add" @click="addRoster">+ 添加人员</button>
        </div>
        <div v-for="(p, i) in roster" :key="'er' + i" class="roster-row">
          <input v-model="p.name" class="r-name" type="text" placeholder="姓名" />
          <input v-model="p.position" class="r-pos" type="text" placeholder="岗位" />
          <select
            v-model="p.city"
            class="r-city"
            :disabled="isCityScope"
            :title="isCityScope ? '所属市/区在市级面板中不可修改' : '所属市/区（可以不选）'"
          >
            <option value="">不指定市/区</option>
            <option v-for="c in cityEditOptions" :key="c.adcode" :value="c.adcode">{{ c.name }}</option>
          </select>
          <input v-model="p.phone" class="r-phone" type="text" placeholder="联系方式" />
          <input v-model="p.note" class="r-note" type="text" placeholder="备注，如：常驻北京 / 负责xx院区" />
          <button class="row-del" title="删除此行" @click="removePeopleRow(roster, i)">×</button>
          <!-- 一个人可以负责多家医院，每家医院可单独选所在市/区 -->
          <div class="hospital-editor">
            <div v-for="(h, hi) in p.hospitals" :key="'h' + hi" class="hospital-row">
              <input v-model="h.name" class="h-name" type="text" placeholder="负责医院，如：协和医院" />
              <select
                v-model="h.city"
                class="h-city"
                :disabled="isCityScope"
                :title="isCityScope ? '医院所在市/区在市级面板中不可修改' : '医院所在市/区（留空则同所属市/区）'"
              >
                <option value="">{{ p.city ? '同所属市/区' : '不指定市/区' }}</option>
                <option v-for="c in cityEditOptions" :key="c.adcode" :value="c.adcode">{{ c.name }}</option>
              </select>
              <button class="row-del hospital-del" title="删除这家医院" @click="removeHospital(p, hi)">×</button>
            </div>
            <button v-if="!isCityScope" class="mini-add hospital-add" type="button" @click="addHospital(p)">
              + 医院
            </button>
          </div>
        </div>
        <p v-if="!isCityScope && !positions.length && !roster.length" class="empty">
          暂无内容，用上方按钮添加岗位或人员
        </p>
        <p v-else-if="isCityScope && !roster.length" class="empty">该市暂无人员</p>
      </template>
    </div>

    <div v-if="editing" class="actions">
      <button class="save" @click="onSave">保存到本地</button>
      <button class="clear" @click="$emit('clear', adcode)">清除</button>
    </div>

    <!-- <p class="hint">
      数据由本地服务保存（开发模式下为 <code>public/data/region-config.json</code>），也可手动编辑后点击「重新加载配置」。
    </p> -->
  </aside>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { randomColor } from '../composables/colorPalette'

const props = defineProps({
  region: { type: Object, default: null },
  value: { type: Object, default: null },
  // 可选的所属市/区列表（[{ adcode, name }]，仅省一级面板使用）
  cityOptions: { type: Array, default: () => [] },
  // 市级视图：当前选中的市/区 adcode，为空表示省一级面板
  cityAdcode: { type: String, default: '' },
  // 市级视图下所属省的 adcode（人员名单存放在该省配置里）
  provinceAdcode: { type: String, default: '' },
  // 市级视图下显示的所属省名称
  provinceName: { type: String, default: '' }
})
const emit = defineEmits(['save', 'clear', 'close'])

const editing = ref(false)
const color = ref('#00e5ff')
// 用户是否主动改过颜色：市级面板只改人员信息时不顺带把区域涂成默认色
const colorTouched = ref(false)
const displayMode = ref('label')
const headcountInput = ref('')
const positions = ref([])
const roster = ref([])
// 市级面板只编辑一个子集：记录每一行对应省名单里的原始下标，保存时按行合并回去
const draftOrigin = ref([])
// 进入编辑时本市/区面板展示的原始下标快照（不随删除变化），用于判断哪些人被移出本市/区
const draftShown = ref([])

const title = computed(() => {
  if (!props.region) return ''
  return props.region.fullName || props.region.title || props.region.shortTitle || ''
})

const adcode = computed(() => (props.region ? String(props.region.adcode || props.region.id) : ''))

// 展示状态读取已保存的配置
const displayColor = computed(() => (props.value && props.value.color) || '')
const savedDisplay = computed(() => ((props.value && props.value.display) === 'bubble' ? 'bubble' : 'label'))
const shownDisplay = computed(() => (editing.value ? displayMode.value : savedDisplay.value))

// 市级视图：只读展示所属省内登记在本市/区的人员
const isCityScope = computed(() => !!props.cityAdcode)

const allRoster = computed(() =>
  props.value && Array.isArray(props.value.roster) ? props.value.roster : []
)

// 一个人属于某市/区的判断：登记在该市/区，或负责的医院在该市/区
function personInCity(person, cityKey) {
  if (!person) return false
  if (String(person.city || '') === cityKey) return true
  return (person.hospitals || []).some((h) => String(h.city || '') === cityKey)
}

const shownRoster = computed(() => {
  if (!isCityScope.value) return allRoster.value
  const key = String(props.cityAdcode)
  return allRoster.value.filter((p) => personInCity(p, key))
})

// 市级视图没有单独的人数/岗位配置，按本市人员名单实时统计
const cityPositions = computed(() => {
  const map = new Map()
  for (const p of shownRoster.value) {
    const name = String(p.position || '').trim()
    if (!name) continue
    map.set(name, (map.get(name) || 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }))
})

const shownHeadcount = computed(() => {
  if (isCityScope.value) return shownRoster.value.length
  return props.value && props.value.headcount != null ? props.value.headcount : null
})
const shownPositions = computed(() => {
  if (isCityScope.value) return cityPositions.value
  return props.value && Array.isArray(props.value.positions) ? props.value.positions : []
})

// 展示人员所属市/区名称（省一级面板中）
function cityLabel(code) {
  const key = String(code || '').trim()
  if (!key) return ''
  const hit = props.cityOptions.find((c) => c.adcode === key)
  return hit ? hit.name : ''
}

// 医院所在市/区：留空表示跟随人员所属市/区
function hospitalCityLabel(h) {
  return h && h.city ? cityLabel(h.city) : ''
}

// 编辑时若已有历史数据里的市/区不在当前列表中，也保留为一个可选项，避免选择被清空
const cityEditOptions = computed(() => {
  const list = props.cityOptions.slice()
  const known = new Set(list.map((c) => c.adcode))
  const addUnknown = (raw) => {
    const code = String(raw || '').trim()
    if (code && !known.has(code)) {
      known.add(code)
      list.push({ adcode: code, name: `未知市/区（${code}）` })
    }
  }
  for (const p of roster.value) {
    addUnknown(p.city)
    for (const h of p.hospitals || []) addUnknown(h.city)
  }
  return list
})
function loadDraft() {
  const v = props.value || {}
  color.value = v.color || '#00e5ff'
  colorTouched.value = false
  displayMode.value = savedDisplay.value
  headcountInput.value = v.headcount == null ? '' : String(v.headcount)
  positions.value = Array.isArray(v.positions)
    ? v.positions.map((p) => ({
        name: p.name || '',
        count: p.count == null ? '' : String(p.count)
      }))
    : []
  const rosterList = Array.isArray(v.roster) ? v.roster : []
  const entries = rosterList.map((p, i) => ({ p, i }))
  // 市级/区级面板只编辑与本市/区相关的人员，其他人员保持原样
  const scoped = isCityScope.value
    ? entries.filter(({ p }) => personInCity(p, String(props.cityAdcode)))
    : entries
  draftOrigin.value = scoped.map(({ i }) => i)
  draftShown.value = [...draftOrigin.value]
  roster.value = scoped.map(({ p }) => ({
    name: p.name || '',
    position: p.position || '',
    phone: p.phone || '',
    note: p.note || '',
    // 所属市/区保持原值（可能是别的市，只是在当前市有负责医院）
    city: p.city || '',
    hospitals: Array.isArray(p.hospitals)
      ? p.hospitals.map((h) => ({ name: h.name || '', city: h.city || '' }))
      : []
  }))
}

// 切换区域：回到展示状态并重新加载
watch(
  () => props.region,
  () => {
    editing.value = false
    loadDraft()
  },
  { immediate: true }
)

// 配置被更新（保存成功 / 清除 / 重新加载）后自动退出编辑状态，避免草稿覆盖新数据
watch(
  () => props.value,
  () => {
    editing.value = false
    loadDraft()
  }
)

function startEdit() {
  loadDraft()
  editing.value = true
}

function addPosition() {
  positions.value.push({ name: '', count: '' })
}

function addRoster() {
  roster.value.push({ name: '', position: '', phone: '', note: '', city: '', hospitals: [] })
}

function addHospital(person) {
  if (!Array.isArray(person.hospitals)) person.hospitals = []
  person.hospitals.push({ name: '', city: '' })
}

function removeHospital(person, i) {
  if (person && Array.isArray(person.hospitals)) person.hospitals.splice(i, 1)
}

// 名单增删时自动跟随人数：仅当人数为空、或原本就等于名单数量时才同步，
// 手动填写的总人数不会被覆盖。
watch(
  () => roster.value.length,
  (n, old) => {
    if (!editing.value) return
    if (headcountInput.value === '' || headcountInput.value === String(old)) {
      headcountInput.value = n ? String(n) : ''
    }
  }
)

function removePeopleRow(list, i) {
  list.splice(i, 1)
  // 市级面板的人员草稿是省名单的子集，删除时同步删掉下标映射
  if (list === roster.value && isCityScope.value) draftOrigin.value.splice(i, 1)
}

// 在市级面板里删掉一个人，表示「不再负责本市/区」：
// 清掉登记在本市/区的归属和本市/区的医院；若他还在别的市/区有医院，则保留这条人员记录。
// 什么都没剩下时才整条删除。
function detachFromCity(person, cityKey) {
  if (!person) return null
  const next = { ...person }
  const ownsCity = String(next.city || '') === cityKey
  if (ownsCity) next.city = ''
  const hospitals = (person.hospitals || []).filter((h) => {
    const hc = String(h.city || '').trim()
    // 医院没单独填市/区时，跟随人员所属市/区
    return hc ? hc !== cityKey : !ownsCity
  })
  if (hospitals.length) next.hospitals = hospitals
  else delete next.hospitals
  // 只剩姓名/电话、不再属于任何市/区也没有医院时，整条移除，避免留下空壳记录
  const keep = !!next.city || !!(next.hospitals && next.hospitals.length)
  return keep ? next : null
}

function cleanCount(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function onSave() {
  const cleanPerson = (p) => {
    const person = {
      name: String(p.name || '').trim(),
      position: String(p.position || '').trim(),
      phone: String(p.phone || '').trim(),
      note: String(p.note || '').trim(),
      city: String(p.city || '').trim()
    }
    // 没有医院信息时不写空数组，保持配置文件干净
    const hospitals = (p.hospitals || [])
      .map((h) => ({ name: String(h.name || '').trim(), city: String(h.city || '').trim() }))
      .filter((h) => h.name || h.city)
    if (hospitals.length) person.hospitals = hospitals
    return person
  }
  const hasContent = (p) =>
    !!(p.name || p.position || p.phone || p.note || (p.hospitals && p.hospitals.length))
  // 保存前保留每一行对应的省名单下标，市级面板需要按行合并
  const rows = roster.value.map((p, i) => ({ index: draftOrigin.value[i], person: cleanPerson(p) }))

  // 市级/区级：只保存颜色 + 与本市/区相关人员的修改，不新增岗位/人数
  if (isCityScope.value) {
    const cityKey = String(props.cityAdcode)
    const edits = rows.filter((r) => hasContent(r.person))
    const editedIndices = new Set(edits.map((r) => r.index))
    // 面板里已移除的下标（删除行或内容被清空）：从本市/区解绑，而不是直接删除整条人员记录
    const removals = draftShown.value
      .filter((idx) => !editedIndices.has(idx))
      .map((idx) => ({ index: idx, person: detachFromCity(allRoster.value[idx], cityKey) }))
    emit('save', {
      scope: 'city',
      adcode: cityKey,
      provinceAdcode: String(props.provinceAdcode),
      // 没主动改过颜色则沿用原值；原本未配色且没动过，就保持不配色
      color: colorTouched.value ? color.value : (props.value && props.value.color) || '',
      // 原始子集快照 + 修改后的行；未出现在 edits 里的下标走 removals
      originIndices: [...draftShown.value],
      edits,
      removals
    })
    return
  }

  const rosterOut = rows.map((r) => r.person).filter(hasContent)
  const positionsOut = positions.value
    .map((p) => ({ name: String(p.name || '').trim(), count: cleanCount(p.count) }))
    .filter((p) => p.name || p.count != null)
  const headcount = cleanCount(headcountInput.value)
  emit('save', {
    adcode: adcode.value,
    color: color.value,
    display: displayMode.value,
    // 人数留空时直接取人员名单数量
    headcount: headcount == null && rosterOut.length ? rosterOut.length : headcount,
    positions: positionsOut,
    roster: rosterOut
  })
}
</script>

<style scoped>
.panel {
  position: absolute;
  top: calc(var(--toolbar-h, 60px) + 16px);
  right: 18px;
  width: 320px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 18px;
  border-radius: 12px;
  background: var(--panel-bg, rgba(10, 18, 28, 0.85));
  border: 1px solid var(--panel-border, rgba(0, 229, 255, 0.35));
  box-shadow: 0 0 24px var(--accent-soft, rgba(0, 229, 255, 0.18));
  backdrop-filter: blur(10px);
  color: var(--text, #cfe3f5);
  font-family: 'Consolas', 'Microsoft YaHei', monospace;
  z-index: 20;
  box-sizing: border-box;
  /* 内容超出时用细滚动条，颜色跟随主题 */
  scrollbar-width: thin;
  scrollbar-color: var(--input-border, rgba(0, 229, 255, 0.3)) transparent;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
/* WebKit / Electron：细长圆角滑块，悬停时提亮 */
.panel::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.panel::-webkit-scrollbar-track {
  background: transparent;
}
.panel::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--input-border, rgba(0, 229, 255, 0.3));
}
.panel::-webkit-scrollbar-thumb:hover {
  background: var(--accent, #00e5ff);
  box-shadow: 0 0 6px var(--accent-soft, rgba(0, 229, 255, 0.5));
}
.panel::-webkit-scrollbar-corner {
  background: transparent;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 10px;
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
  color: var(--accent, #00e5ff);
  letter-spacing: 1px;
}
.scope-hint {
  margin: -6px 0 14px;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.18));
  color: var(--text-dim, #8fb8d8);
  font-size: 11px;
  line-height: 1.5;
  letter-spacing: 0.5px;
}
.city-edit-hint {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  border: 1px dashed var(--input-border, rgba(0, 229, 255, 0.25));
  color: var(--text-dim, #8fb8d8);
  font-size: 11px;
  line-height: 1.5;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.edit {
  padding: 4px 12px;
  border: 1px solid var(--accent, #00e5ff);
  border-radius: 6px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.1));
  color: var(--accent, #00e5ff);
  font-size: 12px;
  letter-spacing: 1px;
  font-family: inherit;
  cursor: pointer;
}
.edit:hover {
  box-shadow: 0 0 10px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.edit.cancel {
  border-color: var(--input-border, rgba(126, 166, 196, 0.4));
  background: transparent;
  color: var(--text-dim, #9fb6cc);
}
.edit.cancel:hover {
  box-shadow: none;
  color: var(--text, #d6ecff);
}
.close {
  background: none;
  border: none;
  color: var(--text-dim, #7ea6c4);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
  margin-bottom: 6px;
  letter-spacing: 1px;
}
.swatch {
  width: 44px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  background: #26394d;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.color-input {
  width: 44px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.color-hex {
  font-size: 13px;
  color: var(--text-dim, #8fb8d8);
}
.random-color {
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid var(--accent, #00e5ff);
  border-radius: 6px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  color: var(--accent, #00e5ff);
  font-size: 12px;
  letter-spacing: 1px;
  font-family: inherit;
  cursor: pointer;
}
.random-color:hover {
  box-shadow: 0 0 10px var(--accent-soft, rgba(0, 229, 255, 0.35));
}
.seg {
  display: flex;
  gap: 6px;
}
.seg button {
  flex: 1;
  padding: 7px 0;
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #9fb6cc);
  font-size: 12px;
  letter-spacing: 1px;
  font-family: inherit;
  cursor: pointer;
}
.seg button.active {
  border-color: var(--accent, #00e5ff);
  background: var(--accent-soft, rgba(0, 229, 255, 0.16));
  color: var(--accent, #00e5ff);
  font-weight: 600;
}
.seg button:disabled {
  cursor: default;
  opacity: 0.85;
}
.seg button:disabled:not(.active) {
  opacity: 0.5;
}
.hint-inline {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-dim, #5f7d95);
}
.tab-body {
  min-height: 90px;
}
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, #5f7d95);
}
.row-del {
  flex: 0 0 26px;
  border: 1px solid rgba(255, 107, 107, 0.4);
  border-radius: 6px;
  background: rgba(255, 107, 107, 0.12);
  color: #ff8a8a;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.actions button {
  flex: 1;
  padding: 9px 0;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  letter-spacing: 1px;
  font-family: inherit;
}
.save {
  background: var(--accent, #00e5ff);
  color: #04121a;
  font-weight: 700;
}
.save:hover {
  box-shadow: 0 0 12px var(--accent-soft, rgba(0, 229, 255, 0.6));
}
.clear {
  background: rgba(255, 107, 107, 0.15);
  color: #ff8a8a;
  border: 1px solid rgba(255, 107, 107, 0.4) !important;
}
.stat-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.stat {
  flex: 1;
  padding: 10px 6px;
  border-radius: 8px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.18));
  text-align: center;
}
.stat .num {
  display: block;
  font-size: 22px;
  font-weight: 700;
  color: var(--accent, #00e5ff);
  line-height: 1.2;
}
.stat .cap {
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
  letter-spacing: 1px;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 6px;
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
  letter-spacing: 1px;
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
.info-list,
.person-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.info-list li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.18));
  font-size: 13px;
}
.info-list .k {
  color: var(--text, #e6f4ff);
  word-break: break-all;
}
.info-list .v {
  color: var(--accent, #00e5ff);
  font-weight: 600;
  white-space: nowrap;
}
.person-list > li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  border: 1px solid var(--input-border, rgba(126, 166, 196, 0.22));
  font-size: 13px;
}
/* 负责医院：一个人多条，用小标签横向排列 */
.hospital-list {
  flex: 1 0 100%;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.hospital-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.08));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.18));
  font-size: 11px;
}
.hospital-chip .h-name {
  color: var(--text, #e6f4ff);
}
.hospital-chip .h-city {
  color: var(--text-dim, #7ea6c4);
}
.person-name {
  color: var(--text, #e6f4ff);
  font-weight: 600;
}
.person-pos {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-soft, rgba(0, 229, 255, 0.12));
  color: var(--accent, #00e5ff);
  font-size: 11px;
}
/* 省一级名单里标注该人员所属市/区 */
.person-city {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  color: var(--text-dim, #8fb8d8);
  font-size: 11px;
  white-space: nowrap;
}
.person-phone {
  margin-left: auto;
  color: var(--text-dim, #8fb8d8);
  font-size: 12px;
}
.person-note {
  flex: 1 0 100%;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--input-border, rgba(126, 166, 196, 0.2));
  color: var(--text-dim, #8fb8d8);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.headcount-edit {
  margin-bottom: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.25));
}
.headcount-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.headcount-edit label {
  font-size: 12px;
  color: var(--text-dim, #7ea6c4);
  letter-spacing: 1px;
}
.headcount-edit input {
  width: 96px;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.3));
  background: var(--panel-bg, rgba(10, 18, 28, 0.9));
  color: var(--text, #e6f4ff);
  font-size: 15px;
  font-weight: 700;
  text-align: right;
  outline: none;
  appearance: textfield;
  -moz-appearance: textfield;
}
.headcount-edit input::-webkit-outer-spin-button,
.headcount-edit input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.headcount-edit input:focus {
  border-color: var(--accent, #00e5ff);
  box-shadow: 0 0 8px var(--accent-soft, rgba(0, 229, 255, 0.4));
}
.headcount-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed var(--input-border, rgba(126, 166, 196, 0.25));
  font-size: 11px;
  color: var(--text-dim, #7ea6c4);
}
.sync-count {
  flex: 0 0 auto;
  padding: 2px 9px;
  border: 1px solid var(--accent, #00e5ff);
  border-radius: 4px;
  background: transparent;
  color: var(--accent, #00e5ff);
  font-size: 10px;
  letter-spacing: 1px;
  font-family: inherit;
  cursor: pointer;
}
.sync-count:hover:not(:disabled) {
  background: var(--accent-soft, rgba(0, 229, 255, 0.1));
}
.sync-count:disabled {
  opacity: 0.35;
  cursor: default;
}
.position-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.position-row input {
  box-sizing: border-box;
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.25));
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  outline: none;
}
.position-row input:first-child {
  flex: 1;
  min-width: 0;
}
.position-row .count-input {
  flex: 0 0 62px;
  width: 62px;
  text-align: center;
}
.position-row input:focus {
  border-color: var(--accent, #00e5ff);
}
.roster-row {
  display: grid;
  grid-template-columns: 1fr 1fr 26px;
  gap: 6px;
  margin-bottom: 6px;
}
.roster-row input,
.roster-row select {
  box-sizing: border-box;
  min-width: 0;
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid var(--input-border, rgba(0, 229, 255, 0.25));
  background: var(--input-bg, rgba(4, 12, 20, 0.6));
  color: var(--text, #e6f4ff);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.roster-row select {
  cursor: pointer;
}
.roster-row select:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.roster-row select option {
  background: var(--panel-bg, rgba(10, 18, 28, 0.95));
  color: var(--text, #e6f4ff);
}
.roster-row input:focus,
.roster-row select:focus {
  border-color: var(--accent, #00e5ff);
}
.roster-row .r-name {
  grid-column: 1;
  grid-row: 1;
}
.roster-row .r-pos {
  grid-column: 2;
  grid-row: 1;
}
.roster-row .r-city {
  grid-column: 1;
  grid-row: 2;
}
.roster-row .r-phone {
  grid-column: 2;
  grid-row: 2;
}
.roster-row .r-note {
  grid-column: 1 / 3;
  grid-row: 3;
}
.roster-row .row-del {
  grid-column: 3;
  grid-row: 1;
  flex: none;
}
/* 负责医院编辑：挂在人员行下方，跨满整行 */
.roster-row .hospital-editor {
  grid-column: 1 / 4;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-radius: 6px;
  border: 1px dashed var(--input-border, rgba(0, 229, 255, 0.2));
  background: rgba(0, 0, 0, 0.12);
}
.hospital-row {
  display: grid;
  grid-template-columns: 1fr 84px 26px;
  gap: 5px;
}
.hospital-row .h-name {
  grid-column: 1;
  grid-row: 1;
}
.hospital-row .h-city {
  grid-column: 2;
  grid-row: 1;
}
.hospital-row .row-del {
  grid-column: 3;
  grid-row: 1;
}
.hospital-add {
  align-self: flex-start;
}
.hint {
  margin: 14px 0 0;
  font-size: 11px;
  color: var(--text-dim, #5f7d95);
  line-height: 1.6;
}
.hint code {
  color: var(--accent, #9fd4ff);
}
</style>
