import os
import requests
import yfinance as yf
import pandas as pd
import concurrent.futures
from collections import Counter
from datetime import datetime, timedelta

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
}

FINMIND_TOKEN = os.environ.get('FINMIND_TOKEN', '')


def _finmind_get(url_base: str, timeout: int = 12) -> dict:
    """Call FinMind API, log non-200 responses, return body dict."""
    url = url_base + FINMIND_TOKEN
    try:
        resp = requests.get(url, timeout=timeout, headers=HEADERS)
        body = resp.json()
        if body.get('status') != 200:
            print(f'[FinMind] status={body.get("status")} msg={body.get("msg","?")} token_set={bool(FINMIND_TOKEN)}')
        return body
    except Exception as e:
        print(f'[FinMind] request error: {e}')
        return {}


# Theme stocks to track for 三大法人 panel
_INST_SYMBOLS = [
    '2330', '2303', '2454', '3034', '2379', '3711', '5483', '6488',
    '3596', '2344', '2317', '2382', '6669', '3231', '4938',
    '2308', '2207', '1519', '1590', '2395', '6505', '1303',
    '3037', '2376', '3008', '2345',
]


def fetch_institutional_data(date: str = None) -> dict:
    """Fetch 三大法人 data from FinMind API for theme stocks.
    TWSE T86 endpoint was deprecated; FinMind provides per-stock institutional trading data.
    """
    from analyzer import STOCK_NAMES

    # FinMind uses YYYY-MM-DD; accept YYYYMMDD from legacy callers
    if date and len(date) == 8 and date.isdigit():
        start_date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    elif date:
        start_date = date
    else:
        start_date = (datetime.now() - timedelta(days=10)).strftime('%Y-%m-%d')

    def _fetch_single(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None

            records = body['data']
            latest_date = max(r['date'] for r in records)
            day_recs = [r for r in records if r['date'] == latest_date]

            foreign_net = trust_net = dealer_net = 0
            for r in day_recs:
                net = r['buy'] - r['sell']
                name = r['name']
                if name in ('Foreign_Investor', 'Foreign_Dealer_Self'):
                    foreign_net += net
                elif name == 'Investment_Trust':
                    trust_net = net
                elif name in ('Dealer_self', 'Dealer_Hedging'):
                    dealer_net += net

            return {
                'symbol': symbol,
                'name': STOCK_NAMES.get(symbol, symbol),
                'foreign_net': foreign_net,
                'trust_net': trust_net,
                'dealer_net': dealer_net,
                'total_net': foreign_net + trust_net + dealer_net,
                'date': latest_date,
            }
        except Exception as e:
            print(f'FinMind inst error {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_fetch_single, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=45)
        rows = []
        for f in done:
            try:
                r = f.result(timeout=2)
                if r:
                    rows.append(r)
            except Exception:
                pass

    if not rows:
        return {'error': '無法取得三大法人資料，可能為假日或休市', 'date': date}

    # Align to the most common date (latest trading day)
    best_date = Counter(r['date'] for r in rows).most_common(1)[0][0]
    rows = [r for r in rows if r['date'] == best_date]
    rows.sort(key=lambda x: x['total_net'], reverse=True)

    summary = {
        'foreign_total': sum(r['foreign_net'] for r in rows),
        'trust_total':   sum(r['trust_net']   for r in rows),
        'dealer_total':  sum(r['dealer_net']  for r in rows),
        'buy_count':  sum(1 for r in rows if r['total_net'] > 0),
        'sell_count': sum(1 for r in rows if r['total_net'] < 0),
    }

    print(f'[Inst] {best_date}: {len(rows)} stocks, buy={summary["buy_count"]} sell={summary["sell_count"]}')

    return {
        'date':     best_date,
        'stocks':   rows,                                              # all rows sorted by total_net desc
        'top_buy':  rows[:15],                                         # backward compat
        'top_sell': sorted(rows, key=lambda x: x['total_net'])[:10],  # backward compat
        'summary':  summary,
    }


def fetch_stock_kline(symbol: str, period: str = "3mo") -> dict:
    """Fetch OHLCV candlestick data for a Taiwan stock"""
    for suffix in ['.TW', '.TWO']:
        try:
            ticker = yf.Ticker(f"{symbol}{suffix}")
            hist = ticker.history(period=period, interval="1d", auto_adjust=True)

            if hist.empty or len(hist) < 5:
                continue

            candles = []
            for ts, row in hist.iterrows():
                try:
                    date_str = ts.tz_convert('Asia/Taipei').strftime('%Y-%m-%d')
                except Exception:
                    date_str = ts.strftime('%Y-%m-%d')
                candles.append({
                    'time': date_str,
                    'open': round(float(row['Open']), 2),
                    'high': round(float(row['High']), 2),
                    'low': round(float(row['Low']), 2),
                    'close': round(float(row['Close']), 2),
                    'volume': int(row['Volume'] / 1000),
                })

            closes = hist['Close'].values
            current = float(closes[-1])
            prev = float(closes[-2]) if len(closes) >= 2 else current
            change_pct = (current - prev) / prev * 100 if prev else 0

            # ATR14
            highs  = hist['High'].values
            lows_  = hist['Low'].values
            trs    = [max(highs[i] - lows_[i],
                          abs(highs[i] - closes[i-1]),
                          abs(lows_[i]  - closes[i-1]))
                      for i in range(1, len(closes))]
            atr14  = float(pd.Series(trs).rolling(14).mean().iloc[-1]) if len(trs) >= 14 else None

            # MA lines for overlay
            sma20 = hist['Close'].rolling(20).mean().dropna()
            sma60 = hist['Close'].rolling(60).mean().dropna()

            def _ts_to_date(ts):
                try:
                    return ts.tz_convert('Asia/Taipei').strftime('%Y-%m-%d')
                except Exception:
                    return ts.strftime('%Y-%m-%d')

            ma20_line = [
                {'time': _ts_to_date(ts), 'value': round(float(v), 2)}
                for ts, v in sma20.items()
            ]
            ma60_line = [
                {'time': _ts_to_date(ts), 'value': round(float(v), 2)}
                for ts, v in sma60.items()
            ]

            from analyzer import STOCK_NAMES
            return {
                'symbol': symbol,
                'name': STOCK_NAMES.get(symbol, symbol),
                'market': suffix[1:],
                'candles': candles,
                'ma20': ma20_line,
                'ma60': ma60_line,
                'atr14': round(atr14, 2) if atr14 else None,
                'current': round(current, 2),
                'change_pct': round(change_pct, 2),
                'high_period': round(float(hist['High'].max()), 2),
                'low_period': round(float(hist['Low'].min()), 2),
            }

        except Exception as e:
            print(f"Kline error {symbol}{suffix}: {e}")
            continue

    return {'error': f'無法取得 {symbol} 的K線資料'}


def fetch_inst_history(symbol: str) -> dict:
    """Fetch 90-day institutional buy/sell history for a single stock (for K-line overlay)."""
    from datetime import datetime, timedelta
    start_date = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    try:
        body = _finmind_get(
            'https://api.finmindtrade.com/api/v4/data'
            '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
            f'&data_id={symbol}&start_date={start_date}&token=',
            timeout=15,
        )
        if not body.get('data'):
            return {'symbol': symbol, 'history': []}

        from collections import defaultdict
        by_date = defaultdict(lambda: {'foreign': 0, 'trust': 0, 'dealer': 0})
        for r in body['data']:
            net = r['buy'] - r['sell']
            name = r['name']
            if name in ('Foreign_Investor', 'Foreign_Dealer_Self'):
                by_date[r['date']]['foreign'] += net
            elif name == 'Investment_Trust':
                by_date[r['date']]['trust'] += net
            elif name in ('Dealer_self', 'Dealer_Hedging'):
                by_date[r['date']]['dealer'] += net

        history = []
        for date, nets in sorted(by_date.items()):
            history.append({
                'date': date,
                'foreign_net': nets['foreign'],
                'trust_net':   nets['trust'],
                'dealer_net':  nets['dealer'],
                'total_net':   nets['foreign'] + nets['trust'] + nets['dealer'],
            })
        return {'symbol': symbol, 'history': history}
    except Exception as e:
        print(f'inst_history error {symbol}: {e}')
        return {'symbol': symbol, 'history': []}


def fetch_stock_financials(symbol: str) -> dict:
    """Fetch financial ratios from yfinance for a Taiwan stock."""
    for suffix in ['.TW', '.TWO']:
        try:
            info = yf.Ticker(f"{symbol}{suffix}").info
            if not info or not info.get('regularMarketPrice'):
                continue
            return {
                'symbol':           symbol,
                'gross_margin':     info.get('grossMargins'),
                'operating_margin': info.get('operatingMargins'),
                'trailing_eps':     info.get('trailingEps'),
                'forward_eps':      info.get('forwardEps'),
                'revenue_growth':   info.get('revenueGrowth'),
                'earnings_growth':  info.get('earningsGrowth'),
                'trailing_pe':      info.get('trailingPE'),
                'dividend_yield':   info.get('dividendYield'),
            }
        except Exception as e:
            print(f'financials error {symbol}{suffix}: {e}')
    return {'error': '無法取得財報資料'}


def fetch_institutional_radar() -> list:
    """Consecutive buy/sell streaks + cumulative net for tracked stocks (30-day lookback)."""
    from analyzer import STOCK_NAMES
    start_date = (datetime.now() - timedelta(days=35)).strftime('%Y-%m-%d')

    def _fetch_one(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None

            from collections import defaultdict
            by_date = defaultdict(lambda: {'foreign': 0, 'trust': 0, 'dealer': 0})
            for r in body['data']:
                net = r['buy'] - r['sell']
                nm  = r['name']
                if nm in ('Foreign_Investor', 'Foreign_Dealer_Self'):
                    by_date[r['date']]['foreign'] += net
                elif nm == 'Investment_Trust':
                    by_date[r['date']]['trust'] += net
                elif nm in ('Dealer_self', 'Dealer_Hedging'):
                    by_date[r['date']]['dealer'] += net

            dates = sorted(by_date.keys(), reverse=True)
            if not dates:
                return None

            def streak(key):
                first = by_date[dates[0]][key]
                if first == 0:
                    return 0
                is_buy = first > 0
                cnt = 0
                for d in dates:
                    v = by_date[d][key]
                    if (is_buy and v > 0) or (not is_buy and v < 0):
                        cnt += 1
                    else:
                        break
                return cnt if is_buy else -cnt

            latest   = by_date[dates[0]]
            recent10 = dates[:10]
            return {
                'symbol':         symbol,
                'name':           STOCK_NAMES.get(symbol, symbol),
                'date':           dates[0],
                'foreign_net':    latest['foreign'],
                'trust_net':      latest['trust'],
                'dealer_net':     latest['dealer'],
                'total_net':      latest['foreign'] + latest['trust'] + latest['dealer'],
                'foreign_streak': streak('foreign'),
                'trust_streak':   streak('trust'),
                'dealer_streak':  streak('dealer'),
                'foreign_cum10':  sum(by_date[d]['foreign'] for d in recent10),
                'trust_cum10':    sum(by_date[d]['trust']   for d in recent10),
            }
        except Exception as e:
            print(f'inst_radar {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_fetch_one, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=60)
        rows = []
        for f in done:
            try:
                r = f.result(timeout=1)
                if r:
                    rows.append(r)
            except Exception:
                pass

    rows.sort(key=lambda x: max(x['foreign_streak'], x['trust_streak'], 0), reverse=True)
    return rows


def fetch_revenue_radar() -> list:
    """Monthly revenue MoM/YoY growth for tracked stocks."""
    from analyzer import STOCK_NAMES
    start_date = (datetime.now() - timedelta(days=400)).strftime('%Y-%m-%d')

    def _fetch_one(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockMonthRevenue'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None

            data = sorted(body['data'],
                          key=lambda x: (int(x['revenue_year']), int(x['revenue_month'])),
                          reverse=True)
            if len(data) < 2:
                return None

            cur, prev = data[0], data[1]
            rev_cur   = float(cur['revenue'])
            rev_prev  = float(prev['revenue'])
            mom = (rev_cur - rev_prev) / rev_prev * 100 if rev_prev else 0

            yoy_rec = next(
                (r for r in data[1:]
                 if int(r['revenue_month']) == int(cur['revenue_month'])
                 and int(r['revenue_year'])  == int(cur['revenue_year']) - 1),
                None)
            yoy = None
            if yoy_rec:
                rev_ly = float(yoy_rec['revenue'])
                yoy = (rev_cur - rev_ly) / rev_ly * 100 if rev_ly else None

            yoy_3m_vals = []
            for r in data[:3]:
                ly = next((x for x in data
                           if int(x['revenue_month']) == int(r['revenue_month'])
                           and int(x['revenue_year'])  == int(r['revenue_year']) - 1), None)
                if ly and float(ly['revenue']) > 0:
                    yoy_3m_vals.append((float(r['revenue']) - float(ly['revenue'])) / float(ly['revenue']) * 100)
            yoy_3m = round(sum(yoy_3m_vals) / len(yoy_3m_vals), 1) if yoy_3m_vals else None

            return {
                'symbol':  symbol,
                'name':    STOCK_NAMES.get(symbol, symbol),
                'date':    f"{cur['revenue_year']}/{int(cur['revenue_month']):02d}",
                'revenue': rev_cur,
                'mom':     round(mom, 1),
                'yoy':     round(yoy, 1) if yoy is not None else None,
                'yoy_3m':  yoy_3m,
            }
        except Exception as e:
            print(f'revenue_radar {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_fetch_one, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=60)
        rows = []
        for f in done:
            try:
                r = f.result(timeout=1)
                if r:
                    rows.append(r)
            except Exception:
                pass

    rows.sort(key=lambda x: (x.get('yoy') or -999), reverse=True)
    return rows


def fetch_contract_liabilities() -> list:
    """合約負債 QoQ/YoY from FinMind balance sheet for tracked stocks."""
    from analyzer import STOCK_NAMES
    start_date = (datetime.now() - timedelta(days=550)).strftime('%Y-%m-%d')
    TARGET = {'ContractLiabilities', 'ContractLiability', 'DeferredRevenue'}

    def _fetch_one(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockBalanceSheet'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None

            cl = [r for r in body['data']
                  if r.get('type', '') in TARGET
                  or 'Contract' in r.get('type', '')
                  or '合約' in r.get('type', '')
                  or 'Deferred' in r.get('type', '')]
            if not cl:
                return None

            by_date = {}
            for r in cl:
                d = r['date']
                by_date[d] = by_date.get(d, 0) + float(r.get('value', 0) or 0)

            dates = sorted(by_date.keys(), reverse=True)
            if len(dates) < 2:
                return None

            val_cur, val_prev = by_date[dates[0]], by_date[dates[1]]
            if val_cur <= 0 or val_prev <= 0:
                return None

            qoq = (val_cur - val_prev) / val_prev * 100
            yoy = None
            if len(dates) >= 5:
                val_ly = by_date[dates[4]]
                if val_ly > 0:
                    yoy = (val_cur - val_ly) / val_ly * 100

            return {
                'symbol': symbol,
                'name':   STOCK_NAMES.get(symbol, symbol),
                'date':   dates[0],
                'value':  val_cur,
                'qoq':    round(qoq, 1),
                'yoy':    round(yoy, 1) if yoy is not None else None,
            }
        except Exception as e:
            print(f'contract_liab {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_fetch_one, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=60)
        rows = []
        for f in done:
            try:
                r = f.result(timeout=1)
                if r:
                    rows.append(r)
            except Exception:
                pass

    rows.sort(key=lambda x: x.get('qoq', 0), reverse=True)
    return rows


def fetch_big_holders(symbol: str) -> dict:
    """Shareholder distribution — large (千張+) vs retail from FinMind."""
    start_date = (datetime.now() - timedelta(days=120)).strftime('%Y-%m-%d')
    try:
        body = _finmind_get(
            'https://api.finmindtrade.com/api/v4/data'
            '?dataset=TaiwanStockHoldingSharesPer'
            f'&data_id={symbol}&start_date={start_date}&token=',
            timeout=15,
        )
        if not body.get('data'):
            return {'error': '無持股分布資料'}

        records   = body['data']
        all_dates = sorted(set(r['date'] for r in records), reverse=True)
        if not all_dates:
            return {'error': '無資料'}

        def _calc(date_str):
            day   = [r for r in records if r['date'] == date_str]
            big   = 0.0  # 千張以上 (1,000,000 shares+)
            small = 0.0  # 極小散戶
            for r in day:
                level = str(r.get('HoldingSharesLevel', '') or r.get('holding_shares_level', ''))
                pct   = float(r.get('percent', 0) or 0)
                if '1,000,000' in level:
                    big += pct
                elif level.startswith('1 -') or '1-999' in level or level.startswith('1 to'):
                    small += pct
            return big, small

        big_cur,  small_cur  = _calc(all_dates[0])
        big_prev, _          = _calc(all_dates[1]) if len(all_dates) > 1 else (big_cur, 0)
        trend = 'up' if big_cur > big_prev + 0.1 else ('down' if big_cur < big_prev - 0.1 else 'flat')

        return {
            'symbol':    symbol,
            'date':      all_dates[0],
            'big_pct':   round(big_cur, 2),
            'small_pct': round(small_cur, 2),
            'trend':     trend,
        }
    except Exception as e:
        return {'error': str(e)}


def fetch_market_indices() -> list:
    """Fetch Taiwan market indices"""
    symbols = {
        '^TWII': '加權指數',
        '0050.TW': 'ETF 0050',
        '0056.TW': 'ETF 0056',
    }

    result = []
    for sym, name in symbols.items():
        try:
            ticker = yf.Ticker(sym)
            hist = ticker.history(period="5d", interval="1d")
            if hist.empty or len(hist) < 2:
                continue
            current = float(hist['Close'].iloc[-1])
            prev = float(hist['Close'].iloc[-2])
            change = current - prev
            change_pct = change / prev * 100 if prev else 0
            result.append({
                'symbol': sym,
                'name': name,
                'current': round(current, 2),
                'change': round(change, 2),
                'change_pct': round(change_pct, 2),
                'is_up': change >= 0,
            })
        except Exception as e:
            print(f"Index error {sym}: {e}")

    return result


# ── Sector grouping for 產業族群熱度 ─────────────────────────────
_SECTOR_MAP = {
    'AI 伺服器': ['2382', '6669', '3231', '2317', '2376'],
    '半導體':    ['2330', '2303', '2454', '3034', '3711'],
    '晶圓材料':  ['5483', '6488', '2344', '3596'],
    '網通/PCB': ['2379', '2345', '3037'],
    '工業/電源': ['2308', '1590', '2395', '4938'],
    '重電/傳產': ['1519', '6505', '1303', '2207'],
    '光學/其他': ['3008'],
}


def fetch_sector_heat() -> list:
    """Aggregate latest institutional net buys by sector for tracked stocks."""
    from analyzer import STOCK_NAMES
    start_date = (datetime.now() - timedelta(days=10)).strftime('%Y-%m-%d')

    def _fetch_one(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None
            records     = body['data']
            latest_date = max(r['date'] for r in records)
            day_recs    = [r for r in records if r['date'] == latest_date]
            foreign_net = trust_net = dealer_net = 0
            for r in day_recs:
                net = r['buy'] - r['sell']
                nm  = r['name']
                if nm in ('Foreign_Investor', 'Foreign_Dealer_Self'):
                    foreign_net += net
                elif nm == 'Investment_Trust':
                    trust_net += net
                elif nm in ('Dealer_self', 'Dealer_Hedging'):
                    dealer_net += net
            return {
                'symbol':    symbol,
                'name':      STOCK_NAMES.get(symbol, symbol),
                'total_net': foreign_net + trust_net + dealer_net,
                'date':      latest_date,
            }
        except Exception as e:
            print(f'sector_heat {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_fetch_one, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=45)
        stock_data = {}
        for f in done:
            try:
                r = f.result(timeout=1)
                if r:
                    stock_data[r['symbol']] = r
            except Exception:
                pass

    results = []
    for sector, symbols in _SECTOR_MAP.items():
        rows = [stock_data[sym] for sym in symbols if sym in stock_data]
        if not rows:
            continue
        total_net = sum(r['total_net'] for r in rows)
        buy_count = sum(1 for r in rows if r['total_net'] > 0)
        rows.sort(key=lambda x: x['total_net'], reverse=True)
        score = buy_count / len(rows) * 100 if rows else 0
        results.append({
            'sector':      sector,
            'total_net':   total_net,
            'buy_count':   buy_count,
            'stock_count': len(rows),
            'stocks':      rows,
            'score':       round(score),
        })

    results.sort(
        key=lambda x: x['score'] * 0.6 + (x['total_net'] / 1_000_000) * 0.4,
        reverse=True,
    )
    return results


def fetch_stock_backtest(symbol: str) -> dict:
    """Simple backtest: RSI pullback pattern → 20-day forward return (1-year window)."""
    for suffix in ['.TW', '.TWO']:
        try:
            hist = yf.Ticker(f"{symbol}{suffix}").history(period="1y", interval="1d", auto_adjust=True)
            if hist.empty or len(hist) < 60:
                continue

            closes    = hist['Close'].values
            delta     = pd.Series(closes).diff()
            gain      = delta.clip(lower=0).rolling(14).mean()
            loss      = (-delta.clip(upper=0)).rolling(14).mean()
            rsi       = (100 - 100 / (1 + gain / loss.replace(0, float('inf')))).values
            roll_high = pd.Series(closes).rolling(20).max().values

            occurrences = wins = 0
            gains_list  = []
            for i in range(20, len(closes) - 20):
                r, c, rh = rsi[i], closes[i], roll_high[i]
                if not (30 <= r <= 52):
                    continue
                if rh <= 0 or (rh - c) / rh < 0.08:
                    continue
                fwd = (closes[i + 20] - c) / c * 100
                gains_list.append(fwd)
                occurrences += 1
                if fwd >= 5:
                    wins += 1

            if not occurrences:
                return {'symbol': symbol, 'occurrences': 0, 'win_rate': 0, 'avg_gain': 0, 'max_gain': 0, 'period': '近1年'}

            return {
                'symbol':      symbol,
                'occurrences': occurrences,
                'win_rate':    round(wins / occurrences * 100),
                'avg_gain':    round(sum(gains_list) / len(gains_list), 1),
                'max_gain':    round(max(gains_list), 1),
                'period':      '近1年',
            }
        except Exception as e:
            print(f'backtest {symbol}{suffix}: {e}')
            continue
    return {'error': '無法取得回測資料'}


def fetch_reserve_stocks() -> list:
    """Pre-breakout watchlist: institutions just started buying, KD cross, not at 52-week high."""
    from analyzer import STOCK_NAMES
    start_date = (datetime.now() - timedelta(days=35)).strftime('%Y-%m-%d')

    def _fetch_one(symbol):
        try:
            body = _finmind_get(
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            if not body.get('data'):
                return None

            from collections import defaultdict
            by_date: dict = defaultdict(lambda: {'foreign': 0, 'trust': 0})
            for r in body['data']:
                net = r['buy'] - r['sell']
                nm  = r['name']
                if nm in ('Foreign_Investor', 'Foreign_Dealer_Self'):
                    by_date[r['date']]['foreign'] += net
                elif nm == 'Investment_Trust':
                    by_date[r['date']]['trust'] += net

            dates = sorted(by_date.keys(), reverse=True)
            if not dates:
                return None

            def streak(key):
                if by_date[dates[0]][key] <= 0:
                    return 0
                cnt = 0
                for d in dates:
                    if by_date[d][key] > 0:
                        cnt += 1
                    else:
                        break
                return cnt

            f_streak = streak('foreign')
            t_streak = streak('trust')
            if f_streak < 1 and t_streak < 1:
                return None

            # Get K-line for KD computation
            kline = None
            for suffix in ['.TW', '.TWO']:
                try:
                    h = yf.Ticker(f"{symbol}{suffix}").history(period="6mo", interval="1d", auto_adjust=True)
                    if not h.empty and len(h) >= 14:
                        kline = h
                        break
                except Exception:
                    continue
            if kline is None:
                return None

            c_arr = kline['Close'].values
            h_arr = kline['High'].values
            l_arr = kline['Low'].values
            current   = float(c_arr[-1])
            high_year = float(max(h_arr))

            if current >= high_year * 0.96:
                return None  # Already near the high — not a "reserve" stock

            # KD Stochastic (9-period, EMA smoothed)
            period = 9
            k_raw = []
            for i in range(period - 1, len(c_arr)):
                lo_p = min(l_arr[max(0, i - period + 1): i + 1])
                hi_p = max(h_arr[max(0, i - period + 1): i + 1])
                k_raw.append((c_arr[i] - lo_p) / (hi_p - lo_p) * 100 if hi_p != lo_p else 50)

            k_sm = pd.Series(k_raw).ewm(span=3).mean().values
            d_sm = pd.Series(k_sm).ewm(span=3).mean().values
            kd_cross = any(
                k_sm[i] > d_sm[i] and k_sm[i - 1] <= d_sm[i - 1]
                for i in range(max(1, len(k_sm) - 5), len(k_sm))
            )

            return {
                'symbol':    symbol,
                'name':      STOCK_NAMES.get(symbol, symbol),
                'current':   round(current, 2),
                'f_streak':  f_streak,
                't_streak':  t_streak,
                'kd_cross':  kd_cross,
                'high_gap':  round((high_year - current) / high_year * 100, 1),
                'high_year': round(high_year, 2),
                'score':     f_streak * 2 + t_streak * 1.5 + (10 if kd_cross else 0),
            }
        except Exception as e:
            print(f'reserve {symbol}: {e}')
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(_fetch_one, sym): sym for sym in _INST_SYMBOLS}
        done, _ = concurrent.futures.wait(futs, timeout=120)
        rows = []
        for f in done:
            try:
                r = f.result(timeout=1)
                if r:
                    rows.append(r)
            except Exception:
                pass

    rows.sort(key=lambda x: x['score'], reverse=True)
    return rows[:15]