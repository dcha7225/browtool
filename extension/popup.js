// Popup script
let isRecording = false;
let recordedActions = [];
let initialUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusText = document.getElementById('statusText');
  const actionCount = document.getElementById('actionCount');
  const recordingInfo = document.getElementById('recordingInfo');
  const actionsList = document.getElementById('actionsList');
  const actionsCount = document.getElementById('actionsCount');
  const message = document.getElementById('message');

  // Check current recording status
  checkRecordingStatus();

  startBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'startRecording' });
      
      isRecording = true;
      recordedActions = [];
      initialUrl = null;
      
      updateUI();
      showMessage('Recording started!', 'success');
    } catch (error) {
      console.error('Error starting recording:', error);
      showMessage('Error starting recording. Make sure you\'re on a web page.', 'error');
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
      
      if (response && response.actions) {
        recordedActions = response.actions;
        initialUrl = response.initialUrl;
        isRecording = false;
        updateUI();
        showMessage('Recording stopped!', 'success');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      showMessage('Error stopping recording.', 'error');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const name = document.getElementById('recordingName').value.trim();
    const description = document.getElementById('recordingDescription').value.trim();

    if (!name) {
      showMessage('Please enter a name for the recording.', 'error');
      return;
    }

    if (recordedActions.length === 0) {
      showMessage('No actions recorded. Please record some actions first.', 'error');
      return;
    }

    const recording = {
      name: name,
      description: description || '',
      initialUrl: initialUrl,
      actions: recordedActions
    };

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'saveRecording',
        recording: recording
      });

      if (response && response.success) {
        showMessage('JSONL downloaded successfully!', 'success');
        // Reset form
        document.getElementById('recordingName').value = '';
        document.getElementById('recordingDescription').value = '';
        recordedActions = [];
        initialUrl = null;
        updateUI();
      } else {
        showMessage('Error downloading JSONL: ' + (response?.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error saving recording:', error);
      showMessage('Error downloading JSONL: ' + error.message, 'error');
    }
  });

  async function checkRecordingStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getRecordingStatus' });
      
      if (response) {
        isRecording = response.isRecording;
        if (response.actionCount !== undefined) {
          // We don't have the full actions, but we know the count
        }
        updateUI();
      }
    } catch (error) {
      // Tab might not be ready, that's okay
      console.log('Could not check recording status:', error);
    }
  }

  function updateUI() {
    if (isRecording) {
      statusText.textContent = 'Recording...';
      statusText.className = 'recording';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      recordingInfo.style.display = 'none';
    } else {
      statusText.textContent = 'Not recording';
      statusText.className = '';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      
      if (recordedActions.length > 0) {
        recordingInfo.style.display = 'block';
        actionsCount.textContent = recordedActions.length;
        displayActions();
      } else {
        recordingInfo.style.display = 'none';
      }
    }
    
    actionCount.textContent = recordedActions.length > 0 ? `(${recordedActions.length} actions)` : '';
  }

  function displayActions() {
    actionsList.innerHTML = '';
    recordedActions.forEach((action, index) => {
      const div = document.createElement('div');
      div.className = 'action-item';
      div.innerHTML = `
        <strong>${index + 1}.</strong> 
        <span class="action-type">${action.type}</span> 
        <span class="action-selector">${action.selector}</span>
        ${action.text ? `<span class="action-text">"${action.text}"</span>` : ''}
      `;
      actionsList.appendChild(div);
    });
  }

  function showMessage(text, type) {
    message.textContent = text;
    message.className = `message ${type}`;
    message.style.display = 'block';
    
    setTimeout(() => {
      message.style.display = 'none';
    }, 3000);
  }

  // Poll for status updates
  setInterval(checkRecordingStatus, 1000);
});

