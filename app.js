// public/app.js — FINAL (autocomplete + robust errors + logout UI clear)
const qs = sel => document.querySelector(sel);
const qsa = sel => Array.from(document.querySelectorAll(sel));

const loginView = qs('#loginView');
const appView   = qs('#appView');
const userBadge = qs('#userBadge');
const toastBox  = qs('#toast');

const $results = qs('#results');
const $watched = qs('#watched');
const $recsT   = qs('#recsTbody');
const $anaHead = qs('#anaThead');
const $anaBody = qs('#anaTbody');

let currentUser = null;
let lastAnalytics = [];
let lastAnalyticsKind = '';

function toast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.remove('hidden');
  setTimeout(() => toastBox.classList.add('hidden'), 2200);
}

function savePrefs() {
  const prefs = {
    minYear: qs('#minYear').value.trim(),
    minVotes: qs('#minVotes').value.trim(),
    wg: qs('#wg').value.trim(),
    wd: qs('#wd').value.trim(),
    wa: qs('#wa').value.trim(),
  };
  localStorage.setItem('moviePrefs', JSON.stringify(prefs));
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('moviePrefs') || '{}');
    if (p.minYear) qs('#minYear').value = p.minYear;
    if (p.minVotes) qs('#minVotes').value = p.minVotes;
    if (p.wg) qs('#wg').value = p.wg;
    if (p.wd) qs('#wd').value = p.wd;
    if (p.wa) qs('#wa').value = p.wa;
  } catch {}
}

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type':'application/json' }, ...opts });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || await res.text(); } catch { msg = await res.text(); }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

function showLogin() { loginView.classList.remove('hidden'); appView.classList.add('hidden'); }
function showApp()   { loginView.classList.add('hidden');   appView.classList.remove('hidden'); }

function setUser(u) { currentUser = u; userBadge.textContent = `Logged in as ${u}`; localStorage.setItem('movieUser', u); }

async function refreshWatched() {
  if (!currentUser) return;
  const list = await api(`/api/watched?username=${encodeURIComponent(currentUser)}`);
  $watched.innerHTML = '';
  for (const m of list) {
    const li = document.createElement('li');
    li.className = 'bg-white/10 rounded-lg border border-white/10 px-3 py-2 flex justify-between items-center';
    const L = document.createElement('span');
    L.textContent = `${m.title} (${m.release_year || '—'})`;
    const rm = document.createElement('button');
    rm.className = 'px-3 py-1 rounded bg-white/10 hover:bg-white/20';
    rm.textContent = 'Remove';
    rm.onclick = async () => {
      await api('/api/watched/remove', { method:'POST', body: JSON.stringify({ username: currentUser, movieId: m._id }) });
      refreshWatched();
    };
    li.appendChild(L); li.appendChild(rm);
    $watched.appendChild(li);
  }
}
qs('#refreshWatchedBtn').onclick = refreshWatched;

qs('#searchBtn').onclick = async () => {
  if (!currentUser) { toast('Login first'); return; }
  try {
    const q = qs('#q').value.trim();
    const list = await api(`/api/search?q=${encodeURIComponent(q)}`);
    $results.innerHTML = '';
    for (const m of list) {
      const li = document.createElement('li');
      li.className = 'bg-white/10 rounded-lg border border-white/10 px-3 py-2 flex justify-between items-center';
      const L = document.createElement('span');
      L.textContent = `${m.title} (${m.release_year || '—'}) ★${m.rating ?? '—'}`;
      const add = document.createElement('button');
      add.className = 'px-3 py-1 rounded bg-white/10 hover:bg-white/20';
      add.textContent = 'Add';
      add.onclick = async () => {
        await api('/api/watched/add', { method:'POST', body: JSON.stringify({ username: currentUser, movieId: m._id }) });
        refreshWatched();
        toast('Added to watched');
      };
      li.appendChild(L); li.appendChild(add);
      $results.appendChild(li);
    }
  } catch (e) { console.error(e); toast(`Search failed: ${e.message}`); }
};

function renderRecsTable(rows) {
  $recsT.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2 border-b border-white/10">${r.title}</td>
      <td class="px-3 py-2 border-b border-white/10">${r.release_year ?? ''}</td>
      <td class="px-3 py-2 border-b border-white/10">${r.rating ?? ''}</td>
      <td class="px-3 py-2 border-b border-white/10">${r.votes ?? ''}</td>
      <td class="px-3 py-2 border-b border-white/10">${r.total_score ?? ''}</td>
      <td class="px-3 py-2 border-b border-white/10">${(r.genres||[]).join(', ')}</td>
      <td class="px-3 py-2 border-b border-white/10">${(r.directors||[]).join(', ')}</td>
      <td class="px-3 py-2 border-b border-white/10">${(r.top_cast||[]).join(', ')}</td>
    `;
    $recsT.appendChild(tr);
  }
}
qs('#recBtn').onclick = async () => {
  if (!currentUser) { toast('Login first'); return; }
  savePrefs();
  const params = new URLSearchParams({ username: currentUser });
  ['minYear','minVotes','wg','wd','wa'].forEach(id => {
    const v = qs('#'+id).value.trim();
    if (v !== '') params.set(id, v);
  });
  try {
    const recs = await api(`/api/recommend?${params.toString()}`);
    renderRecsTable(recs);
    toast(`Loaded ${recs.length} recommendations`);
  } catch (e) { console.error(e); toast(`Recommendations failed: ${e.message}`); }
};

function toCSV(arr, headers) {
  const esc = v => { if (v == null) return ''; const s = String(v); return (s.includes('"')||s.includes(',')||s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s; };
  const head = headers.map(h=>esc(h.label)).join(',');
  const rows = arr.map(x => headers.map(h => esc(typeof h.get==='function' ? h.get(x) : x[h.key])).join(','));
  return [head, ...rows].join('\n');
}
qs('#exportRecsBtn').onclick = () => {
  const headers = [
    { label:'Title', key:'title' },
    { label:'Year',  key:'release_year' },
    { label:'Rating', key:'rating' },
    { label:'Votes', key:'votes' },
    { label:'Score', key:'total_score' },
    { label:'Genres', get: r => (r.genres||[]).join('; ') },
    { label:'Directors', get: r => (r.directors||[]).join('; ') },
    { label:'Top Cast', get: r => (r.top_cast||[]).join('; ') },
  ];
  const rows = Array.from($recsT.querySelectorAll('tr')).map(tr => {
    const t = tr.querySelectorAll('td');
    return { title:t[0].textContent, release_year:t[1].textContent, rating:t[2].textContent, votes:t[3].textContent, total_score:t[4].textContent, genres:t[5].textContent, directors:t[6].textContent, top_cast:t[7].textContent };
  });
  const csv = toCSV(rows, headers);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='recommendations.csv'; a.click();
};

// ---- Analytics ----
function setAnaHeaders(cols){ $anaHead.innerHTML = `<tr>${cols.map(c => `<th class='text-left px-3 py-2'>${c.label}</th>`).join('')}</tr>`; }
function setAnaRows(cols, data){
  $anaBody.innerHTML = '';
  for (const row of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => {
      const v = typeof c.get === 'function' ? c.get(row) : row[c.key];
      return `<td class="px-3 py-2 border-b border-white/10">${v ?? ''}</td>`;
    }).join('');
    $anaBody.appendChild(tr);
  }
}

qsa('.anaBtn').forEach(b => b.onclick = async () => {
  try {
    const kind = b.getAttribute('data-ana'); lastAnalyticsKind = kind;
    if (kind === 'director') {
      const ms = parseFloat(qs('#dsMinShare').value) || 0.6;
      const mf = parseInt(qs('#dsMinFilms').value) || 3;
      const data = await api(`/api/analytics/director-specialists?minShare=${encodeURIComponent(ms)}&minFilms=${encodeURIComponent(mf)}`);
      const withTop = data.map(d => {
        const by = d.byGenre || []; const top = by.reduce((a,c)=> c.count > (a?.count||0) ? c : a, null);
        return { director: d.director, total: d.total, topGenre: top?.genre || '', topShare: (top && d.total) ? (top.count/d.total) : 0 };
      });
      const cols = [
        { label:'Director', key:'director' },
        { label:'Total Films', key:'total' },
        { label:'Top Genre', key:'topGenre' },
        { label:'Top Share', get: r => (r.topShare*100).toFixed(1)+'%' },
      ];
      setAnaHeaders(cols); setAnaRows(cols, withTop); lastAnalytics = withTop;
      if (!withTop.length) toast('No directors matched — try lowering minShare or minFilms');
    }
    if (kind === 'actor') {
      const name = qs('#actorName').value.trim() || 'Henry Robert';
      const data = await api(`/api/analytics/actor-collab?name=${encodeURIComponent(name)}`);
      const rows = Array.isArray(data) ? data : (data.data || []);
      const canonical = Array.isArray(data) ? name : (data.canonical || name);
      const cols = [
        { label:'Actor (collaborator)', key:'_id' },
        { label:'Collaborations', key:'collaborations' },
        { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
      ];
      setAnaHeaders(cols); setAnaRows(cols, rows); lastAnalytics = rows;
      if (!rows.length) toast(`No collaborators found for "${name}"`);
      else toast(`Showing collaborators with ${canonical}`);
    }
    if (kind === 'genre') {
      const data = await api('/api/analytics/genre-decade');
      const cols = [
        { label:'Decade', get: r => r._id.decade },
        { label:'Genre',  get: r => r._id.genre },
        { label:'Films',  key:'films' },
        { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
      ];
      setAnaHeaders(cols); setAnaRows(cols, data); lastAnalytics = data;
    }
    if (kind === 'pairs') {
      const data = await api('/api/analytics/top-pairs');
      const cols = [
        { label:'Actor', get: r => r._id.actor },
        { label:'Director', get: r => r._id.director },
        { label:'Films', key:'films' },
        { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
      ];
      setAnaHeaders(cols); setAnaRows(cols, data); lastAnalytics = data;
    }
  } catch (e) { console.error(e); toast(`Analytics failed: ${e.message}`); }
});

qs('#exportAnaBtn').onclick = () => {
  if (!lastAnalytics.length) { toast('Run an analytics query first'); return; }
  let cols = [];
  if (lastAnalyticsKind === 'director') cols = [
    { label:'Director', key:'director' },
    { label:'Total Films', key:'total' },
    { label:'Top Genre', key:'topGenre' },
    { label:'Top Share', get: r => (r.topShare*100).toFixed(1)+'%' },
  ];
  if (lastAnalyticsKind === 'actor') cols = [
    { label:'Actor (collaborator)', key:'_id' },
    { label:'Collaborations', key:'collaborations' },
    { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
  ];
  if (lastAnalyticsKind === 'genre') cols = [
    { label:'Decade', get: r => r._id.decade },
    { label:'Genre',  get: r => r._id.genre },
    { label:'Films',  key:'films' },
    { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
  ];
  if (lastAnalyticsKind === 'pairs') cols = [
    { label:'Actor', get: r => r._id.actor },
    { label:'Director', get: r => r._id.director },
    { label:'Films', key:'films' },
    { label:'Avg Rating', get: r => (r.avgRating ?? 0).toFixed(2) },
  ];
  const csv = toCSV(lastAnalytics, cols);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download=(lastAnalyticsKind||'analytics')+'.csv'; a.click();
};

// ---- Autocomplete for actor ----
const actorInput = qs('#actorName');
const actorSug = qs('#actorSuggest');
let sugIndex = -1;
function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
async function loadActorSuggestions(q){
  if (!q) { actorSug.classList.add('hidden'); actorSug.innerHTML=''; return; }
  try { renderActorSuggestions(await api(`/api/actors?q=${encodeURIComponent(q)}`)); }
  catch(e) { console.error(e); actorSug.classList.add('hidden'); }
}
function renderActorSuggestions(list){
  actorSug.innerHTML = ''; sugIndex = -1;
  if (!Array.isArray(list) || !list.length){ actorSug.classList.add('hidden'); return; }
  list.forEach(item => {
    const li = document.createElement('li');
    li.className = 'px-3 py-2 hover:bg-white/10 cursor-pointer flex justify-between';
    li.innerHTML = `<span>${item._id}</span><span class="text-xs text-slate-400">${item.films}</span>`;
    li.onclick = () => { actorInput.value = item._id; actorSug.classList.add('hidden'); actorSug.innerHTML=''; };
    actorSug.appendChild(li);
  });
  actorSug.classList.remove('hidden');
}
actorInput.addEventListener('input', debounce(() => loadActorSuggestions(actorInput.value.trim()), 250));
document.addEventListener('click', (e) => { if (!actorSug.contains(e.target) && e.target !== actorInput) actorSug.classList.add('hidden'); });
actorInput.addEventListener('keydown', (e) => {
  if (actorSug.classList.contains('hidden')) return;
  const items = Array.from(actorSug.children); if (!items.length) return;
  if (e.key === 'ArrowDown'){ e.preventDefault(); sugIndex = (sugIndex+1) % items.length; updateSugHighlight(items); }
  if (e.key === 'ArrowUp'){   e.preventDefault(); sugIndex = (sugIndex-1+items.length) % items.length; updateSugHighlight(items); }
  if (e.key === 'Enter' && sugIndex >= 0){ e.preventDefault(); items[sugIndex].click(); }
});
function updateSugHighlight(items){ items.forEach((li,i)=> li.classList.toggle('bg-white/10', i===sugIndex)); }

// ---- Clear UI on logout ----
function clearUIOnLogout(){
  const id = s => document.querySelector(s);
  ['#q','#minYear','#minVotes','#wg','#wd','#wa','#actorName'].forEach(sel => { const el = id(sel); if (el) el.value = (sel==='#wg'?'0.4':sel==='#wd'?'0.25':sel==='#wa'?'0.15':''); });
  if ($results) $results.innerHTML=''; if ($watched) $watched.innerHTML='';
  if ($recsT) $recsT.innerHTML=''; if ($anaHead) $anaHead.innerHTML=''; if ($anaBody) $anaBody.innerHTML='';
}

// ---- Auth flow ----
qs('#loginSubmit').onclick = async () => {
  const u = qs('#loginUsername').value.trim();
  if (!u) return toast('Enter a username');
  try {
    await api('/api/login', { method:'POST', body: JSON.stringify({ username: u }) });
    setUser(u); showApp(); loadPrefs(); refreshWatched(); toast(`Welcome, ${u}!`);
  } catch (e) { toast(`Login failed: ${e.message}`); }
};
qs('#logoutBtn').onclick = () => {
  clearUIOnLogout();
  lastAnalytics=[]; lastAnalyticsKind='';
  localStorage.removeItem('movieUser');
  showLogin(); toast('Logged out');
};

// Auto-login if stored
(() => {
  const u = localStorage.getItem('movieUser');
  if (u) { setUser(u); showApp(); loadPrefs(); refreshWatched(); }
  else { showLogin(); }
})();
