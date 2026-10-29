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
  charge: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M13 5l-5 8h4l-1 6 6-9h-4Z',
  renew: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 7v10 M7 12h10',
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
function statList(element: HTMLElement, rows: [string, string][]) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const group = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; group.append(dt, dd); element.append(group);
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
    statList($('pet-stats'), [['生命', String(pet.hp)], ['碰撞伤害', String(pet.attack)], ['移速', `${pet.speed} / 秒`]]);
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
    const container = $('equipped-slots'); container.replaceChildren();
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
    setText('detail-category', `${this.descriptor.singular}详情`);
    $('candidate-detail').classList.toggle('is-empty', !entry);
    $('detail-category').hidden = !entry;
    setText('detail-name', entry?.name ?? (emptyCatalog ? `暂无${this.descriptor.label}` : '点选图标查看详情'));
    setText('detail-description', entry?.description ?? (emptyCatalog ? `当前版本尚未添加${this.descriptor.label}，选择小球即可准备开战。` : '在这里查看名称、完整效果，再决定是否选用。'));
    const pet = this.category === 'pets' ? PETS.find(pet => pet.id === entry?.id) : undefined;
    statList($('detail-stats'), pet ? [['生命', String(pet.hp)], ['碰撞伤害', String(pet.attack)], ['移速', `${pet.speed} / 秒`]] : []);
    $('detail-stats').hidden = !pet;
    const note = this.category === 'pets' ? '固有效果随小球自动生效，无需占用技能或特性槽位。' : this.category === 'skills' ? `最多携带 ${this.descriptor.limit} 个当前小球的技能，也可以留空。` : this.category === 'traits' ? `同时最多启用 ${this.descriptor.limit} 个当前小球的特性，也可以留空。` : this.category === 'items' ? '道具槽位可以留空，具体效果以内容说明为准。' : '';
    setText('detail-note', note); $('detail-note').hidden = !entry || !note;
    $('candidate-detail').querySelector<HTMLElement>('.detail-actions')!.hidden = !entry;
    $('detail-hint').hidden = !entry;
    const action = $<HTMLButtonElement>('equip-candidate');
    action.disabled = this.locked || !entry || selected || !canAdd;
    action.textContent = selected ? this.category === 'pets' ? '已选择' : '已装备' : target !== null && this.descriptor.limit > 1 ? `替换槽位 ${target + 1}` : this.category === 'pets' ? '选择这颗小球' : this.descriptor.limit === 1 && ids.length ? `更换${this.descriptor.singular}` : `装备${this.descriptor.singular}`;
    const remove = $<HTMLButtonElement>('unequip-candidate'); remove.hidden = !selected || this.category === 'pets'; remove.disabled = this.locked;
    setText('detail-hint', this.locked ? '当前无法修改搭配，仍可浏览内容。' : !canAdd && !selected ? '槽位已满，请在已装备区域点选一个槽位进行替换。' : selected ? '已加入出战搭配。' : '查看详情不会改变搭配，点击装备后生效。');
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
