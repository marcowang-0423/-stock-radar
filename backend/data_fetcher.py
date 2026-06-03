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
            url = (
                'https://api.finmindtrade.com/api/v4/data'
                '?dataset=TaiwanStockInstitutionalInvestorsBuySell'
                f'&data_id={symbol}&start_date={start_date}&token='
            )
            resp = requests.get(url, timeout=12, headers=HEADERS)
            body = resp.json()
            if body.get('status') != 200 or not body.get('data'):
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
        'top_buy':  rows[:15],
        'top_sell': sorted(rows, key=lambda x: x['total_net'])[:10],
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
                'current': round(current, 2),
                'change_pct': round(change_pct, 2),
                'high_period': round(float(hist['High'].max()), 2),
                'low_period': round(float(hist['Low'].min()), 2),
            }

        except Exception as e:
            print(f"Kline error {symbol}{suffix}: {e}")
            continue

    return {'error': f'無法取得 {symbol} 的K線資料'}


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