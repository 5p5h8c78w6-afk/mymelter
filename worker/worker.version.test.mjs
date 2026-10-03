import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('./worker.js', import.meta.url), 'utf8');

function buildWorker(upstreamFetch = async () => new Response('ok')) {
  const transformed = workerSource.replace(/export default\s*\{/, 'const worker = {');
  const factory = new Function('fetch', `${transformed}\nreturn worker;`);
  return factory(upstreamFetch);
}

async function callWorker({
  requestUrl = 'https://worker.example/?url=https%3A%2F%2Fexample.com%2F',
  method = 'GET',
  headers,
  env = {},
  upstreamFetch,
} = {}) {
  const worker = buildWorker(upstreamFetch);
  return worker.fetch(new Request(requestUrl, { method, headers }), env);
}

function versionAtLeast(version, min = '1.3') {
  const a = String(version || '').split('.').map(Number);
  const b = String(min).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

test('01 OPTIONS advertises Worker 1.3', async () => {
  const r = await callWorker({ method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('02 missing url plain error advertises Worker 1.3', async () => {
  const r = await callWorker({ requestUrl: 'https://worker.example/' });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('03 non-GET plain error advertises Worker 1.3', async () => {
  const r = await callWorker({ method: 'POST' });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('04 worker-key plain error advertises Worker 1.3', async () => {
  const r = await callWorker({
    requestUrl: 'https://worker.example/?url=https%3A%2F%2Fexample.com%2F&key=wrong',
    env: { MYMELTER_KEY: 'expected' },
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('05 invalid-url plain error advertises Worker 1.3', async () => {
  const r = await callWorker({
    requestUrl: 'https://worker.example/?url=not-a-url',
  });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('06 blocked-target plain error advertises Worker 1.3', async () => {
  const r = await callWorker({
    requestUrl: 'https://worker.example/?url=http%3A%2F%2F127.0.0.1%2F',
  });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('07 upstream network plain error advertises Worker 1.3', async () => {
  const r = await callWorker({
    upstreamFetch: async () => { throw new Error('network down'); },
  });
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('08 upstream success 200 advertises Worker 1.3', async () => {
  const r = await callWorker({
    upstreamFetch: async () => new Response('ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('09 upstream partial 206 advertises Worker 1.3 and forwards Range', async () => {
  let seenRange = '';
  const r = await callWorker({
    headers: { Range: 'bytes=0-99' },
    upstreamFetch: async (_url, init) => {
      seenRange = new Headers(init.headers).get('Range') || '';
      return new Response('partial', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-99/1000',
          'Accept-Ranges': 'bytes',
        },
      });
    },
  });
  assert.equal(seenRange, 'bytes=0-99');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('10 upstream 403 advertises Worker 1.3', async () => {
  const r = await callWorker({
    upstreamFetch: async () => new Response('forbidden', { status: 403 }),
  });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('11 upstream 500 advertises Worker 1.3', async () => {
  const r = await callWorker({
    upstreamFetch: async () => new Response('server error', { status: 500 }),
  });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
});

test('12 download=1 success keeps Worker 1.3 and returns attachment', async () => {
  const r = await callWorker({
    requestUrl: 'https://worker.example/?url=https%3A%2F%2Fvideo.twimg.com%2Fclip.mp4&media=1&download=1&filename=test.mp4',
    upstreamFetch: async () => new Response('video', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5' },
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-MyMelter-Worker-Version'), '1.3');
  assert.match(r.headers.get('Content-Disposition') || '', /^attachment;/);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('13 app probe semantics enable download for actual Worker 1.3 response', async () => {
  const r = await callWorker({
    upstreamFetch: async () => new Response('ok', { status: 200 }),
  });
  const version = r.headers.get('X-MyMelter-Worker-Version') || '';
  assert.equal(versionAtLeast(version, '1.3'), true);
});

test('14 app probe semantics keep old Worker 1.2 download-disabled', () => {
  assert.equal(versionAtLeast('1.2', '1.3'), false);
});
