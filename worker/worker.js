// MyMelter CORS Bridge - Cloudflare Workers 無料枠向け
// 推奨: Worker の環境変数 MYMELTER_KEY に自分だけの長いキーを設定し、
// MyMelter > 設定 > Workerキー に同じ値を入れてください。
// このWorkerはCookieを転送せず、GETのみ、プライベート/ローカル宛先を拒否します。

function blockedHost(host){
  const h=host.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')||h==='0.0.0.0'||h==='127.0.0.1'||h==='::1'||h==='169.254.169.254') return true;
  if(/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||/^169\.254\./.test(h)) return true;
  return false;
}
export default {
  async fetch(request, env) {
    const req=new URL(request.url);
    if(request.method==='OPTIONS') return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if(request.method!=='GET') return new Response('GET only',{status:405});
    const targetRaw=req.searchParams.get('url'); if(!targetRaw) return new Response('Missing url',{status:400});
    if(env.MYMELTER_KEY && req.searchParams.get('key')!==env.MYMELTER_KEY) return new Response('Unauthorized',{status:401});
    let target; try{target=new URL(targetRaw);}catch{return new Response('Invalid url',{status:400});}
    if(!['http:','https:'].includes(target.protocol)||blockedHost(target.hostname)) return new Response('Target blocked',{status:403});
    const upstream=await fetch(target.href,{method:'GET',headers:{'Accept':'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5','User-Agent':'Mozilla/5.0 (compatible; MyMelter/1.0)'},redirect:'follow'});
    const headers=new Headers(upstream.headers); headers.set('Access-Control-Allow-Origin','*'); headers.set('Cache-Control','private, max-age=90'); headers.delete('set-cookie'); headers.delete('content-security-policy'); headers.delete('content-security-policy-report-only');
    return new Response(upstream.body,{status:upstream.status,headers});
  }
};
