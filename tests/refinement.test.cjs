const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const canvasSource = fs.readFileSync('static/js/canvas.js', 'utf8');
const appSource = fs.readFileSync('static/js/app.js', 'utf8');

test('manual actions explain mismatched guidance and reveal the applied cutout', async () => {
    const listeners = {};
    const elements = new Map();
    const alerts = [];
    const studio = { fgPoints: [], bgPoints: [], brush: true, strokeCtx: { clearRect() { studio.brush = false; } },
        hasBrushStrokes() { return this.brush; }, getBrushStrokesAsBase64: () => 'strokes',
        setViewMode(view) { this.view = view; }, updateCutoutAndAlpha(cutout, alpha) { this.displayed = alpha; } };
    const sandbox = { studio, viewPills: [], alert: message => alerts.push(message),
        snapshot: () => ({}), remember() {}, readControls: () => ({}), setLoading() {}, showToast() {}, clearTimeout() {},
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, { value: '0', addEventListener(name, fn) { listeners[id] = fn; } });
            return elements.get(id);
        } },
        ApiClient: { async rematTrimap(payload) {
                assert.equal(payload.strokes_base64, 'strokes');
                assert.equal(payload.alpha_base64, 'old');
                return { success: true, alpha_url: 'edited', cutout_url: 'cutout' };
            },
            async interactiveRefine() { return { success: true, alpha_url: 'point-edited', cutout_url: 'point-cutout' }; } } };
    vm.createContext(sandbox);
    const handlers = appSource.slice(appSource.indexOf('    function showRefinementResult'), appSource.indexOf('    function triggerPostAdjustment'));
    vm.runInContext("let isProcessing=false, currentOriginalB64='original', currentAlphaB64='old', currentImageId=null, baseAlphaB64='old', currentCutoutB64='old', committedControls={}, editRevision=0, adjustDebounce=null;\n" + handlers, sandbox);
    await listeners.runPointRefineBtn();
    assert.match(alerts.pop(), /Brush marks use Apply brush edits/);
    await listeners.runTrimapMatBtn();
    assert.equal(studio.view, 'cutout');
    assert.equal(studio.displayed, 'edited');
    assert.equal(studio.brush, false);
    studio.fgPoints.push({ x: 5, y: 5 });
    await listeners.runTrimapMatBtn();
    assert.match(alerts.pop(), /Point marks use Run point refine/);
    await listeners.runPointRefineBtn();
    assert.equal(studio.displayed, 'point-edited');
    assert.equal(studio.fgPoints.length, 0);
});

test('trimap retains existing mask and applies foreground, background, and unknown strokes', () => {
    const baseline = [0, 128, 255, 0, 255, 255];
    const pixels = new Uint8ClampedArray(baseline.flatMap(v => [v, v, v, 255]));
    const strokes = new Uint8ClampedArray([
        0,0,0,0, 0,0,0,0, 0,0,0,0,
        34,197,94,217, 239,68,68,217, 234,179,8,217
    ]);
    const ctx = { drawImage() {}, getImageData: () => ({ data: pixels }), putImageData() {} };
    const sandbox = { document: { createElement: () => ({ getContext: () => ctx, toDataURL: () => pixels }) } };
    vm.createContext(sandbox);
    vm.runInContext(canvasSource + '\nthis.StudioCanvas = StudioCanvas;', sandbox);
    const studio = Object.create(sandbox.StudioCanvas.prototype);
    Object.assign(studio, { imgWidth: 6, imgHeight: 1, alphaImg: { complete: true, naturalWidth: 6 },
        strokeCtx: { getImageData: () => ({ data: strokes }) } });
    const result = studio.getTrimapAsBase64();
    assert.deepEqual([0,1,2,3,4,5].map(i => result[i * 4]), [0,128,255,255,0,128]);
});

test('brush click uses the selected brush color', () => {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(canvasSource + '\nthis.StudioCanvas = StudioCanvas;', sandbox);
    const ctx = { beginPath() {}, arc() {}, moveTo() {}, fill() { this.painted = this.fillStyle; } };
    const studio = Object.create(sandbox.StudioCanvas.prototype);
    Object.assign(studio, { strokeCtx: ctx, brushSize: 10, activeTool: 'brush_fg' });
    studio.paintStroke(2, 2, true);
    assert.equal(ctx.painted, 'rgba(34, 197, 94, 0.85)');
});

test('late image decodes cannot replace a newer mask pair', () => {
    const images = [];
    const sandbox = { Image: class { constructor() { images.push(this); } } };
    vm.createContext(sandbox);
    vm.runInContext(canvasSource + '\nthis.StudioCanvas = StudioCanvas;', sandbox);
    const studio = Object.create(sandbox.StudioCanvas.prototype);
    studio.currentLoadId = 1;
    studio.render = () => {};
    studio.updateCutoutAndAlpha('old-cutout', 'old-alpha');
    studio.updateCutoutAndAlpha('new-cutout', 'new-alpha');
    images[2].onload();
    images[3].onload();
    images[0].onload();
    images[1].onload();
    assert.equal(studio.alphaImg.src, 'new-alpha');
    assert.equal(studio.cutoutImg.src, 'new-cutout');
});

test('newest slider result wins; undo and redo restore masks, guides, and stable adjustment base', async () => {
    const elements = new Map();
    const tasks = [];
    const pending = [];
    const handlers = {};
    const strokeCtx = { clearRect() {}, drawImage(image) { this.restored = image.src; } };
    const studio = { fgPoints: [], bgPoints: [], strokeCanvas: { toDataURL: () => 'guides' }, strokeCtx,
        updateCutoutAndAlpha(cutout, alpha) { this.displayed = alpha; }, render() {} };
    const sandbox = { studio, structuredClone, console, sliders: [],
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, { id, value: '1' });
            return elements.get(id);
        }, querySelectorAll: () => [], addEventListener(name, handler) { handlers[name] = handler; } },
        setTimeout(fn) { tasks.push(fn); return tasks.length; }, clearTimeout() {}, alert: assert.fail,
        Image: class { set src(value) { this.url = value; queueMicrotask(() => this.onload()); } get src() { return this.url; } },
        ApiClient: { adjustPost(payload) { return new Promise(resolve => pending.push({ payload, resolve })); } } };
    vm.createContext(sandbox);
    const state = appSource.slice(appSource.indexOf('    let currentImageId'), appSource.indexOf('    function showToast'));
    const adjust = appSource.slice(appSource.indexOf('    function triggerPostAdjustment'), appSource.indexOf('    const sliders ='));
    vm.runInContext(state + '\nfunction setLoading(active) { isProcessing = active; }\n' + adjust, sandbox);
    vm.runInContext("currentOriginalB64='original'; currentAlphaB64=baseAlphaB64='base'; currentCutoutB64='initial'; triggerPostAdjustment();", sandbox);
    const first = tasks.shift()();
    vm.runInContext('triggerPostAdjustment()', sandbox);
    const second = tasks.shift()();
    assert.equal(pending[0].payload.alpha_base64, 'base');
    assert.equal(pending[1].payload.alpha_base64, 'base');
    pending[1].resolve({ success: true, alpha_url: 'newest', cutout_url: 'newest-cutout' });
    await second;
    pending[0].resolve({ success: true, alpha_url: 'stale', cutout_url: 'stale-cutout' });
    await first;
    assert.equal(studio.displayed, 'newest');
    assert.equal(vm.runInContext('undoStack.length', sandbox), 1);
    handlers.keydown({ ctrlKey: true, key: 'z', target: { closest: () => null }, preventDefault() {} });
    await Promise.resolve();
    assert.equal(studio.displayed, 'base');
    assert.equal(strokeCtx.restored, 'guides');
    handlers.keydown({ ctrlKey: true, shiftKey: true, key: 'Z', target: { closest: () => null }, preventDefault() {} });
    await Promise.resolve();
    assert.equal(studio.displayed, 'newest');
    assert.equal(vm.runInContext('baseAlphaB64', sandbox), 'base');
    vm.runInContext('restoreEdit(undoStack, redoStack)', sandbox);
    await Promise.resolve();
    studio.onBeforeEdit();
    assert.equal(vm.runInContext('redoStack.length', sandbox), 0);
});
