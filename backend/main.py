import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="飆股雷達 API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=8)
_cache: dict = {}
_cache_ts: dict = {}


def _stale(key: str, ttl: int) -> bool:
    return time.time() - _cache_ts.get(key, 0) > ttl


async def _run(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, fn, *args)


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat(), "message": "飆股雷達運行中"}


@app.get("/api/indices")
async def get_indices():
    from data_fetcher import fetch_market_indices
    if not _stale("indices", 300):
        return {"data": _cache["indices"]}
    data = await _run(fetch_market_indices)
    _cache["indices"] = data
    _cache_ts["indices"] = time.time()
    return {"data": data}


@app.get("/api/news")
async def get_news():
    from news_fetcher import fetch_all_news
    if not _stale("news", 300):
        return {"data": _cache["news"]}
    data = await _run(fetch_all_news)
    _cache["news"] = data
    _cache_ts["news"] = time.time()
    return {"data": data}


@app.get("/api/institutional")
async def get_institutional(date: str = Query(None)):
    from data_fetcher import fetch_institutional_data
    key = f"inst_{date or 'latest'}"
    if not _stale(key, 3600):
        return _cache[key]
    data = await _run(fetch_institutional_data, date)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


@app.get("/api/recommendations")
async def get_recommendations():
    from analyzer import get_daily_recommendations
    if not _stale("recs", 3600):
        return {
            "data": _cache["recs"],
            "cached": True,
            "generated_at": _cache_ts.get("recs"),
        }
    data = await _run(get_daily_recommendations)
    _cache["recs"] = data
    _cache_ts["recs"] = time.time()
    return {"data": data, "cached": False, "generated_at": _cache_ts["recs"]}


@app.get("/api/screens")
async def get_screens():
    from analyzer import screen_entry_timing, screen_add_position, screen_exit_warnings, screen_pe_value
    key = "screens"
    if not _stale(key, 3600):
        return _cache[key]
    entry, add, exit_, pe = await asyncio.gather(
        _run(screen_entry_timing),
        _run(screen_add_position),
        _run(screen_exit_warnings),
        _run(screen_pe_value),
    )
    data = {
        'entry_timing': entry,
        'add_position': add,
        'exit_warning': exit_,
        'pe_value':     pe,
    }
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


@app.get("/api/radar/institutional")
async def get_inst_radar():
    from data_fetcher import fetch_institutional_radar
    key = "inst_radar"
    if not _stale(key, 3600):
        return {"data": _cache[key]}
    data = await _run(fetch_institutional_radar)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return {"data": data}


@app.get("/api/radar/revenue")
async def get_revenue_radar():
    from data_fetcher import fetch_revenue_radar
    key = "rev_radar"
    if not _stale(key, 14400):
        return {"data": _cache[key]}
    data = await _run(fetch_revenue_radar)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return {"data": data}


@app.get("/api/radar/contracts")
async def get_contracts():
    from data_fetcher import fetch_contract_liabilities
    key = "contracts"
    if not _stale(key, 86400):
        return {"data": _cache[key]}
    data = await _run(fetch_contract_liabilities)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return {"data": data}


@app.get("/api/stock/{symbol}/holders")
async def get_holders(symbol: str):
    from data_fetcher import fetch_big_holders
    key = f"holders_{symbol}"
    if not _stale(key, 86400):
        return _cache[key]
    data = await _run(fetch_big_holders, symbol)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


@app.get("/api/stock/{symbol}/inst-history")
async def get_inst_history(symbol: str):
    from data_fetcher import fetch_inst_history
    key = f"inst_hist_{symbol}"
    if not _stale(key, 3600):
        return _cache[key]
    data = await _run(fetch_inst_history, symbol)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


@app.get("/api/stock/{symbol}/financials")
async def get_financials(symbol: str):
    from data_fetcher import fetch_stock_financials
    key = f"fin_{symbol}"
    if not _stale(key, 21600):
        return _cache[key]
    data = await _run(fetch_stock_financials, symbol)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


@app.get("/api/stock/{symbol}/kline")
async def get_kline(symbol: str, period: str = Query("3mo")):
    from data_fetcher import fetch_stock_kline
    key = f"kline_{symbol}_{period}"
    if not _stale(key, 3600):
        return _cache[key]
    data = await _run(fetch_stock_kline, symbol, period)
    _cache[key] = data
    _cache_ts[key] = time.time()
    return data


_frontend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
if os.path.exists(_frontend):
    for _sub in ("css", "js", "img"):
        _d = os.path.join(_frontend, _sub)
        if os.path.exists(_d):
            app.mount(f"/{_sub}", StaticFiles(directory=_d), name=_sub)

    @app.get("/")
    async def _index():
        return FileResponse(os.path.join(_frontend, "index.html"))

    @app.get("/{full_path:path}")
    async def _static_catch(full_path: str):
        p = os.path.join(_frontend, full_path)
        if os.path.isfile(p):
            return FileResponse(p)
        return FileResponse(os.path.join(_frontend, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
