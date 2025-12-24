// Success Modal Functions
let successModal;
let successStatsOriginal, successStatsOptimized, successStatsSaved;
let successCountText;
let successDownloadBtn, successCloseBtn;

// Local helper that uses window.formatFileSize if available, or falls back to own impl
function formatFileSizeLocal(bytes) {
    // Use global if available (exported from main.js)
    if (typeof window.formatFileSize === 'function') {
        return window.formatFileSize(bytes);
    }
    // Fallback implementation
    if (bytes === 0) return '0 Bytes';
    const sign = bytes < 0 ? -1 : 1;
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const absoluteBytes = Math.abs(bytes);
    const i = Math.floor(Math.log(absoluteBytes) / Math.log(k));
    const value = Math.round(absoluteBytes / Math.pow(k, i) * 100) / 100;
    const formatted = value + ' ' + sizes[i];
    return sign < 0 ? `-${formatted}` : formatted;
}

document.addEventListener('DOMContentLoaded', function () {
    successModal = document.getElementById('successModal');
    successStatsOriginal = document.getElementById('successStatsOriginal');
    successStatsOptimized = document.getElementById('successStatsOptimized');
    successStatsSaved = document.getElementById('successStatsSaved');
    successCountText = document.getElementById('successCountText');
    successDownloadBtn = document.getElementById('successDownloadBtn');
    successCloseBtn = document.getElementById('successCloseBtn');

    if (successCloseBtn) {
        successCloseBtn.addEventListener('click', hideSuccessModal);
    }

    if (successDownloadBtn) {
        successDownloadBtn.addEventListener('click', () => {
            // Check on window object since this is set by ES modules
            if (typeof window.handleDownloadAllClick === 'function') {
                window.handleDownloadAllClick();
            } else if (typeof window.downloadAll === 'function') {
                window.downloadAll();
            }
        });
    }
});

// Export to window for access from ES modules
window.showSuccessModal = showSuccessModal;
window.hideSuccessModal = hideSuccessModal;

function showSuccessModal(stats) {
    if (!successModal) return;

    // Update stats
    if (successStatsOriginal) successStatsOriginal.textContent = formatFileSizeLocal(stats.originalTotal);
    if (successStatsOptimized) successStatsOptimized.textContent = formatFileSizeLocal(stats.optimizedTotal);

    if (successStatsSaved) {
        const savedBytes = stats.originalTotal - stats.optimizedTotal;
        const savedPercent = stats.originalTotal > 0
            ? Math.round((savedBytes / stats.originalTotal) * 100)
            : 0;

        // Handle case where file size increased
        if (savedBytes < 0) {
            successStatsSaved.textContent = `+${formatFileSizeLocal(Math.abs(savedBytes))}`;
            successStatsSaved.style.color = 'var(--error)'; // Or a warning color
        } else {
            successStatsSaved.textContent = `${formatFileSizeLocal(savedBytes)} (-${savedPercent}%)`;
            successStatsSaved.style.color = 'var(--primary)';
        }
    }

    if (successCountText) {
        const count = stats.count;
        successCountText.textContent = `Successfully optimized ${count} image${count !== 1 ? 's' : ''}!`;
    }

    // Show modal
    document.body.classList.add('no-scroll');
    successModal.style.display = 'flex';

    // Trigger confetti if available
    triggerConfetti();
}

function hideSuccessModal() {
    if (!successModal) return;

    // Add fade out class or animation logic if desired
    successModal.style.display = 'none';
    document.body.classList.remove('no-scroll');
}

function triggerConfetti() {
    if (typeof confetti === 'function') {
        const count = 200;
        const defaults = {
            origin: { y: 0.7 }
        };

        function fire(particleRatio, opts) {
            confetti(Object.assign({}, defaults, opts, {
                particleCount: Math.floor(count * particleRatio)
            }));
        }

        fire(0.25, {
            spread: 26,
            startVelocity: 55,
        });
        fire(0.2, {
            spread: 60,
        });
        fire(0.35, {
            spread: 100,
            decay: 0.91,
            scalar: 0.8
        });
        fire(0.1, {
            spread: 120,
            startVelocity: 25,
            decay: 0.92,
            scalar: 1.2
        });
        fire(0.1, {
            spread: 120,
            startVelocity: 45,
        });
    }
}
