const http = require('node:http');
const assert = require('node:assert/strict');

// Three seconds of generated 32x32 H.264 testsrc2, with a one-second GOP.
const clip = Buffer.from('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', 'base64');

module.exports = async function testSavedMedia(browser, appUrl) {
  const requests = [];
  const media = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push({path, referer: req.headers.referer});
    if (path === '/missing.mp4' || req.headers.referer) {
      res.writeHead(403).end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(range && range[2] ? Number(range[2]) : clip.length - 1, clip.length - 1);
    if (start > end) { res.writeHead(416).end(); return; }
    const headers = {'Content-Type':'video/mp4', 'Accept-Ranges':'bytes', 'Content-Length':end-start+1};
    if (range) headers['Content-Range'] = 'bytes '+start+'-'+end+'/'+clip.length;
    res.writeHead(range ? 206 : 200, headers).end(clip.subarray(start,end+1));
  });
  await new Promise(resolve => media.listen(0,'127.0.0.1',resolve));
  const context = await browser.newContext({viewport:{width:390,height:844}});
  try {
    const page = await context.newPage();
    const origin = 'http://127.0.0.1:'+media.address().port;
    const items = ['first','missing','last'].map(name => ({
      t:name, y:'video', u:'https://source.example/'+name, m:origin+'/'+name+'.mp4?token=PRIVATE'
    }));
    const payload = {v:28,s:'https://source.example/',n:'Media regression',i:items};
    await page.goto(appUrl+'#mmimport='+encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64')));
    await page.locator('[data-video-gallery-open="0"]').waitFor();
    await page.reload();
    await page.locator('[data-open-channel]:visible').first().click();
    await page.locator('[data-video-gallery-open="0"]').click();
    const progressing = index => page.waitForFunction(i => {
      const video = document.querySelector('.is-current video[data-feed-video="'+i+'"]');
      return video && video.duration>0 && video.currentTime>.35 && video.getVideoPlaybackQuality().totalVideoFrames>1;
    },index,{timeout:10000});
    await progressing(0);
    const move = index => page.locator('[data-feed-index="'+index+'"]').evaluate(slide => {
      document.querySelector('#videoFeed').scrollTo({top:slide.offsetTop,behavior:'instant'});
    });
    await move(1);
    const failure = page.locator('.is-current.video-load-error [data-feed-error-detail]');
    await failure.waitFor();
    assert.match(await failure.textContent(),/HTTP:不明/);
    assert.match(await failure.textContent(),/取り込み元:source\.example/);
    assert.doesNotMatch(await failure.textContent(),/PRIVATE/);
    const failures = () => requests.filter(r => r.path==='/missing.mp4').length;
    const count = failures();
    await page.waitForTimeout(1600);
    assert.ok(count>0);
    assert.equal(failures(),count);
    await move(2);
    await progressing(2);
    assert.ok(requests.some(r=>r.path==='/first.mp4'));
    assert.ok(requests.some(r=>r.path==='/last.mp4'));
    assert.ok(requests.every(r=>!r.referer));
  } finally {
    await context.close();
    await new Promise(resolve=>media.close(resolve));
  }
};
