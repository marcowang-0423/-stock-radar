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

# Hot themes – bonus points for being in a structural growth sector
THEME_STOCKS: Dict[str, str] = {
    '2330': 'AI先進製程', '2303': '半導體', '2454': 'AI晶片設計', '3034': 'IC設計',
    '2379': 'AI網路', '3711': '先進封測', '5483': '矽晶圓', '6488': '矽晶圓',
    '3596': 'IC設計', '2344': 'DRAM',
    '2317': 'AI伺服器', '2382': 'AI伺服器', '6669': 'AI伺服器',
    '3231': 'AI伺服器', '4938': 'AI伺服器',
    '2308': '電動車電源', '2207': '電動車', '1519': '電動車充電',
    '1590': '工業自動化', '2395': '工業電腦',
    '6505': '綠能石化', '1303': '綠能材料',
    '3037': 'ABF載板', '2376': 'AI主機板',
}

STOCK_UNIVERSE = [
    '2330', '2303', '2454', '3034', '2379', '3711', '2344', '5483', '6488', '3596',
    '2317', '2382', '2395', '2357', '3231', '3008', '6669', '4938',
    '3481', '2409', '3037',
    '2412', '4904', '3045',
    '2881', '2882', '2884', '2886', '2891', '5880', '2885',
    '1303', '1301', '1326', '6505',
    '2002', '2015',
    '2615', '2603', '2609', '2610', '2618',
    '2207', '1519', '1590', '2308',
    '2376', '2353', '6116', '2337', '2345', '2324',
]

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

def analyze_stock(symbol: str, inst_buy_set: set = None) -> Optional[Dict]:
    """
    Score a stock for pullback opportunity using three strategies:
    1. 低檔量增: RSI low + volume expansion
    2. 三大法人買超: today's institutional net buy (cross-referenced)
    3. 基本面+題材: structural theme bonus (AI, semiconductor, EV, green energy)
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

    closes = hist['Close']
    highs = hist['High']
    lows = hist['Low']
    volumes = hist['Volume']

    rsi = _calc_rsi(closes, 14)
    macd, macd_sig = _calc_macd(closes)
    sma20 = closes.rolling(20).mean()

    current = _safe(closes)
    if current is None:
        return None

    rsi_now   = _safe(rsi,      default=50.0)
    rsi_5d    = _safe(rsi, -5,  default=rsi_now)
    macd_now  = _safe(macd,     default=0.0)
    msig_now  = _safe(macd_sig, default=0.0)
    macd_3d   = _safe(macd, -3, default=macd_now)
    msig_3d   = _safe(macd_sig, -3, default=msig_now)
    sma20_now = _safe(sma20,    default=current)

    lookback = min(60, len(hist))
    high_3m = float(highs.iloc[-lookback:].max())
    low_3m  = float(lows.iloc[-lookback:].min())

    pullback_pct  = (high_3m - current) / high_3m * 100 if high_3m > 0 else 0
    recovery_pct  = (current - low_3m) / low_3m  * 100 if low_3m  > 0 else 0

    vol_5d  = float(volumes.iloc[-5:].mean())
    vol_30d = float(volumes.iloc[-30:].mean())
    vol_ratio = vol_5d / vol_30d if vol_30d > 0 else 1.0

    score = 45
    reasons = []
    strategies_hit = []

    # ── Strategy 1: 回檔深度 ─────────────────────────────────
    if pullback_pct < 5:
        score -= 35
    elif 5 <= pullback_pct < 12:
        score += 10
        reasons.append(f'小幅修正 {pullback_pct:.1f}%')
    elif 12 <= pullback_pct < 22:
        score += 25
        reasons.append(f'健康修正 {pullback_pct:.1f}%，逢低布局機會')
    elif 22 <= pullback_pct < 35:
        score += 30
        reasons.append(f'充分修正 {pullback_pct:.1f}%，超賣區間')
    else:
        score += 5
        reasons.append(f'深度修正 {pullback_pct:.1f}%，確認支撐再進')

    # RSI
    if 30 <= rsi_now < 50:
        score += 20
        if rsi_now > rsi_5d:
            score += 10
            reasons.append(f'RSI {rsi_now:.0f} 低檔回升')
        else:
            reasons.append(f'RSI {rsi_now:.0f} 低檔整理')
    elif rsi_now < 30:
        score += 8
        reasons.append(f'RSI {rsi_now:.0f} 超賣，等確認')
    elif rsi_now >= 65:
        score -= 15

    # MACD
    golden   = macd_now > msig_now and macd_3d <= msig_3d
    converge = macd_now < msig_now and abs(macd_now - msig_now) < abs(macd_3d - msig_3d) * 0.65
    if golden:
        score += 25
        reasons.append('MACD 黃金交叉')
    elif converge:
        score += 15
        reasons.append('MACD 即將黃金交叉')
    elif macd_now > msig_now:
        score += 8

    # MA20
    if sma20_now and current > sma20_now:
        score += 10
        reasons.append('站上月線')
    elif sma20_now and current > sma20_now * 0.96:
        score += 4

    # ── Strategy 2: 低檔量增 ─────────────────────────────────
    # RSI in low zone + recent volume clearly expanding
    is_low_range = rsi_now < 50 and pullback_pct > 10
    if is_low_range and vol_ratio >= 2.0:
        score += 25
        reasons.append(f'量能爆增 {vol_ratio:.1f}x，主力積極介入 📊')
        strategies_hit.append('低檔量增')
    elif is_low_range and vol_ratio >= 1.4:
        score += 15
        reasons.append(f'低檔量能放大 {vol_ratio:.1f}x，買盤增加')
        strategies_hit.append('低檔量增')
    elif vol_ratio >= 1.4:
        score += 10
        reasons.append(f'量能放大 {vol_ratio:.1f}x')
    elif vol_ratio < 0.5:
        score -= 8

    # ── Strategy 3: 三大法人買超 ─────────────────────────────
    if inst_buy_set and symbol in inst_buy_set:
        score += 20
        reasons.append('三大法人今日買超，跟隨主力方向 🏦')
        strategies_hit.append('法人買超')

    # ── Strategy 4: 基本面+題材 ──────────────────────────────
    theme = THEME_STOCKS.get(symbol)
    if theme:
        score += 12
        reasons.append(f'題材：{theme}，結構性成長')
        strategies_hit.append(f'題材:{theme}')

    # ── Final ───────────────────────────────────────────────
    final = max(0, min(100, score))
    if final < 52:
        return None

    name = STOCK_NAMES.get(symbol, symbol)

    macd_label = '黃金交叉' if golden else ('即將交叉' if converge else ('多頭' if macd_now > msig_now else '整理'))
    risk = 'low' if pullback_pct > 15 and rsi_now < 50 else ('medium' if pullback_pct > 8 else 'high')

    return {
        'symbol': symbol,
        'name': name,
        'theme': theme,
        'score': final,
        'current': round(current, 2),
        'high_3m': round(high_3m, 2),
        'pullback_pct': round(pullback_pct, 1),
        'recovery_pct': round(recovery_pct, 1),
        'rsi': round(rsi_now, 1),
        'macd_status': macd_label,
        'vol_ratio': round(vol_ratio, 2),
        'strategies': strategies_hit,
        'reasons': reasons,
        'sma20_pct': round((current - sma20_now) / sma20_now * 100, 1) if sma20_now else 0,
        'risk': risk,
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

    print(f"[Analyzer] Screening {len(STOCK_UNIVERSE)} stocks in parallel...")
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
                    print(f"  ✓ {sym} score={result['score']}")
            except Exception as e:
                print(f"  ✗ {sym}: {e}")

    results.sort(key=lambda x: x['score'], reverse=True)
    print(f"[Analyzer] Done. {len(results)} qualifying stocks.")
    return results[:8]
