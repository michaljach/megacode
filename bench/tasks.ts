export type Task = { id: string; prompt: string; files: Record<string, string>; tests: string };

const instructions = "Fix the requested behavior without changing public exports. Add regression tests and run them with node --test. No dependencies. Keep the change focused.";
export const tasks: Task[] = [
  {
    id: "range-parser",
    prompt: `${instructions}\nImplement parseRanges(text) in src/ranges.js: accept comma-separated positive integers and inclusive ascending ranges, allowing surrounding whitespace. Return sorted unique numbers. Empty/whitespace-only input returns []. Reject empty items, non-integers, zero, negatives, descending ranges, and values over 10000 with RangeError.`,
    files: {
      "src/ranges.js": "export function parseRanges(text) { return text.split(',').map(Number); }\n",
    },
    tests: `
test('expand, sort and deduplicate', () => assert.deepEqual(mod.parseRanges(' 4, 1-3, 2, 7-7 '), [1,2,3,4,7]));
test('empty input', () => { for (const s of ['', '  ', '\\n']) assert.deepEqual(mod.parseRanges(s), []); });
test('reject malformed syntax', () => { for (const s of ['1,', ',1', '1,,2', '1.5', '1e2', '1-2-3', 'NaN', '+2']) assert.throws(() => mod.parseRanges(s), RangeError); });
test('reject invalid bounds', () => { for (const s of ['0', '-1', '3-2', '0-2', '10001', '1-10001']) assert.throws(() => mod.parseRanges(s), RangeError); });
test('boundary and range whitespace', () => assert.deepEqual(mod.parseRanges('9999 - 10000, 1'), [1,9999,10000]));
`,
  },
  {
    id: "inventory-transaction",
    prompt: `${instructions}\nFix reserve(stock, requests) in src/inventory.js. stock maps SKU strings to nonnegative integer counts; requests are {sku, quantity}. Validate every quantity is a positive safe integer, every SKU is an own property of stock, and aggregate duplicate requests before checking availability. Invalid requests throw RangeError. Insufficient stock throws RangeError. Never mutate stock or requests, on success or failure. Return a new stock object with reservations subtracted and unrelated SKUs preserved. Empty requests return a copy.`,
    files: {
      "src/inventory.js": "export function reserve(stock, requests) {\n  for (const {sku, quantity} of requests) {\n    if (stock[sku] < quantity) throw new RangeError('stock');\n    stock[sku] -= quantity;\n  }\n  return stock;\n}\n",
    },
    tests: `
test('reserve duplicate requests without mutation', () => { const stock = Object.freeze({a: 8, b: 2}); const requests = Object.freeze([Object.freeze({sku:'a', quantity:2}), Object.freeze({sku:'a', quantity:3})]); assert.deepEqual(mod.reserve(stock, requests), {a:3,b:2}); });
test('failure is atomic', () => { const stock = {a:3,b:1}; assert.throws(() => mod.reserve(stock, [{sku:'a',quantity:2},{sku:'b',quantity:2}]), RangeError); assert.deepEqual(stock,{a:3,b:1}); });
test('aggregate shortage', () => { const stock={a:3}; assert.throws(() => mod.reserve(stock,[{sku:'a',quantity:2},{sku:'a',quantity:2}]), RangeError); assert.equal(stock.a,3); });
test('quantity validation', () => { for (const quantity of [0,-1,1.5,NaN,Infinity,'2',Number.MAX_SAFE_INTEGER+1]) assert.throws(() => mod.reserve({a:5},[{sku:'a',quantity}]), RangeError); });
test('own SKU validation', () => { for (const sku of ['missing','toString','constructor','__proto__']) assert.throws(() => mod.reserve({a:5},[{sku,quantity:1}]), RangeError); });
test('empty copy', () => { const stock={a:5}; const result=mod.reserve(stock,[]); assert.deepEqual(result,stock); assert.notEqual(result,stock); });
`,
  },
  {
    id: "log-recovery",
    prompt: `${instructions}\nThe diagnostics command is node scripts/diagnose.js. Run it and fix the formatter defect it reports. src/format.js contains a large immutable catalog: do not change catalog entries. formatBytes must reject negative/non-finite inputs with RangeError, return '0 B' for zero, and use base-1024 units B/KiB/MiB/GiB (capped at GiB), rounded to one decimal with no trailing .0.`,
    files: {
      "src/format.js": Array.from({length: 420}, (_,i) => `// catalog ${i}: immutable compatibility entry`).join("\n") + "\nexport function formatBytes(bytes) { return bytes + ' B'; }\n",
      "scripts/diagnose.js": "for (let i=0;i<1500;i++) console.log('OK catalog compatibility check '+i);\nconsole.log('FAIL src/format.js: formatBytes(1536): expected 1.5 KiB, got 1536 B');\nprocess.exitCode=1;\n",
    },
    tests: `
test('zero and bytes', () => { assert.equal(mod.formatBytes(0),'0 B'); assert.equal(mod.formatBytes(12),'12 B'); assert.equal(mod.formatBytes(1.25),'1.3 B'); });
test('binary units and rounding', () => { assert.equal(mod.formatBytes(1024),'1 KiB'); assert.equal(mod.formatBytes(1536),'1.5 KiB'); assert.equal(mod.formatBytes(1024**2),'1 MiB'); assert.equal(mod.formatBytes(1024**3),'1 GiB'); assert.equal(mod.formatBytes(1024**4),'1024 GiB'); });
test('invalid inputs', () => { for (const value of [-1,NaN,Infinity,-Infinity]) assert.throws(() => mod.formatBytes(value), RangeError); });
test('catalog preserved', async () => { const source=await readFile(path.join(process.env.BENCH_WORKSPACE,'src/format.js'),'utf8'); for(let i=0;i<420;i++) assert.ok(source.includes('// catalog '+i+': immutable compatibility entry')); });
`,
  },
];
