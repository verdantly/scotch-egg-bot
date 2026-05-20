document.addEventListener('DOMContentLoaded', () => {
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