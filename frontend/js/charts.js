/* ── charts.js  K-line + Volume + Institutional Chart ── */

const BASE = '';   // same origin (FastAPI serves frontend)

let _klineChart = null;
let _volChart = null;
let _candleSeries = null;
let _volSeries = null;
let _ma20Series = null;
let _ma60Series = null;
let _instChart  = null;
let _instType   = 'total';
let _instFilter = 'buy';   // 'buy' | 'sell'
let _instData   = null;
let _indicesData = null;

// ── Market Indices Ticker ────────────────────────────────
async function loadIndices() {
  try {
    const res = await fetch(`${BASE}/api/indices`);
    const json = await res.json();
    _indicesData = json.data || [];
    renderTicker(_indicesData);
    _trySentiment();
  } catch (e) {
    console.warn('indices error', e);
  }
}

function _trySentiment() {
  if (!_indicesData || !_instData || _instData.error) return;

  let score = 50;  // neutral baseline

  const twii = _indicesData.find(d => d.name === '加權指數');
  if (twii) score += Math.min(15, Math.max(-15, (twii.change_pct || 0) * 3));

  const etf50 = _indicesData.find(d => (d.name || '').includes('0050'));
  if (etf50) score += Math.min(5, Math.max(-5, (etf50.change_pct || 0) * 2));

  const s = _instData.summary || {};
  const fNet = s.foreign_total || 0;
  const tNet = s.trust_total   || 0;
  const dNet = s.dealer_total  || 0;
  score += Math.min(20, Math.max(-20, fNet / 1_000_000_000 * 2));
  score += Math.min(10, Math.max(-10, tNet / 500_000_000 * 10));

  score = Math.round(Math.max(0, Math.min(100, score)));

  let cls, text;
  if      (score >= 65) { cls = 'green';  text = '市場偏多'; }
  else if (score >= 40) { cls = 'yellow'; text = '中性觀望'; }
  else                  { cls = 'red';    text = '市場偏空'; }

  const dot = document.getElementById('sentimentDot');
  const lbl = document.getElementById('sentimentLabel');
  if (!dot || !lbl) return;

  dot.className = `sentiment-dot ${cls}`;
  lbl.className = `sentiment-label ${cls}`;
  lbl.textContent = `${text} ${score}`;

  window._sentimentData = {
    score, trend: text, level: cls,
    indices:    _indicesData,
    foreign_bn: +((fNet / 1e8).toFixed(1)),
    trust_bn:   +((tNet / 1e8).toFixed(1)),
    dealer_bn:  +((dNet / 1e8).toFixed(1)),
    inst_date:  _instData.date,
  };
}

function renderTicker(items) {
  const bar = document.getElementById('tickerBar');
  if (!items.length) { bar.innerHTML = '<span class="ticker-loading">市場資料暫不可用</span>'; return; }
  bar.innerHTML = items.map(d => {
    const cls = d.is_up ? 'up' : 'dn';
    const arrow = d.is_up ? '▲' : '▼';
    const sign = d.change >= 0 ? '+' : '';
    return `<div class="ticker-item ${cls}">
      <span class="ticker-name">${d.name}</span>
      <span class="ticker-val">${d.current.toLocaleString()}</span>
      <span class="ticker-chg">${arrow}${sign}${d.change_pct.toFixed(2)}%</span>
    </div>`;
  }).join('');
}

// ── K-Line Chart ─────────────────────────────────────────
function _initKline() {
  const container = document.getElementById('klineChart');
  // Clear previous hint / chart
  const hint = container.querySelector('.chart-hint');
  if (hint) hint.remove();

  if (_klineChart) { _klineChart.remove(); _klineChart = null; }

  _klineChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { color: 'transparent' },
      textColor: '#8b949e',
    },
    grid: {
      vertLines: { color: '#21262d' },
      horzLines: { color: '#21262d' },
    },
    crosshair: {
      vertLine: { color: '#388bfd55' },
      horzLine: { color: '#388bfd55' },
    },
    rightPriceScale: {
      borderColor: '#30363d',
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: '#30363d',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // Use Taiwan convention: up=red, down=green
  _candleSeries = _klineChart.addCandlestickSeries({
    upColor: '#f85149',
    downColor: '#3fb950',
    borderUpColor: '#f85149',
    borderDownColor: '#3fb950',
    wickUpColor: '#f85149',
    wickDownColor: '#3fb950',
  });

  _ma20Series = _klineChart.addLineSeries({
    color: '#d29922',
    lineWidth: 1,
    title: 'MA20',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  _ma60Series = _klineChart.addLineSeries({
    color: '#388bfd',
    lineWidth: 1,
    title: 'MA60',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // Volume chart below
  const volContainer = document.getElementById('volChart');
  volContainer.style.display = 'block';
  if (_volChart) { _volChart.remove(); _volChart = null; }

  _volChart = LightweightCharts.createChart(volContainer, {
    width: volContainer.clientWidth,
    height: volContainer.clientHeight,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e' },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { borderColor: '#30363d', scaleMargins: { top: 0.05, bottom: 0 } },
    timeScale: { borderColor: '#30363d', visible: false },
    handleScroll: false,
    handleScale: false,
  });

  _volSeries = _volChart.addHistogramSeries({
    color: '#388bfd55',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });

  // Sync time ranges
  _klineChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range && _volChart) _volChart.timeScale().setVisibleLogicalRange(range);
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (_klineChart) _klineChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    if (_volChart) _volChart.applyOptions({ width: volContainer.clientWidth });
  });
  ro.observe(container);
  ro.observe(volContainer);
}

async function loadKline(symbol, period = '3mo') {
  try {
    const res = await fetch(`${BASE}/api/stock/${symbol}/kline?period=${period}`);
    const data = await res.json();

    if (data.error) {
      console.warn('kline error', data.error);
      return;
    }

    _initKline();

    // Feed data
    const candles = data.candles || [];
    _candleSeries.setData(candles.map(c => ({
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    if (data.ma20?.length) _ma20Series.setData(data.ma20.map(p => ({ time: p.time, value: p.value })));
    if (data.ma60?.length) _ma60Series.setData(data.ma60.map(p => ({ time: p.time, value: p.value })));

    // Volume histogram – color by candle direction
    const volData = candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? '#f8514966' : '#3fb95066',
    }));
    _volSeries.setData(volData);

    _klineChart.timeScale().fitContent();

    // Update header
    document.getElementById('chartTitle').textContent = `${symbol} ${data.name || ''}`;
    const metaEl = document.getElementById('stockMeta');
    const priceEl = document.getElementById('metaPrice');
    const chgEl   = document.getElementById('metaChange');
    metaEl.style.display = 'flex';
    priceEl.textContent = data.current?.toFixed(2) || '--';
    const pct = data.change_pct || 0;
    chgEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    chgEl.className = 'meta-change ' + (pct >= 0 ? 'up' : 'dn');

    loadInstHistory(symbol);  // overlay institutional markers

  } catch (e) {
    console.error('loadKline', e);
  }
}

async function loadInstHistory(symbol) {
  if (!_candleSeries) return;
  try {
    const res  = await fetch(`${BASE}/api/stock/${symbol}/inst-history`);
    const data = await res.json();
    if (!data.history?.length) return;
    if (typeof _currentSymbol !== 'undefined' && _currentSymbol !== symbol) return;

    const history = data.history;
    // Pick top 8 most significant days by |foreign_net|
    const sorted = [...history].sort((a, b) => Math.abs(b.foreign_net) - Math.abs(a.foreign_net));
    const top = sorted.slice(0, 8);

    const markers = top
      .filter(r => r.foreign_net !== 0)
      .map(r => {
        const isBuy = r.foreign_net > 0;
        const k = Math.round(Math.abs(r.foreign_net) / 1000);
        return {
          time:     r.date,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color:    isBuy ? '#f85149' : '#3fb950',
          shape:    isBuy ? 'arrowUp' : 'arrowDown',
          text:     isBuy ? `+${k}K` : `-${k}K`,
        };
      })
      .sort((a, b) => (a.time > b.time ? 1 : -1));  // must be chronological

    _candleSeries.setMarkers(markers);
  } catch (e) {
    console.warn('loadInstHistory', e);
  }
}

// ── Institutional Chart ───────────────────────────────────
function switchInst(type, btn) {
  _instType = type;
  document.querySelectorAll('.panel-inst .tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  if (_instData) _renderInstChart(_instData);
}

function switchInstFilter(filter, btn) {
  _instFilter = filter;
  document.querySelectorAll('.inst-filter-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (_instData) _renderInstChart(_instData);
}

function _renderInstChart(data) {
  const allRows = data.stocks || data.top_buy || [];
  const key = _instType === 'foreign' ? 'foreign_net'
             : _instType === 'trust'   ? 'trust_net'
             : 'total_net';

  // Update filter button counts
  const buyCount  = allRows.filter(r => (r[key] || 0) > 0).length;
  const sellCount = allRows.filter(r => (r[key] || 0) < 0).length;
  const btnBuy  = document.getElementById('btnInstBuy');
  const btnSell = document.getElementById('btnInstSell');
  if (btnBuy)  btnBuy.textContent  = `買超 ${buyCount}`;
  if (btnSell) btnSell.textContent = `賣超 ${sellCount}`;

  // Update list column header
  const listHdr = document.getElementById('instListHeaderVal');
  if (listHdr) listHdr.textContent = _instFilter === 'buy' ? '買超(千股)' : '賣超(千股)';

  // Filter and sort by buy/sell
  let filtered;
  if (_instFilter === 'buy') {
    filtered = allRows.filter(r => (r[key] || 0) > 0).sort((a, b) => (b[key] || 0) - (a[key] || 0));
  } else {
    filtered = allRows.filter(r => (r[key] || 0) < 0).sort((a, b) => (a[key] || 0) - (b[key] || 0));
  }
  const sorted = filtered.slice(0, 8);

  const labels = sorted.map(r => r.name || r.symbol);
  const values = sorted.map(r => Math.round((r[key] || 0) / 1000));  // → 千股
  const colors = values.map(v => v >= 0 ? 'rgba(248,81,73,.75)' : 'rgba(63,185,80,.75)');

  const wrap = document.querySelector('.inst-chart-wrap');
  if (!wrap) return;

  if (_instChart) { _instChart.destroy(); _instChart = null; }

  // Replace canvas and set explicit height so Chart.js never gets 0-height canvas
  wrap.innerHTML = '<canvas id="instChart"></canvas>';
  const ctx = document.getElementById('instChart');
  const wrapH = wrap.clientHeight || 160;
  ctx.style.height = wrapH + 'px';
  ctx.style.width = '100%';

  _instChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 3, borderSkipped: false }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.x >= 0 ? '買超' : '賣超'} ${Math.abs(ctx.parsed.x).toLocaleString()} 千股`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#484f58', font: { size: 10 } },
          grid: { color: '#21262d' },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8b949e', font: { size: 11 } },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  });

  // Force resize after DOM paints to pick up any final layout dimensions
  requestAnimationFrame(() => { if (_instChart) _instChart.resize(); });

  _renderInstList(sorted, key);
}

function _renderInstList(rows, key) {
  const list = document.getElementById('instList');
  if (!rows.length) { list.innerHTML = '<div class="loading-text">今日無資料</div>'; return; }

  list.innerHTML = rows.map(r => {
    const val = Math.round((r[key] || 0) / 1000);
    const cls = val >= 0 ? 'up' : 'dn';
    const sign = val >= 0 ? '+' : '';
    return `<div class="inst-row">
      <span class="inst-sym">${r.symbol}</span>
      <span class="inst-name">${r.name}</span>
      <span class="inst-val ${cls}">${sign}${val.toLocaleString()}</span>
    </div>`;
  }).join('');
}

async function loadInstitutional() {
  try {
    const res = await fetch(`${BASE}/api/institutional`);
    _instData = await res.json();

    if (_instData.error) {
      document.getElementById('instList').innerHTML = `<div class="loading-text">${_instData.error}</div>`;
      return;
    }

    // Summary
    const s = _instData.summary || {};
    const fmt = v => {
      const k = Math.round((v || 0) / 1000);
      const sign = k >= 0 ? '+' : '';
      return { text: `${sign}${k.toLocaleString()}`, cls: k >= 0 ? 'up' : 'dn' };
    };
    const f = fmt(s.foreign_total);
    const t = fmt(s.trust_total);
    const d = fmt(s.dealer_total);
    document.getElementById('sumForeign').textContent = f.text;
    document.getElementById('sumForeign').className = `sum-val ${f.cls}`;
    document.getElementById('sumTrust').textContent = t.text;
    document.getElementById('sumTrust').className = `sum-val ${t.cls}`;
    document.getElementById('sumDealer').textContent = d.text;
    document.getElementById('sumDealer').className = `sum-val ${d.cls}`;

    _trySentiment();

    // On mobile, only render the chart if the inst panel is currently visible.
    // If hidden, showPage('inst') will trigger _renderInstChart when user switches tabs.
    const panel = document.getElementById('pageInst');
    const panelVisible = window.innerWidth >= 1024 || (panel && panel.classList.contains('m-on'));
    if (panelVisible) {
      _renderInstChart(_instData);
    }
  } catch (e) {
    console.error('loadInstitutional', e);
    document.getElementById('instList').innerHTML = '<div class="loading-text">連線失敗</div>';
  }
}
