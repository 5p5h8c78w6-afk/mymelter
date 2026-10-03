const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('./content-engine.js');

test('ranked videos beat duplicate poster-only images and stay in rank order',()=>{
  const out=E.mergeItems(
    [{id:'img1',url:'https://site.example/a',image:'https://cdn.example/a.jpg',type:'image'}],
    [{id:'r2',url:'https://x.com/2',image:'https://cdn.example/b.jpg',videoUrl:'https://cdn.example/b.mp4',type:'video',browserRank:'2'},
     {id:'r1',url:'https://x.com/1',image:'https://cdn.example/a.jpg',videoUrl:'https://cdn.example/a.mp4',type:'video',browserRank:'1'}]
  );
  assert.deepEqual(out.map(x=>x.id),['r1','r2']);
});

test('same URL evidence merges into the richer playable record',()=>{
  const out=E.mergeItems(
    [{id:'a',url:'https://site.example/post/1',image:'https://cdn.example/1.jpg',type:'image'}],
    [{id:'b',url:'https://site.example/post/1',image:'https://cdn.example/1.jpg',videoUrl:'https://cdn.example/1.mp4',type:'video'}]
  );
  assert.equal(out.length,1);assert.equal(E.kind(out[0]),'video');assert.equal(out[0].videoUrl,'https://cdn.example/1.mp4');
});

test('explicit article and image types override incidental media fields',()=>{
  assert.equal(E.kind({type:'article',videoUrl:'https://cdn.example/ad.mp4'}),'article');
  assert.equal(E.kind({type:'image',videoUrl:'https://cdn.example/ad.mp4'}),'image');
});

test('video profile uses evidence, not raw thumbnail count',()=>{
  const videos=[
    {url:'https://x.com/1',videoUrl:'https://cdn.example/1.mp4',image:'https://cdn.example/1.jpg',type:'video',browserRank:'1'},
    {url:'https://x.com/2',videoUrl:'https://cdn.example/2.mp4',image:'https://cdn.example/2.jpg',type:'video',browserRank:'2'}
  ];
  const thumbs=videos.map((v,i)=>({url:'https://site.example/t'+i,image:v.image,type:'image'}));
  const p=E.profile([...thumbs,...videos]);
  assert.equal(p.mode,'video');assert.equal(p.counts.video,2);assert.equal(p.counts.image,0);
});

test('article profile remains article when a page contains one incidental video',()=>{
  const items=[
    {url:'https://news.example/1',type:'article',excerpt:'a'.repeat(150)},
    {url:'https://news.example/2',type:'article',excerpt:'b'.repeat(150)},
    {url:'https://news.example/3',type:'article',excerpt:'c'.repeat(150)},
    {url:'https://news.example/ad',videoUrl:'https://ads.example/ad.mp4',type:'video'}
  ];
  assert.equal(E.profile(items).mode,'article');
});

test('category snapshots are normalized and deduplicated by content engine',()=>{
  const out=E.normalizeCategorySnapshots({
    'https://site.example/rank#top':[
      {url:'https://x.com/1',videoUrl:'https://cdn.example/1.mp4',type:'video',browserRank:'1'},
      {url:'https://x.com/1',videoUrl:'https://cdn.example/1.mp4',type:'video',browserRank:'1'}
    ]
  });
  assert.equal(Object.keys(out)[0],'https://site.example/rank');assert.equal(out['https://site.example/rank'].length,1);
});

test('channelItems exposes one unified list instead of snapshot/deep divergence',()=>{
  const ch={snapshotItems:[{id:'thumb',url:'https://site.example/t',image:'https://cdn.example/a.jpg',type:'image'}],
    deepDiveItems:[{id:'rank',url:'https://x.com/1',image:'https://cdn.example/a.jpg',videoUrl:'https://cdn.example/a.mp4',type:'video',browserRank:'1'}]};
  const out=E.channelItems(ch);assert.deepEqual(out.map(x=>x.id),['rank']);
});

test('diagnostics reports playable ranked video evidence',()=>{
  const d=E.diagnostics([{url:'https://x.com/1',videoUrl:'https://cdn.example/1.mp4',type:'video',browserRank:'1'}]);
  assert.equal(d.mode,'video');assert.equal(d.playableVideos,1);assert.equal(d.rankedVideos,1);
});
