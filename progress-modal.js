// Progress Modal Functions
let progressModal, progressPercentage, progressStatus, progressRingFill;

// Initialize progress modal elements
document.addEventListener('DOMContentLoaded', function () {
    progressModal = document.getElementById('progressModal');
    progressPercentage = document.getElementById('progressPercentage');
    progressStatus = document.getElementById('progressStatus');
    progressRingFill = document.querySelector('.progress-ring-fill');
});

// Show progress modal
function showProgressModal() {
    if (!progressModal) return;
    document.body.classList.add('no-scroll');
    progressModal.style.display = 'flex';
    updateProgress(0, 1);
}

// Update progress
function updateProgress(current, total) {
    if (!progressModal || !progressPercentage || !progressStatus || !progressRingFill) return;

    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    // Update percentage text
    progressPercentage.textContent = percentage + '%';

    // Update status text
    if (current >= total) {
        progressStatus.textContent = 'Complete!';
    } else {
        // Show current+1 since 'current' represents completed count, not the one being processed
        progressStatus.textContent = `Processing image ${Math.min(current + 1, total)} of ${total}...`;
    }

    // Animate SVG ring
    const circumference = 2 * Math.PI * 54; // 2 * PI * radius
    const offset = circumference - (percentage / 100) * circumference;
    progressRingFill.style.strokeDashoffset = offset;
}

// Hide progress modal
function hideProgressModal() {
    if (!progressModal) return;

    setTimeout(() => {
        progressModal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }, 500); // Small delay to show 100% completion
}

// Export functions to window for access from ES modules
window.showProgressModal = showProgressModal;
window.updateProgress = updateProgress;
window.hideProgressModal = hideProgressModal;
