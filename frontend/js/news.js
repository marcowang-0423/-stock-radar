/* ── news.js ─────────────────────────────────────────── */

let _allNews = [];
let _newsFilter = 'all';

async function loadNews() {
  try {
    const res = await fetch(`${BASE}/api/news`);
    const json = await res.json();
    _allNews = json.data || [];
    renderNews();
  } catch (e) {
    document.getElementById('newsList').innerHTML =
      '<div class="empty-state"><span>無法載入新聞</span><small>請確認後端已啟動</small></div>';
  }
}

function filterNews(cat, btn) {
  _newsFilter = cat;
  document.querySelectorAll('.panel-news .tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  renderNews();
}

function renderNews() {
  const list = document.getElementById('newsList');
  const items = _newsFilter === 'all'
    ? _allNews
    : _allNews.filter(n => n.category === _newsFilter);

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span>暫無${_newsFilter === 'all' ? '' : _newsFilter}相關新聞</span>
    </div>`;
    return;
  }

  list.innerHTML = items.map(n => {
    const catClass = `cat-${n.category || '財經新聞'}`;
    return `<div class="news-item" onclick="window.open('${n.url}','_blank')">
      <span class="news-cat ${catClass}">${n.category || '財經'}</span>
      <div class="news-title">${escHtml(n.title)}</div>
      <div class="news-meta">
        <span class="news-source">${escHtml(n.source || '')}</span>
        <span class="news-time">${n.published || ''}</span>
      </div>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
