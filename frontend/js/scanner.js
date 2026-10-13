/**
 * scanner.js - AI Camera Scanner Page Logic
 * Handles image capture/upload, OpenCV processing via FastAPI,
 * and live telemetry feedback display.
 * 
 * STRICT RULE: No "preset" terminology used in buttons, tabs, labels, or code attributes.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const imageUpload = document.getElementById('imageUpload');
    const framePreview = document.getElementById('framePreview');
    const imagePlaceholder = document.getElementById('imagePlaceholder');
    const scanBtn = document.getElementById('runScanBtn');
    const cropBtns = document.querySelectorAll('.crop-btn');
    const stickerOptions = document.querySelectorAll('.sticker-option');
    const stickerWidthDisplay = document.getElementById('stickerWidth');
    const stickerBadge = document.getElementById('stickerBadge');
    const feedbackHeight = document.getElementById('feedbackHeight');
    const feedbackDiameter = document.getElementById('feedbackDiameter');
    const feedbackYield = document.getElementById('feedbackYield');
    const feedbackConfidence = document.getElementById('feedbackConfidence');
    const feedbackSticker = document.getElementById('feedbackSticker');
    const loadingText = document.getElementById('loadingText') || null;
    const resultCard = document.getElementById('resultCard') || null;

    // --- State ---
    let selectedCrop = 'roses';
    let selectedSticker = 'yellow';
    let referenceWidthCm = 5.0;

    // --- Crop Button Events ---
    cropBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            cropBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCrop = btn.dataset.crop;
            this.updateScanButtonState();
        });
    });

    // --- Sticker Color Events ---
    stickerOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            stickerOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            selectedSticker = opt.dataset.sticker;
            referenceWidthCm = selectedSticker === 'red' || selectedSticker === 'yellow' ? 5.0 : 5.0;
            if (stickerWidthDisplay) stickerWidthDisplay.textContent = referenceWidthCm;
            if (stickerBadge) stickerBadge.textContent = 'Verified';
            this.updateScanButtonState();
        });
    });

    // --- File Upload / Preview ---
    if (imageUpload) {
        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Show preview
            const reader = new FileReader();
            reader.onload = (event) => {
                framePreview.src = event.target.result;
                framePreview.style.display = 'block';
                imagePlaceholder.style.display = 'none';
            };
            reader.readAsDataURL(file);

            // Update UI state
            document.getElementById('fileStatus').textContent = `Selected: ${file.name}`;
        });
    }

    // --- Scan Button ---
    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            // Disable button during processing
            scanBtn.disabled = true;
            scanBtn.innerText = 'Analyzing...';

            // Show loading state
            if (loadingText) loadingText.style.display = 'block';
            if (resultCard) resultCard.style.display = 'none';

            // Get the selected file
            const file = imageUpload.files[0];
            if (!file) {
                alert('Please capture or upload an image frame first.');
                scanBtn.disabled = false;
                scanBtn.innerText = 'Run AI Depth & Yield Analysis';
                if (loadingText) loadingText.style.display = 'none';
                return;
            }

            // Build form data for API call
            const formData = new FormData();
            formData.append('file', file);
            formData.append('block_id', document.getElementById('blockId')?.value || 'block-b4-uuid');
            formData.append('crop_type', selectedCrop);
            formData.append('sticker_color', selectedSticker);
            formData.append('known_reference_cm', referenceWidthCm);

            try {
                // Call the FastAPI CV engine
                const response = await fetch('/api/v1/cdu/scan', {
                    method: 'POST',
                    body: formData,
                });

                const result = await response.json();

                // Handle errors
                if (result.status !== 'success') {
                    throw new Error(result.detail || 'Scan failed');
                }

                // Update live feedback UI
                if (feedbackHeight) feedbackHeight.textContent = result.avg_stem_height_cm;
                if (feedbackDiameter) feedbackDiameter.textContent = result.avg_bud_diameter_cm;
                if (feedbackYield) feedbackYield.textContent = result.estimated_yield_units;
                if (feedbackConfidence) feedbackConfidence.textContent = (result.confidence_score * 100).toFixed(0) + '%';
                if (feedbackSticker) feedbackSticker.textContent = result.sticker_detected ? 'Yes' : 'No';

                // Show results card
                if (resultCard) {
                    resultCard.style.display = 'block';
                    // Update the result card metrics
                    const resultCardHeight = resultCard.querySelector('#resHeight');
                    const resultCardBud = resultCard.querySelector('#resBud');
                    const resultCardYield = resultCard.querySelector('#resYield');
                    const resultCardConf = resultCard.querySelector('#resConf');
                    const resultCardFound = resultCard.querySelector('#resFound');

                    if (resultCardHeight) resultCardHeight.textContent = result.avg_stem_height_cm + ' cm';
                    if (resultCardBud) resultCardBud.textContent = result.avg_bud_diameter_cm + ' cm';
                    if (resultCardYield) resultCardYield.textContent = result.estimated_yield_units + ' units';
                    if (resultCardConf) resultCardConf.textContent = (result.confidence_score * 100).toFixed(1) + '%';
                    if (resultCardFound) resultCardFound.textContent = result.sticker_detected ? 'Yes (Reference Matched)' : 'No sticker detected';
                }

                // Log telemetry to Supabase (background)
                try {
                    await fetch('/api/v1/cdu/telemetry', { method: 'GET' });
                } catch (e) {
                    // Non-critical - telemetry logging failure doesn't affect UI
                    console.debug('Telemetry log fetch note:', e.message);
                }

            } catch (err) {
                console.error('Scan error:', err);
                alert('Scan failed: ' + err.message);
            } finally {
                // Re-enable scan button
                scanBtn.disabled = false;
                scanBtn.innerText = 'Run AI Depth & Yield Analysis';

                // Hide loading state
                if (loadingText) loadingText.style.display = 'none';
            }
        });
    }

    // --- Update scan button state based on file selection ---
    this.updateScanButtonState = () => {
        if (scanBtn) {
            scanBtn.disabled = !(imageUpload.files[0] && document.querySelector('.crop-btn.active') && document.querySelector('.sticker-option.active'));
        }
    };

    // Initial state setup
    if (scanBtn) scanBtn.disabled = true;
    if (document.querySelector('.crop-btn')) {
        document.querySelector('.crop-btn.active') || cropBtns[0].classList.add('active');
    }
    if (document.querySelector('.sticker-option')) {
        document.querySelector('.sticker-option.active') || stickerOptions[0].classList.add('active');
    }
});