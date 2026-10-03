const APP_VERSION = '1.4.3';
const GENRES=['動画','画像','ニュース','ブログ','SNS','エンタメ','スポーツ','ゲーム','技術','ショッピング','その他'];
function inferGenre(c){
  if(GENRES.includes(c.genre))return c.genre;
  const text=[c.name,c.title,c.url].join(' ').toLowerCase();
  for(const [genre,re] of [['スポーツ',/sport|soccer|baseball|スポーツ|野球|サッカー/],['ゲーム',/gaming|games?|ゲーム/],['技術',/tech|github|program|技術|プログラ/],['ショッピング',/shop|amazon|楽天|通販/],['ニュース',/news|ニュース/],['SNS',/twitter|x\.com|instagram|facebook|mastodon|SNS/i],['ブログ',/blog|ブログ/],['エンタメ',/entertainment|芸能|エンタメ/]])if(re.test(text))return genre;
  return c.type==='video'?'動画':c.type==='image'?'画像':'その他';
}
function genreBadge(c){return '<span class="genre-badge" data-genre="'+esc(inferGenre(c))+'">'+esc(inferGenre(c))+'</span>';}
const STORE_KEY = 'mymelter-state-v2';
const OLD_STORE_KEY = 'mymelter-state-v1';

const defaultState = {
  channels: [],
  candidates: [],
  history: [],
  saved: [],
  catalog: [],
  collections: [],
  positions: {},
  ui: {
    rankingMode: 'new',
    activeCollection: 'all',
    channelSort: 'recent',
    savedSort: 'recent'
  },
  settings: {
    fetchMode: 'auto',
    proxyUrl: '',
    proxyKey: '',
    shortcutEnabled: false,
    shortcutName: 'MyMelter保存'
  },
  meta: { lastDiscoveryUrl: '', lastDiscoveryAt: 0, pendingWebSimilar: null, browserImportVersion: 0 }
};

let state = loadState();
state.channels.forEach(c=>{if(!GENRES.includes(c.genre))c.genre=inferGenre(c);});
let deferredInstallPrompt = null;
let activeChannel = null;
let activeItems = [];
let activeReaderMode = 'list';
let activeEditId = null;
let toastTimer = null;
let currentRankingItems = [];
let activeCollectionItemUrl = '';
let feedSeenUrls = new Set();
let activeFeedItems = [];
let feedSoundOn = true;
let feedViewportHandler = null;
let feedObserver = null;
let feedScrollTimer = null;
let feedCurrentIndex = 0;
let feedRoutePrefs = new Map();
let feedActivationSerial = 0;
let feedHotOrder = [];
let feedControlsTimer = null;
let feedPlaybackWatchdog = null;
let feedWatchdogToken = 0;
let pendingMediaShare = null;
let workerCapability = {checked:false,checking:false,version:'',download:false,error:''};
let pressCandidate = null;
let browserImportTarget = '';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function uid(){ return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function esc(v=''){ return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function absoluteUrl(url, base){ try { return new URL(url, base).href; } catch { return ''; } }
function domainOf(url){ try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
function normalizeUrl(url){ try { const u = new URL(url); if(!/^https?:$/.test(u.protocol)) return ''; u.hash=''; return u.href; } catch { return ''; } }
function fmtDate(ts){ if(!ts) return ''; try { return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ts)); } catch { return ''; } }
function typeLabel(type){ return ({video:'動画',image:'画像',article:'記事',feed:'RSS/Atom',mixed:'混在'})[type] || '混在'; }
function typeGlyph(type){ return ({video:'▶',image:'▧',article:'≡',feed:'◎',mixed:'◇'})[type] || '◇'; }
function colorForType(type){ return ({video:'red',image:'green',article:'purple',feed:'blue',mixed:'gold'})[type] || 'blue'; }
function mediaKind(item){ if(item.videoUrl) return 'video'; if(item.image) return 'image'; return item.type || 'article'; }
function uniqueBy(arr, keyFn){ const seen=new Set(); return arr.filter(x=>{const k=keyFn(x); if(!k||seen.has(k)) return false; seen.add(k); return true;}); }
function isMediaUrl(url=''){ return /\.(mp4|m4v|mov|webm|m3u8)(?:$|[?#])/i.test(url); }
function isImageUrl(url=''){ return /\.(jpe?g|png|gif|webp|avif)(?:$|[?#])/i.test(url); }
function fmtDuration(seconds){ const n=Math.max(0,Math.floor(Number(seconds)||0)); const m=Math.floor(n/60); const sec=String(n%60).padStart(2,'0'); return `${m}:${sec}`; }
function itemStamp(item){ return Number(item?.publishedAt||item?.firstSeenAt||item?.lastSeenAt||item?.visitedAt||item?.savedAt||0); }
function isSavedUrl(url){ return !!url&&state.saved.some(x=>x.url===url); }
function combinedItems(){
  const map=new Map();
  for(const x of [...state.catalog,...state.history,...state.saved]){
    if(!x?.url) continue;
    const prev=map.get(x.url)||{};
    map.set(x.url,{...prev,...x,viewCount:Math.max(Number(prev.viewCount||0),Number(x.viewCount||0))});
  }
  return [...map.values()];
}
function rememberItems(items){
  const map=new Map(state.catalog.map(x=>[x.url,x])); const now=Date.now();
  items.forEach((item,pos)=>{
    if(!item?.url)return;
    const prev=map.get(item.url)||{};
    map.set(item.url,{...prev,...item,firstSeenAt:prev.firstSeenAt||Math.max(1,now-pos),lastSeenAt:now,viewCount:Number(prev.viewCount||0)});
  });
  state.catalog=[...map.values()].sort((a,b)=>(b.lastSeenAt||0)-(a.lastSeenAt||0)).slice(0,800);
}
function bumpCatalogView(item,viewCount){
  if(!item?.url)return;
  const idx=state.catalog.findIndex(x=>x.url===item.url); const now=Date.now();
  const next={...(idx>=0?state.catalog[idx]:{}),...item,firstSeenAt:idx>=0?(state.catalog[idx].firstSeenAt||now):now,lastSeenAt:now,lastViewedAt:now,viewCount};
  if(idx>=0) state.catalog[idx]=next; else state.catalog.unshift(next);
  state.catalog=state.catalog.slice(0,800);
}

function toast(msg){
  const el=$('#toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2400);
}

function loadState(){
  try{
    const current = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if(current){
      return {
        ...clone(defaultState), ...current,
        settings:{...defaultState.settings,...(current.settings||{})},
        meta:{...defaultState.meta,...(current.meta||{})},
        channels:Array.isArray(current.channels)?current.channels:[],
        candidates:Array.isArray(current.candidates)?current.candidates:[],
        history:Array.isArray(current.history)?current.history:[],
        saved:Array.isArray(current.saved)?current.saved:[],
        catalog:Array.isArray(current.catalog)?current.catalog:[],
        collections:Array.isArray(current.collections)?current.collections:[],
        positions:current.positions&&typeof current.positions==='object'?current.positions:{},
        ui:{...defaultState.ui,...(current.ui||{})}
      };
    }
    const old = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || 'null');
    if(old){
      return {
        ...clone(defaultState),
        channels:(old.channels||[]).map(c=>normalizeChannel(c)),
        history:old.history||[],
        saved:old.favorites||[],
        settings:{...defaultState.settings,...(old.settings||{})}
      };
    }
  }catch(e){ console.warn('state load failed',e); }
  return clone(defaultState);
}
function saveState(render=true){
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if(render) renderAll();
}
function normalizeChannel(c){
  return {
    ...c, genre:inferGenre(c), id:c.id||uid(), name:c.name||domainOf(c.url)||'チャンネル', url:c.url||'', type:c.type||'mixed', color:c.color||colorForType(c.type||'mixed'),
    searchUrl:c.searchUrl||'', selectors:{item:'',title:'',image:'',link:'',video:'',...(c.selectors||{})},
    source:c.source||'', browserSourceUrl:c.browserSourceUrl||'',
    snapshotItems:Array.isArray(c.snapshotItems)?c.snapshotItems:[],
    deepDiveItems:Array.isArray(c.deepDiveItems)?c.deepDiveItems:[],
    createdAt:c.createdAt||Date.now(), updatedAt:Date.now(), itemCount:c.itemCount||0, lastOpenedAt:c.lastOpenedAt||0
  };
}

function navigate(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
  window.scrollTo({top:0,behavior:'auto'});
  if(name==='channels') renderChannelManager();
  if(name==='history') renderHistory();
  if(name==='saved') renderSaved();
}

function channelPreviewItem(c){
  const primary=Array.isArray(c?.snapshotItems)?c.snapshotItems:[];
  const deep=Array.isArray(c?.deepDiveItems)?c.deepDiveItems:[];
  const items=[...primary,...deep];
  return items.find(x=>x?.image)||items.find(x=>x?.videoUrl)||null;
}
function channelIconHTML(c){
  const preview=channelPreviewItem(c);
  if(preview?.image) return `<span class="channel-icon channel-icon-image"><img ${imageSourceAttrs(preview.image)} alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  return `<span class="channel-icon">${esc(typeGlyph(c.type))}</span>`;
}
function managerVisualHTML(c){
  const preview=channelPreviewItem(c);
  if(preview?.image) return `<span class="manager-icon manager-thumb"><img ${imageSourceAttrs(preview.image)} alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  return `<span class="manager-icon" style="background:${colorCss(c.color)}">${esc(typeGlyph(c.type))}</span>`;
}
function renderHomeChannels(){
  const root=$('#homeChannels');
  if(!state.channels.length){
    root.innerHTML=`<div class="empty-card" style="grid-column:1/-1"><strong style="color:#334b68">まだチャンネルがありません。</strong><br>下の「チャンネルを追加」からサイトURLを貼ると、自動解析できます。</div>`;
    return;
  }
  root.innerHTML=state.channels.slice(0,8).map(c=>`
    <button class="channel-card ${esc(c.color||colorForType(c.type))}" data-open-channel="${esc(c.id)}">
      <span>${channelIconHTML(c)}<strong>${esc(c.name)}</strong><small>${genreBadge(c)} ${esc(domainOf(c.url))}</small></span>
      <span class="meta">${esc(typeLabel(c.type))} · ${Number(c.itemCount||0)}件${Array.isArray(c.deepDiveItems)&&c.deepDiveItems.length?` · 深掘り${c.deepDiveItems.length}`:''}</span>
    </button>`).join('');
}
function renderCandidates(){
  const root=$('#candidateList');
  if(!state.candidates.length){
    root.innerHTML=`<div class="empty-card">サイトURLを解析すると、ここに「新着動画」「画像ギャラリー」「RSS」などの候補が自動表示されます。</div>`;
    return;
  }
  root.innerHTML=state.candidates.slice(0,12).map(c=>`
    <article class="candidate-card">
      <div class="candidate-top"><span class="mini-icon">${esc(typeGlyph(c.type))}</span><span><strong>${esc(c.name)}</strong><small>${esc(typeLabel(c.type))} · ${esc(domainOf(c.url))}</small></span></div>
      <div class="candidate-actions"><button class="mini-primary" data-add-candidate="${esc(c.id)}">＋ 追加</button><button class="mini-secondary" data-preview-candidate="${esc(c.id)}">確認</button></div>
    </article>`).join('')+`<article class="candidate-card"><div class="candidate-top"><span class="mini-icon">＋</span><span><strong>候補をまとめて追加</strong><small>未登録URLだけ追加します</small></span></div><div class="candidate-actions"><button class="mini-primary" data-add-all-candidates>まとめて追加</button></div></article>`;
}
function thumbHTML(item, cls='media-thumb'){
  if(item.image) return `<div class="${cls}"><img ${imageSourceAttrs(item.image)} alt="" loading="lazy" referrerpolicy="no-referrer"><span class="media-badge">${esc(typeLabel(mediaKind(item)))}</span></div>`;
  return `<div class="${cls}"><span class="placeholder">${esc(typeGlyph(mediaKind(item)))}</span><span class="media-badge">${esc(typeLabel(mediaKind(item)))}</span></div>`;
}
function renderStrip(root, items, kind){
  if(!items.length){ root.innerHTML=`<div class="empty-card">${kind==='recent'?'まだ閲覧履歴がありません。':'まだ保存した項目がありません。'}</div>`; return; }
  root.innerHTML=items.slice(0,12).map((x,i)=>`<button class="media-card" data-${kind}-index="${i}">${thumbHTML(x)}<strong>${esc(x.title||'無題')}</strong><small>${esc(x.channelName||domainOf(x.url)||typeLabel(mediaKind(x)))}</small></button>`).join('');
}
function getRankingItems(mode=state.ui.rankingMode){
  let items=combinedItems();
  if(mode==='saved'){
    const savedMap=new Map(state.saved.map(x=>[x.url,x]));
    items=items.filter(x=>savedMap.has(x.url)).map(x=>({...x,savedAt:savedMap.get(x.url)?.savedAt||x.savedAt||0})).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  }else if(mode==='frequent'){
    items=items.sort((a,b)=>(Number(b.viewCount||0)-Number(a.viewCount||0))||((b.lastViewedAt||b.visitedAt||0)-(a.lastViewedAt||a.visitedAt||0)));
  }else{
    items=items.sort((a,b)=>itemStamp(b)-itemStamp(a));
  }
  return items.slice(0,8);
}
function renderRanking(){
  const mode=state.ui.rankingMode||'new';
  document.querySelectorAll('#rankingTabs [data-ranking-mode]').forEach(b=>b.classList.toggle('active',b.dataset.rankingMode===mode));
  currentRankingItems=getRankingItems(mode);
  const root=$('#rankingGrid');
  if(!currentRankingItems.length){
    root.innerHTML=`<div class="empty-card ranking-empty">${mode==='saved'?'保存すると、ここにお気に入りが並びます。':'チャンネルを開くと、取得した項目がここに並びます。'}</div>`;
    return;
  }
  root.innerHTML=currentRankingItems.map((x,i)=>{
    const meta=mode==='frequent'?`${Number(x.viewCount||0)}回閲覧`:mode==='saved'?`保存 ${fmtDate(x.savedAt)}`:(itemStamp(x)?fmtDate(itemStamp(x)):'新着');
    return `<button class="rank-card" data-ranking-index="${i}"><span class="rank-number">${i+1}</span>${thumbHTML(x,'rank-thumb')}<span class="rank-copy"><strong>${esc(x.title||'無題')}</strong><small>${esc(x.channelName||domainOf(x.url)||typeLabel(mediaKind(x)))}</small><span class="rank-meta">${esc(meta)}${isSavedUrl(x.url)?' · ♥ 保存済み':''}</span></span></button>`;
  }).join('');
}
function renderHome(){ renderHomeChannels(); renderRanking(); renderCandidates(); renderStrip($('#recentStrip'),state.history,'recent'); renderStrip($('#savedStrip'),state.saved,'saved'); }

function renderChannelManager(){
  const q=$('#channelFilter').value.trim().toLowerCase(); const type=$('#channelTypeFilter').value; const sort=state.ui.channelSort||'recent';
  if($('#channelSort')) $('#channelSort').value=sort;
  const genre=state.ui.channelGenre||'all';
  $('#channelGenreFilters').innerHTML=['all',...GENRES].map(g=>`<button type="button" class="collection-chip ${genre===g?'active':''}" data-genre-filter="${esc(g)}">${g==='all'?'すべて':esc(g)}</button>`).join('');
  const list=state.channels.filter(c=>(genre==='all'||inferGenre(c)===genre)&&(type==='all'||c.type===type)&&(!q||`${c.name} ${c.url}`.toLowerCase().includes(q)));
  list.sort((a,b)=>sort==='name'?String(a.name||'').localeCompare(String(b.name||''),'ja'):sort==='added'?(b.createdAt||0)-(a.createdAt||0):sort==='updated'?(b.updatedAt||0)-(a.updatedAt||0):((b.lastOpenedAt||0)-(a.lastOpenedAt||0)||((b.createdAt||0)-(a.createdAt||0))));
  const root=$('#channelManager');
  if(!list.length){root.innerHTML=`<div class="empty-card">条件に一致するチャンネルがありません。</div>`;return;}
  root.innerHTML=list.map(c=>`
    <article class="manager-card">
      ${managerVisualHTML(c)}
      <div class="manager-main"><strong>${esc(c.name)}</strong>${genreBadge(c)}<small>${esc(typeLabel(c.type))}${Array.isArray(c.deepDiveItems)&&c.deepDiveItems.length?` · 深掘り${c.deepDiveItems.length}動画`:''} · ${esc(c.url)}</small></div>
      <div class="manager-actions"><button class="icon-action" data-similar-channel="${esc(c.id)}">似たサイトを探す</button><button class="icon-action" data-open-channel="${esc(c.id)}">開く</button><button class="icon-action" data-edit-channel="${esc(c.id)}">編集</button></div>
    </article>`).join('');
}
function colorCss(color){ return ({blue:'linear-gradient(135deg,#1677ff,#57a5ff)',red:'linear-gradient(135deg,#ff525f,#ff8b91)',green:'linear-gradient(135deg,#21b77f,#63d7ae)',purple:'linear-gradient(135deg,#7456ed,#a68ffb)',gold:'linear-gradient(135deg,#eba91b,#ffd467)'})[color]||'linear-gradient(135deg,#1677ff,#57a5ff)'; }

function libraryItemHTML(x,index,kind){
  const thumb=x.image?`<img class="library-thumb" ${imageSourceAttrs(x.image)} alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="library-placeholder">${esc(typeGlyph(mediaKind(x)))}</span>`;
  const pos=Number(state.positions[x.videoUrl||x.url]||0); const details=[];
  if(x.visitedAt) details.push(fmtDate(x.visitedAt)); if(Number(x.viewCount||0)>1) details.push(`${Number(x.viewCount)}回閲覧`); if(pos>1) details.push(`続き ${fmtDuration(pos)}`);
  return `<article class="library-item">${thumb}<div class="library-copy"><strong>${esc(x.title||'無題')}</strong><small>${esc(x.channelName||domainOf(x.url))}${details.length?` · ${esc(details.join(' · '))}`:''}</small></div><div class="library-actions"><button class="icon-action" data-open-library="${kind}:${index}">開く</button>${kind==='saved'?`<button class="icon-action" data-collection-item="${index}">リスト</button><button class="icon-action" data-remove-saved="${index}">削除</button>`:`<button class="icon-action" data-save-history="${index}">保存</button>`}</div></article>`;
}
function renderHistory(){ const root=$('#historyList'); root.innerHTML=state.history.length?state.history.map((x,i)=>libraryItemHTML(x,i,'history')).join(''):`<div class="empty-card">履歴はまだありません。</div>`; }
function collectionCount(c){ return (c.itemUrls||[]).filter(url=>isSavedUrl(url)).length; }
function renderCollections(){
  const root=$('#collectionTabs'); if(!root)return;
  if(state.ui.activeCollection!=='all'&&!state.collections.some(c=>c.id===state.ui.activeCollection)) state.ui.activeCollection='all';
  root.innerHTML=`<button class="collection-chip ${state.ui.activeCollection==='all'?'active':''}" data-collection-filter="all">すべて <span>${state.saved.length}</span></button>`+
    state.collections.map(c=>`<button class="collection-chip ${state.ui.activeCollection===c.id?'active':''}" data-collection-filter="${esc(c.id)}">${esc(c.name)} <span>${collectionCount(c)}</span></button>`).join('');
}
function renderSaved(){
  renderCollections();
  const q=$('#savedFilter').value.trim().toLowerCase(); const type=$('#savedTypeFilter').value; const sort=state.ui.savedSort||'recent';
  if($('#savedSort')) $('#savedSort').value=sort;
  const active=state.ui.activeCollection||'all'; const collection=active==='all'?null:state.collections.find(c=>c.id===active); const allowed=collection?new Set(collection.itemUrls||[]):null;
  const filtered=state.saved.map((x,i)=>({...x,_index:i})).filter(x=>(!allowed||allowed.has(x.url))&&(type==='all'||mediaKind(x)===type)&&(!q||`${x.title} ${x.url}`.toLowerCase().includes(q)));
  filtered.sort((a,b)=>sort==='title'?String(a.title||'').localeCompare(String(b.title||''),'ja'):sort==='frequent'?(Number(b.viewCount||0)-Number(a.viewCount||0)):sort==='new'?(itemStamp(b)-itemStamp(a)):((b.savedAt||0)-(a.savedAt||0)));
  $('#savedList').innerHTML=filtered.length?filtered.map(x=>libraryItemHTML(x,x._index,'saved')).join(''):`<div class="empty-card">この条件の保存済み項目はありません。</div>`;
}
function renderCollectionChooser(){
  const root=$('#collectionChooser'); if(!root)return;
  if(!state.collections.length){root.innerHTML=`<div class="empty-card">まだリストがありません。上で名前を入力して作成できます。</div>`;return;}
  root.innerHTML=state.collections.map(c=>{
    const selected=!!activeCollectionItemUrl&&(c.itemUrls||[]).includes(activeCollectionItemUrl);
    return `<article class="collection-manage-row"><button class="collection-main ${selected?'selected':''}" data-toggle-collection="${esc(c.id)}" ${activeCollectionItemUrl?'':'disabled'}><span><strong>${esc(c.name)}</strong><small>${collectionCount(c)}件</small></span><b>${activeCollectionItemUrl?(selected?'✓':'＋'):'—'}</b></button><button class="collection-delete" data-delete-collection="${esc(c.id)}" aria-label="${esc(c.name)}を削除">×</button></article>`;
  }).join('');
}
function openCollectionDialog(item=null){
  activeCollectionItemUrl=item?.url||''; $('#collectionDialogTitle').textContent=item?'リストに追加':'リスト管理'; $('#collectionNameInput').value=''; renderCollectionChooser(); $('#collectionDialog').showModal();
}
function createCollection(){
  const name=$('#collectionNameInput').value.trim(); if(!name){toast('リスト名を入力してください');return;}
  if(state.collections.some(c=>c.name.toLowerCase()===name.toLowerCase())){toast('同じ名前のリストがあります');return;}
  const c={id:uid(),name,itemUrls:activeCollectionItemUrl?[activeCollectionItemUrl]:[],createdAt:Date.now()}; state.collections.unshift(c); state.ui.activeCollection=c.id;
  saveState(false); renderSaved(); renderCollectionChooser(); $('#collectionNameInput').value=''; toast(`「${name}」を作成しました`);
}
function toggleCollection(id){
  if(!activeCollectionItemUrl)return; const c=state.collections.find(x=>x.id===id); if(!c)return; c.itemUrls=Array.isArray(c.itemUrls)?c.itemUrls:[];
  c.itemUrls=c.itemUrls.includes(activeCollectionItemUrl)?c.itemUrls.filter(x=>x!==activeCollectionItemUrl):[activeCollectionItemUrl,...c.itemUrls];
  saveState(false); renderSaved(); renderCollectionChooser();
}
function deleteCollection(id){
  const c=state.collections.find(x=>x.id===id); if(!c)return;
  if(!confirm(`「${c.name}」を削除しますか？\n保存済みの項目そのものは削除されません。`))return;
  state.collections=state.collections.filter(x=>x.id!==id); if(state.ui.activeCollection===id)state.ui.activeCollection='all'; saveState(false); renderSaved(); renderCollectionChooser();
}
function removeSavedAt(index){
  const removed=state.saved[index]; if(!removed)return; state.saved.splice(index,1);
  state.collections.forEach(c=>c.itemUrls=(c.itemUrls||[]).filter(url=>url!==removed.url)); saveState();
}
function renderSettings(){
  $('#fetchMode').value=state.settings.fetchMode; $('#proxyUrl').value=state.settings.proxyUrl; $('#proxyKey').value=state.settings.proxyKey;
  $('#shortcutEnabled').checked=!!state.settings.shortcutEnabled; $('#shortcutName').value=state.settings.shortcutName||'MyMelter保存';
}
function renderAll(){ renderHome(); renderChannelManager(); renderHistory(); renderSaved(); renderSettings(); }

function openChannelEditor(channel=null){
  activeEditId=channel?.id||null;
  const c=channel||normalizeChannel({name:'',url:'',type:'mixed',color:'blue'});
  $('#channelDialogTitle').textContent=channel?'チャンネル編集':'チャンネル追加';
  $('#channelGenre').innerHTML='<option value="">自動判定</option>'+GENRES.map(g=>`<option>${g}</option>`).join(''); $('#channelGenre').value=c.genre||'';
  $('#channelId').value=c.id||''; $('#channelName').value=c.name||''; $('#channelUrl').value=c.url||''; $('#channelType').value=c.type||'mixed'; $('#channelColor').value=c.color||colorForType(c.type);
  $('#itemSelector').value=c.selectors?.item||''; $('#titleSelector').value=c.selectors?.title||''; $('#imageSelector').value=c.selectors?.image||''; $('#linkSelector').value=c.selectors?.link||''; $('#videoSelector').value=c.selectors?.video||''; $('#searchUrl').value=c.searchUrl||'';
  $('#deleteChannelBtn').hidden=!channel; $('#channelTestStatus').textContent='';
  $('#channelDialog').showModal();
}
function channelFromForm(){
  const url=normalizeUrl($('#channelUrl').value.trim());
  const existing=state.channels.find(x=>x.id===activeEditId);
  return normalizeChannel({
    ...existing, genre:$('#channelGenre').value, id:activeEditId||uid(), name:$('#channelName').value.trim()||domainOf(url)||'チャンネル', url, type:$('#channelType').value, color:$('#channelColor').value, searchUrl:$('#searchUrl').value.trim(),
    selectors:{item:$('#itemSelector').value.trim(),title:$('#titleSelector').value.trim(),image:$('#imageSelector').value.trim(),link:$('#linkSelector').value.trim(),video:$('#videoSelector').value.trim()},
    source:existing?.source||'', browserSourceUrl:existing?.browserSourceUrl||'', snapshotItems:existing?.snapshotItems||[], deepDiveItems:existing?.deepDiveItems||[],
    createdAt:existing?.createdAt||Date.now()
  });
}
function saveChannelFromForm(){
  const c=channelFromForm(); if(!c.url){toast('URLを確認してください');return false;}
  const idx=state.channels.findIndex(x=>x.id===c.id); if(idx>=0) state.channels[idx]={...state.channels[idx],...c}; else state.channels.unshift(c);
  state.candidates=state.candidates.filter(x=>x.url!==c.url); saveState(); $('#channelDialog').close(); toast('チャンネルを保存しました'); return true;
}

async function fetchDirect(url){
  const r=await fetch(url,{method:'GET',mode:'cors',credentials:'omit',redirect:'follow',headers:{'Accept':'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text();
}
function alternatePublicUrl(url){
  try{
    const u=new URL(url);
    if(/(^|\.)twidouga\.net$/i.test(u.hostname)&&/^\/jp\/ranking\/?$/i.test(u.pathname)){
      u.pathname='/jp/ranking_t1.php'; u.search=''; u.hash=''; return u.href;
    }
  }catch{}
  return '';
}
function workerErrorMessage(status,errorCode,upstreamStatus,finalUrl){
  if(errorCode==='worker-key'||status===401) return 'Workerキーが一致していません。設定のWorkerキーを確認してください。';
  if(errorCode==='target-blocked') return 'Workerの安全設定でこのURLへの接続を拒否しました。';
  if(errorCode==='upstream-network') return 'Workerから取得先サイトへ接続できませんでした。';
  if(errorCode==='upstream-http'||upstreamStatus){
    const code=Number(upstreamStatus||status);
    if(code===403) return `取得先サイトがWorker経由のアクセスをHTTP 403で拒否しました${finalUrl?`（${finalUrl}）`:''}。`;
    if(code===429) return '取得先サイトがアクセス頻度を制限しています（HTTP 429）。時間を空けて再試行してください。';
    return `取得先サイトがHTTP ${code}を返しました${finalUrl?`（${finalUrl}）`:''}。`;
  }
  return `Worker HTTP ${status}`;
}
async function fetchProxyOnce(url){
  const base=state.settings.proxyUrl.trim().replace(/\/+$/,''); if(!base) throw new Error('Worker URLが未設定です');
  const u=new URL(base); u.searchParams.set('url',url); if(state.settings.proxyKey) u.searchParams.set('key',state.settings.proxyKey);
  const r=await fetch(u.href,{credentials:'omit'});
  if(!r.ok){
    const errorCode=r.headers.get('X-MyMelter-Error')||'';
    const upstreamStatus=r.headers.get('X-MyMelter-Upstream-Status')||'';
    const finalUrl=r.headers.get('X-MyMelter-Final-URL')||'';
    const err=new Error(workerErrorMessage(r.status,errorCode,upstreamStatus,finalUrl));
    err.status=r.status; err.errorCode=errorCode; err.upstreamStatus=Number(upstreamStatus||0); err.finalUrl=finalUrl; throw err;
  }
  return await r.text();
}
let workerTestBusy=false;
async function testWorkerConnection(){
  const status=$('#workerTestStatus'); const btn=$('#workerTestBtn');
  if(workerTestBusy)return;
  const base=state.settings.proxyUrl.trim().replace(/\/+$/,'');
  if(!base){status.textContent='Worker URLが未設定です。';return;}
  workerTestBusy=true; status.textContent='Workerへ接続しています…'; btn.disabled=true; btn.classList.add('is-testing');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const u=new URL(base); u.searchParams.set('url','https://example.com/'); if(state.settings.proxyKey)u.searchParams.set('key',state.settings.proxyKey);
    const r=await fetch(u.href,{credentials:'omit',signal:controller.signal}); const version=r.headers.get('X-MyMelter-Worker-Version')||'旧版/不明'; const errorCode=r.headers.get('X-MyMelter-Error')||'';
    if(r.ok) status.textContent=`接続PASS · Worker ${version}${version==='1.1'?' · 403診断対応':''}`;
    else status.textContent=`接続できましたが HTTP ${r.status} · Worker ${version}${errorCode?` · ${errorCode}`:''}`;
  }catch(e){
    status.textContent=e?.name==='AbortError'?'接続FAIL：8秒以内に応答がありません。Worker URLまたはCloudflare側を確認してください。':`接続FAIL：${e.message}`;
  }finally{
    clearTimeout(timer); workerTestBusy=false; btn.disabled=false; btn.classList.remove('is-testing');
  }
}

async function fetchProxy(url){
  try{return await fetchProxyOnce(url);}
  catch(err){
    const alt=alternatePublicUrl(url);
    const isUpstream403=Number(err.upstreamStatus||err.status)===403&&(err.errorCode==='upstream-http'||!err.errorCode);
    if(alt&&isUpstream403){
      try{
        const text=await fetchProxyOnce(alt);
        toast('元URLが403のため、公開ランキング実ページへ切り替えました');
        return text;
      }catch(altErr){
        const e=new Error(`${err.message} 代替URL（${alt}）も取得できませんでした: ${altErr.message}`);
        e.status=altErr.status; e.errorCode=altErr.errorCode; e.upstreamStatus=altErr.upstreamStatus; throw e;
      }
    }
    throw err;
  }
}
async function fetchText(url){
  const mode=state.settings.fetchMode||'auto';
  if(mode==='direct') return fetchDirect(url);
  if(mode==='proxy') return fetchProxy(url);
  try{return await fetchDirect(url);}catch(directErr){
    if(!state.settings.proxyUrl) throw new Error(`直接取得失敗: ${directErr.message}。設定で無料Workerを登録すると対応範囲が広がります。`);
    try{return await fetchProxy(url);}catch(proxyErr){throw new Error(`直接取得: ${directErr.message} / Worker: ${proxyErr.message}`);}
  }
}

function parseMaybeXml(text){
  if(!/^\s*</.test(text)) return null;
  const xml=new DOMParser().parseFromString(text,'application/xml'); if(xml.querySelector('parsererror')) return null; return xml;
}
function nodeText(node, selectors=[]){ for(const s of selectors){const el=node.querySelector?.(s); const t=el?.textContent?.trim(); if(t) return t;} return ''; }
function attrFrom(node, selectors, attrs){ for(const s of selectors){const el=node.matches?.(s)?node:node.querySelector?.(s); if(el){for(const a of attrs){const v=el.getAttribute?.(a); if(v) return v;}}} return ''; }
function selectorValue(node, selector, kind){
  if(!selector) return ''; let sel=selector, attr=''; const m=selector.match(/^(.*)@([\w:-]+)$/); if(m){sel=m[1].trim();attr=m[2];}
  let el; try{el=node.matches?.(sel)?node:node.querySelector(sel);}catch{return '';}
  if(!el) return ''; if(attr) return el.getAttribute(attr)||'';
  if(kind==='image') return el.getAttribute('src')||el.getAttribute('data-src')||el.getAttribute('data-lazy-src')||'';
  if(kind==='link') return el.getAttribute('href')||'';
  if(kind==='video') return el.getAttribute('src')||el.querySelector?.('source')?.getAttribute('src')||'';
  return el.textContent?.trim()||'';
}
function parseFeed(xml,channel,baseUrl){
  const entries=[...xml.querySelectorAll('item, entry')];
  return entries.slice(0,160).map(entry=>{
    const title=nodeText(entry,['title'])||'無題';
    let link=entry.querySelector('link[href]')?.getAttribute('href')||nodeText(entry,['link']);
    const enclosure=entry.querySelector('enclosure[url]'); const encUrl=enclosure?.getAttribute('url')||''; const encType=enclosure?.getAttribute('type')||'';
    const media=[...entry.getElementsByTagNameNS('*','content')].find(n=>n.getAttribute('url'));
    const mediaUrl=media?.getAttribute('url')||encUrl;
    let image=''; let videoUrl='';
    if(/^video\//i.test(encType)||isMediaUrl(mediaUrl)) videoUrl=absoluteUrl(mediaUrl,baseUrl); else if(/^image\//i.test(encType)||isImageUrl(mediaUrl)) image=absoluteUrl(mediaUrl,baseUrl);
    if(!image){ const html=nodeText(entry,['description','summary','content']); if(html){const d=new DOMParser().parseFromString(html,'text/html'); image=absoluteUrl(d.querySelector('img')?.getAttribute('src')||'',baseUrl);} }
    link=absoluteUrl(link||mediaUrl,baseUrl);
    const publishedRaw=nodeText(entry,['pubDate','published','updated','date']); const publishedAt=Date.parse(publishedRaw)||0;
    return {id:uid(),title,url:link,image,videoUrl,type:videoUrl?'video':image?'image':'article',channelId:channel.id,channelName:channel.name,publishedAt};
  }).filter(x=>x.url);
}
function parseSitemap(xml,channel){
  const locs=[...xml.querySelectorAll('url > loc, sitemap > loc')].map(x=>x.textContent.trim()).filter(Boolean);
  return locs.slice(0,200).map(url=>{let title='ページ';try{const u=new URL(url);title=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||u.hostname).replace(/[-_]/g,' ');}catch{}return{id:uid(),title,url,type:'article',channelId:channel.id,channelName:channel.name};});
}
function genericNodes(doc){
  const candidates=['article','main .post','main .item','main .card','main li','.post','.entry','.item','.card'];
  for(const sel of candidates){let nodes=[];try{nodes=[...doc.querySelectorAll(sel)];}catch{} nodes=nodes.filter(n=>n.querySelector('a[href]')&&(n.textContent||'').trim().length>3); if(nodes.length>=2) return nodes.slice(0,160);}
  return [...doc.querySelectorAll('a[href]')].filter(a=>(a.textContent||'').trim().length>3).slice(0,160);
}
function parseHtml(text,channel,baseUrl){
  const doc=new DOMParser().parseFromString(text,'text/html'); let nodes=[];
  if(channel.selectors?.item){ try{nodes=[...doc.querySelectorAll(channel.selectors.item)];}catch{} }
  if(!nodes.length) nodes=genericNodes(doc);
  const items=nodes.map((node,idx)=>{
    let title=selectorValue(node,channel.selectors?.title,'title')||nodeText(node,['h1','h2','h3','h4','.title','a[title]'])||(node.matches?.('a')?node.textContent.trim():'')||`Item ${idx+1}`;
    let link=selectorValue(node,channel.selectors?.link,'link')||attrFrom(node,['a[href]'],['href'])||(node.matches?.('a')?node.getAttribute('href'):'');
    let image=selectorValue(node,channel.selectors?.image,'image')||attrFrom(node,['img'],['src','data-src','data-lazy-src']);
    let videoUrl=selectorValue(node,channel.selectors?.video,'video')||attrFrom(node,['video[src]','video source[src]','source[src]','a[href$=".mp4"]','a[href*=".m3u8"]'],['src','href']);
    link=absoluteUrl(link,baseUrl); image=absoluteUrl(image,baseUrl); videoUrl=absoluteUrl(videoUrl,baseUrl);
    if(!videoUrl&&isMediaUrl(link)) videoUrl=link; if(!image&&isImageUrl(link)) image=link;
    let type=videoUrl?'video':image?'image':'article'; if(channel.type!=='mixed'&&channel.type!=='feed') type=channel.type;
    const timeEl=node.querySelector?.('time[datetime], [data-date], [data-published]'); const publishedRaw=timeEl?.getAttribute?.('datetime')||timeEl?.getAttribute?.('data-date')||timeEl?.getAttribute?.('data-published')||''; const publishedAt=Date.parse(publishedRaw)||0;
    return {id:uid(),title:title.replace(/\s+/g,' ').trim().slice(0,300),url:link,image,videoUrl,type,channelId:channel.id,channelName:channel.name,publishedAt};
  }).filter(x=>x.url&&x.title);
  return uniqueBy(items,x=>x.url).slice(0,160);
}
function parseChannelContent(text,channel,baseUrl){
  const xml=parseMaybeXml(text);
  if(xml){ if(xml.querySelector('rss, feed')) return parseFeed(xml,channel,baseUrl); if(xml.querySelector('urlset, sitemapindex')) return parseSitemap(xml,channel); }
  return parseHtml(text,channel,baseUrl);
}

function candidateFrom(url,name,type='mixed',extra={}){ return {id:uid(),url:normalizeUrl(url),name:name||domainOf(url),type,color:colorForType(type),image:normalizeUrl(extra.image||extra.thumbnail||''),similarityScore:Number(extra.similarityScore||0),selectors:{item:'',title:'',image:'',link:'',video:'',...(extra.selectors||{})},searchUrl:extra.searchUrl||'',source:extra.source||'auto'}; }
function guessTypeFromText(text='',url=''){ const s=`${text} ${url}`.toLowerCase(); if(/video|movie|動画|youtube|vimeo/.test(s))return'video'; if(/image|photo|gallery|写真|画像|pix/.test(s))return'image'; if(/blog|news|article|post|記事|ニュース/.test(s))return'article'; if(/rss|atom|feed/.test(s))return'feed'; return'mixed'; }

function myMelterReturnUrl(){
  const u=new URL('./',location.href); u.hash=''; u.search=''; return u.href;
}
function buildBrowserImportBookmarklet(){
  const returnUrl=JSON.stringify(myMelterReturnUrl());
  const code=`(async function(){try{
var R=${returnUrl};
var A=function(u,b){try{return new URL(u,b||location.href).href}catch(e){return''}};
var X=function(e){return((e&&(e.innerText||e.textContent))||'').replace(new RegExp('\\\\s+','g'),' ').trim()};
var G=function(img,base){if(!img)return'';var raw=img.getAttribute('data-src')||img.getAttribute('src')||img.getAttribute('data-original')||img.getAttribute('data-lazy-src')||img.currentSrc||'';if(!raw){var ss=img.getAttribute('srcset')||img.getAttribute('data-srcset')||'';raw=(ss.split(',')[0]||'').trim().split(' ')[0]||''}return A(raw,base)};
var MID=function(u){var m=String(u||'').match(new RegExp('(?:^|/)([0-9]{12,})(?:/|$)'));return m?m[1]:''};
var S={},I=[],ES={},E=[];
var searchHost=location.hostname.toLowerCase(),WEBSEARCH=/(^|\\.)(html\\.duckduckgo\\.com|duckduckgo\\.com|www\\.bing\\.com|bing\\.com)$/i.test(searchHost);
var unwrapSearch=function(raw,base){
  var href=A(raw,base),u;try{u=new URL(href)}catch(e){return''}
  var h=u.hostname.toLowerCase(),q='';
  if(/(^|\\.)duckduckgo\\.com$/i.test(h)){q=u.searchParams.get('uddg')||'';if(q){try{return decodeURIComponent(q)}catch(e){return q}}}
  if(/(^|\\.)google\\./i.test(h)&&u.pathname==='/url'){q=u.searchParams.get('q')||'';if(q)return q}
  return href
};
var searchResultAnchors=function(doc){
  var out=[],seen=[];
  var add=function(a){if(!a||seen.indexOf(a)>=0)return;seen.push(a);out.push(a)};
  [].slice.call(doc.querySelectorAll('a.result__a[href],a[data-testid="result-title-a"][href],li.b_algo h2 a[href]')).forEach(add);
  [].slice.call(doc.querySelectorAll('a[href] h3')).forEach(function(h){add(h.closest('a[href]'))});
  return out
};
var collectSearchResults=function(doc,base){
  searchResultAnchors(doc).forEach(function(a){
    var u=unwrapSearch(a.getAttribute('href'),base),n=X(a).slice(0,120),p;try{p=new URL(u)}catch(e){return}
    var h=p.hostname.toLowerCase(),box=a.closest('.result,.results_links,.b_algo,[data-testid="result"]')||a.parentElement,sig=(n+' '+X(box).slice(0,420)).toLowerCase();
    if(!u||!n||!/^https?:$/.test(p.protocol)||/(^|\\.)(duckduckgo\\.com|bing\\.com|microsoft\\.com)$/i.test(h)||ES[h])return;
    if(/広告|スポンサー|sponsored|promoted|(^|\\s)ad(\\s|$)|【pr】|\\[pr\\]/i.test(sig))return;
    if(/\\.(?:mp4|m3u8|png|jpe?g|gif|webp|zip|pdf)(?:$|[?#])/i.test(u))return;
    var im='',near=box&&box.querySelector?box.querySelector('img'):null;if(near)im=G(near,base);
    ES[h]=1;E.push({n:n,u:p.href,i:im,sc:8});
  })
};
var collectRelated=function(doc,base){
  var origin='';try{origin=new URL(base).origin}catch(e){return}
  [].slice.call(doc.querySelectorAll('a[href]')).forEach(function(a){
    var u=A(a.getAttribute('href'),base),n=X(a).slice(0,100),p;try{p=new URL(u)}catch(e){return}
    if(!u||!n||!/^https?:$/.test(p.protocol)||p.origin===origin||p.username||p.password||ES[p.hostname])return;
    var host=p.hostname.toLowerCase(),parent=a.closest('aside,nav,footer,section,div,li')||a.parentElement,context=X(parent).slice(0,360),rel=String(a.getAttribute('rel')||''),sig=(n+' '+u+' '+context+' '+rel).toLowerCase();
    var generic=/^(保存|開く|詳細|こちら|もっと見る|続きを読む|今すぐ|無料|登録|入会|ダウンロード|download|open|more)$/i.test(n);
    var ad=/(?:【PR】|\\[PR\\]|(^|\\s)PR(?:\\s|$)|広告|スポンサー|sponsored|アフィリエイト|affiliate|アダルトチャット|チャット広告|キャンペーン|promoted|promotion)/i.test(sig);
    var adhost=/(^|\\.)(doubleclick\\.net|googlesyndication\\.com|adservice\\.google\\.com|adnxs\\.com|taboola\\.com|outbrain\\.com|criteo\\.com|exoclick\\.com|trafficjunky\\.com|popads\\.net|propellerads\\.com|adsterra\\.com)$/i.test(host);
    if(generic||ad||adhost||/(^|\\.)((x|twitter)\\.com|t\\.co|video\\.twimg\\.com|pbs\\.twimg\\.com)$/i.test(host))return;
    if(/\\.(?:mp4|m3u8|png|jpe?g|gif|webp|zip|pdf)(?:$|[?#])/i.test(u)||/login|sign.?up|share|facebook\\.com\\/sharer|twitter\\.com\\/intent|x\\.com\\/intent/i.test(sig))return;
    var relation=/関連|おすすめ|姉妹|相互|リンク集|友達|related|recommend|partner|similar/i.test(sig);
    var relatedBox=!!a.closest('[class*="related"],[class*="recommend"],[class*="partner"],[class*="linklist"],[class*="links"]');
    var score=(relation?5:0)+(relatedBox?2:0)+(n.length>=4?1:0);
    if(score<4)return;
    var im='',near=a.querySelector('img')||(parent&&parent.querySelector?parent.querySelector('img'):null);if(near)im=G(near,base);
    ES[host]=1;E.push({n:n,u:p.href,i:im,sc:score});
  })
};
var D=function(t,u,p,m,r,k){u=A(u);p=A(p);m=A(m);if(!u&&m)u=m;var key=k||m||u;if(!u||u.indexOf('http')!==0||!key||S[key])return;S[key]=1;I.push({t:(t||'無題').slice(0,220),u:u,i:p||'',m:m||'',r:r||''})};
var collect=function(txt,pat){var out=[],re=new RegExp(pat,'g'),m;while((m=re.exec(String(txt||'')))!==null){out.push(m[0]);if(!m[0])re.lastIndex++}return out};
var texts=function(doc){var body=X(doc.body),r=[],sv=[],m,re1=new RegExp('第\\\\s*(\\\\d+)\\\\s*位','g'),re2=new RegExp('(\\\\d+)\\\\s*回保存','g');while((m=re1.exec(body))!==null)r.push(m[1]);while((m=re2.exec(body))!==null)sv.push(m[1]);return{r:r,s:sv}};
var postList=function(doc,base){return [].slice.call(doc.querySelectorAll('a[href*="x.com/"][href*="/status/"],a[href*="twitter.com/"][href*="/status/"],a[href*="twitter.com/i/status/"]')).map(function(a){return{u:A(a.getAttribute('href'),base),t:X(a)}})};
var parseTw=function(doc,base){
  var boxes=[].slice.call(doc.querySelectorAll('.gazou'));
  boxes.forEach(function(box,j){
    var a=box.querySelector('.poster > a[href^="https://video.twimg.com/"],a[href^="https://video.twimg.com/"]');
    if(!a)return;
    var v=A(a.getAttribute('href'),base),g=a.querySelector('img')||box.querySelector('img'),im=G(g,base);
    var n=box.previousSibling,txt='',post='',pt='',h=0;
    while(n&&h<18){
      if(n.nodeType===1&&n.classList&&n.classList.contains('gazou'))break;
      var z=n.nodeType===3?String(n.nodeValue||''):X(n);if(z)txt=z+' '+txt;
      if(n.nodeType===1&&!post){
        var pa=(n.matches&&n.matches('a[href*="twitter.com/"],a[href*="x.com/"]'))?n:(n.querySelector?n.querySelector('a[href*="twitter.com/"],a[href*="x.com/"]'):null);
        if(pa){post=A(pa.getAttribute('href'),base);pt=X(pa)}
      }
      n=n.previousSibling;h++
    }
    var qm=txt.match(new RegExp('(?:第\\\\s*)?(\\\\d+)\\\\s*位')),sm=txt.match(new RegExp('(\\\\d+)\\\\s*回保存')),rn=qm?qm[1]:String(j+1),sv=sm?sm[1]:'',lab='第'+rn+'位'+(sv?' · '+sv+'回保存':'');
    D(pt?lab+'｜'+pt:lab,post||v,im,v,rn,base+'#rank='+rn)
  })
};
var parseRaw=function(doc,base){
  var html=doc.documentElement?doc.documentElement.innerHTML:'';
  var vs=collect(html,"https?:\\\\/\\\\/video\\\\.twimg\\\\.com\\\\/[^\\\"'<>\\\\s)]+");
  var ims=collect(html,"https?:\\\\/\\\\/pbs\\\\.twimg\\\\.com\\\\/[^\\\"'<>\\\\s)]+");
  var ps=postList(doc,base),ts=texts(doc);
  var seen={},videos=[];
  vs.forEach(function(v){v=A(v,base);if(v&&!seen[v]){seen[v]=1;videos.push(v)}});
  var imageById={},seenI={};
  ims.forEach(function(v){v=A(v,base);if(!v||seenI[v])return;seenI[v]=1;var id=MID(v);if(id&&!imageById[id])imageById[id]=v});
  videos.forEach(function(v,j){
    var rn=ts.r[j]||String(j+1),sv=ts.s[j]||'',lab='第'+rn+'位'+(sv?' · '+sv+'回保存':'');
    var pt=ps[j]&&ps[j].t?ps[j].t:'',src=ps[j]&&ps[j].u?ps[j].u:v,im=imageById[MID(v)]||'';
    D(pt?lab+'｜'+pt:lab,src,im,v,rn)
  })
};
var parseGeneric=function(doc,base){
  [].slice.call(doc.querySelectorAll('video[src],source[src],a[href*="video.twimg.com"]')).forEach(function(v){
    var raw=v.getAttribute('src')||v.getAttribute('href')||'',url=A(raw,base),c=v.closest('article,li,section,div')||v.parentElement||v,g=c&&c.querySelector?c.querySelector('img'):null,a=c&&c.querySelector?c.querySelector('a[href]'):null;
    D(X(c).slice(0,180)||doc.title,(a&&A(a.getAttribute('href'),base))||url,G(g,base),url,'')
  })
};
var parseAll=function(doc,base){var before=I.length;parseTw(doc,base);if(I.length===before)parseGeneric(doc,base);if(I.length===before)parseRaw(doc,base)};
var iframeDoc=async function(url){return await new Promise(function(resolve){var fr=document.createElement('iframe'),done=false,t=setTimeout(function(){if(!done){done=true;try{fr.remove()}catch(e){}resolve(null)}},8000);fr.style.cssText='position:fixed!important;left:-10000px!important;top:0!important;width:2px!important;height:2px!important;opacity:.01!important;pointer-events:none!important;border:0!important';fr.onload=function(){if(done)return;setTimeout(function(){if(done)return;done=true;clearTimeout(t);var d=null;try{d=fr.contentDocument}catch(e){};try{fr.remove()}catch(e){}resolve(d)},250)};fr.src=url;document.body.appendChild(fr)})};
if(WEBSEARCH){
  collectSearchResults(document,location.href);
  if(!E.length){alert('MyMelter: Web検索結果から候補を検出できませんでした');return}
  var WP={v:15,m:'web-search',s:location.href,n:document.title,q:(new URL(location.href)).searchParams.get('q')||'',i:[],d:[],e:E.slice(0,30)};
  var WJ=JSON.stringify(WP),WB=new TextEncoder().encode(WJ),WQ='';for(var wi=0;wi<WB.length;wi++)WQ+=String.fromCharCode(WB[wi]);
  location.href=R+'#mmimport='+encodeURIComponent(btoa(WQ));return
}
var pageSeen={},rankQueue=[],creatorQueue=[];
var enqueuePage=function(arr,u){if(!u||pageSeen[u])return;pageSeen[u]=1;arr.push(u)};
var discoverDeepLinks=function(doc,base){
  [].slice.call(doc.querySelectorAll('a[href]')).forEach(function(a){
    var h=A(a.getAttribute('href'),base);if(!h)return;
    try{
      var u=new URL(h);
      if(u.origin!==location.origin||u.pathname.indexOf('/jp/')!==0)return;
      var p=u.pathname.toLowerCase();
      if(p.indexOf('ranking_')>=0&&p.slice(-4)==='.php')enqueuePage(rankQueue,u.href);
      else if(p.indexOf('/creator.php')>=0&&u.searchParams.get('id'))enqueuePage(creatorQueue,u.href);
    }catch(e){}
  })
};
var loadDoc=async function(url){
  try{var rr=await fetch(url,{credentials:'include',cache:'no-store'});if(rr.ok){var tx=await rr.text();return new DOMParser().parseFromString(tx,'text/html')}}catch(e){}
  return await iframeDoc(url)
};
var parsePage=function(doc,url){
  if(!doc)return;
  collectRelated(doc,url);
  var before=I.length;parseAll(doc,url);
  var label=(doc.title||'').replace(new RegExp('\\s+','g'),' ').trim();
  for(var z=before;z<I.length;z++)I[z].z=label;
  discoverDeepLinks(doc,url)
};
pageSeen[location.href]=1;
parsePage(document,location.href);
var primaryEnd=I.length;
var p=location.pathname,extra='',lk=document.querySelector('a[href*="ranking_t2.php"],a[href*="ranking_t1.php"]');
if(lk)extra=A(lk.getAttribute('href'),location.href);
if(!extra){if(p.indexOf('ranking_t1.php')>=0||p.indexOf('ranking_t.php')>=0)extra=A('ranking_t2.php',location.href);else if(p.indexOf('ranking_t2.php')>=0)extra=A('ranking_t1.php',location.href)}
if(extra&&!pageSeen[extra]){pageSeen[extra]=1;rankQueue.unshift(extra)}
var processed=0;
while(rankQueue.length&&processed<8&&I.length<70){
  var next=rankQueue.shift(),dd=await loadDoc(next);if(dd)parsePage(dd,next);processed++
}
var creators=0;
while(creatorQueue.length&&creators<3&&I.length<80){
  var cu=creatorQueue.shift(),cd=await loadDoc(cu);if(cd)parsePage(cd,cu);creators++
}
var primary=I.slice(0,primaryEnd),deep=I.slice(primaryEnd);
I=I.slice(0,80);primary=primary.slice(0,20);deep=deep.slice(0,60);
if(!primary.length&&!deep.length){alert('MyMelter: 取り込める候補を検出できませんでした');return}
var P={v:15,m:'site',s:location.href,n:document.title,i:primary,d:deep,e:E.slice(0,30)};
var J=JSON.stringify(P),B=new TextEncoder().encode(J),Q='';
for(var k=0;k<B.length;k++)Q+=String.fromCharCode(B[k]);
location.href=R+'#mmimport='+encodeURIComponent(btoa(Q))
}catch(e){alert('MyMelter取込失敗: '+e.message)}})();`;
  return 'javascript:'+code;
}
function openBrowserImportSetup(target=''){
  browserImportTarget=alternatePublicUrl(target)||normalizeUrl(target)||target||state.meta.lastDiscoveryUrl||'https://www.twidouga.net/jp/ranking_t1.php';
  $('#browserImportTarget').value=browserImportTarget;
  const code=buildBrowserImportBookmarklet();
  $('#bookmarkletCode').value=code;
  $('#browserImportStatus').textContent='Safari取り込み v15。広告・PR除外と小型サムネイルに加え、Web検索結果から似たサイト候補だけをMyMelterへ戻せます。既存の「MyMelter取込」は最新版へ1回更新してください。';
  $('#browserImportDialog').showModal();
}
async function copyBrowserImportBookmarklet(){
  const code=buildBrowserImportBookmarklet(); $('#bookmarkletCode').value=code;
  try{
    await navigator.clipboard.writeText(code);
    $('#browserImportStatus').textContent='コピーしました。SafariのブックマークURLへ貼り付けてください。';
  }catch{
    const area=$('#bookmarkletCode'); area.focus(); area.select();
    try{document.execCommand('copy');$('#browserImportStatus').textContent='コピーしました。SafariのブックマークURLへ貼り付けてください。';}
    catch{$('#browserImportStatus').textContent='自動コピーできません。下のコードを長押ししてコピーしてください。';}
  }
}
function decodeBrowserImportPayload(encoded){
  const bin=atob(decodeURIComponent(encoded)); const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function canonicalBrowserSourceUrl(url){
  const normalized=normalizeUrl(url); if(!normalized)return '';
  try{
    const u=new URL(normalized);
    if(/(^|\.)twidouga\.net$/i.test(u.hostname)&&/\/jp\/ranking_t(?:1|2)?\.php$/i.test(u.pathname)){
      u.pathname='/jp/ranking_t1.php';u.search='';u.hash='';return u.href;
    }
  }catch{}
  return normalized;
}
function consumeBrowserImportHash(){
  if(!location.hash.startsWith('#mmimport=')) return null;
  const raw=location.hash.slice('#mmimport='.length);
  history.replaceState(null,'',location.pathname+location.search);
  try{
    const payload=decodeBrowserImportPayload(raw);
    const rawSource=normalizeUrl(payload?.s||''); if(!rawSource) throw new Error('取込元URLが不正です');
    const source=canonicalBrowserSourceUrl(rawSource);
    const title=String(payload?.n||domainOf(source)||'Safari取込').trim().slice(0,120);
    state.meta.browserImportVersion=Math.max(Number(state.meta.browserImportVersion||0),Number(payload?.v||0));
    if(payload?.m==='web-search'){
      const pending=state.meta.pendingWebSimilar||{},channel=state.channels.find(x=>x.id===pending.channelId)||null,excludeDomain=domainOf(channel?.url||'');
      const list=uniqueBy((Array.isArray(payload?.e)?payload.e:[]).map(x=>{
        const url=normalizeUrl(x?.u||''),name=String(x?.n||domainOf(url)||'Web候補').trim().slice(0,120),image=normalizeUrl(x?.i||''),similarityScore=Math.max(4,Number(x?.sc||8));if(!url||!name)return null;
        if(excludeDomain&&domainOf(url)===excludeDomain)return null;
        if(state.channels.some(y=>domainOf(y.url)===domainOf(url)))return null;
        const type=guessTypeFromText(name,url),candidate={...candidateFrom(url,name,type,{source:'web-search',image,similarityScore}),genre:inferGenre({name,url,type}),similarityScore};
        return isSuitableSimilarCandidate(candidate,null)?candidate:null;
      }).filter(Boolean),x=>domainOf(x.url)).slice(0,20);
      state.candidates=list;state.meta.pendingWebSimilar=null;state.meta.lastDiscoveryUrl=channel?.url||'';state.meta.lastDiscoveryAt=Date.now();saveState(false);
      toast(list.length+'件のWeb候補を取り込みました');
      return {kind:'web-search',channel,candidates:list,query:String(payload?.q||pending.query||'')};
    }
    const mapImported=(arr,deep=false)=>(Array.isArray(arr)?arr:[]).map(x=>{
      const url=normalizeUrl(x?.u||''); const image=normalizeUrl(x?.i||''); const videoUrl=normalizeUrl(x?.m||'');
      if(!url&&!videoUrl)return null;
      return {id:uid(),title:String(x?.t||'無題').trim().slice(0,300),url:url||videoUrl,image,videoUrl,type:videoUrl?'video':image?'image':'article',browserRank:String(x?.r||''),deepSource:String(x?.z||''),deepDive:!!deep};
    }).filter(Boolean);
    const primaryRaw=mapImported(payload?.i,false);
    const items=uniqueBy(primaryRaw,x=>x.browserRank?('rank:'+x.browserRank):(x.id||x.videoUrl||x.url)).slice(0,30);
    const primaryKeys=new Set(items.map(x=>x.videoUrl||x.url).filter(Boolean));
    const deepItems=uniqueBy(mapImported(payload?.d,true),x=>x.videoUrl||x.url).filter(x=>!primaryKeys.has(x.videoUrl||x.url)).slice(0,60);
    const sourceOrigin=new URL(source).origin,registeredDomains=new Set(state.channels.map(x=>domainOf(x.url)).filter(Boolean));
    const relatedSites=uniqueBy((Array.isArray(payload?.e)?payload.e:[]).map(x=>{
      const url=normalizeUrl(x?.u||''),name=String(x?.n||domainOf(url)||'関連サイト').trim().slice(0,120),image=normalizeUrl(x?.i||''),similarityScore=Number(x?.sc||0);if(!url||!name)return null;
      if(new URL(url).origin===sourceOrigin||registeredDomains.has(domainOf(url)))return null;
      const type=guessTypeFromText(name,url),candidate={name,url,image,similarityScore,type,genre:inferGenre({name,url,type}),source:'safari-related'};
      return isSuitableSimilarCandidate(candidate,null)?candidate:null;
    }).filter(Boolean),x=>domainOf(x.url)).slice(0,30);
    if(!items.length&&!deepItems.length) throw new Error('取り込める項目がありません');
    let channel=state.channels.find(c=>c.source==='browser'&&canonicalBrowserSourceUrl(c.browserSourceUrl||c.url)===source);
    if(channel){
      const primary=items.length?items:(channel.snapshotItems||[]);
      const deep=deepItems.length?deepItems:(channel.deepDiveItems||[]);
      channel.name=title; channel.url=source; channel.browserSourceUrl=source; channel.snapshotItems=primary; channel.deepDiveItems=deep; channel.relatedSites=relatedSites; channel.relatedSitesVersion=Number(payload?.v||0); channel.itemCount=primary.length; channel.updatedAt=Date.now();
      [...primary,...deep].forEach(x=>{x.channelId=channel.id;x.channelName=channel.name;});
      rememberItems([...primary,...deep]);
    }else{
      channel=normalizeChannel({name:title,url:source,type:'mixed',color:'blue',source:'browser',browserSourceUrl:source,snapshotItems:items,deepDiveItems:deepItems,relatedSites,relatedSitesVersion:Number(payload?.v||0),itemCount:items.length});
      [...items,...deepItems].forEach(x=>{x.channelId=channel.id;x.channelName=channel.name;});
      channel.snapshotItems=items; channel.deepDiveItems=deepItems; state.channels.unshift(channel); rememberItems([...items,...deepItems]);
    }
    state.meta.lastDiscoveryUrl=source; state.meta.lastDiscoveryAt=Date.now(); state.meta.browserImportVersion=Math.max(Number(state.meta.browserImportVersion||0),Number(payload?.v||0)); saveState(false);
    toast('一覧 '+channel.snapshotItems.length+'件 / 深掘り '+channel.deepDiveItems.length+'件 / 似たサイト '+(channel.relatedSites?.length||0)+'件'+(Number(payload?.v||0)<15?'（取込コードv15へ更新してください）':''));
    return channel;
  }catch(e){ toast('Safari取込に失敗: '+e.message); return null; }
}

async function discoverChannels(url,similarTo=null){
  const base=normalizeUrl(url); if(!base) throw new Error('URLが正しくありません');
  const status=[]; const text=await fetchText(base); const candidates=[]; const xml=parseMaybeXml(text);
  if(xml?.querySelector('rss, feed')){
    candidates.push(candidateFrom(base, nodeText(xml,['channel > title','feed > title'])||`${domainOf(base)} RSS`,'feed',{source:'feed'}));
    return candidates;
  }
  const doc=new DOMParser().parseFromString(text,'text/html'); const siteTitle=(doc.querySelector('meta[property="og:site_name"]')?.content||doc.title||domainOf(base)).trim();
  const baseType=doc.querySelector('video, source[src*=".mp4"], source[src*=".m3u8"]')?'video':doc.querySelectorAll('img').length>=8?'image':doc.querySelectorAll('article').length>=3?'article':'mixed';
  candidates.push(candidateFrom(base,siteTitle,baseType,{source:'page'}));

  const feedLinks=[...doc.querySelectorAll('link[rel~="alternate"][type*="rss"],link[rel~="alternate"][type*="atom"]')];
  for(const l of feedLinks){ const u=absoluteUrl(l.getAttribute('href'),base); if(u)candidates.push(candidateFrom(u,l.getAttribute('title')||`${siteTitle} RSS`,'feed',{source:'html-link'})); }

  const anchors=[...doc.querySelectorAll('nav a[href], header a[href], [class*="menu"] a[href], [class*="categor"] a[href], [class*="tag"] a[href], a[rel~="category"][href]')];
  const baseOrigin=new URL(base).origin;
  if(similarTo){
    const external=externalSiteCandidates(doc,base,similarTo);
    candidates.unshift(...external);
  }
  for(const a of anchors){
    const href=absoluteUrl(a.getAttribute('href'),base); const label=(a.textContent||'').replace(/\s+/g,' ').trim(); if(!href||!label||label.length>42)continue;
    let u;try{u=new URL(href);}catch{continue;} if(u.origin!==baseOrigin||u.href===base)continue;
    const signal=`${label} ${u.pathname}`;
    if(!/(category|categories|tag|topics|video|movie|photo|image|gallery|blog|news|article|post|最新|新着|動画|画像|写真|記事|ニュース|カテゴリ|タグ)/i.test(signal))continue;
    candidates.push(candidateFrom(u.href,label,guessTypeFromText(signal,u.href),{source:'navigation'}));
  }

  const probeUrls=['/feed','/feed.xml','/rss','/rss.xml','/atom.xml'].map(p=>new URL(p,baseOrigin).href);
  for(const p of probeUrls){
    if(candidates.some(c=>c.url===p)) continue;
    try{ const t=await Promise.race([fetchText(p),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),3500))]); const x=parseMaybeXml(t); if(x?.querySelector('rss, feed')){ candidates.push(candidateFrom(p,`${siteTitle} RSS`,'feed',{source:'probe'})); status.push('RSS'); break; } }catch{}
  }

  try{
    const sm=new URL('/sitemap.xml',baseOrigin).href; const t=await Promise.race([fetchText(sm),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),3500))]); const sx=parseMaybeXml(t);
    if(sx?.querySelector('urlset, sitemapindex')) candidates.push(candidateFrom(sm,`${siteTitle} サイト更新一覧`,'feed',{source:'sitemap'}));
  }catch{}

  return uniqueBy(candidates.filter(c=>c.url),c=>c.url).slice(0,30);
}

function candidateThumbUrl(c){
  const image=normalizeUrl(c?.image||c?.thumbnail||'');if(image)return image;
  try{return new URL('/favicon.ico',c?.url||'').href;}catch{return '';}
}
function candidateThumbHTML(c){
  const src=candidateThumbUrl(c),fallback='<span class="result-thumb-fallback">'+esc(typeGlyph(c.type))+'</span>';
  return '<span class="result-thumb">'+fallback+(src?'<img src="'+esc(src)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')+'</span>';
}
function renderDiscoveryResults(list){
  const root=$('#discoverResults');
  if(!list.length){root.innerHTML=`<div class="empty-card">信頼できる似たサイト候補を見つけられませんでした。広告やPRは候補から除外しています。</div>`;return;}
  root.innerHTML=`<div class="discover-results-head"><button class="mini-primary" data-add-all-candidates>まとめて追加</button></div>`+list.map(c=>`<article class="discover-result">${candidateThumbHTML(c)}<div class="result-copy"><strong>${esc(c.name)}</strong><small>${esc(typeLabel(c.type))} · ${esc(c.url)}</small></div><div class="result-actions"><button class="mini-secondary" data-preview-candidate="${esc(c.id)}">確認</button><button class="mini-primary" data-add-candidate="${esc(c.id)}">＋ 追加</button></div></article>`).join('');
}
async function runDiscovery(){
  const url=$('#discoverUrl').value.trim(); if(!normalizeUrl(url)){toast('URLを確認してください');return;}
  $('#discoverStatus').textContent='サイトを解析しています…'; $('#discoverResults').innerHTML=''; $('#runDiscoveryBtn').disabled=true;
  try{
    const list=await discoverChannels(url); state.candidates=list; state.meta.lastDiscoveryUrl=url; state.meta.lastDiscoveryAt=Date.now(); saveState(false); renderCandidates(); renderDiscoveryResults(list);
    $('#discoverStatus').textContent=`${list.length}件の候補を検出しました。`;
  }catch(e){
    $('#discoverStatus').textContent=`解析できませんでした：${e.message}`;
    const browserEligible=/HTTP 403|Worker経由|取得先サイト/.test(String(e.message||''));
    if(browserEligible){
      $('#discoverResults').innerHTML=`<div class="browser-fallback-card"><strong>Safari取り込みに切り替えられます</strong><small>このサイトはWorker経由を拒否しています。Safariで表示した実ページからMyMelterへ一覧を戻します。</small><button type="button" class="primary" data-browser-import-target="${esc(alternatePublicUrl(url)||url)}">Safari取り込みを使う</button></div>`;
    }else renderDiscoveryResults([]);
  }
  finally{$('#runDiscoveryBtn').disabled=false;}
}
function addCandidate(id){
  const c=state.candidates.find(x=>x.id===id); if(!c)return;
  if(state.channels.some(x=>x.url===c.url)){toast('このURLは登録済みです');return;}
  const ch=normalizeChannel(c); state.channels.unshift(ch); state.candidates=state.candidates.filter(x=>x.id!==id); saveState(); renderDiscoveryResults(state.candidates); toast('チャンネルを追加しました');
}
function addAllCandidates(){
  const existing=new Set(state.channels.map(x=>x.url)); const add=state.candidates.filter(c=>c.url&&!existing.has(c.url)).map(normalizeChannel);
  if(!add.length){toast('追加できる新しい候補はありません');return;}
  state.channels=[...add,...state.channels]; state.candidates=[]; saveState(); renderDiscoveryResults([]); toast(`${add.length}件のチャンネルを追加しました`);
}

async function openChannel(channel,keyword=''){
  activeChannel=channel; activeReaderMode='list'; activeItems=[];
  $('#readerDomain').textContent=domainOf(channel.url); $('#readerChannelName').textContent=channel.name; $('#readerSearch').value=keyword; setReaderMode('list',false);
  $('#readerStatus').textContent='取得中…'; $('#readerContent').innerHTML=''; $('#readerDialog').showModal();
  let url=channel.url;
  if(keyword){ if(channel.searchUrl) url=channel.searchUrl.replace('{keyword}',encodeURIComponent(keyword)); else { $('#readerStatus').textContent='検索URLが未設定です。登録済みの取得結果を絞り込む場合は一覧から検索してください。'; } }
  try{
    if(channel.source==='browser'&&Array.isArray(channel.snapshotItems)&&channel.snapshotItems.length){
      let items=channel.snapshotItems.map(x=>({...x,channelId:channel.id,channelName:channel.name}));
      if(keyword){const q=keyword.toLowerCase();items=items.filter(x=>(x.title||'').toLowerCase().includes(q));}
      activeItems=items; rememberItems(items); channel.itemCount=items.length; channel.lastOpenedAt=Date.now(); saveState(false); renderHomeChannels(); renderRanking(); renderChannelManager();
      $('#readerStatus').textContent=`${items.length}件 · Safari取込スナップショット`; renderReader(); return;
    }
    const text=await fetchText(url); let items=parseChannelContent(text,channel,url);
    if(keyword&&!channel.searchUrl){const q=keyword.toLowerCase();items=items.filter(x=>(x.title||'').toLowerCase().includes(q));}
    activeItems=items; rememberItems(items); channel.itemCount=items.length; channel.lastOpenedAt=Date.now(); channel.updatedAt=Date.now(); saveState(false); renderHomeChannels(); renderRanking(); renderChannelManager();
    $('#readerStatus').textContent=items.length?`${items.length}件取得 · ${domainOf(url)}`:'項目を抽出できませんでした。高度な抽出設定を調整してください。';
    renderReader();
  }catch(e){ $('#readerStatus').textContent=`取得できませんでした：${e.message}`; $('#readerContent').innerHTML=`<div class="empty-card"><strong>取得エラー</strong><br>${esc(e.message)}<br><br><button class="primary" data-open-url="${esc(url)}">サイトを直接開く</button></div>`; }
}
function activeVideoItems(){
  const primary=(activeItems||[]).filter(x=>x?.videoUrl);
  const seen=new Set(primary.map(x=>x.videoUrl||x.url).filter(Boolean));
  const deep=activeChannel&&Array.isArray(activeChannel.deepDiveItems)?activeChannel.deepDiveItems.filter(x=>{
    if(!x?.videoUrl)return false;
    const key=x.videoUrl||x.url;if(!key||seen.has(key))return false;seen.add(key);return true;
  }):[];
  return [...primary,...deep];
}
function setReaderMode(mode,render=true){ activeReaderMode=mode; $$('#readerModeTabs button').forEach(b=>b.classList.toggle('active',b.dataset.readerMode===mode)); if(render)renderReader(); }
function renderReader(){
  const root=$('#readerContent'); if(!activeItems.length){root.innerHTML=`<div class="empty-card">表示できる項目がありません。</div>`;return;}
  if(activeReaderMode==='video'){
    const vids=activeVideoItems();
    const primaryCount=activeItems.filter(x=>x?.videoUrl).length, deepCount=Math.max(0,vids.length-primaryCount);
    root.innerHTML=vids.length?`<div class="empty-card"><strong>${vids.length}件の動画があります。</strong><br>${deepCount?`ランキング一覧 ${primaryCount}件 + 深掘り ${deepCount}件。<br>`:''}上スワイプだけで、取得済みの深掘り動画まで止まらず続けて再生できます。<br><br><button class="primary" id="launchVideoFeedBtn">深掘りスワイプ再生</button></div>`:`<div class="empty-card">この一覧から直接再生できる動画URLは見つかりませんでした。</div>`; return;
  }
  if(activeReaderMode==='media'){
    const media=activeItems.filter(x=>x.image||x.videoUrl);
    root.innerHTML=media.length?`<div class="media-grid">${media.map((x,i)=>gridItemHTML(x,activeItems.indexOf(x))).join('')}</div>`:`<div class="empty-card">画像・動画を検出できませんでした。</div>`;return;
  }
  root.innerHTML=`<div class="content-list">${activeItems.map((x,i)=>contentItemHTML(x,i)).join('')}</div>`;
}
function contentItemHTML(x,i){
  const th=x.image?`<img class="content-thumb" ${imageSourceAttrs(x.image)} alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="content-placeholder">${esc(typeGlyph(mediaKind(x)))}</span>`;
  return `<article class="content-card">${th}<div class="content-copy"><strong>${esc(x.title||'無題')}</strong><small>${esc(typeLabel(mediaKind(x)))} · ${esc(domainOf(x.url))}</small><div class="content-actions"><button class="open-btn" data-active-open="${i}">開く</button><button class="save-btn" data-active-save="${i}">${isSavedUrl(x.url)?'♥ 保存済み':'♡ 保存'}</button>${x.videoUrl||x.image?`<button class="save-btn" data-active-quick-save="${i}">⇩ 端末保存</button>`:''}</div></div></article>`;
}
function gridItemHTML(x,i){
  const media=x.image?`<img ${imageSourceAttrs(x.image)} alt="" loading="lazy" referrerpolicy="no-referrer">`:x.videoUrl?`<video src="${esc(x.videoUrl)}" muted playsinline preload="metadata"></video>`:`<div class="content-placeholder" style="width:100%;aspect-ratio:1/1">◇</div>`;
  return `<article class="grid-card">${media}<div class="grid-copy"><strong>${esc(x.title||'無題')}</strong><div class="grid-actions"><button data-active-open="${i}">開く</button><button data-active-save="${i}">${isSavedUrl(x.url)?'♥ 保存済み':'♡ 保存'}</button><button data-active-quick-save="${i}">端末へ</button></div></div></article>`;
}
function recordHistory(item,render=true){
  if(!item?.url)return;
  const prev=state.history.find(x=>x.url===item.url); const cat=state.catalog.find(x=>x.url===item.url); const viewCount=Math.max(Number(prev?.viewCount||0),Number(cat?.viewCount||0))+1;
  const entry={...(prev||{}),...item,visitedAt:Date.now(),lastViewedAt:Date.now(),viewCount}; state.history=[entry,...state.history.filter(x=>x.url!==entry.url)].slice(0,500); bumpCatalogView(entry,viewCount); saveState(render);
}
function saveItem(item){
  if(!item?.url)return; const prev=state.saved.find(x=>x.url===item.url); const cat=state.catalog.find(x=>x.url===item.url);
  const entry={...(prev||{}),...(cat||{}),...item,savedAt:Date.now(),viewCount:Math.max(Number(item.viewCount||0),Number(cat?.viewCount||0),Number(prev?.viewCount||0))};
  state.saved=[entry,...state.saved.filter(x=>x.url!==item.url)].slice(0,500); if(!cat)rememberItems([entry]); saveState(); toast('保存済みに追加しました');
}
function toggleSavedItem(item,button=null){
  if(!item?.url)return false;
  const exists=isSavedUrl(item.url);
  if(exists){
    state.saved=state.saved.filter(x=>x.url!==item.url);saveState(false);toast('保存済みから外しました');
  }else{
    saveItem(item);
  }
  const nowSaved=!exists;
  if(button){
    const circle=button.querySelector('.circle');
    const label=button.querySelector('.video-action-label')||button.querySelector('span:last-child');
    if(circle)circle.textContent=nowSaved?'♥':'♡';
    if(label)label.textContent=nowSaved?'保存済み':'保存';
    if(button.matches('.save-btn,[data-active-save]'))button.textContent=nowSaved?'♥ 保存済み':'♡ 保存';
  }
  return nowSaved;
}
function pauseFeedForExternalAction(){
  const slide=feedSlide(feedCurrentIndex),v=slide?.querySelector('video');
  if(v){v.dataset.shouldPlay='0';try{v.pause();}catch{};stopBufferPulse(v);}
  showFeedControls(false);
}
function workerVersionAtLeast(version,min='1.3'){
  const a=String(version||'').split('.').map(Number),b=String(min).split('.').map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x>y)return true;if(x<y)return false;}
  return true;
}
async function probeWorkerDownloadCapability(force=false){
  if(workerCapability.checking)return workerCapability;
  if(workerCapability.checked&&!force)return workerCapability;
  const base=(state.settings.proxyUrl||'').trim().replace(/\/+$/,'');
  workerCapability={checked:false,checking:false,version:'',download:false,error:''};
  if(!base){workerCapability={checked:true,checking:false,version:'',download:false,error:'Worker URL未設定'};return workerCapability;}
  workerCapability.checking=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try{
    const u=new URL(base);u.searchParams.set('url','https://example.com/');
    if(state.settings.proxyKey)u.searchParams.set('key',state.settings.proxyKey);
    const r=await fetch(u.href,{credentials:'omit',signal:controller.signal,cache:'no-store'});
    const version=r.headers.get('X-MyMelter-Worker-Version')||'';
    workerCapability={checked:true,checking:false,version,download:workerVersionAtLeast(version,'1.3'),error:''};
  }catch(e){
    workerCapability={checked:true,checking:false,version:'',download:false,error:e?.name==='AbortError'?'Worker応答タイムアウト':(e?.message||String(e))};
  }finally{clearTimeout(timer);}
  return workerCapability;
}
function safeSaveStatusMessage(cap){
  if(cap?.download)return 'Worker '+cap.version+' · 端末保存対応';
  if(cap?.version)return 'Worker '+cap.version+' · 端末保存には1.3以上が必要です';
  return cap?.error||'Worker 1.3を確認できません';
}
function ensureVideoSaveGate(){
  let d=document.getElementById('videoSaveGate');if(d)return d;
  d=document.createElement('dialog');d.id='videoSaveGate';d.className='sheet-dialog video-save-gate';
  d.innerHTML='<div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">DEVICE SAVE</p><h2>動画を端末保存</h2></div><button type="button" class="round-btn" data-video-save-close>×</button></div><p class="sheet-lead" data-video-save-status>Workerを確認中…</p><div class="button-row"><button type="button" class="primary" data-video-save-start disabled>保存開始</button><button type="button" class="secondary" data-video-save-close>閉じる</button></div></div>';
  document.body.appendChild(d);
  d.querySelectorAll('[data-video-save-close]').forEach(b=>b.onclick=()=>{if(d.open)d.close();});
  d.querySelector('[data-video-save-start]').onclick=()=>{const item=d._item;if(item)startVerifiedVideoDownload(item);};
  return d;
}
async function openVideoSaveGate(item){
  pauseFeedForExternalAction();
  const d=ensureVideoSaveGate(),status=d.querySelector('[data-video-save-status]'),start=d.querySelector('[data-video-save-start]');
  d._item=item;status.textContent='Worker 1.3対応を確認中…';start.disabled=true;
  if(!d.open)d.showModal();
  const cap=await probeWorkerDownloadCapability(!workerCapability.checked);
  status.textContent=safeSaveStatusMessage(cap);
  start.disabled=!cap.download;
}
function startVerifiedVideoDownload(item){
  pauseFeedForExternalAction();
  if(!workerCapability.download){
    const d=ensureVideoSaveGate();d.querySelector('[data-video-save-status]').textContent=safeSaveStatusMessage(workerCapability);return;
  }
  const target=item?.videoUrl||'';if(!target)return;
  const filename=deviceSaveFilename(item,target),saveUrl=streamingDownloadUrl(target,filename);
  if(!saveUrl)return;
  const d=document.getElementById('videoSaveGate');if(d?.open)d.close();
  const win=window.open(saveUrl,'_blank');
  if(win){try{win.opener=null;}catch{};toast('端末保存を開始しました');return;}
  toast('Safariが保存タブを開けませんでした。動画は再生しません。');
}

function deviceSaveFilename(item,target){
  const ext=mediaFileExtension(target,item?.type||'')||'mp4';
  const rank=item?.browserRank?('_rank'+item.browserRank):'';
  return 'MyMelter'+rank+'_'+Date.now()+'.'+ext;
}
function streamingDownloadUrl(target,filename=''){
  const direct=normalizeUrl(target); if(!direct)return '';
  const base=(state.settings.proxyUrl||'').trim().replace(/\/+$/,'');
  if(!base||!workerCapability.download)return '';
  try{
    const u=new URL(base);
    u.searchParams.set('url',direct);
    u.searchParams.set('media','1');
    u.searchParams.set('download','1');
    if(filename)u.searchParams.set('filename',filename);
    if(state.settings.proxyKey)u.searchParams.set('key',state.settings.proxyKey);
    return u.href;
  }catch{return '';}
}
function ensureMediaSaveDialog(){
  let d=document.getElementById('mediaSaveDialog'); if(d)return d;
  d=document.createElement('dialog');d.id='mediaSaveDialog';d.className='sheet-dialog media-save-dialog';
  d.innerHTML='<div class="sheet media-save-sheet"><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">DEVICE SAVE</p><h2>端末へ保存</h2></div><button type="button" class="round-btn" data-media-save-close>×</button></div><div class="media-save-preview" data-media-save-preview></div><p class="sheet-lead" data-media-save-status>準備しています…</p><div class="button-row"><button type="button" class="primary" data-media-share disabled>共有して保存</button><button type="button" class="secondary" data-media-save-close>閉じる</button></div></div>';
  document.body.appendChild(d);
  d.querySelectorAll('[data-media-save-close]').forEach(b=>b.onclick=closeMediaSaveDialog);
  d.querySelector('[data-media-share]').onclick=sharePreparedMedia;
  return d;
}
function closeMediaSaveDialog(){
  const d=document.getElementById('mediaSaveDialog'); if(d?.open)d.close();
  if(pendingMediaShare?.objectUrl)URL.revokeObjectURL(pendingMediaShare.objectUrl);
  pendingMediaShare=null;
}
async function sharePreparedMedia(){
  const d=ensureMediaSaveDialog(),btn=d.querySelector('[data-media-share]'),status=d.querySelector('[data-media-save-status]');
  if(!pendingMediaShare?.file){status.textContent='まだ準備中です。';return;}
  const file=pendingMediaShare.file;
  try{
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      await navigator.share({title:pendingMediaShare.title||'MyMelter',files:[file]});closeMediaSaveDialog();return;
    }
  }catch(e){if(e?.name==='AbortError')return;}
  if(pendingMediaShare.objectUrl){
    const a=document.createElement('a');a.href=pendingMediaShare.objectUrl;a.download=file.name;a.click();
    status.textContent='ダウンロードを開始しました。';
  }else status.textContent='この端末ではファイル共有を利用できません。';
}
async function prepareDeviceSave(item){
  const target=item?.videoUrl||item?.image||item?.url; if(!target)return;
  if(item?.videoUrl&&isHls(item.videoUrl)){await openQualityPicker(item,null,true);return;}
  if(state.settings.shortcutEnabled&&!item?.videoUrl){
    const name=state.settings.shortcutName||'MyMelter保存';
    window.location.href=`shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(target)}`;return;
  }
  if(item?.videoUrl){
    pauseFeedForExternalAction();
    await openQualityPicker(item,null,true);
    return;
  }
  const d=ensureMediaSaveDialog(),status=d.querySelector('[data-media-save-status]'),share=d.querySelector('[data-media-share]'),preview=d.querySelector('[data-media-save-preview]');
  status.textContent='画像を準備中…';share.disabled=true;preview.innerHTML=item?.image?`<img ${imageSourceAttrs(item.image)} alt="">`:'<div class="media-save-placeholder">画像を準備しています</div>';
  if(!d.open)d.showModal();
  try{
    const blob=await fetchMediaBlob(target,15000),ext=mediaFileExtension(target,blob.type),name=`MyMelter_${Date.now()}.${ext}`,file=new File([blob],name,{type:blob.type||'application/octet-stream'});
    const objectUrl=URL.createObjectURL(blob);
    pendingMediaShare={file,objectUrl,title:item.title||'MyMelter'};
    status.textContent='準備完了。「共有して保存」を押してください。';share.disabled=false;
  }catch(e){
    console.warn('image save prepare failed',e);status.textContent='画像の準備に失敗しました。再試行してください。';share.disabled=true;
  }
}

function openActiveItem(index){
  const item=activeItems[Number(index)];
  if(!item)return;
  if(item.videoUrl){
    const vids=activeVideoItems();
    let start=vids.findIndex(x=>x.id&&item.id&&x.id===item.id);
    if(start<0&&item.browserRank)start=vids.findIndex(x=>x.browserRank===item.browserRank&&x.videoUrl===item.videoUrl);
    if(start<0)start=vids.findIndex(x=>x===item);
    start=Math.max(0,start);
    recordHistory(item,false);
    openVideoFeedItems(vids,activeChannel?.name||item.channelName||'動画',start);
    return;
  }
  openItem(item);
}

function openItem(item){
  if(!item)return;
  if(item.videoUrl){
    recordHistory(item,false);
    openVideoFeedItems([item],item.channelName||'動画');
    return;
  }
  if(!item.url)return;
  recordHistory(item); window.open(item.url,'_blank','noopener');
}

function mediaFileExtension(url,mime=''){
  const m=String(mime||'').toLowerCase();
  if(m.includes('video/mp4'))return 'mp4'; if(m.includes('video/quicktime'))return 'mov';
  if(m.includes('image/jpeg'))return 'jpg'; if(m.includes('image/png'))return 'png'; if(m.includes('image/webp'))return 'webp';
  const hit=String(url||'').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i); return hit?hit[1].toLowerCase():'bin';
}
async function fetchMediaBlob(target,timeoutMs=15000){
  const proxied=mediaProxyUrl(target),sources=uniqueBy([proxied,target],x=>x);
  let lastErr=null;
  for(const src of sources){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(src,{credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const blob=await r.blob(); if(!blob.size)throw new Error('empty media'); return blob;
    }catch(e){lastErr=e;}
    finally{clearTimeout(timer);}
  }
  throw lastErr||new Error('media fetch failed');
}
async function quickSave(item){return prepareDeviceSave(item);}

function mediaProxyUrl(src){
  const direct=normalizeUrl(src); if(!direct)return '';
  const base=(state.settings.proxyUrl||'').trim().replace(/\/+$/,'');
  const host=domainOf(direct);
  if(!base||!/(^|\.)(?:video|pbs)\.twimg\.com$/i.test(host)) return direct;
  try{
    const u=new URL(base); u.searchParams.set('url',direct); u.searchParams.set('media','1');
    if(state.settings.proxyKey)u.searchParams.set('key',state.settings.proxyKey);
    return u.href;
  }catch{return direct;}
}
function imageSourceAttrs(src){
  const direct=normalizeUrl(src); if(!direct)return '';
  const proxy=mediaProxyUrl(direct);
  return `src="${esc(direct)}"${proxy&&proxy!==direct?` data-proxy-src="${esc(proxy)}"`:''}`;
}
function mediaTime(seconds){
  const n=Math.max(0,Math.floor(Number(seconds)||0));
  const h=Math.floor(n/3600),m=Math.floor((n%3600)/60),sec=String(n%60).padStart(2,'0');
  return h?`${h}:${String(m).padStart(2,'0')}:${sec}`:`${m}:${sec}`;
}
function syncVideoViewport(){
  const h=Math.round(window.visualViewport?.height||window.innerHeight||0);
  if(h>0)document.documentElement.style.setProperty('--video-vh',h+'px');
}
function updateFeedSoundUI(){
  document.querySelectorAll('[data-feed-sound]').forEach(b=>{
    const icon=b.querySelector('.circle'); const label=b.querySelector('.video-action-label');
    if(icon)icon.textContent=feedSoundOn?'🔊':'🔇';
    if(label)label.textContent=feedSoundOn?'音声OFF':'音声ON';
  });
  document.querySelectorAll('#videoFeed video').forEach(v=>v.muted=!feedSoundOn);
}
function setFeedSound(on){
  feedSoundOn=!!on; updateFeedSoundUI();
  const current=document.querySelector('.video-slide.is-current video')||document.querySelector('#videoFeed video');
  if(current&&!current.paused)current.play().catch(()=>{});
}
function currentFeedVideo(){
  return feedSlide(feedCurrentIndex)?.querySelector('video')||null;
}
function bufferedEnd(v){
  if(!v?.buffered?.length)return 0;
  try{
    let end=0;for(let i=0;i<v.buffered.length;i++)end=Math.max(end,v.buffered.end(i));
    return end;
  }catch{return 0;}
}
function updateBufferedVisual(slide,v){
  if(!slide||!v)return;
  const scrub=slide.querySelector('[data-feed-scrub]');
  if(scrub&&Number.isFinite(v.duration)&&v.duration>0){
    const pct=Math.max(0,Math.min(100,bufferedEnd(v)/v.duration*100));
    scrub.style.setProperty('--buffer-pct',pct+'%');
  }
}
function setLoadStatus(slide,text=''){
  const el=slide?.querySelector('[data-feed-load-status]');if(!el)return;
  el.textContent=text;el.hidden=!text;
}
function bufferStatusText(v,prefix='読み込み中…'){
  if(!v)return prefix;
  const end=bufferedEnd(v),dur=Number.isFinite(v.duration)?v.duration:0;
  if(dur>0)return `${prefix} 読込済み ${mediaTime(end)} / ${mediaTime(dur)}`;
  if(end>0)return `${prefix} 読込済み ${mediaTime(end)}`;
  return prefix;
}
function stopBufferPulse(v){
  if(!v)return;
  clearInterval(v._bufferPulse);v._bufferPulse=null;v._bufferMode='';
}
function startBufferPulse(slide,v,mode='loading'){
  if(!slide||!v)return;
  stopBufferPulse(v);
  v._bufferMode=mode;v._lastBufferedEnd=bufferedEnd(v);v._lastBufferAdvanceAt=Date.now();
  const pulse=()=>{
    if(v.dataset.feedState!=='active'){stopBufferPulse(v);return;}
    const end=bufferedEnd(v);
    if(end>Number(v._lastBufferedEnd||0)+.05){v._lastBufferedEnd=end;v._lastBufferAdvanceAt=Date.now();}
    const stalled=Date.now()-Number(v._lastBufferAdvanceAt||Date.now())>3500;
    const prefix=mode==='seeking'?'シーク先を読み込み中…':stalled?'通信待ち…':'読み込み中…';
    updateBufferedVisual(slide,v);setLoadStatus(slide,bufferStatusText(v,prefix));
  };
  pulse();v._bufferPulse=setInterval(pulse,500);
}
function feedControlsBlocked(){
  const slide=feedSlide(feedCurrentIndex),scrub=slide?.querySelector('[data-feed-scrub]');
  return !!(slide?.classList.contains('video-buffering')||slide?.classList.contains('video-load-error')||scrub?.dataset.dragging==='1'||document.getElementById('mediaSaveDialog')?.open);
}
function setFeedControlsHidden(hidden){
  const d=$('#videoFeedDialog');if(!d)return;
  d.classList.toggle('controls-hidden',!!hidden);
}
function clearFeedControlsTimer(){if(feedControlsTimer){clearTimeout(feedControlsTimer);feedControlsTimer=null;}}
function hideFeedControls(){
  clearFeedControlsTimer();
  const v=currentFeedVideo();
  if(!v||v.paused||feedControlsBlocked())return;
  setFeedControlsHidden(true);
}
function scheduleFeedControlsHide(delay=1900){
  clearFeedControlsTimer();
  const v=currentFeedVideo();
  if(!v||v.paused||feedControlsBlocked())return;
  feedControlsTimer=setTimeout(hideFeedControls,delay);
}
function showFeedControls(autoHide=true){
  setFeedControlsHidden(false);clearFeedControlsTimer();
  if(autoHide)scheduleFeedControlsHide();
}

function clearFeedPlaybackWatchdog(){
  if(feedPlaybackWatchdog){clearInterval(feedPlaybackWatchdog);feedPlaybackWatchdog=null;}
  feedWatchdogToken++;
}
function resetFeedProgressWatch(v,full=true){
  if(!v)return;
  v._watchLastTime=Number(v.currentTime)||0;
  v._watchLastAdvanceAt=Date.now();
  if(full){
    v._watchRecoverStage=0;
    v._watchRouteTried=false;
  }
}
function feedShouldAutoPlay(v){
  const slide=v?.closest?.('.video-slide'),scrub=slide?.querySelector('[data-feed-scrub]');
  return !!(v&&!isNativeLongVideo(v)&&v.dataset.feedState==='active'&&v.dataset.shouldPlay==='1'&&slide?.classList.contains('is-current')&&scrub?.dataset.dragging!=='1'&&!document.hidden);
}
async function kickFeedPlayback(v,slide,reason='再生を再開中…'){
  if(!v||!slide||!feedShouldAutoPlay(v))return false;
  setLoadStatus(slide,bufferStatusText(v,reason));showFeedControls(false);
  try{
    await v.play();
    return true;
  }catch{
    try{
      v.muted=true;
      await v.play();
      return true;
    }catch{
      slide.classList.add('video-needs-tap');
      setLoadStatus(slide,'タップで再生してください');
      return false;
    }
  }
}
function isNativeLongVideo(v){return v?.dataset.nativeLong==='1';}
function enableNativeLongVideo(slide,v){
  if(!slide||!v||isNativeLongVideo(v))return;
  v.dataset.nativeLong='1';
  v.dataset.shouldPlay='0';
  stopBufferPulse(v);
  clearTimeout(v._routeTimer);
  slide.classList.remove('video-buffering','video-needs-tap','video-load-error');
  setLoadStatus(slide,'');
  slide.classList.add('system-long-video');
  try{v.pause();}catch{}
  v.controls=false;
  v.preload='none';
  v.muted=true;
  v.dataset.feedState='native-long';
  v.removeAttribute('src');
  try{v.load();}catch{}
  const scrub=slide.querySelector('[data-feed-scrub]');
  if(scrub)scrub.dataset.disabled='1';
  showFeedControls(false);
}
function openSystemLongVideo(index){
  const item=activeFeedItems[Number(index)],slide=feedSlide(Number(index)),v=slide?.querySelector('video');
  const target=normalizeUrl(v?.dataset.directSrc||item?.videoUrl||'');
  if(!target){toast('動画URLを開けません');return;}
  const opened=window.open(target,'_blank');
  if(opened){try{opened.opener=null;}catch{};return;}
  try{window.location.href=target;}catch{toast('Safariで動画を開けませんでした');}
}
function startFeedPlaybackWatchdog(){
  clearFeedPlaybackWatchdog();
  const token=feedWatchdogToken;
  feedPlaybackWatchdog=setInterval(async()=>{
    if(token!==feedWatchdogToken)return;
    const slide=feedSlide(feedCurrentIndex),v=slide?.querySelector('video');
    if(!slide||!v||!feedShouldAutoPlay(v)||slide.classList.contains('video-load-error'))return;
    const now=Date.now(),t=Number(v.currentTime)||0,prev=Number(v._watchLastTime||0);
    if(t>prev+.08){
      v._watchLastTime=t;v._watchLastAdvanceAt=now;v._watchRecoverStage=0;
      if(v.readyState>=2){setLoadStatus(slide,'');slide.classList.remove('video-buffering');}
      return;
    }
    if(!v._watchLastAdvanceAt)v._watchLastAdvanceAt=now;
    const stuckFor=now-v._watchLastAdvanceAt;
    const ahead=bufferedEnd(v)-t;
    if(v.seeking)return;
    if(v.readyState<2||ahead<=.15)return;
    if(stuckFor<1400)return;

    const stage=Number(v._watchRecoverStage||0);
    v._watchRecoverStage=stage+1;
    v._watchLastAdvanceAt=Date.now();

    if(stage===0){
      await kickFeedPlayback(v,slide,'読込済み・再生を再開中…');
      return;
    }
    if(stage===1){
      try{v.pause();}catch{}
      await kickFeedPlayback(v,slide,'読込済み・再生を再起動中…');
      return;
    }
    if(stage===2){
      const src=v.currentSrc||v.getAttribute('src')||v.dataset.expectedSrc||v.dataset.directSrc||'';
      const route=v.dataset.currentRoute||'direct';
      if(src){
        setLoadStatus(slide,'読込済み・再読込して再生中…');
        const serial=v.dataset.loadSerial;
        loadFeedSource(v,src,route,'active');
        v.dataset.shouldPlay='1';
        v._watchRecoverStage=3;
        const start=()=>{if(v.dataset.loadSerial===String(Number(serial)+1)&&v.dataset.feedState==='active')kickFeedPlayback(v,slide,'再読込後の再生を開始中…');};
        if(v.readyState>=2)start();else v.addEventListener('canplay',start,{once:true});
        return;
      }
    }
    if(stage===3){
      const proxy=v.dataset.proxySrc||'',route=v.dataset.currentRoute||'direct';
      if(route==='direct'&&proxy&&!v._watchRouteTried){
        v._watchRouteTried=true;
        setLoadStatus(slide,'読込済みですが再生が停止したため経路を切替中…');
        loadFeedSource(v,proxy,'proxy','active');
        v.dataset.shouldPlay='1';
        v._watchRecoverStage=4;
        const playWhenReady=()=>kickFeedPlayback(v,slide,'経路切替後の再生を開始中…');
        if(v.readyState>=2)playWhenReady();else v.addEventListener('canplay',playWhenReady,{once:true});
        return;
      }
    }
    if(stage>=4){
      stopBufferPulse(v);setLoadStatus(slide,'');slide.classList.remove('video-buffering');slide.classList.add('video-load-error');showFeedControls(false);
    }
  },500);
}

function closeVideoFeed(){
  feedActivationSerial++;clearFeedPlaybackWatchdog();clearFeedControlsTimer();setFeedControlsHidden(false);
  document.querySelectorAll('#videoFeed video').forEach(v=>releaseFeedVideoElement(v,true));
  activeFeedItems=[];feedCurrentIndex=0;feedRoutePrefs=new Map();feedHotOrder=[];
  if(feedObserver){try{feedObserver.disconnect();}catch{}feedObserver=null;}
  if(feedScrollTimer){clearTimeout(feedScrollTimer);feedScrollTimer=null;}
  const feed=$('#videoFeed');if(feed)feed.onscroll=null;
  if(feedViewportHandler&&window.visualViewport){window.visualViewport.removeEventListener('resize',feedViewportHandler);feedViewportHandler=null;}
  document.documentElement.style.removeProperty('--video-vh');
  const d=$('#videoFeedDialog');if(d?.open)d.close();
}
window.MyMelterCloseVideoFeed=closeVideoFeed;

function feedItemKey(item,index=0){
  return item?.id||((item?.browserRank?('rank:'+item.browserRank+':'):'')+(item?.videoUrl||item?.url||index));
}
function saveFeedVideoPosition(v){ /* feed playback always restarts from 0 */ }
function feedSlide(i){return document.querySelector('.video-slide[data-feed-index="'+i+'"]');}
function releaseFeedVideoElement(v,final=false){
  if(v?._hls){v._hls.destroy();v._hls=null;}
  if(!v)return;
  v.dataset.shouldPlay='0';
  try{v.pause();}catch{}
  stopBufferPulse(v);clearTimeout(v._routeTimer);
  v.dataset.feedState='released';
  v.dataset.loadSerial=String((Number(v.dataset.loadSerial)||0)+1);
  v.removeAttribute('src');
  v.preload='none';
  try{v.load();}catch{}
  if(final){delete v.dataset.proxyTried;delete v.dataset.expectedSrc;delete v.dataset.currentRoute;delete v.dataset.nativeLong;v.controls=false;}
}
function releaseFeedVideo(i){
  const slide=feedSlide(i),v=slide?.querySelector('video');
  if(v)releaseFeedVideoElement(v);
  slide?.classList.remove('is-playing','video-needs-tap','video-load-error','video-buffering');
}
function loadFeedSource(v,src,route,stateName='active'){
  if(!v||!src)return;
  const serial=(Number(v.dataset.loadSerial)||0)+1;
  v.dataset.loadSerial=String(serial);
  v.dataset.feedState=stateName;
  v.dataset.currentRoute=route;
  v.dataset.expectedSrc=src;
  if(v._watchRecoverStage==null||Number(v._watchRecoverStage)===0)resetFeedProgressWatch(v,true);
  else resetFeedProgressWatch(v,false);
  v.preload=stateName==='active'?'auto':'metadata';
  v.muted=!feedSoundOn;
  clearTimeout(v._routeTimer);
  if(isHls(v.dataset.directSrc)&&window.Hls?.isSupported()){
    v._hls?.destroy();const h=new Hls({maxBufferLength:30,backBufferLength:15,xhrSetup:(xhr,url)=>{if(route==='proxy'){const proxy=mediaProxyUrl(url);if(proxy)xhr.open('GET',proxy,true);}}});v._hls=h;
    h.on(Hls.Events.MANIFEST_PARSED,()=>{if(v._hls!==h)return;const target=v.dataset.qualityTarget;h.currentLevel=target?h.levels.findIndex(l=>l.url.includes(target)):-1;if(stateName==='active'&&v.dataset.shouldPlay==='1')v.play().catch(()=>{});});
    h.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal&&v._hls===h)v.dispatchEvent(new Event('error'));});h.loadSource(v.dataset.directSrc);h.attachMedia(v);return;
  }
  v.src=src;
  try{v.load();}catch{}
  if(stateName==='active'&&route==='direct'&&v.dataset.proxySrc){
    const serial=v.dataset.loadSerial;
    v._routeTimer=setTimeout(()=>{
      if(v.dataset.loadSerial!==serial||v.dataset.feedState!=='active'||v.readyState>=2||v.dataset.currentRoute!=='direct')return;
      if(bufferedEnd(v)>.5)return;
      v.dataset.proxyTried='1';feedRoutePrefs.set(v.dataset.directSrc||'','proxy');
      loadFeedSource(v,v.dataset.proxySrc,'proxy','active');
    },2400);
  }
}
function preferredFeedSource(v){
  const direct=v?.dataset.directSrc||'',proxy=v?.dataset.proxySrc||'';
  const pref=feedRoutePrefs.get(direct);
  if(pref==='proxy'&&proxy)return {src:proxy,route:'proxy'};
  return {src:direct,route:'direct'};
}
function prepareFeedVideo(i,active=true){
  const slide=feedSlide(i),v=slide?.querySelector('video');if(!v)return null;
  if(isNativeLongVideo(v)){v.dataset.feedState='native-long';v.dataset.shouldPlay='0';return v;}
  const chosen=preferredFeedSource(v);if(!chosen.src)return null;
  if((v.getAttribute('src')||v._hls)&&v.dataset.feedState!=='released'){
    v.dataset.feedState=active?'active':'cached';
    v.preload=active?'auto':'metadata';
    if(active&&v.readyState<2){slide.classList.add('video-buffering');showFeedControls(false);startBufferPulse(slide,v,'loading');}
    return v;
  }
  slide.classList.remove('video-load-error','video-needs-tap');
  if(active){slide.classList.add('video-buffering');showFeedControls(false);}
  delete v.dataset.proxyTried;
  loadFeedSource(v,chosen.src,chosen.route,active?'active':'cached');
  if(active)startBufferPulse(slide,v,'loading');
  return v;
}
function currentFeedIndexFromScroll(){
  const feed=$('#videoFeed'),slides=$$('.video-slide',feed);
  if(!feed||!slides.length)return 0;
  let best=0,bestDist=Infinity;
  const top=feed.scrollTop;
  slides.forEach((slide,i)=>{const d=Math.abs(slide.offsetTop-top);if(d<bestDist){bestDist=d;best=i;}});
  return best;
}
function activateFeedIndex(index,force=false){
  const slides=$$('.video-slide',$('#videoFeed')); if(!slides.length)return;
  const i=Math.max(0,Math.min(slides.length-1,Number(index)||0));
  if(!force&&i===feedCurrentIndex){
    const current=feedSlide(i)?.querySelector('video');
    if(current?.getAttribute('src')&&current.dataset.feedState==='active')return;
  }
  feedActivationSerial++;const activationId=feedActivationSerial;
  feedCurrentIndex=i;showFeedControls(true);
  feedHotOrder=[i-1,i,i+1].filter(x=>x>=0&&x<slides.length);
  const hot=new Set(feedHotOrder);
  slides.forEach((slide,j)=>{
    slide.classList.toggle('is-current',j===i);
    const v=slide.querySelector('video'); if(!v)return;
    if(j===i)return;
    v.dataset.shouldPlay='0';
    try{v.pause();}catch{}
    if(hot.has(j)){prepareFeedVideo(j,false);slide.classList.remove('video-load-error','video-buffering');}
    else releaseFeedVideo(j);
  });
  const item=activeFeedItems[i],slide=feedSlide(i),v=prepareFeedVideo(i,true);
  if(item?.url&&!feedSeenUrls.has(feedItemKey(item,i))){feedSeenUrls.add(feedItemKey(item,i));recordHistory(item,false);}
  if(v){
    if(isNativeLongVideo(v)){v.dataset.shouldPlay='0';showFeedControls(false);return;}
    v.dataset.shouldPlay='1';resetFeedProgressWatch(v,true);
    v.muted=!feedSoundOn;
    const start=()=>{
      if(feedActivationSerial!==activationId||feedCurrentIndex!==i||v.dataset.feedState!=='active')return;
      try{v.currentTime=0;}catch{}
      kickFeedPlayback(v,slide,'再生を開始中…');
    };
    if(v.readyState>=2)start();else v.addEventListener('canplay',start,{once:true});
  }
}
function snapFeedToIndex(i){
  const feed=$('#videoFeed'),slide=feedSlide(i);if(feed&&slide)feed.scrollTo({top:slide.offsetTop,behavior:'auto'});
}
function openVideoFeedItems(items,title='動画',startIndex=0){
  const vids=(items||[]).filter(x=>x?.videoUrl);if(!vids.length){toast('直接再生できる動画URLがありません');return;}
  activeFeedItems=vids;feedSeenUrls=new Set();feedSoundOn=false;feedRoutePrefs=new Map();feedHotOrder=[];
  feedCurrentIndex=Math.max(0,Math.min(vids.length-1,Number(startIndex)||0));
  $('#videoFeedTitle').textContent=title||'動画';syncVideoViewport();
  if(window.visualViewport){feedViewportHandler=syncVideoViewport;window.visualViewport.addEventListener('resize',feedViewportHandler);}
  $('#videoFeed').innerHTML=vids.map((x,i)=>videoSlideHTML(x,i)).join('');
  if(!$('#videoFeedDialog').open)$('#videoFeedDialog').showModal();
  showFeedControls(false);
  setupVideoAutoplay(feedCurrentIndex);updateFeedSoundUI();startFeedPlaybackWatchdog();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{snapFeedToIndex(feedCurrentIndex);activateFeedIndex(feedCurrentIndex,true);}));
}
function openVideoFeed(){openVideoFeedItems(activeVideoItems(),activeChannel?.name||'動画',0);}
function videoSlideHTML(x,i){
  const direct=x.videoUrl||'',proxy=mediaProxyUrl(direct),poster=x.image||'',saved=isSavedUrl(x.url);
  const proxyAttr=proxy&&proxy!==direct?' data-proxy-src="'+esc(proxy)+'"':'';
  const media=direct?'<video data-direct-src="'+esc(direct)+'"'+proxyAttr+(poster?' poster="'+esc(poster)+'"':'')+' data-feed-video="'+i+'" playsinline loop preload="none"></video>':'<div class="video-fallback"><div><strong>直接再生URLがありません</strong></div></div>';
  const source=x.deepDive?('深掘り · '+(x.deepSource||'関連')):(x.channelName||domainOf(x.url));
  const longCard='<div class="long-system-card">'+(poster?'<img '+imageSourceAttrs(poster)+' alt="">':'<div class="long-system-placeholder">長尺動画</div>')+'<div class="long-system-copy"><strong>長尺動画</strong><small>iPhoneのSafari標準プレイヤーで再生します</small><button type="button" data-long-system-play="'+i+'">Safariで再生</button></div></div>';
  return '<section class="video-slide" data-feed-index="'+i+'">'+media+longCard+'<button type="button" class="video-play-zone" data-feed-toggle="'+i+'" aria-label="再生・一時停止"></button><div class="video-error-panel"><strong>この動画を再生できません</strong><button type="button" data-feed-retry="'+i+'">再試行</button></div><div class="video-load-status" data-feed-load-status hidden></div><div class="video-progress"><div class="seek-preview" data-feed-preview="'+i+'"><video class="seek-preview-video" muted playsinline preload="metadata"></video><img '+(poster?imageSourceAttrs(poster):'')+' alt=""><span data-feed-preview-time>0:00</span></div><div class="video-scrubber" data-feed-scrub="'+i+'" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="video-scrub-track"><div class="video-scrub-buffer"></div><div class="video-scrub-fill"></div><div class="video-scrub-thumb"></div></div></div><div class="video-time"><span data-feed-current>0:00</span><span>/</span><span data-feed-duration>--:--</span></div></div><div class="video-overlay"><strong>'+esc(x.title||'動画')+'</strong><small>'+esc(source)+'</small></div><div class="video-actions"><button type="button" class="video-action" data-feed-quality="'+i+'"><span class="circle">HD</span><span>画質</span></button><button type="button" class="video-action" data-feed-sound="'+i+'"><span class="circle">🔇</span><span class="video-action-label">音声ON</span></button><button type="button" class="video-action" data-feed-quick-save="'+i+'"><span class="circle">⇩</span><span>端末保存</span></button><button type="button" class="video-action" data-feed-save="'+i+'"><span class="circle">'+(saved?'♥':'♡')+'</span><span>'+(saved?'保存済み':'保存')+'</span></button>'+(x.url&&x.url!==x.videoUrl?'<button type="button" class="video-action" data-feed-source-open="'+i+'"><span class="circle">↗</span><span>元ページ</span></button>':'')+'</div><div class="swipe-hint">⌃ 上にスワイプして次の動画</div></section>';
}
function setupVideoAutoplay(startIndex=0){
  const feed=$('#videoFeed'),vids=activeFeedItems,slides=$$('.video-slide',feed);
  slides.forEach(slide=>{
    const i=Number(slide.dataset.feedIndex),item=vids[i],v=slide.querySelector('video');if(!v||!item)return;
    const key=item.videoUrl||item.url,cur=slide.querySelector('[data-feed-current]'),dur=slide.querySelector('[data-feed-duration]'),scrub=slide.querySelector('[data-feed-scrub]');
    const tick=()=>{if(cur)cur.textContent=mediaTime(v.currentTime);if(dur&&Number.isFinite(v.duration))dur.textContent=mediaTime(v.duration);if(scrub&&Number.isFinite(v.duration)&&scrub.dataset.dragging!=='1')updateScrubberVisual(scrub,v.currentTime,v.duration);};
    v.addEventListener('loadedmetadata',()=>{
      if(v.dataset.feedState==='released')return;
      try{v.currentTime=0;}catch{}
      tick();updateBufferedVisual(slide,v);
      if(Number.isFinite(v.duration)&&v.duration>45)enableNativeLongVideo(slide,v);
    });
    v.addEventListener('canplay',()=>{
      if(v.dataset.feedState==='released')return;
      stopBufferPulse(v);setLoadStatus(slide,'');updateBufferedVisual(slide,v);
      slide.classList.remove('video-buffering','video-load-error');
      const route=v.dataset.currentRoute||'direct',direct=v.dataset.directSrc||'';
      if(direct)feedRoutePrefs.set(direct,route);
      if(isNativeLongVideo(v))showFeedControls(false);
    });
    v.addEventListener('progress',()=>{updateBufferedVisual(slide,v);if(v._bufferPulse)setLoadStatus(slide,bufferStatusText(v,v._bufferMode==='seeking'?'シーク先を読み込み中…':'読み込み中…'));});
    v.addEventListener('waiting',()=>{
      const scrub=slide.querySelector('[data-feed-scrub]');
      if(!isNativeLongVideo(v)&&v.dataset.feedState==='active'&&scrub?.dataset.dragging!=='1'){
        slide.classList.add('video-buffering');showFeedControls(false);startBufferPulse(slide,v,'loading');
      }
    });
    v.addEventListener('stalled',()=>{if(!isNativeLongVideo(v)&&v.dataset.feedState==='active'){slide.classList.add('video-buffering');showFeedControls(false);startBufferPulse(slide,v,'loading');setLoadStatus(slide,bufferStatusText(v,'通信待ち…'));}});
    v.addEventListener('seeking',()=>{if(!isNativeLongVideo(v)&&v.dataset.feedState==='active'){slide.classList.add('video-buffering');showFeedControls(false);startBufferPulse(slide,v,'seeking');}});
    v.addEventListener('seeked',()=>{if(v.readyState>=2){stopBufferPulse(v);setLoadStatus(slide,'');slide.classList.remove('video-buffering');}});
    v.addEventListener('playing',()=>{v._watchLastAdvanceAt=v._watchLastAdvanceAt||Date.now();stopBufferPulse(v);setLoadStatus(slide,'');slide.classList.remove('video-buffering','video-needs-tap');slide.classList.add('is-playing');scheduleFeedControlsHide();});
    v.addEventListener('timeupdate',()=>{const t=Number(v.currentTime)||0;if(t>Number(v._watchLastTime||0)+.05){v._watchLastTime=t;v._watchLastAdvanceAt=Date.now();v._watchRecoverStage=0;}tick();});
    v.addEventListener('pause',()=>{slide.classList.remove('is-playing');showFeedControls(false);});
    v.addEventListener('error',()=>{
      if(v.dataset.feedState==='released')return;
      const direct=v.dataset.directSrc||'',proxy=v.dataset.proxySrc||'',route=v.dataset.currentRoute||'direct';
      if(route==='direct'&&proxy&&!v.dataset.proxyTried){
        v.dataset.proxyTried='1';feedRoutePrefs.set(direct,'proxy');slide.classList.add('video-buffering');
        loadFeedSource(v,proxy,'proxy','active');
        if(slide.classList.contains('is-current'))v.play().catch(()=>{});
        return;
      }
      stopBufferPulse(v);setLoadStatus(slide,'');showFeedControls(false);slide.classList.remove('video-buffering');slide.classList.add('video-load-error');
    });
    v.addEventListener('ended',()=>{try{v.currentTime=0;}catch{};});
  });
  if(feedObserver){try{feedObserver.disconnect();}catch{}feedObserver=null;}
  if(feedScrollTimer){clearTimeout(feedScrollTimer);feedScrollTimer=null;}
  feed.onscroll=()=>{
    showFeedControls(false);
    if(feedScrollTimer)clearTimeout(feedScrollTimer);
    feedScrollTimer=setTimeout(()=>{
      const i=currentFeedIndexFromScroll(),slide=feedSlide(i);
      if(slide&&Math.abs(feed.scrollTop-slide.offsetTop)>2)feed.scrollTo({top:slide.offsetTop,behavior:'auto'});
      activateFeedIndex(i);
    },190);
  };
}
function openSearchResults(q){
  const needle=q.trim().toLowerCase(); if(!needle)return;
  const channels=state.channels.filter(c=>`${c.name} ${c.url}`.toLowerCase().includes(needle)).slice(0,20);
  const items=uniqueBy([...state.catalog,...state.history,...state.saved],x=>x.url).filter(x=>`${x.title||''} ${x.url||''}`.toLowerCase().includes(needle)).slice(0,30);
  const candidates=state.candidates.filter(c=>`${c.name} ${c.url}`.toLowerCase().includes(needle)).slice(0,15);
  const section=(title,arr,fn)=>arr.length?`<section class="search-section"><h3>${title}</h3>${arr.map(fn).join('')}</section>`:'';
  $('#searchResults').innerHTML=section('チャンネル',channels,c=>`<button class="search-hit" data-open-channel="${esc(c.id)}"><span class="mini-icon">${esc(typeGlyph(c.type))}</span><span class="hit-main"><strong>${esc(c.name)}</strong><small>${esc(c.url)}</small></span></button>`)+section('履歴・保存済み',items,x=>`<button class="search-hit" data-open-url="${esc(x.url)}"><span class="mini-icon">${esc(typeGlyph(mediaKind(x)))}</span><span class="hit-main"><strong>${esc(x.title||'無題')}</strong><small>${esc(x.url)}</small></span></button>`)+section('自動検出候補',candidates,c=>`<button class="search-hit" data-add-candidate="${esc(c.id)}"><span class="mini-icon">＋</span><span class="hit-main"><strong>${esc(c.name)}</strong><small>${esc(c.url)}</small></span></button>`)||`<div class="empty-card">「${esc(q)}」に一致するデータはありません。</div>`;
  $('#searchDialog').showModal();
}

function exportState(){
  const payload={app:'MyMelter',version:APP_VERSION,exportedAt:new Date().toISOString(),state}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`MyMelter_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importState(file){
  const data=JSON.parse(await file.text()); const incoming=data.state||data;
  state={...clone(defaultState),...incoming,settings:{...defaultState.settings,...(incoming.settings||{})},meta:{...defaultState.meta,...(incoming.meta||{})},ui:{...defaultState.ui,...(incoming.ui||{})},positions:incoming.positions&&typeof incoming.positions==='object'?incoming.positions:{}};
  state.channels=(state.channels||[]).map(normalizeChannel); state.candidates=state.candidates||[];state.history=state.history||[];state.saved=state.saved||incoming.favorites||[];state.catalog=state.catalog||[];state.collections=state.collections||[];saveState();
}

// Navigation and primary actions
$$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
$('#homeAddChannel').onclick=()=>{ $('#discoverUrl').value=''; $('#discoverStatus').textContent=''; renderDiscoveryResults(state.candidates); $('#discoverDialog').showModal(); };
$('#discoverBtn').onclick=$('#discoverBanner').onclick=$('#homeAddChannel').onclick;
$('#channelsAddBtn').onclick=()=>openChannelEditor();
$('#runDiscoveryBtn').onclick=runDiscovery;
$('#discoverUrl').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runDiscovery();}});
$('#channelCloseBtn').onclick=()=>$('#channelDialog').close();
$('#channelForm').addEventListener('submit',e=>{e.preventDefault();saveChannelFromForm();});
$('#deleteChannelBtn').onclick=()=>{if(!activeEditId)return;if(confirm('このチャンネルを削除しますか？')){state.channels=state.channels.filter(x=>x.id!==activeEditId);saveState();$('#channelDialog').close();toast('削除しました');}};
$('#testChannelBtn').onclick=async()=>{const c=channelFromForm();if(!c.url){toast('URLを確認してください');return;}$('#channelTestStatus').textContent='取得テスト中…';try{const t=await fetchText(c.url);const items=parseChannelContent(t,c,c.url);$('#channelTestStatus').textContent=`取得成功：${items.length}件を抽出できました。`;}catch(e){$('#channelTestStatus').textContent=`取得失敗：${e.message}`;}};
$('#channelFilter').oninput=renderChannelManager; $('#channelTypeFilter').onchange=renderChannelManager; $('#channelSort').onchange=e=>{state.ui.channelSort=e.target.value;saveState(false);renderChannelManager();};
$('#savedFilter').oninput=renderSaved; $('#savedTypeFilter').onchange=renderSaved; $('#savedSort').onchange=e=>{state.ui.savedSort=e.target.value;saveState(false);renderSaved();};
document.querySelectorAll('[data-ranking-mode]').forEach(b=>b.onclick=()=>{state.ui.rankingMode=b.dataset.rankingMode;saveState(false);renderRanking();});
$('#newCollectionBtn').onclick=()=>openCollectionDialog(); $('#collectionCloseBtn').onclick=()=>$('#collectionDialog').close(); $('#createCollectionBtn').onclick=createCollection;
$('#collectionNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();createCollection();}});
$('#clearHistoryBtn').onclick=()=>{if(confirm('閲覧履歴をすべて消去しますか？')){state.history=[];saveState();}};

// Reader
$('#readerCloseBtn').onclick=()=>$('#readerDialog').close();
$('#readerEditBtn').onclick=()=>{if(activeChannel){$('#readerDialog').close();openChannelEditor(activeChannel);}};
$$('#readerModeTabs button').forEach(b=>b.onclick=()=>setReaderMode(b.dataset.readerMode));
$('#readerSearchBtn').onclick=()=>activeChannel&&openChannel(activeChannel,$('#readerSearch').value.trim());
$('#readerSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#readerSearchBtn').click();}});
$('#videoFeedClose').onclick=closeVideoFeed;

// Global search
$('#globalSearch').addEventListener('input',e=>$('#clearGlobalSearch').hidden=!e.target.value);
$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openSearchResults(e.target.value);}});
$('#clearGlobalSearch').onclick=()=>{$('#globalSearch').value='';$('#clearGlobalSearch').hidden=true;}; $('#searchCloseBtn').onclick=()=>$('#searchDialog').close();

// Settings
$('#fetchMode').onchange=e=>{state.settings.fetchMode=e.target.value;saveState(false);};
$('#proxyUrl').oninput=e=>{state.settings.proxyUrl=e.target.value.trim();workerCapability={checked:false,checking:false,version:'',download:false,error:''};saveState(false);probeWorkerDownloadCapability(true);};
$('#proxyKey').oninput=e=>{state.settings.proxyKey=e.target.value;workerCapability={checked:false,checking:false,version:'',download:false,error:''};saveState(false);probeWorkerDownloadCapability(true);};
const workerTestButton=$('#workerTestBtn');
// Worker接続テストは index.html 内の自己完結スクリプトで実行。
// app.js初期化に問題があっても診断できるよう、ここでは追加イベントを重ねない。
$('#openBrowserImportSetupBtn').onclick=()=>openBrowserImportSetup(state.meta.lastDiscoveryUrl||'https://www.twidouga.net/jp/ranking_t1.php');
$('#browserImportCloseBtn').onclick=()=>$('#browserImportDialog').close();
$('#copyBookmarkletBtn').onclick=copyBrowserImportBookmarklet;
$('#openBrowserImportTargetBtn').onclick=()=>{const target=normalizeUrl($('#browserImportTarget').value)||browserImportTarget;if(target)window.open(target,'_blank','noopener');};
$('#shortcutEnabled').onchange=e=>{state.settings.shortcutEnabled=e.target.checked;saveState(false);};
$('#shortcutName').oninput=e=>{state.settings.shortcutName=e.target.value.trim()||'MyMelter保存';saveState(false);};
$('#exportBtn').onclick=exportState; $('#importInput').onchange=async e=>{if(!e.target.files?.[0])return;try{await importState(e.target.files[0]);toast('バックアップを読み込みました');}catch{toast('バックアップを読み込めませんでした');}e.target.value='';};

// PWA install
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').hidden=false;});
$('#installBtn').onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt=null;$('#installBtn').hidden=true;}else{toast('iPhoneはSafari共有 →「ホーム画面に追加」');}};

// Delegated events
document.addEventListener('click',async e=>{
  if(e.target.closest?.('#videoFeedDialog .video-actions,#videoFeedDialog .video-progress,#videoFeedDialog .video-feed-top'))showFeedControls(true);
  const pressAction=actionablePressButton(e.target);
  if(pressAction&&Number(pressAction.dataset.suppressClickUntil||0)>Date.now()){e.preventDefault();return;}
  const browserImport=e.target.closest('[data-browser-import-target]'); if(browserImport){openBrowserImportSetup(browserImport.dataset.browserImportTarget||'');return;}
  const rank=e.target.closest('[data-ranking-index]'); if(rank){const item=currentRankingItems[Number(rank.dataset.rankingIndex)];if(item)openItem(item);return;}
  const colFilter=e.target.closest('[data-collection-filter]'); if(colFilter){state.ui.activeCollection=colFilter.dataset.collectionFilter;saveState(false);renderSaved();return;}
  const colItem=e.target.closest('[data-collection-item]'); if(colItem){const item=state.saved[Number(colItem.dataset.collectionItem)];if(item)openCollectionDialog(item);return;}
  const colToggle=e.target.closest('[data-toggle-collection]'); if(colToggle){toggleCollection(colToggle.dataset.toggleCollection);return;}
  const colDelete=e.target.closest('[data-delete-collection]'); if(colDelete){deleteCollection(colDelete.dataset.deleteCollection);return;}
  const openCh=e.target.closest('[data-open-channel]'); if(openCh){const c=state.channels.find(x=>x.id===openCh.dataset.openChannel);if(c){$('#searchDialog').open&&$('#searchDialog').close();openChannel(c);}return;}
  const gf=e.target.closest('[data-genre-filter]');if(gf){state.ui.channelGenre=gf.dataset.genreFilter;saveState(false);renderChannelManager();return;}
  const similar=e.target.closest('[data-similar-channel]');if(similar){const c=state.channels.find(x=>x.id===similar.dataset.similarChannel);if(c)runSimilarDiscovery(c);return;}
  const webSimilar=e.target.closest('[data-web-similar-channel]');if(webSimilar){const c=state.channels.find(x=>x.id===webSimilar.dataset.webSimilarChannel);if(c)startWebSimilarSearch(c);return;}
  const quality=e.target.closest('[data-feed-quality]');if(quality){openQualityPicker(activeFeedItems[Number(quality.dataset.feedQuality)],Number(quality.dataset.feedQuality));return;}
  const editCh=e.target.closest('[data-edit-channel]'); if(editCh){const c=state.channels.find(x=>x.id===editCh.dataset.editChannel);if(c)openChannelEditor(c);return;}
  const addC=e.target.closest('[data-add-candidate]'); if(addC){addCandidate(addC.dataset.addCandidate);return;}
  const addAll=e.target.closest('[data-add-all-candidates]'); if(addAll){addAllCandidates();return;}
  const prevC=e.target.closest('[data-preview-candidate]'); if(prevC){const c=state.candidates.find(x=>x.id===prevC.dataset.previewCandidate);if(c)openChannel(normalizeChannel(c));return;}
  const activeOpen=e.target.closest('[data-active-open]'); if(activeOpen){openActiveItem(Number(activeOpen.dataset.activeOpen));return;}
  const activeSave=e.target.closest('[data-active-save]'); if(activeSave){toggleSavedItem(activeItems[Number(activeSave.dataset.activeSave)],activeSave);return;}
  const activeQuick=e.target.closest('[data-active-quick-save]'); if(activeQuick){await prepareDeviceSave(activeItems[Number(activeQuick.dataset.activeQuickSave)]);return;}
  const launch=e.target.closest('#launchVideoFeedBtn'); if(launch){openVideoFeed();return;}
  const feedSlide=e.target.closest('[data-feed-index]');
  const feedVideo=e.target.closest('video[data-feed-video]'); if(feedVideo){if(feedVideo.paused){feedVideo.muted=!feedSoundOn;feedVideo.play().catch(()=>{});}else feedVideo.pause();return;}
  const feedSound=e.target.closest('[data-feed-sound]'); if(feedSound){setFeedSound(!feedSoundOn);const slide=feedSound.closest('.video-slide');const v=slide?.querySelector('video');if(v){v.muted=!feedSoundOn;if(v.dataset.shouldPlay==='1')kickFeedPlayback(v,slide,'再生を継続中…');}return;}
  const feedQuick=e.target.closest('[data-feed-quick-save]'); if(feedQuick&&feedSlide){await prepareDeviceSave(activeFeedItems[Number(feedQuick.dataset.feedQuickSave)]);return;}
  const feedSave=e.target.closest('[data-feed-save]'); if(feedSave&&feedSlide){toggleSavedItem(activeFeedItems[Number(feedSave.dataset.feedSave)],feedSave);return;}
  const longPlay=e.target.closest('[data-long-system-play]'); if(longPlay){openSystemLongVideo(Number(longPlay.dataset.longSystemPlay));return;}
  const feedToggle=e.target.closest('[data-feed-toggle]'); if(feedToggle){
    if($('#videoFeedDialog')?.classList.contains('controls-hidden')){showFeedControls(true);return;}
    const slide=feedToggle.closest('.video-slide'),v=slide?.querySelector('video');
    if(v){
      if(isNativeLongVideo(v)){showFeedControls(false);return;}
      if(v.paused){v.dataset.shouldPlay='1';resetFeedProgressWatch(v);kickFeedPlayback(v,slide,'再生を開始中…');}
      else{v.dataset.shouldPlay='0';v.pause();showFeedControls(false);}
    }
    return;
  }
  const feedRetry=e.target.closest('[data-feed-retry]'); if(feedRetry){const i=Number(feedRetry.dataset.feedRetry),slide=feedRetry.closest('.video-slide'),v=slide?.querySelector('video');if(v){feedRoutePrefs.delete(v.dataset.directSrc||'');delete v.dataset.proxyTried;releaseFeedVideoElement(v);slide?.classList.remove('video-load-error');activateFeedIndex(i,true);}return;}
  const feedSource=e.target.closest('[data-feed-source-open]'); if(feedSource){const item=activeFeedItems[Number(feedSource.dataset.feedSourceOpen)];if(item?.url)window.open(item.url,'_blank','noopener');return;}
  const lib=e.target.closest('[data-open-library]'); if(lib){const [kind,idxStr]=lib.dataset.openLibrary.split(':');const arr=kind==='saved'?state.saved:state.history;openItem(arr[Number(idxStr)]);return;}
  const rem=e.target.closest('[data-remove-saved]'); if(rem){removeSavedAt(Number(rem.dataset.removeSaved));return;}
  const saveH=e.target.closest('[data-save-history]'); if(saveH){saveItem(state.history[Number(saveH.dataset.saveHistory)]);return;}
  const recent=e.target.closest('[data-recent-index]'); if(recent){openItem(state.history[Number(recent.dataset.recentIndex)]);return;}
  const saved=e.target.closest('[data-saved-index]'); if(saved){openItem(state.saved[Number(saved.dataset.savedIndex)]);return;}
  const url=e.target.closest('[data-open-url]'); if(url){const target=url.dataset.openUrl;if(target){recordHistory({title:target,url:target,type:'article'});window.open(target,'_blank','noopener');}return;}
});

document.addEventListener('error',e=>{
  const img=e.target;
  if(!(img instanceof HTMLImageElement))return;
  const proxy=img.dataset.proxySrc||'';
  if(proxy&&!img.dataset.proxyTried){img.dataset.proxyTried='1';img.src=proxy;return;}
  img.classList.add('media-image-error');
},true);

function scrubPreviewBox(scrub){return scrub?.closest('.video-progress')?.querySelector('.seek-preview')||null;}
function scrubVideo(scrub){return scrub?.closest('.video-slide')?.querySelector('video')||null;}
function scrubValueFromClientX(scrub,clientX){
  const v=scrubVideo(scrub);if(!scrub||!v||!Number.isFinite(v.duration)||v.duration<=0)return 0;
  const r=scrub.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(clientX-r.left)/Math.max(1,r.width)));
  return pct*v.duration;
}
function updateScrubberVisual(scrub,time,duration){
  if(!scrub||!Number.isFinite(duration)||duration<=0)return;
  const pct=Math.max(0,Math.min(100,(Number(time)||0)/duration*100));
  scrub.style.setProperty('--seek-pct',pct+'%');
  scrub.setAttribute('aria-valuemax',String(duration));
  scrub.setAttribute('aria-valuenow',String(Number(time)||0));
  const fill=scrub.querySelector('.video-scrub-fill'),thumb=scrub.querySelector('.video-scrub-thumb');
  if(fill)fill.style.width=pct+'%';if(thumb)thumb.style.left=pct+'%';
}
function prepareScrubPreviewVideo(scrub){
  const box=scrubPreviewBox(scrub),pv=box?.querySelector('.seek-preview-video'),v=scrubVideo(scrub);
  if(!pv||!v)return null;
  if(Number.isFinite(v.duration)&&v.duration>30){box?.classList.remove('has-video');return null;}
  const src=v.currentSrc||v.getAttribute('src')||v.dataset.directSrc||'';
  if(src&&pv.dataset.previewSrc!==src){
    pv.dataset.previewSrc=src;pv.src=src;pv.muted=true;pv.preload='metadata';
    try{pv.load();}catch{}
  }
  return pv;
}
function scheduleScrubPreview(scrub,target){
  if(!scrub||scrub.dataset.dragging!=='1')return;
  scrub._previewTarget=target;
  const box=scrubPreviewBox(scrub),pv=prepareScrubPreviewVideo(scrub);
  if(!box||!pv)return;
  const now=performance.now(),wait=Math.max(0,220-(now-(scrub._previewLast||0)));
  clearTimeout(scrub._previewTimer);
  scrub._previewTimer=setTimeout(()=>{
    if(scrub.dataset.dragging!=='1')return;
    scrub._previewLast=performance.now();
    const t=Number(scrub._previewTarget)||0;
    const seekNow=()=>{
      if(scrub.dataset.dragging!=='1')return;
      const done=()=>{box.classList.add('has-video');};
      pv.addEventListener('seeked',done,{once:true});
      try{pv.currentTime=t;}catch{}
    };
    if(pv.readyState>=1)seekNow();else pv.addEventListener('loadedmetadata',seekNow,{once:true});
  },wait);
}
function updateScrubFromClient(scrub,clientX){
  const slide=scrub.closest('.video-slide'),v=scrubVideo(scrub);if(!v||!Number.isFinite(v.duration))return;
  const next=scrubValueFromClientX(scrub,clientX),pct=v.duration?next/v.duration*100:0;
  scrub.dataset.previewTime=String(next);updateScrubberVisual(scrub,next,v.duration);
  const current=slide.querySelector('[data-feed-current]');if(current)current.textContent=mediaTime(next);
  const box=scrubPreviewBox(scrub),ptime=box?.querySelector('[data-feed-preview-time]');
  if(box){box.style.left=pct+'%';box.classList.add('is-visible');}
  if(ptime)ptime.textContent=mediaTime(next);
  scheduleScrubPreview(scrub,next);
}
function beginFeedScrub(scrub,e){
  if(!scrub||scrub.dataset.dragging==='1')return;
  showFeedControls(false);
  const v=scrubVideo(scrub),box=scrubPreviewBox(scrub);
  scrub.dataset.dragging='1';scrub.dataset.pointerId=String(e.pointerId);
  scrub.dataset.wasPlaying=v&&!v.paused?'1':'0';
  if(v&&!v.paused){try{v.pause();}catch{}}
  try{scrub.setPointerCapture(e.pointerId);}catch{}
  if(box)box.classList.add('is-visible');
  updateScrubFromClient(scrub,e.clientX);
}
function finishFeedScrub(scrub,e){
  if(!scrub||scrub.dataset.dragging!=='1')return;
  const v=scrubVideo(scrub),box=scrubPreviewBox(scrub),wasPlaying=scrub.dataset.wasPlaying==='1';
  const next=Number(scrub.dataset.previewTime)||0;
  delete scrub.dataset.dragging;delete scrub.dataset.wasPlaying;delete scrub.dataset.pointerId;
  clearTimeout(scrub._previewTimer);
  try{scrub.releasePointerCapture(e.pointerId);}catch{}
  if(!v||!Number.isFinite(v.duration)){box?.classList.remove('is-visible');return;}
  const slide=scrub.closest('.video-slide');slide?.classList.add('video-buffering');
  let finished=false;
  const done=()=>{
    if(finished)return;finished=true;slide?.classList.remove('video-buffering');
    setTimeout(()=>box?.classList.remove('is-visible','has-video'),100);
    const pv=box?.querySelector('.seek-preview-video');if(pv){pv.pause();pv.removeAttribute('src');try{pv.load();}catch{}}
    if(wasPlaying){v.muted=!feedSoundOn;v.play().catch(()=>{});}
    else showFeedControls(false);
  };
  try{v.currentTime=Math.max(0,Math.min(v.duration,next));}catch{done();return;}
  v.addEventListener('seeked',done,{once:true});setTimeout(done,3000);
}
document.addEventListener('pointerdown',e=>{
  const scrub=e.target.closest?.('[data-feed-scrub]');if(!scrub)return;
  e.preventDefault();e.stopPropagation();beginFeedScrub(scrub,e);
},{capture:true});
document.addEventListener('pointermove',e=>{
  const scrub=document.querySelector('[data-feed-scrub][data-dragging="1"]');if(!scrub)return;
  if(String(e.pointerId)!==scrub.dataset.pointerId)return;e.preventDefault();updateScrubFromClient(scrub,e.clientX);
},{capture:true});
document.addEventListener('pointerup',e=>{
  const scrub=document.querySelector('[data-feed-scrub][data-dragging="1"]');if(!scrub)return;
  if(String(e.pointerId)!==scrub.dataset.pointerId)return;e.preventDefault();finishFeedScrub(scrub,e);
},{capture:true});
document.addEventListener('pointercancel',e=>{
  const scrub=document.querySelector('[data-feed-scrub][data-dragging="1"]');if(scrub)finishFeedScrub(scrub,e);
},{capture:true});

function actionablePressButton(target){
  return target?.closest?.('[data-active-save],[data-active-quick-save],[data-feed-save],[data-feed-quick-save]')||null;
}
async function runPressAction(button){
  if(!button)return;
  if(button.hasAttribute('data-active-save')){toggleSavedItem(activeItems[Number(button.dataset.activeSave)],button);return;}
  if(button.hasAttribute('data-active-quick-save')){await prepareDeviceSave(activeItems[Number(button.dataset.activeQuickSave)]);return;}
  if(button.hasAttribute('data-feed-save')){toggleSavedItem(activeFeedItems[Number(button.dataset.feedSave)],button);return;}
  if(button.hasAttribute('data-feed-quick-save')){await prepareDeviceSave(activeFeedItems[Number(button.dataset.feedQuickSave)]);return;}
}
document.addEventListener('pointerdown',e=>{
  const button=actionablePressButton(e.target);if(!button)return;
  pressCandidate={button,pointerId:e.pointerId,x:e.clientX,y:e.clientY};
  button.classList.add('pressing');
},{capture:true});
document.addEventListener('pointerup',e=>{
  const p=pressCandidate;if(!p||p.pointerId!==e.pointerId)return;
  pressCandidate=null;p.button.classList.remove('pressing');
  const moved=Math.hypot(e.clientX-p.x,e.clientY-p.y);
  if(moved>14)return;
  p.button.dataset.suppressClickUntil=String(Date.now()+700);
  e.preventDefault();e.stopPropagation();
  runPressAction(p.button);
},{capture:true});
document.addEventListener('pointercancel',()=>{
  if(pressCandidate?.button)pressCandidate.button.classList.remove('pressing');pressCandidate=null;
},{capture:true});

// Initial launch
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW',e));}
const importedBrowserResult=consumeBrowserImportHash();
renderAll();
probeWorkerDownloadCapability(true);
if(state.channels.length){try{saveState(false);}catch(e){console.warn('ジャンル補完の保存に失敗',e);}}
if(importedBrowserResult?.kind==='web-search'){
  setTimeout(()=>{
    const ch=importedBrowserResult.channel;$('#discoverUrl').value=ch?.url||'';renderDiscoveryResults(importedBrowserResult.candidates||[]);
    $('#discoverStatus').textContent=(importedBrowserResult.candidates?.length||0)?(importedBrowserResult.candidates.length+'件のWeb候補。内容を確認して追加してください。'):'Web検索から追加できる候補がありませんでした。';
    if(!$('#discoverDialog').open)$('#discoverDialog').showModal();
  },0);
}else if(importedBrowserResult){setTimeout(()=>openChannel(importedBrowserResult),0);}

function similarCandidateSignals(name='',url='',context='',rel=''){
  const text=`${name} ${url} ${context} ${rel}`,label=String(name||'').trim(),host=domainOf(url).toLowerCase();
  const generic=/^(保存|開く|詳細|こちら|もっと見る|続きを読む|今すぐ|無料|登録|入会|ダウンロード|download|open|more)$/i.test(label);
  const ad=/(?:【PR】|\[PR\]|(^|\s)PR(?:\s|$)|広告|スポンサー|sponsored|アフィリエイト|affiliate|アダルトチャット|チャット広告|キャンペーン|promoted|promotion)/i.test(text);
  const adHost=/(^|\.)(doubleclick\.net|googlesyndication\.com|adservice\.google\.com|adnxs\.com|taboola\.com|outbrain\.com|criteo\.com|exoclick\.com|trafficjunky\.com|popads\.net|propellerads\.com|adsterra\.com)$/i.test(host);
  const relation=/関連|おすすめ|姉妹|相互|リンク集|友達|related|recommend|partner|similar/i.test(`${context} ${rel}`);
  return {generic,ad,adHost,relation};
}
function isSuitableSimilarCandidate(candidate,channel=null,context='',rel=''){
  const url=normalizeUrl(candidate?.url||''),name=String(candidate?.name||'').trim();if(!url||!name)return false;
  const s=similarCandidateSignals(name,url,context,rel);if(s.generic||s.ad||s.adHost)return false;
  const score=Number(candidate?.similarityScore||0);
  if(score>=4)return true;
  if(!channel)return false;
  const type=candidate?.type||guessTypeFromText(name,url),sameGenre=inferGenre({name,url,type})===inferGenre(channel);
  return s.relation||(sameGenre&&score>=2);
}
function relatedLinkImage(a,base){
  const img=a?.querySelector?.('img')||a?.closest?.('aside,nav,footer,section,div,li')?.querySelector?.('img');
  const raw=img?.getAttribute?.('data-src')||img?.getAttribute?.('src')||img?.getAttribute?.('data-original')||img?.getAttribute?.('data-lazy-src')||'';
  return absoluteUrl(raw,base);
}
function externalSiteCandidates(doc,base,channel){
  const seenDomains=new Set(state.channels.map(c=>domainOf(c.url)).filter(Boolean)),origin=new URL(base).origin;
  const genre=inferGenre(channel),list=[];
  for(const a of doc.querySelectorAll('a[href]')){
    const url=MyMelterFeatures.safeUrl(a.getAttribute('href'),base),name=(a.textContent||a.getAttribute('title')||'').replace(/\s+/g,' ').trim();
    if(!url||new URL(url).origin===origin||seenDomains.has(domainOf(url))||!name||name.length>100)continue;
    if(/\.(?:mp4|m3u8|png|jpe?g|gif|webp|zip|pdf)(?:$|\?)/i.test(url))continue;
    const context=(a.closest('aside,nav,footer,section,div,li')?.textContent||'').slice(0,500),rel=String(a.getAttribute('rel')||''),signals=similarCandidateSignals(name,url,context,rel);
    if(signals.generic||signals.ad||signals.adHost)continue;
    const type=guessTypeFromText(name+' '+context,url),inferred=inferGenre({name,url,type}),sameGenre=inferred===genre;
    const relatedBox=!!a.closest('[class*="related"],[class*="recommend"],[class*="partner"],[class*="linklist"],[class*="links"]');
    const score=(signals.relation?5:0)+(relatedBox?2:0)+(sameGenre?2:0)+(name.length>=4?1:0);
    const candidate={...candidateFrom(url,name,type,{source:'external-link',image:relatedLinkImage(a,base),similarityScore:score}),genre:inferred,similarityScore:score};
    if(!isSuitableSimilarCandidate(candidate,channel,context,rel))continue;
    list.push(candidate);
  }
  return uniqueBy(list.sort((a,b)=>b.similarityScore-a.similarityScore),c=>domainOf(c.url)).slice(0,12);
}
function webSimilarSearchQuery(channel){
  const d=domainOf(channel?.url||''),genre=inferGenre(channel||{}),name=String(channel?.name||'').replace(/\s+/g,' ').trim();
  const core=(name&&name.length<=60)?name:(d||'サイト');
  return [core,genre,'似たサイト おすすめ',d?('-site:'+d):''].filter(Boolean).join(' ');
}
function renderWebSimilarFallback(channel,message=''){
  const text=message||'元ページ内に十分な関連リンクがありません。Web検索から候補を探せます。';
  $('#discoverResults').innerHTML=`<div class="browser-fallback-card web-similar-fallback"><strong>Webから似たサイトを探す</strong><small>${esc(text)}<br>検索結果が開いたらSafariのブックマーク「MyMelter取込」を実行してください。初回だけv15への更新が必要です。</small><button type="button" class="primary" data-web-similar-channel="${esc(channel.id)}">Webから探す</button></div>`;
}
function startWebSimilarSearch(channel){
  if(!channel)return;
  const query=webSimilarSearchQuery(channel),url='https://html.duckduckgo.com/html/?q='+encodeURIComponent(query);
  state.meta.pendingWebSimilar={channelId:channel.id,query,at:Date.now()};saveState(false);
  const v=Number(state.meta.browserImportVersion||channel.relatedSitesVersion||0);
  toast(v<15?'検索結果でv15の「MyMelter取込」を実行してください':'検索結果で「MyMelter取込」を実行してください');
  const win=window.open(url,'_blank','noopener');if(!win)window.location.href=url;
}
async function runSimilarDiscovery(channel){
  const status=$('#discoverStatus');$('#discoverUrl').value=channel.url;$('#discoverResults').innerHTML='';status.textContent='関連リンクから似たサイト候補を探しています…';
  if(!$('#discoverDialog').open)$('#discoverDialog').showModal();$('#runDiscoveryBtn').disabled=true;
  if(channel.source==='browser'){
    if(Number(channel.relatedSitesVersion||0)<14){
      state.candidates=[];renderCandidates();
      status.textContent='このSafari取り込みは旧版です。広告除外とサムネイル対応の最新版で1回だけ再取り込みしてください。';
      $('#discoverResults').innerHTML=`<div class="browser-fallback-card"><strong>Safariから似たサイト候補を更新できます</strong><small>最新版では広告・PRを除外し、候補の小型サムネイルも一緒に取り込みます。</small><button type="button" class="primary" data-browser-import-target="${esc(channel.browserSourceUrl||channel.url)}">Safariで候補を再取り込み</button></div>`;
      $('#runDiscoveryBtn').disabled=false;return;
    }
    const list=uniqueBy((Array.isArray(channel.relatedSites)?channel.relatedSites:[]).map(x=>{
      const url=normalizeUrl(x?.url||''),name=String(x?.name||domainOf(url)||'関連サイト').trim();if(!url||!name)return null;
      if(state.channels.some(c=>domainOf(c.url)===domainOf(url)))return null;
      const type=x.type||guessTypeFromText(name,url),candidate={...candidateFrom(url,name,type,{source:'safari-related',image:x.image,similarityScore:x.similarityScore}),genre:x.genre||inferGenre({name,url,type}),similarityScore:Number(x.similarityScore||0)};
      return isSuitableSimilarCandidate(candidate,null)?candidate:null;
    }).filter(Boolean),c=>domainOf(c.url)).slice(0,12);
    state.candidates=list;state.meta.lastDiscoveryUrl=channel.url;state.meta.lastDiscoveryAt=Date.now();saveState(false);renderCandidates();renderDiscoveryResults(list);
    if(list.length)status.textContent=`${list.length}件の候補。広告・PRを除外し、Safari取り込み時の情報だけで表示しています。`;
    else{status.textContent='ページ内に信頼できる関連候補がありません。';renderWebSimilarFallback(channel);}
    $('#runDiscoveryBtn').disabled=false;return;
  }
  try{
    const list=(await discoverChannels(channel.url,channel)).filter(c=>!state.channels.some(x=>normalizeUrl(x.url)===normalizeUrl(c.url)));
    state.candidates=list;state.meta.lastDiscoveryUrl=channel.url;state.meta.lastDiscoveryAt=Date.now();saveState(false);renderCandidates();renderDiscoveryResults(list);
    if(list.length)status.textContent=`${list.length}件の候補。広告・PRを除外し、関連性の高い候補だけ表示しています。`;
    else{status.textContent='ページ内に信頼できる関連候補がありません。';renderWebSimilarFallback(channel);}
  }catch(e){
    status.textContent='ページから関連候補を取得できませんでした。';renderWebSimilarFallback(channel,'元ページを直接解析できないため、Web検索から候補を探します。');
  }finally{$('#runDiscoveryBtn').disabled=false;}
}
function isHls(url){return /\.m3u8(?:$|[?#])/i.test(url||'');}
async function videoQualityInfo(item){
  if(!isHls(item.videoUrl))return {variants:[],message:'単一動画ファイル：画質変更不可（元の画質で保存・再生）'};
  const variants=MyMelterFeatures.parseMaster(await fetchText(item.videoUrl),item.videoUrl);
  return {variants,message:variants.length>1?'元配信が提供する画質を選べます。':'単一HLS画質：画質変更不可'};
}
async function openQualityPicker(item,index=null,save=false){
  if(!item?.videoUrl)return;pauseFeedForExternalAction();
  let d=$('#qualityDialog');if(!d){d=document.createElement('dialog');d.id='qualityDialog';d.className='sheet-dialog';d.innerHTML='<div class="sheet"><div class="sheet-head"><h2 data-quality-title></h2><button type="button" class="round-btn" data-quality-close>×</button></div><p data-quality-status></p><label class="field"><span>画質</span><select class="quality-select" data-quality-select></select></label><p data-quality-help></p><div class="button-row"><button class="primary" type="button" data-quality-start>続ける</button><button class="secondary" type="button" data-quality-close>閉じる</button></div></div>';document.body.appendChild(d);d.querySelectorAll('[data-quality-close]').forEach(b=>b.onclick=()=>d.close());d.addEventListener('close',()=>{d._saveAbort?.abort();d._request=null;});}
  const token={};d._request=token;const status=d.querySelector('[data-quality-status]'),select=d.querySelector('[data-quality-select]'),start=d.querySelector('[data-quality-start]');
  d.querySelector('[data-quality-title]').textContent=save?'端末保存の画質':'再生の画質';status.textContent='配信画質を確認中…';select.innerHTML='<option value="auto">自動（配信側に任せる）</option>';select.disabled=true;start.disabled=true;d.querySelector('[data-quality-help]').textContent='';if(!d.open)d.showModal();
  try{const info=await videoQualityInfo(item);if(d._request!==token||!d.open)return;status.textContent=info.message;
    const mse=!!window.Hls?.isSupported(),native=mse||!!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
    const choices=info.variants.filter(v=>!v.audio||(!save&&mse)); // HLS.js preserves separate audio when selecting a level.
    choices.forEach(v=>{const o=document.createElement('option');o.value=v.url;o.textContent=v.label+(v.bandwidth?' · '+Math.round(v.bandwidth/1000)+'kbps':'');select.appendChild(o);});
    const duration=Number(item.duration||feedSlide(index)?.querySelector('video')?.duration||0),light=MyMelterFeatures.recommended(choices,duration);
    let help=light?`重い動画のため ${light.label} を推奨します。`:'画質は元配信にあるものだけ表示します。';
    if(info.variants.some(v=>v.audio)&&(save||!mse))help+=' 別音声トラックの配信は音声を保つため自動再生のみ対応します。';
    if(isHls(item.videoUrl)&&!save&&!native)help+=' このブラウザは標準HLS再生に未対応です。SafariなどHLS対応ブラウザで開いてください。';
    if(save&&isHls(item.videoUrl)){select.options[0].textContent='最高画質';help+=' HLSは選択画質の分割動画とプレイリストをZIP保存します。MP4変換は行いません。最大300MB・2000分割。別音声・暗号化・ライブ配信は保存未対応です。';}
    d.querySelector('[data-quality-help]').textContent=help;select.disabled=info.variants.length<2||!choices.length;start.disabled=isHls(item.videoUrl)&&((!save&&!native)||(save&&info.variants.length>0&&!choices.length));
    start.textContent=save?'保存開始':'この画質で再生';
    start.onclick=async()=>{const selected=select.value==='auto'?(save?(choices[0]?.url||item.videoUrl):item.videoUrl):select.value;
      if(save){if(isHls(item.videoUrl)){start.disabled=true;try{d._saveAbort=new AbortController();await saveHlsBundle(selected,item,status,d._saveAbort.signal);if(d.open)d.close();}catch(e){status.textContent='保存できません：'+e.message;}finally{start.disabled=false;}}else{d.close();if(state.settings.shortcutEnabled){window.location.href=`shortcuts://run-shortcut?name=${encodeURIComponent(state.settings.shortcutName||'MyMelter保存')}&input=text&text=${encodeURIComponent(selected)}`;}else await openVideoSaveGate({...item,videoUrl:selected});}}
      else{const v=feedSlide(index)?.querySelector('video');if(v){releaseFeedVideoElement(v);const useMaster=isHls(item.videoUrl)&&mse;v.dataset.directSrc=useMaster?item.videoUrl:selected;if(useMaster&&selected!==item.videoUrl)v.dataset.qualityTarget=selected;else delete v.dataset.qualityTarget;const proxy=mediaProxyUrl(v.dataset.directSrc);if(proxy)v.dataset.proxySrc=proxy;else delete v.dataset.proxySrc;delete v.dataset.nativeLong;v.controls=false;feedSlide(index)?.classList.remove('system-long-video');activateFeedIndex(index,true);}d.close();}
    };
  }catch(e){if(d._request!==token)return;status.textContent='画質情報を取得できません：'+e.message;d.querySelector('[data-quality-help]').textContent='元の動画の画質・安全な保存仕様を維持します。';if(!save){start.disabled=false;start.textContent='元の画質で再生';start.onclick=()=>{d.close();activateFeedIndex(index,true);};}}
}
async function boundedMediaBytes(url,budget,signal){
  signal?.throwIfAborted();const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  const direct=MyMelterFeatures.safeUrl(url);if(!direct)throw Error('動画URLが不正です');
  let r;try{r=await fetch(direct,{credentials:'omit',signal:requestSignal});if(!r.ok)throw Error('HTTP '+r.status);}catch(e){signal?.throwIfAborted();const proxy=mediaProxyUrl(direct);if(!proxy)throw e;r=await fetch(proxy,{credentials:'omit',signal:requestSignal});}
  if(!r.ok)throw Error('HTTP '+r.status);if(Number(r.headers.get('Content-Length'))>budget)throw Error('300MBの保存上限を超えます');
  const reader=r.body.getReader(),chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>budget){await reader.cancel();throw Error('300MBの保存上限を超えます');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let pos=0;chunks.forEach(x=>{bytes.set(x,pos);pos+=x.length;});return bytes;
}
async function saveHlsBundle(url,item,status,signal){
  const plan=MyMelterFeatures.offlinePlaylist(await fetchText(url),url),entries=[{name:'playlist.m3u8',bytes:new TextEncoder().encode(plan.text)}];let size=entries[0].bytes.length;
  for(let i=0;i<plan.files.length;i++){status.textContent=`選択画質を保存中 ${i+1}/${plan.files.length}`;const f=plan.files[i],bytes=await boundedMediaBytes(f.url,300*1024*1024-size,signal);size+=bytes.length;entries.push({name:f.name,bytes});}
  entries.push({name:'README.txt',bytes:new TextEncoder().encode('ZIPを展開してplaylist.m3u8をHLS対応プレイヤーで開いてください。選択画質の動画です。MP4変換・再エンコードはしていません。')});
  signal?.throwIfAborted();const blob=MyMelterFeatures.zipStored(entries),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=(item.title||'MyMelter_video').replace(/[\\/:*?"<>|]/g,'_').slice(0,100)+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);toast('選択画質のHLS ZIP保存を開始しました');
}

