import yfinance as yf
import pandas as pd
import numpy as np
import concurrent.futures
from typing import Optional, Dict, List
import warnings
warnings.filterwarnings('ignore')

STOCK_NAMES = {
    '2330': '台積電', '2317': '鴻海', '2454': '聯發科', '2412': '中華電',
    '2308': '台達電', '2382': '廣達', '2303': '聯電', '2881': '富邦金',
    '2882': '國泰金', '2884': '玉山金', '2886': '兆豐金', '2891': '中信金',
    '5880': '合庫金', '2885': '元大金', '2888': '新光金',
    '1301': '台塑', '1303': '南亞', '1326': '台化', '6505': '台塑化',
    '2002': '中鋼', '2015': '豐興',
    '2603': '長榮', '2609': '陽明', '2615': '萬海', '2610': '華航', '2618': '長榮航',
    '2207': '和泰車', '1519': '華城', '1590': '亞德客',
    '3711': '日月光投控', '3034': '聯詠', '2379': '瑞昱', '2344': '華邦電',
    '5483': '中美晶', '6488': '環球晶', '3596': '智原',
    '2395': '研華', '2357': '華碩', '3231': '緯創', '6669': '緯穎',
    '3008': '大立光', '2376': '技嘉',
    '3481': '群創', '2409': '友達', '3037': '欣興',
    '4904': '遠傳', '3045': '台灣大',
    '2353': '宏碁', '4938': '和碩', '6116': '彩晶',
    '2337': '旺宏', '2345': '智邦', '2324': '仁寶',
}

# 題材股（概念股）：因特定產業趨勢、政策利多或市場熱點而受資金追捧
THEME_STOCKS: Dict[str, str] = {
    '2330': 'AI先進製程', '2303': '半導體', '2454': 'AI晶片設計', '3034': 'IC設計',
    '2379': 'AI網路晶片', '3711': '先進封測', '5483': '矽晶圓', '6488': '矽晶圓',
    '3596': 'IC設計', '2344': 'DRAM',
    '2317': 'AI伺服器', '2382': 'AI伺服器', '6669': 'AI伺服器',
    '3231': 'AI伺服器', '4938': 'AI伺服器',
    '2308': '電動車電源', '2207': '電動車', '1519': '電動車充電',
    '1590': '工業自動化', '2395': '工業電腦',
    '6505': '綠能石化', '1303': '綠能材料',
    '3037': 'ABF載板', '2376': 'AI主機板',
    '3008': '光學精密', '2345': '網通設備',
}

# 篩選範圍：以題材股為主，兼顧部分高 beta 個股
STOCK_UNIVERSE = list(THEME_STOCKS.keys())

def _calc_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def _calc_macd(prices: pd.Series, fast=12, slow=26, sig=9):
    ema_f = prices.ewm(span=fast, adjust=False).mean()
    ema_s = prices.ewm(span=slow, adjust=False).mean()
    macd = ema_f - ema_s
    signal = macd.ewm(span=sig, adjust=False).mean()
    return macd, signal

def _safe(series, idx=-1, default=None):
    try:
        v = series.iloc[idx]
        return float(v) if not pd.isna(v) else default
    except Exception:
        return default

def _fetch_hist(symbol: str, period: str = "3mo", min_bars: int = 20):
    """Shared helper: fetch OHLCV for a Taiwan stock."""
    for suffix in ['.TW', '.TWO']:
        try:
            t = yf.Ticker(f"{symbol}{suffix}")
            h = t.history(period=period, interval="1d", auto_adjust=True)
            if not h.empty and len(h) >= min_bars:
                return h
        except Exception:
            continue
    return None


def analyze_stock(symbol: str, inst_buy_set: set = None) -> Optional[Dict]:
    """
    識別「飆股回檔」買點：
    1. 必須是題材股（概念股）
    2. 股票近期曾大幅飆漲（漲幅 >= 12%）
    3. 目前從高點回檔整理（回檔 3-45%）
    4. 回檔幅度 < 漲升波段一半（Fibonacci < 0.618）
    5. 多頭結構仍在（守住均線）
    """
    hist = None
    for suffix in ['.TW', '.TWO']:
        try:
            t = yf.Ticker(f"{symbol}{suffix}")
            h = t.history(period="6mo", interval="1d", auto_adjust=True)
            if not h.empty and len(h) >= 40:
                hist = h
                break
        except Exception:
            continue

    if hist is None:
        return None

    # ── 基本資格：僅推薦題材股 ────────────────────────────────
    theme = THEME_STOCKS.get(symbol)
    if not theme:
        return None

    closes  = hist['Close']
    volumes = hist['Volume']

    rsi         = _calc_rsi(closes, 14)
    macd, macd_sig = _calc_macd(closes)
    sma10 = closes.rolling(10).mean()
    sma21 = closes.rolling(21).mean()
    sma60 = closes.rolling(60).mean()

    current = _safe(closes)
    if current is None:
        return None

    rsi_now   = _safe(rsi,      default=50.0)
    rsi_5d    = _safe(rsi, -5,  default=rsi_now)
    macd_now  = _safe(macd,     default=0.0)
    msig_now  = _safe(macd_sig, default=0.0)
    macd_3d   = _safe(macd, -3, default=macd_now)
    msig_3d   = _safe(macd_sig, -3, default=msig_now)
    sma10_now = _safe(sma10, default=current)
    sma21_now = _safe(sma21, default=current)
    sma60_now = _safe(sma60, default=current)

    # ── 飆股識別：找到近期漲升波段 ────────────────────────────
    # 在最近 63 個交易日（約 3 個月）中找到高點
    lookback   = min(63, len(hist))
    recent_arr = closes.values[-lookback:]

    peak_pos   = int(np.argmax(recent_arr))          # 高點在 recent_arr 中的位置
    peak_price = float(recent_arr[peak_pos])

    # 高點之前最多 30 天內找低點（漲升起點）
    pre_start      = max(0, peak_pos - 30)
    pre_peak_slice = recent_arr[pre_start:peak_pos] if peak_pos > 0 else recent_arr[:1]
    pre_peak_low   = float(pre_peak_slice.min()) if len(pre_peak_slice) > 0 else current

    rally_wave   = peak_price - pre_peak_low
    rally_pct    = rally_wave / pre_peak_low * 100 if pre_peak_low > 0 else 0

    pullback_wave = peak_price - current
    pullback_pct  = pullback_wave / peak_price * 100 if peak_price > 0 else 0

    # Fibonacci 回測比例（回吐了多少漲幅）
    fib_ratio = pullback_wave / rally_wave if rally_wave > 0 else 1.0

    vol_5d    = float(volumes.iloc[-5:].mean())
    vol_30d   = float(volumes.iloc[-30:].mean())
    vol_ratio = vol_5d / vol_30d if vol_30d > 0 else 1.0

    # ── 基本資格篩選 ──────────────────────────────────────────
    if rally_pct < 12:       # 沒有足夠的飆漲幅度，不算飆股
        return None
    if pullback_pct < 3:     # 尚未回檔，追高風險高
        return None
    if pullback_pct > 45:    # 回檔過深，多頭結構已受損
        return None
    if fib_ratio > 0.68:     # 回吐超過 68%，強勢特質消失
        return None

    score     = 30  # 基礎分（已通過飆股基本資格）
    reasons   = []
    strategies_hit = []

    # ── 1. 回檔深度評分 ────────────────────────────────────────
    if 3 <= pullback_pct < 8:
        score += 10
        reasons.append(f'小幅回檔 {pullback_pct:.1f}%，強勢整理蓄勢')
    elif 8 <= pullback_pct < 18:
        score += 22
        reasons.append(f'健康回檔 {pullback_pct:.1f}%，逢低布局機會')
    elif 18 <= pullback_pct < 30:
        score += 25
        reasons.append(f'充分修正 {pullback_pct:.1f}%，洗盤完成機率高')
    elif 30 <= pullback_pct <= 45:
        score += 15
        reasons.append(f'深度回檔 {pullback_pct:.1f}%，確認支撐後再進場')

    # ── 2. Fibonacci 回測比例 ──────────────────────────────────
    if fib_ratio <= 0.382:
        score += 28
        reasons.append(f'回測僅 {fib_ratio*100:.0f}% 漲幅，主力護盤力道極強 💪')
        strategies_hit.append('淺回測')
    elif fib_ratio <= 0.5:
        score += 20
        reasons.append(f'回測 {fib_ratio*100:.0f}%，未逾漲幅一半，多頭格局未變')
        strategies_hit.append('淺回測')
    elif fib_ratio <= 0.618:
        score += 10
        reasons.append(f'回測至黃金分割位 ({fib_ratio*100:.0f}%)，關鍵支撐待確認')

    # ── 3. 均線支撐 ────────────────────────────────────────────
    above_10d = sma10_now is not None and current >= sma10_now
    above_21d = sma21_now is not None and current >= sma21_now
    above_60d = sma60_now is not None and current >= sma60_now

    if above_10d:
        score += 20
        reasons.append('守穩10日均線，短線多頭結構完整')
        strategies_hit.append('均線守支撐')
    elif above_21d:
        score += 12
        reasons.append('守穩21日月線，中線洗盤整理，主力尚未出場')
        strategies_hit.append('均線守支撐')
    elif above_60d:
        score += 5
        reasons.append('守穩60日季線，長線多頭仍在')
    else:
        score -= 10  # 跌破季線，謹慎

    # ── 4. 題材股加分 ──────────────────────────────────────────
    score += 15
    reasons.append(f'題材：{theme}，具備結構性成長動能')
    strategies_hit.append(f'題材:{theme}')

    # ── 5. RSI ─────────────────────────────────────────────────
    if 25 <= rsi_now < 50:
        if rsi_now > rsi_5d:
            score += 15
            reasons.append(f'RSI {rsi_now:.0f} 低檔回升，動能轉強')
        else:
            score += 8
            reasons.append(f'RSI {rsi_now:.0f} 低檔整理中')
    elif rsi_now < 25:
        score += 5
        reasons.append(f'RSI {rsi_now:.0f} 超賣區，等待確認訊號')
    elif rsi_now >= 70:
        score -= 8  # 回檔後 RSI 仍高，賣壓未減

    # ── 6. MACD ────────────────────────────────────────────────
    golden   = macd_now > msig_now and macd_3d <= msig_3d
    converge = macd_now < msig_now and abs(macd_now - msig_now) < abs(macd_3d - msig_3d) * 0.65

    if golden:
        score += 18
        reasons.append('MACD 黃金交叉，動能翻多')
    elif converge:
        score += 10
        reasons.append('MACD 趨近黃金交叉，底部蓄力')
    elif macd_now > msig_now:
        score += 5

    # ── 7. 量能型態 ────────────────────────────────────────────
    # 縮量回檔 = 健康洗盤（賣壓輕）
    # 低檔量增 = 買盤進場（主動買入）
    if pullback_pct > 5 and vol_ratio < 0.75:
        score += 15
        reasons.append(f'回檔縮量 ({vol_ratio:.1f}x)，賣壓輕微，洗盤健康')
        strategies_hit.append('縮量回檔')
    elif vol_ratio >= 1.5 and rsi_now < 55:
        score += 12
        reasons.append(f'低檔量能放大 ({vol_ratio:.1f}x)，買盤積極進場')
        strategies_hit.append('低檔量增')
    elif vol_ratio >= 2.0:
        score += 6
        reasons.append(f'量能爆增 ({vol_ratio:.1f}x)')
    elif vol_ratio < 0.5:
        score -= 5  # 量能極度萎縮

    # ── 8. 三大法人買超 ────────────────────────────────────────
    if inst_buy_set and symbol in inst_buy_set:
        score += 12
        reasons.append('三大法人今日買超，主力持續佈局 🏦')
        strategies_hit.append('法人買超')

    # ── Final ──────────────────────────────────────────────────
    final = max(0, min(100, score))
    if final < 55:
        return None

    macd_label = ('黃金交叉' if golden else
                  '即將交叉' if converge else
                  '多頭'     if macd_now > msig_now else '整理')

    # 風險評估：回檔深 + 守均線 + 淺回測 = 低風險
    if pullback_pct > 12 and fib_ratio <= 0.5 and (above_10d or above_21d):
        risk = 'low'
    elif pullback_pct > 5 and (above_21d or above_60d):
        risk = 'medium'
    else:
        risk = 'high'

    return {
        'symbol':       symbol,
        'name':         STOCK_NAMES.get(symbol, symbol),
        'theme':        theme,
        'score':        final,
        'current':      round(current, 2),
        'high_3m':      round(peak_price, 2),
        'pullback_pct': round(pullback_pct, 1),
        'rally_pct':    round(rally_pct, 1),
        'fib_ratio':    round(fib_ratio, 3),
        'rsi':          round(rsi_now, 1),
        'macd_status':  macd_label,
        'vol_ratio':    round(vol_ratio, 2),
        'strategies':   strategies_hit,
        'reasons':      reasons,
        'sma20_pct':    round((current - sma21_now) / sma21_now * 100, 1) if sma21_now else 0,
        'risk':         risk,
    }


def get_daily_recommendations() -> List[Dict]:
    inst_buy_set: set = set()
    try:
        from data_fetcher import fetch_institutional_data
        inst = fetch_institutional_data()
        if not inst.get('error'):
            inst_buy_set = {
                r['symbol'] for r in inst.get('top_buy', [])
                if r.get('total_net', 0) > 0
            }
            print(f"[Analyzer] Institutional buy set: {len(inst_buy_set)} stocks")
    except Exception as e:
        print(f"[Analyzer] Could not load institutional data: {e}")

    print(f"[Analyzer] Screening {len(STOCK_UNIVERSE)} theme stocks in parallel...")
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(analyze_stock, sym, inst_buy_set): sym for sym in STOCK_UNIVERSE}
        done, pending = concurrent.futures.wait(futures, timeout=90)
        for f in pending:
            f.cancel()
        for f in done:
            sym = futures[f]
            try:
                result = f.result(timeout=2)
                if result:
                    results.append(result)
                    print(f"  ✓ {sym} score={result['score']} rally={result['rally_pct']}% pb={result['pullback_pct']}%")
            except Exception as e:
                print(f"  ✗ {sym}: {e}")

    results.sort(key=lambda x: x['score'], reverse=True)
    print(f"[Analyzer] Done. {len(results)} qualifying stocks.")
    return results[:8]


def _parallel_screen(fn, timeout=60) -> List[Dict]:
    """Run fn(symbol) for all STOCK_UNIVERSE in parallel, collect non-None results."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(fn, sym): sym for sym in STOCK_UNIVERSE}
        done, _ = concurrent.futures.wait(futs, timeout=timeout)
        results = []
        for f in done:
            try:
                r = f.result(timeout=2)
                if r:
                    results.append(r)
            except Exception:
                pass
    return results


def screen_entry_timing() -> List[Dict]:
    """進場時機：回檔均線 + 價格轉強 + 成交量放大"""
    def _analyze(symbol):
        hist = _fetch_hist(symbol)
        if hist is None or len(hist) < 21:
            return None
        closes, volumes, opens = hist['Close'], hist['Volume'], hist['Open']
        current    = float(closes.iloc[-1])
        prev_close = float(closes.iloc[-2])
        cur_open   = float(opens.iloc[-1])
        sma10_now  = _safe(closes.rolling(10).mean(), default=current)
        sma21_now  = _safe(closes.rolling(21).mean(), default=current)
        n          = min(30, len(volumes))
        vol_ratio  = float(volumes.iloc[-1]) / (float(volumes.iloc[-n:].mean()) or 1)

        near_10   = sma10_now and abs(current - sma10_now) / sma10_now < 0.035
        near_21   = sma21_now and abs(current - sma21_now) / sma21_now < 0.035
        reversal  = current > prev_close
        vol_surge = vol_ratio >= 1.3

        if not ((near_10 or near_21) and reversal and vol_surge):
            return None

        ma_label   = '10日均線' if near_10 else '21日月線'
        change_pct = (current - prev_close) / prev_close * 100
        score      = 55 + (15 if near_10 else 8) + (15 if vol_ratio >= 1.5 else 5) + (5 if current > cur_open else 0)
        return {
            'symbol': symbol, 'name': STOCK_NAMES.get(symbol, symbol),
            'theme': THEME_STOCKS.get(symbol, ''), 'current': round(current, 2),
            'change_pct': round(change_pct, 2), 'vol_ratio': round(vol_ratio, 2),
            'ma_label': ma_label, 'score': min(100, score),
            'reasons': [
                f'回測至{ma_label}，守住關鍵支撐',
                f'價格轉強（+{change_pct:.1f}%），今收 {current:.2f}',
                f'成交量放大 {vol_ratio:.1f}x，買盤積極進場',
            ],
            'risk': 'low' if near_10 and vol_ratio >= 1.5 else 'medium',
        }

    results = _parallel_screen(_analyze)
    results.sort(key=lambda x: x['score'], reverse=True)
    print(f'[Entry] {len(results)} stocks with entry timing signals')
    return results[:8]


def screen_add_position() -> List[Dict]:
    """加碼時機：帶量紅K棒 + 波段創新高"""
    def _analyze(symbol):
        hist = _fetch_hist(symbol, period="6mo", min_bars=40)
        if hist is None:
            return None
        closes, opens, volumes = hist['Close'], hist['Open'], hist['Volume']
        current   = float(closes.iloc[-1])
        cur_open  = float(opens.iloc[-1])
        n         = min(30, len(volumes))
        vol_ratio = float(volumes.iloc[-1]) / (float(volumes.iloc[-n:].mean()) or 1)
        look      = min(63, len(closes))
        high_63   = float(closes.iloc[-look:].max())

        if not (current > cur_open and vol_ratio >= 1.4 and current >= high_63 * 0.97):
            return None

        at_new_high = current >= high_63 * 0.99
        score = 60 + (15 if vol_ratio >= 2.0 else 10 if vol_ratio >= 1.5 else 5) + (20 if at_new_high else 10)
        return {
            'symbol': symbol, 'name': STOCK_NAMES.get(symbol, symbol),
            'theme': THEME_STOCKS.get(symbol, ''), 'current': round(current, 2),
            'vol_ratio': round(vol_ratio, 2), 'high_63': round(high_63, 2),
            'at_new_high': at_new_high, 'score': min(100, score),
            'reasons': [
                f'帶量紅K棒，量比 {vol_ratio:.1f}x，主力積極買入',
                f'接近波段高點 {high_63:.2f}（距高點 {(high_63-current)/high_63*100:.1f}%）',
            ] + (['突破近期高點，波段創新高確認'] if at_new_high else []),
            'risk': 'medium',
        }

    results = _parallel_screen(_analyze)
    results.sort(key=lambda x: x['score'], reverse=True)
    print(f'[AddPos] {len(results)} stocks with add-position signals')
    return results[:8]


def screen_exit_warnings() -> List[Dict]:
    """出場警示：帶量黑K + 跌破均線 + 利多出盡"""
    def _analyze(symbol):
        hist = _fetch_hist(symbol)
        if hist is None or len(hist) < 10:
            return None
        closes, opens, volumes = hist['Close'], hist['Open'], hist['Volume']
        current    = float(closes.iloc[-1])
        cur_open   = float(opens.iloc[-1])
        prev_close = float(closes.iloc[-2])
        n          = min(30, len(volumes))
        vol_ratio  = float(volumes.iloc[-1]) / (float(volumes.iloc[-n:].mean()) or 1)

        rsi_now   = _safe(_calc_rsi(closes, 14), default=50.0)
        sma5_now  = _safe(closes.rolling(5).mean(),  default=current)
        sma10_now = _safe(closes.rolling(10).mean(), default=current)

        is_black   = current < cur_open
        high_vol   = vol_ratio >= 1.3
        below_ma5  = current < sma5_now
        below_ma10 = current < sma10_now
        overbought = rsi_now >= 72
        is_down    = current < prev_close

        signals = sum([is_black and high_vol, below_ma5, below_ma10, overbought])
        if signals < 2 or not is_down:
            return None

        warnings = []
        if is_black and high_vol: warnings.append(f'帶量黑K，量比 {vol_ratio:.1f}x，賣壓沉重')
        if below_ma5:  warnings.append(f'跌破5日線（{sma5_now:.2f}），短線轉弱')
        if below_ma10: warnings.append(f'跌破10日線（{sma10_now:.2f}），趨勢轉向警示')
        if overbought: warnings.append(f'RSI {rsi_now:.0f} 超買，利多恐已反映')

        return {
            'symbol': symbol, 'name': STOCK_NAMES.get(symbol, symbol),
            'theme': THEME_STOCKS.get(symbol, ''), 'current': round(current, 2),
            'change_pct': round((current - prev_close) / prev_close * 100, 2),
            'vol_ratio': round(vol_ratio, 2), 'rsi': round(rsi_now, 1),
            'score': 40 + signals * 15, 'warnings': warnings, 'risk': 'high',
        }

    results = _parallel_screen(_analyze)
    results.sort(key=lambda x: x['score'], reverse=True)
    print(f'[Exit] {len(results)} stocks with exit warnings')
    return results[:8]


def screen_pe_value() -> List[Dict]:
    """本益比篩選：10–15倍合理估值區間"""
    def _fetch(symbol):
        for suffix in ['.TW', '.TWO']:
            try:
                t    = yf.Ticker(f"{symbol}{suffix}")
                info = t.info
                pe   = info.get('trailingPE') or info.get('forwardPE')
                if not pe or not (10 <= float(pe) <= 15):
                    return None
                pe    = float(pe)
                price = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose')
                eps   = info.get('trailingEps') or info.get('forwardEps')
                return {
                    'symbol': symbol, 'name': STOCK_NAMES.get(symbol, symbol),
                    'theme': THEME_STOCKS.get(symbol, ''),
                    'current': round(float(price), 2) if price else None,
                    'pe': round(pe, 1),
                    'eps': round(float(eps), 2) if eps else None,
                    'reasons': [
                        f'本益比 {pe:.1f} 倍，落在合理估值區間（10–15倍）',
                        '股價未過度反映預期，具安全邊際',
                    ],
                    'risk': 'low',
                }
            except Exception:
                continue
        return None

    results = _parallel_screen(_fetch, timeout=90)
    results.sort(key=lambda x: x['pe'])
    print(f'[PE] {len(results)} stocks in PE 10-15x range')
    return results
