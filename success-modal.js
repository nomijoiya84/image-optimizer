// Success Modal Functions
let successModal;
let successStatsOriginal, successStatsOptimized, successStatsSaved;
let successCountText;
let successDownloadBtn, successCloseBtn;

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
            if (typeof handleDownloadAllClick === 'function') {
                handleDownloadAllClick();
            }
        });
    }
});

function showSuccessModal(stats) {
    if (!successModal) return;

    // Update stats
    if (successStatsOriginal) successStatsOriginal.textContent = formatFileSize(stats.originalTotal);
    if (successStatsOptimized) successStatsOptimized.textContent = formatFileSize(stats.optimizedTotal);

    if (successStatsSaved) {
        const savedBytes = stats.originalTotal - stats.optimizedTotal;
        const savedPercent = stats.originalTotal > 0
            ? Math.round((savedBytes / stats.originalTotal) * 100)
            : 0;

        // Handle case where file size increased
        if (savedBytes < 0) {
            successStatsSaved.textContent = `+${formatFileSize(Math.abs(savedBytes))}`;
            successStatsSaved.style.color = 'var(--error)'; // Or a warning color
        } else {
            successStatsSaved.textContent = `${formatFileSize(savedBytes)} (-${savedPercent}%)`;
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
