class StudioCanvas {
    constructor(canvasEl, containerEl, brushCursorEl) {
        this.canvas = canvasEl;
        this.ctx = this.canvas.getContext('2d');
        this.container = containerEl;
        this.brushCursor = brushCursorEl;

        this.origImg = null;
        this.cutoutImg = null;
        this.alphaImg = null;
        this.trimapImg = null;
        this.customBgImg = null;

        this.imgWidth = 0;
        this.imgHeight = 0;

        this.viewMode = 'split';
        this.backdrop = 'checkerboard';
        this.customBgColor = '#ffffff';

        this.splitPos = 0.5;
        this.isDraggingSplit = false;

        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        this.activeTool = 'split';
        this.brushSize = 24;
        this.isDrawing = false;

        this.fgPoints = [];
        this.bgPoints = [];

        this.strokeCanvas = document.createElement('canvas');
        this.strokeCtx = this.strokeCanvas.getContext('2d');

        this.checkerPattern = null;
        this._renderScheduled = false;
        this.initCheckerPattern();

        this.initEvents();
    }

    initCheckerPattern() {
        const patCanvas = document.createElement('canvas');
        patCanvas.width = 32;
        patCanvas.height = 32;
        const pctx = patCanvas.getContext('2d');
        pctx.fillStyle = '#262626';
        pctx.fillRect(0, 0, 32, 32);
        pctx.fillStyle = '#333333';
        pctx.fillRect(0, 0, 16, 16);
        pctx.fillRect(16, 16, 16, 16);
        this.checkerPattern = this.ctx.createPattern(patCanvas, 'repeat');
    }

    scheduleRender() {
        if (!this._renderScheduled) {
            this._renderScheduled = true;
            requestAnimationFrame(() => {
                this._renderScheduled = false;
                this.render();
            });
        }
    }

    loadImages({ origUrl, cutoutUrl, alphaUrl, trimapUrl, width, height }) {
        this.currentLoadId = (this.currentLoadId || 0) + 1;
        const loadId = this.currentLoadId;
        this.masksLoading = true;

        this.imgWidth = width;
        this.imgHeight = height;

        const dimEl = document.getElementById('exportHubDimText');
        if (dimEl) dimEl.textContent = `${width} × ${height} px`;

        this.strokeCanvas.width = width;
        this.strokeCanvas.height = height;
        this.strokeCtx.clearRect(0, 0, width, height);
        this.fgPoints = [];
        this.bgPoints = [];

        let loadedCount = 0;
        const total = trimapUrl ? 4 : 3;
        this.trimapImg = null;
        const checkDone = () => {
            if (this.currentLoadId !== loadId) return;
            loadedCount++;
            if (loadedCount >= total) {
                this.masksLoading = false;
                this.fitToScreen();
                this.render();
            }
        };

        const newOrig = new Image();
        newOrig.crossOrigin = 'anonymous';
        newOrig.onload = () => {
            if (this.currentLoadId === loadId) {
                this.origImg = newOrig;
                checkDone();
            }
        };
        newOrig.src = origUrl;

        const newCutout = new Image();
        newCutout.crossOrigin = 'anonymous';
        newCutout.onload = () => {
            if (this.currentLoadId === loadId) {
                this.cutoutImg = newCutout;
                checkDone();
            }
        };
        newCutout.src = cutoutUrl;

        const newAlpha = new Image();
        newAlpha.crossOrigin = 'anonymous';
        newAlpha.onload = () => {
            if (this.currentLoadId === loadId) {
                this.alphaImg = newAlpha;
                checkDone();
            }
        };
        newAlpha.src = alphaUrl;

        const newTrimap = new Image();
        newTrimap.crossOrigin = 'anonymous';
        newTrimap.onload = () => {
            if (this.currentLoadId === loadId) {
                this.trimapImg = newTrimap;
                checkDone();
            }
        };
        if (trimapUrl) newTrimap.src = trimapUrl;
    }

    updateCutoutAndAlpha(cutoutUrl, alphaUrl) {
        this.masksLoading = true;
        const loadId = this.currentLoadId;
        const updateId = this.maskUpdateId = (this.maskUpdateId || 0) + 1;
        let loaded = 0;
        const check = () => {
            if (this.currentLoadId !== loadId || this.maskUpdateId !== updateId) return;
            loaded++;
            if (loaded >= 2) {
                this.cutoutImg = cutout;
                this.alphaImg = alpha;
                this.masksLoading = false;
                this.render();
            }
        };

        const cutout = new Image();
        const alpha = new Image();
        cutout.crossOrigin = alpha.crossOrigin = 'anonymous';
        cutout.onload = alpha.onload = check;
        cutout.src = cutoutUrl;
        alpha.src = alphaUrl;
    }

    fitToScreen() {
        if (!this.imgWidth || !this.imgHeight) return;
        const parentW = this.container.clientWidth - 40;
        const parentH = this.container.clientHeight - 40;

        const scaleW = parentW / this.imgWidth;
        const scaleH = parentH / this.imgHeight;
        this.zoom = Math.min(scaleW, scaleH, 1.0);

        this.panX = (this.container.clientWidth - this.imgWidth * this.zoom) / 2;
        this.panY = (this.container.clientHeight - this.imgHeight * this.zoom) / 2;

        const zp = document.getElementById('zoomPercentVal');
        if (zp) zp.textContent = `${Math.round(this.zoom * 100)}%`;
    }

    setZoom(newZoom, centerX = null, centerY = null) {
        newZoom = Math.min(Math.max(newZoom, 0.1), 8.0);
        if (centerX === null || centerY === null) {
            centerX = this.container.clientWidth / 2;
            centerY = this.container.clientHeight / 2;
        }

        const imageX = (centerX - this.panX) / this.zoom;
        const imageY = (centerY - this.panY) / this.zoom;

        this.zoom = newZoom;
        this.panX = centerX - imageX * this.zoom;
        this.panY = centerY - imageY * this.zoom;

        const zp = document.getElementById('zoomPercentVal');
        if (zp) zp.textContent = `${Math.round(this.zoom * 100)}%`;

        this.scheduleRender();
    }

    setViewMode(mode) {
        this.viewMode = mode;
        const tag = document.getElementById('canvasViewTag');
        if (tag) {
            const labels = {
                'split': 'Split View',
                'cutout': 'Cutout',
                'orig': 'Original',
                'alpha': 'Alpha Mask',
                'trimap': 'Trimap'
            };
            tag.textContent = labels[mode] || mode;
        }
        this.render();
    }

    setBackdrop(backdrop, color = '#ffffff') {
        this.backdrop = backdrop;
        this.customBgColor = color;
        this.render();
    }

    setCustomBgImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.customBgImg = new Image();
            this.customBgImg.onload = () => {
                this.backdrop = 'custom';
                this.render();
            };
            this.customBgImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    setTool(tool) {
        this.activeTool = tool;
        if (this.brushCursor) {
            const isBrush = tool.startsWith('brush_') || tool === 'eraser';
            this.brushCursor.style.display = isBrush ? 'block' : 'none';
        }
    }

    setBrushSize(size) {
        this.brushSize = Math.max(2, Math.min(size, 150));
        if (this.brushCursor) {
            const visualSize = this.brushSize * this.zoom;
            this.brushCursor.style.width = `${visualSize}px`;
            this.brushCursor.style.height = `${visualSize}px`;
        }
    }

    initEvents() {
        const c = this.container;

        window.addEventListener('resize', () => {
            if (this.imgWidth) {
                this.render();
            }
        });

        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = c.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.setZoom(this.zoom * delta, mouseX, mouseY);
        }, { passive: false });

        c.addEventListener('mousedown', (e) => {
            if (this.editingDisabled || this.masksLoading) return;
            const rect = c.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.lastMouseX = mouseX;
            this.lastMouseY = mouseY;

            if (this.viewMode === 'split' && this.activeTool === 'split') {
                const splitCanvasX = this.panX + (this.imgWidth * this.zoom) * this.splitPos;
                if (Math.abs(mouseX - splitCanvasX) < 18) {
                    this.isDraggingSplit = true;
                    return;
                }
            }

            if (e.button === 1 || this.activeTool === 'hand' || e.spaceKey) {
                this.isPanning = true;
                c.style.cursor = 'grabbing';
                return;
            }

            const imgCoord = this.screenToImage(mouseX, mouseY);
            if (imgCoord) {
                if (['point_fg', 'point_bg', 'eraser'].includes(this.activeTool) || this.activeTool.startsWith('brush_')) {
                    this.onBeforeEdit?.();
                }
                if (this.activeTool === 'point_fg') {
                    this.fgPoints.push(imgCoord);
                    this.render();
                    return;
                } else if (this.activeTool === 'point_bg') {
                    this.bgPoints.push(imgCoord);
                    this.render();
                    return;
                } else if (this.activeTool.startsWith('brush_') || this.activeTool === 'eraser') {
                    this.isDrawing = true;
                    this.paintStroke(imgCoord.x, imgCoord.y, true);
                    this.render();
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            const rect = c.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (this.brushCursor && (this.activeTool.startsWith('brush_') || this.activeTool === 'eraser')) {
                const visualSize = this.brushSize * this.zoom;
                this.brushCursor.style.width = `${visualSize}px`;
                this.brushCursor.style.height = `${visualSize}px`;
                this.brushCursor.style.left = `${e.clientX}px`;
                this.brushCursor.style.top = `${e.clientY}px`;
            }

            const imgCoord = this.screenToImage(mouseX, mouseY);
            if (imgCoord) {
                const coordEl = document.getElementById('coordInspectorText');
                if (coordEl) coordEl.textContent = `X ${imgCoord.x} Y ${imgCoord.y}`;
                if (window.onPixelHover) window.onPixelHover(imgCoord.x, imgCoord.y);
            }

            if (this.isDraggingSplit) {
                const imageLeft = this.panX;
                const imageWidth = this.imgWidth * this.zoom;
                let relX = (mouseX - imageLeft) / imageWidth;
                this.splitPos = Math.max(0.01, Math.min(0.99, relX));
                this.scheduleRender();
                return;
            }

            if (this.isPanning) {
                const dx = mouseX - this.lastMouseX;
                const dy = mouseY - this.lastMouseY;
                this.panX += dx;
                this.panY += dy;
                this.lastMouseX = mouseX;
                this.lastMouseY = mouseY;
                this.scheduleRender();
                return;
            }

            if (this.isDrawing && imgCoord) {
                this.paintStroke(imgCoord.x, imgCoord.y, false);
                this.scheduleRender();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDraggingSplit = false;
            this.isPanning = false;
            this.isDrawing = false;
            c.style.cursor = this.activeTool === 'hand' ? 'grab' : 'default';
        });
    }

    screenToImage(screenX, screenY) {
        if (!this.imgWidth || !this.imgHeight) return null;
        const x = (screenX - this.panX) / this.zoom;
        const y = (screenY - this.panY) / this.zoom;
        if (x >= 0 && x <= this.imgWidth && y >= 0 && y <= this.imgHeight) {
            return { x: Math.round(x), y: Math.round(y) };
        }
        return null;
    }

    paintStroke(x, y, isStart) {
        const ctx = this.strokeCtx;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = this.brushSize;

        if (this.activeTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            if (this.activeTool === 'brush_fg') {
                ctx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
            } else if (this.activeTool === 'brush_bg') {
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
            } else if (this.activeTool === 'brush_unknown') {
                ctx.strokeStyle = 'rgba(234, 179, 8, 0.85)';
            }
        }

        ctx.fillStyle = ctx.strokeStyle;
        if (isStart) {
            ctx.beginPath();
            ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
            ctx.stroke();
        }
    }

    clearUserStrokes(record = true) {
        if (record) this.onBeforeEdit?.();
        this.strokeCtx.clearRect(0, 0, this.imgWidth, this.imgHeight);
        this.fgPoints = [];
        this.bgPoints = [];
        this.render();
    }

    render() {
        if (!this.imgWidth || !this.imgHeight || !this.origImg) return;

        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        this.renderBackdrop(ctx, this.imgWidth, this.imgHeight);

        if (this.viewMode === 'orig') {
            ctx.drawImage(this.origImg, 0, 0, this.imgWidth, this.imgHeight);
        } else if (this.viewMode === 'cutout') {
            if (this.cutoutImg) {
                ctx.drawImage(this.cutoutImg, 0, 0, this.imgWidth, this.imgHeight);
            }
        } else if (this.viewMode === 'alpha') {
            if (this.alphaImg) {
                ctx.drawImage(this.alphaImg, 0, 0, this.imgWidth, this.imgHeight);
            }
        } else if (this.viewMode === 'trimap') {
            if (this.trimapImg) {
                ctx.drawImage(this.trimapImg, 0, 0, this.imgWidth, this.imgHeight);
            }
        } else if (this.viewMode === 'split') {
            const splitX = this.imgWidth * this.splitPos;

            if (this.cutoutImg) {
                ctx.drawImage(this.cutoutImg, 0, 0, this.imgWidth, this.imgHeight);
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, splitX, this.imgHeight);
            ctx.clip();
            ctx.drawImage(this.origImg, 0, 0, this.imgWidth, this.imgHeight);
            ctx.restore();
        }

        ctx.drawImage(this.strokeCanvas, 0, 0, this.imgWidth, this.imgHeight);

        this.renderPoints(ctx);

        ctx.restore();

        if (this.viewMode === 'split') {
            this.renderSplitControls(ctx);
        }
    }

    renderBackdrop(ctx, w, h) {
        if (this.backdrop === 'checkerboard') {
            if (!this.checkerPattern) {
                this.initCheckerPattern();
            }
            ctx.fillStyle = this.checkerPattern;
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'white') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'black') {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'green') {
            ctx.fillStyle = '#00e676';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'blue' || this.backdrop === 'studio') {
            ctx.fillStyle = '#0066ff';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'gray' || this.backdrop === 'cyber') {
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'color') {
            ctx.fillStyle = this.customBgColor || '#3b82f6';
            ctx.fillRect(0, 0, w, h);
        } else if (this.backdrop === 'custom') {
            if (this.customBgImg) {
                ctx.drawImage(this.customBgImg, 0, 0, w, h);
            } else {
                ctx.fillStyle = this.customBgColor || '#808080';
                ctx.fillRect(0, 0, w, h);
            }
        }
    }

    renderPoints(ctx) {
        for (const pt of this.fgPoints) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pt.x - 4, pt.y);
            ctx.lineTo(pt.x + 4, pt.y);
            ctx.moveTo(pt.x, pt.y - 4);
            ctx.lineTo(pt.x, pt.y + 4);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        for (const pt of this.bgPoints) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#1c1c1c';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pt.x - 4, pt.y);
            ctx.lineTo(pt.x + 4, pt.y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    renderSplitControls(ctx) {
        const splitScreenX = this.panX + (this.imgWidth * this.zoom) * this.splitPos;
        const imgTop = this.panY;
        const imgBottom = this.panY + this.imgHeight * this.zoom;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(splitScreenX, imgTop);
        ctx.lineTo(splitScreenX, imgBottom);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.stroke();

        const handleY = imgTop + (imgBottom - imgTop) * 0.5;
        ctx.beginPath();
        ctx.arc(splitScreenX, handleY, 15, 0, Math.PI * 2);
        ctx.fillStyle = '#262626';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◄►', splitScreenX, handleY);

        ctx.restore();
    }

    hasBrushStrokes() {
        if (!this.imgWidth || !this.imgHeight) return false;
        const pixels = this.strokeCtx.getImageData(0, 0, this.imgWidth, this.imgHeight).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 30);
    }

    getBrushStrokesAsBase64() {
        if (this.masksLoading || !this.alphaImg?.complete || !this.alphaImg.naturalWidth) {
            throw new Error('Wait for the image mask to finish loading.');
        }
        return this.strokeCanvas.toDataURL('image/png');
    }

    getTrimapAsBase64() {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.imgWidth;
        exportCanvas.height = this.imgHeight;
        const ectx = exportCanvas.getContext('2d');

        if (this.masksLoading || !this.alphaImg?.complete || !this.alphaImg.naturalWidth) {
            throw new Error('Wait for the image mask to finish loading.');
        }
        ectx.drawImage(this.alphaImg, 0, 0, this.imgWidth, this.imgHeight);

        const strokeData = this.strokeCtx.getImageData(0, 0, this.imgWidth, this.imgHeight);
        const exportData = ectx.getImageData(0, 0, this.imgWidth, this.imgHeight);

        for (let i = 0; i < strokeData.data.length; i += 4) {
            const alpha = exportData.data[i];
            const value = alpha < 38 ? 0 : alpha > 217 ? 255 : 128;
            exportData.data[i] = exportData.data[i + 1] = exportData.data[i + 2] = value;
            exportData.data[i + 3] = 255;
            const a = strokeData.data[i + 3];
            if (a > 30) {
                const r = strokeData.data[i];
                const g = strokeData.data[i + 1];
                const b = strokeData.data[i + 2];

                if (g > 150 && r < 100) {
                    exportData.data[i] = 255;
                    exportData.data[i + 1] = 255;
                    exportData.data[i + 2] = 255;
                } else if (r > 150 && g < 100) {
                    exportData.data[i] = 0;
                    exportData.data[i + 1] = 0;
                    exportData.data[i + 2] = 0;
                } else {
                    exportData.data[i] = 128;
                    exportData.data[i + 1] = 128;
                    exportData.data[i + 2] = 128;
                }
            }
        }

        ectx.putImageData(exportData, 0, 0);
        return exportCanvas.toDataURL('image/png');
    }

    exportComposited(format = 'image/png') {
        const outCanvas = document.createElement('canvas');
        outCanvas.width = this.imgWidth;
        outCanvas.height = this.imgHeight;
        const octx = outCanvas.getContext('2d');

        this.renderBackdrop(octx, this.imgWidth, this.imgHeight);

        if (this.cutoutImg) {
            octx.drawImage(this.cutoutImg, 0, 0, this.imgWidth, this.imgHeight);
        }

        return outCanvas.toDataURL(format);
    }
}
