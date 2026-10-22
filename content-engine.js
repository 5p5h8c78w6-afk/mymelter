/* MyMelter 1.7.7 unified content engine.
   Pure helpers shared by UI/import state. Site-specific extraction should feed evidence here,
   not decide final presentation by itself. */
const MyMelterContentEngine=(()=>{
  function cleanUrl(raw=''){
    try{const u=new URL(String(raw||''));if(!/^https?:$/.test(u.protocol))return'';u.hash='';return u.href}catch{return''}
  }
  function kind(item={}){
    const explicit=String(item.type||'').toLowerCase();
    if(explicit==='article'||explicit==='feed')return'article';
    if(explicit==='video')return'video';
    if(explicit==='image')return'image';
    if(cleanUrl(item.videoUrl))return'video';
    if(cleanUrl(item.image))return'image';
    return'article';
  }
  function normalize(item={},seq=0){
    const out={...item};
    out.url=cleanUrl(out.url)||String(out.url||'');
    out.videoUrl=cleanUrl(out.videoUrl);
    out.image=cleanUrl(out.image);
    out.type=kind(out);
    out.browserRank=/^\d+$/.test(String(out.browserRank||''))?String(Number(out.browserRank)):'';
    out._seq=seq;
    return out;
  }
  function rankKey(item={}){
    const rank=Number(item.browserRank||0);
    if(kind(item)!=='video'||!Number.isSafeInteger(rank)||rank<1)return'';
    const identity=cleanUrl(item.url)||cleanUrl(item.videoUrl)||String(item.id||'');
    return identity?'r:'+rank+':'+identity:'';
  }
  function key(item={}){
    const ranked=rankKey(item);
    if(ranked)return ranked;
    const k=kind(item);
    if(k==='video'&&cleanUrl(item.videoUrl))return'v:'+cleanUrl(item.videoUrl);
    if(cleanUrl(item.url))return'u:'+cleanUrl(item.url);
    if(k==='image'&&cleanUrl(item.image))return'i:'+cleanUrl(item.image);
    return item.id?'id:'+item.id:'';
  }
  function mergePair(a,b){
    const score=x=>(kind(x)==='video'?8:kind(x)==='article'?5:3)+(x.browserRank?4:0)+(x.title?1:0)+(x.image?1:0)+(x.videoUrl?3:0);
    const hi=score(b)>score(a)?b:a,lo=hi===a?b:a;
    return {...lo,...hi,
      title:hi.title||lo.title||'',
      url:hi.url||lo.url||'',
      image:hi.image||lo.image||'',
      videoUrl:hi.videoUrl||lo.videoUrl||'',
      browserRank:hi.browserRank||lo.browserRank||'',
      type:kind(hi.videoUrl?hi:lo.videoUrl?lo:hi),
      _seq:Math.min(Number(a._seq||0),Number(b._seq||0))
    };
  }
  function mergeItems(...groups){
    const flat=groups.flat(Infinity).filter(Boolean).map((x,i)=>normalize(x,i));
    const map=new Map(),aliases=new Map();
    for(const item of flat){
      // Ranked entries are distinct even when the provider reuses a media URL.
      // Do not attach the shared video URL as an alias for a ranked entry.
      const ranked=rankKey(item);
      const ks=ranked?[ranked]:[key(item),cleanUrl(item.url)?'u:'+cleanUrl(item.url):'',cleanUrl(item.videoUrl)?'v:'+cleanUrl(item.videoUrl):''].filter(Boolean);
      let found=null;
      for(const k of ks){if(aliases.has(k)){found=aliases.get(k);break}}
      if(found&&map.has(found)){
        const merged=mergePair(map.get(found),item);map.set(found,merged);
        for(const k of ks)aliases.set(k,found);
      }else{
        const primary=ks[0]||('seq:'+item._seq);map.set(primary,item);
        for(const k of ks)aliases.set(k,primary);
      }
    }
    // Legacy/unranked evidence of a ranked video can enrich one rank entry,
    // but must not create an extra duplicate card beside the ranking.
    for(const [unrankedKey,item] of map){
      if(rankKey(item)||kind(item)!=='video')continue;
      const media=cleanUrl(item.videoUrl);
      if(!media)continue;
      const match=[...map].find(([k,x])=>k!==unrankedKey&&!!rankKey(x)&&cleanUrl(x.videoUrl)===media);
      if(match){
        map.set(match[0],mergePair(match[1],item));
        map.delete(unrankedKey);
      }
    }
    let out=[...map.values()];
    const videoPosters=new Set(out.filter(x=>kind(x)==='video'&&cleanUrl(x.image)).map(x=>cleanUrl(x.image)));
    out=out.filter(x=>!(kind(x)==='image'&&cleanUrl(x.image)&&videoPosters.has(cleanUrl(x.image))));
    const hasRank=out.some(x=>Number(x.browserRank)>0);
    out.sort((a,b)=>{
      const ar=Number(a.browserRank||0),br=Number(b.browserRank||0),ah=ar>0,bh=br>0;
      if(hasRank&&ah!==bh)return ah?-1:1;
      if(ah&&bh&&ar!==br)return ar-br;
      if(hasRank){
        const av=kind(a)==='video',bv=kind(b)==='video';if(av!==bv)return av?-1:1;
      }
      return Number(a._seq||0)-Number(b._seq||0);
    });
    return out.map(({_seq,...x})=>x);
  }
  function profile(items=[]){
    const merged=mergeItems(items),score={video:0,image:0,article:0},counts={video:0,image:0,article:0};
    for(const x of merged){
      const k=kind(x);counts[k]++;
      let w=k==='video'?2:k==='article'?1.25:1;
      if(k==='video'&&Number(x.browserRank)>0)w+=1.5;
      if(k==='article'&&String(x.excerpt||'').length>80)w+=.5;
      score[k]+=w;
    }
    const total=score.video+score.image+score.article||1;
    let mode='mixed';
    if(score.video/total>=.5&&counts.video>=1)mode='video';
    else if(score.article/total>=.55&&counts.article>=1)mode='article';
    else if(score.image/total>=.6&&counts.image>=1)mode='image';
    return {mode,counts,score,total,items:merged};
  }
  function channelItems(channel={},categoryUrl=''){
    const cat=cleanUrl(categoryUrl||'');
    if(cat&&channel.categorySnapshots&&Array.isArray(channel.categorySnapshots[cat])){
      return mergeItems(channel.categorySnapshots[cat]);
    }
    return mergeItems(channel.snapshotItems||[],channel.deepDiveItems||[]);
  }
  function normalizeCategorySnapshots(input={}){
    const out={};
    if(!input||typeof input!=='object')return out;
    for(const [raw,items] of Object.entries(input)){
      const u=cleanUrl(raw);if(!u||!Array.isArray(items))continue;
      const merged=mergeItems(items);if(merged.length)out[u]=merged;
    }
    return out;
  }
  function hasPlayableVideo(items=[]){return mergeItems(items).some(x=>kind(x)==='video'&&!!cleanUrl(x.videoUrl))}
  function diagnostics(items=[]){
    const p=profile(items);
    return {...p,rankedVideos:p.items.filter(x=>kind(x)==='video'&&Number(x.browserRank)>0).length,
      playableVideos:p.items.filter(x=>kind(x)==='video'&&!!cleanUrl(x.videoUrl)).length};
  }
  return {cleanUrl,kind,normalize,key,mergeItems,profile,channelItems,normalizeCategorySnapshots,hasPlayableVideo,diagnostics};
})();
if(typeof window!=='undefined')window.MyMelterContentEngine=MyMelterContentEngine;
if(typeof module!=='undefined')module.exports=MyMelterContentEngine;
