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

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });
        
        // Close menu when clicking a link
        document.querySelectorAll('.mobile-link').forEach(link => {
            link.addEventListener('click', () => mobileMenu.classList.add('hidden'));
        });
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

    // Stats counting animation on scroll
    const statNumbers = document.querySelectorAll('.stat-number');
    let hasAnimatedStats = false;

    const animateStats = () => {
        statNumbers.forEach(stat => {
            const target = parseInt(stat.getAttribute('data-target'), 10);
            const duration = 2000; // Animation duration in ms
            const step = target / (duration / 16); // Frame rate step size
            let current = 0;

            const updateStat = () => {
                current += step;
                if (current < target) {
                    stat.innerText = Math.ceil(current).toLocaleString();
                    requestAnimationFrame(updateStat);
                } else {
                    stat.innerText = target.toLocaleString();
                }
            };
            updateStat();
        });
    };

    const statsSection = document.getElementById('stats-section');
    if (statsSection) {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !hasAnimatedStats) {
                hasAnimatedStats = true;
                animateStats();
                observer.disconnect(); // Only animate once
            }
        }, { threshold: 0.5 });
        observer.observe(statsSection);
    }
});