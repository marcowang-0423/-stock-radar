/* ── main.js ─────────────────────────────────────────── */

let _currentSymbol = null;
let _currentPeriod = '3mo';
let _activePage    = 'recs';
let _recData       = [];

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

  loadScreens(); // fire in background — don't await

  await Promise.all([
    loadIndices(),
    loadNews(),
    loadRecommendations(),
    loadInstitutional(),
  ]);

  setInterval(() => { loadIndices(); loadNews(); }, 5 * 60_000);
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
    setTimeout(() => {
      if (_currentSymbol) loadKline(_currentSymbol, _currentPeriod);
    }, 150);
  } else if (name === 'news') {
    news.classList.add('m-on');
  } else if (name === 'inst') {
    inst.classList.add('m-on');
    setTimeout(() => {
      if (_instData && !_instData.error) {
        _renderInstChart(_instData);
      }
    }, 300);
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

    _recData = stocks;
    renderRecCards(stocks);
    if (stocks.length > 0) {
      _currentSymbol = stocks[0].symbol;
      document.getElementById(`card-${stocks[0].symbol}`)?.classList.add('active');
      loadKline(stocks[0].symbol, _currentPeriod);
    }

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

  const stratTags = [
    strats.includes('縮量回檔')   ? '<span class="tag blue">📉縮量</span>'  : '',
    strats.includes('低檔量增')   ? '<span class="tag blue">📊量增</span>'  : '',
    strats.includes('法人買超')   ? '<span class="tag bull">🏦法人</span>'  : '',
    strats.includes('淺回測')     ? '<span class="tag gold">📐淺回測</span>': '',
    strats.includes('均線守支撐') ? '<span class="tag green">📏均線</span>' : '',
    strats.some(t => t.startsWith('題材:')) ? '<span class="tag purple">🔬題材</span>' : '',
  ].filter(Boolean).join('');

  const rsiCls  = s.rsi < 40 ? 'bull' : s.rsi > 62 ? 'bear' : '';
  const macdCls = ['黃金交叉','即將交叉','多頭'].includes(s.macd_status) ? 'bull' : '';
  const reason  = (s.reasons || []).slice(0,2).join(' · ') || '等待確認訊號';

  return `<div class="stock-card" id="card-${s.symbol}" onclick="openDetail('${s.symbol}')">
    <div class="risk-dot ${s.risk || 'medium'}" title="風險：${riskLabel(s.risk)}"></div>
    <div class="card-sym">${s.symbol}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-pullback">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 12 14 8 10 4 14"/>
      </svg>
      回檔 ${s.pullback_pct?.toFixed(1) ?? '--'}%
      ${s.rally_pct != null ? `<span class="card-rally">↑飆漲${s.rally_pct.toFixed(0)}%</span>` : ''}
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

// ── Select Stock (internal, no modal) ────────────────────
function selectStock(symbol) {
  if (_currentSymbol) {
    document.getElementById(`card-${_currentSymbol}`)?.classList.remove('active');
  }
  _currentSymbol = symbol;
  document.getElementById(`card-${symbol}`)?.classList.add('active');
  document.getElementById(`card-${symbol}`)?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
  loadKline(symbol, _currentPeriod);
}

// ── Detail Modal ──────────────────────────────────────────
function openDetail(symbol) {
  selectStock(symbol);
  const s = _recData.find(r => r.symbol === symbol);
  if (!s) return;

  // Reset label that openScreenDetail may have changed
  document.getElementById('dtPullbackLabel').textContent = '回撤';
  document.getElementById('dtPullback').className = 'ps-val dn';

  document.getElementById('dtSym').textContent  = s.symbol;
  document.getElementById('dtName').textContent = s.name || s.symbol;
  const themeEl = document.getElementById('dtTheme');
  themeEl.textContent = s.theme || '';
  themeEl.style.display = s.theme ? 'inline-block' : 'none';
  document.getElementById('dtPrice').textContent    = s.current?.toFixed(2) ?? '--';
  document.getElementById('dtPullback').textContent = `▼${s.pullback_pct?.toFixed(1) ?? '--'}%`;
  document.getElementById('dtScore').textContent    = s.score ?? '--';

  const riskMap = { low: ['低風險', 'low-risk'], medium: ['中風險', 'med-risk'], high: ['高風險', 'high-risk'] };
  const [rLabel, rCls] = riskMap[s.risk] || ['中風險', 'med-risk'];
  const rEl = document.getElementById('dtRisk');
  rEl.textContent = rLabel;
  rEl.className = `ps-val ${rCls}`;

  const reasons = s.reasons || [];
  document.getElementById('dtReasons').innerHTML = reasons.length
    ? reasons.map(r => `<li>${escHtml(r)}</li>`).join('')
    : '<li>等待更多技術確認訊號</li>';

  const rsiLabel = s.rsi < 30 ? '超賣區' : s.rsi < 50 ? '低檔整理' : s.rsi < 65 ? '中性' : '偏高';
  const rsiCls   = s.rsi < 50 ? 'accent' : 'up';
  const macdCls  = ['黃金交叉','即將交叉','多頭'].includes(s.macd_status) ? 'gold' : '';
  const volCls   = s.vol_ratio >= 1.4 ? 'up' : (s.vol_ratio < 0.75 ? 'accent' : '');
  const ma20sign = (s.sma20_pct ?? 0) >= 0 ? '+' : '';
  const fib      = s.fib_ratio ?? null;
  const fibLabel = fib == null ? '--' : fib <= 0.382 ? '極淺，主力護盤' : fib <= 0.5 ? '未逾一半，多頭穩' : fib <= 0.618 ? '黃金分割位' : '深回測';
  const fibCls   = fib == null ? '' : fib <= 0.382 ? 'accent' : fib <= 0.5 ? 'up' : fib <= 0.618 ? 'gold' : 'dn';
  document.getElementById('dtIndicators').innerHTML = `
    <div class="ind-item"><div class="ind-label">RSI (14)</div><div class="ind-val ${rsiCls}">${s.rsi?.toFixed(1) ?? '--'} · ${rsiLabel}</div></div>
    <div class="ind-item"><div class="ind-label">MACD 狀態</div><div class="ind-val ${macdCls}">${escHtml(s.macd_status || '--')}</div></div>
    <div class="ind-item"><div class="ind-label">回檔幅度</div><div class="ind-val dn">▼ ${s.pullback_pct?.toFixed(1) ?? '--'}%</div></div>
    <div class="ind-item"><div class="ind-label">飆漲幅度</div><div class="ind-val up">▲ ${s.rally_pct?.toFixed(1) ?? '--'}%</div></div>
    <div class="ind-item"><div class="ind-label">Fib 回測比</div><div class="ind-val ${fibCls}">${fib != null ? (fib*100).toFixed(0)+'%' : '--'} · ${fibLabel}</div></div>
    <div class="ind-item"><div class="ind-label">量能比 (5/30日)</div><div class="ind-val ${volCls}">${s.vol_ratio?.toFixed(2) ?? '--'} x</div></div>
    <div class="ind-item"><div class="ind-label">vs 月線 (MA21)</div><div class="ind-val ${(s.sma20_pct ?? 0) >= 0 ? 'up' : 'dn'}">${ma20sign}${s.sma20_pct?.toFixed(1) ?? '--'}%</div></div>
    <div class="ind-item"><div class="ind-label">飆高點</div><div class="ind-val">${s.high_3m?.toFixed(2) ?? '--'}</div></div>`;

  const strats = s.strategies || [];
  const chips = [];
  if (strats.includes('縮量回檔'))   chips.push(`<span class="strat-chip vol">📉 縮量回檔</span>`);
  if (strats.includes('低檔量增'))   chips.push(`<span class="strat-chip vol">📊 低檔量增</span>`);
  if (strats.includes('淺回測'))     chips.push(`<span class="strat-chip fib">📐 Fib 淺回測</span>`);
  if (strats.includes('均線守支撐')) chips.push(`<span class="strat-chip ma">📏 均線守支撐</span>`);
  if (strats.includes('法人買超'))   chips.push(`<span class="strat-chip inst">🏦 三大法人買超</span>`);
  if (strats.some(t => t.startsWith('題材:'))) {
    const t = strats.find(t => t.startsWith('題材:'))?.replace('題材:','') || '';
    chips.push(`<span class="strat-chip theme">🔬 ${escHtml(t)}</span>`);
  }
  if (['黃金交叉','即將交叉'].includes(s.macd_status)) chips.push(`<span class="strat-chip macd">📈 MACD ${escHtml(s.macd_status)}</span>`);
  const stratSec = document.getElementById('dtStratSection');
  if (chips.length) {
    document.getElementById('dtStrats').innerHTML = chips.join('');
    stratSec.style.display = '';
  } else {
    stratSec.style.display = 'none';
  }

  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function gotoKline() {
  closeDetail();
  if (window.innerWidth < 1024) {
    showPage('chart', document.querySelector('.bnav-btn[data-page="chart"]'));
  }
}

async function changePeriod(period, btn) {
  _currentPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
  if (_currentSymbol) await loadKline(_currentSymbol, _currentPeriod);
}

// ── Screen Tabs ───────────────────────────────────────────
let _screenData     = null;
let _activeScreen   = 'pullback';
let _screensLoading = false;

const SCREEN_CONFIG = {
  pullback: { title: '今日飆股回檔精選',       notice: '⚠ 飆漲後回檔整理・守均線・逢低布局・非追高', showLegend: true  },
  entry:    { title: '進場時機',               notice: '✅ 回檔均線・價格轉強・成交量放大',           showLegend: false },
  add:      { title: '加碼訊號',               notice: '🚀 帶量紅K棒・波段創新高',                   showLegend: false },
  exit:     { title: '出場警示',               notice: '⛔ 帶量黑K・跌破均線・利多出盡',             showLegend: false },
  pe:       { title: '本益比合理（10–15倍）', notice: '💰 合理估值・安全邊際・市價÷EPS',            showLegend: false },
};

async function loadScreens() {
  if (_screensLoading) return;
  _screensLoading = true;
  try {
    const res  = await fetch(`${BASE}/api/screens`);
    _screenData = await res.json();
    if (_activeScreen !== 'pullback') renderScreen(_activeScreen);
  } catch (e) {
    console.error('screens load error', e);
  } finally {
    _screensLoading = false;
  }
}

function switchScreen(type, btn) {
  _activeScreen = type;
  document.querySelectorAll('.screen-tab').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');

  const cfg = SCREEN_CONFIG[type];
  document.getElementById('screenTitle').textContent = cfg.title;
  document.getElementById('screenNotice').textContent = cfg.notice;
  const legend = document.getElementById('stratLegend');
  if (legend) legend.style.display = cfg.showLegend ? '' : 'none';

  renderScreen(type);
}

function renderScreen(type) {
  const el = document.getElementById('recCards');
  if (type === 'pullback') { renderRecCards(_recData); return; }

  if (!_screenData) {
    el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>載入分析中…<br><small>首次約需 1–2 分鐘</small></p></div>';
    if (!_screensLoading) loadScreens();
    return;
  }

  const keyMap = { entry: 'entry_timing', add: 'add_position', exit: 'exit_warning', pe: 'pe_value' };
  const stocks = _screenData[keyMap[type]] || [];
  if (!stocks.length) {
    el.innerHTML = '<div class="empty-state"><span>今日無符合條件的股票</span><small>市場條件未達篩選標準</small></div>';
    return;
  }
  const builders = { entry: buildEntryCard, add: buildAddCard, exit: buildExitCard, pe: buildPECard };
  el.innerHTML = stocks.map(s => builders[type](s)).join('');
}

function buildEntryCard(s) {
  const sign = s.change_pct >= 0 ? '+' : '';
  const cls  = s.change_pct >= 0 ? 'up' : 'dn';
  const reason = (s.reasons || []).slice(0, 2).join(' · ');
  return `<div class="stock-card" onclick="openScreenDetail('entry','${s.symbol}')">
    <div class="risk-dot ${s.risk || 'medium'}"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-metric ${cls}">${sign}${s.change_pct?.toFixed(2) ?? '--'}%</div>
    <div class="card-tags">
      <span class="tag blue">📏 ${escHtml(s.ma_label || '均線')}</span>
      <span class="tag ${s.vol_ratio >= 1.5 ? 'bull' : 'blue'}">量 ${s.vol_ratio?.toFixed(1) ?? '--'}x</span>
    </div>
    <div class="card-reason">${escHtml(reason)}</div>
  </div>`;
}

function buildAddCard(s) {
  const highGap = s.high_63 && s.current ? (s.high_63 - s.current) / s.high_63 * 100 : 0;
  const reason  = (s.reasons || []).slice(0, 2).join(' · ');
  return `<div class="stock-card" onclick="openScreenDetail('add','${s.symbol}')">
    <div class="risk-dot medium"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-metric up">${s.at_new_high ? '波段新高' : `距高點 ${highGap.toFixed(1)}%`}</div>
    <div class="card-tags">
      <span class="tag bull">量 ${s.vol_ratio?.toFixed(1) ?? '--'}x</span>
      ${s.at_new_high ? '<span class="tag green">🚀 創新高</span>' : ''}
    </div>
    <div class="card-reason">${escHtml(reason)}</div>
  </div>`;
}

function buildExitCard(s) {
  const sign = s.change_pct >= 0 ? '+' : '';
  const warn = (s.warnings || []).slice(0, 2).join(' · ');
  return `<div class="stock-card card-exit" onclick="openScreenDetail('exit','${s.symbol}')">
    <div class="risk-dot high"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-metric dn">${sign}${s.change_pct?.toFixed(2) ?? '--'}%</div>
    <div class="card-tags">
      <span class="tag bear">RSI ${s.rsi?.toFixed(0) ?? '--'}</span>
      <span class="tag bear">量 ${s.vol_ratio?.toFixed(1) ?? '--'}x</span>
    </div>
    <div class="card-reason exit-warn">${escHtml(warn)}</div>
  </div>`;
}

function buildPECard(s) {
  const reason = (s.reasons || [])[0] || '';
  return `<div class="stock-card" onclick="openScreenDetail('pe','${s.symbol}')">
    <div class="risk-dot low"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    ${s.theme ? `<span class="card-theme">${escHtml(s.theme)}</span>` : ''}
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="pe-badge">本益比 ${s.pe?.toFixed(1) ?? '--'} 倍</div>
    <div class="card-tags">
      ${s.eps != null ? `<span class="tag blue">EPS ${s.eps?.toFixed(2)}</span>` : ''}
      <span class="tag green">估值合理</span>
    </div>
    <div class="card-reason">${escHtml(reason)}</div>
  </div>`;
}

function openScreenDetail(type, symbol) {
  // Load K-line in background; on mobile open modal first, kline loads when user taps "查看K線"
  _currentSymbol = symbol;
  document.querySelectorAll('.stock-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll(`.stock-card[onclick*="'${symbol}'"]`).forEach(c => c.classList.add('active'));
  if (window.innerWidth >= 1024) loadKline(symbol, _currentPeriod);

  const keyMap = { entry: 'entry_timing', add: 'add_position', exit: 'exit_warning', pe: 'pe_value' };
  const stocks = _screenData?.[keyMap[type]] || [];
  const s = stocks.find(r => r.symbol === symbol);
  if (!s) return;

  // Header
  document.getElementById('dtSym').textContent  = s.symbol;
  document.getElementById('dtName').textContent = s.name || s.symbol;
  const themeEl = document.getElementById('dtTheme');
  themeEl.textContent = s.theme || '';
  themeEl.style.display = s.theme ? 'inline-block' : 'none';
  document.getElementById('dtPrice').textContent = s.current?.toFixed(2) ?? '--';
  document.getElementById('dtScore').textContent = s.score ?? '--';

  // Risk
  const riskMap = { low: ['低風險', 'low-risk'], medium: ['中風險', 'med-risk'], high: ['高風險', 'high-risk'] };
  const [rLabel, rCls] = riskMap[s.risk] || ['中風險', 'med-risk'];
  const rEl = document.getElementById('dtRisk');
  rEl.textContent = rLabel;
  rEl.className   = `ps-val ${rCls}`;

  // Type-specific metric row (replaces "回撤")
  const pbLbl = document.getElementById('dtPullbackLabel');
  const pbVal = document.getElementById('dtPullback');
  if (type === 'entry') {
    pbLbl.textContent = '今日漲跌';
    const sign = (s.change_pct ?? 0) >= 0 ? '+' : '';
    pbVal.textContent = `${sign}${s.change_pct?.toFixed(2) ?? '--'}%`;
    pbVal.className   = `ps-val ${(s.change_pct ?? 0) >= 0 ? 'up' : 'dn'}`;
  } else if (type === 'add') {
    const gap = s.high_63 && s.current ? (s.high_63 - s.current) / s.high_63 * 100 : 0;
    pbLbl.textContent = s.at_new_high ? '突破新高' : '距高點';
    pbVal.textContent = s.at_new_high ? '創波段新高 🚀' : `-${gap.toFixed(1)}%`;
    pbVal.className   = `ps-val ${s.at_new_high ? 'up' : 'dn'}`;
  } else if (type === 'exit') {
    pbLbl.textContent = '今日跌幅';
    const sign = (s.change_pct ?? 0) >= 0 ? '+' : '';
    pbVal.textContent = `${sign}${s.change_pct?.toFixed(2) ?? '--'}%`;
    pbVal.className   = 'ps-val dn';
  } else if (type === 'pe') {
    pbLbl.textContent = '本益比';
    pbVal.textContent = `${s.pe?.toFixed(1) ?? '--'} 倍`;
    pbVal.className   = 'ps-val gold';
  }

  // Reasons / Warnings
  const items = type === 'exit' ? (s.warnings || []) : (s.reasons || []);
  document.getElementById('dtReasons').innerHTML = items.length
    ? items.map(r => `<li>${escHtml(r)}</li>`).join('')
    : '<li>等待更多技術確認訊號</li>';

  // Indicators — type-specific
  let indHtml = '';
  if (type === 'entry') {
    const volCls = s.vol_ratio >= 1.5 ? 'up' : 'accent';
    indHtml = `
      <div class="ind-item"><div class="ind-label">回測均線</div><div class="ind-val accent">${escHtml(s.ma_label || '--')}</div></div>
      <div class="ind-item"><div class="ind-label">量能比 (30日均)</div><div class="ind-val ${volCls}">${s.vol_ratio?.toFixed(2) ?? '--'} x</div></div>
      <div class="ind-item"><div class="ind-label">今日漲跌</div><div class="ind-val ${(s.change_pct ?? 0) >= 0 ? 'up' : 'dn'}">${(s.change_pct ?? 0) >= 0 ? '+' : ''}${s.change_pct?.toFixed(2) ?? '--'}%</div></div>
      <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>`;
  } else if (type === 'add') {
    const volCls = s.vol_ratio >= 2.0 ? 'up' : 'accent';
    const gap    = s.high_63 && s.current ? (s.high_63 - s.current) / s.high_63 * 100 : 0;
    indHtml = `
      <div class="ind-item"><div class="ind-label">量能比 (30日均)</div><div class="ind-val ${volCls}">${s.vol_ratio?.toFixed(2) ?? '--'} x</div></div>
      <div class="ind-item"><div class="ind-label">63日高點</div><div class="ind-val">${s.high_63?.toFixed(2) ?? '--'}</div></div>
      <div class="ind-item"><div class="ind-label">距波段高點</div><div class="ind-val ${s.at_new_high ? 'up' : 'dn'}">${s.at_new_high ? '已突破' : `-${gap.toFixed(1)}%`}</div></div>
      <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>`;
  } else if (type === 'exit') {
    const rsiCls = s.rsi >= 72 ? 'up' : s.rsi >= 60 ? 'gold' : '';
    const volCls = s.vol_ratio >= 1.5 ? 'up' : '';
    indHtml = `
      <div class="ind-item"><div class="ind-label">RSI (14)</div><div class="ind-val ${rsiCls}">${s.rsi?.toFixed(1) ?? '--'} · ${(s.rsi ?? 0) >= 72 ? '超買警示' : '偏高'}</div></div>
      <div class="ind-item"><div class="ind-label">量能比 (30日均)</div><div class="ind-val ${volCls}">${s.vol_ratio?.toFixed(2) ?? '--'} x</div></div>
      <div class="ind-item"><div class="ind-label">今日漲跌</div><div class="ind-val dn">${(s.change_pct ?? 0) >= 0 ? '+' : ''}${s.change_pct?.toFixed(2) ?? '--'}%</div></div>
      <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>`;
  } else if (type === 'pe') {
    indHtml = `
      <div class="ind-item"><div class="ind-label">本益比 (PE)</div><div class="ind-val gold">${s.pe?.toFixed(1) ?? '--'} 倍</div></div>
      <div class="ind-item"><div class="ind-label">EPS</div><div class="ind-val accent">${s.eps?.toFixed(2) ?? '--'}</div></div>
      <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>
      <div class="ind-item"><div class="ind-label">估值評級</div><div class="ind-val up">合理估值區間</div></div>`;
  }
  document.getElementById('dtIndicators').innerHTML = indHtml;

  // Hide strategies section (pullback-only concept)
  document.getElementById('dtStratSection').style.display = 'none';

  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ── Utils ─────────────────────────────────────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
