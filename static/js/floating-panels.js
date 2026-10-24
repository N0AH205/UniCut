document.addEventListener('DOMContentLoaded', () => {
    const viewport = document.getElementById('canvasViewport');
    if (!viewport) return;

    ['floatingViewPanel', 'floatingBackdropPanel'].forEach(id => {
        const panel = document.getElementById(id);
        const handle = panel?.querySelector('.panel-drag-handle');
        if (!handle) return;
        if (id === 'floatingViewPanel') viewport.appendChild(panel);
        const key = `unicut_position_${id}`;
        let position = null;
        let drag = null;
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
        } catch (_) {  }

        function place() {
            if (!position || !panel.getClientRects().length) return;
            const parent = panel.offsetParent;
            position.x = Math.max(0, Math.min(position.x, parent.clientWidth - panel.offsetWidth));
            position.y = Math.max(0, Math.min(position.y, parent.clientHeight - panel.offsetHeight));
            panel.classList.add('floating-panel-positioned');
            Object.assign(panel.style, {
                left: `${position.x}px`, top: `${position.y}px`, bottom: 'auto', right: 'auto'
            });
        }

        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = panel.getBoundingClientRect();
            const parent = panel.offsetParent.getBoundingClientRect();
            position = { x: rect.left - parent.left, y: rect.top - parent.top };
            drag = { id: event.pointerId, pointerX: event.clientX, pointerY: event.clientY,
                startX: position.x, startY: position.y };
            handle.setPointerCapture(event.pointerId);
            place();
        });
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            position = { x: drag.startX + event.clientX - drag.pointerX,
                y: drag.startY + event.clientY - drag.pointerY };
            place();
        });
        function finish(event) {
            if (!drag || event.pointerId !== drag.id) return;
            drag = null;
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
            try { localStorage.setItem(key, JSON.stringify(position)); } catch (_) {}
        }
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
        handle.addEventListener('dblclick', () => {
            position = null;
            panel.classList.remove('floating-panel-positioned');
            ['left', 'top', 'bottom', 'right'].forEach(property => panel.style.removeProperty(property));
            try { localStorage.removeItem(key); } catch (_) {}
        });
        new ResizeObserver(place).observe(viewport);
        new ResizeObserver(place).observe(panel.parentElement);
        new ResizeObserver(place).observe(panel);
        place();
    });
});
