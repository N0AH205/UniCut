class ApiClient {
    static async getModels() {
        const res = await fetch('/api/models');
        if (!res.ok) throw new Error('Failed to fetch models');
        return await res.json();
    }

    static async getSamples() {
        const res = await fetch('/api/samples');
        if (!res.ok) throw new Error('Failed to fetch samples');
        return await res.json();
    }

    static async processImage(formData) {
        const res = await fetch('/api/process', {
            method: 'POST',
            body: formData
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Processing error' }));
            throw new Error(err.detail || 'Failed to process image');
        }
        return await res.json();
    }

    static async interactiveRefine(payload) {
        const res = await fetch('/api/interactive-refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Refinement error' }));
            throw new Error(err.detail || 'Failed to refine with points');
        }
        return await res.json();
    }

    static async rematTrimap(payload) {
        const res = await fetch('/api/remat-trimap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Matting error' }));
            throw new Error(err.detail || 'Failed to re-matte trimap');
        }
        return await res.json();
    }

    static async adjustPost(payload) {
        const res = await fetch('/api/adjust-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Post adjustment error' }));
            throw new Error(err.detail || 'Failed to adjust post-processing');
        }
        return await res.json();
    }

    static async generateBatchZip(items) {
        const res = await fetch('/api/batch-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        if (!res.ok) throw new Error('Failed to generate batch zip archive');
        return await res.blob();
    }
}
