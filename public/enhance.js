for (const button of document.querySelectorAll('[data-copy]')) {
  const input = document.getElementById(button.dataset.copy);
  const status = button.closest('.feed-url')?.querySelector('[role="status"]');
  if (!input || !status) continue;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      status.textContent = 'Subscription link copied.';
    } catch {
      input.focus();
      input.select();
      status.textContent = 'Link selected. Copy it with your keyboard or touch menu.';
    }
  });
}
