// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const toggleSwitch = document.getElementById('toggle-switch');
  const statusElement = document.getElementById('status');

  // Function to update status text
  function updateStatus(enabled) {
    statusElement.textContent = enabled ? 'active' : 'inactive';
  }

  // Load the saved state from storage
  chrome.storage.sync.get('enabled', (data) => {
    const isEnabled = data.enabled !== false; // Default to true
    toggleSwitch.checked = isEnabled;
    updateStatus(isEnabled);
  });

  // Save the state and update status when the switch is toggled
  toggleSwitch.addEventListener('change', () => {
    const isEnabled = toggleSwitch.checked;
    chrome.storage.sync.set({ enabled: isEnabled });
    updateStatus(isEnabled);
  });
});
