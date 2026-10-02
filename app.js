const APP_VERSION = '1.0.0-COMPLETE';
const STORE_KEY = 'mymelter-state-v2';
const OLD_STORE_KEY = 'mymelter-state-v1';

const defaultState = {
  channels: [],
  candidates: [],
  history: [],
  saved: [],
  settings: {
    fetchMode: 'auto',
    proxyUrl: '',
    proxyKey: '',
    shortcutEnabled: false,
    shortcutName: 'MyMelter保存'
  },
  meta: { lastDiscoveryUrl: '', lastDiscoveryAt: 0 }
};

let state = loadState();
let deferredInstallPrompt = null;
let activeChannel = null;
let activeItems = [];
let activeReaderMode = 'list';
let activeEditId = null;
let toastTimer = null;

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
        saved:Array.isArray(current.saved)?current.saved:[]
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
    id:c.id||uid(), name:c.name||domainOf(c.url)||'チャンネル', url:c.url||'', type:c.type||'mixed', color:c.color||colorForType(c.type||'mixed'),
    searchUrl:c.searchUrl||'', selectors:{item:'',title:'',image:'',link:'',video:'',...(c.selectors||{})},
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

function channelIconHTML(c){ return `<span class="channel-icon">${esc(typeGlyph(c.type))}</span>`; }
function renderHomeChannels(){
  const root=$('#homeChannels');
  if(!state.channels.length){
    root.innerHTML=`<div class="empty-card" style="grid-column:1/-1"><strong style="color:#334b68">まだチャンネルがありません。</strong><br>下の「チャンネルを追加」からサイトURLを貼ると、自動解析できます。</div>`;
    return;
  }
  root.innerHTML=state.channels.slice(0,8).map(c=>`
    <button class="channel-card ${esc(c.color||colorForType(c.type))}" data-open-channel="${esc(c.id)}">
      <span>${channelIconHTML(c)}<strong>${esc(c.name)}</strong><small>${esc(domainOf(c.url))}</small></span>
      <span class="meta">${esc(typeLabel(c.type))} · ${Number(c.itemCount||0)}件</span>
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
  if(item.image) return `<div class="${cls}"><img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<span class=placeholder>◇</span>'"><span class="media-badge">${esc(typeLabel(mediaKind(item)))}</span></div>`;
  return `<div class="${cls}"><span class="placeholder">${esc(typeGlyph(mediaKind(item)))}</span><span class="media-badge">${esc(typeLabel(mediaKind(item)))}</span></div>`;
}
function renderStrip(root, items, kind){
  if(!items.length){ root.innerHTML=`<div class="empty-card">${kind==='recent'?'まだ閲覧履歴がありません。':'まだ保存した項目がありません。'}</div>`; return; }
  root.innerHTML=items.slice(0,12).map((x,i)=>`<button class="media-card" data-${kind}-index="${i}">${thumbHTML(x)}<strong>${esc(x.title||'無題')}</strong><small>${esc(x.channelName||domainOf(x.url)||typeLabel(mediaKind(x)))}</small></button>`).join('');
}
function renderHome(){ renderHomeChannels(); renderCandidates(); renderStrip($('#recentStrip'),state.history,'recent'); renderStrip($('#savedStrip'),state.saved,'saved'); }

function renderChannelManager(){
  const q=$('#channelFilter').value.trim().toLowerCase(); const type=$('#channelTypeFilter').value;
  const list=state.channels.filter(c=>(type==='all'||c.type===type)&&(!q||`${c.name} ${c.url}`.toLowerCase().includes(q)));
  const root=$('#channelManager');
  if(!list.length){root.innerHTML=`<div class="empty-card">条件に一致するチャンネルがありません。</div>`;return;}
  root.innerHTML=list.map(c=>`
    <article class="manager-card">
      <span class="manager-icon" style="background:${colorCss(c.color)}">${esc(typeGlyph(c.type))}</span>
      <div class="manager-main"><strong>${esc(c.name)}</strong><small>${esc(typeLabel(c.type))} · ${esc(c.url)}</small></div>
      <div class="manager-actions"><button class="icon-action" data-open-channel="${esc(c.id)}">開く</button><button class="icon-action" data-edit-channel="${esc(c.id)}">編集</button></div>
    </article>`).join('');
}
function colorCss(color){ return ({blue:'linear-gradient(135deg,#1677ff,#57a5ff)',red:'linear-gradient(135deg,#ff525f,#ff8b91)',green:'linear-gradient(135deg,#21b77f,#63d7ae)',purple:'linear-gradient(135deg,#7456ed,#a68ffb)',gold:'linear-gradient(135deg,#eba91b,#ffd467)'})[color]||'linear-gradient(135deg,#1677ff,#57a5ff)'; }

function libraryItemHTML(x,index,kind){
  const thumb=x.image?`<img class="library-thumb" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="library-placeholder">${esc(typeGlyph(mediaKind(x)))}</span>`;
  return `<article class="library-item">${thumb}<div class="library-copy"><strong>${esc(x.title||'無題')}</strong><small>${esc(x.channelName||domainOf(x.url))} ${x.visitedAt?`· ${esc(fmtDate(x.visitedAt))}`:''}</small></div><div class="library-actions"><button class="icon-action" data-open-library="${kind}:${index}">開く</button>${kind==='saved'?`<button class="icon-action" data-remove-saved="${index}">削除</button>`:`<button class="icon-action" data-save-history="${index}">保存</button>`}</div></article>`;
}
function renderHistory(){ const root=$('#historyList'); root.innerHTML=state.history.length?state.history.map((x,i)=>libraryItemHTML(x,i,'history')).join(''):`<div class="empty-card">履歴はまだありません。</div>`; }
function renderSaved(){
  const q=$('#savedFilter').value.trim().toLowerCase(); const type=$('#savedTypeFilter').value;
  const filtered=state.saved.map((x,i)=>({...x,_index:i})).filter(x=>(type==='all'||mediaKind(x)===type)&&(!q||`${x.title} ${x.url}`.toLowerCase().includes(q)));
  $('#savedList').innerHTML=filtered.length?filtered.map(x=>libraryItemHTML(x,x._index,'saved')).join(''):`<div class="empty-card">保存済みはまだありません。</div>`;
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
  $('#channelId').value=c.id||''; $('#channelName').value=c.name||''; $('#channelUrl').value=c.url||''; $('#channelType').value=c.type||'mixed'; $('#channelColor').value=c.color||colorForType(c.type);
  $('#itemSelector').value=c.selectors?.item||''; $('#titleSelector').value=c.selectors?.title||''; $('#imageSelector').value=c.selectors?.image||''; $('#linkSelector').value=c.selectors?.link||''; $('#videoSelector').value=c.selectors?.video||''; $('#searchUrl').value=c.searchUrl||'';
  $('#deleteChannelBtn').hidden=!channel; $('#channelTestStatus').textContent='';
  $('#channelDialog').showModal();
}
function channelFromForm(){
  const url=normalizeUrl($('#channelUrl').value.trim());
  return normalizeChannel({
    id:activeEditId||uid(), name:$('#channelName').value.trim()||domainOf(url)||'チャンネル', url, type:$('#channelType').value, color:$('#channelColor').value, searchUrl:$('#searchUrl').value.trim(),
    selectors:{item:$('#itemSelector').value.trim(),title:$('#titleSelector').value.trim(),image:$('#imageSelector').value.trim(),link:$('#linkSelector').value.trim(),video:$('#videoSelector').value.trim()},
    createdAt:state.channels.find(x=>x.id===activeEditId)?.createdAt||Date.now()
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
async function fetchProxy(url){
  const base=state.settings.proxyUrl.trim().replace(/\/+$/,''); if(!base) throw new Error('Worker URLが未設定です');
  const u=new URL(base); u.searchParams.set('url',url); if(state.settings.proxyKey) u.searchParams.set('key',state.settings.proxyKey);
  const r=await fetch(u.href,{credentials:'omit'}); if(!r.ok) throw new Error(`Worker HTTP ${r.status}`); return await r.text();
}
async function fetchText(url){
  const mode=state.settings.fetchMode||'auto';
  if(mode==='direct') return fetchDirect(url);
  if(mode==='proxy') return fetchProxy(url);
  try{return await fetchDirect(url);}catch(directErr){ if(!state.settings.proxyUrl) throw new Error(`直接取得失敗: ${directErr.message}。設定で無料Workerを登録すると対応範囲が広がります。`); try{return await fetchProxy(url);}catch(proxyErr){throw new Error(`直接取得: ${directErr.message} / Worker: ${proxyErr.message}`);} }
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
    return {id:uid(),title,url:link,image,videoUrl,type:videoUrl?'video':image?'image':'article',channelId:channel.id,channelName:channel.name};
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
    return {id:uid(),title:title.replace(/\s+/g,' ').trim().slice(0,300),url:link,image,videoUrl,type,channelId:channel.id,channelName:channel.name};
  }).filter(x=>x.url&&x.title);
  return uniqueBy(items,x=>x.url).slice(0,160);
}
function parseChannelContent(text,channel,baseUrl){
  const xml=parseMaybeXml(text);
  if(xml){ if(xml.querySelector('rss, feed')) return parseFeed(xml,channel,baseUrl); if(xml.querySelector('urlset, sitemapindex')) return parseSitemap(xml,channel); }
  return parseHtml(text,channel,baseUrl);
}

function candidateFrom(url,name,type='mixed',extra={}){ return {id:uid(),url:normalizeUrl(url),name:name||domainOf(url),type,color:colorForType(type),selectors:{item:'',title:'',image:'',link:'',video:'',...(extra.selectors||{})},searchUrl:extra.searchUrl||'',source:extra.source||'auto'}; }
function guessTypeFromText(text='',url=''){ const s=`${text} ${url}`.toLowerCase(); if(/video|movie|動画|youtube|vimeo/.test(s))return'video'; if(/image|photo|gallery|写真|画像|pix/.test(s))return'image'; if(/blog|news|article|post|記事|ニュース/.test(s))return'article'; if(/rss|atom|feed/.test(s))return'feed'; return'mixed'; }

async function discoverChannels(url){
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

function renderDiscoveryResults(list){
  const root=$('#discoverResults');
  if(!list.length){root.innerHTML=`<div class="empty-card">追加候補を見つけられませんでした。手動追加はできます。</div>`;return;}
  root.innerHTML=`<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="mini-primary" data-add-all-candidates>まとめて追加</button></div>`+list.map(c=>`<article class="discover-result"><span class="result-icon">${esc(typeGlyph(c.type))}</span><div class="result-copy"><strong>${esc(c.name)}</strong><small>${esc(typeLabel(c.type))} · ${esc(c.url)}</small></div><button class="mini-primary" data-add-candidate="${esc(c.id)}">＋ 追加</button></article>`).join('');
}
async function runDiscovery(){
  const url=$('#discoverUrl').value.trim(); if(!normalizeUrl(url)){toast('URLを確認してください');return;}
  $('#discoverStatus').textContent='サイトを解析しています…'; $('#discoverResults').innerHTML=''; $('#runDiscoveryBtn').disabled=true;
  try{
    const list=await discoverChannels(url); state.candidates=list; state.meta.lastDiscoveryUrl=url; state.meta.lastDiscoveryAt=Date.now(); saveState(false); renderCandidates(); renderDiscoveryResults(list);
    $('#discoverStatus').textContent=`${list.length}件の候補を検出しました。`;
  }catch(e){ $('#discoverStatus').textContent=`解析できませんでした：${e.message}`; renderDiscoveryResults([]); }
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
    const text=await fetchText(url); let items=parseChannelContent(text,channel,url);
    if(keyword&&!channel.searchUrl){const q=keyword.toLowerCase();items=items.filter(x=>(x.title||'').toLowerCase().includes(q));}
    activeItems=items; channel.itemCount=items.length; channel.lastOpenedAt=Date.now(); channel.updatedAt=Date.now(); saveState(false); renderHomeChannels(); renderChannelManager();
    $('#readerStatus').textContent=items.length?`${items.length}件取得 · ${domainOf(url)}`:'項目を抽出できませんでした。高度な抽出設定を調整してください。';
    renderReader();
  }catch(e){ $('#readerStatus').textContent=`取得できませんでした：${e.message}`; $('#readerContent').innerHTML=`<div class="empty-card"><strong>取得エラー</strong><br>${esc(e.message)}<br><br><button class="primary" data-open-url="${esc(url)}">サイトを直接開く</button></div>`; }
}
function setReaderMode(mode,render=true){ activeReaderMode=mode; $$('#readerModeTabs button').forEach(b=>b.classList.toggle('active',b.dataset.readerMode===mode)); if(render)renderReader(); }
function renderReader(){
  const root=$('#readerContent'); if(!activeItems.length){root.innerHTML=`<div class="empty-card">表示できる項目がありません。</div>`;return;}
  if(activeReaderMode==='video'){
    const vids=activeItems.filter(x=>x.videoUrl||x.type==='video');
    root.innerHTML=vids.length?`<div class="empty-card"><strong>${vids.length}件の動画があります。</strong><br>「縦スワイプで再生」を押すと、上スワイプで次の動画へ移動できます。<br><br><button class="primary" id="launchVideoFeedBtn">縦スワイプで再生</button></div>`:`<div class="empty-card">この一覧から直接再生できる動画URLは見つかりませんでした。</div>`; return;
  }
  if(activeReaderMode==='media'){
    const media=activeItems.filter(x=>x.image||x.videoUrl);
    root.innerHTML=media.length?`<div class="media-grid">${media.map((x,i)=>gridItemHTML(x,activeItems.indexOf(x))).join('')}</div>`:`<div class="empty-card">画像・動画を検出できませんでした。</div>`;return;
  }
  root.innerHTML=`<div class="content-list">${activeItems.map((x,i)=>contentItemHTML(x,i)).join('')}</div>`;
}
function contentItemHTML(x,i){
  const th=x.image?`<img class="content-thumb" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="content-placeholder">${esc(typeGlyph(mediaKind(x)))}</span>`;
  return `<article class="content-card">${th}<div class="content-copy"><strong>${esc(x.title||'無題')}</strong><small>${esc(typeLabel(mediaKind(x)))} · ${esc(domainOf(x.url))}</small><div class="content-actions"><button class="open-btn" data-active-open="${i}">開く</button><button class="save-btn" data-active-save="${i}">♡ 保存済み</button>${x.videoUrl||x.image?`<button class="save-btn" data-active-quick-save="${i}">⇩ 端末保存</button>`:''}</div></div></article>`;
}
function gridItemHTML(x,i){
  const media=x.image?`<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:x.videoUrl?`<video src="${esc(x.videoUrl)}" muted playsinline preload="metadata"></video>`:`<div class="content-placeholder" style="width:100%;aspect-ratio:1/1">◇</div>`;
  return `<article class="grid-card">${media}<div class="grid-copy"><strong>${esc(x.title||'無題')}</strong><div class="grid-actions"><button data-active-open="${i}">開く</button><button data-active-save="${i}">保存</button><button data-active-quick-save="${i}">端末へ</button></div></div></article>`;
}
function recordHistory(item){ if(!item?.url)return; const entry={...item,visitedAt:Date.now()}; state.history=[entry,...state.history.filter(x=>x.url!==entry.url)].slice(0,500); saveState(); }
function saveItem(item){ if(!item?.url)return; state.saved=[{...item,savedAt:Date.now()},...state.saved.filter(x=>x.url!==item.url)].slice(0,500); saveState(); toast('保存済みに追加しました'); }
function openItem(item){ if(!item?.url)return; recordHistory(item); window.open(item.url,'_blank','noopener'); }

async function quickSave(item){
  const target=item.videoUrl||item.image||item.url; if(!target)return;
  if(state.settings.shortcutEnabled){
    const name=state.settings.shortcutName||'MyMelter保存'; const u=`shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(target)}`;
    toast('保存ショートカットを起動します'); window.location.href=u; return;
  }
  try{
    if(navigator.share){ await navigator.share({title:item.title||'MyMelter',url:target}); return; }
  }catch(e){ if(e?.name==='AbortError')return; }
  const a=document.createElement('a');a.href=target;a.target='_blank';a.rel='noopener';a.download='';a.click(); toast('メディアを開きました。iPhoneでは共有から保存できます');
}

function openVideoFeed(){
  const vids=activeItems.filter(x=>x.videoUrl||x.type==='video'); if(!vids.length){toast('直接再生できる動画がありません');return;}
  $('#videoFeedTitle').textContent=activeChannel?.name||'動画';
  $('#videoFeed').innerHTML=vids.map((x,i)=>videoSlideHTML(x,i)).join(''); $('#videoFeedDialog').showModal();
  setupVideoAutoplay();
}
function videoSlideHTML(x,i){
  const src=x.videoUrl||''; const poster=x.image||'';
  const media=src?`<video src="${esc(src)}" ${poster?`poster="${esc(poster)}"`:''} controls playsinline muted loop preload="metadata"></video>`:`<div class="video-fallback"><div><strong>この動画はページ側で再生します</strong><br><br><button class="primary" data-feed-open="${i}">元ページを開く</button></div></div>`;
  return `<section class="video-slide" data-feed-index="${i}">${media}<div class="video-overlay"><strong>${esc(x.title||'動画')}</strong><small>${esc(x.channelName||domainOf(x.url))}</small></div><div class="video-actions"><button class="video-action" data-feed-quick-save="${i}"><span class="circle">⇩</span><span>写真に保存</span></button><button class="video-action" data-feed-save="${i}"><span class="circle">♡</span><span>保存済み</span></button><button class="video-action" data-feed-open="${i}"><span class="circle">↗</span><span>元ページ</span></button></div><div class="swipe-hint">⌃ 上にスワイプして次の動画</div></section>`;
}
function setupVideoAutoplay(){
  const videos=$$('#videoFeed video'); const obs=new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target;if(e.isIntersecting&&e.intersectionRatio>.72){v.play().catch(()=>{});}else{v.pause();}}),{root:$('#videoFeed'),threshold:[.72]}); videos.forEach(v=>obs.observe(v));
}

function openSearchResults(q){
  const needle=q.trim().toLowerCase(); if(!needle)return;
  const channels=state.channels.filter(c=>`${c.name} ${c.url}`.toLowerCase().includes(needle)).slice(0,20);
  const items=uniqueBy([...state.history,...state.saved],x=>x.url).filter(x=>`${x.title||''} ${x.url||''}`.toLowerCase().includes(needle)).slice(0,30);
  const candidates=state.candidates.filter(c=>`${c.name} ${c.url}`.toLowerCase().includes(needle)).slice(0,15);
  const section=(title,arr,fn)=>arr.length?`<section class="search-section"><h3>${title}</h3>${arr.map(fn).join('')}</section>`:'';
  $('#searchResults').innerHTML=section('チャンネル',channels,c=>`<button class="search-hit" data-open-channel="${esc(c.id)}"><span class="mini-icon">${esc(typeGlyph(c.type))}</span><span class="hit-main"><strong>${esc(c.name)}</strong><small>${esc(c.url)}</small></span></button>`)+section('履歴・保存済み',items,x=>`<button class="search-hit" data-open-url="${esc(x.url)}"><span class="mini-icon">${esc(typeGlyph(mediaKind(x)))}</span><span class="hit-main"><strong>${esc(x.title||'無題')}</strong><small>${esc(x.url)}</small></span></button>`)+section('自動検出候補',candidates,c=>`<button class="search-hit" data-add-candidate="${esc(c.id)}"><span class="mini-icon">＋</span><span class="hit-main"><strong>${esc(c.name)}</strong><small>${esc(c.url)}</small></span></button>`)||`<div class="empty-card">「${esc(q)}」に一致するデータはありません。</div>`;
  $('#searchDialog').showModal();
}

function exportState(){
  const payload={app:'MyMelter',version:APP_VERSION,exportedAt:new Date().toISOString(),state}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`MyMelter_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importState(file){
  const data=JSON.parse(await file.text()); const incoming=data.state||data; state={...clone(defaultState),...incoming,settings:{...defaultState.settings,...(incoming.settings||{})},meta:{...defaultState.meta,...(incoming.meta||{})}}; state.channels=(state.channels||[]).map(normalizeChannel); state.candidates=state.candidates||[];state.history=state.history||[];state.saved=state.saved||incoming.favorites||[];saveState();
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
$('#channelFilter').oninput=renderChannelManager; $('#channelTypeFilter').onchange=renderChannelManager; $('#savedFilter').oninput=renderSaved; $('#savedTypeFilter').onchange=renderSaved;
$('#clearHistoryBtn').onclick=()=>{if(confirm('閲覧履歴をすべて消去しますか？')){state.history=[];saveState();}};

// Reader
$('#readerCloseBtn').onclick=()=>$('#readerDialog').close();
$('#readerEditBtn').onclick=()=>{if(activeChannel){$('#readerDialog').close();openChannelEditor(activeChannel);}};
$$('#readerModeTabs button').forEach(b=>b.onclick=()=>setReaderMode(b.dataset.readerMode));
$('#readerSearchBtn').onclick=()=>activeChannel&&openChannel(activeChannel,$('#readerSearch').value.trim());
$('#readerSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#readerSearchBtn').click();}});
$('#videoFeedClose').onclick=()=>{$$('#videoFeed video').forEach(v=>v.pause());$('#videoFeedDialog').close();};

// Global search
$('#globalSearch').addEventListener('input',e=>$('#clearGlobalSearch').hidden=!e.target.value);
$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openSearchResults(e.target.value);}});
$('#clearGlobalSearch').onclick=()=>{$('#globalSearch').value='';$('#clearGlobalSearch').hidden=true;}; $('#searchCloseBtn').onclick=()=>$('#searchDialog').close();

// Settings
$('#fetchMode').onchange=e=>{state.settings.fetchMode=e.target.value;saveState(false);};
$('#proxyUrl').onchange=e=>{state.settings.proxyUrl=e.target.value.trim();saveState(false);};
$('#proxyKey').onchange=e=>{state.settings.proxyKey=e.target.value;saveState(false);};
$('#shortcutEnabled').onchange=e=>{state.settings.shortcutEnabled=e.target.checked;saveState(false);};
$('#shortcutName').onchange=e=>{state.settings.shortcutName=e.target.value.trim()||'MyMelter保存';saveState(false);};
$('#exportBtn').onclick=exportState; $('#importInput').onchange=async e=>{if(!e.target.files?.[0])return;try{await importState(e.target.files[0]);toast('バックアップを読み込みました');}catch{toast('バックアップを読み込めませんでした');}e.target.value='';};

// PWA install
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').hidden=false;});
$('#installBtn').onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt=null;$('#installBtn').hidden=true;}else{toast('iPhoneはSafari共有 →「ホーム画面に追加」');}};

// Delegated events
document.addEventListener('click',async e=>{
  const openCh=e.target.closest('[data-open-channel]'); if(openCh){const c=state.channels.find(x=>x.id===openCh.dataset.openChannel);if(c){$('#searchDialog').open&&$('#searchDialog').close();openChannel(c);}return;}
  const editCh=e.target.closest('[data-edit-channel]'); if(editCh){const c=state.channels.find(x=>x.id===editCh.dataset.editChannel);if(c)openChannelEditor(c);return;}
  const addC=e.target.closest('[data-add-candidate]'); if(addC){addCandidate(addC.dataset.addCandidate);return;}
  const addAll=e.target.closest('[data-add-all-candidates]'); if(addAll){addAllCandidates();return;}
  const prevC=e.target.closest('[data-preview-candidate]'); if(prevC){const c=state.candidates.find(x=>x.id===prevC.dataset.previewCandidate);if(c)openChannel(normalizeChannel(c));return;}
  const activeOpen=e.target.closest('[data-active-open]'); if(activeOpen){openItem(activeItems[Number(activeOpen.dataset.activeOpen)]);return;}
  const activeSave=e.target.closest('[data-active-save]'); if(activeSave){saveItem(activeItems[Number(activeSave.dataset.activeSave)]);return;}
  const activeQuick=e.target.closest('[data-active-quick-save]'); if(activeQuick){await quickSave(activeItems[Number(activeQuick.dataset.activeQuickSave)]);return;}
  const launch=e.target.closest('#launchVideoFeedBtn'); if(launch){openVideoFeed();return;}
  const feedSlide=e.target.closest('[data-feed-index]');
  const feedQuick=e.target.closest('[data-feed-quick-save]'); if(feedQuick&&feedSlide){const vids=activeItems.filter(x=>x.videoUrl||x.type==='video');await quickSave(vids[Number(feedQuick.dataset.feedQuickSave)]);return;}
  const feedSave=e.target.closest('[data-feed-save]'); if(feedSave&&feedSlide){const vids=activeItems.filter(x=>x.videoUrl||x.type==='video');saveItem(vids[Number(feedSave.dataset.feedSave)]);return;}
  const feedOpen=e.target.closest('[data-feed-open]'); if(feedOpen){const vids=activeItems.filter(x=>x.videoUrl||x.type==='video');openItem(vids[Number(feedOpen.dataset.feedOpen)]);return;}
  const lib=e.target.closest('[data-open-library]'); if(lib){const [kind,idxStr]=lib.dataset.openLibrary.split(':');const arr=kind==='saved'?state.saved:state.history;openItem(arr[Number(idxStr)]);return;}
  const rem=e.target.closest('[data-remove-saved]'); if(rem){state.saved.splice(Number(rem.dataset.removeSaved),1);saveState();return;}
  const saveH=e.target.closest('[data-save-history]'); if(saveH){saveItem(state.history[Number(saveH.dataset.saveHistory)]);return;}
  const recent=e.target.closest('[data-recent-index]'); if(recent){openItem(state.history[Number(recent.dataset.recentIndex)]);return;}
  const saved=e.target.closest('[data-saved-index]'); if(saved){openItem(state.saved[Number(saved.dataset.savedIndex)]);return;}
  const url=e.target.closest('[data-open-url]'); if(url){const target=url.dataset.openUrl;if(target){recordHistory({title:target,url:target,type:'article'});window.open(target,'_blank','noopener');}return;}
});

// Initial launch
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW',e));}
renderAll();
