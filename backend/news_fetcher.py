import feedparser
import requests
import re
from datetime import datetime
from email.utils import parsedate_to_datetime

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

RSS_FEEDS = [
    {'url': 'https://www.moneydj.com/KMDJ/RSS/RSSFeed.aspx?TargetID=news', 'source': 'MoneyDJ'},
    {'url': 'https://ctee.com.tw/?feed=rss2', 'source': '工商時報'},
]

CNYES_API = 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=50&page=1'

EXCLUDE_KW = [
    '社會', '殺人', '犯罪', '搶劫', '車禍', '火災', '地震', '颱風',
    '演藝', '藝人', '明星', '八卦', '緋聞', '出軌', '離婚',
    '棒球', '籃球', '足球', '奧運', '選手', '球賽',
    '彩券', '大樂透',
]

CATEGORY_KW = {
    '建廠投資': ['建廠', '設廠', '擴廠', '新廠', '投資設廠', '量產', '擴產能', '廠房', '工廠'],
    '科技產業': ['半導體', '晶片', 'AI', '人工智慧', '電動車', '5G', '雲端', 'HPC', '先進製程',
                '台積電', '聯發科', '輝達', 'NVIDIA', 'AMD'],
    '法人動向': ['外資', '投信', '三大法人', '法人買超', '法人賣超', '自營商', '法人布局'],
    '受惠股': ['受惠', '概念股', '題材', '轉機股', '受益', '關聯股', '相關股'],
}

def categorize(text: str) -> str:
    for cat, kws in CATEGORY_KW.items():
        if any(kw in text for kw in kws):
            return cat
    return '財經新聞'

def is_excluded(text: str) -> bool:
    return any(kw in text for kw in EXCLUDE_KW)

def clean_html(text: str) -> str:
    text = re.sub(r'<[^>]+>', '', text or '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:280]

def parse_pub_date(date_str: str) -> str:
    try:
        dt = parsedate_to_datetime(date_str)
        return dt.strftime('%m/%d %H:%M')
    except Exception:
        return (date_str or '')[:16]

def fetch_cnyes_news() -> list:
    items = []
    try:
        resp = requests.get(CNYES_API, timeout=12, headers={**HEADERS, 'Accept': 'application/json'})
        data = resp.json()
        for item in data.get('items', {}).get('data', [])[:35]:
            title = (item.get('title') or '').strip()
            summary = clean_html(item.get('summary', ''))
            pub_ts = item.get('publishAt', 0)
            pub = datetime.fromtimestamp(pub_ts).strftime('%m/%d %H:%M') if pub_ts else ''
            url = f"https://news.cnyes.com/news/id/{item.get('newsId', '')}"
            full = title + ' ' + summary
            if not title or is_excluded(full):
                continue
            items.append({
                'title': title,
                'summary': summary,
                'url': url,
                'source': '鉅亨網',
                'category': categorize(full),
                'published': pub,
            })
    except Exception as e:
        print(f"Cnyes error: {e}")
    return items

def fetch_rss_news(feed_info: dict) -> list:
    items = []
    try:
        feed = feedparser.parse(feed_info['url'])
        for entry in feed.entries[:20]:
            title = (entry.get('title') or '').strip()
            summary = clean_html(entry.get('summary', entry.get('description', '')))
            url = entry.get('link', '')
            pub = parse_pub_date(entry.get('published', ''))
            full = title + ' ' + summary
            if not title or is_excluded(full):
                continue
            items.append({
                'title': title,
                'summary': summary,
                'url': url,
                'source': feed_info['source'],
                'category': categorize(full),
                'published': pub,
            })
    except Exception as e:
        print(f"RSS error ({feed_info['source']}): {e}")
    return items

def fetch_all_news() -> list:
    all_news = fetch_cnyes_news()
    for feed in RSS_FEEDS:
        all_news.extend(fetch_rss_news(feed))

    all_news.sort(key=lambda x: x.get('published', ''), reverse=True)

    # Deduplicate by title prefix
    seen: set = set()
    unique = []
    for item in all_news:
        key = item['title'][:25]
        if key not in seen:
            seen.add(key)
            unique.append(item)

    return unique[:60]
