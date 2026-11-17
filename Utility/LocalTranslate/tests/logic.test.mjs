import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { MODEL, MODEL_URL, LANGUAGES, buildPrompt } from '../core.js';
import { savedModel, downloadModel, removeModel, modelLock } from '../storage.js';

const results = [];
function check(name, fn) { fn(); results.push(name); }
check('公式PFML3形式・原文言語の自動検出', () => {
  assert.equal(buildPrompt('Hello.', 'auto', 'ja'), '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>Hello.<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>');
  assert.match(buildPrompt('こんにちは', 'ja', 'en'), /input<\|plamo:key\|>lang<\|plamo:val\|>ja/);
});
check('空文・長文・制御トークン・同一言語を拒否', () => {
  for (const text of ['', ' ', 'a'.repeat(601), '<|plamo:tag|>output']) assert.throws(() => buildPrompt(text, 'auto', 'ja'));
  assert.throws(() => buildPrompt('hello','en','en'));
  assert.throws(() => buildPrompt('hello','auto','invalid'));
});
check('53言語と固定リビジョン', () => {
  assert.equal(LANGUAGES.length, 53);
  assert.equal(new Set(LANGUAGES.map(([id]) => id)).size, 53);
  assert(LANGUAGES.some(([id]) => id === 'zh-hans'));
  assert(LANGUAGES.some(([id]) => id === 'zh-hant'));
  assert(MODEL_URL.includes(MODEL.revision));
});

// 実容量を割り当てず、ストリームとファイルAPIの契約を検証する。
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalFetch = globalThis.fetch;
let committedSize = null, written = 0, aborts = 0, deleted = 0, chunks = [], httpStatus = 200, magic = 'GGUF';
const dir = {
  async getFileHandle(_name, options) {
    if (committedSize === null && !options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
    return {
      async getFile() { return { size: committedSize, slice() { return new Blob([magic]); } }; },
      async createWritable() { written = 0; return {
        async write(value) { written += value.byteLength; },
        async close() { committedSize = written; },
        async abort() { aborts++; },
      }; },
    };
  },
  async removeEntry() { committedSize = null; deleted++; },
};
Object.defineProperty(globalThis, 'navigator', { configurable:true, value: {
  storage: { async getDirectory() { return { async getDirectoryHandle(){ return dir; }, async removeEntry(){ committedSize = null; deleted++; } }; } },
  locks: { async request(_name,_options,callback) { return callback({ name:'test' }); } },
} });
globalThis.fetch = async (_url, options) => ({ ok: httpStatus === 200, status: httpStatus, body: { getReader() { return {
  async read() { options.signal.throwIfAborted(); const value = chunks.shift(); return value ? {done:false,value} : {done:true}; },
  async cancel() {}, releaseLock() {},
}; } } });
try {
  assert.equal(await savedModel(), null);
  committedSize = MODEL.bytes - 1; assert.equal(await savedModel(), null);
  committedSize = MODEL.bytes; magic = 'HTML'; assert.equal(await savedModel(), null);
  magic = 'GGUF'; assert.equal((await savedModel()).size, MODEL.bytes);
  results.push('保存済み判定は完全なサイズとGGUFヘッダーを要求');
  committedSize = null; chunks = [{byteLength:MODEL.bytes}];
  let progress = 0;
  const file = await downloadModel(new AbortController().signal, value => progress = value);
  assert.equal(file.size, MODEL.bytes); assert.equal(progress, MODEL.bytes);
  results.push('完全なダウンロードだけを確定');
  chunks = [{byteLength:10}];
  await assert.rejects(downloadModel(new AbortController().signal, () => {}), /途中/);
  assert.equal(committedSize, null); assert(aborts > 0 && deleted > 0);
  results.push('途中切断で不完全ファイルを削除');
  const controller = new AbortController(); controller.abort(); chunks = [{byteLength:MODEL.bytes}];
  await assert.rejects(downloadModel(controller.signal, () => {}), {name:'AbortError'});
  assert.equal(committedSize, null);
  results.push('中止時に保存済みモデルを残さない');
  httpStatus = 404;
  await assert.rejects(downloadModel(new AbortController().signal, () => {}), /404/);
  assert.equal(committedSize, null);
  results.push('HTTPエラーのファイルを保存しない');
  committedSize = MODEL.bytes; await removeModel(); assert.equal(committedSize, null);
  navigator.locks.request = async (_name,_options,callback) => callback(null);
  let ran = false; await assert.rejects(modelLock(() => { ran = true; }), /別のタブ/); assert.equal(ran, false);
  results.push('削除・タブ間排他制御');
} finally {
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
}
export { results };
