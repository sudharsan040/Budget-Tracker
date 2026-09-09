// Fetches this user's Expenses + Budgets from their own spreadsheet via the
// Sheets API, then renders the Home page: stat tiles, category bars, trend
// chart, budget progress, comparison table, and the transactions table.

const PALETTE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
let allRows = [];
let budgets = {}; // category -> monthly limit
let categoryColor = {};
let spreadsheetId = null;
let accessToken = null;

function fmt(n) { return '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN'); }
function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function prevMonthKey(monthK) {
  const [y, m] = monthK.split('-').map(Number);
  return monthKey(new Date(y, m - 2, 1));
}

async function readValues(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) throw new Error('Sheets read failed: ' + res.status);
  const data = await res.json();
  return data.values || [];
}

async function loadAll() {
  const [expenseRows, budgetRows] = await Promise.all([
    readValues('Expenses!A2:E100000'),
    readValues('Budgets!A2:B1000'),
  ]);

  allRows = expenseRows
    .filter(r => r[0])
    .map(r => ({
      dateObj: new Date(r[0]),
      amount: Number(r[1]) || 0,
      category: r[2] || 'Uncategorized',
      tag: r[3] || '',
      source: r[4] || '',
    }))
    .sort((a, b) => a.dateObj - b.dateObj);

  budgets = {};
  budgetRows.forEach(r => { if (r[0]) budgets[r[0]] = Number(r[1]) || 0; });

  assignCategoryColors();
}

function assignCategoryColors() {
  categoryColor = {};
  let slot = 0;
  allRows.forEach(r => {
    const cat = r.category;
    if (cat.toLowerCase() === 'other' || categoryColor[cat]) return;
    if (slot < PALETTE.length) { categoryColor[cat] = PALETTE[slot]; slot++; }
    else categoryColor[cat] = 'other';
  });
  if (!categoryColor['Other']) categoryColor['Other'] = 'other';
}
function colorFor(cat) { return 'var(--' + (categoryColor[cat] || 'other') + ')'; }

function totalsByCategory(monthK) {
  const map = {};
  allRows.filter(r => monthKey(r.dateObj) === monthK).forEach(r => {
    map[r.category] = (map[r.category] || 0) + r.amount;
  });
  return map;
}

function buildMonthSelector() {
  const sel = document.getElementById('monthSelect');
  const months = [...new Set(allRows.map(r => monthKey(r.dateObj)))].sort().reverse();
  const current = monthKey(new Date());
  if (!months.includes(current)) months.unshift(current);
  sel.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  sel.value = months.includes(current) ? current : months[0];
  sel.addEventListener('change', render);
}

function render() {
  const monthK = document.getElementById('monthSelect').value;
  const prevK = prevMonthKey(monthK);
  const thisTotals = totalsByCategory(monthK);
  const prevTotals = totalsByCategory(prevK);
  const thisSum = Object.values(thisTotals).reduce((a, b) => a + b, 0);
  const prevSum = Object.values(prevTotals).reduce((a, b) => a + b, 0);
  const allSum = allRows.reduce((a, r) => a + r.amount, 0);

  document.getElementById('tileMonth').textContent = fmt(thisSum);
  document.getElementById('tilePrev').textContent = fmt(prevSum);
  document.getElementById('tileAll').textContent = fmt(allSum);
  const deltaEl = document.getElementById('tileDelta');
  if (prevSum > 0) {
    const pct = ((thisSum - prevSum) / prevSum) * 100;
    deltaEl.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%';
    deltaEl.className = 'value delta ' + (pct >= 0 ? 'up' : 'down');
  } else {
    deltaEl.textContent = '–'; deltaEl.className = 'value delta';
  }

  document.getElementById('catMonthLabel').textContent = monthLabel(monthK);
  document.getElementById('trendMonthLabel').textContent = monthLabel(monthK);
  document.getElementById('budgetMonthLabel').textContent = monthLabel(monthK);

  renderCategoryBars(thisTotals);
  renderBudgetProgress(thisTotals);
  renderTrend(monthK);
  renderCompareTable(thisTotals, prevTotals);
  populateCategoryFilter();
  renderTransactions(monthK);
}

function renderCategoryBars(totals) {
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById('catBars');
  const legend = document.getElementById('catLegend');
  if (!entries.length) { container.innerHTML = '<div class="empty">No expenses this month.</div>'; legend.innerHTML = ''; return; }
  const max = Math.max(...entries.map(e => e[1]));
  container.innerHTML = entries.map(([cat, amt]) => `
    <div class="bar-row">
      <div class="bar-label">${cat}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(amt / max * 100).toFixed(1)}%; background:${colorFor(cat)}"></div></div>
      <div class="bar-value">${fmt(amt)}</div>
    </div>`).join('');
  legend.innerHTML = entries.map(([cat]) =>
    `<span><span class="dot" style="background:${colorFor(cat)}"></span>${cat}</span>`).join('');
}

function renderBudgetProgress(totals) {
  const container = document.getElementById('budgetBars');
  const cats = Object.keys(budgets).filter(c => budgets[c] > 0);
  if (!cats.length) {
    container.innerHTML = '<div class="empty">No budgets set yet — add them from Settings.</div>';
    return;
  }
  container.innerHTML = cats.map(cat => {
    const spent = totals[cat] || 0;
    const limit = budgets[cat];
    const pct = Math.min((spent / limit) * 100, 100);
    let status = 'good', icon = '✓', label = 'On track';
    if (spent > limit) { status = 'critical'; icon = '✕'; label = 'Over budget'; }
    else if (spent / limit >= 0.8) { status = 'warning'; icon = '⚠'; label = 'Near limit'; }
    return `
      <div class="budget-row">
        <div class="budget-head">
          <span><span class="dot" style="background:${colorFor(cat)}"></span>${cat}</span>
          <span class="budget-amt">${fmt(spent)} / ${fmt(limit)}</span>
        </div>
        <div class="bar-track" style="height:10px">
          <div class="bar-fill" style="width:${pct}%; height:10px; background:var(--status-${status})"></div>
        </div>
        <div class="status-label status-${status}">${icon} ${label}</div>
      </div>`;
  }).join('');
}

function renderTrend(monthK) {
  const [y, m] = monthK.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrentMonth = monthK === monthKey(new Date());
  const upTo = isCurrentMonth ? new Date().getDate() : daysInMonth;
  const daily = new Array(daysInMonth + 1).fill(0);
  allRows.filter(r => monthKey(r.dateObj) === monthK).forEach(r => { daily[r.dateObj.getDate()] += r.amount; });

  const svg = document.getElementById('trendSvg');
  const W = 640, H = 200, padL = 40, padR = 10, padT = 10, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...daily.slice(1, upTo + 1), 1);

  const points = [];
  for (let d = 1; d <= upTo; d++) {
    const x = padL + ((d - 1) / Math.max(upTo - 1, 1)) * plotW;
    const y2 = padT + plotH - (daily[d] / max) * plotH;
    points.push([x, y2, d, daily[d]]);
  }

  let gridLines = '';
  for (let i = 0; i <= 3; i++) {
    const gy = padT + (plotH / 3) * i;
    gridLines += `<line class="gridline" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"/>`;
  }
  let axisLabels = '';
  for (let d = 1; d <= upTo; d += Math.ceil(upTo / 6)) {
    const x = padL + ((d - 1) / Math.max(upTo - 1, 1)) * plotW;
    axisLabels += `<text x="${x}" y="${H - 6}" text-anchor="middle">${d}</text>`;
  }

  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

  svg.innerHTML = `
    ${gridLines}
    <line class="axis" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>
    <path class="trend-line" d="${path}"/>
    ${axisLabels}
    <rect id="hoverCatcher" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>
    <line id="hoverLine" class="hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" style="display:none"/>
    <circle id="hoverDot" class="trend-dot" r="4" style="display:none"/>
  `;

  const catcher = document.getElementById('hoverCatcher');
  const hoverLine = document.getElementById('hoverLine');
  const hoverDot = document.getElementById('hoverDot');
  const tooltip = document.getElementById('tooltip');

  catcher.addEventListener('mousemove', (evt) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (evt.clientX - rect.left) * scaleX;
    let nearest = points[0];
    for (const p of points) if (Math.abs(p[0] - mx) < Math.abs(nearest[0] - mx)) nearest = p;
    hoverLine.setAttribute('x1', nearest[0]); hoverLine.setAttribute('x2', nearest[0]); hoverLine.style.display = '';
    hoverDot.setAttribute('cx', nearest[0]); hoverDot.setAttribute('cy', nearest[1]); hoverDot.style.display = '';
    const rect2 = svg.parentElement.getBoundingClientRect();
    tooltip.style.left = ((nearest[0] / W) * rect.width) + 'px';
    tooltip.style.top = ((nearest[1] / H) * rect.height) + 'px';
    tooltip.textContent = monthLabel(monthK).split(' ')[0] + ' ' + nearest[2] + ' — ' + fmt(nearest[3]);
    tooltip.style.opacity = '1';
  });
  catcher.addEventListener('mouseleave', () => {
    hoverLine.style.display = 'none'; hoverDot.style.display = 'none'; tooltip.style.opacity = '0';
  });
}

function renderCompareTable(thisTotals, prevTotals) {
  const cats = [...new Set([...Object.keys(thisTotals), ...Object.keys(prevTotals)])]
    .sort((a, b) => (thisTotals[b] || 0) - (thisTotals[a] || 0));
  const tbody = document.querySelector('#compareTable tbody');
  if (!cats.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>'; return; }
  tbody.innerHTML = cats.map(cat => {
    const cur = thisTotals[cat] || 0, prev = prevTotals[cat] || 0;
    let deltaTxt = '–', cls = '';
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100;
      deltaTxt = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '%';
      cls = pct >= 0 ? 'up' : 'down';
    } else if (cur > 0) { deltaTxt = 'new'; }
    return `<tr>
      <td><span class="dot" style="background:${colorFor(cat)}"></span>${cat}</td>
      <td class="amount">${fmt(cur)}</td>
      <td class="amount">${fmt(prev)}</td>
      <td class="amount ${cls}">${deltaTxt}</td>
    </tr>`;
  }).join('');
}

function populateCategoryFilter() {
  const sel = document.getElementById('filterCategory');
  const current = sel.value;
  const cats = [...new Set(allRows.map(r => r.category))].sort();
  sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = current;
}

function renderTransactions() {
  const cat = document.getElementById('filterCategory').value;
  const range = document.getElementById('filterRange').value;
  const search = document.getElementById('filterSearch').value.trim().toLowerCase();
  const monthK = document.getElementById('monthSelect').value;
  const now = new Date();
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);

  let rows = [...allRows].reverse();
  if (cat) rows = rows.filter(r => r.category === cat);
  if (range === 'month') rows = rows.filter(r => monthKey(r.dateObj) === monthK);
  else if (range === '30d') rows = rows.filter(r => r.dateObj >= cutoff30);
  if (search) rows = rows.filter(r => r.tag.toLowerCase().includes(search) || r.category.toLowerCase().includes(search));

  const tbody = document.querySelector('#txTable tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No transactions match.</td></tr>'; return; }
  tbody.innerHTML = rows.slice(0, 300).map(r => `
    <tr>
      <td>${r.dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td><span class="dot" style="background:${colorFor(r.category)}"></span>${r.category}</td>
      <td>${r.tag}</td>
      <td class="amount">${fmt(r.amount)}</td>
    </tr>`).join('');
}

['filterCategory', 'filterRange', 'filterSearch'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderTransactions);
});

export async function initDashboard(token, sheetId) {
  accessToken = token;
  spreadsheetId = sheetId;
  document.getElementById('dashStatus').textContent = 'Loading your data…';
  await loadAll();
  buildMonthSelector();
  render();
  document.getElementById('dashStatus').textContent = '';
  document.getElementById('dashboard').style.display = 'block';
}

export async function refreshDashboard() {
  document.getElementById('dashStatus').textContent = 'Refreshing…';
  await loadAll();
  render();
  document.getElementById('dashStatus').textContent = '';
}
