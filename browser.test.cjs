// Run with Playwright installed, or NODE_PATH pointing at the desktop runtime packages.
const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const FIXTURES={
  videoRanking:fs.readFileSync(__dirname+'/fixtures/video-ranking.html','utf8'),
  articleThread:fs.readFileSync(__dirname+'/fixtures/article-thread.html','utf8'),
  articleStandard:fs.readFileSync(__dirname+'/fixtures/article-standard.html','utf8'),
  imageGallery:fs.readFileSync(__dirname+'/fixtures/image-gallery.html','utf8'),
  mixed:fs.readFileSync(__dirname+'/fixtures/mixed.html','utf8')
};
(async()=>{const server=http.createServer((req,res)=>{let path=new URL(req.url,'http://localhost').pathname;if(path==='/')path='/index.html';try{const b=fs.readFileSync(__dirname+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.png')?'image/png':'text/html');res.end(b);}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({headless:true,...(process.env.MYMELTER_BROWSER_CHANNEL?{channel:process.env.MYMELTER_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('mymelter-state-v2',JSON.stringify({channels:[{id:'a',name:'動画サイト',type:'video',url:'https://video.example/',createdAt:123,custom:'keep'},{id:'b',name:'技術ブログ',type:'article',url:'https://tech.example/',genre:'ブログ'}],saved:[{url:'https://saved.example/',title:'保存'}],settings:{proxyUrl:'',proxyKey:'keep-key'}})));
await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>navigate('channels'));
const emptyChannelKind=await page.evaluate(()=>({
  explicit:normalizeChannel({id:'empty-explicit',name:'動画サイト',url:'https://empty.example/',type:'video'}).type,
  auto:normalizeChannel({id:'empty-mixed',name:'空のサイト',url:'https://empty.example/',type:'mixed'}).type
}));
assert.equal(emptyChannelKind.explicit,'video');assert.equal(emptyChannelKind.auto,'mixed');
assert.equal(await page.locator('.manager-card').count(),2);assert.equal(await page.locator('#channelGenreFilters button').count(),12);
await page.locator('[data-genre-filter="動画"]').click();assert.equal(await page.locator('.manager-card').count(),1);
await page.locator('[data-edit-channel="a"]').click();
const originButton=await page.evaluate(()=>{let opened='';const oldOpen=window.open;window.open=u=>{opened=u;return {};};const b=document.querySelector('#openChannelOriginBtn');const disabled=b.disabled;b.click();window.open=oldOpen;return {opened,disabled};});assert.equal(originButton.disabled,false);assert.equal(originButton.opened,'https://video.example/');
await page.locator('#channelGenre').selectOption('ゲーム');await page.evaluate(()=>saveChannelFromForm());
const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('mymelter-state-v2')));assert.equal(stored.channels[0].genre,'ゲーム');assert.equal(stored.channels[0].custom,'keep');assert.equal(stored.channels[0].createdAt,123);assert.equal(stored.saved.length,1);assert.equal(stored.settings.proxyKey,'keep-key');
const candidates=await page.evaluate(()=>externalSiteCandidates(new DOMParser().parseFromString('<div>関連サイト<a href="https://another.example/"><img src="/thumb.jpg">ゲーム動画</a><a href="https://another.example/x">ゲーム</a><a href="https://ads.example/">【PR】おすすめ広告</a><a href="javascript:alert(1)">ゲーム</a><a href="https://video.example/">動画</a><a href="https://x.example/">ログイン</a></div>','text/html'),'https://video.example/',state.channels[0]));assert.equal(candidates.length,1);assert.equal(candidates[0].url,'https://another.example/');assert.equal(candidates[0].image,'https://video.example/thumb.jpg');
const twidlBookmarklet=await page.evaluate(()=>{
  const code=buildBrowserImportBookmarkletAdvanced();
  return {parser:code.includes('parseTwiDl'),path:code.includes('v\\\\.php'),detail:code.includes('hydrateTwiDl'),source:code.includes('video\\\\.twimg\\\\.com'),valid:!!new Function(code.slice('javascript:'.length))};
});assert.equal(twidlBookmarklet.parser,true);assert.equal(twidlBookmarklet.detail,true);assert.equal(twidlBookmarklet.valid,true);
const directGalleryRegression=await page.evaluate(async()=>{
 const ch={id:'video-direct-test',name:'Video',url:'https://www.twi-dl.net/hozon.php',type:'video',deepDiveItems:[]};
 activeChannel=ch;
 activeItems=[
  {id:'a',type:'video',url:'https://www.twi-dl.net/v.php?video=111111111111111',image:'https://cdn.example/a.jpg',videoUrl:'https://cdn.example/a.mp4',alternateVideoUrl:'https://cdn.example/a.m3u8'},
  {id:'b',type:'video',url:'https://www.twi-dl.net/v.php?video=222222222222222',image:'https://cdn.example/b.jpg',videoUrl:''}
 ];
 activeReaderMode='video';renderReader();
 let openCount=0,lastIndex=-1,length=0;
 const original=openVideoFeedItems;
 openVideoFeedItems=(items,title,start)=>{openCount++;lastIndex=start;length=items.length};
 const first=document.querySelector('[data-video-gallery-open="0"]'),second=document.querySelector('[data-video-gallery-open="1"]');
 first.click();second.click();
 await new Promise(r=>setTimeout(r,20));
 openVideoFeedItems=original;
 const hasReviewControl=!!document.querySelector('[data-video-detail]'),dialog=document.getElementById('videoEvidenceDialog');
 const alt=videoSlideHTML(activeItems[0],0);
 const missing=videoSlideHTML(activeItems[1],1);
 return {openCount,lastIndex,length,hasReviewControl,dialogOpen:!!dialog?.open,alt:alt.includes('data-alternate-src="https://cdn.example/a.m3u8"'),fallback:missing.includes('直接再生URLは未取得'),noMediaThumb:!!second.querySelector('img')};
});
assert.deepEqual(directGalleryRegression,{openCount:2,lastIndex:1,length:2,hasReviewControl:false,dialogOpen:false,alt:true,fallback:true,noMediaThumb:true});

const twidlLinkOnly=await page.evaluate(async()=>{
  const item={id:'twi-link',title:'Twitter動画',url:'https://www.twi-dl.net/v.php?video=123456789012345',videoUrl:'',type:'video',image:'https://pbs.twimg.com/example.jpg'};
  activeItems=[item];activeChannel={name:'Twitter動画保管庫',deepDiveItems:[]};
  const root=document.getElementById('readerContent');activeReaderMode='video';renderReader();
  const card=root.querySelector('[data-video-gallery-open]');
  const original=openVideoFeedItems;let launched=false,chosen=[];
  openVideoFeedItems=(items)=>{launched=true;chosen=items};
  card.click();await new Promise(r=>setTimeout(r,5));openVideoFeedItems=original;
  const fallback=videoSlideHTML(item,0);
  return {card:!!card,launched,count:chosen.length,thumb:!!card.querySelector('img'),hasExtraDialog:!!root.querySelector('[data-video-detail]'),fallback: fallback.includes('元ページで再生する')&&fallback.includes('直接再生URLは未取得')};
});assert.deepEqual(twidlLinkOnly,{card:true,launched:true,count:1,thumb:true,hasExtraDialog:false,fallback:true});
const quickImportV28=await page.evaluate(async()=>{
 const code=buildBrowserImportBookmarklet();
 const run=async(html,url,mode='success')=>{
  const doc=new DOMParser().parseFromString(html,'text/html'),loc=new URL(url);
  let alerted='',count=0;
  const fakeFetch=async u=>{
    count++;
    if(mode==='blocked')throw Error('HTTP 403');
    const body=String(u).includes('111111111111111')
      ?'<html><body><video><source src="https://video.twimg.com/fixture/a.mp4"></video></body></html>'
      :'<html><head><meta property="og:video:url" content="https://cdn.example/test/b.m3u8"></head></html>';
    return {ok:true,headers:{get:()=>''},text:async()=>body};
  };
  const evalFn=new Function('document','location','alert','fetch','return '+code.slice('javascript:'.length));
  evalFn(doc,loc,x=>alerted=String(x),fakeFetch);
  const early=!!doc.querySelector('#mymelter-import-status');
  await new Promise(resolve=>setTimeout(resolve,500));
  const hash=loc.hash||'',encoded=hash.startsWith('#mmimport=')?hash.slice('#mmimport='.length):'';
  const payload=encoded?JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(encoded)),c=>c.charCodeAt(0)))):null;
  return {alerted,early,status:doc.querySelector('#mymelter-import-status')?.textContent||'',payload,count};
 };
 const fixture='<html><head><title>Twitter動画保管庫</title></head><body><main>'+
  '<div class="tile"><a href="/v.php?video=111111111111111"><img data-src="/poster1.jpg" alt="動画1"></a></div>'+
  '<div class="tile"><a href="/watch/second"><img src="/poster2.jpg" alt="動画2"></a></div>'+
  '<div class="advertisement"><a href="/watch/ad"><img src="/advert.jpg" alt="広告"></a></div>'+
  '</main></body></html>';
 const success=await run(fixture,'https://www.twi-dl.net/hozon.php');
 const blocked=await run(fixture,'https://www.twi-dl.net/hozon.php','blocked');
 const none=await run('<html><body><main><h1>リンクなし</h1></main></body></html>','https://empty.example/');
 return {size:code.length,success,blocked,none};
});
assert.ok(quickImportV28.size<14000);
assert.equal(quickImportV28.success.early,true);
assert.equal(quickImportV28.success.alerted,'');
assert.equal(quickImportV28.success.payload.v,28);
assert.equal(quickImportV28.success.payload.i.length,2);
assert.deepEqual(quickImportV28.success.payload.i.map(x=>x.u),[
 'https://www.twi-dl.net/v.php?video=111111111111111',
 'https://www.twi-dl.net/watch/second'
]);
assert.deepEqual(quickImportV28.success.payload.i.map(x=>x.m),[
 'https://video.twimg.com/fixture/a.mp4','https://cdn.example/test/b.m3u8'
]);
assert.deepEqual(quickImportV28.success.payload.h,{total:2,ok:2,failed:0,pages:1,imported:2});
assert.equal(quickImportV28.success.count,2);
assert.equal(quickImportV28.blocked.payload.h.ok,0);
assert.equal(quickImportV28.blocked.payload.h.failed,2);
assert.equal(quickImportV28.blocked.payload.i.length,2);
assert.ok(quickImportV28.blocked.payload.i.every(x=>x.y==='video'&&!x.m));
assert.equal(quickImportV28.none.early,true);
assert.match(quickImportV28.none.alerted,/起動しました/);

const paginatedImportV28=await page.evaluate(async()=>{
 const code=buildBrowserImportBookmarklet();
 const cards=(from,to)=>Array.from({length:to-from},(_,i)=>{
  const id=String(100000000000000+from+i);
  return '<div class="video-card"><a href="/v.php?video='+id+'"><img src="/pic/'+id+'.jpg" alt="Video '+id+'"></a></div>'
 }).join('');
 const pageHTML=(num)=>'<html><body><main>'+cards((num-1)*30,num*30)+(num<4?'<a href="/hozon.php?p='+(num+1)+'">次のページへ</a>':'')+'</main></body></html>';
 const loc=new URL('https://www.twi-dl.net/hozon.php'),doc=new DOMParser().parseFromString(pageHTML(1),'text/html');
 let detailCalls=0,pageCalls=0;
 const fetchMock=async url=>{
  const u=new URL(url);
  let body='';
  if(u.pathname==='/hozon.php'){pageCalls++;body=pageHTML(Number(u.searchParams.get('p')));}
  else{
   detailCalls++;body='<html><body><video><source src="https://video.twimg.com/test/'+u.searchParams.get('video')+'.m3u8"></video><a href="https://video.twimg.com/test/'+u.searchParams.get('video')+'.mp4">ダウンロード</a></body></html>';
  }
  return {ok:true,headers:{get:()=>null},text:async()=>body};
 };
 const fn=new Function('document','location','alert','fetch','return '+code.slice('javascript:'.length));
 let err='';fn(doc,loc,msg=>err=String(msg),fetchMock);
 for(let i=0;i<35&&!loc.hash.startsWith('#mmimport=');i++)await new Promise(r=>setTimeout(r,50));
 const hash=loc.hash||'',encoded=hash.startsWith('#mmimport=')?hash.slice('#mmimport='.length):'';
 const p=encoded?JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(encoded)),x=>x.charCodeAt(0)))):null;
 return {err,pageCalls,detailCalls,version:p?.v,items:p?.i?.length,stats:p?.h,first:p?.i?.[0],last:p?.i?.at(-1)};
});
assert.equal(paginatedImportV28.err,'');
assert.equal(paginatedImportV28.version,28);
assert.equal(paginatedImportV28.pageCalls,3);
assert.equal(paginatedImportV28.detailCalls,40);
assert.equal(paginatedImportV28.items,120);
assert.deepEqual(paginatedImportV28.stats,{total:40,ok:40,failed:0,pages:4,imported:120});
assert.ok(paginatedImportV28.first.m.endsWith('.mp4'));
assert.ok(paginatedImportV28.first.m2.endsWith('.m3u8'));
assert.ok(paginatedImportV28.last.u.includes('100000000000119'));

const twidlSynthetic=await page.evaluate(async()=>{
  const html='<html><head><title>Twitter動画保管庫</title></head><body><div class="listing">'+
    '<div class="tile"><a href="/v.php?video=1234567890123456789"><img data-src="/a.jpg" alt="動画A"></a></div>'+
    '<div class="tile" onclick="location.href=&quot;/v.php?video=2345678901234567890&quot;"><img data-src="/b.jpg" alt="動画B"></div>'+
    '<a href="https://ads.example/pr"><img src="/advert.jpg" alt="広告"></a>'+
    '</div></body></html>';
  const doc=new DOMParser().parseFromString(html,'text/html'),loc=new URL('https://www.twi-dl.net/hozon.php');
  const script=buildBrowserImportBookmarkletAdvanced().slice('javascript:'.length);
  const run=new Function('document','location','alert','fetch','return '+script);
  let error='';
  await run(doc,loc,t=>{error=String(t)},async u=>({ok:true,text:async()=>String(u).includes('1234567890123456789')?'<video><source src="https://video.twimg.com/demo/a.mp4"></video>':'<div>元データなし</div>'}));
  if(!loc.hash.startsWith('#mmimport='))return {error,items:[]};
  const packed=loc.hash.slice('#mmimport='.length),bytes=Uint8Array.from(atob(decodeURIComponent(packed)),c=>c.charCodeAt(0));
  const data=JSON.parse(new TextDecoder().decode(bytes));
  return {error,items:data.i.map(x=>({url:x.u,image:x.i,media:x.m,kind:x.y}))};
});
assert.equal(twidlSynthetic.error,'');
assert.equal(twidlSynthetic.items.length,2);
assert.deepEqual(twidlSynthetic.items.map(x=>x.url),[
  'https://www.twi-dl.net/v.php?video=1234567890123456789',
  'https://www.twi-dl.net/v.php?video=2345678901234567890']);
assert.deepEqual(twidlSynthetic.items.map(x=>x.kind),['video','video']);
assert.deepEqual(twidlSynthetic.items.map(x=>x.image),['https://www.twi-dl.net/a.jpg','https://www.twi-dl.net/b.jpg']);
assert.equal(twidlSynthetic.items[0].media,'https://video.twimg.com/demo/a.mp4');
assert.equal(twidlSynthetic.items[1].media,'');


const twidlVariant=await page.evaluate(async()=>{
 const html='<html><head><title>Twitter動画保管庫</title></head><body><main>'+
  '<figure class="media-tile"><a href="/watch/clip-alpha"><img data-src="/alpha.jpg" alt="Video alpha"></a></figure>'+
  '<div class="media-tile" data-href="/v.php?video=77777777777777"><img data-original="/beta.jpg" alt="Video beta"></div>'+
  '<div class="advertisement"><a href="/watch/promoted"><img src="/ad.jpg" alt="広告"></a></div>'+
  '<a href="/?p=1">次のページへ</a></main></body></html>';
 const doc=new DOMParser().parseFromString(html,'text/html'),loc=new URL('https://www.twi-dl.net/hozon.php');
 const runner=new Function('document','location','alert','fetch','return '+buildBrowserImportBookmarkletAdvanced().slice('javascript:'.length));
 let error='';
 await runner(doc,loc,msg=>error=String(msg),async u=>({ok:true,text:async()=>String(u).includes('clip-alpha')?
  '<html><head><meta property="og:video:url" content="https://cdn.example/clip-alpha.mp4"></head></html>':
  String(u).includes('77777777777777')?'<html><body><video poster="/beta-poster.jpg"><source src="https://video.twimg.com/video/beta.mp4"></video></body></html>':'<html><body></body></html>'}));
 const packed=loc.hash.startsWith('#mmimport=')?loc.hash.slice('#mmimport='.length):'';
 if(!packed)return {error,items:[]};
 const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(packed)),c=>c.charCodeAt(0))));
 return {error,items:data.i.map(x=>({url:x.u,media:x.m,image:x.i,type:x.y})),next:data.d.map(x=>x.u)};
});
assert.equal(twidlVariant.error,'');
assert.equal(twidlVariant.items.length,2);
assert.deepEqual(twidlVariant.items.map(x=>x.url),['https://www.twi-dl.net/watch/clip-alpha','https://www.twi-dl.net/v.php?video=77777777777777']);
assert.deepEqual(twidlVariant.items.map(x=>x.media),['https://cdn.example/clip-alpha.mp4','https://video.twimg.com/video/beta.mp4']);
assert.deepEqual(twidlVariant.items.map(x=>x.type),['video','video']);
const detailResolution=await page.evaluate(async()=>{
 const pure=extractVideoDetail('<html><head><meta property="og:video:url" content="https://cdn.example/one.m3u8"><meta property="og:image" content="/cover.jpg"></head></html>','https://source.example/watch/1');
 const invalid=extractVideoDetail('<html><body><img src="/poster.jpg"><p>No source available</p></body></html>','https://source.example/watch/2');
 const original=fetchVideoDetailMarkup,oldFeed=openVideoFeedItems;
 let opened=0;openVideoFeedItems=()=>{opened++};
 let answer=()=>'<html><body><video><source src="https://cdn.example/playable.mp4"></video></body></html>';
 fetchVideoDetailMarkup=async()=>answer();
 activeChannel={id:'detail-fixture',name:'Site',deepDiveItems:[]};
 const item={id:'check-video',type:'video',title:'Sample',url:'https://source.example/watch/2',image:'https://source.example/cover.jpg',videoUrl:''};
 activeItems=[item];activeReaderMode='video';renderReader();
 const cardBefore=document.querySelector('.video-gallery-card'),initialPoster=cardBefore.querySelector('img')?.src;
 await checkVideoCandidate(item,null);
 const d=ensureVideoEvidenceDialog();
 const success={open:d.open,poster:d.querySelector('[data-evidence-poster]').src,originalCard:!!document.querySelector('.video-gallery-card'),firstCard:cardBefore.isConnected,playVisible:!d.querySelector('[data-evidence-play]').hidden,openedBeforeTap:opened,status:d.querySelector('[data-evidence-status]').textContent};
 d.querySelector('[data-evidence-play]').click();
 const openedAfterTap=opened;
 item.videoUrl='';answer=()=>'<html><body><img src="/poster.jpg"></body></html>';
 await checkVideoCandidate(item,null,true);
 const missing={open:d.open,status:d.querySelector('[data-evidence-status]').textContent,poster:d.querySelector('[data-evidence-poster]').src,playHidden:d.querySelector('[data-evidence-play]').hidden,cardPresent:!!document.querySelector('.video-gallery-card')};
 d.querySelector('[data-evidence-close]').click();
 item.videoUrl='';
 fetchVideoDetailMarkup=async()=>{throw new Error('HTTP 403')};
 await checkVideoCandidate(item,null,true);
 const blocked={status:d.querySelector('[data-evidence-status]').textContent,playHidden:d.querySelector('[data-evidence-play]').hidden};
 d.close();fetchVideoDetailMarkup=original;openVideoFeedItems=oldFeed;
 return {pure,invalid,media:success.status,success,missing,blocked,initialPoster,openedAfterTap};
});
assert.equal(detailResolution.pure.videoUrl,'https://cdn.example/one.m3u8');
assert.equal(detailResolution.pure.image,'https://source.example/cover.jpg');
assert.equal(detailResolution.invalid.videoUrl,'');
assert.equal(detailResolution.success.open,true);
assert.equal(detailResolution.success.poster,detailResolution.initialPoster);
assert.equal(detailResolution.success.originalCard,true);
assert.equal(detailResolution.success.firstCard,true);
assert.equal(detailResolution.success.playVisible,true);
assert.equal(detailResolution.success.openedBeforeTap,0);
assert.equal(detailResolution.openedAfterTap,1);
assert.equal(detailResolution.missing.playHidden,true);
assert.equal(detailResolution.missing.cardPresent,true);
assert.match(detailResolution.missing.status,/見つかりません/);
assert.equal(detailResolution.missing.poster,detailResolution.initialPoster);
assert.equal(detailResolution.blocked.playHidden,true);
assert.match(detailResolution.blocked.status,/制限/);
const oldTwiImage=await page.evaluate(()=>{
 const item={url:'https://www.twi-dl.net/v.php?video=123456789012345',image:'https://pbs.twimg.com/poster.jpg',type:'image',id:'old-img'};
 const kind=mediaKind(item),profile=contentProfile([item]).mode;
 const parsed=browserChannelItems({snapshotItems:[item]});
 return {kind,profile,mapped:parsed[0].type};
});
assert.deepEqual(oldTwiImage,{kind:'video',profile:'video',mapped:'video'});

const generalImport=await page.evaluate(async()=>{
  const run=async(html,url)=>{
    const doc=new DOMParser().parseFromString(html,'text/html'),loc=new URL(url);
    const script=buildBrowserImportBookmarkletAdvanced().slice('javascript:'.length);
    const execute=new Function('document','location','alert','fetch','return '+script);
    let error='';await execute(doc,loc,m=>error=String(m),async()=>({ok:false}));
    if(!loc.hash.startsWith('#mmimport='))return {error,items:[]};
    const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(loc.hash.slice(10))),c=>c.charCodeAt(0))));
    return {error,items:[...data.i,...data.d].map(x=>({url:x.u,image:x.i,video:x.m,type:x.y,title:x.t}))};
  };
  const videoCard=await run('<html><head><title>Clips</title></head><body><main><div class="video-card"><a href="/watch/episode-7"><img data-src="/poster.jpg" alt="Episode 7">Watch Episode 7</a></div></main></body></html>','https://clips.example/');
  const lazyGallery=await run('<html><body><section class="gallery"><figure><img data-src="/photo1.jpg" alt="Photo A" width="640" height="480"></figure><figure><picture><source srcset="/photo2.webp 2x"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Photo B" width="640" height="480"></picture></figure></section></body></html>','https://gallery.example/');
  const htmlVideo=await run('<html><body><section class="clip"><video data-src="https://cdn.example/clip.mp4" poster="/clip.jpg"></video></section></body></html>','https://media.example/');
  const jsonLd=await run('<html><head><title>VideoObject Test</title><script type="application/ld+json">{"@type":"VideoObject","name":"Structured clip","contentUrl":"https://cdn.example/structured.mp4","thumbnailUrl":"https://cdn.example/structured.jpg"}</script></head><body><main>hello</main></body></html>','https://structured.example/watch');
  const article=await run('<html><body><main><article class="post"><h2><a href="/story">Important story</a></h2><img src="/thumb.jpg" width="320" height="220"><p>Ordinary article content and commentary.</p></article></main></body></html>','https://news.example/');
  return {videoCard,lazyGallery,htmlVideo,jsonLd,article};
});
assert.equal(generalImport.videoCard.error,'');
assert.equal(generalImport.videoCard.items.length,1);
assert.equal(generalImport.videoCard.items[0].type,'video');
assert.equal(generalImport.videoCard.items[0].video,'');
assert.equal(generalImport.videoCard.items[0].url,'https://clips.example/watch/episode-7');
assert.equal(generalImport.videoCard.items[0].image,'https://clips.example/poster.jpg');
assert.deepEqual(generalImport.lazyGallery.items.map(x=>x.type),['image','image']);
assert.deepEqual(generalImport.lazyGallery.items.map(x=>x.image),['https://gallery.example/photo1.jpg','https://gallery.example/photo2.webp']);
assert.equal(generalImport.htmlVideo.items[0].video,'https://cdn.example/clip.mp4');
assert.equal(generalImport.htmlVideo.items[0].type,'video');
assert.equal(generalImport.jsonLd.items[0].video,'https://cdn.example/structured.mp4');
assert.deepEqual(generalImport.article.items.map(x=>x.type),['article']);

const bookmarklet=await page.evaluate(()=>buildBrowserImportBookmarkletAdvanced());assert.match(bookmarklet,/v:25/);assert.ok(bookmarklet.includes("if(!u||!String(u).trim())return''"));assert.match(bookmarklet,/iframeDoc\(cat\.u,850\)/);assert.match(bookmarklet,/liveVideos>videoCount/);assert.match(bookmarklet,/collectCategories/);assert.match(bookmarklet,/c:C\.slice\(0,16\)/);assert.match(bookmarklet,/g:GS/);assert.match(bookmarklet,/snapshotDocItems/);assert.match(bookmarklet,/compactItems/);assert.match(bookmarklet,/discoverNextPage/);assert.match(bookmarklet,/autoPages<5/);assert.match(bookmarklet,/m:'web-search'/);assert.match(bookmarklet,/collectSearchResults/);assert.match(bookmarklet,/parseArticles\(doc,base\);\s*parseImages\(doc,base\);/);assert.match(bookmarklet,/twidouga\\\.net/);assert.match(bookmarklet,/parseTw\(doc,base\)/);assert.doesNotMatch(bookmarklet,/if\(I\.length===before\)parseArticles/);assert.match(bookmarklet,/e:E\.slice\(0,30\)/);assert.match(bookmarklet,/sc:score/);assert.match(bookmarklet,/i:im/);assert.doesNotThrow(()=>new Function(bookmarklet.slice('javascript:'.length)));
const safariSimilar=await page.evaluate(async()=>{let calls=0;const old=fetchText;fetchText=async()=>{calls++;throw Error('browser similar must not fetch');};const ch=normalizeChannel({id:'safari-fixture',name:'Safari',url:'https://blocked.example/',type:'video',source:'browser',browserSourceUrl:'https://blocked.example/',relatedSitesVersion:14,relatedSites:[{name:'関連動画',url:'https://related.example/',image:'https://blocked.example/related.jpg',similarityScore:5,type:'video',genre:'動画'},{name:'【PR】広告',url:'https://ads.example/',similarityScore:9,type:'mixed'}]});state.channels.push(ch);await runSimilarDiscovery(ch);const out={calls,status:document.querySelector('#discoverStatus').textContent,items:state.candidates.map(x=>({url:x.url,image:x.image}))};state.channels=state.channels.filter(x=>x.id!==ch.id);fetchText=old;if(document.querySelector('#discoverDialog').open)document.querySelector('#discoverDialog').close();return out;});assert.equal(safariSimilar.calls,0);assert.deepEqual(safariSimilar.items,[{url:'https://related.example/',image:'https://blocked.example/related.jpg'}]);assert.match(safariSimilar.status,/広告・PR/);
const safariLegacy=await page.evaluate(async()=>{let calls=0;const old=fetchText;fetchText=async()=>{calls++;throw Error('legacy browser similar must not fetch');};const ch=normalizeChannel({id:'safari-old',name:'Safari旧版',url:'https://blocked-old.example/',source:'browser',browserSourceUrl:'https://blocked-old.example/',relatedSitesVersion:13,relatedSites:[]});state.channels.push(ch);await runSimilarDiscovery(ch);const out={calls,reimport:!!document.querySelector('[data-browser-import-target="https://blocked-old.example/"]'),status:document.querySelector('#discoverStatus').textContent};state.channels=state.channels.filter(x=>x.id!==ch.id);fetchText=old;if(document.querySelector('#discoverDialog').open)document.querySelector('#discoverDialog').close();return out;});assert.equal(safariLegacy.calls,0);assert.equal(safariLegacy.reimport,true);assert.match(safariLegacy.status,/最新版/);
const webFallback=await page.evaluate(async()=>{const ch=normalizeChannel({id:'web-fallback',name:'動画サイト',url:'https://fallback.example/',type:'video',source:'browser',browserSourceUrl:'https://fallback.example/',relatedSitesVersion:14,relatedSites:[]});state.channels.push(ch);await runSimilarDiscovery(ch);const button=!!document.querySelector('[data-web-similar-channel="web-fallback"]');const out={button,status:document.querySelector('#discoverStatus').textContent};state.channels=state.channels.filter(x=>x.id!==ch.id);if(document.querySelector('#discoverDialog').open)document.querySelector('#discoverDialog').close();return out;});assert.equal(webFallback.button,true);assert.match(webFallback.status,/ページ内/);
const webLaunch=await page.evaluate(()=>{const ch=state.channels.find(x=>x.id==='a');let opened='';const oldOpen=window.open;window.open=(u)=>{opened=u;return {};};state.meta.browserImportVersion=25;startWebSimilarSearch(ch);const pending=state.meta.pendingWebSimilar;window.open=oldOpen;return {opened,pending,query:webSimilarSearchQuery(ch)};});assert.match(webLaunch.opened,/html\.duckduckgo\.com\/html\/\?q=/);assert.equal(webLaunch.pending.channelId,'a');assert.match(webLaunch.query,/-site:video\.example/);
const webImport=await page.evaluate(()=>{state.meta.pendingWebSimilar={channelId:'a',query:'動画サイト 動画 似たサイト おすすめ',at:Date.now()};const before=state.channels.length;const payload={v:25,m:'web-search',s:'https://html.duckduckgo.com/html/?q=test',n:'Search',q:'test',i:[],d:[],e:[{n:'関連動画サイト',u:'https://candidate.example/posts/123',i:'https://candidate.example/icon.png',sc:8},{n:'X投稿',u:'https://x.com/user/status/123',sc:8},{n:'Yandex',u:'https://yandex.com/search/?text=test',sc:8},{n:'【PR】広告',u:'https://ads.example/',sc:8},{n:'同一サイト',u:'https://video.example/other',sc:8}]};const bytes=new TextEncoder().encode(JSON.stringify(payload));let bin='';for(const b of bytes)bin+=String.fromCharCode(b);location.hash='#mmimport='+encodeURIComponent(btoa(bin));const result=consumeBrowserImportHash();return {kind:result?.kind,channelCount:state.channels.length-before,urls:state.candidates.map(x=>x.url),types:state.candidates.map(x=>x.type),images:state.candidates.map(x=>x.image),pending:state.meta.pendingWebSimilar,importVersion:state.meta.browserImportVersion};});assert.equal(webImport.kind,'web-search');assert.equal(webImport.channelCount,0);assert.deepEqual(webImport.urls,['https://candidate.example/']);assert.deepEqual(webImport.types,['mixed']);assert.deepEqual(webImport.images,['https://candidate.example/icon.png']);assert.equal(webImport.pending,null);assert.equal(webImport.importVersion,25);
const pagination=await page.evaluate(async()=>{
  const ch=normalizeChannel({id:'paged',name:'Paged',url:'https://paged.example/',type:'mixed'});
  const pages={
    'https://paged.example/':'<main><article><h2><a href="/a">A</a></h2><p>aaa</p></article></main><a rel="next" href="/?p=2">次のページ</a>',
    'https://paged.example/?p=2':'<main><article><h2><a href="/b">B</a></h2><p>bbb</p></article></main><a href="/?p=3">次へ</a>',
    'https://paged.example/?p=3':'<main><article><h2><a href="/c">C</a></h2><p>ccc</p></article></main>'
  };
  const old=fetchText;fetchText=async u=>pages[u]||'';const out=await loadPaginatedChannelItems(ch,pages['https://paged.example/'],'https://paged.example/',5);fetchText=old;
  return {pages:out.pages,urls:out.items.map(x=>x.url),next:nextPageUrlFromHtml(pages['https://paged.example/'],'https://paged.example/')};
});assert.equal(pagination.pages,3);assert.deepEqual(pagination.urls,['https://paged.example/a','https://paged.example/b','https://paged.example/c']);assert.equal(pagination.next,'https://paged.example/?p=2');
const activeOpenRegression=await page.evaluate(()=>{
  let article=0,video=0;const oldA=openArticleReader,oldV=openVideoFeedItems;
  openArticleReader=()=>{article++};openVideoFeedItems=()=>{video++};activeItems=[{id:'x',title:'記事',url:'https://news.example/a',videoUrl:'https://ads.example/ad.mp4',type:'article'}];activeChannel={name:'News',deepDiveItems:[]};openActiveItem(0);openArticleReader=oldA;openVideoFeedItems=oldV;return {article,video};
});assert.deepEqual(activeOpenRegression,{article:1,video:0});
const profileRegression=await page.evaluate(()=>{
  const ch=normalizeChannel({id:'news-profile',name:'ニュース',url:'https://news.example/',type:'mixed'});
  const items=[
    {title:'記事A',url:'https://news.example/a',image:'https://news.example/a.jpg',videoUrl:'https://ads.example/ad.mp4',type:'article'},
    {title:'記事B',url:'https://news.example/b',image:'https://news.example/b.jpg',type:'article'}
  ];
  activeChannel=ch;activeItems=items;
  const p=applyReaderProfile(ch,items);
  return {mode:p.mode,activeReaderMode,tabs:[...document.querySelectorAll('#readerModeTabs button')].map(b=>({mode:b.dataset.readerMode,text:b.textContent,active:b.classList.contains('active')})),kinds:items.map(mediaKind)};
});assert.equal(profileRegression.mode,'article');assert.equal(profileRegression.activeReaderMode,'list');assert.deepEqual(profileRegression.kinds,['article','article']);assert.equal(profileRegression.tabs.find(x=>x.mode==='list').text,'記事');
const openPriority=await page.evaluate(()=>{
  let article=0,video=0,image=0;
  const oldA=openArticleReader,oldV=openVideoFeedItems,oldI=openImageViewer;
  openArticleReader=()=>{article++};openVideoFeedItems=()=>{video++};openImageViewer=()=>{image++};
  openItem({title:'記事',url:'https://news.example/a',videoUrl:'https://ads.example/ad.mp4',type:'article'});
  openItem({title:'画像',url:'https://img.example/1',image:'https://img.example/1.jpg',type:'image'});
  openItem({title:'動画',url:'https://video.example/1',videoUrl:'https://video.example/1.mp4',type:'video'});
  openArticleReader=oldA;openVideoFeedItems=oldV;openImageViewer=oldI;
  return {article,video,image};
});assert.deepEqual(openPriority,{article:1,video:1,image:1});
const articlePages=await page.evaluate(async()=>{
  const docs={
    'https://article-pages.example/a':'<article><h1>記事</h1><p>1ページ目の本文です。ここには十分な文章があります。</p><a href="/a?page=2">続きを読む</a></article>',
    'https://article-pages.example/a?page=2':'<article><p>2ページ目の本文です。続きを自動で結合します。</p><a href="/a?page=3">3/3</a></article>',
    'https://article-pages.example/a?page=3':'<article><p>3ページ目の本文です。これで最後です。</p></article>'
  };
  const old=fetchText;fetchText=async u=>docs[u]||'';const out=await loadReadableArticlePages({title:'記事',url:'https://article-pages.example/a',type:'article'},5);fetchText=old;
  return {pages:out.pages,text:out.blocks.filter(x=>x.text).map(x=>x.text).join(' '),next:articleContinuationUrl(docs['https://article-pages.example/a'],'https://article-pages.example/a')};
});assert.equal(articlePages.pages,3);assert.match(articlePages.text,/1ページ目/);assert.match(articlePages.text,/2ページ目/);assert.match(articlePages.text,/3ページ目/);assert.equal(articlePages.next,'https://article-pages.example/a?page=2');
assert.equal(await page.evaluate(()=>APP_VERSION),'1.8.0');
const genericDirectRegression=await page.evaluate(()=>{
  const ch=normalizeChannel({id:'general',name:'General Site',url:'https://sample.example/',type:'mixed'});
  const clips='<html><body><main>'+
    '<div class="video-card"><a href="/watch/first"><img data-src="/first.jpg" src="data:image/gif;base64,AA" alt="First clip">First clip</a></div>'+
    '<div class="video-card"><a href="/watch/second"><img data-src="/second.jpg" alt="Second clip">Second clip</a></div>'+
    '</main></body></html>';
  const videoCards=parseHtml(clips,ch,'https://sample.example/');
  const article=parseHtml('<html><body><main><article class="post"><h2><a href="/story">Article P: A normal article</a></h2><img src="/thumb.jpg"><p>Ordinary commentary and summary.</p></article></main></body></html>',ch,'https://sample.example/');
  const video=parseHtml('<html><body><main><section class="video-card"><a href="/watch/my-video"><video data-src="https://cdn.example/clip.mp4" poster="/poster.jpg"></video>Movie</a></section></main></body></html>',ch,'https://sample.example/');
  const gallery=parseHtml('<html><body><main><div class="gallery"><a href="/large1.jpg"><img data-src="/lazy1.jpg" src="data:image/gif;base64,AAA" alt="Gallery 1"></a></div><div class="gallery"><a href="/large2.jpg"><picture><source srcset="/large2.webp 2x"><img src="data:image/gif;base64,AAA" alt="Gallery 2"></picture></a></div></main></body></html>',ch,'https://sample.example/');
  const og=parseHtml('<html><head><title>Main movie</title><meta property="og:video:url" content="https://cdn.example/featured.mp4"><meta property="og:image" content="/featured.jpg"></head><body><main>Empty</main></body></html>',ch,'https://sample.example/watch/featured');
  const rss=parseFeed(new DOMParser().parseFromString('<rss><channel><item><title>News with cover photo</title><link>https://sample.example/news</link><enclosure url="https://sample.example/image.jpg" type="image/jpeg"/></item></channel></rss>','application/xml'),ch,'https://sample.example/');
  activeChannel=ch;activeItems=[];renderReader();
  const recovery={original:!!document.querySelector('#readerContent [data-open-url]'),safari:!!document.querySelector('#readerContent [data-browser-import-target]')};
  return {videoCards:videoCards.map(x=>({type:x.type,url:x.url,videoUrl:x.videoUrl,image:x.image})),article:article.map(x=>x.type),video:video.map(x=>({type:x.type,videoUrl:x.videoUrl,image:x.image})),gallery:gallery.map(x=>({type:x.type,image:x.image})),og:og.map(x=>({type:x.type,videoUrl:x.videoUrl})),rss:rss.map(x=>x.type),recovery,summary:videoAvailabilityLabel(videoCards)};
});
assert.deepEqual(genericDirectRegression.videoCards,[
  {type:'video',url:'https://sample.example/watch/first',videoUrl:'',image:'https://sample.example/first.jpg'},
  {type:'video',url:'https://sample.example/watch/second',videoUrl:'',image:'https://sample.example/second.jpg'}
]);
assert.deepEqual(genericDirectRegression.article,['article']);
assert.deepEqual(genericDirectRegression.video,[{type:'video',videoUrl:'https://cdn.example/clip.mp4',image:'https://sample.example/poster.jpg'}]);
assert.deepEqual(genericDirectRegression.gallery,[{type:'image',image:'https://sample.example/lazy1.jpg'},{type:'image',image:'https://sample.example/large2.webp'}]);
assert.deepEqual(genericDirectRegression.og,[{type:'video',videoUrl:'https://cdn.example/featured.mp4'}]);
assert.deepEqual(genericDirectRegression.rss,['article']);
assert.deepEqual(genericDirectRegression.recovery,{original:true,safari:true});
assert.match(genericDirectRegression.summary,/直接再生0・元ページ2/);

const fixtureRegression=await page.evaluate((fx)=>{
  const mk=(id,name,url)=>normalizeChannel({id,name,url,type:'mixed'});
  const video=parseHtml(fx.videoRanking,mk('fv','Video','https://fixture.example/'),'https://fixture.example/');
  const article=extractReadableArticle(fx.articleStandard,'https://fixture.example/article','標準記事');
  const thread=extractReadableArticle(fx.articleThread,'https://fixture.example/thread','スレッド記事');
  const images=parseHtml(fx.imageGallery,mk('fi','Images','https://fixture.example/'),'https://fixture.example/');
  const mixed=parseHtml(fx.mixed,mk('fm','Mixed','https://fixture.example/'),'https://fixture.example/');
  return {
    engine:!!window.MyMelterContentEngine,
    videoKinds:video.map(mediaKind),videoMode:contentProfile(video).mode,
    articleText:article.blocks.filter(x=>x.text).map(x=>x.text).join(' '),
    threadComments:thread.blocks.filter(x=>x.kind==='comment').map(x=>x.text),
    imageKinds:images.map(mediaKind),imageMode:contentProfile(images).mode,imageDetails:images.map(x=>({title:x.title,url:x.url,videoUrl:x.videoUrl,image:x.image,type:x.type})),
    mixedKinds:mixed.map(mediaKind),mixedMode:contentProfile(mixed).mode
  };
},FIXTURES);
assert.equal(fixtureRegression.engine,true);
assert.equal(fixtureRegression.videoMode,'video');assert.ok(fixtureRegression.videoKinds.every(x=>x==='video'));
assert.match(fixtureRegression.articleText,/標準的な記事本文/);assert.doesNotMatch(fixtureRegression.articleText,/関連記事 関連記事/);
assert.equal(fixtureRegression.threadComments.length,5);assert.match(fixtureRegression.threadComments[0],/最初のレス本文/);assert.match(fixtureRegression.threadComments[1],/二番目のレス本文/);
assert.equal(fixtureRegression.imageMode,'image');assert.ok(fixtureRegression.imageKinds.every(x=>x==='image'));
assert.equal(fixtureRegression.mixedMode,'mixed');assert.ok(fixtureRegression.mixedKinds.includes('video'));assert.ok(fixtureRegression.mixedKinds.includes('article'));assert.ok(fixtureRegression.mixedKinds.includes('image'));
const groupedThread=await page.evaluate(()=>{
  const html='<html><body><main><div class="sidebar">人気記事 次の記事 関連記事 いっぱい</div><div class="article-body-inner"><div>1: 以下、ニュー速クオリティでお送りします 2026/08/01 ID:AAA111</div><div>最初のレス本文です。メガネの話を続けます。</div><div>2: 以下、ニュー速クオリティでお送りします 2026/08/01 ID:BBB222</div><div>&gt;&gt;1 二つ目のレス本文です。</div><div>3: 以下、ニュー速クオリティでお送りします 2026/08/01 ID:CCC333</div><div>三つ目のレス本文です。</div><div>引用元：</div></div></main></body></html>';
  const a=extractReadableArticle(html,'https://news4vip.example/archives/1.html','記事');
  return {comments:a.blocks.filter(x=>x.kind==='comment').map(x=>x.text),count:a.commentCount,all:a.blocks.map(x=>x.text||'').join(' ')};
});assert.equal(groupedThread.count,3);assert.equal(groupedThread.comments.length,3);assert.match(groupedThread.comments[0],/最初のレス本文/);assert.match(groupedThread.comments[1],/二つ目のレス本文/);assert.match(groupedThread.comments[2],/三つ目のレス本文/);assert.doesNotMatch(groupedThread.all,/人気記事 次の記事/);
const commentsReader=await page.evaluate(()=>{
  const html='<html><body><article><h1>記事</h1><p>本文です。十分な長さの本文を入れてReader抽出を確認します。本文はここまでです。</p><div>1: 名無しさん＠テスト 2026/10/03 ID:ABC123<br>最初のレスです</div><div>2: 名無しさん＠テスト 2026/10/03 ID:DEF456<br>&gt;&gt;1 返信です</div></article><section id="comments"><div class="comment-item">コメントA：この記事わかりやすい</div><div class="comment-item">コメントB：参考になった</div><div class="sponsored">スポンサー広告</div></section></body></html>';
  const article=extractReadableArticle(html,'https://comments.example/a','記事');
  return {commentCount:article.commentCount,kinds:article.blocks.map(x=>x.kind),comments:article.blocks.filter(x=>x.kind==='comment').map(x=>x.text),html:articleBlocksHTML(article)};
});assert.ok(commentsReader.commentCount>=2);assert.ok(commentsReader.kinds.includes('comments-heading'));assert.match(commentsReader.comments.join(' '),/コメントA/);assert.match(commentsReader.html,/clean-reader-comment/);assert.doesNotMatch(commentsReader.comments.join(' '),/スポンサー広告/);
const livedoorReader=await page.evaluate(()=>{
  const html='<html><head><title>テスト記事</title></head><body><div class="article-body-inner">最初の本文です。<br>2行目の本文です。<br><br><div>さらに本文が続きます。広告ではない本文を十分な長さで追加します。</div><div class="sponsored">スポンサー広告</div><img src="/body.jpg" width="640" height="480"></div></body></html>';
  const article=extractReadableArticle(html,'https://nwknews.example/archives/1.html','テスト記事');
  return {textLength:article.textLength,text:article.blocks.filter(x=>x.text).map(x=>x.text).join(' '),images:article.blocks.filter(x=>x.kind==='image').map(x=>x.src)};
});assert.ok(livedoorReader.textLength>=35);assert.match(livedoorReader.text,/最初の本文/);assert.match(livedoorReader.text,/2行目/);assert.doesNotMatch(livedoorReader.text,/スポンサー広告/);assert.deepEqual(livedoorReader.images,['https://nwknews.example/body.jpg']);
const unified=await page.evaluate(()=>{
  const ch=normalizeChannel({id:'articles',name:'記事サイト',url:'https://news.example/',type:'mixed'});
  const items=parseHtml('<main><article><h2><a href="/a">記事A</a></h2><img src="/a.jpg"><p>本文の概要です</p></article><div class="advertisement"><a href="/ad">広告リンク</a></div><article><h2><a href="/b">記事B</a></h2><p>別の記事本文</p></article></main>',ch,'https://news.example/');
  const article=extractReadableArticle('<html><head><title>記事タイトル</title></head><body><header>ナビ</header><article><h1>記事タイトル</h1><p>これは読みたい本文です。十分な長さの本文をここに入れてReaderの抽出を確認します。</p><div class="sponsored">スポンサー広告です</div><img src="/photo.jpg" width="640" height="480"><p>本文の続きです。</p></article><footer>広告</footer></body></html>','https://news.example/a','記事A');
  return {items:items.map(x=>({title:x.title,type:x.type,image:x.image})),profile:contentProfile(items),articleText:article.blocks.filter(x=>x.text).map(x=>x.text).join(' '),articleImages:article.blocks.filter(x=>x.kind==='image').map(x=>x.src),normal1:normalizeSimilarSiteUrl('https://nukiru.com/posts/123'),normal2:normalizeSimilarSiteUrl('https://x.com/u/status/1'),normal3:normalizeSimilarSiteUrl('https://search.yahoo.co.jp/realtime/search?p=x')};
});assert.equal(unified.items.length,2);assert.equal(unified.items[0].type,'article');assert.equal(unified.profile.mode,'article');assert.match(unified.articleText,/読みたい本文/);assert.doesNotMatch(unified.articleText,/スポンサー広告/);assert.deepEqual(unified.articleImages,['https://news.example/photo.jpg']);assert.equal(unified.normal1,'https://nukiru.com/');assert.equal(unified.normal2,'');assert.equal(unified.normal3,'');
await page.evaluate(async()=>{const old=fetchText;fetchText=async()=>'<article><h1>内部Reader</h1><p>広告なしでMyMelter内に表示する本文です。十分な長さを確保してReader表示を確認します。もう少し本文を追加します。</p><div class="ad">広告テキスト</div></article>';await openArticleReader({title:'内部Reader',url:'https://article.example/a',type:'article'});fetchText=old;});await page.waitForFunction(()=>document.querySelector('#articleReaderDialog [data-clean-reader-body]')?.textContent.includes('MyMelter内'));assert.equal(await page.locator('#articleReaderDialog').isVisible(),true);assert.doesNotMatch(await page.locator('#articleReaderDialog [data-clean-reader-body]').textContent(),/広告テキスト/);await page.locator('#articleReaderDialog [data-clean-reader-close]').click();
await page.evaluate(()=>{activeItems=[{title:'画像1',url:'https://img.example/1',image:'https://img.example/1.jpg',type:'image'},{title:'画像2',url:'https://img.example/2',image:'https://img.example/2.jpg',type:'image'}];openImageViewer(activeItems[0]);});assert.equal(await page.locator('#imageViewerDialog').isVisible(),true);assert.match(await page.locator('#imageViewerDialog [data-image-main]').getAttribute('src'),/1\.jpg/);await page.locator('#imageViewerDialog [data-image-next]').click();assert.match(await page.locator('#imageViewerDialog [data-image-main]').getAttribute('src'),/2\.jpg/);await page.locator('#imageViewerDialog [data-image-close]').click();
const browserCombined=await page.evaluate(()=>{
  const ch=normalizeChannel({
    id:'browser-combined',name:'Twidouga',url:'https://tw.example/',source:'browser',
    snapshotItems:[
      {id:'thumb1',title:'動画サムネイル',url:'https://tw.example/thumb1',image:'https://cdn.example/a.jpg',type:'image'},
      {id:'thumb2',title:'動画サムネイル',url:'https://tw.example/thumb2',image:'https://cdn.example/b.jpg',type:'image'}
    ],
    deepDiveItems:[
      {id:'r2',title:'第2位',url:'https://x.com/2',image:'https://cdn.example/b.jpg',videoUrl:'https://cdn.example/b.mp4',type:'video',browserRank:'2'},
      {id:'r1',title:'第1位',url:'https://x.com/1',image:'https://cdn.example/a.jpg',videoUrl:'https://cdn.example/a.mp4',type:'video',browserRank:'1'}
    ]
  });
  return browserChannelItems(ch).map(x=>({id:x.id,type:x.type,rank:x.browserRank||''}));
});assert.deepEqual(browserCombined,[{id:'r1',type:'video',rank:'1'},{id:'r2',type:'video',rank:'2'}]);
const rankingPriority=await page.evaluate(()=>{
  const items=[
    {id:'thumb',title:'サムネ',url:'https://rank.example/thumb',image:'https://cdn.example/a.jpg',type:'image'},
    {id:'r2',title:'第2位',url:'https://x.com/2',image:'https://cdn.example/b.jpg',videoUrl:'https://cdn.example/b.mp4',type:'video',browserRank:'2'},
    {id:'r1',title:'第1位',url:'https://x.com/1',image:'https://cdn.example/a.jpg',videoUrl:'https://cdn.example/a.mp4',type:'video',browserRank:'1'},
    {id:'other',title:'別画像',url:'https://rank.example/other',image:'https://cdn.example/c.jpg',type:'image'}
  ];
  return prioritizeImportedItems(items).map(x=>x.id);
});assert.deepEqual(rankingPriority,['r1','r2','other']);
const sharedRankMedia=await page.evaluate(()=>{
  const ch=normalizeChannel({id:'shared-ranked',name:'ランキング',url:'https://rank.example/',type:'video',deepDiveItems:[
    {id:'second',title:'第2位',url:'https://posts.example/2',videoUrl:'https://cdn.example/shared.mp4',type:'video',browserRank:'2'},
    {id:'first',title:'第1位',url:'https://posts.example/1',videoUrl:'https://cdn.example/shared.mp4',type:'video',browserRank:'1'}
  ]});
  const items=browserChannelItems(ch);
  return {ranks:items.map(x=>x.browserRank),urls:items.map(x=>x.url),mode:contentProfile(items).mode};
});assert.deepEqual(sharedRankMedia.ranks,['1','2']);assert.deepEqual(sharedRankMedia.urls,['https://posts.example/1','https://posts.example/2']);assert.equal(sharedRankMedia.mode,'video');

const cachedCategory=await page.evaluate(async()=>{
  const c1='https://video-cat.example/new',c2='https://video-cat.example/ranking';
  const ch=normalizeChannel({id:'cached-cat',name:'Cached',url:c1,type:'video',categoryTabs:[{name:'新着',url:c1},{name:'ランキング',url:c2}],categorySnapshots:{[c2]:[{id:'rank1',title:'第1位',url:'https://x.com/r1',videoUrl:'https://cdn.example/r1.mp4',image:'https://cdn.example/r1.jpg',type:'video',browserRank:'1'}]}});
  activeChannel=ch;activeItems=[{id:'new1',title:'新着',url:'https://x.com/new1',videoUrl:'https://cdn.example/new1.mp4',image:'https://cdn.example/new1.jpg',type:'video'}];applyReaderProfile(ch,activeItems);renderReader();
  let calls=0;const old=fetchText;fetchText=async()=>{calls++;throw Error('must not fetch cached category');};
  await loadVideoCategory(1);fetchText=old;
  return {calls,active:activeChannel._activeCategoryUrl,ids:activeItems.map(x=>x.id),mode:activeReaderMode};
});assert.equal(cachedCategory.calls,0);assert.equal(cachedCategory.active,'https://video-cat.example/ranking');assert.deepEqual(cachedCategory.ids,['rank1']);assert.equal(cachedCategory.mode,'video');
const videoCategories=await page.evaluate(()=>{
  const html='<nav><a href="/new">新着動画</a><a href="/24h/views">24h(閲覧数)</a><a href="/24h/downloads">24h(ダウンロード数)</a><a href="/login">ログイン</a></nav>';
  const cats=extractChannelCategories(html,'https://video-cat.example/');
  const ch=normalizeChannel({id:'vc',name:'VC',url:'https://video-cat.example/new',type:'video',categoryTabs:cats});
  activeChannel=ch;activeItems=[{id:'v1',title:'縦',url:'https://video-cat.example/1',videoUrl:'https://cdn.example/1.mp4',image:'https://cdn.example/tall.jpg',type:'video'}];
  applyReaderProfile(ch,activeItems);renderReader();
  return {cats,buttons:[...document.querySelectorAll('[data-video-category]')].map(x=>x.textContent),current:currentVideoCategoryIndex(ch)};
});assert.equal(videoCategories.cats.length,3);assert.deepEqual(videoCategories.buttons,['新着動画','24h(閲覧数)','24h(ダウンロード数)']);assert.equal(videoCategories.current,0);
const videoFirst=await page.evaluate(()=>{
  const ch=normalizeChannel({id:'vf',name:'動画中心',url:'https://video-first.example/',type:'video'});
  const items=[
    {id:'v1',title:'動画1',url:'https://video-first.example/1',videoUrl:'https://cdn.example/1.mp4',image:'https://cdn.example/1.jpg',type:'video',channelName:'動画中心'},
    {id:'v2',title:'動画2',url:'https://video-first.example/2',videoUrl:'https://cdn.example/2.mp4',image:'https://cdn.example/2.jpg',type:'video',channelName:'動画中心'},
    {id:'v3',title:'動画3',url:'https://video-first.example/3',videoUrl:'https://cdn.example/3.mp4',image:'https://cdn.example/3.jpg',type:'video',channelName:'動画中心'}
  ];
  activeChannel=ch;activeItems=items;const p=applyReaderProfile(ch,items);renderReader();
  const screen=document.querySelector('.reader-screen'),cards=[...document.querySelectorAll('.video-gallery-card')];
  let opened=null;const oldOpen=openVideoFeedItems;openVideoFeedItems=(vids,title,start)=>{opened={count:vids.length,title,start};};
  document.querySelector('[data-video-gallery-open="1"]').click();openVideoFeedItems=oldOpen;
  return {mode:p.mode,videoFirst:screen.classList.contains('video-first'),cards:cards.length,opened,toolbar:getComputedStyle(document.querySelector('.reader-toolbar')).display,status:getComputedStyle(document.querySelector('.reader-status')).display};
});assert.equal(videoFirst.mode,'video');assert.equal(videoFirst.videoFirst,true);assert.equal(videoFirst.cards,3);assert.deepEqual(videoFirst.opened,{count:3,title:'動画中心',start:1});assert.equal(videoFirst.toolbar,'none');assert.equal(videoFirst.status,'none');
const missingSourceUI=await page.evaluate(()=>{
  const slide=document.createElement('section');slide.className='video-slide';
  slide.innerHTML='<video></video><div class="video-error-panel"><strong data-feed-error-text></strong><button data-feed-retry="0">再試行</button></div>';
  document.body.appendChild(slide);const v=slide.querySelector('video');
  markFeedUnavailable(slide,v,'元データがありません（削除・期限切れの可能性があります）');
  const out={missing:slide.classList.contains('video-source-missing'),error:slide.classList.contains('video-load-error'),state:v.dataset.feedState,text:slide.querySelector('[data-feed-error-text]').textContent};
  slide.remove();return out;
});assert.equal(missingSourceUI.missing,true);assert.equal(missingSourceUI.error,true);assert.equal(missingSourceUI.state,'unavailable');assert.match(missingSourceUI.text,/元データがありません/);
const longVideoButton=await page.evaluate(()=>{
  const wrap=document.createElement('div');wrap.style.cssText='position:relative;width:390px;height:600px;';
  wrap.innerHTML='<section class="video-slide system-long-video" style="height:600px!important;min-height:600px!important;max-height:600px!important;width:390px!important;position:relative"><div class="long-system-card"><div class="long-system-placeholder">長尺動画</div><div class="long-system-copy"><strong>長尺動画</strong><small>Safari標準プレイヤー</small><button type="button" data-long-system-play="0">Safariで再生</button></div></div></section>';
  document.body.appendChild(wrap);const slide=wrap.querySelector('.video-slide'),button=wrap.querySelector('[data-long-system-play]'),sr=slide.getBoundingClientRect(),br=button.getBoundingClientRect(),copy=getComputedStyle(wrap.querySelector('.long-system-copy'));
  const out={inside:br.top>=sr.top&&br.bottom<=sr.bottom+1,display:getComputedStyle(button).display,copyPosition:copy.position,copyBottom:copy.bottom};wrap.remove();return out;
});assert.equal(longVideoButton.inside,true);assert.notEqual(longVideoButton.display,'none');assert.equal(longVideoButton.copyPosition,'absolute');assert.equal(longVideoButton.copyBottom,'0px');
const mobileCandidate=await page.evaluate(()=>{const d=document.querySelector('#discoverDialog');if(!d.open)d.showModal();const x=candidateFrom('https://very-long-domain.example/path/that/keeps/going/for/a/very/long/time?tracking=1234567890','とても長い候補サイト名がここに入っても横にはみ出さない','mixed',{image:'https://image.example/thumb.jpg'});renderDiscoveryResults([x]);const card=document.querySelector('.discover-result'),thumb=document.querySelector('.result-thumb'),actions=document.querySelector('.result-actions'),sheet=document.querySelector('#discoverDialog .sheet'),cr=card.getBoundingClientRect(),sr=sheet.getBoundingClientRect(),ar=actions.getBoundingClientRect();const out={thumb:!!thumb,docScroll:document.documentElement.scrollWidth,viewport:window.innerWidth,cardRight:cr.right,sheetRight:sr.right,actionsRight:ar.right};d.close();return out;});assert.equal(mobileCandidate.thumb,true);assert.ok(mobileCandidate.docScroll<=mobileCandidate.viewport);assert.ok(mobileCandidate.cardRight<=mobileCandidate.sheetRight+1);assert.ok(mobileCandidate.actionsRight<=mobileCandidate.sheetRight+1);
const discoveryScroll=await page.evaluate(()=>{const d=document.querySelector('#discoverDialog');if(!d.open)d.showModal();const list=Array.from({length:24},(_,i)=>candidateFrom('https://scroll-'+i+'.example/path/'+('x'.repeat(80)),'候補サイト '+i,'mixed',{image:'https://image.example/'+i+'.jpg'}));renderDiscoveryResults(list);const sheet=document.querySelector('#discoverDialog .sheet'),style=getComputedStyle(sheet);const before=sheet.scrollTop;sheet.scrollTop=500;const after=sheet.scrollTop;const out={scrollHeight:sheet.scrollHeight,clientHeight:sheet.clientHeight,before,after,overflowY:style.overflowY,touchAction:style.touchAction};d.close();return out;});assert.ok(discoveryScroll.scrollHeight>discoveryScroll.clientHeight);assert.ok(discoveryScroll.after>0);assert.match(discoveryScroll.overflowY,/auto|scroll/);assert.match(discoveryScroll.touchAction,/pan-y|auto/);
const readerScroll=await page.evaluate(()=>{
  const d=document.querySelector('#readerDialog');if(!d.open)d.showModal();
  activeChannel=normalizeChannel({id:'scroll-reader',name:'記事サイト',url:'https://scroll-reader.example/',type:'article'});
  activeItems=Array.from({length:30},(_,i)=>({id:'r'+i,title:'記事 '+i,url:'https://scroll-reader.example/'+i,type:'article'}));
  applyReaderProfile(activeChannel,activeItems);renderReader();
  const screen=document.querySelector('.reader-screen'),header=document.querySelector('.reader-header'),toolbar=document.querySelector('.reader-toolbar');
  screen.scrollTop=0;
  const h0=header.getBoundingClientRect().top,t0=toolbar.getBoundingClientRect().top,sh=screen.scrollHeight,ch=screen.clientHeight;
  screen.scrollTop=350;
  const h1=header.getBoundingClientRect().top,t1=toolbar.getBoundingClientRect().top;
  d.close();
  return {h0,h1,t0,t1,scrollTop:screen.scrollTop,scrollHeight:sh,clientHeight:ch};
});assert.ok(readerScroll.scrollHeight>readerScroll.clientHeight);assert.ok(Math.abs(readerScroll.h1-readerScroll.h0)<2);assert.ok(readerScroll.t1<readerScroll.t0-100);
await page.evaluate(()=>openQualityPicker({title:'MP4',videoUrl:'https://video.example/test.mp4'},null,true));await page.waitForFunction(()=>document.querySelector('[data-quality-status]').textContent.includes('画質変更不可'));assert.equal(await page.locator('[data-quality-select]').isDisabled(),true);assert.equal(await page.locator('[data-quality-start]').isEnabled(),true);await page.locator('[data-quality-close]').first().click();
await page.evaluate(()=>{fetchText=async()=> '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nlow.m3u8';return openQualityPicker({title:'HLS',videoUrl:'https://video.example/master.m3u8'},null,true);});
assert.equal(await page.locator('[data-quality-select] option').count(),3);assert.match(await page.locator('[data-quality-help]').textContent(),/720p/);assert.equal(await page.locator('[data-quality-start]').isEnabled(),true);
await page.locator('[data-quality-close]').first().click();
const safe=await page.evaluate(()=>{let opened=0;window.open=()=>{opened++;return null;};workerCapability={checked:true,download:false,version:'1.2'};startVerifiedVideoDownload({videoUrl:'https://video.example/a.mp4'});return {opened,url:streamingDownloadUrl('https://video.example/a.mp4')};});assert.equal(safe.opened,0);assert.equal(safe.url,'');
await page.evaluate(()=>{fetchMediaBlob=async()=>{throw Error('fixture network failure');};return prepareDeviceSave({image:'https://image.example/picture.jpg',title:'画像'});});assert.equal(await page.locator('#mediaSaveDialog').isVisible(),true);assert.equal(await page.locator('[data-media-share]').isDisabled(),true);await page.evaluate(()=>closeMediaSaveDialog());
await page.route('https://fixture.example/**',route=>route.fulfill({status:200,contentType:'video/mp2t',body:Buffer.from([0x47,0x01,0x02])}));
await page.evaluate(()=>{fetchText=async()=> '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\npart.ts\n#EXT-X-ENDLIST';return openQualityPicker({title:'fixture',videoUrl:'https://fixture.example/video.m3u8'},null,true);});
const downloadEvent=page.waitForEvent('download');await page.locator('[data-quality-start]').click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'fixture.zip');const zip=fs.readFileSync(await download.path());assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('playlist.m3u8')));assert.ok(zip.includes(Buffer.from('media-00000.ts')));assert.ok(zip.includes(Buffer.from([0x47,0x01,0x02])));
await page.evaluate(()=>{navigate('channels');state.ui.channelGenre='all';renderChannelManager();});await page.screenshot({path:__dirname+'/../channels-mobile.png',fullPage:true});
assert.deepEqual(errors,[]);console.log('PASS browser: MyMelter 1.8.0 unified content engine + cross-site fixtures, ranked videos, grouped forum posts, Safari v25 legacy plus v26 fast import, video missing-source UI, article/image/video/mixed profiles, HLS/Worker safety; no page errors');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
