// MyMelter CORS Bridge - Cloudflare Workers 無料枠向け
// MyMelter 1.1: ブラウザ互換ヘッダー + upstream診断。
// Cookie/認証情報は転送せず、GETのみ、プライベート/ローカル宛先を拒否します。
// 取得先が403を返した場合は、その403を維持して「Worker到達済み / upstream拒否」を
// MyMelter側で判別できる診断ヘッダーを返します。IP回避やCAPTCHA回避は行いません。

const CORS_HEADERS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type,Range',
  'Access-Control-Expose-Headers':'X-MyMelter-Error,X-MyMelter-Upstream-Status,X-MyMelter-Final-URL,X-MyMelter-Worker-Version,Content-Type,Content-Length,Content-Range,Accept-Ranges,Content-Disposition'
};

function blockedHost(host){
  const h=host.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')||h==='0.0.0.0'||h==='127.0.0.1'||h==='::1'||h==='169.254.169.254') return true;
  if(/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||/^169\.254\./.test(h)) return true;
  return false;
}

function safeFilename(name){
  const cleaned=String(name||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').replace(/\s+/g,' ').trim().slice(0,120);
  return cleaned||'MyMelter_media';
}

function plain(message,status,errorCode,extra={}){
  return new Response(message,{
    status,
    headers:{
      ...CORS_HEADERS,
      'Content-Type':'text/plain; charset=utf-8',
      'X-MyMelter-Error':errorCode,
      'X-MyMelter-Worker-Version':'1.3'
      ,...extra
    }
  });
}

export default {
  async fetch(request, env) {
    const req=new URL(request.url);

    if(request.method==='OPTIONS'){
      return new Response(null,{status:204,headers:{...CORS_HEADERS,'X-MyMelter-Worker-Version':'1.3'}});
    }
    if(request.method!=='GET') return plain('GET only',405,'method-not-allowed');

    const targetRaw=req.searchParams.get('url');
    if(!targetRaw) return plain('Missing url',400,'missing-url');
    const downloadRequested=req.searchParams.get('download')==='1';
    const requestedFilename=safeFilename(req.searchParams.get('filename')||'');

    if(env.MYMELTER_KEY && req.searchParams.get('key')!==env.MYMELTER_KEY){
      return plain('Unauthorized',401,'worker-key');
    }

    let target;
    try{target=new URL(targetRaw);}catch{return plain('Invalid url',400,'invalid-url');}
    if(!['http:','https:'].includes(target.protocol)||blockedHost(target.hostname)){
      return plain('Target blocked',403,'target-blocked');
    }

    // 通常ブラウザに近いAccept/言語/UAにして、単純な互換性問題を減らす。
    // MyMelterトークンも残し、CAPTCHA・Cookie・認証・IP制限は回避しない。
    const isMedia=req.searchParams.get('media')==='1'||/(^|\.)video\.twimg\.com$/i.test(target.hostname);
    const upstreamHeaders=new Headers({
      'Accept':isMedia?'video/*,*/*;q=0.8':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language':'ja-JP,ja;q=0.9,en-US;q=0.6,en;q=0.5',
      'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1 MyMelter/1.3'
    });
    const range=request.headers.get('Range'); if(range) upstreamHeaders.set('Range',range);

    let upstream;
    try{
      upstream=await fetch(target.href,{method:'GET',headers:upstreamHeaders,redirect:'follow'});
    }catch(err){
      return plain(`Upstream fetch failed: ${err?.message||'network error'}`,502,'upstream-network',{
        'X-MyMelter-Final-URL':target.href
      });
    }

    const headers=new Headers(upstream.headers);
    for(const [k,v] of Object.entries(CORS_HEADERS)) headers.set(k,v);
    headers.set('Cache-Control','private, max-age=90');
    headers.set('X-MyMelter-Worker-Version','1.2');
    headers.set('X-MyMelter-Upstream-Status',String(upstream.status));
    headers.set('X-MyMelter-Final-URL',upstream.url||target.href);
    headers.set('X-MyMelter-Error',upstream.ok?'none':'upstream-http');
    if(downloadRequested&&upstream.ok){
      const pathName=decodeURIComponent(new URL(upstream.url||target.href).pathname.split('/').pop()||'');
      const fallbackExt=(headers.get('Content-Type')||'').includes('video/mp4')?'.mp4':'';
      const filename=safeFilename(requestedFilename||pathName||('MyMelter_media'+fallbackExt));
      headers.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(filename));
      headers.set('Cache-Control','no-store');
    }
    headers.delete('set-cookie');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');

    return new Response(upstream.body,{status:upstream.status,headers});
  }
};
