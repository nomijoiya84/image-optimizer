/**
 * Toast Notification System
 */
const Toast = {
    container: null,

    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },

    show(options) {
        this.init();

        const {
            title = '',
            message = '',
            type = 'info', // info, success, warning, error
            duration = 5000,
            onClose = null
        } = options;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Icon selection
        let iconMarkup = '';
        if (type === 'success') {
            iconMarkup = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        } else if (type === 'error') {
            iconMarkup = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        } else if (type === 'warning') {
            iconMarkup = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
        } else {
            iconMarkup = '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
        }

        toast.innerHTML = `
            ${iconMarkup}
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Close notification">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <div class="toast-progress"></div>
        `;

        this.container.appendChild(toast);

        // Force reflow
        toast.offsetHeight;
        toast.classList.add('show');

        const progress = toast.querySelector('.toast-progress');
        if (duration > 0) {
            progress.style.transitionDuration = `${duration}ms`;
            setTimeout(() => {
                progress.style.width = '100%';
            }, 10);
        } else {
            progress.style.display = 'none';
        }

        const closeBtn = toast.querySelector('.toast-close');

        const dismiss = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
                if (onClose) onClose();
            }, 400);
        };

        closeBtn.onclick = dismiss;

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }

        return { dismiss };
    },

    success(message, title = 'Success', duration = 4000) {
        return this.show({ message, title, type: 'success', duration });
    },

    error(message, title = 'Error', duration = 6000) {
        return this.show({ message, title, type: 'error', duration });
    },

    warning(message, title = 'Warning', duration = 5000) {
        return this.show({ message, title, type: 'warning', duration });
    },

    info(message, title = 'Info', duration = 4000) {
        return this.show({ message, title, type: 'info', duration });
    }
};

window.Toast = Toast;
