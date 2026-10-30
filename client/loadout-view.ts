import { LOADOUT_CATEGORIES, PETS, cloneLoadout, createDefaultLoadout, getCategoryOptions, getSelection, withCategorySelection } from '../shared/catalog.js';
import type { Loadout } from '../shared/types.js';
import { searchCatalog } from './catalog-search.js';

type CategoryId = (typeof LOADOUT_CATEGORIES)[number]['id'];
type Entry = ReturnType<typeof getCategoryOptions>[number];
type TabState = { query: string; page: number; selected: string | null; equippedPage: number };
export const CATALOG_PAGE_SIZE = 24;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, value: string) => { if ($(id).textContent !== value) $(id).textContent = value; };
const icons: Record<CategoryId, string> = {
  pets: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M8 9h1m6 0h1 M8 15q4 3 8 0',
  items: 'M4 7h16v14H4Z M3 3h18v4H3Z M9 7v5h6V7',
  skills: 'm14 2-9 12h6l-1 8 9-13h-6Z',
  traits: 'm12 2 9 10-9 10-9-10Z M8 12h8 M12 8v8'
};
const entryIcons: Record<string, string> = {
  liangchushuo: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 3Q5 2 3 9q7-1 9-6 2 5 9 6 M5 10h6v4H5Z M13 10h6v4h-6Z M11 11h2 M8 17q4 3 8-1 M7 20l3 2 2-2 2 2 3-2',
  'lucky-ticket': 'M3 5h18v5q-4 2 0 4v5H3v-5q4-2 0-4Z M14 5v3m0 3v2m0 3v3 M7 9l2 2-2 3',
  'plain-club': 'M5 21 14 8q-3-4 0-6 5-1 7 4 0 4-5 4L8 23Z M15 4l3 3 M12 12l3 2',
  'thorn-armor': 'M6 4h12l3 8-9 10-9-10Z M8 4 6 1 M16 4l2-3 M3 12H0 M21 12h3 M8 17l-3 4 M16 17l3 4',
  'ascension-charm': 'M12 2 6 11l6 11 6-11Z M12 7v10 M8 11l4-4 4 4 M6 9 2 5v9l4 2 M18 9l4-4v9l-4 2',
  'healing-orb': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 7v10 M7 12h10 M5 2l1 2 M19 2l-1 2',
  'banana-peel': 'M12 3v6 M12 8Q7 14 2 17q6 5 10-5 4 10 10 5-8-3-9-9 M11 3h3',
  'emergency-toilet': 'M5 3h14v6H5Z M4 11q8-4 16 0v3q-1 5-7 5v3H9v-4q-5-1-5-7Z M4 12h16',
  'wall-punch': 'M2 8h4v8H2 M6 12h3l2-4 2 8 2-8 2 4h2 M19 6h3v12h-3Z',
  overinflator: 'M4 4h10 M9 4v7 M5 11h8v10H5Z M13 19h3V9q0-6 4-6t2 6q0 4-3 3',
  'bomb-parcel': 'M3 8h18v13H3Z M3 8l4-5h10l4 5 M12 8v13 M9 3l3 5 3-5 M16 3q3-5 5-1',
  'pain-installment': 'M5 2h14v20l-3-2-4 2-4-2-3 2Z M8 7h8 M8 11h8 M8 15h3 M15 14v5 M13 16h4',
  'refund-code': 'M4 4h16v16H4Z M7 7v7 M10 7v7 M12 7v7 M15 7v7 M17 7v7 M8 17h8 M2 10V2h8',
  'pearl-cup': 'M5 6h14l-2 16H7Z M4 6h16 M14 6l2-5 M10 15a1 1 0 1 0 0 .1 M14 17a1 1 0 1 0 0 .1 M10 19a1 1 0 1 0 0 .1',
  'rewind-tape': 'M3 5h18v14H3Z M6 8h4v4H6Z M14 8h4v4h-4Z M7 16h10 M11 21l-4-3 4-3 M18 21l-4-3 4-3',
  hutao: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M5 8h14 M6 10h5v4H6Z M13 10h5v4h-5Z M11 11h2 M8 17q5 2 8-1 M9 6l-1-3 3 1 1-2 1 2 3-1-1 3Z',
  chengzhiquan: 'M21 12a9 9 0 0 1-18 0 M3 7q-2-5 3-4 0-4 4-2 2-3 4 0 4-2 4 2 5-1 3 4 M4 8q2-3 4 0t4 0t4 0t4 0 M10 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M10 11h4 M8 17q4 4 8 0',
};
function icon(category: CategoryId, id?: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', id ? entryIcons[id] ?? icons[category] : icons[category]); svg.append(path); return svg;
}
function mark(category: CategoryId, entry: Entry) {
  const element = document.createElement('span'); element.className = 'catalog-icon'; element.append(icon(category, entry.id));
  element.dataset.family = category === 'pets' ? entry.id : category;
  return element;
}
function statList(element: HTMLElement, rows: ['health' | 'attack' | 'speed', string, string][]) {
  element.replaceChildren();
  for (const [id, label, value] of rows) {
    const group = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
    group.className = 'stat-cell'; group.dataset.stat = id;
    dt.textContent = label;
    const [number, unit] = value.split(' / ');
    dd.append(document.createTextNode(number));
    if (unit) { const suffix = document.createElement('span'); suffix.className = 'stat-unit'; suffix.textContent = ` / ${unit}`; dd.append(suffix); }
    group.append(dt, dd); element.append(group);
  }
}

/** Render plain catalog text safely; only numeric runs become semantic emphasis. */
function appendEffectText(element: HTMLElement, text: string) {
  for (const part of text.split(/([≤≥+−]?\d+(?:[.～–]\d+)?%?)/g)) {
    if (!part) continue;
    if (/\d/.test(part)) { const value = document.createElement('strong'); value.className = 'effect-value'; value.textContent = part; element.append(value); }
    else element.append(document.createTextNode(part));
  }
}

/** Inventory presentation is separate from the room connection and battle renderer. */
export class LoadoutView {
  private loadout = createDefaultLoadout();
  private locked = true;
  private lastKey = '';
  private category: CategoryId = 'pets';
  private equippedCategory: CategoryId = 'pets';
  private replacement: { category: CategoryId; index: number } | null = null;
  private composing = false;
  private states = new Map<CategoryId, TabState>(LOADOUT_CATEGORIES.map(category => [category.id, { query: '', page: 0, selected: null, equippedPage: 0 }]));
  constructor(private onChange: (loadout: Loadout) => void) {
    this.buildTabs('catalog-tabs', category => this.setCategory(category));
    this.buildTabs('equipped-tabs', category => { this.equippedCategory = category; this.replacement = null; this.renderEquipped(); this.renderDetail(); });
    const search = $<HTMLInputElement>('catalog-search');
    search.addEventListener('compositionstart', () => { this.composing = true; });
    search.addEventListener('compositionend', () => { this.composing = false; this.search(search.value); });
    search.addEventListener('input', () => { if (!this.composing) this.search(search.value); });
    $('clear-search').addEventListener('click', () => { search.value = ''; this.search(''); search.focus(); });
    $('catalog-prev').addEventListener('click', () => { this.state.page--; this.state.selected = null; this.renderCatalog(); });
    $('catalog-next').addEventListener('click', () => { this.state.page++; this.state.selected = null; this.renderCatalog(); });
    $('equipped-prev').addEventListener('click', () => { this.states.get(this.equippedCategory)!.equippedPage--; this.renderEquipped(); });
    $('equipped-next').addEventListener('click', () => { this.states.get(this.equippedCategory)!.equippedPage++; this.renderEquipped(); });
    $('equip-candidate').addEventListener('click', () => this.equip());
    $('unequip-candidate').addEventListener('click', () => this.unequip());
    $('change-pet').addEventListener('click', () => { this.setCategory('pets'); $('catalog-tabs').querySelector<HTMLButtonElement>('[data-category="pets"]')!.focus(); });
    this.renderAll();
  }
  private get state() { return this.states.get(this.category)!; }
  private get descriptor() { return LOADOUT_CATEGORIES.find(category => category.id === this.category)!; }
  private buildTabs(id: string, select: (category: CategoryId) => void) {
    const container = $(id);
    for (const category of LOADOUT_CATEGORIES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.category = category.id;
      button.id = `${id}-${category.id}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', id === 'catalog-tabs' ? 'catalog-grid' : 'equipped-slots');
      button.append(icon(category.id), document.createTextNode(category.label)); button.addEventListener('click', () => select(category.id));
      button.addEventListener('keydown', event => {
        const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(button);
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]!.focus(); buttons[next]!.click(); }
      });
      container.append(button);
    }
  }
  private updateTabs(id: string, active: CategoryId) {
    for (const button of $(id).querySelectorAll<HTMLButtonElement>('button')) {
      const selected = button.dataset.category === active;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    $(id === 'catalog-tabs' ? 'catalog-grid' : 'equipped-slots').setAttribute('aria-labelledby', `${id}-${active}`);
  }
  update(loadout: Loadout, locked: boolean) {
    const key = JSON.stringify([loadout, locked]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const switchedPet = this.loadout.petId !== loadout.petId;
    this.loadout = cloneLoadout(loadout); this.locked = locked;
    if (switchedPet) {
      for (const id of ['skills', 'traits'] as CategoryId[]) this.states.set(id, { query: '', page: 0, selected: null, equippedPage: 0 });
      this.replacement = null;
    }
    this.renderAll();
  }
  reset() {
    this.category = 'pets'; this.equippedCategory = 'pets'; this.replacement = null;
    for (const id of this.states.keys()) this.states.set(id, { query: '', page: 0, selected: null, equippedPage: 0 });
    this.lastKey = '';
  }
  private setCategory(category: CategoryId) {
    this.category = category;
    this.renderCatalog();
  }
  private search(query: string) {
    this.state.query = query; this.state.page = 0; this.state.selected = null;
    this.renderCatalog();
  }
  private renderAll() {
    const pet = PETS.find(pet => pet.id === this.loadout.petId)!;
    setText('selected-pet-name', pet.name); setText('selected-pet-title', pet.title);
    $('selected-pet-mark').style.setProperty('--pet-color', pet.color);
    $('selected-pet-mark').replaceChildren(icon('pets', pet.id));
    statList($('pet-stats'), [['health', '生命', String(pet.hp)], ['attack', '碰撞伤害', String(pet.attack)], ['speed', '移速', `${pet.speed} / 秒`]]);
    const statsCaption = document.createElement('div'); statsCaption.className = 'stats-caption';
    const statsLabel = document.createElement('dt'); statsLabel.textContent = '小球基础属性';
    const statsNote = document.createElement('dd'); statsNote.textContent = '固有效果自动生效';
    statsCaption.append(statsLabel, statsNote); $('pet-stats').prepend(statsCaption);
    setText('loadout-summary', LOADOUT_CATEGORIES.filter(category => category.limit > 1 || category.id === 'traits').map(category => `${category.label} ${getSelection(this.loadout, category.id).length}/${category.limit}`).join(' · '));
    this.renderEquipped(); this.renderCatalog();
  }
  private renderEquipped() {
    const descriptor = LOADOUT_CATEGORIES.find(category => category.id === this.equippedCategory)!;
    const ids = getSelection(this.loadout, this.equippedCategory);
    const entries = getCategoryOptions(this.equippedCategory, this.loadout.petId);
    const state = this.states.get(this.equippedCategory)!;
    const pageCount = Math.max(1, Math.ceil(descriptor.limit / descriptor.slotPageSize));
    state.equippedPage = Math.max(0, Math.min(state.equippedPage, pageCount - 1));
    this.updateTabs('equipped-tabs', this.equippedCategory);
    setText('equipped-title', this.equippedCategory === 'pets' ? '出战小球' : `已装备${descriptor.label}`); setText('equipped-count', `${ids.length} / ${descriptor.limit}`);
    setText('equipped-help', !entries.length ? `暂无${descriptor.label}，当前版本尚未添加，可直接准备开战。` : this.replacement?.category === this.equippedCategory ? `已选择槽位 ${this.replacement.index + 1}，从内容库选择要替换的${descriptor.singular}。` : this.equippedCategory === 'pets' ? '点击小球查看固有效果，也可以从内容库更换。' : '点击已装备内容查看详情，或指定要替换的槽位。');
    const container = $('equipped-slots'); container.style.setProperty('--slot-columns', String(descriptor.slotPageSize)); container.replaceChildren();
    for (let index = state.equippedPage * descriptor.slotPageSize; index < Math.min(descriptor.limit, (state.equippedPage + 1) * descriptor.slotPageSize); index++) {
      const entry = entries.find(entry => entry.id === ids[index]);
      const slot = document.createElement(entry ? 'button' : 'div'); slot.className = `equipped-slot${entry ? '' : ' is-empty'}`; slot.dataset.slotIndex = String(index);
      const number = document.createElement('span'); number.className = 'slot-number'; number.textContent = String(index + 1).padStart(2, '0');
      number.setAttribute('aria-hidden', 'true'); slot.append(number);
      slot.title = entry ? `${entry.name} · 槽位 ${index + 1}` : `空槽位 ${index + 1}`;
      slot.setAttribute('aria-label', entry ? `槽位 ${index + 1}：${entry.name}，点击查看或替换` : `空槽位 ${index + 1}`);
      if (entry) {
        slot.append(mark(this.equippedCategory, entry));
        slot.dataset.equippedId = entry.id;
        const button = slot as HTMLButtonElement; button.type = 'button';
        button.setAttribute('aria-pressed', String(this.replacement?.category === this.equippedCategory && this.replacement.index === index));
        button.addEventListener('click', () => {
          this.replacement = { category: this.equippedCategory, index }; this.category = this.equippedCategory; this.state.selected = entry.id;
          this.state.query = ''; this.state.page = Math.floor(entries.findIndex(candidate => candidate.id === entry.id) / CATALOG_PAGE_SIZE);
          this.renderEquipped(); this.renderCatalog();
          $('equipped-slots').querySelector<HTMLButtonElement>(`[data-slot-index="${index}"]`)?.focus({ preventScroll: true });
          this.revealDetail();
        });
      }
      container.append(slot);
    }
    setText('equipped-page', `${state.equippedPage + 1} / ${pageCount}`);
    $<HTMLButtonElement>('equipped-prev').disabled = state.equippedPage === 0;
    $<HTMLButtonElement>('equipped-next').disabled = state.equippedPage === pageCount - 1;
  }
  private renderCatalog() {
    const entries = getCategoryOptions(this.category, this.loadout.petId);
    const results = searchCatalog(entries, this.state.query);
    const pageCount = Math.max(1, Math.ceil(results.length / CATALOG_PAGE_SIZE));
    this.state.page = Math.max(0, Math.min(this.state.page, pageCount - 1));
    const visible = results.slice(this.state.page * CATALOG_PAGE_SIZE, (this.state.page + 1) * CATALOG_PAGE_SIZE);
    if (this.state.selected && !visible.some(entry => entry.id === this.state.selected)) this.state.selected = null;
    this.updateTabs('catalog-tabs', this.category);
    const search = $<HTMLInputElement>('catalog-search'); if (!this.composing && search.value !== this.state.query) search.value = this.state.query;
    $('clear-search').hidden = !this.state.query;
    const petName = PETS.find(pet => pet.id === this.loadout.petId)!.name;
    setText('catalog-context', !entries.length ? `暂无${this.descriptor.label}，当前版本尚未添加。` : this.category === 'skills' || this.category === 'traits' ? `${petName}专属${this.descriptor.label} · 最多装备 ${this.descriptor.limit} 个` : this.descriptor.description);
    setText('catalog-total', this.state.query ? `${results.length} / ${entries.length} 个` : `${entries.length} 个可选`);
    const ids = getSelection(this.loadout, this.category);
    const grid = $('catalog-grid'); grid.replaceChildren();
    for (const entry of visible) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-tile'; button.dataset.candidate = entry.id;
      button.setAttribute('aria-pressed', String(this.state.selected === entry.id));
      const equipped = ids.includes(entry.id);
      button.title = `${entry.name}${equipped ? ' · 已装备' : ''}`;
      button.setAttribute('aria-label', `${entry.name}${equipped ? '，已装备' : ''}，查看详情`);
      button.dataset.equipped = String(equipped);
      button.append(mark(this.category, entry));
      if (equipped) {
        const badge = document.createElement('span'); badge.className = 'equipped-badge'; badge.setAttribute('aria-hidden', 'true');
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); check.setAttribute('viewBox', '0 0 12 12');
        const path = document.createElementNS(check.namespaceURI, 'path'); path.setAttribute('d', 'm2 6 3 3 5-6'); check.append(path); badge.append(check); button.append(badge);
      }
      button.addEventListener('click', () => {
        this.state.selected = entry.id;
        for (const candidate of grid.querySelectorAll<HTMLButtonElement>('[data-candidate]')) candidate.setAttribute('aria-pressed', String(candidate.dataset.candidate === entry.id));
        this.renderDetail();
        this.revealDetail();
      });
      grid.append(button);
    }
    setText('catalog-empty', !entries.length ? `暂无${this.descriptor.label}，当前版本尚未添加，可直接准备开战。` : '没有找到匹配内容。试试更短的名字或效果关键词。');
    $('catalog-empty').hidden = results.length > 0; grid.hidden = results.length === 0;
    setText('catalog-page', `${this.state.page + 1} / ${pageCount}`);
    $<HTMLButtonElement>('catalog-prev').disabled = this.state.page === 0;
    $<HTMLButtonElement>('catalog-next').disabled = this.state.page >= pageCount - 1;
    this.renderDetail();
  }
  private revealDetail() {
    const detail = $('candidate-detail');
    const stacked = window.matchMedia('(max-width: 1180px)').matches;
    if (stacked) detail.focus({ preventScroll: true });
    detail.scrollIntoView({ block: stacked ? 'start' : 'nearest', behavior: 'auto' });
  }
  private selectedEntry(): Entry | undefined { return getCategoryOptions(this.category, this.loadout.petId).find(entry => entry.id === this.state.selected); }
  private renderDetail() {
    const emptyCatalog = getCategoryOptions(this.category, this.loadout.petId).length === 0;
    const entry = this.selectedEntry();
    const ids = getSelection(this.loadout, this.category);
    const selected = !!entry && ids.includes(entry.id);
    const target = this.replacement?.category === this.category ? this.replacement.index : null;
    const canAdd = this.descriptor.limit === 1 || ids.length < this.descriptor.limit || target !== null;
    $('candidate-detail').classList.toggle('is-empty', !entry);
    setText('detail-name', entry?.name ?? (emptyCatalog ? `暂无${this.descriptor.label}` : '点选图标查看详情'));
    const pet = this.category === 'pets' ? PETS.find(pet => pet.id === entry?.id) : undefined;
    const description = $('detail-description'); description.replaceChildren();
    if (pet) for (const effect of pet.effects) {
      const section = document.createElement('section'); section.className = 'detail-effect';
      const title = document.createElement('h4'); title.className = 'effect-name'; title.textContent = effect.name;
      const list = document.createElement('ul');
      for (const line of effect.lines) { const row = document.createElement('li'); appendEffectText(row, line); list.append(row); }
      section.append(title, list); description.append(section);
    } else {
      const paragraph = document.createElement('p');
      appendEffectText(paragraph, entry?.description ?? (emptyCatalog ? `当前版本尚未添加${this.descriptor.label}，选择小球即可准备开战。` : '点选内容查看效果与数值。'));
      description.append(paragraph);
    }
    statList($('detail-stats'), pet ? [['health', '生命', String(pet.hp)], ['attack', '碰撞伤害', String(pet.attack)], ['speed', '移速', `${pet.speed} / 秒`]] : []);
    $('detail-stats').hidden = !pet;
    $('candidate-detail').querySelector<HTMLElement>('.detail-actions')!.hidden = !entry;
    const action = $<HTMLButtonElement>('equip-candidate');
    action.disabled = this.locked || !entry || selected || !canAdd;
    action.textContent = selected ? this.category === 'pets' ? '已选择' : '已装备' : target !== null && this.descriptor.limit > 1 ? `替换槽位 ${target + 1}` : this.category === 'pets' ? '选择这颗小球' : this.descriptor.limit === 1 && ids.length ? `更换${this.descriptor.singular}` : `装备${this.descriptor.singular}`;
    const remove = $<HTMLButtonElement>('unequip-candidate'); remove.hidden = !selected || this.category === 'pets'; remove.disabled = this.locked;
    const hint = !canAdd && !selected ? `最多携带 ${this.descriptor.limit} 件，请先卸下或点选槽位替换。` : '';
    setText('detail-hint', hint); $('detail-hint').hidden = !entry || !hint;
  }
  private equip() {
    const entry = this.selectedEntry(); if (this.locked || !entry) return;
    const ids = [...getSelection(this.loadout, this.category)]; if (ids.includes(entry.id)) return;
    const target = this.replacement?.category === this.category ? this.replacement.index : null;
    if (this.descriptor.limit === 1) ids.splice(0, ids.length, entry.id);
    else if (target !== null) ids[target] = entry.id;
    else if (ids.length < this.descriptor.limit) ids.push(entry.id);
    else return;
    const next = withCategorySelection(this.loadout, this.category, ids);
    this.equippedCategory = this.category;
    const index = ids.indexOf(entry.id); this.states.get(this.category)!.equippedPage = Math.floor(index / this.descriptor.slotPageSize);
    this.replacement = null;
    this.onChange(next);
  }
  private unequip() {
    const entry = this.selectedEntry(); if (this.locked || !entry || this.category === 'pets') return;
    this.replacement = null;
    this.onChange(withCategorySelection(this.loadout, this.category, getSelection(this.loadout, this.category).filter(id => id !== entry.id)));
  }
}
