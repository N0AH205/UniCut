document.addEventListener('DOMContentLoaded', async () => {
    const canvasEl = document.getElementById('mainCanvas');
    const containerEl = document.getElementById('canvasContainer');
    const brushCursor = document.getElementById('brushCursorRing');
    const dropzone = document.getElementById('emptyDropzone');
    const fileInput = document.getElementById('imageFileInput');
    const bgFileInput = document.getElementById('bgFileInput');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingStage = document.getElementById('loadingStage');

    const studio = new StudioCanvas(canvasEl, containerEl, brushCursor);

    let currentImageId = null;
    let currentOriginalB64 = null;
    let currentAlphaB64 = null;
    let currentCutoutB64 = null;
    let isProcessing = false;
    let currentFilename = 'cutout.png';
    let baseAlphaB64 = null;
    let editRevision = 0;
    let adjustDebounce = null;
    const undoStack = [];
    const redoStack = [];
    const editControls = '#edgeShiftSlider, #edgeFeatherSlider, #gammaSlider, #despillModeSelect, #despillStrengthSlider, #shadowTypeSelect, #shadowOpacitySlider, #shadowBlurSlider, #shadowScaleSlider, #shadowOffsetSlider';
    let committedControls = {};

    function readControls() {
        return Object.fromEntries([...document.querySelectorAll(editControls)].map(el => [el.id, el.value]));
    }

    function snapshot() {
        return { alpha: currentAlphaB64, cutout: currentCutoutB64, base: baseAlphaB64,
            strokes: studio.strokeCanvas.toDataURL(),
            fg: structuredClone(studio.fgPoints), bg: structuredClone(studio.bgPoints),
            controls: { ...committedControls } };
    }

    function updateHistoryButtons() {
        document.getElementById('undoEditBtn').disabled = isProcessing || !undoStack.length;
        document.getElementById('redoEditBtn').disabled = isProcessing || !redoStack.length;
    }

    function remember(state = snapshot()) {
        if (!state.alpha) return;
        undoStack.push(state);
        if (undoStack.length > 12) undoStack.shift();
        redoStack.length = 0;
        updateHistoryButtons();
    }

    studio.onBeforeEdit = () => {
        editRevision++;
        clearTimeout(adjustDebounce);
        remember();
    };

    function restoreEdit(from, to) {
        if (isProcessing || !from.length) return;
        to.push(snapshot());
        const state = from.pop();
        const revision = ++editRevision;
        clearTimeout(adjustDebounce);
        currentImageId = null;
        currentAlphaB64 = state.alpha;
        currentCutoutB64 = state.cutout;
        baseAlphaB64 = state.base;
        committedControls = { ...state.controls };
        Object.entries(state.controls).forEach(([id, value]) => {
            document.getElementById(id).value = value;
        });
        sliders.forEach(control => {
            const value = document.getElementById(control.id).value;
            document.getElementById(control.valId).textContent = `${control.mult ? Math.round(value * control.mult) : value}${control.unit}`;
        });
        studio.fgPoints = structuredClone(state.fg);
        studio.bgPoints = structuredClone(state.bg);
        studio.updateCutoutAndAlpha(state.cutout, state.alpha);
        setLoading(true, 'Restoring edit...', 'History');
        const strokes = new Image();
        strokes.onload = () => {
            if (revision !== editRevision) return;
            studio.strokeCtx.clearRect(0, 0, studio.imgWidth, studio.imgHeight);
            studio.strokeCtx.globalCompositeOperation = 'source-over';
            studio.strokeCtx.drawImage(strokes, 0, 0);
            studio.render();
            setLoading(false);
        };
        strokes.onerror = () => { setLoading(false); alert('Could not restore brush guidance.'); };
        strokes.src = state.strokes;
        updateHistoryButtons();
    }

    document.getElementById('undoEditBtn').onclick = () => restoreEdit(undoStack, redoStack);
    document.getElementById('redoEditBtn').onclick = () => restoreEdit(redoStack, undoStack);
    document.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const textInput = event.target.closest('textarea, select, [contenteditable="true"], input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])');
        if (textInput) return;
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y') {
            event.preventDefault();
            if (key === 'y' || event.shiftKey) restoreEdit(redoStack, undoStack);
            else restoreEdit(undoStack, redoStack);
        }
    });


    function showToast(msg, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        const iconSvg = type === 'warning'
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        toast.innerHTML = `<span class="toast-icon">${iconSvg}</span><span>${msg}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function setLoading(active, text = 'Processing image...', stage = 'Neural Segmentation') {
        isProcessing = active;
        studio.editingDisabled = active;
        document.querySelectorAll(`${editControls}, #enableTilingToggle, #enableMattingToggle`).forEach(el => { el.disabled = active; });
        updateHistoryButtons();
        loadingOverlay.classList.toggle('active', active);
        document.getElementById('modelSelect').disabled = active;
        loadingText.textContent = text;
        loadingStage.textContent = stage;
    }

    try {
        const modelsData = await ApiClient.getModels();
        ['modelSelect', 'batchModelSelect'].forEach(id => {
            const select = document.getElementById(id);
            const selected = select.value;
            select.replaceChildren();
            modelsData.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name;
                select.appendChild(option);
            });
            if (modelsData.models.some(model => model.id === selected)) select.value = selected;
        });

        const activeProviderBadge = document.getElementById('activeProviderBadge');
        if (activeProviderBadge && modelsData.active_providers) {
            activeProviderBadge.textContent = modelsData.active_providers[0].replace('ExecutionProvider', '');
        }
    } catch (e) {
        console.error('Initial load error:', e);
    }

    async function runPipeline({ file = null, sample_id = null, b64 = null }) {
        if (isProcessing) return;
        const revision = ++editRevision;
        clearTimeout(adjustDebounce);
        setLoading(true, 'Running multi-stage background removal...', 'Stage 1: Base Mask Inference');

        try {
            const formData = new FormData();
            if (file) formData.append('file', file);
            if (sample_id) formData.append('sample_id', sample_id);
            if (b64) formData.append('image_base64', b64);

            formData.append('model_name', document.getElementById('modelSelect').value);
            formData.append('enable_matting', document.getElementById('enableMattingToggle').checked);
            formData.append('matting_method', document.getElementById('mattingMethodSelect').value);
            formData.append('trimap_radius', document.getElementById('trimapRadiusSlider').value);
            formData.append('enable_tiling', document.getElementById('enableTilingToggle').checked);
            formData.append('despill_mode', document.getElementById('despillModeSelect').value);
            formData.append('despill_strength', document.getElementById('despillStrengthSlider').value);
            formData.append('edge_shift', document.getElementById('edgeShiftSlider').value);
            formData.append('edge_feather', document.getElementById('edgeFeatherSlider').value);
            formData.append('gamma', document.getElementById('gammaSlider').value);

            const shadowTypeEl = document.getElementById('shadowTypeSelect');
            const shadowType = shadowTypeEl ? shadowTypeEl.value : 'none';
            formData.append('shadow_type', shadowType);
            formData.append('shadow_opacity', document.getElementById('shadowOpacitySlider').value);
            formData.append('shadow_blur', document.getElementById('shadowBlurSlider').value);
            formData.append('shadow_scale', document.getElementById('shadowScaleSlider').value);
            formData.append('shadow_offset_y', document.getElementById('shadowOffsetSlider').value);
            formData.append('shadow_offset_x', 0);

            loadingStage.textContent = 'Stage 2 & 3: Trimap & PyMatting Alpha Estimation';
            const data = await ApiClient.processImage(formData);

            if (revision !== editRevision) return;
            if (data.success) {
                undoStack.length = redoStack.length = 0;
                committedControls = readControls();
                baseAlphaB64 = data.base_alpha_url || data.alpha_url;
                currentImageId = data.image_id || null;
                currentOriginalB64 = data.orig_url;
                currentAlphaB64 = data.alpha_url;
                currentCutoutB64 = data.cutout_url;

                studio.loadImages({
                    origUrl: data.orig_url,
                    cutoutUrl: data.cutout_url,
                    alphaUrl: data.alpha_url,
                    trimapUrl: data.trimap_url,
                    width: data.width,
                    height: data.height
                });

                dropzone.style.display = 'none';
                const viewTag = document.getElementById('canvasViewTag');
                if (viewTag) viewTag.style.display = 'block';
                const backdropPanel = document.getElementById('floatingBackdropPanel');
                if (backdropPanel) backdropPanel.style.display = 'flex';

                updateMetricsUI(data.metrics);
                showToast('Cutout created successfully!');
            }
        } catch (err) {
            console.error(err);
            alert(`Pipeline error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }

    function updateMetricsUI(metrics) {
        if (!metrics) return;
        const totalEl = document.getElementById('metricTotalTime');
        if (totalEl) totalEl.textContent = `${metrics.total_ms}`;
        const baseEl = document.getElementById('metricBaseTime');
        if (baseEl) baseEl.textContent = `${metrics.base_inference_ms} ms`;
        const trimapEl = document.getElementById('metricTrimapTime');
        if (trimapEl) trimapEl.textContent = `${metrics.trimap_ms} ms`;
        const mattingEl = document.getElementById('metricMattingTime');
        if (mattingEl) mattingEl.textContent = `${metrics.alpha_matting_ms} ms`;
        const despillEl = document.getElementById('metricDespillTime');
        if (despillEl) despillEl.textContent = `${metrics.despill_ms} ms`;
    }

    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    function handleFileUpload(file) {
        currentFilename = `${file.name.split('.')[0]}_cutout.png`;
        runPipeline({ file });
    }

    const toolButtons = document.querySelectorAll('.tool-item[data-tool], .tool-btn[data-tool]');
    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            toolButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tool = btn.dataset.tool;
            studio.setTool(tool);

            const isBrush = tool.startsWith('brush_') || tool === 'eraser';
            const strip = document.getElementById('brushControlsStrip');
            if (strip) strip.style.display = isBrush ? 'flex' : 'flex';
        });
    });

    const brushSizeSlider = document.getElementById('brushSizeSlider');
    const brushSizeVal = document.getElementById('brushSizeVal');
    if (brushSizeSlider) {
        studio.setBrushSize(Number(brushSizeSlider.value));
        brushSizeSlider.addEventListener('input', (e) => {
            const sz = parseInt(e.target.value);
            if (brushSizeVal) brushSizeVal.textContent = `${sz}PX`;
            studio.setBrushSize(sz);
        });
    }

    const viewPills = document.querySelectorAll('.pill-btn[data-view]');
    viewPills.forEach(pill => {
        pill.addEventListener('click', () => {
            viewPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            studio.setViewMode(pill.dataset.view);
        });
    });

    const bgDots = document.querySelectorAll('.bg-dot[data-bg], .bg-swatch[data-bg]');
    const colorPickerInput = document.getElementById('backdropColorPicker');
    const colorPickerLabel = document.getElementById('customColorLabel');

    bgDots.forEach(dot => {
        dot.addEventListener('click', () => {
            bgDots.forEach(d => d.classList.remove('active'));
            if (colorPickerLabel) colorPickerLabel.classList.remove('active');
            dot.classList.add('active');
            const bg = dot.dataset.bg;
            if (bg === 'custom') {
                bgFileInput.click();
            } else {
                studio.setBackdrop(bg);
            }
        });
    });

    if (colorPickerInput) {
        const applyCustomColor = (color) => {
            bgDots.forEach(d => d.classList.remove('active'));
            if (colorPickerLabel) colorPickerLabel.classList.add('active');
            studio.setBackdrop('color', color);
        };
        colorPickerInput.addEventListener('input', (e) => applyCustomColor(e.target.value));
        colorPickerInput.addEventListener('change', (e) => applyCustomColor(e.target.value));
    }

    const customBgBtn = document.getElementById('customBgTriggerBtn');
    if (customBgBtn) {
        customBgBtn.addEventListener('click', () => bgFileInput.click());
    }

    bgFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            studio.setCustomBgImage(e.target.files[0]);
        }
    });

    document.getElementById('zoomInBtn').onclick = () => studio.setZoom(studio.zoom * 1.25);
    document.getElementById('zoomOutBtn').onclick = () => studio.setZoom(studio.zoom * 0.8);
    document.getElementById('zoomResetBtn').onclick = () => studio.fitToScreen();

    function showRefinementResult(res) {
        studio.setViewMode('cutout');
        viewPills.forEach(pill => pill.classList.toggle('active', pill.dataset.view === 'cutout'));
        studio.updateCutoutAndAlpha(res.cutout_url, res.alpha_url);
    }

    const runPointRefineBtn = document.getElementById('runPointRefineBtn');
    runPointRefineBtn.addEventListener('click', async () => {
        if (isProcessing || !currentOriginalB64 || !currentAlphaB64) return;
        if (studio.fgPoints.length === 0 && studio.bgPoints.length === 0) {
            alert(studio.hasBrushStrokes()
                ? 'Brush marks use Apply brush edits. Run point refine only applies Keep/Drop points.'
                : 'Place at least one Keep (+) or Drop (−) point on the image first.');
            return;
        }

        const before = snapshot();
        const revision = ++editRevision;
        clearTimeout(adjustDebounce);
        setLoading(true, 'Calculating GrabCut seed refinement...', 'Iterative Regional Growing');
        try {
            const payload = {
                image_id: null,
                image_base64: currentOriginalB64,
                fg_points: studio.fgPoints,
                bg_points: studio.bgPoints,
                mask_base64: currentAlphaB64,
                point_radius: 10,
                despill_mode: document.getElementById('despillModeSelect').value,
                despill_strength: parseFloat(document.getElementById('despillStrengthSlider').value),
                edge_shift: 0,
                edge_feather: 0
            };

            const res = await ApiClient.interactiveRefine(payload);

            if (revision !== editRevision) return;
            if (res.success) {
                const changed = res.alpha_url !== currentAlphaB64;
                remember(before);
                baseAlphaB64 = res.alpha_url;
                currentImageId = null;
                document.getElementById('edgeShiftSlider').value = 0;
                document.getElementById('edgeFeatherSlider').value = 0;
                document.getElementById('gammaSlider').value = 1;
                document.getElementById('edgeShiftVal').textContent = '0px';
                document.getElementById('edgeFeatherVal').textContent = '0px';
                document.getElementById('gammaVal').textContent = '1';
                committedControls = readControls();
                if (res.image_id) currentImageId = res.image_id;
                currentAlphaB64 = res.alpha_url;
                currentCutoutB64 = res.cutout_url;
                studio.fgPoints = [];
                studio.bgPoints = [];
                showRefinementResult(res);
                showToast(changed ? 'Point refinement applied. Showing the cutout.' : 'No mask change. Try points inside the area you want to change.', changed ? 'success' : 'warning');
            }
        } catch (e) {
            alert(e.message);
        } finally {
            setLoading(false);
        }
    });

    const runTrimapMatBtn = document.getElementById('runTrimapMatBtn');
    runTrimapMatBtn.addEventListener('click', async () => {
        if (isProcessing || !currentOriginalB64) return;
        if (!studio.hasBrushStrokes()) {
            alert(studio.fgPoints.length || studio.bgPoints.length
                ? 'Point marks use Run point refine. Apply brush edits only applies brush marks.'
                : 'Paint with Keep brush, Erase brush, or Matte brush first.');
            return;
        }
        let strokesB64;
        try { strokesB64 = studio.getBrushStrokesAsBase64(); }
        catch (error) { alert(error.message); return; }
        const before = snapshot();
        const revision = ++editRevision;
        clearTimeout(adjustDebounce);

        setLoading(true, 'Applying brush corrections...', 'Keep, erase, and local hair matting');
        try {
            const payload = {
                image_id: null,
                image_base64: currentOriginalB64,
                strokes_base64: strokesB64,
                alpha_base64: currentAlphaB64,
                matting_method: document.getElementById('mattingMethodSelect').value,
                despill_mode: document.getElementById('despillModeSelect').value,
                despill_strength: parseFloat(document.getElementById('despillStrengthSlider').value)
            };

            const res = await ApiClient.rematTrimap(payload);

            if (revision !== editRevision) return;
            if (res.success) {
                const changed = res.alpha_url !== currentAlphaB64;
                remember(before);
                baseAlphaB64 = res.alpha_url;
                currentImageId = null;
                document.getElementById('edgeShiftSlider').value = 0;
                document.getElementById('edgeFeatherSlider').value = 0;
                document.getElementById('gammaSlider').value = 1;
                document.getElementById('edgeShiftVal').textContent = '0px';
                document.getElementById('edgeFeatherVal').textContent = '0px';
                document.getElementById('gammaVal').textContent = '1';
                committedControls = readControls();
                if (res.image_id) currentImageId = res.image_id;
                currentAlphaB64 = res.alpha_url;
                currentCutoutB64 = res.cutout_url;
                studio.strokeCtx.clearRect(0, 0, studio.imgWidth, studio.imgHeight);
                showRefinementResult(res);
                showToast(changed ? 'Brush refinement applied. Showing the cutout.' : 'No mask change. Try Keep or Erase brush on the area to change.', changed ? 'success' : 'warning');
            }
        } catch (e) {
            alert(e.message);
        } finally {
            setLoading(false);
        }
    });

    document.getElementById('clearStrokesBtn').onclick = () => { if (!isProcessing) studio.clearUserStrokes(); };

    function triggerPostAdjustment() {
        if (isProcessing || !currentOriginalB64 || !baseAlphaB64) return;
        const revision = ++editRevision;
        clearTimeout(adjustDebounce);
        adjustDebounce = setTimeout(async () => {
            const before = snapshot();
            try {
                const shadowTypeEl = document.getElementById('shadowTypeSelect');
                const shadowType = shadowTypeEl ? shadowTypeEl.value : 'none';

                const payload = {
                    image_id: null,
                    image_base64: currentOriginalB64,
                    edge_shift: parseInt(document.getElementById('edgeShiftSlider').value),
                    edge_feather: parseFloat(document.getElementById('edgeFeatherSlider').value),
                    gamma: parseFloat(document.getElementById('gammaSlider').value),
                    despill_mode: document.getElementById('despillModeSelect').value,
                    despill_strength: parseFloat(document.getElementById('despillStrengthSlider').value),
                    shadow_type: shadowType,
                    shadow_opacity: parseFloat(document.getElementById('shadowOpacitySlider').value),
                    shadow_blur: parseInt(document.getElementById('shadowBlurSlider').value),
                    shadow_scale: parseFloat(document.getElementById('shadowScaleSlider').value),
                    shadow_offset_y: parseInt(document.getElementById('shadowOffsetSlider').value),
                    shadow_offset_x: 0
                };
                payload.alpha_base64 = baseAlphaB64;
                const controls = readControls();
                const res = await ApiClient.adjustPost(payload);
                if (revision !== editRevision) return;
                if (res.success) {
                    remember(before);
                    committedControls = controls;
                    if (res.image_id) currentImageId = res.image_id;
                    currentCutoutB64 = res.cutout_url;
                    currentAlphaB64 = res.alpha_url;
                    studio.updateCutoutAndAlpha(res.cutout_url, res.alpha_url);
                }
            } catch (err) {
                if (revision === editRevision) alert(err.message);
            }
        }, 60);
    }

    const sliders = [
        { id: 'trimapRadiusSlider', valId: 'trimapRadiusVal', unit: 'px', adjust: false },
        { id: 'edgeShiftSlider', valId: 'edgeShiftVal', unit: 'px', adjust: true },
        { id: 'edgeFeatherSlider', valId: 'edgeFeatherVal', unit: 'px', adjust: true },
        { id: 'gammaSlider', valId: 'gammaVal', unit: '', adjust: true },
        { id: 'despillStrengthSlider', valId: 'despillStrengthVal', unit: '%', mult: 100, adjust: true },
        { id: 'shadowOpacitySlider', valId: 'shadowOpacityVal', unit: '%', mult: 100, adjust: true },
        { id: 'shadowBlurSlider', valId: 'shadowBlurVal', unit: 'px', adjust: true },
        { id: 'shadowScaleSlider', valId: 'shadowScaleVal', unit: '%', mult: 100, adjust: true },
        { id: 'shadowOffsetSlider', valId: 'shadowOffsetVal', unit: 'px', adjust: true }
    ];

    sliders.forEach(s => {
        const el = document.getElementById(s.id);
        const valEl = document.getElementById(s.valId);
        if (!el || !valEl) return;
        el.addEventListener('input', (e) => {
            let v = e.target.value;
            if (s.mult) v = Math.round(v * s.mult);
            valEl.textContent = `${v}${s.unit}`;
            if (s.adjust) triggerPostAdjustment();
        });
    });

    const shadowTypeSelect = document.getElementById('shadowTypeSelect');
    const shadowControlsGroup = document.getElementById('shadowControlsGroup');
    const shadowContactControls = document.getElementById('shadowContactControls');
    const shadowDropControls = document.getElementById('shadowDropControls');

    if (shadowTypeSelect) {
        shadowTypeSelect.addEventListener('change', () => {
            const val = shadowTypeSelect.value;
            if (val === 'none') {
                if (shadowControlsGroup) shadowControlsGroup.style.display = 'none';
            } else if (val === 'contact') {
                if (shadowControlsGroup) shadowControlsGroup.style.display = 'flex';
                if (shadowContactControls) shadowContactControls.style.display = 'block';
                if (shadowDropControls) shadowDropControls.style.display = 'none';
            } else if (val === 'drop') {
                if (shadowControlsGroup) shadowControlsGroup.style.display = 'flex';
                if (shadowContactControls) shadowContactControls.style.display = 'none';
                if (shadowDropControls) shadowDropControls.style.display = 'block';
            }
            triggerPostAdjustment();
        });
    }

    document.getElementById('despillModeSelect').addEventListener('change', triggerPostAdjustment);

    document.getElementById('modelSelect').addEventListener('change', () => {
        if (currentOriginalB64) runPipeline({ b64: currentOriginalB64 });
    });
    document.getElementById('enableTilingToggle').addEventListener('change', () => {
        if (currentOriginalB64) runPipeline({ b64: currentOriginalB64 });
    });
    document.getElementById('enableMattingToggle').addEventListener('change', () => {
        if (currentOriginalB64) runPipeline({ b64: currentOriginalB64 });
    });

    window.onPixelHover = (x, y) => {
        const inspectEl = document.getElementById('pixelInspectorText');
        if (inspectEl) {
            inspectEl.textContent = `X: ${x} | Y: ${y}`;
        }
    };

    document.getElementById('downloadCutoutBtn').onclick = () => {
        if (!currentCutoutB64) return;
        const link = document.createElement('a');
        link.download = currentFilename;
        link.href = currentCutoutB64;
        link.click();
        showToast('Cutout PNG downloaded!');
    };

    document.getElementById('downloadCompositeBtn').onclick = () => {
        const compB64 = studio.exportComposited('image/png');
        const link = document.createElement('a');
        link.download = `composite_${currentFilename}`;
        link.href = compB64;
        link.click();
        showToast('Composited image downloaded!');
    };

    document.getElementById('downloadAlphaBtn').onclick = () => {
        if (!currentAlphaB64) return;
        const link = document.createElement('a');
        link.download = `alpha_mask_${currentFilename}`;
        link.href = currentAlphaB64;
        link.click();
        showToast('Alpha Mask downloaded!');
    };

    document.getElementById('copyClipboardBtn').onclick = async () => {
        if (!currentCutoutB64) return;
        try {
            const blob = await (await fetch(currentCutoutB64)).blob();
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            showToast('Copied transparent PNG to clipboard!');
        } catch (e) {
            console.error('Clipboard copy error:', e);
            showToast('Clipboard access restricted in browser', 'warning');
        }
    };

    document.getElementById('headerUploadBtn').onclick = () => fileInput.click();

    const batchModal = document.getElementById('batchModal');
    const headerBatchBtn = document.getElementById('headerBatchBtn');
    const batchCloseBtn = document.getElementById('batchCloseBtn');
    const batchDropzone = document.getElementById('batchDropzone');
    const batchFileInput = document.getElementById('batchFileInput');
    const batchBrowseBtn = document.getElementById('batchBrowseBtn');
    const batchQueueContainer = document.getElementById('batchQueueContainer');
    const batchQueueStatusText = document.getElementById('batchQueueStatusText');
    const batchQueueList = document.getElementById('batchQueueList');
    const batchClearBtn = document.getElementById('batchClearBtn');
    const batchProgressWrapper = document.getElementById('batchProgressWrapper');
    const batchProgressFill = document.getElementById('batchProgressFill');
    const batchProgressText = document.getElementById('batchProgressText');
    const batchStartBtn = document.getElementById('batchStartBtn');
    const batchDownloadZipBtn = document.getElementById('batchDownloadZipBtn');

    let batchQueue = [];
    let isBatchRunning = false;

    function openBatchModal() {
        if (!batchModal) return;
        if (typeof batchModal.showModal === 'function') {
            batchModal.showModal();
        } else {
            batchModal.setAttribute('open', '');
        }
    }

    function closeBatchModal() {
        if (!batchModal) return;
        if (typeof batchModal.close === 'function') {
            batchModal.close();
        } else {
            batchModal.removeAttribute('open');
        }
    }

    if (headerBatchBtn) headerBatchBtn.addEventListener('click', openBatchModal);
    if (batchCloseBtn) batchCloseBtn.addEventListener('click', closeBatchModal);

    if (batchModal) {
        batchModal.addEventListener('click', (e) => {
            const rect = batchModal.getBoundingClientRect();
            const isInDialog = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            if (!isInDialog) closeBatchModal();
        });
    }

    if (batchBrowseBtn && batchFileInput) {
        batchBrowseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            batchFileInput.click();
        });
    }

    if (batchDropzone) {
        batchDropzone.addEventListener('click', () => {
            if (batchFileInput) batchFileInput.click();
        });
        batchDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            batchDropzone.classList.add('dragover');
        });
        batchDropzone.addEventListener('dragleave', () => batchDropzone.classList.remove('dragover'));
        batchDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            batchDropzone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files) {
                addBatchFiles(e.dataTransfer.files);
            }
        });
    }

    if (batchFileInput) {
        batchFileInput.addEventListener('change', (e) => {
            if (e.target.files) {
                addBatchFiles(e.target.files);
                batchFileInput.value = '';
            }
        });
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function addBatchFiles(fileList) {
        let addedCount = 0;
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            if (!file.type.startsWith('image/')) continue;
            batchQueue.push({
                id: 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                file: file,
                name: file.name,
                size: file.size,
                status: 'queued',
                origUrl: URL.createObjectURL(file),
                cutoutUrl: null,
                alphaUrl: null,
                error: null
            });
            addedCount++;
        }
        if (addedCount > 0) {
            renderBatchQueue();
            showToast(`Added ${addedCount} image${addedCount > 1 ? 's' : ''} to queue`);
        }
    }

    function renderBatchQueue() {
        if (!batchQueueContainer || !batchQueueList) return;

        if (batchQueue.length === 0) {
            batchQueueContainer.style.display = 'none';
            if (batchStartBtn) batchStartBtn.disabled = true;
            if (batchDownloadZipBtn) batchDownloadZipBtn.disabled = true;
            if (batchProgressWrapper) batchProgressWrapper.style.display = 'none';
            return;
        }

        batchQueueContainer.style.display = 'flex';
        const queuedCount = batchQueue.filter(i => i.status === 'queued').length;
        const doneCount = batchQueue.filter(i => i.status === 'done').length;
        if (batchQueueStatusText) {
            batchQueueStatusText.textContent = `${batchQueue.length} images (${doneCount} completed, ${queuedCount} queued)`;
        }

        if (batchStartBtn) batchStartBtn.disabled = isBatchRunning || queuedCount === 0;
        if (batchDownloadZipBtn) batchDownloadZipBtn.disabled = doneCount === 0;

        batchQueueList.innerHTML = '';
        batchQueue.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'batch-item-row';
            row.id = `batchItemRow_${item.id}`;

            const left = document.createElement('div');
            left.className = 'batch-item-left';

            const thumb = document.createElement('img');
            thumb.className = 'batch-item-thumb';
            thumb.src = item.cutoutUrl || item.origUrl;
            thumb.alt = item.name;

            const text = document.createElement('div');
            text.className = 'batch-item-text';

            const name = document.createElement('span');
            name.className = 'batch-item-name';
            name.textContent = item.name;

            const meta = document.createElement('span');
            meta.className = 'batch-item-meta';
            meta.textContent = formatFileSize(item.size);

            text.appendChild(name);
            text.appendChild(meta);
            left.appendChild(thumb);
            left.appendChild(text);

            const badge = document.createElement('span');
            badge.className = `batch-item-status-badge ${item.status}`;
            if (item.status === 'queued') badge.textContent = 'Queued';
            else if (item.status === 'processing') badge.textContent = 'Processing...';
            else if (item.status === 'done') badge.textContent = 'Done';
            else if (item.status === 'error') badge.textContent = 'Error';

            const actions = document.createElement('div');
            actions.className = 'batch-item-actions';

            if (item.status === 'done') {
                const studioBtn = document.createElement('button');
                studioBtn.className = 'btn-batch-item-action';
                studioBtn.textContent = 'Open in Studio';
                studioBtn.title = 'Load into main canvas for fine-tuning';
                studioBtn.addEventListener('click', () => {
                    loadBatchItemIntoStudio(item);
                });
                actions.appendChild(studioBtn);
            } else if (item.status === 'queued' && !isBatchRunning) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn-batch-item-action';
                removeBtn.textContent = '✕';
                removeBtn.title = 'Remove from queue';
                removeBtn.addEventListener('click', () => {
                    batchQueue.splice(index, 1);
                    renderBatchQueue();
                });
                actions.appendChild(removeBtn);
            }

            row.appendChild(left);
            row.appendChild(badge);
            row.appendChild(actions);
            batchQueueList.appendChild(row);
        });
    }

    function loadBatchItemIntoStudio(item) {
        if (isProcessing || !item.cutoutUrl) return;
        ++editRevision;
        clearTimeout(adjustDebounce);
        undoStack.length = redoStack.length = 0;
        baseAlphaB64 = item.alphaUrl;
        committedControls = readControls();
        updateHistoryButtons();
        currentImageId = null;
        currentFilename = `${item.name.split('.')[0]}_cutout.png`;
        currentOriginalB64 = item.origUrl;
        currentCutoutB64 = item.cutoutUrl;
        currentAlphaB64 = item.alphaUrl;

        studio.loadImages({
            origUrl: item.origUrl,
            cutoutUrl: item.cutoutUrl,
            alphaUrl: item.alphaUrl,
            trimapUrl: null,
            width: item.width,
            height: item.height
        });

        if (dropzone) dropzone.style.display = 'none';
        const viewTag = document.getElementById('canvasViewTag');
        if (viewTag) viewTag.style.display = 'block';
        const backdropPanel = document.getElementById('floatingBackdropPanel');
        if (backdropPanel) backdropPanel.style.display = 'flex';

        closeBatchModal();
        showToast(`Loaded ${item.name} into Studio`);
    }

    if (batchClearBtn) {
        batchClearBtn.addEventListener('click', () => {
            if (isBatchRunning) return;
            batchQueue = [];
            renderBatchQueue();
            if (batchProgressWrapper) batchProgressWrapper.style.display = 'none';
        });
    }

    if (batchStartBtn) {
        batchStartBtn.addEventListener('click', async () => {
            if (isBatchRunning) return;
            const queuedItems = batchQueue.filter(i => i.status === 'queued');
            if (queuedItems.length === 0) return;

            isBatchRunning = true;
            batchStartBtn.disabled = true;
            if (batchClearBtn) batchClearBtn.disabled = true;
            if (batchProgressWrapper) batchProgressWrapper.style.display = 'flex';

            const total = batchQueue.length;
            let finished = batchQueue.filter(i => i.status === 'done' || i.status === 'error').length;

            const updateProgress = () => {
                const pct = Math.round((finished / total) * 100);
                if (batchProgressFill) batchProgressFill.style.width = `${pct}%`;
                if (batchProgressText) batchProgressText.textContent = `${finished} / ${total}`;
            };
            updateProgress();

            const modelName = document.getElementById('batchModelSelect').value;
            const mattingVal = document.getElementById('batchMattingSelect').value;
            const shadowVal = document.getElementById('batchShadowSelect').value;
            const despillVal = document.getElementById('batchDespillSelect').value;

            for (const item of batchQueue) {
                if (item.status !== 'queued') continue;

                item.status = 'processing';
                renderBatchQueue();

                try {
                    const formData = new FormData();
                    formData.append('file', item.file);
                    formData.append('model_name', modelName);
                    formData.append('enable_matting', mattingVal !== 'none');
                    formData.append('matting_method', mattingVal !== 'none' ? mattingVal : 'lkm');
                    formData.append('despill_mode', despillVal);
                    formData.append('despill_strength', 0.8);
                    formData.append('shadow_type', shadowVal);
                    if (shadowVal === 'contact') {
                        formData.append('shadow_opacity', 0.65);
                        formData.append('shadow_blur', 18);
                        formData.append('shadow_scale', 0.25);
                    } else if (shadowVal === 'drop') {
                        formData.append('shadow_opacity', 0.6);
                        formData.append('shadow_blur', 20);
                        formData.append('shadow_offset_y', 15);
                        formData.append('shadow_offset_x', 0);
                    }

                    const data = await ApiClient.processImage(formData);
                    if (data.success) {
                        item.status = 'done';
                        item.cutoutUrl = data.cutout_url;
                        item.alphaUrl = data.alpha_url;
                        item.width = data.width;
                        item.height = data.height;
                    } else {
                        item.status = 'error';
                        item.error = 'Failed to segment';
                    }
                } catch (err) {
                    console.error('Batch item error:', err);
                    item.status = 'error';
                    item.error = err.message;
                }

                finished++;
                updateProgress();
                renderBatchQueue();
            }

            isBatchRunning = false;
            if (batchClearBtn) batchClearBtn.disabled = false;
            renderBatchQueue();

            const successCount = batchQueue.filter(i => i.status === 'done').length;
            showToast(`Batch completed: ${successCount} processed successfully!`);
        });
    }

    if (batchDownloadZipBtn) {
        batchDownloadZipBtn.addEventListener('click', async () => {
            const doneItems = batchQueue.filter(i => i.status === 'done' && i.cutoutUrl);
            if (doneItems.length === 0) return;

            batchDownloadZipBtn.disabled = true;
            const spanText = batchDownloadZipBtn.querySelector('span');
            if (spanText) spanText.textContent = 'Packing ZIP...';

            try {
                const zipItems = doneItems.map((item, idx) => ({
                    filename: item.name || `cutout_${idx + 1}.png`,
                    cutout_base64: item.cutoutUrl
                }));

                const blob = await ApiClient.generateBatchZip(zipItems);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `unicut_batch_${Date.now()}.zip`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                showToast(`Downloaded ${doneItems.length} cutouts as ZIP!`);
            } catch (err) {
                console.error('ZIP generation error:', err);
                showToast('Failed to create ZIP', 'warning');
            } finally {
                batchDownloadZipBtn.disabled = false;
                if (spanText) spanText.textContent = 'Download All (ZIP)';
            }
        });
    }

    class LayoutManager {
        constructor(studioInstance) {
            this.studio = studioInstance;
            this.layout = document.getElementById('studioLayout');
            this.toolbar = document.getElementById('toolbarSidebar');
            this.inspector = document.getElementById('inspectorSidebar');
            this.toolbarResizer = document.getElementById('toolbarResizer');
            this.inspectorResizer = document.getElementById('inspectorResizer');
            this.toolbarTooltip = document.getElementById('toolbarResizerTooltip');
            this.inspectorTooltip = document.getElementById('inspectorResizerTooltip');

            this.btnToggleToolbar = document.getElementById('btnToggleToolbar');
            this.btnToggleInspector = document.getElementById('btnToggleInspector');
            this.headerToggleToolbarBtn = document.getElementById('headerToggleToolbarBtn');
            this.headerToggleInspectorBtn = document.getElementById('headerToggleInspectorBtn');
            this.headerResetLayoutBtn = document.getElementById('headerResetLayoutBtn');

            this.defaultToolbarWidth = 52;
            this.defaultInspectorWidth = 320;

            this.toolbarWidth = parseInt(localStorage.getItem('unicut_toolbar_width')) || this.defaultToolbarWidth;
            this.inspectorWidth = parseInt(localStorage.getItem('unicut_inspector_width')) || this.defaultInspectorWidth;
            this.isToolbarCollapsed = localStorage.getItem('unicut_toolbar_collapsed') === 'true';
            this.isInspectorCollapsed = localStorage.getItem('unicut_inspector_collapsed') === 'true';

            this.isDraggingToolbar = false;
            this.isDraggingInspector = false;

            this.init();
        }

        init() {
            this.applyWidths();
            this.bindResizers();
            this.bindToggles();

        }

        applyWidths() {
            if (!this.layout) return;

            if (this.isToolbarCollapsed) {
                this.layout.style.setProperty('--toolbar-width', '0px');
                if (this.toolbar) this.toolbar.classList.add('collapsed');
                if (this.toolbarResizer) this.toolbarResizer.classList.add('collapsed');
                if (this.headerToggleToolbarBtn) this.headerToggleToolbarBtn.classList.remove('active');
                if (this.btnToggleToolbar) {
                    this.btnToggleToolbar.title = 'Expand toolbar';
                    this.btnToggleToolbar.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
                }
            } else {
                this.layout.style.setProperty('--toolbar-width', `${this.toolbarWidth}px`);
                if (this.toolbar) {
                    this.toolbar.classList.remove('collapsed');
                    this.toolbar.classList.toggle('wide', this.toolbarWidth >= 75);
                }
                if (this.toolbarResizer) this.toolbarResizer.classList.remove('collapsed');
                if (this.headerToggleToolbarBtn) this.headerToggleToolbarBtn.classList.add('active');
                if (this.btnToggleToolbar) {
                    this.btnToggleToolbar.title = 'Collapse toolbar';
                    this.btnToggleToolbar.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
                }
            }

            if (this.isInspectorCollapsed) {
                this.layout.style.setProperty('--inspector-width', '0px');
                if (this.inspector) this.inspector.classList.add('collapsed');
                if (this.inspectorResizer) this.inspectorResizer.classList.add('collapsed');
                if (this.headerToggleInspectorBtn) this.headerToggleInspectorBtn.classList.remove('active');
                if (this.btnToggleInspector) {
                    this.btnToggleInspector.title = 'Expand inspector';
                    this.btnToggleInspector.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
                }
            } else {
                this.layout.style.setProperty('--inspector-width', `${this.inspectorWidth}px`);
                if (this.inspector) this.inspector.classList.remove('collapsed');
                if (this.inspectorResizer) this.inspectorResizer.classList.remove('collapsed');
                if (this.headerToggleInspectorBtn) this.headerToggleInspectorBtn.classList.add('active');
                if (this.btnToggleInspector) {
                    this.btnToggleInspector.title = 'Collapse inspector';
                    this.btnToggleInspector.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
                }
            }


            if (this.studio) {
                requestAnimationFrame(() => this.studio.render());
            }
        }

        bindResizers() {
            if (this.toolbarResizer) {
                this.toolbarResizer.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.resizer-collapse-btn')) return;
                    this.isDraggingToolbar = true;
                    this.isToolbarCollapsed = false;
                    this.toolbarResizer.classList.add('dragging');
                    document.body.classList.add('resizing-col');
                    if (this.toolbarTooltip) {
                        this.toolbarTooltip.textContent = `${this.toolbarWidth}px`;
                        this.toolbarTooltip.classList.add('visible');
                    }
                    e.preventDefault();
                });

                this.toolbarResizer.addEventListener('dblclick', () => {
                    this.toolbarWidth = this.defaultToolbarWidth;
                    this.isToolbarCollapsed = false;
                    localStorage.setItem('unicut_toolbar_width', this.toolbarWidth);
                    localStorage.setItem('unicut_toolbar_collapsed', 'false');
                    this.applyWidths();
                    showToast('Toolbar reset to 52px');
                });
            }

            if (this.inspectorResizer) {
                this.inspectorResizer.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.resizer-collapse-btn')) return;
                    this.isDraggingInspector = true;
                    this.isInspectorCollapsed = false;
                    this.inspectorResizer.classList.add('dragging');
                    document.body.classList.add('resizing-col');
                    if (this.inspectorTooltip) {
                        this.inspectorTooltip.textContent = `${this.inspectorWidth}px`;
                        this.inspectorTooltip.classList.add('visible');
                    }
                    e.preventDefault();
                });

                this.inspectorResizer.addEventListener('dblclick', () => {
                    this.inspectorWidth = this.defaultInspectorWidth;
                    this.isInspectorCollapsed = false;
                    localStorage.setItem('unicut_inspector_width', this.inspectorWidth);
                    localStorage.setItem('unicut_inspector_collapsed', 'false');
                    this.applyWidths();
                    showToast('Inspector reset to 320px');
                });
            }

            window.addEventListener('mousemove', (e) => {
                if (this.isDraggingToolbar) {
                    const newW = Math.max(44, Math.min(e.clientX, 200));
                    this.toolbarWidth = newW;
                    localStorage.setItem('unicut_toolbar_width', newW);
                    this.layout.style.setProperty('--toolbar-width', `${newW}px`);
                    if (this.toolbar) this.toolbar.classList.toggle('wide', newW >= 75);
                    if (this.toolbarTooltip) this.toolbarTooltip.textContent = `${newW}px`;
                    if (this.studio) this.studio.scheduleRender();
                }

                if (this.isDraggingInspector) {
                    const windowW = window.innerWidth;
                    const newW = Math.max(220, Math.min(windowW - e.clientX, 680));
                    this.inspectorWidth = newW;
                    localStorage.setItem('unicut_inspector_width', newW);
                    this.layout.style.setProperty('--inspector-width', `${newW}px`);
                    if (this.inspectorTooltip) this.inspectorTooltip.textContent = `${newW}px`;

                    if (this.studio) this.studio.scheduleRender();
                }
            });

            window.addEventListener('mouseup', () => {
                let changed = false;
                if (this.isDraggingToolbar) {
                    this.isDraggingToolbar = false;
                    if (this.toolbarResizer) this.toolbarResizer.classList.remove('dragging');
                    if (this.toolbarTooltip) this.toolbarTooltip.classList.remove('visible');
                    changed = true;
                }
                if (this.isDraggingInspector) {
                    this.isDraggingInspector = false;
                    if (this.inspectorResizer) this.inspectorResizer.classList.remove('dragging');
                    if (this.inspectorTooltip) this.inspectorTooltip.classList.remove('visible');
                    changed = true;
                }
                if (changed) {
                    document.body.classList.remove('resizing-col');
                    if (this.studio) this.studio.render();
                }
            });
        }

        bindToggles() {
            const toggleToolbar = () => {
                this.isToolbarCollapsed = !this.isToolbarCollapsed;
                localStorage.setItem('unicut_toolbar_collapsed', this.isToolbarCollapsed);
                this.applyWidths();
            };

            const toggleInspector = () => {
                this.isInspectorCollapsed = !this.isInspectorCollapsed;
                localStorage.setItem('unicut_inspector_collapsed', this.isInspectorCollapsed);
                this.applyWidths();
            };

            if (this.btnToggleToolbar) this.btnToggleToolbar.addEventListener('click', toggleToolbar);
            if (this.headerToggleToolbarBtn) this.headerToggleToolbarBtn.addEventListener('click', toggleToolbar);

            if (this.btnToggleInspector) this.btnToggleInspector.addEventListener('click', toggleInspector);
            if (this.headerToggleInspectorBtn) this.headerToggleInspectorBtn.addEventListener('click', toggleInspector);

            if (this.headerResetLayoutBtn) {
                this.headerResetLayoutBtn.addEventListener('click', () => {
                    this.toolbarWidth = this.defaultToolbarWidth;
                    this.inspectorWidth = this.defaultInspectorWidth;
                    this.isToolbarCollapsed = false;
                    this.isInspectorCollapsed = false;
                    localStorage.setItem('unicut_toolbar_width', this.toolbarWidth);
                    localStorage.setItem('unicut_inspector_width', this.inspectorWidth);
                    localStorage.setItem('unicut_toolbar_collapsed', 'false');
                    localStorage.setItem('unicut_inspector_collapsed', 'false');
                    this.applyWidths();
                    showToast('Layout reset to default');
                });
            }

            window.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
                if (e.ctrlKey || e.metaKey) {
                    if (e.key === '[') {
                        e.preventDefault();
                        toggleToolbar();
                    } else if (e.key === ']') {
                        e.preventDefault();
                        toggleInspector();
                    }
                }
            });
        }


    }

    const layoutManager = new LayoutManager(studio);
});
