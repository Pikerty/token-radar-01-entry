// Token Launch Radar — the page. Renders window.RADAR (written by main.ts from the same
// board that board.json carries, so what the page shows is what the model scored) as a
// sortable, filterable board with a detail view per protocol, the token-live set the
// model calibrated against, and a panel that states the model in plain words.
// Views are hash routes: (empty) the board, #watchlist the board filtered to the
// watchlist, #live the live set, #model the scoring panel, #detail-<slug> one protocol.
(function () {
  var data = window.RADAR;
  var view = document.getElementById('view');
  var summary = document.getElementById('summary');
  var count = document.getElementById('count');
  var tabs = document.getElementById('tabs');
  if (!data || !view || !summary) return;

  var bySlug = {};
  data.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var watchSlugs = {};
  data.rows.forEach(function (r) { if (r.watchlist) watchSlugs[r.slug] = true; });

  summary.textContent =
    data.board_size + ' pre-token protocols ranked by implied value · ' +
    data.watchlist_size + ' on the watchlist, ' + data.early_size + ' found below its floor · ' +
    'snapshot ' + data.as_of + ' · model ' + data.model_version;
  document.getElementById('src').textContent = data.source;

  // ---------------------------------------------------------- formatting
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="flat">—</span>';
    var cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' days';
  }
  function mult(x) { return '×' + x.toFixed(x >= 1 ? 2 : 3); }

  // ---------------------------------------------------------- board state
  var sortKey = 'rank', sortDir = 1;
  var q = document.getElementById('q'), fcat = document.getElementById('fcat'),
      fchain = document.getElementById('fchain'), ftvl = document.getElementById('ftvl'),
      fwatch = document.getElementById('fwatch');

  (function fillFilters() {
    var cats = {}, chains = {};
    data.rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; fcat.appendChild(o);
    });
    Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); })
      .forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c + ' (' + chains[c] + ')'; fchain.appendChild(o);
      });
  })();

  function filtered() {
    var needle = q.value.trim().toLowerCase();
    var minTvl = Number(ftvl.value) || 0;
    return data.rows.filter(function (r) {
      if (fwatch.checked && !watchSlugs[r.slug]) return false;
      if (fcat.value && r.category !== fcat.value) return false;
      if (fchain.value && r.chains.indexOf(fchain.value) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (needle && r.name.toLowerCase().indexOf(needle) === -1 && r.slug.indexOf(needle) === -1) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = sortKey, dir = sortDir;
    var val = {
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      implied: function (r) { return r.implied_value_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; }
    }[key];
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * dir;
    });
  }
  function th(key, label, cls) {
    var arrow = sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
    return '<th data-sort="' + key + '"' + (cls ? ' class="' + cls + '"' : '') +
      (sortKey === key ? ' data-sorted="1"' : '') + '>' + label + arrow + '</th>';
  }
  function renderBoard() {
    var rows = sortedRows(filtered());
    count.textContent = rows.length + ' of ' + data.board_size + ' protocols';
    if (rows.length === 0) {
      view.innerHTML = '<p class="empty">No protocol on the board matches those filters.</p>';
      return;
    }
    var h = '<table><thead><tr>' +
      th('rank', '#', 'num') + th('name', 'Protocol') + '<th>Category</th><th>Chains</th>' +
      th('tvl', 'TVL', 'num') + th('change', '7d', 'num') + th('age', 'Age', 'num') +
      th('implied', 'Implied value', 'num') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span><span class="pslug">' + esc(r.slug) + '</span>' +
        (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(' · ')) +
        (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><span class="implied">' + money(r.implied_value_usd) + '</span>' +
        '<span class="mult">' + mult(r.implied_value_usd / r.tvl_usd) + ' TVL</span></td></tr>';
    });
    view.innerHTML = h + '</tbody></table>';
    Array.prototype.forEach.call(view.querySelectorAll('th[data-sort]'), function (el) {
      el.classList.toggle('sorted', el.getAttribute('data-sorted') === '1');
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-sort');
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
        if (k === 'rank') sortDir = 1;
        renderBoard();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('tr[data-slug]'), function (el) {
      el.addEventListener('click', function () { location.hash = 'detail-' + el.getAttribute('data-slug'); });
    });
  }

  // ---------------------------------------------------------- detail
  function bar(label, value, lo, hi, display) {
    var w = Math.max(2, Math.min(100, ((value - lo) / (hi - lo)) * 100));
    return '<div class="bar-row"><span class="bl">' + label + '</span>' +
      '<span class="track"><span class="fill" style="width:' + w.toFixed(1) + '%"></span></span>' +
      '<span class="bv">' + display + '</span></div>';
  }
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { renderBoard(); return; }
    var m = r.model;
    var h = '<button class="back" id="back" type="button">← THE BOARD</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="of">rank #' + r.rank + ' of ' + data.board_size + ' · ' + esc(r.category || 'uncategorised') +
      (r.watchlist ? ' · on the watchlist' : ' · below the watchlist floor') + '</span></div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7-day TVL change</div><div class="v">' +
      (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</div></div>' +
      '<div class="stat"><div class="k">Running, no token</div><div class="v">' + ageText(r.age_days) +
      (m.age_assumed ? ' <small>(assumed)</small>' : '') + '</div></div>' +
      '<div class="stat"><div class="k">Listed since</div><div class="v">' + esc(r.listed_at || 'unknown') + '</div></div>' +
      '<div class="stat"><div class="k">Chains</div><div class="v">' + r.chains.length + ' <small>' +
      esc(r.chains.slice(0, 4).join(', ')) + (r.chains.length > 4 ? '…' : '') + '</small></div></div></div>' +
      '<section class="panel"><h3>Why this value — the model, factor by factor</h3>' +
      '<p class="eq">' + money(r.tvl_usd) + ' TVL <b>×</b> ' + m.base_multiple.toFixed(3) + ' category <b>×</b> ' +
      m.growth_multiplier.toFixed(3) + ' growth <b>×</b> ' + m.maturity_multiplier.toFixed(3) +
      ' maturity <b>×</b> ' + m.reach_multiplier.toFixed(3) + ' reach <b>=</b> ' + money(r.implied_value_usd) + '</p>' +
      bar('Category multiple', m.base_multiple, 0, 2, '×' + m.base_multiple.toFixed(3)) +
      bar('Growth (7d, damped)', m.growth_multiplier, 0.8, 1.36, '×' + m.growth_multiplier.toFixed(3)) +
      bar('Maturity (age, no token)', m.maturity_multiplier, 0.65, 1, '×' + m.maturity_multiplier.toFixed(3)) +
      bar('Reach (chains served)', m.reach_multiplier, 1, 1.2, '×' + m.reach_multiplier.toFixed(3)) +
      '<p class="note">The category multiple is the median market value per TVL dollar of the ' +
      (m.category_peers > 0 ? m.category_peers + ' token-live protocol(s) in this category' : 'token-live set overall (this category has no live peer)') +
      ', shrunk toward the global median of ×' + data.model_info.global_multiple.toFixed(3) + ' and clamped to ×0.05–×2. ' +
      (r.change_7d === null ? 'The snapshot reports no 7-day change, so growth is neutral. ' : '') +
      (m.age_assumed ? 'The snapshot gives no listing date, so maturity uses the board\'s median age.' : '') +
      '</p></section>' +
      '<section class="panel"><h3>The farm plan — six steps, with costs and times</h3><ol class="plan">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></section>';
    view.innerHTML = h;
    document.getElementById('back').addEventListener('click', function () { location.hash = ''; });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------- live set
  function renderLive() {
    var h = '<p class="lede">These protocols\' tokens <b>already trade</b>, so the radar never ranks them. ' +
      'They are shown at the market\'s own values because they are the evidence the board is priced from: ' +
      'each category\'s multiple is the median of ratios like these, shrunk toward the global median of ×' +
      data.model_info.global_multiple.toFixed(3) + '.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">Market cap</th>' +
      '<th class="num">TVL</th><th class="num">Value / TVL</th><th class="num">7d</th></tr></thead><tbody>';
    data.live.forEach(function (r) {
      h += '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + (r.mcap_usd && r.tvl_usd ? '×' + (r.mcap_usd / r.tvl_usd).toFixed(2) : '—') + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    });
    view.innerHTML = h + '</tbody></table>';
  }

  // ---------------------------------------------------------- model panel
  function renderModel() {
    var mi = data.model_info;
    var multRows = mi.multiples.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">×' + m.multiple.toFixed(3) +
        '</td><td class="num">' + m.peers + '</td></tr>';
    }).join('');
    view.innerHTML =
      '<p class="lede">One formula, fed only by the snapshot\'s own figures — no protocol is ' +
      'named anywhere in the model, and every factor is printed on every row of the board.</p>' +
      '<div class="formula">implied value = TVL × category multiple × growth × maturity × reach</div>' +
      '<div class="cols">' +
      '<section class="panel"><h3>The four factors</h3><ul class="rules">' +
      '<li><b>Category multiple.</b> For each category, the median market-cap/TVL of its token-live protocols — the market\'s own price for that kind of business — shrunk toward the global median (×' + mi.global_multiple.toFixed(3) + ') by peer count and clamped to ×0.05–×2.</li>' +
      '<li><b>Growth.</b> The 7-day TVL change, damped: a third of it is priced, clamped between −50% and +100%. No reported change scores neutral.</li>' +
      '<li><b>Maturity.</b> Time run with no token: ×0.65 at listing, rising to ×1.00 at two years. An unreported listing date scores at the board\'s median age, and the row says so.</li>' +
      '<li><b>Reach.</b> +2.5 points per chain served beyond the first, capped at eight — distribution a launch would inherit.</li>' +
      '</ul></section>' +
      '<section class="panel"><h3>Who gets ranked</h3><ul class="rules">' +
      '<li>Only protocols that <b>record no token</b> in the snapshot: no market cap, no CoinGecko id, no symbol.</li>' +
      '<li>Not products of a token that already trades: categories ' + mi.product_categories.map(esc).join(', ') +
      ' are out, as are names ending in a version marker, names carrying the whole word wrapped, staked or staking, and names beginning with an exchange\'s name. That is the watchlist\'s own product rule, applied at every size instead of only above its $50M floor — it is why a bridged form of a trading token never tops this board.</li>' +
      '<li>Token-live protocols are never ranked; they sit on the “Already trading” tab at market values.</li>' +
      '<li>Ties break by TVL, then by slug, so the board is identical on every run.</li>' +
      '</ul></section>' +
      '<section class="panel"><h3>Category multiples, as calibrated</h3>' +
      '<table class="mult-table"><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Live peers</th></tr></thead>' +
      '<tbody>' + multRows + '</tbody></table>' +
      '<p class="note">A category with no live peer prices at the global median. Multiples are recomputed from the snapshot on every run; nothing is carried between runs.</p></section>' +
      '</div>';
  }

  // ---------------------------------------------------------- routing
  function route() {
    var hash = location.hash.replace(/^#/, '');
    var name = 'board';
    if (hash === 'live') name = 'live';
    else if (hash === 'model') name = 'model';
    else if (hash.indexOf('detail-') === 0) name = 'detail';
    document.body.setAttribute('data-view', name);
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === name || (name === 'detail' && b.getAttribute('data-view') === 'board'));
    });
    if (name === 'live') renderLive();
    else if (name === 'model') renderModel();
    else if (name === 'detail') renderDetail(hash.slice('detail-'.length));
    else {
      if (hash === 'watchlist' && !fwatch.checked) fwatch.checked = true;
      renderBoard();
    }
  }
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    location.hash = b.getAttribute('data-view') === 'board' ? '' : b.getAttribute('data-view');
  });
  [q, fcat, fchain, ftvl].forEach(function (el) { el.addEventListener('input', renderBoard); });
  fwatch.addEventListener('change', renderBoard);
  window.addEventListener('hashchange', route);
  route();
})();
