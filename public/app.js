document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('videoUrl');
    const pasteBtn = document.getElementById('pasteBtn');
    const convertBtn = document.getElementById('convertBtn');
    const qualitySelect = document.getElementById('quality');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const formatBtns = document.querySelectorAll('.format-btn');

    let selectedFormat = 'mp3';

    // =====================================================
    // FORMAT TOGGLE
    // =====================================================

    formatBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            formatBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedFormat = btn.dataset.format;
            
            // تحديث خيارات الجودة حسب النوع
            updateQualityOptions(selectedFormat);
        });
    });

    function updateQualityOptions(format) {
        const options = {
            mp3: [
                { value: '128', text: '128 kbps (MP3)' },
                { value: '192', text: '192 kbps (MP3)' },
                { value: '256', text: '256 kbps (MP3)' },
                { value: '320', text: '320 kbps (MP3)' }
            ],
            mp4: [
                { value: 'low', text: 'Low (360p)' },
                { value: 'medium', text: 'Medium (720p)' },
                { value: 'high', text: 'High (1080p)' }
            ]
        };

        const currentValue = qualitySelect.value;
        qualitySelect.innerHTML = '';
        options[format].forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (opt.value === currentValue) {
                option.selected = true;
            }
            qualitySelect.appendChild(option);
        });
    }

    // =====================================================
    // PASTE BUTTON
    // =====================================================

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            setStatus('URL pasted from clipboard', 'success');
        } catch {
            setStatus('Could not access clipboard. Please paste manually.', 'error');
        }
    });

    // =====================================================
    // CONVERT BUTTON
    // =====================================================

    convertBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        const quality = qualitySelect.value;

        if (!url) {
            setStatus('Please enter a valid URL', 'error');
            return;
        }

        // Validate URL
        try {
            new URL(url);
        } catch {
            setStatus('Invalid URL. Please enter a valid YouTube URL.', 'error');
            return;
        }

        setStatus('⏳ Processing... Please wait', 'loading');
        convertBtn.disabled = true;
        resultDiv.classList.remove('show');
        resultDiv.style.display = 'none';

        try {
            const response = await fetch('/convert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: url,
                    quality: quality,
                    format: selectedFormat
                })
            });

            const data = await response.json();

            if (data.success) {
                // عرض معلومات الفيديو
                showResult(data);
                setStatus('✅ Processing complete!', 'success');
            } else {
                setStatus('❌ ' + (data.error || 'Conversion failed'), 'error');
            }
        } catch (error) {
            setStatus('❌ Error: ' + error.message, 'error');
        } finally {
            convertBtn.disabled = false;
        }
    });

    // =====================================================
    // STATUS HELPER
    // =====================================================

    function setStatus(message, type = 'loading') {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + type;
        statusDiv.style.display = 'block';
    }

    // =====================================================
    // RESULT HELPER
    // =====================================================

    function showResult(data) {
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'block';
        resultDiv.className = 'result show';

        let html = '';

        // Thumbnail
        if (data.thumbnail) {
            html += `<img src="${data.thumbnail}" alt="Thumbnail" class="thumbnail">`;
        }

        // Title
        if (data.title) {
            html += `<div class="title">${data.title}</div>`;
        }

        // Info
        html += `<div class="info">`;
        if (data.format) {
            html += `<span>📦 ${data.format}</span>`;
        }
        if (data.quality) {
            html += `<span>🎛️ ${data.quality}</span>`;
        }
        if (data.fileSize) {
            html += `<span>📊 ${data.fileSize}</span>`;
        }
        html += `</div>`;

        // Download button
        html += `<a href="${data.downloadUrl}" class="download-btn" download>⬇️ Download ${data.format === 'MP4' ? 'Video' : 'Audio'}</a>`;

        resultDiv.innerHTML = html;
    }

    // =====================================================
    // ENTER KEY SUPPORT
    // =====================================================

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            convertBtn.click();
        }
    });

    // =====================================================
    // INIT
    // =====================================================

    // تعيين الخيارات الافتراضية
    updateQualityOptions('mp3');
});