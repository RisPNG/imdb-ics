if (navigator.clipboard?.writeText) {
  const status = document.getElementById('copy-status');
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.hidden = false;
    const label = button.innerHTML;
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.dataset.copy);
      status.textContent = '';
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = 'Copied';
        status.textContent = 'Calendar link copied.';
      } catch {
        input.focus();
        input.select();
        button.textContent = 'Copy manually';
        status.textContent = 'Copy is unavailable. The address is selected so you can copy it manually.';
      } finally {
        button.disabled = false;
        setTimeout(() => { button.innerHTML = label; }, 2000);
      }
    });
  }
}
