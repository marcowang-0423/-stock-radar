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
  loadStopLoss(symbol);
  loadFinancials(symbol);
  loadBacktest(symbol);
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
  inst_radar:  { title: '法人籌碼雷達',   notice: '📊 外資/投信連續買超天數・10日累計籌碼',     showLegend: false },
  revenue:     { title: '營收爆發雷達',   notice: '📈 月增率・年增率・3月平均年增',             showLegend: false },
  contracts:   { title: '合約負債排行',   notice: '💼 合約負債先噴→營收噴→EPS噴 先行指標',    showLegend: false },
  sector_heat: { title: '產業族群熱度',   notice: '🌡 今日法人主攻族群・買超最強板塊一覽',      showLegend: false },
  reserve:      { title: '飆股預備軍',    notice: '🚀 法人剛開始買・尚未突破前高・KD 交叉訊號', showLegend: false },
  surveillance: { title: '處置/注意股專區', notice: '⚠ 處置股有交易限制・注意股為近期異常交易',    showLegend: false },
  conferences:  { title: '法說會行事曆',   notice: '📋 本月 + 下月法說會時間表（上市 + 上櫃）',    showLegend: false },
};

async function loadScreens() {
  if (_screensLoading) return;
  _screensLoading = true;
  try {
    const res  = await fetch(`${BASE}/api/screens`);
    _screenData = await res.json();
    const _radarScreens = ['inst_radar','revenue','contracts','sector_heat','reserve'];
    if (_activeScreen !== 'pullback' && !_radarScreens.includes(_activeScreen)) {
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

let _sectorData    = null;
let _sectorLoading = false;

async function loadSectorHeat() {
  if (_sectorLoading) return;
  _sectorLoading = true;
  const el = document.getElementById('recCards');
  el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>掃描族群熱度…<br><small>約需 30 秒</small></p></div>';
  try {
    const res = await fetch(`${BASE}/api/sector/heat`);
    const d   = await res.json();
    _sectorData = d.data || [];
    if (_activeScreen === 'sector_heat') renderScreen('sector_heat');
  } catch (e) {
    console.error('loadSectorHeat error', e);
    document.getElementById('recCards').innerHTML = '<div class="empty-state"><span>族群資料載入失敗</span></div>';
  } finally {
    _sectorLoading = false;
  }
}

let _surveillanceData    = null;
let _surveillanceLoading = false;

async function loadSurveillance() {
  if (_surveillanceLoading) return;
  _surveillanceLoading = true;
  const el = document.getElementById('recCards');
  el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>掃描警示股…</p></div>';
  try {
    const res = await fetch(`${BASE}/api/surveillance`);
    _surveillanceData = await res.json();
    if (_activeScreen === 'surveillance') renderScreen('surveillance');
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><span>警示股資料載入失敗</span></div>';
  } finally {
    _surveillanceLoading = false;
  }
}

let _conferencesData    = null;
let _conferencesLoading = false;

async function loadConferences() {
  if (_conferencesLoading) return;
  _conferencesLoading = true;
  const el = document.getElementById('recCards');
  el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>載入法說會行事曆…</p></div>';
  try {
    const res = await fetch(`${BASE}/api/conferences`);
    const d = await res.json();
    _conferencesData = d.data || [];
    if (_activeScreen === 'conferences') renderScreen('conferences');
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><span>法說會資料載入失敗</span></div>';
  } finally {
    _conferencesLoading = false;
  }
}

let _reserveData    = null;
let _reserveLoading = false;

async function loadReserve() {
  if (_reserveLoading) return;
  _reserveLoading = true;
  const el = document.getElementById('recCards');
  el.innerHTML = '<div class="rec-loading"><div class="spinner"></div><p>篩選飆股預備軍…<br><small>首次約需 2–3 分鐘</small></p></div>';
  try {
    const res = await fetch(`${BASE}/api/radar/reserve`);
    const d   = await res.json();
    _reserveData = d.data || [];
    if (_activeScreen === 'reserve') renderScreen('reserve');
  } catch (e) {
    console.error('loadReserve error', e);
    document.getElementById('recCards').innerHTML = '<div class="empty-state"><span>預備軍資料載入失敗</span></div>';
  } finally {
    _reserveLoading = false;
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

  // Radar screens (3 original)
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

  // Sector heat
  if (type === 'sector_heat') {
    if (!_sectorData) { loadSectorHeat(); return; }
    if (!_sectorData.length) {
      el.innerHTML = '<div class="empty-state"><span>今日無族群資料</span></div>';
      return;
    }
    el.innerHTML = _sectorData.map(s => buildSectorCard(s)).join('');
    return;
  }

  // Reserve
  if (type === 'reserve') {
    if (!_reserveData) { loadReserve(); return; }
    if (!_reserveData.length) {
      el.innerHTML = '<div class="empty-state"><span>今日無預備軍股票</span><small>等待法人開始布局中</small></div>';
      return;
    }
    el.innerHTML = _reserveData.map(s => buildReserveCard(s)).join('');
    return;
  }

  // Surveillance (處置股 + 注意股)
  if (type === 'surveillance') {
    if (!_surveillanceData) { loadSurveillance(); return; }
    const disp = _surveillanceData.disposition || [];
    const note = _surveillanceData.notice     || [];
    if (!disp.length && !note.length) {
      el.innerHTML = '<div class="empty-state"><span>今日無警示股</span><small>市場交易正常</small></div>';
      return;
    }
    let html = '';
    if (disp.length) {
      html += `<div class="surv-header">🔴 處置股（${disp.length} 檔）</div>`;
      html += disp.map(s => buildDispositionCard(s)).join('');
    }
    if (note.length) {
      html += `<div class="surv-header">🟡 注意股（${note.length} 檔）</div>`;
      html += note.map(s => buildNoticeCard(s)).join('');
    }
    el.innerHTML = html;
    return;
  }

  // Investor Conferences (法說會)
  if (type === 'conferences') {
    if (!_conferencesData) { loadConferences(); return; }
    if (!_conferencesData.length) {
      el.innerHTML = '<div class="empty-state"><span>本月無法說會資料</span><small>MOPS 資料可能尚未更新</small></div>';
      return;
    }
    el.innerHTML = `<div class="conf-list">${_conferencesData.map(c => buildConferenceItem(c)).join('')}</div>`;
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
  loadStopLoss(symbol);
  loadFinancials(symbol);
  loadBacktest(symbol);
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
  loadStopLoss(symbol);
  loadFinancials(symbol);
  loadBacktest(symbol);
  loadHolders(symbol);
}

// ── AI Score ──────────────────────────────────────────────
function _aiLabel(n) {
  if (n >= 85) return '強勢追蹤';
  if (n >= 70) return '轉強觀察';
  if (n >= 55) return '初步轉機';
  if (n >= 40) return '中性整理';
  return '偏弱避開';
}
function _aiCls(n) {
  return n >= 70 ? 'green' : n >= 50 ? 'yellow' : 'red';
}

function _renderAIScore(s) {
  const section = document.getElementById('dtAISection');
  const totalEl = document.getElementById('dtAITotal');
  const barsEl  = document.getElementById('dtAIBars');
  if (!section || !totalEl || !barsEl) return;

  const strats = s.strategies || [];
  const pros = [], risks = [];

  // ── 技術面 (max 30) ─────────────────────────────────────
  let tech = 0;
  if (s.rsi != null) {
    if      (s.rsi >= 30 && s.rsi <= 50) { tech += 8; pros.push(`RSI ${s.rsi.toFixed(0)} 低檔整理`); }
    else if (s.rsi >  50 && s.rsi <= 65) { tech += 6; pros.push(`RSI ${s.rsi.toFixed(0)} 中性偏多`); }
    else if (s.rsi < 30)                  { tech += 5; pros.push(`RSI ${s.rsi.toFixed(0)} 超賣反彈`); }
    else                                  { tech += 2; risks.push(`RSI ${s.rsi.toFixed(0)} 偏高`); }
  }
  if (s.macd_status != null) {
    if (['黃金交叉','即將交叉'].includes(s.macd_status)) { tech += 8; pros.push(`MACD ${s.macd_status}`); }
    else if (s.macd_status === '多頭')                    { tech += 5; pros.push('MACD 多頭排列'); }
    else                                                   { tech += 2; }
  }
  if (s.sma20_pct != null) {
    if (s.sma20_pct > 0) { tech += 6; pros.push('股價站上月線'); }
    else                  { risks.push('股價跌破月線'); }
  }
  if      (strats.includes('縮量回檔'))     { tech += 4; pros.push('縮量回檔健康洗盤'); }
  else if ((s.vol_ratio ?? 0) >= 1.3)       { tech += 3; pros.push(`量能放大 ${s.vol_ratio?.toFixed(1)}x`); }
  if (strats.includes('均線守支撐'))         { tech += 4; pros.push('均線守住支撐'); }
  tech = Math.min(30, Math.max(0, tech));

  // ── 籌碼面 (max 30) ─────────────────────────────────────
  let chip = 0;
  const allRows = (typeof _instData !== 'undefined' && _instData && !_instData.error)
    ? (_instData.stocks || _instData.top_buy || []) : [];
  const ir = allRows.find(r => r.symbol === s.symbol);
  if (ir) {
    const fnet = ir.foreign_net ?? 0;
    const tnet = ir.trust_net   ?? 0;
    if      (fnet > 5_000_000) { chip += 12; pros.push(`外資大量買超 ${Math.round(fnet/1000)}張`); }
    else if (fnet > 0)         { chip +=  8; pros.push('外資買超'); }
    else if (fnet < -5_000_000){ risks.push('外資大量賣超'); }
    else if (fnet < 0)         { risks.push('外資小幅賣超'); }

    if      (tnet > 1_000_000) { chip += 12; pros.push(`投信大量買超 ${Math.round(tnet/1000)}張`); }
    else if (tnet > 0)         { chip += 10; pros.push('投信買超'); }
    else if (tnet < 0)         { risks.push('投信尚未進場'); }
  } else if (strats.includes('法人買超')) {
    chip += 8; pros.push('法人買超');
  } else {
    risks.push('法人籌碼待確認');
  }
  chip = Math.min(30, chip);

  // ── 題材/產業熱度 (max 10) ──────────────────────────────
  let heat = 0;
  if (s.theme) { heat += 6; pros.push(`${s.theme} 題材`); }
  if (strats.some(t => t.startsWith('題材:'))) heat = Math.min(10, heat + 4);
  heat = Math.min(10, heat);

  const partial = tech + chip + heat;
  window._aiState = { partial, pros: [...pros], risks: [...risks] };

  totalEl.textContent = partial;
  totalEl.className   = `ai-score-total ${_aiCls(partial + 15)}`;

  barsEl.innerHTML = `
    <div class="ai-score-tagline" id="dtAITagline">${_aiLabel(partial + 15)}</div>
    <div class="ai-score-bars">
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🔵 技術面 /30</span><span class="ai-bar-val">${tech}</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill tech" style="width:${tech/30*100}%"></div></div>
      </div>
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🟡 籌碼面 /30</span><span class="ai-bar-val">${chip}</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill chip" style="width:${chip/30*100}%"></div></div>
      </div>
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🟢 基本面 /30</span><span class="ai-bar-val" id="dtAIFundVal">載入中…</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill fund" style="width:0%" id="dtAIFundBar"></div></div>
      </div>
      <div class="ai-bar-row">
        <div class="ai-bar-head"><span class="ai-bar-label">🔥 題材熱度 /10</span><span class="ai-bar-val">${heat}</span></div>
        <div class="ai-bar-track"><div class="ai-bar-fill heat" style="width:${heat/10*100}%"></div></div>
      </div>
    </div>
    <div class="ai-reasons" id="dtAIReasons">
      <div class="ai-reason-loading">財報資料載入中…</div>
    </div>`;

  section.style.display = '';
}

function _updateAIFund(d) {
  const fundValEl = document.getElementById('dtAIFundVal');
  const fundBarEl = document.getElementById('dtAIFundBar');
  const totalEl   = document.getElementById('dtAITotal');
  const taglineEl = document.getElementById('dtAITagline');
  const reasonsEl = document.getElementById('dtAIReasons');
  if (!fundValEl || !fundBarEl || !totalEl) return;

  const state   = window._aiState || {};
  const partial = state.partial ?? 0;
  const pros    = [...(state.pros  ?? [])];
  const risks   = [...(state.risks ?? [])];

  // ── 基本面 (max 30) ─────────────────────────────────────
  let fund = 0;
  if (d.gross_margin != null) {
    if      (d.gross_margin > 0.5) { fund += 10; pros.push(`毛利率 ${(d.gross_margin*100).toFixed(0)}%`); }
    else if (d.gross_margin > 0.3) { fund +=  7; pros.push(`毛利率 ${(d.gross_margin*100).toFixed(0)}%`); }
    else if (d.gross_margin > 0)   { fund +=  4; }
    else                            {             risks.push('毛利率偏低'); }
  }
  if (d.revenue_growth != null) {
    if      (d.revenue_growth > 0.3)  { fund += 10; pros.push(`營收年增 +${(d.revenue_growth*100).toFixed(0)}%`); }
    else if (d.revenue_growth > 0.1)  { fund +=  7; pros.push('月營收年增轉強'); }
    else if (d.revenue_growth > 0)    { fund +=  5; pros.push('月營收年增轉正'); }
    else                               {             risks.push('月營收年增負成長'); }
  }
  if (d.earnings_growth != null) {
    if      (d.earnings_growth > 0.3) { fund += 10; pros.push(`EPS 年增 +${(d.earnings_growth*100).toFixed(0)}%`); }
    else if (d.earnings_growth > 0.1) { fund +=  7; pros.push('EPS 穩定成長'); }
    else if (d.earnings_growth > 0)   { fund +=  4; pros.push('EPS 小幅成長'); }
    else                               {             risks.push('EPS 未見成長'); }
  }
  fund = Math.min(30, fund);

  const total = partial + fund;
  fundValEl.textContent = fund;
  fundBarEl.style.width = `${fund/30*100}%`;
  totalEl.textContent   = total;
  totalEl.className     = `ai-score-total ${_aiCls(total)}`;
  if (taglineEl) taglineEl.textContent = _aiLabel(total);

  if (reasonsEl) {
    const prosHtml  = pros.length  ? `<div class="ai-reason-row">
      <span class="ar-label pros">優點</span>
      <span class="ar-items">${escHtml(pros.join('、'))}</span>
    </div>` : '';
    const risksHtml = risks.length ? `<div class="ai-reason-row">
      <span class="ar-label risks">風險</span>
      <span class="ar-items">${escHtml(risks.join('、'))}</span>
    </div>` : '';
    reasonsEl.innerHTML = prosHtml + risksHtml || '<div class="ai-reason-loading">--</div>';
  }
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

// ── Sector Heat Card Builders ─────────────────────────
function buildSectorCard(s) {
  const sign = s.total_net >= 0 ? '+' : '';
  const netK = Math.round(s.total_net / 1000);
  const cls  = s.score >= 75 ? 'low' : s.score >= 40 ? 'medium' : 'high';
  const top  = (s.stocks || []).slice(0, 4);
  return `<div class="stock-card sector-card" onclick="showSectorStocks('${escHtml(s.sector)}')">
    <div class="risk-dot ${cls}"></div>
    <div class="card-sym" style="font-size:14px">${escHtml(s.sector)}</div>
    <div class="card-metric ${s.total_net >= 0 ? 'up' : 'dn'}" style="margin-top:6px">
      法人合計 ${sign}${netK.toLocaleString()} K
    </div>
    <div class="sector-heat-label" style="margin-top:6px">
      買超 ${s.buy_count} / ${s.stock_count} 檔
    </div>
    <div class="sector-heat-bar" style="margin-top:4px">
      <div class="sector-heat-fill" style="width:${s.score}%"></div>
    </div>
    <div class="sector-stocks">
      ${top.map(r => `<span class="sector-stock-tag ${r.total_net >= 0 ? 'up' : 'dn'}"
          onclick="event.stopPropagation();selectStock('${escHtml(r.symbol)}')"
          title="${escHtml(r.name)}">${escHtml(r.symbol)}</span>`).join('')}
    </div>
  </div>`;
}

function showSectorStocks(sectorName) {
  const sector = (_sectorData || []).find(s => s.sector === sectorName);
  if (!sector) return;
  const el = document.getElementById('recCards');
  el.innerHTML = `
    <div class="sector-back-row">
      <button class="sector-back-btn" onclick="renderScreen('sector_heat')">← 族群總覽</button>
      <span class="sector-back-title">${escHtml(sectorName)}</span>
    </div>
    ${(sector.stocks || []).map(s => {
      const sign = s.total_net >= 0 ? '+' : '';
      const netK = Math.round(s.total_net / 1000);
      return `<div class="stock-card" onclick="selectStock('${escHtml(s.symbol)}')">
        <div class="risk-dot ${s.total_net >= 0 ? 'medium' : 'high'}"></div>
        <div class="card-sym">${escHtml(s.symbol)}</div>
        <div class="card-name">${escHtml(s.name)}</div>
        <div class="card-metric ${s.total_net >= 0 ? 'up' : 'dn'}" style="margin-top:8px">
          法人 ${sign}${netK.toLocaleString()} K
        </div>
      </div>`;
    }).join('')}`;
}

// ── Reserve Card Builder ──────────────────────────────
function buildReserveCard(s) {
  return `<div class="stock-card" onclick="openReserveDetail('${escHtml(s.symbol)}')">
    <div class="risk-dot ${s.kd_cross ? 'low' : 'medium'}"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name || s.symbol)}</div>
    <div class="card-price">${s.current?.toFixed(2) ?? '--'}</div>
    <div class="card-tags" style="margin-top:8px;gap:5px">
      ${s.f_streak > 0 ? `<span class="streak-badge buy">外資連買${s.f_streak}天</span>` : ''}
      ${s.t_streak > 0 ? `<span class="streak-badge buy">投信連買${s.t_streak}天</span>` : ''}
      ${s.kd_cross ? '<span class="reserve-badge kd">KD黃金交叉</span>' : ''}
    </div>
    <div class="card-metric" style="margin-top:4px;font-size:11px;color:var(--txt3)">
      距前高 -${s.high_gap?.toFixed(1) ?? '--'}%
    </div>
  </div>`;
}

function openReserveDetail(symbol) {
  _currentSymbol = symbol;
  if (window.innerWidth >= 1024) loadKline(symbol, _currentPeriod);
  const s = (_reserveData || []).find(r => r.symbol === symbol);
  if (!s) return;

  document.getElementById('dtSym').textContent   = s.symbol;
  document.getElementById('dtName').textContent  = s.name || s.symbol;
  document.getElementById('dtTheme').style.display = 'none';
  document.getElementById('dtPrice').textContent = s.current?.toFixed(2) ?? '--';
  document.getElementById('dtScore').textContent = '--';
  const rEl = document.getElementById('dtRisk');
  rEl.textContent = '--'; rEl.className = 'ps-val';

  const pbLbl = document.getElementById('dtPullbackLabel');
  const pbVal = document.getElementById('dtPullback');
  pbLbl.textContent = 'KD 狀態';
  pbVal.textContent = s.kd_cross ? '黃金交叉 ✓' : '尚未交叉';
  pbVal.className   = `ps-val ${s.kd_cross ? 'up' : ''}`;

  const reasons = [
    s.f_streak > 0 ? `外資連買 ${s.f_streak} 天，籌碼開始集中` : null,
    s.t_streak > 0 ? `投信連買 ${s.t_streak} 天，法人共同買進` : null,
    `距52週高點尚差 -${s.high_gap}%，有爆發空間`,
    s.kd_cross ? 'KD 黃金交叉，短線動能轉強' : null,
  ].filter(Boolean);
  document.getElementById('dtReasons').innerHTML = reasons.map(r => `<li>${escHtml(r)}</li>`).join('');

  document.getElementById('dtIndicators').innerHTML = `
    <div class="ind-item"><div class="ind-label">外資連買</div><div class="ind-val up">${s.f_streak} 天</div></div>
    <div class="ind-item"><div class="ind-label">投信連買</div><div class="ind-val up">${s.t_streak} 天</div></div>
    <div class="ind-item"><div class="ind-label">KD 狀態</div><div class="ind-val ${s.kd_cross ? 'up' : ''}">${s.kd_cross ? '黃金交叉 ✓' : '尚未交叉'}</div></div>
    <div class="ind-item"><div class="ind-label">距前高</div><div class="ind-val dn">-${s.high_gap}%</div></div>
    <div class="ind-item"><div class="ind-label">52周高點</div><div class="ind-val">${s.high_year?.toFixed(2) ?? '--'}</div></div>
    <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>`;

  document.getElementById('dtStratSection').style.display = 'none';
  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderAIScore(s);
  loadStopLoss(symbol);
  loadFinancials(symbol);
  loadBacktest(symbol);
  loadHolders(symbol);
}

// ── Historical Backtest ───────────────────────────────
async function loadBacktest(symbol) {
  const section = document.getElementById('dtBacktestSection');
  const el      = document.getElementById('dtBacktest');
  if (!section || !el) return;
  section.style.display = '';
  el.innerHTML = '<div class="loading-text" style="padding:6px 0;font-size:11px">回測計算中…</div>';
  try {
    const res = await fetch(`${BASE}/api/stock/${symbol}/backtest`);
    const d   = await res.json();
    if (d.error || !d.occurrences) { section.style.display = 'none'; return; }
    const wCls = d.win_rate >= 65 ? 'up' : d.win_rate >= 45 ? 'gold' : 'dn';
    const gCls = d.avg_gain >= 0 ? 'up' : 'dn';
    el.innerHTML = `
      <div class="backtest-stats">
        <div class="backtest-stat">
          <div class="backtest-num ${wCls}">${d.win_rate}%</div>
          <div class="backtest-lbl">勝率<br><small>(漲幅>5%)</small></div>
        </div>
        <div class="backtest-stat">
          <div class="backtest-num ${gCls}">${d.avg_gain > 0 ? '+' : ''}${d.avg_gain}%</div>
          <div class="backtest-lbl">均漲幅<br><small>20天後</small></div>
        </div>
        <div class="backtest-stat">
          <div class="backtest-num up">+${d.max_gain}%</div>
          <div class="backtest-lbl">最大漲<br><small>單次</small></div>
        </div>
        <div class="backtest-stat">
          <div class="backtest-num accent">${d.occurrences}</div>
          <div class="backtest-lbl">觸發<br><small>${d.period}</small></div>
        </div>
      </div>
      <div class="backtest-note">條件：RSI 30–52 + 回撤≥8%（類似當前狀態）</div>`;
  } catch (e) {
    section.style.display = 'none';
  }
}

// ── Stop-Loss / Risk ──────────────────────────────────
async function loadStopLoss(symbol) {
  const section = document.getElementById('dtStopSection');
  const el      = document.getElementById('dtStop');
  if (!section || !el) return;
  section.style.display = '';
  el.innerHTML = '<div class="loading-text" style="padding:6px 0;font-size:11px">計算 ATR 中…</div>';
  try {
    const res = await fetch(`${BASE}/api/stock/${symbol}/kline?period=3mo`);
    const d   = await res.json();
    if (d.error || !d.atr14 || !d.current) { section.style.display = 'none'; return; }

    const atr    = d.atr14;
    const price  = d.current;
    const volPct = atr / price * 100;
    let risk = 5;
    if      (volPct > 3.5) risk = 8;
    else if (volPct > 2.5) risk = 7;
    else if (volPct > 1.8) risk = 6;
    else if (volPct < 1.2) risk = 3;
    else if (volPct < 1.5) risk = 4;

    const riskCls = risk >= 7 ? 'high-risk' : risk >= 5 ? 'med-risk' : 'low-risk';
    const riskLbl = risk >= 7 ? '高風險' : risk >= 5 ? '中風險' : '低風險';
    const rEl = document.getElementById('dtRisk');
    if (rEl) { rEl.textContent = `${risk}/10`; rEl.className = `ps-val ${riskCls}`; }

    const buyLo = (price - atr * 0.5).toFixed(2);
    const buyHi = (price + atr * 0.3).toFixed(2);
    const sl    = (price - atr * 2).toFixed(2);
    const tp    = (price + atr * 3).toFixed(2);

    el.innerHTML = `
      <div class="stop-grid">
        <div class="stop-item stop-buy-item">
          <div class="stop-label">📌 建議買點</div>
          <div class="stop-range">${buyLo}–${buyHi}</div>
          <div class="stop-sub">ATR(14) = ${atr.toFixed(2)}</div>
        </div>
        <div class="stop-item stop-loss-item">
          <div class="stop-label">🛑 停損</div>
          <div class="stop-val dn">${sl}</div>
          <div class="stop-sub">-2×ATR</div>
        </div>
        <div class="stop-item stop-profit-item">
          <div class="stop-label">🎯 停利</div>
          <div class="stop-val up">${tp}</div>
          <div class="stop-sub">+3×ATR · 1:3</div>
        </div>
      </div>
      <div class="stop-risk-row">
        <span>波動率指數</span>
        <span class="ps-val ${riskCls}">${risk}/10 ${riskLbl}</span>
      </div>`;
  } catch (e) {
    section.style.display = 'none';
  }
}

// ── Search ────────────────────────────────────────────────
async function searchStock() {
  const input = document.getElementById('searchInput');
  const symbol = (input.value || '').trim();
  if (!symbol) return;

  const btn = document.getElementById('searchBtn');
  btn.textContent = '查詢中…';
  btn.disabled = true;
  input.disabled = true;

  try {
    const res = await fetch(`${BASE}/api/stock/${encodeURIComponent(symbol)}/summary`);
    const s   = await res.json();

    if (s.error) {
      alert(`找不到股票 ${symbol}，請確認代號正確（例如 2330）`);
      return;
    }

    input.value = '';
    openSearchDetail(s);
  } catch (e) {
    alert('查詢失敗，請稍後再試');
  } finally {
    btn.textContent = '🔍 AI 評分';
    btn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

function openSearchDetail(s) {
  _currentSymbol = s.symbol;
  if (window.innerWidth >= 1024) loadKline(s.symbol, _currentPeriod);

  document.getElementById('dtSym').textContent  = s.symbol;
  document.getElementById('dtName').textContent = s.name || s.symbol;
  const themeEl = document.getElementById('dtTheme');
  themeEl.textContent = ''; themeEl.style.display = 'none';

  document.getElementById('dtPrice').textContent = s.current?.toFixed(2) ?? '--';
  document.getElementById('dtScore').textContent = '--';

  const pbLbl = document.getElementById('dtPullbackLabel');
  const pbVal = document.getElementById('dtPullback');
  pbLbl.textContent = '今日漲跌';
  const sign = (s.change_pct ?? 0) >= 0 ? '+' : '';
  pbVal.textContent = `${sign}${s.change_pct?.toFixed(2) ?? '--'}%`;
  pbVal.className   = `ps-val ${(s.change_pct ?? 0) >= 0 ? 'up' : 'dn'}`;

  const rEl = document.getElementById('dtRisk');
  rEl.textContent = '--'; rEl.className = 'ps-val';

  const rsiLabel = (s.rsi < 30) ? '超賣區' : (s.rsi < 50) ? '低檔整理' : (s.rsi < 65) ? '中性' : '偏高';
  const macdCls  = ['黃金交叉','即將交叉','多頭'].includes(s.macd_status) ? 'gold' : '';
  const ma20sign = (s.sma20_pct ?? 0) >= 0 ? '+' : '';
  const volCls   = (s.vol_ratio ?? 1) >= 1.4 ? 'up' : (s.vol_ratio < 0.75 ? 'accent' : '');

  document.getElementById('dtReasons').innerHTML = [
    `RSI ${s.rsi?.toFixed(1) ?? '--'} · ${rsiLabel}`,
    `MACD ${escHtml(s.macd_status || '--')}`,
    `月線 ${ma20sign}${s.sma20_pct?.toFixed(1) ?? '--'}%`,
  ].map(r => `<li>${r}</li>`).join('');

  document.getElementById('dtIndicators').innerHTML = `
    <div class="ind-item"><div class="ind-label">RSI (14)</div><div class="ind-val">${s.rsi?.toFixed(1) ?? '--'} · ${rsiLabel}</div></div>
    <div class="ind-item"><div class="ind-label">MACD 狀態</div><div class="ind-val ${macdCls}">${escHtml(s.macd_status || '--')}</div></div>
    <div class="ind-item"><div class="ind-label">vs 月線 (MA20)</div><div class="ind-val ${(s.sma20_pct ?? 0) >= 0 ? 'up' : 'dn'}">${ma20sign}${s.sma20_pct?.toFixed(1) ?? '--'}%</div></div>
    <div class="ind-item"><div class="ind-label">量能比 (5/30日)</div><div class="ind-val ${volCls}">${s.vol_ratio?.toFixed(2) ?? '--'} x</div></div>
    <div class="ind-item"><div class="ind-label">現價</div><div class="ind-val">${s.current?.toFixed(2) ?? '--'}</div></div>
    <div class="ind-item"><div class="ind-label">今日漲跌</div><div class="ind-val ${(s.change_pct ?? 0) >= 0 ? 'up' : 'dn'}">${sign}${s.change_pct?.toFixed(2) ?? '--'}%</div></div>`;

  document.getElementById('dtStratSection').style.display = 'none';

  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderAIScore(s);
  loadStopLoss(s.symbol);
  loadFinancials(s.symbol);
  loadBacktest(s.symbol);
  loadHolders(s.symbol);
}

// ── Surveillance Card Builders ────────────────────────────
function buildDispositionCard(s) {
  const dLeft = s.days_left;
  const dCls  = dLeft != null && dLeft <= 3 ? 'dn' : dLeft != null && dLeft <= 7 ? 'gold' : 'blue';
  const dText = dLeft != null ? `剩 ${dLeft} 天出關` : '出關日 --';
  return `<div class="stock-card card-exit" onclick="selectStock('${escHtml(s.symbol)}')">
    <div class="risk-dot high"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name)}</div>
    <div class="card-tags" style="margin-top:6px">
      <span class="tag bear">🚫 處置中</span>
      <span class="tag ${dCls}">${dText}</span>
    </div>
    <div class="surv-dates">${escHtml(s.start)} → ${escHtml(s.end)}</div>
    ${s.reason ? `<div class="card-reason" style="color:var(--warn)">${escHtml(s.reason)}</div>` : ''}
  </div>`;
}

function buildNoticeCard(s) {
  return `<div class="stock-card" onclick="selectStock('${escHtml(s.symbol)}')">
    <div class="risk-dot medium"></div>
    <div class="card-sym">${escHtml(s.symbol)}</div>
    <div class="card-name">${escHtml(s.name)}</div>
    <div class="card-tags" style="margin-top:6px">
      <span class="tag" style="background:rgba(210,153,34,.15);color:var(--gold)">⚠ 注意</span>
      <span class="tag">${escHtml(s.date)}</span>
    </div>
    ${s.reason ? `<div class="card-reason">${escHtml(s.reason)}</div>` : ''}
  </div>`;
}

function buildConferenceItem(c) {
  const mkCls = c.market === '上市' ? 'sii' : 'otc';
  return `<div class="conf-item">
    <div class="conf-date">${escHtml(c.date)}</div>
    <div class="conf-info">
      <div class="conf-company">${escHtml(c.company)} <span class="conf-sym">${escHtml(c.symbol)}</span>
        <span class="conf-mkt ${mkCls}">${escHtml(c.market)}</span>
      </div>
      ${(c.time || c.venue) ? `<div class="conf-meta">${[c.time, c.venue].filter(Boolean).map(escHtml).join(' · ')}</div>` : ''}
    </div>
  </div>`;
}

// ── Sentiment Popup ───────────────────────────────────────
function toggleSentimentPopup() {
  const popup    = document.getElementById('sentimentPopup');
  const backdrop = document.getElementById('sentimentBackdrop');
  if (!popup) return;
  const isOpen = popup.classList.contains('open');
  if (isOpen) {
    popup.classList.remove('open');
    backdrop?.classList.remove('open');
  } else {
    popup.classList.add('open');
    backdrop?.classList.add('open');
    _fillSentimentPopup();
  }
}

function closeSentimentPopup() {
  document.getElementById('sentimentPopup')?.classList.remove('open');
  document.getElementById('sentimentBackdrop')?.classList.remove('open');
}

function _fillSentimentPopup() {
  const sd = window._sentimentData;
  const scoreEl = document.getElementById('spScore');
  const trendEl = document.getElementById('spTrend');
  const barEl   = document.getElementById('spBar');
  const gridEl  = document.getElementById('spGrid');
  if (!scoreEl || !gridEl) return;

  if (!sd) {
    gridEl.innerHTML = '<div class="sp-loading">等待資料載入…</div>';
    return;
  }

  scoreEl.textContent = sd.score;
  scoreEl.style.color = sd.level === 'green' ? '#3fb950' : sd.level === 'yellow' ? '#d29922' : '#f85149';
  if (trendEl) trendEl.textContent = sd.trend;
  if (barEl)   barEl.style.width   = `${sd.score}%`;

  const fmtBn = v => {
    if (v == null) return '--';
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}億`;
  };
  const bnCls = v => (v == null ? '' : v >= 0 ? 'up' : 'dn');

  const twii = sd.indices?.find(d => d.name === '加權指數');
  const etf  = sd.indices?.find(d => (d.name || '').includes('0050'));
  const dir  = d => d?.is_up ? '▲' : '▼';
  const dCls = d => d?.is_up ? 'up' : 'dn';

  gridEl.innerHTML = `
    ${twii ? `<div class="sp-item"><div class="sp-lbl">加權指數</div>
      <div class="sp-val ${dCls(twii)}">${dir(twii)} ${twii.change_pct?.toFixed(2) ?? '--'}%</div></div>` : ''}
    ${etf  ? `<div class="sp-item"><div class="sp-lbl">ETF 0050</div>
      <div class="sp-val ${dCls(etf)}">${dir(etf)} ${etf.change_pct?.toFixed(2) ?? '--'}%</div></div>` : ''}
    <div class="sp-item"><div class="sp-lbl">外資</div>
      <div class="sp-val ${bnCls(sd.foreign_bn)}">${fmtBn(sd.foreign_bn)}</div></div>
    <div class="sp-item"><div class="sp-lbl">投信</div>
      <div class="sp-val ${bnCls(sd.trust_bn)}">${fmtBn(sd.trust_bn)}</div></div>
    <div class="sp-item"><div class="sp-lbl">自營商</div>
      <div class="sp-val ${bnCls(sd.dealer_bn)}">${fmtBn(sd.dealer_bn)}</div></div>
    ${sd.inst_date ? `<div class="sp-item"><div class="sp-lbl">資料日期</div>
      <div class="sp-val" style="font-size:11px;color:var(--txt3)">${escHtml(sd.inst_date)}</div></div>` : ''}`;
}

// ── Utils ─────────────────────────────────────────────────
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
