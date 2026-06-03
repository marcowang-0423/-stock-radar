import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
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
    if not _stale("news", 1800):
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


# Serve frontend static files last
_frontend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
if os.path.exists(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
