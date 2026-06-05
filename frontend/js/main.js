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
  _renderAIScore(s);
  loadFinancials(symbol);
  loadHolders(symbol);
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
  pullback:   { title: '今日飆股回檔精選',       notice: '⚠ 飆漲後回檔整理・守均線・逢低布局・非追高', showLegend: true  },
  entry:      { title: '進場時機',               notice: '✅ 回檔均線・價格轉強・成交量放大',           showLegend: false },
  add:        { title: '加碼訊號',               notice: '🚀 帶量紅K棒・波段創新高',                   showLegend: false },
  exit:       { title: '出場警示',               notice: '⛔ 帶量黑K・跌破均線・利多出盡',             showLegend: false },
  pe:         { title: '本益比合理（10–15倍）', notice: '💰 合理估值・安全邊際・市價÷EPS',            showLegend: false },
  inst_radar: { title: '法人籌碼雷達',           notice: '📊 外資/投信連續買超天數・10日累計籌碼',     showLegend: false },
  revenue:    { title: '營收爆發雷達',           notice: '📈 月增率・年增率・3月平均年增',             showLegend: false },
  contracts:  { title: '合約負債排行',           notice: '💼 合約負債先噴→營收噴→EPS噴 先行指標',    showLegend: false },
};

async function loadScreens() {
  if (_screensLoading) return;
  _screensLoading = true;
  try {
    const res  = await fetch(`${BASE}/api/screens`);
    _screenData = await res.json();
    if (_activeScreen !== 'pullback' && !['inst_radar','revenue','contracts'].includes(_activeScreen)) {
      renderScreen(_activeScreen);
    }
  } catch (e) {
    console.error('screens load error', e);
  } finally {
    _screensLoading = false;
  }
}

let _radarData    = null;
let _radarsLoading = false;

async function loadRadars() {
  if (_radarsLoading) return;
  _radarsLoading = true;
  const el = document.getElementById('recCards');
  el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>雷達掃描中…<br><small>首次約需 1–2 分鐘</small></p></div>';
  try {
    const [r1, r2, r3] = await Promise.all([
      fetch(`${BASE}/api/radar/institutional`),
      fetch(`${BASE}/api/radar/revenue`),
      fetch(`${BASE}/api/radar/contracts`),
    ]);
    const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
    _radarData = {
      inst_radar: d1.data || [],
      revenue:    d2.data || [],
      contracts:  d3.data || [],
    };
    if (['inst_radar','revenue','contracts'].includes(_activeScreen)) renderScreen(_activeScreen);
  } catch (e) {
    console.error('loadRadars error', e);
    el.innerHTML = '<div class="empty-state"><span>雷達資料載入失敗</span></div>';
  } finally {
    _radarsLoading = false;
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

  // Radar screens
  if (['inst_radar','revenue','contracts'].includes(type)) {
    if (!_radarData) { loadRadars(); return; }
    const stocks = _radarData[type] || [];
    if (!stocks.length) {
      el.innerHTML = '<div class="empty-state"><span>今日無資料</span><small>可能為假日或資料尚未更新</small></div>';
      return;
    }
    const builders = { inst_radar: buildInstRadarCard, revenue: buildRevenueCard, contracts: buildContractCard };
    el.innerHTML = stocks.map(s => builders[type](s)).join('');
    return;
  }

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

// ── Radar Card Builders ───────────────────────────────────
function buildInstRadarCard(s) {
  const fs = s.foreign_streak, ts = s.trust_streak;
  const fNet = Math.round((s.foreign_net || 0) / 1000);
  const tNet = Math.round((s.trust_net   || 0) / 1000);
  const sign = v => v >= 0 ? '+' : '';
  const hasBuy = fs > 0 || ts > 0;
  return `<div class="stock-card${hasBuy ? '' : ' card-exit'}" onclick="openRadarDetail('inst_radar','${escHtml(s.symbol)}')">
    <div class="risk-dot ${hasBuy ? 'medium' : 'high'}"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    <div class="card-tags" style="margin-top:8px;gap:5px">
      ${fs !== 0 ? `<span class="streak-badge ${fs > 0 ? 'buy' : 'sell'}">外資${fs > 0 ? '連買' : '連賣'}${Math.abs(fs)}天</span>` : ''}
      ${ts !== 0 ? `<span class="streak-badge ${ts > 0 ? 'buy' : 'sell'}">投信${ts > 0 ? '連買' : '連賣'}${Math.abs(ts)}天</span>` : ''}
    </div>
    <div class="card-metric ${fNet >= 0 ? 'up' : 'dn'}" style="margin-top:6px">外資 ${sign(fNet)}${fNet.toLocaleString()}K</div>
    <div class="card-metric ${tNet >= 0 ? 'up' : 'dn'}" style="margin-top:4px">投信 ${sign(tNet)}${tNet.toLocaleString()}K</div>
  </div>`;
}

function buildRevenueCard(s) {
  const yoy = s.yoy, mom = s.mom;
  const sign = v => (v != null && v >= 0) ? '+' : '';
  const yoyCls = (yoy || 0) >= 30 ? 'bull' : (yoy || 0) >= 10 ? 'blue' : (yoy || 0) >= 0 ? '' : 'bear';
  const momCls = (mom || 0) >= 10 ? 'bull' : (mom || 0) >= 0 ? 'blue' : 'bear';
  return `<div class="stock-card" onclick="openRadarDetail('revenue','${escHtml(s.symbol)}')">
    <div class="risk-dot ${(yoy || 0) >= 20 ? 'low' : 'medium'}"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    <div style="font-size:10px;color:var(--txt3);margin-top:2px">${escHtml(s.date)}</div>
    <div class="card-metric ${(yoy || 0) >= 0 ? 'up' : 'dn'}" style="margin-top:8px">年增 ${yoy != null ? sign(yoy)+yoy+'%' : '--'}</div>
    <div class="card-tags" style="margin-top:6px">
      <span class="tag ${momCls}">月增 ${sign(mom)}${mom}%</span>
      ${s.yoy_3m != null ? `<span class="tag ${(s.yoy_3m || 0) >= 20 ? 'bull' : 'blue'}">3月均 ${sign(s.yoy_3m)}${s.yoy_3m}%</span>` : ''}
    </div>
  </div>`;
}

function buildContractCard(s) {
  const sign = v => v >= 0 ? '+' : '';
  const fmt  = v => v != null ? `${sign(v)}${v}%` : '--';
  const val  = s.value ? (s.value / 1e8).toFixed(1) + '億' : '--';
  return `<div class="stock-card" onclick="openRadarDetail('contracts','${escHtml(s.symbol)}')">
    <div class="risk-dot ${(s.qoq || 0) >= 20 ? 'low' : 'medium'}"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    <div style="font-size:10px;color:var(--txt3);margin-top:2px">${escHtml(s.date)}</div>
    <div class="card-metric ${(s.qoq || 0) >= 0 ? 'up' : 'dn'}" style="margin-top:8px">QoQ ${fmt(s.qoq)}</div>
    <div class="card-tags" style="margin-top:6px">
      ${s.yoy != null ? `<span class="tag ${(s.yoy || 0) >= 20 ? 'bull' : 'blue'}">YoY ${fmt(s.yoy)}</span>` : ''}
      <span class="tag blue">餘額 ${val}</span>
    </div>
  </div>`;
}

function openRadarDetail(type, symbol) {
  _currentSymbol = symbol;
  if (window.innerWidth >= 1024) loadKline(symbol, _currentPeriod);

  const stocks = _radarData?.[type] || [];
  const s = stocks.find(r => r.symbol === symbol);
  if (!s) return;

  document.getElementById('dtSym').textContent   = s.symbol;
  document.getElementById('dtName').textContent  = s.name || s.symbol;
  document.getElementById('dtTheme').style.display = 'none';
  document.getElementById('dtPrice').textContent = '--';
  document.getElementById('dtScore').textContent = '--';
  const rEl = document.getElementById('dtRisk');
  rEl.textContent = '--'; rEl.className = 'ps-val';

  const sign = v => v >= 0 ? '+' : '';
  let reasons = [], indHtml = '';
  const pbLbl = document.getElementById('dtPullbackLabel');
  const pbVal = document.getElementById('dtPullback');

  if (type === 'inst_radar') {
    pbLbl.textContent  = '外資連買';
    pbVal.textContent  = `${Math.abs(s.foreign_streak)} 天`;
    pbVal.className    = `ps-val ${s.foreign_streak > 0 ? 'up' : 'dn'}`;
    const fN = Math.round((s.foreign_net || 0) / 1000);
    const tN = Math.round((s.trust_net   || 0) / 1000);
    const dN = Math.round((s.dealer_net  || 0) / 1000);
    reasons = [
      `外資連${s.foreign_streak > 0 ? '買' : '賣'}${Math.abs(s.foreign_streak)}天`,
      s.trust_streak !== 0 ? `投信連${s.trust_streak > 0 ? '買' : '賣'}${Math.abs(s.trust_streak)}天` : null,
    ].filter(Boolean);
    indHtml = `
      <div class="ind-item"><div class="ind-label">外資今日</div><div class="ind-val ${fN>=0?'up':'dn'}">${sign(fN)}${fN.toLocaleString()} 千股</div></div>
      <div class="ind-item"><div class="ind-label">外資連續</div><div class="ind-val ${s.foreign_streak>0?'up':'dn'}">${s.foreign_streak>0?'連買':'連賣'} ${Math.abs(s.foreign_streak)} 天</div></div>
      <div class="ind-item"><div class="ind-label">投信今日</div><div class="ind-val ${tN>=0?'up':'dn'}">${sign(tN)}${tN.toLocaleString()} 千股</div></div>
      <div class="ind-item"><div class="ind-label">投信連續</div><div class="ind-val ${s.trust_streak>0?'up':'dn'}">${s.trust_streak>0?'連買':'連賣'} ${Math.abs(s.trust_streak)} 天</div></div>
      <div class="ind-item"><div class="ind-label">自營商今日</div><div class="ind-val ${dN>=0?'up':'dn'}">${sign(dN)}${dN.toLocaleString()} 千股</div></div>
      <div class="ind-item"><div class="ind-label">合計今日</div><div class="ind-val ${(s.total_net||0)>=0?'up':'dn'}">${sign(Math.round((s.total_net||0)/1000))}${Math.round((s.total_net||0)/1000).toLocaleString()} 千股</div></div>`;
  } else if (type === 'revenue') {
    pbLbl.textContent = 'YoY 年增率';
    pbVal.textContent = s.yoy != null ? `${sign(s.yoy)}${s.yoy}%` : '--';
    pbVal.className   = `ps-val ${(s.yoy || 0) >= 0 ? 'up' : 'dn'}`;
    reasons = [`月增率 ${sign(s.mom)}${s.mom}%`, s.yoy_3m != null ? `3月均年增 ${sign(s.yoy_3m)}${s.yoy_3m}%` : null].filter(Boolean);
    indHtml = `
      <div class="ind-item"><div class="ind-label">月增率 MoM</div><div class="ind-val ${s.mom>=0?'up':'dn'}">${sign(s.mom)}${s.mom}%</div></div>
      <div class="ind-item"><div class="ind-label">年增率 YoY</div><div class="ind-val ${(s.yoy||0)>=0?'up':'dn'}">${s.yoy!=null?sign(s.yoy)+s.yoy+'%':'--'}</div></div>
      <div class="ind-item"><div class="ind-label">3月均年增</div><div class="ind-val ${(s.yoy_3m||0)>=0?'up':'dn'}">${s.yoy_3m!=null?sign(s.yoy_3m)+s.yoy_3m+'%':'--'}</div></div>
      <div class="ind-item"><div class="ind-label">資料月份</div><div class="ind-val">${escHtml(s.date)}</div></div>`;
  } else if (type === 'contracts') {
    pbLbl.textContent = 'QoQ 季增率';
    pbVal.textContent = `${sign(s.qoq)}${s.qoq}%`;
    pbVal.className   = `ps-val ${(s.qoq || 0) >= 0 ? 'up' : 'dn'}`;
    reasons = [`合約負債季增 ${sign(s.qoq)}${s.qoq}%`, s.yoy != null ? `年增 ${sign(s.yoy)}${s.yoy}%` : null].filter(Boolean);
    const val = s.value ? (s.value / 1e8).toFixed(1) + '億' : '--';
    indHtml = `
      <div class="ind-item"><div class="ind-label">QoQ 季增率</div><div class="ind-val ${(s.qoq||0)>=0?'up':'dn'}">${sign(s.qoq)}${s.qoq}%</div></div>
      <div class="ind-item"><div class="ind-label">YoY 年增率</div><div class="ind-val ${(s.yoy||0)>=0?'up':'dn'}">${s.yoy!=null?sign(s.yoy)+s.yoy+'%':'--'}</div></div>
      <div class="ind-item"><div class="ind-label">合約負債餘額</div><div class="ind-val">${val}</div></div>
      <div class="ind-item"><div class="ind-label">資料日期</div><div class="ind-val">${escHtml(s.date)}</div></div>`;
  }

  document.getElementById('dtReasons').innerHTML = reasons.length
    ? reasons.map(r => `<li>${escHtml(r)}</li>`).join('')
    : '<li>查看 K 線圖與更多資料</li>';
  document.getElementById('dtIndicators').innerHTML = indHtml;
  document.getElementById('dtStratSection').style.display = 'none';
  document.getElementById('dtAISection').style.display = 'none';

  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderAIScore(s);
  loadFinancials(symbol);
  loadHolders(symbol);
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
  _renderAIScore(s);
  loadFinancials(symbol);
  loadHolders(symbol);
}

// ── AI Score ──────────────────────────────────────────────
function _renderAIScore(s) {
  const section = document.getElementById('dtAISection');
  const totalEl = document.getElementById('dtAITotal');
  const barsEl  = document.getElementById('dtAIBars');
  if (!section || !totalEl || !barsEl) return;

  // Technical (max 35)
  let tech = 0, hasTech = false;
  if (s.rsi != null) {
    hasTech = true;
    if      (s.rsi >= 30 && s.rsi <= 50) tech += 12;
    else if (s.rsi > 50  && s.rsi <= 65) tech +=  7;
    else if (s.rsi < 30)                 tech += 10;
    else                                  tech +=  2;
  }
  if (s.macd_status != null) {
    hasTech = true;
    tech += ['黃金交叉','即將交叉','多頭'].includes(s.macd_status) ? 13 : 3;
  }
  const strats = s.strategies || [];
  if (strats.includes('縮量回檔'))   { tech += 5; hasTech = true; }
  if (strats.includes('均線守支撐')) { tech += 5; hasTech = true; }
  tech = Math.min(35, Math.max(0, tech));

  // Chip (max 30) — from loaded institutional data
  let chip = 0;
  if (typeof _instData !== 'undefined' && _instData && !_instData.error) {
    const allRows = _instData.stocks || _instData.top_buy || [];
    const ir = allRows.find(r => r.symbol === s.symbol);
    if (ir) {
      if (ir.foreign_net > 0) chip += 12;
      if (ir.trust_net   > 0) chip += 10;
      if (ir.total_net   > 0) chip +=  8;
    }
  }
  chip = Math.min(30, chip);

  const total = tech + chip;
  const cls = total >= 55 ? 'green' : total >= 35 ? 'yellow' : 'red';

  totalEl.textContent = total;
  totalEl.className   = `ai-score-total ${cls}`;

  barsEl.innerHTML = `
    <div class="ai-score-label">${total >= 55 ? '強勢訊號' : total >= 35 ? '中性觀望' : '謹慎留意'}</div>
    <div class="ai-score-bars">
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🔵 技術面 /35</span><span class="ai-bar-val">${hasTech ? tech : '--'}</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill tech" style="width:${hasTech ? tech/35*100 : 0}%"></div></div>
      </div>
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🟡 籌碼面 /30</span><span class="ai-bar-val">${chip}</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill chip" style="width:${chip/30*100}%"></div></div>
      </div>
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🟢 基本面 /35</span><span class="ai-bar-val" id="dtAIFundVal">載入中…</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill fund" style="width:0%" id="dtAIFundBar"></div></div>
      </div>
    </div>`;

  section.style.display = '';
}

function _updateAIFund(d) {
  const fundValEl = document.getElementById('dtAIFundVal');
  const fundBarEl = document.getElementById('dtAIFundBar');
  const totalEl   = document.getElementById('dtAITotal');
  if (!fundValEl || !fundBarEl || !totalEl) return;

  let fund = 0;
  if (d.gross_margin    != null) fund += d.gross_margin    > 0.5 ? 12 : d.gross_margin > 0.3 ? 8 : 4;
  if (d.revenue_growth  != null) fund += d.revenue_growth  > 0.3 ? 12 : d.revenue_growth > 0.1 ? 8 : d.revenue_growth > 0 ? 5 : 0;
  if (d.earnings_growth != null) fund += d.earnings_growth > 0.3 ? 11 : d.earnings_growth > 0.1 ? 7 : d.earnings_growth > 0 ? 4 : 0;
  fund = Math.min(35, fund);

  fundValEl.textContent   = fund;
  fundBarEl.style.width   = `${fund/35*100}%`;
  const newTotal = (parseInt(totalEl.textContent) || 0) + fund;
  totalEl.textContent = newTotal;
  totalEl.className   = `ai-score-total ${newTotal >= 70 ? 'green' : newTotal >= 50 ? 'yellow' : 'red'}`;
  totalEl.nextElementSibling?.querySelector?.('.ai-score-label')
    && (totalEl.nextElementSibling.querySelector('.ai-score-label').textContent =
        newTotal >= 70 ? '強勢股 🟢' : newTotal >= 50 ? '觀察 🟡' : '謹慎 🔴');
}

// ── Big Holders ───────────────────────────────────────────
async function loadHolders(symbol) {
  const section = document.getElementById('dtHoldersSection');
  const el      = document.getElementById('dtHolders');
  if (!section || !el) return;
  section.style.display = '';
  el.innerHTML = '<div class="loading-text" style="padding:6px 0;font-size:11px">載入持股分布中…</div>';

  try {
    const res = await fetch(`${BASE}/api/stock/${symbol}/holders`);
    const d   = await res.json();
    if (d.error) { section.style.display = 'none'; return; }

    const trendText = d.trend === 'up' ? '大戶持續增加 ▲' : d.trend === 'down' ? '大戶持續減少 ▼' : '大戶持平 —';
    const trendCls  = d.trend === 'up' ? 'up' : d.trend === 'down' ? 'down' : 'flat';

    el.innerHTML = `
      <div class="holder-row">
        <div class="holder-item">
          <div class="holder-pct up">${d.big_pct.toFixed(1)}%</div>
          <div class="holder-lbl">千張大戶</div>
          <div class="holder-trend-badge ${trendCls}">${trendText}</div>
        </div>
        <div class="holder-item">
          <div class="holder-pct dn">${d.small_pct.toFixed(1)}%</div>
          <div class="holder-lbl">極小散戶</div>
        </div>
      </div>
      <div class="holder-bar-wrap">
        <div class="holder-bar-big" style="width:${Math.min(d.big_pct, 100)}%"></div>
        <div class="holder-bar-rest"></div>
      </div>
      <div class="holder-date">資料日期：${escHtml(d.date)}</div>`;
  } catch (e) {
    section.style.display = 'none';
  }
}

// ── Financials ────────────────────────────────────────────
async function loadFinancials(symbol) {
  const section = document.getElementById('dtFinancialSection');
  const el      = document.getElementById('dtFinancials');
  if (!section || !el) return;

  section.style.display = '';
  el.innerHTML = '<div class="loading-text" style="padding:6px 0;font-size:11px">載入財報中…</div>';

  try {
    const res = await fetch(`${BASE}/api/stock/${symbol}/financials`);
    const d   = await res.json();
    if (d.error) { section.style.display = 'none'; _updateAIFund({}); return; }

    const pct  = v => v != null ? `${(v * 100).toFixed(1)}%` : '--';
    const num  = v => v != null ? v.toFixed(2) : '--';
    const sign = v => v > 0 ? '+' : '';

    let html = '';
    if (d.gross_margin     != null) html += `<div class="ind-item"><div class="ind-label">毛利率</div><div class="ind-val ${d.gross_margin > 0.3 ? 'up' : ''}">${pct(d.gross_margin)}</div></div>`;
    if (d.operating_margin != null) html += `<div class="ind-item"><div class="ind-label">營業利益率</div><div class="ind-val ${d.operating_margin > 0 ? 'accent' : 'dn'}">${pct(d.operating_margin)}</div></div>`;
    if (d.trailing_eps     != null) html += `<div class="ind-item"><div class="ind-label">EPS (近12月)</div><div class="ind-val accent">${num(d.trailing_eps)}</div></div>`;
    if (d.forward_eps      != null) html += `<div class="ind-item"><div class="ind-label">EPS (預估)</div><div class="ind-val accent">${num(d.forward_eps)}</div></div>`;
    if (d.revenue_growth   != null) html += `<div class="ind-item"><div class="ind-label">營收成長 YoY</div><div class="ind-val ${d.revenue_growth >= 0 ? 'up' : 'dn'}">${sign(d.revenue_growth)}${pct(d.revenue_growth)}</div></div>`;
    if (d.earnings_growth  != null) html += `<div class="ind-item"><div class="ind-label">獲利成長 YoY</div><div class="ind-val ${d.earnings_growth >= 0 ? 'up' : 'dn'}">${sign(d.earnings_growth)}${pct(d.earnings_growth)}</div></div>`;
    if (d.trailing_pe      != null) html += `<div class="ind-item"><div class="ind-label">本益比 (PE)</div><div class="ind-val gold">${num(d.trailing_pe)} 倍</div></div>`;
    if (d.dividend_yield   != null) html += `<div class="ind-item"><div class="ind-label">殖利率</div><div class="ind-val gold">${pct(d.dividend_yield)}</div></div>`;

    if (!html) { section.style.display = 'none'; }
    else el.innerHTML = html;
    _updateAIFund(d);
  } catch (e) {
    section.style.display = 'none';
  }
}

// ── Utils ─────────────────────────────────────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
