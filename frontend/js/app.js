/**
 * app.js - Core State Management & API Integration
 * Flamingo Horticulture CDU Department Head Application
 * 
 * Manages global state, API calls, and page navigation between
 * the 4 dashboard tabs: Dashboard, AI Camera Scanner, Batch Scan Logs,
 * and Harvest Forecasts.
 */

// API base URL - adjust for production deployment
const API_BASE = '/api/v1/cdu';

// --- Global State ---
const state = {
    activeBlock: null,
    activeBlockId: null,
    activeCrop: 'roses',
    scanHistory: [],
    cameraStream: null,
    isScanning: false,
    lastScanResult: null,

    // Initialize state on app load
    init() {
        this.loadTelemetry();
        this.attachNavListeners();
        this.attachCropListeners();
    },

    // --- Navigation ---
    attachNavListeners() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Update nav active state
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Hide all pages, show target
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const targetId = tab.dataset.tab;
                const targetPage = document.getElementById(`page-${targetId}`);
                if (targetPage) {
                    targetPage.classList.add('active');
                }

                // Trigger page-specific init if exists
                if (window[`init${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`]) {
                    window[`init${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`]();
                }
            });
        });
    },

    // --- Crop Selector ---
    attachCropListeners() {
        document.querySelectorAll('.crop-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update active crop in state
                this.activeCrop = btn.dataset.crop;
                this.updateScanButtonState();
            });
 });
    },

    updateScanButtonState() {
        const scanBtn = document.getElementById('runScanBtn');
        if (scanBtn) {
            scanBtn.disabled = !document.getElementById('imageUpload').files[0];
        }
    },

    // --- API Calls ---
    async api(path, options = {}) {
        const url = `${API_BASE}${path}`;
        const defaults = {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options,
        };

        const response = await fetch(url, defaults);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || data.error || `API error: ${response.status}`);
        }

        return data;
    },

    // --- Block Management ---
    async loadBlocks() {
        try {
            const data = await this.api('/blocks');
            this.renderBlocks(data.blocks || []);
            return data.blocks || [];
        } catch (err) {
            console.error('Failed to load blocks:', err);
            return [];
        }
    },

    renderBlocks(blocks) {
        const container = document.getElementById('active-blocks-count');
        if (container) {
            container.textContent = blocks.length;
        }
    },

    // --- Telemetry / Scan History ---
    async loadTelemetry() {
        try {
            const data = await this.api('/telemetry');
            this.scanHistory = data.scans || [];
            this.renderTelemetry(this.scanHistory);
        } catch (err) {
            console.error('Failed to load telemetry:', err);
        }
    },

    renderTelemetry(scans) {
        const container = document.getElementById('telemetry-feed');
        if (!container) return;

        if (scans.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No scan records yet. Start scanning to populate telemetry.</div>';
            return;
        }

        container.innerHTML = scans.map(scan => `
            <div class="telemetry-item">
                <span>${scan.greenhouse_blocks?.block_name || scan.block_name || '—'}</span>
                <span style="color: var(--accent-green);">${scan.crop_type || '—'}</span>
                <span>${(scan.avg_stem_height_cm || 0).toFixed(2)} cm</span>
                <span style="color: var(--accent-orange);">Conf: ${(scan.confidence_score * 100 || 0).toFixed(0)}%</span>
                <span>${new Date(scan.scanned_at).toLocaleTimeString()}</span>
            </div>
        `).join('');
    },

    // --- Scan Logs Table (Page C) ---
    async loadScanLogs() {
        try {
            const data = await this.api('/telemetry');
            this.renderScanLogs(data.scans || []);
        } catch (err) {
            console.error('Failed to load scan logs:', err);
        }
    },

    renderScanLogs(scans) {
        const tbody = document.getElementById('scanTableBody');
        if (!tbody) return;

        if (scans.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="color: var(--text-muted); padding: 20px;">No scan records found.</td></tr>';
            return;
        }

        tbody.innerHTML = scans.map(scan => `
            <tr>
                <td>${scan.greenhouse_blocks?.block_name || scan.block_name || '—'}</td>
                <td style="color: var(--accent-green);">${scan.crop_type || '—'}</td>
                <td>${new Date(scan.scanned_at).toLocaleString()}</td>
                <td>${(scan.avg_stem_height_cm || 0).toFixed(2)}</td>
                <td>${(scan.avg_bud_diameter_cm || 0).toFixed(2)}</td>
                <td style="color: var(--accent-orange);">${(scan.confidence_score * 100 || 0).toFixed(0)}%</td>
                <td>${(scan.estimated_yield_units || 0).toLocaleString()}</td>
            </tr>
        `).join('');
    },

    // --- Filter logic for logs page ---
    applyLogsFilters() {
        const blockFilter = document.getElementById('blockFilter')?.value || '';
        const cropFilter = document.getElementById('cropFilter')?.value || 'all';
        const dateFrom = document.getElementById('dateFrom')?.value || '';
        const dateTo = document.getElementById('dateTo')?.value || '';

        // Reload all scans and filter client-side
        this.loadScanLogs();

        const rows = document.querySelectorAll('#scanTableBody tr');
        rows.forEach(row => {
            const blockName = row.cells[0].innerText.trim();
            const cropType = row.cells[1].innerText.trim().toLowerCase();
            const timestamp = row.cells[2].innerText.trim();

            const blockMatch = blockFilter === '' || blockName.toLowerCase().includes(blockFilter.toLowerCase());
            const cropMatch = cropFilter === 'all' || cropType === cropFilter;
            const dateMatch = (!dateFrom || new Date(timestamp) >= new Date(dateFrom)) &&
                             (!dateTo || new Date(timestamp) <= new Date(dateTo));

            row.style.display = (blockMatch && cropMatch && dateMatch) ? '' : 'none';
        });
    },

    // --- Harvest Forecasts Page (D) ---
    async loadForecasts() {
        try {
            // Fetch blocks and telemetry to compute projections
            const [blocks, scans] = await Promise.all([
                this.api('/blocks'),
                this.api('/telemetry')
            ]);

            this.renderForecastProjections(blocks.blocks || []);
            this.renderDispatchWindows(blocks.blocks || [], scans.scans || []);
        } catch (err) {
            console.error('Failed to load forecasts:', err);
        }
    },

    renderForecastProjections(blocks) {
        const velocities = this.calculateVelocities(blocks, document.getElementById('telemetry-feed') ? document.getElementById('telemetry-feed').innerText : '');
        const projections = this.computeExportProjections(velocities, blocks, 30);

        const container = document.getElementById('projectionCards');
        if (!container) return;

        if (Object.keys(projections).length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No block data available for projections.</div>';
            return;
        }

        container.innerHTML = Object.entries(projections).map(([name, data]) => `
            <div class="projection-card ${data.confidence < 0.7 ? 'warning' : ''}">
                <div class="label">${name}</div>
                <div class="value">${data.projected_export_volume_stems.toLocaleString()} stems</div>
                <div class="label">Velocity: ${data.velocity_cm_per_day} cm/day</div>
                <div class="label">Confidence: ${(data.confidence * 100).toFixed(0)}%</div>
            </div>
        `).join('');
    },

    calculateVelocities(blocks, telemetryText) {
        // Extract scan data from telemetry feed or fetch fresh
        return {};
    },

    computeExportProjections(velocities, blocks, daysAhead) {
        const projections = {};

        for (const block of blocks) {
            const blockId = block.id;
            const velocity = velocities[blockId] || 0;
            const targetDays = block.target_harvest_days || 60;
            const dailyVelocity = Math.max(velocity, 0.3);

            const rawProjection = Math.max(100, Math.floor(dailyVelocity * daysAhead));
            const decayFactor = Math.max(0.4, 1 - (daysAhead / 60));
            const exportVolume = Math.max(100, Math.floor(rawProjection * decayFactor));

            projections[block.block_name || 'Unknown'] = {
                projected_export_volume_stems: exportVolume,
                velocity_cm_per_day: velocity,
                days_projected: daysAhead,
                confidence: round(decayFactor, 2),
                target_harvest_days: targetDays,
            };
        }

        return projections;
    },

    round(num, decimals) {
        const factor = Math.pow(10, decimals || 0);
        return Math.round(num * factor) / factor;
    },

    renderDispatchWindows(blocks, scans) {
        const velocities = this.calculateVelocities(blocks, scans);
        const projections = this.computeExportProjections(velocities, blocks, 30);
        const ready = this.checkDispatchReadiness(projections);

        const container = document.getElementById('dispatchTable');
        if (!container) return;

        if (ready.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No blocks currently ready for cold-chain dispatch within the next 7 days.</div>';
            return;
        }

        container.innerHTML = ready.map(item => `
            <div class="dispatch-item ${item.readiness_score >= 0.7 ? 'ready' : 'warning'}">
                <span>${item.block}</span>
                <span>${item.export_volume.toLocaleString()} stems</span>
            </div>
        `).join('');
    },

    checkDispatchReadiness(projections) {
        const readyWindows = [];

        for (const [blockName, proj] of Object.entries(projections)) {
            const velocity = proj.velocity_cm_per_day || 0;
            const confidence = proj.confidence || 0;
            const exportVolume = proj.projected_export_volume_stems || 0;

            if (velocity >= 1.0 && confidence >= 0.5 && exportVolume >= 500) {
                readyWindows.push({
                    block: blockName,
                    export_volume: exportVolume,
                    readiness_score: confidence,
                });
            }
        }

        // Sort by readiness score descending
        readyWindows.sort((a, b) => b.readiness_score - a.readiness_score);
        return readyWindows;
    },
};

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
    state.init();
});