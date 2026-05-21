// Dark Mode Initialization (Runs immediately to prevent flash of incorrect theme)
const htmlElement = document.documentElement;
const savedTheme = localStorage.getItem('theme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    htmlElement.classList.add('dark');
} else {
    htmlElement.classList.remove('dark');
}

function toggleTheme() {
    htmlElement.classList.toggle('dark');
    const isDark = htmlElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // Copy to clipboard functionality for code blocks
    const copyButtons = document.querySelectorAll('.copy-btn');

    copyButtons.forEach(button => {
        button.addEventListener('click', () => {
            const codeBlockId = button.getAttribute('data-target');
            const codeBlock = document.getElementById(codeBlockId);
            
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.innerText).then(() => {
                    // Visual feedback
                    const originalText = button.innerHTML;
                    button.innerHTML = '<span class="text-green-600 font-medium">Copied!</span>';
                    setTimeout(() => {
                        button.innerHTML = originalText;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                });
            }
        });
    });
});