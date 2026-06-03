/* ── main.js ─────────────────────────────────────────── */

let _currentSymbol = null;
let _currentPeriod = '3mo';
let _activePage    = 'recs';   // mobile active tab

// ── Init ──────────────────────────────────────────────────
async function init() {
  updateClock();
  setInterval(updateClock, 60_000);

  const today = new Date();
  document.getElementById('recDate').textContent =
    `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;

  // Mobile default: show recs tab
  if (window.innerWidth < 1024) {
    _initMobileDefault();
  }

  await Promise.all([
    loadIndices(),
    loadNews(),
    loadRecommendations(),
    loadInstitutional(),
  ]);

  setInterval(() => { loadIndices(); loadNews(); }, 30 * 60_000);
}

function updateClock() {
  const now = new Date();
  document.getElementById('updateTime').textContent =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ── Mobile Tab Switching ──────────────────────────────────
function _initMobileDefault() {
  // Ensure recs is visible by default
  document.getElementById('pageRecs').style.display = 'flex';
  document.getElementById('pageChart').classList.remove('m-on');
  document.getElementById('pageNews').classList.remove('m-on');
  document.getElementById('pageInst').classList.remove('m-on');
}

function showPage(name, btn) {
  if (window.innerWidth >= 1024) return;  // desktop shows everything

  _activePage = name;

  const recs  = document.getElementById('pageRecs');
  const chart = document.getElementById('pageChart');
  const news  = document.getElementById('pageNews');
  const inst  = document.getElementById('pageInst');

  // Reset all
  recs.style.display  = 'none';
  chart.classList.remove('m-on');
  news.classList.remove('m-on');
  inst.classList.remove('m-on');

  if (name === 'recs') {
    recs.style.display = 'flex';
  } else if (name === 'chart') {
    chart.classList.add('m-on');
    // Re-render chart after becoming visible
    setTimeout(() => {
      if (_currentSymbol) loadKline(_currentSymbol, _currentPeriod);
    }, 80);
  } else if (name === 'news') {
    news.classList.add('m-on');
  } else if (name === 'inst') {
    inst.classList.add('m-on');
  }

  // Update nav highlight
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Refresh ───────────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  btn.style.animation = 'spin .6s linear infinite';

  await Promise.all([loadIndices(), loadNews(), loadInstitutional()]);
  if (_currentSymbol) await loadKline(_currentSymbol, _currentPeriod);

  btn.disabled = false;
  btn.style.animation = '';
  updateClock();
}

// ── Recommendations ───────────────────────────────────────
async function loadRecommendations() {
  try {
    const res  = await fetch(`${BASE}/api/recommendations`);
    const json = await res.json();
    const stocks = json.data || [];

    if (!stocks.length) {
      document.getElementById('recCards').innerHTML =
        '<div class="empty-state"><span>今日無符合條件的回檔股</span><small>市場偏強，無明顯修正機會</small></div>';
      return;
    }

    renderRecCards(stocks);
    if (stocks.length > 0) selectStock(stocks[0].symbol);

  } catch {
    document.getElementById('recCards').innerHTML =
      `<div class="empty-state">
        <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>後端伺服器未回應</span><small>請確認已啟動 start.bat</small>
      </div>`;
  }
}

function renderRecCards(stocks) {
  document.getElementById('recCards').innerHTML = stocks.map(buildCard).join('');
}

function buildCard(s) {
  const score = s.score || 0;
  const strats = s.strategies || [];

  // Strategy indicator tags
  const stratTags = [
    strats.includes('低檔量增') ? '<span class="tag blue">📊量增</span>' : '',
    strats.includes('法人買超') ? '<span class="tag bull">🏦法人</span>' : '',
    strats.some(t => t.startsWith('題材:')) ? '<span class="tag purple">🔬題材</span>' : '',
  ].filter(Boolean).join('');

  const rsiCls  = s.rsi < 40 ? 'bull' : s.rsi > 62 ? 'bear' : '';
  const macdCls = ['黃金交叉','即將交叉','多頭'].includes(s.macd_status) ? 'bull' : '';
  const reason  = (s.reasons || []).slice(0,2).join(' · ') || '等待確認訊號';

  return `<div class="stock-card" id="card-${s.symbol}" onclick="selectStock('${s.symbol}')">
    <div class="risk-dot ${s.risk || 'medium'}" title="風險：${riskLabel(s.risk)}"></div>
    <div class="card-sym">${s.symbol}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-pullback">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 12 14 8 10 4 14"/>
      </svg>
      回撤 ${s.pullback_pct?.toFixed(1) ?? '--'}%
    </div>
    <div class="score-bar">
      <div class="score-label"><span>分析分數</span><span>${score}</span></div>
      <div class="score-track"><div class="score-fill" style="width:${score}%"></div></div>
    </div>
    <div class="card-tags">
      ${stratTags}
      ${s.rsi ? `<span class="tag ${rsiCls}">RSI ${s.rsi.toFixed(0)}</span>` : ''}
      ${s.macd_status ? `<span class="tag ${macdCls}">${escHtml(s.macd_status)}</span>` : ''}
    </div>
    <div class="card-reason">${escHtml(reason)}</div>
  </div>`;
}

function riskLabel(r) { return { low:'低', medium:'中', high:'高' }[r] || '中'; }

// ── Select Stock ──────────────────────────────────────────
async function selectStock(symbol) {
  if (_currentSymbol) {
    document.getElementById(`card-${_currentSymbol}`)?.classList.remove('active');
  }
  _currentSymbol = symbol;
  document.getElementById(`card-${symbol}`)?.classList.add('active');
  document.getElementById(`card-${symbol}`)?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });

  await loadKline(symbol, _currentPeriod);
}

async function changePeriod(period, btn) {
  _currentPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
  if (_currentSymbol) await loadKline(_currentSymbol, _currentPeriod);
}

// ── Utils ─────────────────────────────────────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
