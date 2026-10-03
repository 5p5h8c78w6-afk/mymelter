/* MyMelter 1.4.3: shared pure helpers. Loaded before app.js. */
const MyMelterFeatures=(()=>{
  function safeUrl(raw,base){
    try{const u=new URL(raw,base);if(!/^https?:$/.test(u.protocol)||u.username||u.password)return '';
      if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname)||u.hostname.endsWith('.local'))return '';
      u.hash='';return u.href;
    }catch{return '';}
  }
  function attributes(line){
    const out={};for(const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g))out[m[1]]=m[2].replace(/^"|"$/g,'');return out;
  }
  function parseMaster(text,base){
    if(!/^\s*#EXTM3U\b/.test(text))throw Error('HLSプレイリストではありません');
    const lines=text.split(/\r?\n/);const variants=[];let attrs=null;
    for(const raw of lines){const l=raw.trim();if(l.startsWith('#EXT-X-STREAM-INF:'))attrs=attributes(l.slice(18));
      else if(l&&!l.startsWith('#')&&attrs){const url=safeUrl(l,base);if(url){const height=Number((attrs.RESOLUTION||'').split('x')[1])||0;variants.push({url,height,bandwidth:Number(attrs['AVERAGE-BANDWIDTH']||attrs.BANDWIDTH)||0,audio:attrs.AUDIO||'',codecs:attrs.CODECS||'',label:height?height+'p':Math.round((Number(attrs.BANDWIDTH)||0)/1000)+'kbps'});}attrs=null;}
    }
    return variants.filter((v,i,a)=>a.findIndex(x=>x.url===v.url)===i).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);
  }
  function recommended(variants,duration=0){
    if(!(duration>=600||variants.some(v=>v.height>1080||v.bandwidth>5000000)))return null;
    const light=variants.filter(v=>v.height>0&&v.height<=720).sort((a,b)=>b.height-a.height||a.bandwidth-b.bandwidth);
    return light[0]||[...variants].sort((a,b)=>a.bandwidth-b.bandwidth)[0]||null;
  }
  function offlinePlaylist(text,base){
    if(!/^\s*#EXTM3U\b/.test(text)||!text.includes('#EXT-X-ENDLIST'))throw Error('ライブ配信・未完了の動画は保存できません');
    if(/#EXT-X-(KEY|SESSION-KEY|BYTERANGE)|#EXT-X-MAP:[^\n]*BYTERANGE|#EXT-X-STREAM-INF/.test(text))throw Error('暗号化・分割範囲指定のHLS保存は未対応です');
    let n=0;const files=[];
    const lines=text.split(/\r?\n/).map(raw=>{const l=raw.trim();let uri=null,isMap=false;
      if(l.startsWith('#EXT-X-MAP:')){uri=attributes(l.slice(11)).URI;isMap=true;}else if(l&&!l.startsWith('#'))uri=l;
      if(!uri)return raw;const url=safeUrl(uri,base);if(!url)throw Error('安全に取得できない動画URLです');
      const ext=isMap?'mp4':/\.m4s(?:$|\?)/i.test(url)?'m4s':'ts';const name='media-'+String(n++).padStart(5,'0')+'.'+ext;files.push({name,url});return isMap?l.replace(/URI="[^"]*"/,'URI="'+name+'"'):name;
    });if(!files.length||files.length>2000)throw Error('保存可能な分割数を超えています（最大2000）');return {text:lines.join('\n'),files};
  }
  function zipStored(entries){
    const enc=new TextEncoder(),chunks=[],directory=[];let offset=0;const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
    for(const {name,bytes} of entries){const filename=enc.encode(name),sum=crc(bytes),header=new Uint8Array(30+filename.length),v=new DataView(header.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,sum,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);header.set(filename,30);chunks.push(header,bytes);
      const central=new Uint8Array(46+filename.length),d=new DataView(central.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,sum,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);central.set(filename,46);directory.push(central);offset+=header.length+bytes.length;
    }
    const size=directory.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);return new Blob([...chunks,...directory,end],{type:'application/zip'});
  }
  return {safeUrl,attributes,parseMaster,recommended,offlinePlaylist,zipStored};
})();
if(typeof module!=='undefined')module.exports=MyMelterFeatures;
