/* Kanora – script.js
   4 pages: Board, Tasks, Calendar, Analytics
   All data stored in Google Sheets via Apps Script */

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
const API_URL = "https://script.google.com/macros/s/AKfycbxZheUpFdfS5dDK_ZVi2QZyKklsmRPtgos5ua6Hzhmgu3UejNn_QHCjQLk8V_8xjLSRJQ/exec";

const COLUMNS     = ['todo', 'inprogress', 'done'];
const COL_LABELS  = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
const PRIO_ORDER  = { high: 0, medium: 1, low: 2 };
const VALID_COLS  = new Set(COLUMNS);
const VALID_PRIOS = new Set(['high', 'medium', 'low']);

let tasks = [];
let draggedId   = null;
let currentPage = 'board';

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

let chartDoughnut = null;
let chartPriority = null;
let chartBar      = null;

/* ═══════════════════════════════════════
   HELPERS  (defined first – used everywhere below)
═══════════════════════════════════════ */
function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cap(str) {
  if (typeof str !== 'string' || !str.length) return '';
  return str[0].toUpperCase() + str.slice(1);
}

function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(task) {
  if (!task.due || task.column === 'done') return false;
  return task.due < new Date().toISOString().slice(0, 10);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* Sanitise a raw task coming from Sheets (fields may be missing / null) */
function sanitiseTask(raw) {
  return {
    id:        (typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
    text:      typeof raw.text === 'string' ? raw.text : (raw.title || ''),
    column:    VALID_COLS.has(raw.column)    ? raw.column   : 'todo',
    priority:  VALID_PRIOS.has(raw.priority) ? raw.priority : 'medium',
    due:       raw.due || null,
    createdAt: raw.createdAt ? Number(raw.createdAt) : Date.now()
  };
}

/* ═══════════════════════════════════════
   PERSISTENCE – Google Sheets
═══════════════════════════════════════ */
async function loadTasks() {
  try {
    const res = await fetch(API_URL);
    const raw = await res.json();
    tasks = Array.isArray(raw) ? raw.map(sanitiseTask) : [];
  } catch (e) {
    console.error('loadTasks failed:', e);
    tasks = [];
  }
}

async function syncTasks() {
  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(tasks)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('SYNCED');
  } catch (err) {
    console.error('syncTasks failed:', err);
  }
}

/* ═══════════════════════════════════════
   INIT  (single entry point)
═══════════════════════════════════════ */
async function init() {
  await loadTasks();

  if (!tasks.length) {
    const today = new Date();
    const fmt   = d => d.toISOString().slice(0, 10);
    const add   = n => { const d = new Date(today); d.setDate(d.getDate() + n); return fmt(d); };
    tasks = [
      { id: uid(), text: 'Research existing task management tools',  column: 'todo',       priority: 'high',   due: add(3),     createdAt: Date.now() - 5000 },
      { id: uid(), text: 'Define project scope and requirements',    column: 'todo',       priority: 'medium', due: add(5),     createdAt: Date.now() - 4000 },
      { id: uid(), text: 'Build the Kanban board UI',                column: 'inprogress', priority: 'high',   due: add(1),     createdAt: Date.now() - 3000 },
      { id: uid(), text: 'Set up Google Sheets persistence',         column: 'inprogress', priority: 'medium', due: add(2),     createdAt: Date.now() - 2000 },
      { id: uid(), text: 'Write project introduction',               column: 'done',       priority: 'low',    due: fmt(today), createdAt: Date.now() - 1000 },
    ];
    await syncTasks();
  }

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  document.getElementById('task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTask();
  });

  navigateTo('board');
}

/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  if (page === 'board')     renderBoard();
  if (page === 'tasks')     renderTasksPage();
  if (page === 'calendar')  renderCalendar();
  if (page === 'analytics') renderAnalytics();
}

/* ═══════════════════════════════════════
   MODAL
═══════════════════════════════════════ */
function openModal(col) {
  document.getElementById('column-select').value   = col || 'todo';
  document.getElementById('priority-select').value = 'medium';
  document.getElementById('task-input').value      = '';
  document.getElementById('date-input').value      = '';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('task-input').focus(), 80);
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModalOnOverlay(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

/* ═══════════════════════════════════════
   ADD / DELETE / MOVE
═══════════════════════════════════════ */
async function addTask() {
  const input = document.getElementById('task-input');
  const text  = input.value.trim();
  if (!text) {
    input.style.borderColor = '#e16259';
    input.focus();
    setTimeout(() => input.style.borderColor = '', 1200);
    return;
  }
  tasks.push({
    id:        uid(),
    text,
    column:    document.getElementById('column-select').value,
    priority:  document.getElementById('priority-select').value,
    due:       document.getElementById('date-input').value || null,
    createdAt: Date.now()
  });
  await syncTasks();
  closeModal();
  if (currentPage === 'board')     renderBoard();
  if (currentPage === 'tasks')     renderTasksPage();
  if (currentPage === 'calendar')  renderCalendar();
  if (currentPage === 'analytics') renderAnalytics();
  updateSidebar();
}

async function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  await syncTasks();
  if (currentPage === 'board')     renderBoard();
  if (currentPage === 'tasks')     renderTasksPage();
  if (currentPage === 'calendar')  renderCalendar();
  if (currentPage === 'analytics') renderAnalytics();
  updateSidebar();
}

async function moveTask(id, direction) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const idx  = COLUMNS.indexOf(task.column);
  const next = idx + direction;
  if (next < 0 || next >= COLUMNS.length) return;
  task.column = COLUMNS[next];
  await syncTasks();
  renderBoard();
  updateSidebar();
}

/* ═══════════════════════════════════════
   SIDEBAR STATS
═══════════════════════════════════════ */
function updateSidebar() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.column === 'done').length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
  document.getElementById('sb-progress').style.width = pct + '%';
  document.getElementById('sb-pct').textContent      = `${pct}% complete`;
}

/* ═══════════════════════════════════════
   BOARD PAGE
═══════════════════════════════════════ */
function renderBoard() {
  COLUMNS.forEach(col => { document.getElementById(`cards-${col}`).innerHTML = ''; });
  tasks.forEach(task => renderCard(task));
  COLUMNS.forEach(col => {
    const count = tasks.filter(t => t.column === col).length;
    document.getElementById(`badge-${col}`).textContent = count;
    document.getElementById(`hdr-${col}`).textContent   = count;
  });
  COLUMNS.forEach(col => {
    const area = document.getElementById(`cards-${col}`);
    if (!area.children.length) area.innerHTML = emptyState();
  });
  updateSidebar();
}

function renderCard(task) {
  const area     = document.getElementById(`cards-${task.column}`);
  const colIndex = COLUMNS.indexOf(task.column);
  const prevBtn  = colIndex > 0
    ? `<button class="move-btn" onclick="moveTask('${task.id}',-1)">← ${COL_LABELS[COLUMNS[colIndex - 1]]}</button>` : '';
  const nextBtn  = colIndex < COLUMNS.length - 1
    ? `<button class="move-btn" onclick="moveTask('${task.id}',1)">${COL_LABELS[COLUMNS[colIndex + 1]]} →</button>` : '';

  const dueHtml = task.due ? `<p class="card-due ${isOverdue(task) ? 'overdue' : ''}">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    ${formatDate(task.due)}
  </p>` : '';

  const card = document.createElement('div');
  card.className  = 'task-card';
  card.draggable  = true;
  card.dataset.id = task.id;
  card.innerHTML  = `
  <div class="card-top">
    <div class="card-left">
      <span class="priority-badge prio-${task.priority}">${cap(task.priority)}</span>
    </div>
    <div class="card-right">
      <button class="card-edit" onclick="editTask('${task.id}')">Edit</button>
      <button class="card-delete" onclick="deleteTask('${task.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>
  <p class="card-text">${esc(task.text)}</p>
  ${dueHtml}
  <div class="card-moves">${prevBtn}${nextBtn}</div>`;
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend',   handleDragEnd);
  area.appendChild(card);
}

function emptyState() {
  return `<div class="empty-state">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
      <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>
    </svg>No tasks
  </div>`;
}

/* ═══════════════════════════════════════
   TASKS PAGE
═══════════════════════════════════════ */
function renderTasksPage() {
  const status   = document.getElementById('filter-status').value;
  const priority = document.getElementById('filter-priority').value;
  const sort     = document.getElementById('filter-sort').value;
  const search   = document.getElementById('filter-search').value.toLowerCase();

  let filtered = tasks.filter(t => {
    if (status   !== 'all' && t.column   !== status)   return false;
    if (priority !== 'all' && t.priority !== priority) return false;
    if (search && !t.text.toLowerCase().includes(search)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'newest')   return b.createdAt - a.createdAt;
    if (sort === 'oldest')   return a.createdAt - b.createdAt;
    if (sort === 'priority') return PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
    if (sort === 'status')   return COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column);
    return 0;
  });

  document.getElementById('tasks-count-tag').textContent = `${filtered.length} task${filtered.length !== 1 ? 's' : ''}`;

  const list = document.getElementById('task-list');
  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = `<div class="tasks-empty">No tasks match your filters.</div>`;
    return;
  }

  filtered.forEach(task => {
    const row    = document.createElement('div');
    row.className = 'task-row';
    const dueStr  = task.due ? `<span class="row-due ${isOverdue(task) ? 'overdue' : ''}">${formatDate(task.due)}</span>` : '';
    row.innerHTML = `
      <span class="row-status-dot" style="background:var(--${task.column === 'inprogress' ? 'inprogress' : task.column})"></span>
      <span class="row-text ${task.column === 'done' ? 'done-text' : ''}">${esc(task.text)}</span>
      ${dueStr}
      <span class="row-prio prio-${task.priority}">${cap(task.priority)}</span>
      <span class="row-col">${COL_LABELS[task.column]}</span>
      <button class="row-delete" onclick="deleteTask('${task.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
    list.appendChild(row);
  });
}

/* ═══════════════════════════════════════
   CALENDAR PAGE
═══════════════════════════════════════ */
function calNav(dir) { calMonth += dir; if (calMonth > 11) { calMonth = 0; calYear++; } if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calToday()  { calYear = new Date().getFullYear(); calMonth = new Date().getMonth(); renderCalendar(); }

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-title').textContent = `${months[calMonth]} ${calYear}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev  = new Date(calYear, calMonth, 0).getDate();
  const today       = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < 42; i++) {
    let day, month, year, isOther = false;
    if (i < firstDay) {
      day = daysInPrev - firstDay + 1 + i;
      month = calMonth - 1; year = calYear;
      if (month < 0) { month = 11; year--; }
      isOther = true;
    } else if (i - firstDay >= daysInMonth) {
      day = i - firstDay - daysInMonth + 1;
      month = calMonth + 1; year = calYear;
      if (month > 11) { month = 0; year++; }
      isOther = true;
    } else {
      day = i - firstDay + 1;
      month = calMonth; year = calYear;
    }

    const dateStr  = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday  = dateStr === today;
    const dayTasks = tasks.filter(t => t.due === dateStr);

    const cell     = document.createElement('div');
    cell.className = `cal-cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}`;

    let chips = '';
    dayTasks.slice(0, 3).forEach(t => {
      chips += `<div class="cal-task-chip chip-${t.column}" title="${esc(t.text)}">${esc(t.text)}</div>`;
    });
    if (dayTasks.length > 3) chips += `<div class="cal-more">+${dayTasks.length - 3} more</div>`;

    cell.innerHTML = `<div class="cal-day-num">${day}</div>${chips}`;
    grid.appendChild(cell);
  }
}

/* ═══════════════════════════════════════
   ANALYTICS PAGE
═══════════════════════════════════════ */
function renderAnalytics() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.column === 'done').length;
  const prog  = tasks.filter(t => t.column === 'inprogress').length;
  const todo  = tasks.filter(t => t.column === 'todo').length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  document.getElementById('an-total').textContent = total;
  document.getElementById('an-done').textContent  = done;
  document.getElementById('an-prog').textContent  = prog;
  document.getElementById('an-pct').textContent   = pct + '%';

  destroyChart('chartDoughnut');
  chartDoughnut = new Chart(document.getElementById('chart-doughnut'), {
    type: 'doughnut',
    data: {
      labels: ['To Do', 'In Progress', 'Done'],
      datasets: [{ data: [todo, prog, done], backgroundColor: ['#fde8e6','#dbeeff','#e0f3e8'], borderColor: ['#e16259','#4a90d9','#5ba37a'], borderWidth: 2 }]
    },
    options: { cutout: '68%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, family: 'Inter' } } } }, responsive: true, maintainAspectRatio: false }
  });

  const pHigh   = tasks.filter(t => t.priority === 'high').length;
  const pMedium = tasks.filter(t => t.priority === 'medium').length;
  const pLow    = tasks.filter(t => t.priority === 'low').length;

  destroyChart('chartPriority');
  chartPriority = new Chart(document.getElementById('chart-priority'), {
    type: 'bar',
    data: {
      labels: ['High', 'Medium', 'Low'],
      datasets: [{ data: [pHigh, pMedium, pLow], backgroundColor: ['#fde8e6','#fff3db','#e0f3e8'], borderColor: ['#e16259','#e0a020','#5ba37a'], borderWidth: 1.5, borderRadius: 6 }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.05)' } }, x: { ticks: { font: { size: 11 } }, grid: { display: false } } }, responsive: true, maintainAspectRatio: false }
  });

  destroyChart('chartBar');
  chartBar = new Chart(document.getElementById('chart-bar'), {
    type: 'bar',
    data: {
      labels: ['To Do', 'In Progress', 'Done'],
      datasets: [
        { label: 'High',   data: [tasks.filter(t=>t.column==='todo'&&t.priority==='high').length, tasks.filter(t=>t.column==='inprogress'&&t.priority==='high').length, tasks.filter(t=>t.column==='done'&&t.priority==='high').length], backgroundColor: '#fde8e6', borderColor: '#e16259', borderWidth: 1.5, borderRadius: 5 },
        { label: 'Medium', data: [tasks.filter(t=>t.column==='todo'&&t.priority==='medium').length, tasks.filter(t=>t.column==='inprogress'&&t.priority==='medium').length, tasks.filter(t=>t.column==='done'&&t.priority==='medium').length], backgroundColor: '#fff3db', borderColor: '#e0a020', borderWidth: 1.5, borderRadius: 5 },
        { label: 'Low',    data: [tasks.filter(t=>t.column==='todo'&&t.priority==='low').length, tasks.filter(t=>t.column==='inprogress'&&t.priority==='low').length, tasks.filter(t=>t.column==='done'&&t.priority==='low').length], backgroundColor: '#e0f3e8', borderColor: '#5ba37a', borderWidth: 1.5, borderRadius: 5 }
      ]
    },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, family: 'Inter' } } } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.05)' } }, x: { ticks: { font: { size: 11 } }, grid: { display: false } } }, responsive: true, maintainAspectRatio: false }
  });

  const highList  = document.getElementById('an-high-list');
  const highTasks = tasks.filter(t => t.priority === 'high');
  highList.innerHTML = highTasks.length
    ? highTasks.map(t => `
      <div class="an-high-item">
        <span class="col-dot dot-${t.column === 'inprogress' ? 'inprogress' : t.column}"></span>
        <span class="an-high-text ${t.column === 'done' ? 'done-text' : ''}">${esc(t.text)}</span>
        <span class="row-col">${COL_LABELS[t.column]}</span>
        ${t.due ? `<span class="row-due ${isOverdue(t) ? 'overdue' : ''}">${formatDate(t.due)}</span>` : ''}
      </div>`).join('')
    : `<p style="color:var(--text-3);font-size:13px;padding:12px 0;">No high priority tasks.</p>`;
}

function destroyChart(name) {
  const map = { chartDoughnut, chartPriority, chartBar };
  if (map[name]) { map[name].destroy(); }
}

/* ═══════════════════════════════════════
   DRAG & DROP
═══════════════════════════════════════ */
function handleDragStart(e) {
  draggedId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedId);
}
function handleDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
  draggedId = null;
}
function handleDragOver(e) {
  e.preventDefault();
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
async function handleDrop(e, targetCol) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain') || draggedId;
  if (!id) return;
  const task = tasks.find(t => t.id === id);
  if (task && task.column !== targetCol) {
    task.column = targetCol;
    await syncTasks();
    renderBoard();
    updateSidebar();
  }
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
}

/* ═══════════════════════════════════════
   EDIT MODAL
═══════════════════════════════════════ */
let editingTaskId = null;

function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('edit-task-input').value = task.text;
  document.getElementById('edit-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('edit-task-input').focus(), 100);
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('open');
  editingTaskId = null;
}

function closeEditModalOnOverlay(e) {
  if (e.target.id === 'edit-modal-overlay') closeEditModal();
}

async function saveEditTask() {
  const input = document.getElementById('edit-task-input');
  const text  = input.value.trim();
  if (!text) return;
  const task = tasks.find(t => t.id === editingTaskId);
  if (!task) return;
  task.text = text;
  await syncTasks();
  closeEditModal();
  if (currentPage === 'board')     renderBoard();
  if (currentPage === 'tasks')     renderTasksPage();
  if (currentPage === 'calendar')  renderCalendar();
  if (currentPage === 'analytics') renderAnalytics();
}

/* ═══════════════════════════════════════
   BOOT  – single DOMContentLoaded, single init()
═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => init());
