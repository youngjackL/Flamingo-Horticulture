/**
 * logs.js - Batch Scan Logs Page Logic
 * Displays historical field scans in a searchable, filterable data table.
 * Filters: block name, crop type, date range.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const blockFilter = document.getElementById('blockFilter');
    const cropFilter = document.getElementById('cropFilter');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const applyFiltersBtn = document.querySelector('.apply-filters-btn') || null;

    // --- Initialize: Load scan logs on page show ---
    // The page A (Dashboard) init handler in app.js calls this
    const initLogsPage = () => {
        loadAndRenderLogs();
    };

    // --- Load logs from API ---
    const loadAndRenderLogs = async () => {
        try {
            const response = await fetch('/api/v1/cdu/telemetry');
            const data = await response.json();
            renderScanLogs(data.scans || []);
        } catch (err) {
            console.error('Failed to load scan logs:', err);
            const tbody = document.getElementById('scanTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="7" style="color: var(--text-muted); padding: 20px;">Error loading scan data. Check API connectivity.</td></tr>';
            }
        }
    };

    // --- Render logs to HTML table ---
    const renderScanLogs = (scans) => {
        const tbody = document.getElementById('scanTableBody');
        if (!tbody) return;

        if (scans.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="color: var(--text-muted); padding: 20px;">No scan records found. Use the AI Camera Scanner to add new entries.</td></tr>';
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
    };

    // --- Apply Filters ---
    const applyLogsFilters = () => {
        const blockFilterValue = (blockFilter || {}).value || '';
        const cropFilterValue = (cropFilter || {}).value || 'all';
        const dateFromValue = (dateFrom || {}).value || '';
        const dateToValue = (dateTo || {}).value || '';

        // Re-fetch all scans and filter client-side
        loadAndRenderLogs();

        const rows = document.querySelectorAll('#scanTableBody tr');
        rows.forEach(row => {
            const blockName = row.cells[0]?.innerText?.trim() || '';
            const cropType = row.cells[1]?.innerText?.trim().toLowerCase() || '';
            const timestamp = row.cells[2]?.innerText?.trim() || '';

            const blockMatch = blockFilterValue === '' || blockName.toLowerCase().includes(blockFilterValue.toLowerCase());
            const cropMatch = cropFilterValue === 'all' || cropType === cropFilterValue.toLowerCase();
            const dateMatch = (!dateFromValue || new Date(timestamp) >= new Date(dateFromValue)) &&
                             (!dateToValue || new Date(timestamp) <= new Date(dateToValue));

            row.style.display = (blockMatch && cropMatch && dateMatch) ? '' : 'none';
        });
    };

    // --- Event Delegation for Filter Controls ---
    document.addEventListener('input', (e) => {
        const target = e.target;

        if (target.id === 'blockFilter' || target.id === 'cropFilter' || target.id === 'dateFrom' || target.id === 'dateTo') {
            applyLogsFilters();
        }
    });

    // --- Initialization ---
    // Only initialize if we're on the logs page
    if (document.getElementById('scanTableBody')) {
        initLogsPage();
    }
});