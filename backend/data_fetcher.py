import requests
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
}

def _clean_num(s: str) -> int:
    try:
        return int(str(s).replace(',', '').replace('+', '').strip())
    except:
        return 0

def fetch_institutional_data(date: str = None) -> dict:
    """Fetch 三大法人 data from TWSE T86 API"""
    attempts = []
    if date:
        attempts = [date]
    else:
        d = datetime.now()
        for _ in range(7):
            if d.weekday() < 5:
                attempts.append(d.strftime("%Y%m%d"))
            d -= timedelta(days=1)

    for attempt_date in attempts:
        try:
            url = (
                f"https://www.twse.com.tw/fund/T86"
                f"?response=json&date={attempt_date}&selectType=ALL"
            )
            resp = requests.get(url, timeout=15, headers=HEADERS)
            body = resp.json()

            if body.get('stat') != 'OK' or not body.get('data'):
                continue

            fields = body.get('fields', [])

            def idx(name, fallback):
                try:
                    return fields.index(name)
                except ValueError:
                    return fallback

            fi = idx('外陸資淨買賣超股數', 4)
            ti = idx('投信淨買賣超股數', 7)
            di = idx('自營商淨買賣超股數', 12)
            total_i = idx('三大法人買賣超股數合計', 13)

            rows = []
            for row in body['data']:
                try:
                    rows.append({
                        'symbol': row[0].strip(),
                        'name': row[1].strip(),
                        'foreign_net': _clean_num(row[fi]) if len(row) > fi else 0,
                        'trust_net': _clean_num(row[ti]) if len(row) > ti else 0,
                        'dealer_net': _clean_num(row[di]) if len(row) > di else 0,
                        'total_net': _clean_num(row[total_i]) if len(row) > total_i else 0,
                    })
                except Exception:
                    continue

            rows.sort(key=lambda x: x['total_net'], reverse=True)

            summary = {
                'foreign_total': sum(r['foreign_net'] for r in rows),
                'trust_total': sum(r['trust_net'] for r in rows),
                'dealer_total': sum(r['dealer_net'] for r in rows),
                'buy_count': sum(1 for r in rows if r['total_net'] > 0),
                'sell_count': sum(1 for r in rows if r['total_net'] < 0),
            }

            return {
                'date': attempt_date,
                'top_buy': rows[:15],
                'top_sell': sorted(rows, key=lambda x: x['total_net'])[:10],
                'summary': summary,
            }

        except Exception as e:
            print(f"TWSE fetch error ({attempt_date}): {e}")
            continue

    return {'error': '無法取得三大法人資料，可能為假日或休市', 'date': date}


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
                candles.append({
                    'time': int(ts.timestamp()),
                    'open': round(float(row['Open']), 2),
                    'high': round(float(row['High']), 2),
                    'low': round(float(row['Low']), 2),
                    'close': round(float(row['Close']), 2),
                    'volume': int(row['Volume'] / 1000),  # 張
                })

            closes = hist['Close'].values
            current = float(closes[-1])
            prev = float(closes[-2]) if len(closes) >= 2 else current
            change_pct = (current - prev) / prev * 100 if prev else 0

            # MA lines for overlay
            sma20 = hist['Close'].rolling(20).mean().dropna()
            sma60 = hist['Close'].rolling(60).mean().dropna()

            ma20_line = [
                {'time': int(ts.timestamp()), 'value': round(float(v), 2)}
                for ts, v in sma20.items()
            ]
            ma60_line = [
                {'time': int(ts.timestamp()), 'value': round(float(v), 2)}
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
