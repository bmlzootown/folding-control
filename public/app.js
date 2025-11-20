// Application state
const state = {
    instances: [],
    machines: [],
    workUnits: [],
    stats: {},
    projects: {},
    teams: [],
    refreshInterval: null,
    externalApiEnabled: true // Default to enabled
};

// Store last known progress for paused work units
const pausedProgress = new Map(); // key: `${instanceId}-${project}-${slot}`, value: progress percentage

// API base URL
const API_BASE = '';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    loadExternalApiSetting(); // Load external API setting first
    loadCustomCss(); // Load and apply custom CSS
    setupEventListeners();
    await loadInstances();
    loadTeams(); // Load teams from localStorage
    await refreshData();
    startAutoRefresh();
}

function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            switchTab(tabName);
        });
    });

    // Instances modal
    document.getElementById('instancesBtn').addEventListener('click', () => {
        document.getElementById('instancesModal').classList.add('active');
    });

    document.getElementById('closeInstances').addEventListener('click', () => {
        document.getElementById('instancesModal').classList.remove('active');
    });

    // Settings modal
    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('active');
        loadTeams();
        loadEOCUserId();
        loadCustomCss();
        // Update toggle state when opening settings
        const toggle = document.getElementById('externalApiToggle');
        if (toggle) {
            toggle.checked = state.externalApiEnabled;
        }
    });
    
    // Settings tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.settingsTab;
            switchSettingsTab(tabName);
        });
    });
    
    // Save EOC User ID button
    document.getElementById('saveEOCUserId').addEventListener('click', () => {
        saveEOCUserId();
    });
    
    // Save Custom CSS button
    document.getElementById('saveCustomCss').addEventListener('click', () => {
        saveCustomCss();
    });

    document.getElementById('closeSettings').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('active');
    });

    // External API toggle
    document.getElementById('externalApiToggle').addEventListener('change', (e) => {
        state.externalApiEnabled = e.target.checked;
        saveExternalApiSetting();
        
        // Immediately update the add team form state in the modal
        renderTeamsList();
        
        // Update EOC User ID input state
        const eocUserIdInput = document.getElementById('eocUserId');
        const saveEOCBtn = document.getElementById('saveEOCUserId');
        if (eocUserIdInput && saveEOCBtn) {
            if (state.externalApiEnabled) {
                eocUserIdInput.disabled = false;
                saveEOCBtn.disabled = false;
                eocUserIdInput.style.opacity = '1';
                saveEOCBtn.style.opacity = '1';
            } else {
                eocUserIdInput.disabled = true;
                saveEOCBtn.disabled = true;
                eocUserIdInput.style.opacity = '0.5';
                saveEOCBtn.style.opacity = '0.5';
            }
        }
        
        // Refresh current tab if it depends on external API
        const activeTab = document.querySelector('.nav-tab.active');
        if (activeTab) {
            const tabName = activeTab.dataset.tab;
            if (tabName === 'stats' || tabName === 'projects') {
                if (tabName === 'stats') {
                    loadStats();
                } else if (tabName === 'projects') {
                    loadProjects();
                }
            }
        }
    });

    // Add instance form
    document.getElementById('addInstanceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addInstance();
    });

    // Add team form
    document.getElementById('addTeamForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addTeam();
    });

    // Control buttons
    document.getElementById('foldAllBtn').addEventListener('click', () => {
        foldAll();
    });

    document.getElementById('pauseAllBtn').addEventListener('click', () => {
        pauseAll();
    });

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // Close instances modal when clicking outside
    document.getElementById('instancesModal').addEventListener('click', (e) => {
        if (e.target.id === 'instancesModal') {
            document.getElementById('instancesModal').classList.remove('active');
        }
    });

    document.getElementById('closeWorkUnitModal').addEventListener('click', () => {
        document.getElementById('workUnitModal').classList.remove('active');
    });

    // Machine settings modal
    document.getElementById('cancelMachineSettings').addEventListener('click', () => {
        document.getElementById('machineSettingsModal').classList.remove('active');
        currentMachineSettings = null;
    });

    document.getElementById('saveMachineSettings').addEventListener('click', () => {
        saveMachineSettings();
    });

    // Close machine settings modal on outside click
    document.getElementById('machineSettingsModal').addEventListener('click', (e) => {
        if (e.target.id === 'machineSettingsModal') {
            document.getElementById('machineSettingsModal').classList.remove('active');
            currentMachineSettings = null;
        }
    });
}

function switchTab(tabName) {
    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // Load tab-specific data
    if (tabName === 'workunits') {
        loadWorkUnits();
    } else if (tabName === 'stats') {
        loadStats();
    } else if (tabName === 'projects') {
        loadProjects();
    }
}

async function loadInstances() {
    try {
        const response = await fetch(`${API_BASE}/api/instances`);
        state.instances = await response.json();
        renderInstancesList();
    } catch (error) {
        console.error('Error loading instances:', error);
    }
}

async function addInstance() {
    const name = document.getElementById('instanceName').value;
    const host = document.getElementById('instanceHost').value;
    const port = document.getElementById('instancePort').value;

    try {
        const response = await fetch(`${API_BASE}/api/instances`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, host, port })
        });

        if (response.ok) {
            await loadInstances();
            document.getElementById('addInstanceForm').reset();
            document.getElementById('instancePort').value = '7396';
            await refreshData();
        } else {
            alert('Failed to add instance');
        }
    } catch (error) {
        console.error('Error adding instance:', error);
        alert('Error adding instance: ' + error.message);
    }
}

async function removeInstance(instanceId) {
    if (instanceId === 'local') {
        alert('Cannot remove local instance');
        return;
    }

    if (!confirm('Are you sure you want to remove this instance?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/instances/${instanceId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadInstances();
            await refreshData();
        }
    } catch (error) {
        console.error('Error removing instance:', error);
    }
}

function renderInstancesList() {
    const container = document.getElementById('instancesList');
    container.innerHTML = '';

    state.instances.forEach(instance => {
        const item = document.createElement('div');
        item.className = 'instance-item';
        item.innerHTML = `
            <div class="instance-item-info">
                <div class="instance-item-name">${instance.name}</div>
                <div class="instance-item-host">${instance.host}:${instance.port}</div>
            </div>
            ${instance.id !== 'local' ? `<button class="btn btn-danger" onclick="removeInstance('${instance.id}')">Remove</button>` : ''}
        `;
        container.appendChild(item);
    });
}

// External API settings
function loadExternalApiSetting() {
    try {
        const stored = localStorage.getItem('fah-external-api-enabled');
        // Default to true if not set (null means first time, default to enabled)
        state.externalApiEnabled = stored !== null ? stored === 'true' : true;
        
        // Update toggle UI
        const toggle = document.getElementById('externalApiToggle');
        if (toggle) {
            toggle.checked = state.externalApiEnabled;
        }
    } catch (error) {
        console.error('Error loading external API setting:', error);
        state.externalApiEnabled = true; // Default to enabled on error
    }
}

function saveExternalApiSetting() {
    try {
        localStorage.setItem('fah-external-api-enabled', state.externalApiEnabled.toString());
    } catch (error) {
        console.error('Error saving external API setting:', error);
    }
}

// Team management functions
function loadTeams() {
    try {
        const stored = localStorage.getItem('fah-teams');
        state.teams = stored ? JSON.parse(stored) : [];
        renderTeamsList();
    } catch (error) {
        console.error('Error loading teams:', error);
        state.teams = [];
    }
}

function loadEOCUserId() {
    try {
        const stored = localStorage.getItem('fah-eoc-user-id');
        if (stored) {
            const eocUserIdInput = document.getElementById('eocUserId');
            if (eocUserIdInput) {
                eocUserIdInput.value = stored;
            }
        }
    } catch (error) {
        console.error('Error loading EOC user ID:', error);
    }
}

function saveEOCUserId() {
    try {
        const eocUserIdInput = document.getElementById('eocUserId');
        const userId = eocUserIdInput?.value.trim();
        if (userId && parseInt(userId) > 0) {
            localStorage.setItem('fah-eoc-user-id', userId);
            // Refresh stats if on stats page
            const activeTab = document.querySelector('.nav-tab.active');
            if (activeTab && activeTab.dataset.tab === 'stats') {
                loadStats();
            }
            alert('EOC User ID saved successfully!');
        } else {
            alert('Please enter a valid EOC User ID (positive number)');
        }
    } catch (error) {
        console.error('Error saving EOC user ID:', error);
        alert('Error saving EOC User ID: ' + error.message);
    }
}

// Settings tab switching
function switchSettingsTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-settings-tab="${tabName}"]`).classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}SettingsTab`).classList.add('active');
}

// Custom CSS functions
let customCssStyleElement = null;

function loadCustomCss() {
    try {
        const stored = localStorage.getItem('fah-custom-css');
        const cssTextarea = document.getElementById('customCss');
        if (cssTextarea) {
            cssTextarea.value = stored || '';
        }
        applyCustomCss(stored || '');
    } catch (error) {
        console.error('Error loading custom CSS:', error);
    }
}

function saveCustomCss() {
    try {
        const cssTextarea = document.getElementById('customCss');
        const css = cssTextarea?.value || '';
        localStorage.setItem('fah-custom-css', css);
        applyCustomCss(css);
        alert('Custom CSS saved successfully!');
    } catch (error) {
        console.error('Error saving custom CSS:', error);
        alert('Error saving custom CSS: ' + error.message);
    }
}

function applyCustomCss(css) {
    // Remove existing custom CSS style element if it exists
    if (customCssStyleElement) {
        customCssStyleElement.remove();
        customCssStyleElement = null;
    }
    
    // Only create and add style element if CSS is not empty
    if (css && css.trim()) {
        customCssStyleElement = document.createElement('style');
        customCssStyleElement.id = 'fah-custom-css';
        customCssStyleElement.textContent = css;
        document.head.appendChild(customCssStyleElement);
    }
}

function saveTeams() {
    try {
        localStorage.setItem('fah-teams', JSON.stringify(state.teams));
    } catch (error) {
        console.error('Error saving teams:', error);
    }
}

async function addTeam() {
    if (!state.externalApiEnabled) {
        alert('External API calls are disabled. Please enable them in Settings to add teams.');
        return;
    }

    const teamNumber = document.getElementById('teamNumber').value;
    
    if (!teamNumber || teamNumber.trim() === '') {
        alert('Please enter a team number');
        return;
    }

    const teamNum = parseInt(teamNumber);
    if (isNaN(teamNum) || teamNum <= 0) {
        alert('Please enter a valid team number');
        return;
    }

    // Check if team already exists
    if (state.teams.find(t => t.number === teamNum)) {
        alert('This team is already configured');
        return;
    }

    try {
        // Fetch team stats from Folding@Home API via proxy
        const response = await fetch(`${API_BASE}/api/stats/team/${teamNum}`);
        if (!response.ok) {
            throw new Error('Team not found');
        }
        const teamData = await response.json();
        
        const team = {
            number: teamNum,
            name: teamData.name || `Team ${teamNum}`,
            score: teamData.score || 0,
            wus: teamData.wus || 0
        };

        state.teams.push(team);
        saveTeams();
        renderTeamsList();
        document.getElementById('addTeamForm').reset();
        
        // Refresh stats if on stats page
        if (document.getElementById('statsTab').classList.contains('active')) {
            loadStats();
        }
    } catch (error) {
        console.error('Error adding team:', error);
        alert('Error adding team: ' + error.message + '\n\nMake sure the team number is valid.');
    }
}

function removeTeam(teamNumber) {
    if (!confirm('Are you sure you want to remove this team?')) {
        return;
    }

    state.teams = state.teams.filter(t => t.number !== teamNumber);
    saveTeams();
    renderTeamsList();
    
    // Refresh stats if on stats page
    if (document.getElementById('statsTab').classList.contains('active')) {
        loadStats();
    }
}

function renderTeamsList() {
    const container = document.getElementById('teamsList');
    if (!container) return;
    
    const addTeamForm = document.getElementById('addTeamForm');
    const addTeamBtn = addTeamForm?.querySelector('button[type="submit"]');
    
    // Disable add team form if external API is disabled
    if (addTeamForm && addTeamBtn) {
        if (!state.externalApiEnabled) {
            addTeamForm.style.opacity = '0.5';
            addTeamForm.style.pointerEvents = 'none';
            addTeamBtn.disabled = true;
            addTeamBtn.title = 'Enable external API calls in Settings to add teams';
        } else {
            addTeamForm.style.opacity = '1';
            addTeamForm.style.pointerEvents = 'auto';
            addTeamBtn.disabled = false;
            addTeamBtn.title = '';
        }
    }
    
    // Update EOC User ID input state based on external API toggle
    const eocUserIdInput = document.getElementById('eocUserId');
    const saveEOCBtn = document.getElementById('saveEOCUserId');
    if (eocUserIdInput && saveEOCBtn) {
        if (state.externalApiEnabled) {
            eocUserIdInput.disabled = false;
            saveEOCBtn.disabled = false;
            eocUserIdInput.style.opacity = '1';
            saveEOCBtn.style.opacity = '1';
        } else {
            eocUserIdInput.disabled = true;
            saveEOCBtn.disabled = true;
            eocUserIdInput.style.opacity = '0.5';
            saveEOCBtn.style.opacity = '0.5';
        }
    }
    
    container.innerHTML = '';

    if (state.teams.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No teams configured</div>';
        return;
    }

    state.teams.forEach(team => {
        const item = document.createElement('div');
        item.className = 'instance-item';
        item.innerHTML = `
            <div class="instance-item-info">
                <div class="instance-item-name">${team.name}</div>
                <div class="instance-item-host">Team #${team.number}</div>
            </div>
            <button class="btn btn-danger" onclick="removeTeam(${team.number})">Remove</button>
        `;
        container.appendChild(item);
    });
}

// Make functions available globally
window.removeTeam = removeTeam;

async function refreshData() {
    await loadMachines();
    // renderMachines is called separately to allow incremental updates
    renderMachines();
    // Load summary after machines are loaded (depends on state.machines)
    await loadSummary();
}

async function loadMachines() {
    // Don't clear container - let renderMachines handle incremental updates

    const allMachines = [];

    for (const instance of state.instances.filter(i => i.enabled)) {
        try {
            // Get machine info (contains full state)
            const infoResponse = await fetch(`${API_BASE}/api/fah/${instance.id}/info`);
            const infoData = await infoResponse.json();
            
            // Check if response indicates an error
            if (infoData.error || !infoData) {
                throw new Error(infoData.message || 'Failed to fetch machine info');
            }

            // FAH machine state structure: {info: {...}, units: [...], groups: {...}, config: {...}, ...}
            const machineState = infoData;
            const clientInfo = machineState.info || {};
            const units = machineState.units || [];
            const groups = machineState.groups || {};
            const globalConfig = machineState.config || {};
            
            // Debug: log the structure to see what we're getting
            console.debug(`${instance.name} machine state:`, {
                hasInfo: !!clientInfo,
                hasUnits: units.length > 0,
                hasGroups: Object.keys(groups).length > 0,
                hasConfig: !!globalConfig,
                infoKeys: Object.keys(clientInfo),
                unitCount: units.length
            });
            
            // Extract resources from config
            // Resources can be in global config or group configs
            let totalCPUs = 0;
            let gpuDescriptions = [];
            
            // Check global config first
            if (globalConfig.cpus) {
                totalCPUs += parseInt(globalConfig.cpus) || 0;
            }
            if (globalConfig.gpus && clientInfo.gpus) {
                for (const gpuId in globalConfig.gpus) {
                    const gpu = globalConfig.gpus[gpuId];
                    if (gpu.enabled && clientInfo.gpus[gpuId]) {
                        gpuDescriptions.push(clientInfo.gpus[gpuId].description || `GPU ${gpuId}`);
                    }
                }
            }
            
            // Check group configs
            for (const groupName in groups) {
                const group = groups[groupName];
                const config = group.config || {};
                if (config.cpus) {
                    totalCPUs += parseInt(config.cpus) || 0;
                }
                if (config.gpus && clientInfo.gpus) {
                    for (const gpuId in config.gpus) {
                        const gpu = config.gpus[gpuId];
                        if (gpu.enabled && clientInfo.gpus[gpuId]) {
                            const gpuDesc = clientInfo.gpus[gpuId].description || `GPU ${gpuId}`;
                            // Avoid duplicates
                            if (!gpuDescriptions.includes(gpuDesc)) {
                                gpuDescriptions.push(gpuDesc);
                            }
                        }
                    }
                }
            }
            
            // If no CPUs found in config, try to get from info
            if (totalCPUs === 0 && clientInfo.cpus) {
                totalCPUs = parseInt(clientInfo.cpus) || 0;
            }
            
            // Also check units for resource info
            if (totalCPUs === 0 && units.length > 0) {
                // Sum CPUs from active units
                units.forEach(unit => {
                    if (unit.cpus) {
                        totalCPUs += parseInt(unit.cpus) || 0;
                    }
                });
            }

            // Check if machine is paused (check config for paused state)
            let isPaused = false;
            if (globalConfig.paused) {
                isPaused = true;
            } else {
                // Check group configs
                for (const groupName in groups) {
                    const group = groups[groupName];
                    const config = group.config || {};
                    if (config.paused) {
                        isPaused = true;
                        break;
                    }
                }
            }
            
            // Build machine data
            const machine = {
                instanceId: instance.id,
                instanceName: instance.name,
                name: clientInfo.mach_name || clientInfo.name || instance.name,
                version: clientInfo.version || 'v8.4.9',
                info: clientInfo,
                units: units,
                groups: groups,
                config: globalConfig,
                totalCPUs: totalCPUs,
                gpuDescriptions: gpuDescriptions,
                isPaused: isPaused,
                connected: true
            };

            allMachines.push(machine);
        } catch (error) {
            // Machine is disconnected or unreachable
            console.warn(`Failed to connect to ${instance.name}:`, error.message);
            allMachines.push({
                instanceId: instance.id,
                instanceName: instance.name,
                name: instance.name,
                version: 'Unknown',
                units: [],
                connected: false,
                error: error.message
            });
        }
    }

    state.machines = allMachines;
    renderMachines();
}

function renderMachines() {
    const container = document.getElementById('machinesList');
    
    if (state.machines.length === 0) {
        container.innerHTML = '<div class="loading">No machines found. Make sure Folding@Home clients are running.</div>';
        return;
    }

    // Store existing machine cards to preserve DOM elements for smooth updates
    const existingCards = new Map();
    container.querySelectorAll('.machine-card').forEach(card => {
        const instanceId = card.dataset.instanceId;
        if (instanceId) {
            existingCards.set(instanceId, card);
        }
    });

    // Remove cards for machines that no longer exist
    existingCards.forEach((card, instanceId) => {
        if (!state.machines.find(m => m.instanceId === instanceId)) {
            card.remove();
            existingCards.delete(instanceId);
        }
    });

    // Update or create cards
    state.machines.forEach(machine => {
        const existingCard = existingCards.get(machine.instanceId);
        if (existingCard) {
            // Update existing card
            updateMachineCard(existingCard, machine);
        } else {
            // Create new card
            const card = createMachineCard(machine);
            container.appendChild(card);
        }
    });
}

function createMachineCard(machine) {
    const card = document.createElement('div');
    card.className = `machine-card ${!machine.connected ? 'disconnected' : ''}`;
    card.dataset.instanceId = machine.instanceId;
    card.innerHTML = getMachineCardHTML(machine);
    return card;
}

function updateMachineCard(card, machine) {
    // Only update if the data has actually changed to avoid flashing
    const currentHTML = card.innerHTML;
    const newHTML = getMachineCardHTML(machine);
    
    if (currentHTML !== newHTML) {
        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
            card.className = `machine-card ${!machine.connected ? 'disconnected' : ''}`;
            card.innerHTML = newHTML;
        });
    }
}

function getMachineCardHTML(machine) {
    const resources = [];
    
    if (machine.totalCPUs > 0) {
        resources.push(`${machine.totalCPUs} CPUs`);
    }
    if (machine.gpuDescriptions && machine.gpuDescriptions.length > 0) {
        resources.push(...machine.gpuDescriptions);
    }

    const workUnits = machine.units || [];

    return `
            <div class="machine-header">
                <div class="machine-title">
                    <div class="machine-name">${machine.name}</div>
                    <div class="machine-info">${machine.version} • ${resources.join(', ') || 'No resources'}${!machine.connected ? ' • Disconnected' : ''}</div>
                </div>
                <div class="machine-controls">
                    <button class="icon-btn" onclick="showMachineSettings('${machine.instanceId}')" title="Settings"><span class="material-symbols-filled">settings</span></button>
                    <button class="icon-btn" onclick="showMachineLog('${machine.instanceId}')" title="Logs"><span class="material-symbols-filled">description</span></button>
                    <button class="icon-btn" onclick="showMachineDetails('${machine.instanceId}')" title="Info"><span class="material-symbols-filled">info</span></button>
                    <button class="icon-btn" onclick="toggleMachine('${machine.instanceId}')" title="${machine.isPaused ? 'Resume' : 'Pause'}" id="pause-btn-${machine.instanceId}">
                        <span class="material-symbols-filled">${machine.isPaused ? 'play_arrow' : 'pause'}</span>
                    </button>
                </div>
            </div>
            ${!machine.connected ? `
                <div class="error" style="margin: 15px 0;">
                    <strong>Connection Error:</strong> ${machine.error || 'Unable to connect to Folding@Home client'}
                    <br><small>Make sure the FAH client is running on ${machine.instanceName === 'Local Instance' ? '127.0.0.1:7396' : machine.instanceName}. 
                    The client may use different API endpoints - check the README for troubleshooting.</small>
                </div>
            ` : ''}
            ${workUnits.length > 0 ? `
                <table class="machine-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>PPD</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${workUnits.map((wu, idx) => `
                            <tr>
                                <td>${wu.project || wu.assignment?.project || wu.assign?.project || 'N/A'}</td>
                                <td>
                                    <span class="status-icon ${getStatusClass(wu)}"></span>
                                    ${getStatusText(wu)}
                                </td>
                                <td>
                                    <div class="progress-bar" data-progress="${wu.progress || wu.wu_progress || 0}" data-project="${wu.project || wu.assignment?.project || ''}">
                                        ${(() => {
                                            // Progress is stored as decimal (0-1), multiply by 100
                                            let progress = wu.progress || wu.wu_progress || 0;
                                            if (progress <= 1) progress = progress * 100;
                                            progress = Math.max(0, Math.min(100, progress));
                                            
                                            // Check if paused
                                            const isPaused = wu.state === 'PAUSE' || wu.pause_reason || getStatusClass(wu) === 'paused';
                                            
                                            // Create a unique key for this work unit
                                            const wuKey = `${machine.instanceId}-${wu.project || wu.assignment?.project || wu.assign?.project || 'unknown'}-${wu.slot || idx}`;
                                            
                                            if (isPaused) {
                                                // When paused, preserve the last known progress
                                                if (!pausedProgress.has(wuKey) && progress > 0) {
                                                    // Store the progress when first paused
                                                    pausedProgress.set(wuKey, progress);
                                                }
                                                // Use stored progress if available, otherwise use current
                                                progress = pausedProgress.get(wuKey) || progress;
                                            } else {
                                                // When running, update stored progress and use current value
                                                if (progress > 0) {
                                                    pausedProgress.set(wuKey, progress);
                                                } else {
                                                    // If progress is 0, remove from stored (might be a new work unit)
                                                    pausedProgress.delete(wuKey);
                                                }
                                            }
                                            
                                            const statusClass = isPaused ? 'paused' : (progress < 50 ? 'warning' : '');
                                            
                                            return `<div class="progress-fill ${statusClass}" style="width: ${progress}%"></div>
                                                <div class="progress-text">${progress.toFixed(1)}%</div>`;
                                        })()}
                                    </div>
                                </td>
                                <td>${formatNumber(wu.ppd || 0)}</td>
                                <td>
                                    <div class="action-icons">
                                        <button class="action-icon" onclick="showWorkUnitLog('${machine.instanceId}', ${idx})" title="Logs"><span class="material-symbols-filled">description</span></button>
                                        <button class="action-icon" onclick="showWorkUnitDetails('${machine.instanceId}', ${idx})" title="Info"><span class="material-symbols-filled">info</span></button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No active work units</div>'}
        `;
}

async function loadSummary() {
    let totalMachines = 0;
    let totalCPUs = 0;
    let totalGPUs = 0;
    let totalPPD = 0;

    state.machines.forEach(machine => {
        if (machine.connected) {
            totalMachines++;
            totalCPUs += machine.totalCPUs || 0;
            totalGPUs += (machine.gpuDescriptions && machine.gpuDescriptions.length) || 0;
            if (machine.units && Array.isArray(machine.units)) {
                machine.units.forEach(wu => {
                    if (wu && (wu.ppd || wu.credit?.ppd)) {
                        totalPPD += (wu.ppd || wu.credit.ppd);
                    }
                });
            }
        }
    });

    document.getElementById('totalMachines').textContent = totalMachines;
    document.getElementById('totalCPUs').textContent = totalCPUs;
    document.getElementById('totalGPUs').textContent = totalGPUs;
    document.getElementById('totalPPD').textContent = formatNumber(totalPPD);
}

function getStatusClass(workUnit) {
    if (!workUnit) return 'paused';
    const state = workUnit.state || '';
    // FAH states: RUN, ASSIGN, DOWNLOAD, CORE, FINISH, UPLOAD, CLEAN, WAIT, PAUSE, DUMP, etc.
    if (state === 'RUN' || state === 'FINISH') return 'running';
    if (state === 'PAUSE' || workUnit.pause_reason) return 'paused';
    if (state === 'WAIT' || state === 'ASSIGN' || state === 'DOWNLOAD' || state === 'CORE') return 'running'; // Active states
    return 'paused';
}

function getStatusText(workUnit) {
    if (!workUnit) return 'Unknown';
    if (workUnit.pause_reason) return 'Paused';
    const state = workUnit.state || 'Unknown';
    // Map FAH states to readable text
    const stateMap = {
        'RUN': 'Running',
        'ASSIGN': 'Assigning',
        'DOWNLOAD': 'Downloading',
        'CORE': 'Loading Core',
        'FINISH': 'Finishing',
        'UPLOAD': 'Uploading',
        'CLEAN': 'Cleaning',
        'WAIT': 'Waiting',
        'PAUSE': 'Paused',
        'DUMP': 'Dumping'
    };
    return stateMap[state] || state;
}

function formatNumber(num) {
    return new Intl.NumberFormat().format(Math.round(num));
}

async function loadWorkUnits() {
    const container = document.getElementById('workUnitsList');
    container.innerHTML = '<div class="loading">Loading work units...</div>';

    // Aggregate all work units from all machines
    const allWorkUnits = [];
    state.machines.forEach(machine => {
        if (machine.units && Array.isArray(machine.units)) {
            machine.units.forEach((wu, wuIndex) => {
                if (wu) {
                    allWorkUnits.push({
                        ...wu,
                        machineName: machine.name,
                        instanceId: machine.instanceId,
                        wuIndex
                    });
                }
            });
        }
    });

    state.workUnits = allWorkUnits;
    renderWorkUnits();
}

function renderWorkUnits() {
    const container = document.getElementById('workUnitsList');
    
    if (state.workUnits.length === 0) {
        container.innerHTML = '<div class="loading">No work units found</div>';
        return;
    }

    container.innerHTML = '';

    state.workUnits.forEach(wu => {
        const card = document.createElement('div');
        card.className = 'work-unit-card';
        card.onclick = () => showWorkUnitDetails(wu.instanceId, wu.wuIndex, wu.queueIndex);
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3>Work Unit #${wu.number || wu.id || 'N/A'}</h3>
                    <p style="color: var(--text-secondary); margin-top: 5px;">
                        Machine: ${wu.machineName} • Project: ${wu.project || 'N/A'} • 
                        Status: <span class="status-icon ${getStatusClass(wu)}"></span> ${getStatusText(wu)}
                    </p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 18px; font-weight: 600;">${formatNumber(wu.ppd || 0)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">PPD</div>
                </div>
            </div>
            <div style="margin-top: 15px;">
                <div class="progress-bar">
                    ${(() => {
                        // Progress is stored as decimal (0-1), multiply by 100
                        let progress = wu.progress || wu.wu_progress || 0;
                        if (progress <= 1) progress = progress * 100;
                        progress = Math.max(0, Math.min(100, progress));
                        
                        // Check if paused
                        const isPaused = wu.state === 'PAUSE' || wu.pause_reason || getStatusClass(wu) === 'paused';
                        
                        // Create a unique key for this work unit
                        const wuKey = `${wu.instanceId}-${wu.project || wu.assignment?.project || wu.assign?.project || 'unknown'}-${wu.slot || wu.id || 'unknown'}`;
                        
                        if (isPaused) {
                            // When paused, preserve the last known progress
                            if (!pausedProgress.has(wuKey) && progress > 0) {
                                // Store the progress when first paused
                                pausedProgress.set(wuKey, progress);
                            }
                            // Use stored progress if available, otherwise use current
                            progress = pausedProgress.get(wuKey) || progress;
                        } else {
                            // When running, update stored progress and use current value
                            if (progress > 0) {
                                pausedProgress.set(wuKey, progress);
                            } else {
                                // If progress is 0, remove from stored (might be a new work unit)
                                pausedProgress.delete(wuKey);
                            }
                        }
                        
                        const statusClass = isPaused ? 'paused' : (progress < 50 ? 'warning' : '');
                        
                        return `<div class="progress-fill ${statusClass}" style="width: ${progress}%"></div>
                            <div class="progress-text">${progress.toFixed(1)}%</div>`;
                    })()}
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

async function showWorkUnitDetails(instanceId, wuIndex, queueIndex = 0) {
    const modal = document.getElementById('workUnitModal');
    const details = document.getElementById('workUnitDetails');
    
    details.innerHTML = '<div class="loading">Loading work unit details...</div>';
    modal.classList.add('active');

    try {
        // Fetch detailed work unit info
        const response = await fetch(`${API_BASE}/api/fah/${instanceId}/queue/${queueIndex || 0}`);
        if (response.ok) {
            const queue = await response.json();
            const wu = Array.isArray(queue) ? queue[wuIndex] : queue;

            if (wu) {
                details.innerHTML = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <h3>Details</h3>
                            <table style="width: 100%; margin-top: 10px;">
                                <tr><td><strong>Status:</strong></td><td>${getStatusText(wu)}</td></tr>
                                <tr><td><strong>Machine:</strong></td><td>${wu.machineName || 'N/A'}</td></tr>
                                <tr><td><strong>Project:</strong></td><td>${wu.project || 'N/A'}</td></tr>
                                <tr><td><strong>Progress:</strong></td><td>${(wu.progress || 0).toFixed(1)}%</td></tr>
                                <tr><td><strong>PPD:</strong></td><td>${formatNumber(wu.ppd || 0)}</td></tr>
                                <tr><td><strong>ETA:</strong></td><td>${wu.eta || 'N/A'}</td></tr>
                                <tr><td><strong>TPF:</strong></td><td>${wu.tpf || 'N/A'}</td></tr>
                            </table>
                        </div>
                        <div>
                            <h3>System Info</h3>
                            <table style="width: 100%; margin-top: 10px;">
                                <tr><td><strong>OS:</strong></td><td>${wu.os || 'N/A'}</td></tr>
                                <tr><td><strong>CPUs:</strong></td><td>${wu.cpus || 'N/A'}</td></tr>
                                <tr><td><strong>GPUs:</strong></td><td>${wu.gpus || 'N/A'}</td></tr>
                                <tr><td><strong>Core:</strong></td><td>${wu.core || 'N/A'}</td></tr>
                                <tr><td><strong>Work Server:</strong></td><td>${wu.workServer || 'N/A'}</td></tr>
                            </table>
                        </div>
                    </div>
                `;
            }
        }
    } catch (error) {
        details.innerHTML = `<div class="error">Error loading work unit details: ${error.message}</div>`;
    }
}

// Helper function to get top rank category
function getTopRankCategory(rank) {
    if (!rank || rank === 'N/A' || rank === 0) return null;
    if (rank <= 10) return 'Top 10';
    if (rank <= 100) return 'Top 100';
    if (rank <= 1000) return 'Top 1K';
    if (rank <= 10000) return 'Top 10K';
    if (rank <= 100000) return 'Top 100K';
    return null;
}

async function loadStats() {
    const container = document.getElementById('statsData');
    
    // Check if external API is disabled
    if (!state.externalApiEnabled) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                <p style="margin-bottom: 10px;">External API calls are disabled.</p>
                <p style="font-size: 14px;">Enable external API calls in Settings to view statistics.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '<div class="loading">Loading statistics...</div>';
    
    try {
        // Get username and team from first connected machine's config
        let username = null;
        let teamNumber = null;
        
        console.log('Loading stats, machines:', state.machines.length);
        for (const machine of state.machines) {
            if (machine.connected && machine.config) {
                console.log('Checking machine config:', machine.config);
                username = machine.config.user || null;
                teamNumber = machine.config.team || null;
                console.log('Found username:', username, 'team:', teamNumber);
                if (username) break; // Use first machine with username
            }
        }

        // Fetch user stats if username is available
        let userStats = null;
        if (username && username !== 'Anonymous') {
            try {
                const statsUrl = teamNumber 
                    ? `${API_BASE}/api/stats/user/${encodeURIComponent(username)}?team=${teamNumber}`
                    : `${API_BASE}/api/stats/user/${encodeURIComponent(username)}`;
                console.log('Fetching user stats from:', statsUrl);
                const response = await fetch(statsUrl);
                console.log('User stats response status:', response.status);
                if (response.ok) {
                    userStats = await response.json();
                    console.log('User stats received:', userStats);
                } else {
                    const errorText = await response.text();
                    console.error('User stats error response:', errorText);
                }
            } catch (error) {
                console.error('Error fetching user stats:', error);
            }
        } else {
            console.log('No username found or username is Anonymous');
        }

        // Fetch team stats for configured teams
        console.log('Fetching stats for teams:', state.teams);
        const teamStatsPromises = state.teams.map(async (team) => {
            try {
                const url = `${API_BASE}/api/stats/team/${team.number}`;
                console.log('Fetching team stats from:', url);
                const response = await fetch(url);
                console.log(`Team ${team.number} response status:`, response.status);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`Team ${team.number} stats received:`, data);
                    return {
                        ...team,
                        tscore: data.score || 0,
                        twus: data.wus || 0,
                        trank: data.rank || null,
                        logo: data.logo || null
                    };
                } else {
                    const errorText = await response.text();
                    console.error(`Team ${team.number} error response:`, errorText);
                }
            } catch (error) {
                console.error(`Error fetching stats for team ${team.number}:`, error);
            }
            return team;
        });

        const teamStats = await Promise.all(teamStatsPromises);

        // Render stats
        let html = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">';

        // User Stats Panel
        if (userStats && userStats.name) {
            const topRank = getTopRankCategory(userStats.rank);
            
            // Note: User avatars are only available through the authenticated account API
            // The stats API doesn't include avatar data, so we show the default icon
            html += `
                <div class="stats-card" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                        <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; color: white; font-size: 20px;">
                            <span class="material-symbols-filled" style="font-size: 24px;">person</span>
                        </div>
                        <div style="flex: 1;">
                            <div style="font-size: 18px; font-weight: 600; color: var(--text-primary);">${userStats.name}</div>
                            ${userStats.rank ? `<div style="font-size: 14px; color: var(--text-secondary);">Rank ${userStats.rank.toLocaleString()}</div>` : ''}
                        </div>
                    </div>
                    ${topRank ? `<div style="background: var(--success); color: white; padding: 8px 12px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; font-weight: 600; text-align: center;">${topRank} Ranked Donor</div>` : ''}
                    <div style="margin-bottom: 15px;">
                        <div style="font-size: 16px; color: var(--text-primary); margin-bottom: 5px;">${(userStats.score || 0).toLocaleString()} points earned</div>
                        <div style="font-size: 16px; color: var(--text-primary);">${(userStats.wus || 0).toLocaleString()} WUs completed</div>
                    </div>
                    <h2 style="font-size: 16px; margin-top: 20px; margin-bottom: 10px; color: var(--text-primary);">Active Clients</h2>
                    <div style="color: var(--text-secondary); margin-bottom: 5px;">${userStats.active_7 || 0} active clients within 7 days</div>
                    <div style="color: var(--text-secondary);">${userStats.active_50 || 0} active clients within 50 days</div>
                </div>
            `;
        } else {
            html += `
                <div class="stats-card" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                    <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                        ${username === 'Anonymous' || !username ? 'Folding anonymously' : 'Unable to load user statistics'}
                        ${!username ? '<br><small>Configure your username in FAH client settings</small>' : ''}
                    </div>
                </div>
            `;
        }

        // Team Stats Panel(s)
        if (teamStats.length > 0) {
            teamStats.forEach(team => {
                const topRank = getTopRankCategory(team.trank);
                const userContributionPoints = userStats && userStats.teams ? 
                    (userStats.teams.find(t => t.team === team.number)?.score || 0) : 0;
                const userContributionWUs = userStats && userStats.teams ? 
                    (userStats.teams.find(t => t.team === team.number)?.wus || 0) : 0;
                const pointsPercent = team.tscore > 0 ? ((userContributionPoints / team.tscore) * 100).toFixed(1) : '0.0';
                const wusPercent = team.twus > 0 ? ((userContributionWUs / team.twus) * 100).toFixed(1) : '0.0';

                html += `
                    <div class="stats-card" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                            ${team.logo ? 
                                `<img src="${team.logo}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` +
                                `<div style="width: 40px; height: 40px; border-radius: 4px; background: var(--accent); display: none; align-items: center; justify-content: center; color: white; font-size: 20px;">
                                    <span class="material-symbols-filled" style="font-size: 24px;">groups</span>
                                </div>` :
                                `<div style="width: 40px; height: 40px; border-radius: 4px; background: var(--accent); display: flex; align-items: center; justify-content: center; color: white; font-size: 20px;">
                                    <span class="material-symbols-filled" style="font-size: 24px;">groups</span>
                                </div>`
                            }
                            <div style="flex: 1;">
                                <div style="font-size: 18px; font-weight: 600; color: var(--text-primary);">${team.name}</div>
                                ${team.trank ? `<div style="font-size: 14px; color: var(--text-secondary);">Rank ${team.trank.toLocaleString()}</div>` : ''}
                            </div>
                        </div>
                        ${topRank ? `<div style="background: var(--success); color: white; padding: 8px 12px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; font-weight: 600; text-align: center;">${topRank} Ranked Team</div>` : ''}
                        <div style="margin-bottom: 15px;">
                            <div style="font-size: 16px; color: var(--text-primary); margin-bottom: 5px;">${(team.tscore || 0).toLocaleString()} points earned</div>
                            <div style="font-size: 16px; color: var(--text-primary);">${(team.twus || 0).toLocaleString()} WUs completed</div>
                        </div>
                        ${userStats && userStats.name ? `
                            <h2 style="font-size: 16px; margin-top: 20px; margin-bottom: 10px; color: var(--text-primary);">Your Contribution</h2>
                            <div style="color: var(--text-secondary); margin-bottom: 5px;">${userContributionPoints.toLocaleString()} points (${pointsPercent}%)</div>
                            <div style="color: var(--text-secondary);">${userContributionWUs.toLocaleString()} WUs (${wusPercent}%)</div>
                        ` : ''}
                    </div>
                `;
            });
        } else {
            html += `
                <div class="stats-card" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                    <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                        No teams configured
                        <br><small>Add a team in Settings to view team statistics</small>
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        
        // Add EOC stats section if username is available and external API is enabled
        if (username && username !== 'Anonymous' && state.externalApiEnabled) {
            html += `
                <div style="margin-top: 30px; padding-top: 30px; border-top: 1px solid var(--border);">
                    <h2 style="font-size: 18px; margin-bottom: 15px; color: var(--text-primary);">Extreme Overclocking Stats</h2>
                    <div id="eocStats" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px;">
                        <div class="loading">Loading EOC stats...</div>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
        
        // Load EOC stats if available
        if (username && username !== 'Anonymous' && state.externalApiEnabled) {
            loadEOCStats(container);
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        container.innerHTML = `<div class="error">Error loading statistics: ${error.message}</div>`;
    }
}

let currentGraphType = 'points';
let currentGraphPeriod = 'day';

async function loadEOCStats(container) {
    const eocContainer = container.querySelector('#eocStats');
    if (!eocContainer) return;
    
    // Get EOC user ID from localStorage
    const eocUserId = localStorage.getItem('fah-eoc-user-id');
    
    if (!eocUserId) {
        eocContainer.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 20px;">
                <p style="margin-bottom: 10px;">EOC User ID not configured</p>
                <p style="font-size: 14px; margin-bottom: 15px;">
                    To view Extreme Overclocking stats, add your EOC User ID in Settings.
                </p>
                <p style="font-size: 12px; color: var(--text-secondary);">
                    Find your EOC User ID by visiting 
                    <a href="https://folding.extremeoverclocking.com/user_summary.php" target="_blank" style="color: var(--accent);">
                        folding.extremeoverclocking.com
                    </a> and checking the URL (e.g., ?u=833191)
                </p>
            </div>
        `;
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/eoc/user/${eocUserId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch EOC stats');
        }
        
        const eocStats = await response.json();
        
        if (!eocStats || Object.keys(eocStats).length === 0) {
            eocContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 20px;">
                    No EOC stats available for this user ID.
                </div>
            `;
            return;
        }
        
        // Build main stats table
        let mainStatsHTML = '';
        if (eocStats.rankTeam !== undefined || eocStats.totalPoints !== undefined) {
            mainStatsHTML = `
                <div style="margin-bottom: 30px;">
                    <h3 style="font-size: 18px; margin-bottom: 15px; color: var(--text-primary);">Summary Statistics</h3>
                    <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                        <thead>
                            <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                <th style="padding: 10px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Rank Team</th>
                                <th style="padding: 10px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Rank Project</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points 24hr Avg</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Last 24hr</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Last 7days</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Today</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Week</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Total</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">WUs Total</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">First Record</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 10px; color: var(--text-primary);">${formatNumber(eocStats.rankTeam || 0)}</td>
                                <td style="padding: 10px; color: var(--text-primary);">${formatNumber(eocStats.rankProject || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${formatNumber(eocStats.points24hrAvg || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${formatNumber(eocStats.pointsLast24hr || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${formatNumber(eocStats.pointsLast7days || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${formatNumber(eocStats.pointsToday || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${formatNumber(eocStats.pointsWeek || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary); font-weight: 600;">${formatNumber(eocStats.totalPoints || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary); font-weight: 600;">${formatNumber(eocStats.totalWUs || 0)}</td>
                                <td style="padding: 10px; text-align: right; color: var(--text-primary);">${eocStats.firstRecord || 'N/A'}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        // Build Conquests and Threats table
        let conquestsHTML = '';
        if (eocStats.conquests && eocStats.conquests.length > 0) {
            conquestsHTML = `
                <div style="margin-bottom: 30px;">
                    <h3 style="font-size: 18px; margin-bottom: 15px; color: var(--text-primary);">Top 5 <span style="color: var(--accent);">Conquests</span> and <span style="color: #ff6b6b;">Threats</span>!</h3>
                    <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                        <thead>
                            <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                <th style="padding: 10px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 12px;">User Name</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Rank Diff</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Points Diff</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Gain Daily</th>
                                <th style="padding: 10px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 12px;">Date Overtake</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${eocStats.conquests.map((entry, idx) => {
                                const isConquest = entry.rankDiff > 0;
                                const isCurrent = entry.rankDiff === 0;
                                const rowColor = isCurrent ? 'var(--accent)' : (isConquest ? 'var(--accent)' : '#ff6b6b');
                                return `
                                    <tr style="border-bottom: 1px solid var(--border); ${idx % 2 === 0 ? 'background: var(--bg-tertiary);' : ''}">
                                        <td style="padding: 10px; color: ${isCurrent ? rowColor : 'var(--text-primary)'}; font-weight: ${isCurrent ? '600' : '400'};">${entry.name}</td>
                                        <td style="padding: 10px; text-align: right; color: ${isCurrent ? rowColor : 'var(--text-primary)'}; font-weight: ${isCurrent ? '600' : '400'};">${entry.rankDiff > 0 ? '+' : ''}${formatNumber(entry.rankDiff)}</td>
                                        <td style="padding: 10px; text-align: right; color: ${isCurrent ? rowColor : 'var(--text-primary)'}; font-weight: ${isCurrent ? '600' : '400'};">${entry.pointsDiff > 0 ? '+' : ''}${formatNumber(entry.pointsDiff)}</td>
                                        <td style="padding: 10px; text-align: right; color: ${isCurrent ? rowColor : 'var(--text-primary)'}; font-weight: ${isCurrent ? '600' : '400'};">${formatNumber(entry.gainDaily)}</td>
                                        <td style="padding: 10px; text-align: right; color: ${isCurrent ? rowColor : 'var(--text-primary)'}; font-weight: ${isCurrent ? '600' : '400'};">${entry.dateOvertake || '--'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        // Build graph selector and display
        const graphUrl = `${API_BASE}/api/eoc/graph/${currentGraphType}/${currentGraphPeriod}?userId=${eocUserId}`;
        let graphHTML = `
            <div style="margin-bottom: 30px;">
                <h3 style="font-size: 18px; margin-bottom: 15px; color: var(--text-primary);">Production History</h3>
                <div style="margin-bottom: 15px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <div>
                        <strong style="color: var(--text-secondary); margin-right: 10px;">Points:</strong>
                        <a href="#" class="graph-link" data-type="points" data-period="hour" style="color: var(--accent); text-decoration: none; margin-right: 5px;">Hourly</a> |
                        <a href="#" class="graph-link" data-type="points" data-period="day" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Daily</a> |
                        <a href="#" class="graph-link" data-type="points" data-period="week" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Weekly</a> |
                        <a href="#" class="graph-link" data-type="points" data-period="month" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Monthly</a> |
                        <a href="#" class="graph-link" data-type="points" data-period="daytotal" style="color: var(--accent); text-decoration: none; margin-left: 5px;">Daily Total</a>
                    </div>
                    <div>
                        <strong style="color: var(--text-secondary); margin-right: 10px;">Work Units:</strong>
                        <a href="#" class="graph-link" data-type="wus" data-period="hour" style="color: var(--accent); text-decoration: none; margin-right: 5px;">Hourly</a> |
                        <a href="#" class="graph-link" data-type="wus" data-period="day" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Daily</a> |
                        <a href="#" class="graph-link" data-type="wus" data-period="week" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Weekly</a> |
                        <a href="#" class="graph-link" data-type="wus" data-period="month" style="color: var(--accent); text-decoration: none; margin-right: 5px; margin-left: 5px;">Monthly</a> |
                        <a href="#" class="graph-link" data-type="wus" data-period="daytotal" style="color: var(--accent); text-decoration: none; margin-left: 5px;">Daily Total</a>
                    </div>
                </div>
                <div id="eocGraphContainer" style="background: var(--bg-tertiary); padding: 15px; border-radius: 4px; text-align: center; min-height: 400px; display: flex; align-items: center; justify-content: center;">
                    <img src="${graphUrl}" alt="Production Graph" style="max-width: 100%; max-height: 400px; height: auto; display: block;" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'color: var(--text-secondary); padding: 20px;\\'>Failed to load graph</div>'">
                </div>
            </div>
        `;
        
        // Build production tables
        let productionTablesHTML = '';
        if (eocStats.monthlyProduction || eocStats.weeklyProduction || eocStats.dailyProduction || eocStats.hourlyProduction) {
            productionTablesHTML = `
                <div style="margin-bottom: 30px;">
                    <h3 style="font-size: 18px; margin-bottom: 15px; color: var(--text-primary);">Production Tables</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                        ${eocStats.monthlyProduction && eocStats.monthlyProduction.length > 0 ? `
                            <div>
                                <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--text-secondary);">Monthly Production</h4>
                                <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                                    <thead>
                                        <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                            <th style="padding: 8px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Month</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Points</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">WUs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${eocStats.monthlyProduction.map((entry, idx) => `
                                            <tr style="border-bottom: 1px solid var(--border); ${idx % 2 === 0 ? 'background: var(--bg-tertiary);' : ''}">
                                                <td style="padding: 8px; color: var(--text-primary); font-size: 12px;">${entry.month}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.points)}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.wus)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                        ${eocStats.weeklyProduction && eocStats.weeklyProduction.length > 0 ? `
                            <div>
                                <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--text-secondary);">Weekly Production</h4>
                                <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                                    <thead>
                                        <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                            <th style="padding: 8px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Week</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Points</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">WUs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${eocStats.weeklyProduction.map((entry, idx) => `
                                            <tr style="border-bottom: 1px solid var(--border); ${idx % 2 === 0 ? 'background: var(--bg-tertiary);' : ''}">
                                                <td style="padding: 8px; color: var(--text-primary); font-size: 12px;">${entry.week}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.points)}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.wus)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                        ${eocStats.dailyProduction && eocStats.dailyProduction.length > 0 ? `
                            <div>
                                <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--text-secondary);">Daily Production</h4>
                                <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                                    <thead>
                                        <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                            <th style="padding: 8px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Day</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Points</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">WUs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${eocStats.dailyProduction.map((entry, idx) => `
                                            <tr style="border-bottom: 1px solid var(--border); ${idx % 2 === 0 ? 'background: var(--bg-tertiary);' : ''}">
                                                <td style="padding: 8px; color: var(--text-primary); font-size: 12px;">${entry.day}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.points)}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.wus)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                        ${eocStats.hourlyProduction && eocStats.hourlyProduction.length > 0 ? `
                            <div>
                                <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--text-secondary);">Hourly Production</h4>
                                <table style="width: 100%; border-collapse: collapse; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                                    <thead>
                                        <tr style="background: var(--bg-secondary); border-bottom: 1px solid var(--border);">
                                            <th style="padding: 8px; text-align: left; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Time</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">Points</th>
                                            <th style="padding: 8px; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 11px;">WUs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${eocStats.hourlyProduction.map((entry, idx) => `
                                            <tr style="border-bottom: 1px solid var(--border); ${idx % 2 === 0 ? 'background: var(--bg-tertiary);' : ''}">
                                                <td style="padding: 8px; color: var(--text-primary); font-size: 12px;">${entry.time}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.points)}</td>
                                                <td style="padding: 8px; text-align: right; color: var(--text-primary); font-size: 12px;">${formatNumber(entry.wus)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        
        eocContainer.innerHTML = `
            ${mainStatsHTML}
            ${conquestsHTML}
            ${graphHTML}
            ${productionTablesHTML}
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border); text-align: center;">
                <a href="https://folding.extremeoverclocking.com/user_summary.php?u=${eocUserId}" target="_blank" style="color: var(--accent); font-size: 12px; text-decoration: none;">
                    View full stats on Extreme Overclocking →
                </a>
            </div>
        `;
        
        // Attach event listeners for graph links
        const graphLinks = eocContainer.querySelectorAll('.graph-link');
        graphLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                currentGraphType = link.dataset.type;
                currentGraphPeriod = link.dataset.period;
                const newGraphUrl = `${API_BASE}/api/eoc/graph/${currentGraphType}/${currentGraphPeriod}?userId=${eocUserId}`;
                const graphContainer = eocContainer.querySelector('#eocGraphContainer');
                if (graphContainer) {
                    // Preload the new image completely before swapping
                    const img = new Image();
                    img.alt = 'Production Graph';
                    
                    img.onerror = function() {
                        graphContainer.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">Failed to load graph</div>';
                    };
                    
                    // Once new image is fully loaded, instantly swap it
                    img.onload = function() {
                        // Set styles for the loaded image
                        img.style.cssText = 'max-width: 100%; max-height: 400px; height: auto; display: block;';
                        // Replace the old image with the new one instantly
                        graphContainer.innerHTML = '';
                        graphContainer.appendChild(img);
                    };
                    
                    // Start loading the new image (not in DOM yet, so no visual impact)
                    img.src = newGraphUrl;
                }
                // Update active link styling
                graphLinks.forEach(l => l.style.fontWeight = '400');
                link.style.fontWeight = '600';
            });
        });
        
        // Set initial active link
        const activeLink = eocContainer.querySelector(`.graph-link[data-type="${currentGraphType}"][data-period="${currentGraphPeriod}"]`);
        if (activeLink) {
            activeLink.style.fontWeight = '600';
        }
        
    } catch (error) {
        console.error('Error loading EOC stats:', error);
        eocContainer.innerHTML = `
            <div class="error" style="text-align: center; padding: 20px;">
                Error loading EOC stats: ${error.message}
            </div>
        `;
    }
}

async function loadProjects() {
    const container = document.getElementById('projectsData');
    
    try {
        // Collect unique project IDs from all work units (current and past)
        const projectIds = new Set();
        
        // Get projects from current work units
        state.machines.forEach(machine => {
            if (machine.units && Array.isArray(machine.units)) {
                machine.units.forEach(unit => {
                    const projectId = unit.project || unit.assignment?.project || unit.assign?.project;
                    if (projectId) {
                        projectIds.add(projectId);
                    }
                });
            }
        });
        
        // Also check work units history if available
        state.workUnits.forEach(wu => {
            const projectId = wu.project || wu.assignment?.project || wu.assign?.project;
            if (projectId) {
                projectIds.add(projectId);
            }
        });

        if (projectIds.size === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <p style="margin-bottom: 10px;">No active projects.</p>
                    <p style="font-size: 14px;">While you are folding, active projects will display here.</p>
                </div>
            `;
            return;
        }

        // If external API is disabled, show project IDs only without details
        if (!state.externalApiEnabled) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <p style="margin-bottom: 10px;">Found ${projectIds.size} project(s) from your work units.</p>
                    <p style="font-size: 14px;">Enable external API calls in Settings to view project details.</p>
                    <div style="margin-top: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 4px; text-align: left;">
                        <strong>Project IDs:</strong>
                        <div style="margin-top: 10px; font-family: monospace;">
                            ${Array.from(projectIds).sort((a, b) => b - a).join(', ')}
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        console.log(`Found ${projectIds.size} projects, fetching details...`);
        container.innerHTML = '<div class="loading">Loading project details...</div>';

        // Fetch full project details for each project ID in parallel
        const projectPromises = Array.from(projectIds).map(async (projectId) => {
            try {
                const response = await fetch(`${API_BASE}/api/project/${projectId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && !data.error) {
                        return {
                            id: parseInt(projectId),
                            ...data
                        };
                    }
                }
            } catch (error) {
                // Silently skip projects that fail to load
                console.warn(`Failed to load project ${projectId}:`, error);
            }
            return null;
        });

        const projects = (await Promise.all(projectPromises)).filter(p => p !== null && p.id);
        
        // Sort projects by ID (newest first)
        projects.sort((a, b) => b.id - a.id);
        
        console.log(`Loaded ${projects.length} project details`);

        if (projects.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <p>Unable to load project details.</p>
                </div>
            `;
            return;
        }

        // Render projects
        container.innerHTML = projects.map(project => {
            const projectId = `project-${project.id}`;
            return `
                <div class="project-card" style="background: var(--bg-secondary); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                    <div class="project-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                        <div>
                            <h3 style="margin: 0 0 5px 0; color: var(--text-primary); font-size: 18px;">Project ${project.id}</h3>
                            ${project.manager && project.institution ? 
                                `<div style="font-size: 14px; color: var(--text-secondary);">By ${project.manager}, ${project.institution}</div>` :
                                project.manager ? 
                                    `<div style="font-size: 14px; color: var(--text-secondary);">By ${project.manager}</div>` :
                                    ''
                            }
                        </div>
                        ${project.cause ? 
                            `<div style="color: var(--success); font-weight: 600; text-transform: capitalize;">Target: ${project.cause}</div>` :
                            ''
                        }
                    </div>
                    <div class="project-body" id="${projectId}-body" style="overflow: hidden; max-height: 10em; mask-image: linear-gradient(to bottom, black 50%, transparent 100%);">
                        ${project.thumb ? 
                            `<div style="margin-bottom: 15px;">
                                <img src="data:image/png;base64,${project.thumb}" style="max-height: 200px; width: auto; border-radius: 4px;" alt="Project image" />
                            </div>` :
                            ''
                        }
                        ${project.description ? 
                            `<div class="project-description" style="color: var(--text-primary); line-height: 1.6;">${project.description}</div>` :
                            ''
                        }
                        ${project.mthumb || project.mdescription ? 
                            `<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);">
                                ${project.mthumb ? 
                                    `<div style="margin-bottom: 15px;">
                                        <img src="data:image/png;base64,${project.mthumb}" style="max-height: 150px; width: auto; border-radius: 4px;" alt="Manager image" />
                                    </div>` :
                                    ''
                                }
                                ${project.mdescription ? 
                                    `<div class="project-manager-description" style="color: var(--text-primary); line-height: 1.6;">${project.mdescription}</div>` :
                                    ''
                                }
                            </div>` :
                            ''
                        }
                    </div>
                    <div class="project-footer" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border);">
                        <a href="#" class="project-expand" data-project-id="${projectId}" style="color: var(--accent); cursor: pointer; text-decoration: none;">+ Expand</a>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners for expand/collapse
        container.querySelectorAll('.project-expand').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const projectId = link.dataset.projectId;
                toggleProject(projectId);
            });
        });

        // Make all links in project descriptions open in new tabs
        container.querySelectorAll('.project-description a, .project-manager-description a').forEach(link => {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        });

    } catch (error) {
        console.error('Error loading projects:', error);
        container.innerHTML = `<div class="error">Error loading projects: ${error.message}</div>`;
    }
}

// Toggle project expand/collapse
function toggleProject(projectId) {
    const body = document.getElementById(`${projectId}-body`);
    const expandLink = document.querySelector(`[data-project-id="${projectId}"]`);
    
    if (!body || !expandLink) return;
    
    const isExpanded = body.style.maxHeight === 'none';
    
    if (isExpanded) {
        body.style.maxHeight = '10em';
        body.style.maskImage = 'linear-gradient(to bottom, black 50%, transparent 100%)';
        expandLink.textContent = '+ Expand';
    } else {
        body.style.maxHeight = 'none';
        body.style.maskImage = 'none';
        expandLink.textContent = '- Collapse';
    }
}

// Make function available globally
window.toggleProject = toggleProject;

async function foldAll() {
    // Optimistically update all machines to unpaused
    state.machines.forEach(machine => {
        if (machine.connected) {
            machine.isPaused = false;
        }
    });
    renderMachines();
    
    // Send commands in the background
    const promises = state.instances.filter(i => i.enabled).map(async (instance) => {
        try {
            await fetch(`${API_BASE}/api/fah/${instance.id}/unpause`, { method: 'POST' });
        } catch (error) {
            console.error(`Error folding ${instance.name}:`, error);
        }
    });
    
    await Promise.all(promises);
    
    // Refresh data in the background to confirm state
    refreshData().catch(error => {
        console.error('Error refreshing after fold all:', error);
    });
}

async function pauseAll() {
    // Optimistically update all machines to paused
    state.machines.forEach(machine => {
        if (machine.connected) {
            machine.isPaused = true;
        }
    });
    renderMachines();
    
    // Send commands in the background
    const promises = state.instances.filter(i => i.enabled).map(async (instance) => {
        try {
            await fetch(`${API_BASE}/api/fah/${instance.id}/pause`, { method: 'POST' });
        } catch (error) {
            console.error(`Error pausing ${instance.name}:`, error);
        }
    });
    
    await Promise.all(promises);
    
    // Refresh data in the background to confirm state
    refreshData().catch(error => {
        console.error('Error refreshing after pause all:', error);
    });
}

async function toggleMachine(instanceId) {
    // Toggle pause/unpause for a specific machine
    try {
        // Find the machine in our state
        const machine = state.machines.find(m => m.instanceId === instanceId);
        if (!machine) return;
        
        const isCurrentlyPaused = machine.isPaused;
        const newPausedState = !isCurrentlyPaused;
        
        // Optimistically update the UI immediately
        machine.isPaused = newPausedState;
        renderMachines();
        
        // Send the command in the background
        if (isCurrentlyPaused) {
            // Resume/unpause
            await fetch(`${API_BASE}/api/fah/${instanceId}/unpause`, { method: 'POST' });
        } else {
            // Pause
            await fetch(`${API_BASE}/api/fah/${instanceId}/pause`, { method: 'POST' });
        }
        
        // Refresh data in the background to confirm state (don't await, let it run async)
        refreshData().catch(error => {
            console.error('Error refreshing after toggle:', error);
            // If refresh fails, revert optimistic update
            machine.isPaused = isCurrentlyPaused;
            renderMachines();
        });
    } catch (error) {
        console.error('Error toggling machine:', error);
        // Revert optimistic update on error
        const machine = state.machines.find(m => m.instanceId === instanceId);
        if (machine) {
            machine.isPaused = !machine.isPaused;
            renderMachines();
        }
    }
}

let currentMachineSettings = null;

async function showMachineSettings(instanceId) {
    const machine = state.machines.find(m => m.instanceId === instanceId);
    if (!machine || !machine.connected) {
        alert('Machine is not connected. Please wait for the machine to connect.');
        return;
    }
    
    const modal = document.getElementById('machineSettingsModal');
    const modalBody = document.getElementById('machineSettingsBody');
    const modalHeader = modal.querySelector('.modal-header h2');
    modal.classList.add('active');
    
    // Update modal title with machine name
    const modalHeaderDiv = modal.querySelector('.modal-header');
    if (modalHeaderDiv) {
        const h2 = modalHeaderDiv.querySelector('h2');
        if (h2) {
            h2.textContent = 'Settings';
        }
        
        // Add or update subtitle
        let subtitle = modalHeaderDiv.querySelector('.machine-subtitle');
        if (!subtitle) {
            subtitle = document.createElement('div');
            subtitle.className = 'machine-subtitle';
            subtitle.style.cssText = 'font-size: 14px; color: var(--text-secondary); font-weight: normal; margin-top: 5px;';
            const h2Element = modalHeaderDiv.querySelector('h2');
            if (h2Element) {
                h2Element.parentNode.insertBefore(subtitle, h2Element.nextSibling);
            }
        }
        subtitle.textContent = machine.name;
    }
    
    modalBody.innerHTML = '<div class="loading">Loading machine settings...</div>';
    
    try {
        // Fetch current config
        const response = await fetch(`${API_BASE}/api/fah/${instanceId}/info`);
        if (!response.ok) throw new Error('Failed to fetch machine config');
        
        const data = await response.json();
        const config = data.config || {};
        const info = data.info || {};
        const groups = data.groups || {};
        
        // Get the default group config (empty string key) or first group
        // Merge GPU config from all groups since GPUs can be in any group
        const groupName = Object.keys(groups).find(k => k === '') || Object.keys(groups)[0] || '';
        let groupConfig = groups[groupName] ? (groups[groupName].config || groups[groupName]) : config;
        
        // If no groups, use global config
        if (Object.keys(groups).length === 0) {
            groupConfig = config;
        }
        
        // Merge GPU config from all groups to get complete picture
        const allGpuConfig = {};
        if (groupConfig.gpus) {
            Object.assign(allGpuConfig, groupConfig.gpus);
        }
        // Also check other groups for GPU config
        Object.entries(groups).forEach(([name, group]) => {
            const groupCfg = group.config || group;
            if (groupCfg.gpus) {
                Object.entries(groupCfg.gpus).forEach(([gpuId, gpu]) => {
                    if (!allGpuConfig[gpuId] || gpu.enabled) {
                        allGpuConfig[gpuId] = gpu;
                    }
                });
            }
        });
        
        // Merge GPU config into group config
        if (Object.keys(allGpuConfig).length > 0) {
            groupConfig = { ...groupConfig, gpus: allGpuConfig };
        }
        
        
        // Store current settings for comparison
        currentMachineSettings = {
            instanceId,
            name: machine.name,
            config: JSON.parse(JSON.stringify(groupConfig)),
            groupName,
            availableCPUs: info.cpus || 0,
            availableGPUs: info.gpus || {}
        };
        
        // Render settings form
        renderMachineSettingsForm(currentMachineSettings);
        
    } catch (error) {
        console.error('Error loading machine settings:', error);
        modalBody.innerHTML = `<div class="error">Error loading machine settings: ${error.message}</div>`;
    }
}

function renderMachineSettingsForm(settings) {
    const modalBody = document.getElementById('machineSettingsBody');
    const config = settings.config;
    const availableCPUs = settings.availableCPUs;
    const availableGPUs = settings.availableGPUs;
    
    // Get current CPU count (default to max if not set)
    const currentCPUs = config.cpus !== undefined ? config.cpus : availableCPUs;
    
    // Get GPU config
    const gpuConfig = config.gpus || {};
    
    // Also check which GPUs are actually active by looking at current work units
    const machine = state.machines.find(m => m.instanceId === settings.instanceId);
    const activeGPUIds = new Set();
    if (machine && machine.units) {
        machine.units.forEach(unit => {
            // Check assign.gpus array (official client uses this)
            if (unit.assign && unit.assign.gpus && Array.isArray(unit.assign.gpus)) {
                unit.assign.gpus.forEach(gpuId => {
                    activeGPUIds.add(gpuId.toString());
                });
            }
            // Also check if assign.gpus is an object (sometimes it might be)
            if (unit.assign && unit.assign.gpus && typeof unit.assign.gpus === 'object' && !Array.isArray(unit.assign.gpus)) {
                Object.keys(unit.assign.gpus).forEach(gpuId => {
                    activeGPUIds.add(gpuId.toString());
                });
            }
            // Also check slot for GPU units (slot 1+ are usually GPUs, slot 0 is CPU)
            if (unit.slot && unit.slot !== '0' && unit.slot !== 'cpu') {
                // Try to map slot to GPU ID - this might need adjustment based on actual data
                const slotNum = parseInt(unit.slot);
                if (!isNaN(slotNum) && slotNum > 0) {
                    Object.keys(availableGPUs).forEach(gpuId => {
                        // Some systems use slot-based IDs, check if slot matches
                        if (gpuId.includes(slotNum.toString()) || gpuId === slotNum.toString()) {
                            activeGPUIds.add(gpuId);
                        }
                    });
                }
            }
        });
    }
    
    // Build GPU list - match by ID from availableGPUs
    const gpuList = Object.entries(availableGPUs).map(([id, gpu]) => {
        // Check config for this GPU ID - try exact match first
        let gpuConfigEntry = gpuConfig[id];
        
        // If not found, try to find by matching GPU description or other identifiers
        if (!gpuConfigEntry && gpu.description) {
            // Try to find GPU in config by matching description
            for (const [configId, configGpu] of Object.entries(gpuConfig)) {
                if (configGpu && typeof configGpu === 'object' && configGpu.enabled !== undefined) {
                    if (availableGPUs[configId] && availableGPUs[configId].description === gpu.description) {
                        gpuConfigEntry = configGpu;
                        console.log(`Matched GPU ${id} to config entry ${configId} by description`);
                        break;
                    }
                }
            }
        }
        
        const configEnabled = gpuConfigEntry ? (gpuConfigEntry.enabled || false) : false;
        
        // Check if this GPU is actively being used
        const activelyUsed = activeGPUIds.has(id) || activeGPUIds.has(id.toString());
        
        // GPU is enabled if:
        // 1. It's explicitly enabled in config, OR
        // 2. It's actively being used (which means it must be enabled)
        const enabled = configEnabled || activelyUsed;
        
        return {
            id,
            description: gpu.description || gpu.name || gpu.id || `GPU ${id}`,
            supported: gpu.supported !== false,
            enabled: enabled
        };
    });
    
    // Also include GPUs from config that might not be in availableGPUs
    Object.entries(gpuConfig).forEach(([id, gpu]) => {
        if (!availableGPUs[id] && gpu.enabled) {
            gpuList.push({
                id,
                description: 'Undetected',
                supported: true,
                enabled: gpu.enabled || false
            });
        }
    });
    
    const html = `
        <div style="margin-bottom: 20px;">
            <h3 style="color: var(--accent); margin-bottom: 15px; font-size: 16px;">Machine</h3>
            <div class="form-group">
                <label for="machineNameInput">Name:</label>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" id="machineNameInput" value="${settings.name}" style="flex: 1;" maxlength="64" pattern="[\\w\\.-]+" title="Alphanumeric characters, dots, dashes, and underscores only">
                    <button class="icon-btn" id="refreshMachineName" title="Reset to original"><span class="material-symbols-filled">refresh</span></button>
                </div>
            </div>
        </div>
        
        <div style="margin-bottom: 20px;">
            <h3 style="color: var(--accent); margin-bottom: 15px; font-size: 16px;">Scheduling</h3>
            <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0;">
                <div>
                    <label for="onIdleCheck" style="font-weight: 500; cursor: pointer;">Only When Idle</label>
                    <small style="display: block; color: var(--text-secondary); margin-top: 3px;">Enable folding only when machine is idle</small>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="onIdleCheck" ${config.on_idle ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0;">
                <div>
                    <label for="onBatteryCheck" style="font-weight: 500; cursor: pointer;">While On Battery</label>
                    <small style="display: block; color: var(--text-secondary); margin-top: 3px;">Allow folding when machine is on battery</small>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="onBatteryCheck" ${config.on_battery !== false ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0;">
                <div>
                    <label for="keepAwakeCheck" style="font-weight: 500; cursor: pointer;">Keep Awake</label>
                    <small style="display: block; color: var(--text-secondary); margin-top: 3px;">Prevent system sleep when folding</small>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="keepAwakeCheck" ${config.keep_awake !== false ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>
        
        <div style="margin-bottom: 20px;">
            <h3 style="color: var(--accent); margin-bottom: 15px; font-size: 16px;">Resource Usage</h3>
            <div class="form-group">
                <label for="cpusSlider">CPUs:</label>
                ${availableCPUs > 0 ? `
                    <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px;">
                        <input type="range" id="cpusSlider" min="0" max="${availableCPUs}" value="${currentCPUs}" style="flex: 1;">
                        <span style="min-width: 80px; text-align: right; font-weight: 600;">${currentCPUs} of ${availableCPUs}</span>
                    </div>
                ` : '<p style="color: var(--text-secondary); margin-top: 5px;">No CPUs available</p>'}
            </div>
            <div class="form-group" style="margin-top: 20px;">
                <label>GPUs:</label>
                ${gpuList.length > 0 ? `
                    <table style="width: 100%; margin-top: 10px; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border);">
                                <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">Description</th>
                                <th style="text-align: center; padding: 10px; color: var(--text-secondary); font-weight: 600;">Enabled</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${gpuList.map((gpu, idx) => {
                                // Escape GPU ID for use in HTML attributes (colons might cause issues)
                                const gpuIdEscaped = gpu.id.replace(/:/g, '_');
                                const checkedAttr = gpu.enabled ? 'checked' : '';
                                return `
                                <tr style="border-bottom: 1px solid var(--border); ${!gpu.supported ? 'opacity: 0.4;' : ''}">
                                    <td style="padding: 10px; ${!gpu.supported ? 'color: var(--text-secondary);' : ''}">${gpu.description}</td>
                                    <td style="text-align: center; padding: 10px;">
                                        ${gpu.supported ? `
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="gpu_${gpuIdEscaped}" data-gpu-id="${gpu.id}" ${checkedAttr}>
                                                <span class="toggle-slider"></span>
                                            </label>
                                        ` : '<span style="color: var(--text-secondary);">Unsupported</span>'}
                                    </td>
                                </tr>
                            `;
                            }).join('')}
                        </tbody>
                    </table>
                ` : '<p style="color: var(--text-secondary); margin-top: 5px;">No GPUs detected</p>'}
            </div>
        </div>
    `;
    
    modalBody.innerHTML = html;
    
    // Update CPU count display when slider changes
    const cpusSlider = document.getElementById('cpusSlider');
    if (cpusSlider) {
        cpusSlider.addEventListener('input', (e) => {
            const span = e.target.nextElementSibling;
            if (span) {
                span.textContent = `${e.target.value} of ${availableCPUs}`;
            }
        });
    }
    
    // Reset name button
    const refreshBtn = document.getElementById('refreshMachineName');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            document.getElementById('machineNameInput').value = settings.name;
        });
    }
}

async function saveMachineSettings() {
    if (!currentMachineSettings) return;
    
    const modalBody = document.getElementById('machineSettingsBody');
    const { instanceId } = currentMachineSettings;
    
    try {
        // Get form values
        const nameInput = document.getElementById('machineNameInput');
        const newName = nameInput?.value.trim() || '';
        
        // Validate name
        if (newName && !/^[\w\.-]{1,64}$/.test(newName)) {
            alert('Invalid machine name. Use alphanumeric characters, dots, dashes, and underscores only (1-64 characters).');
            return;
        }
        
        // Get config values
        const onIdle = document.getElementById('onIdleCheck')?.checked || false;
        const onBattery = document.getElementById('onBatteryCheck')?.checked !== false;
        const keepAwake = document.getElementById('keepAwakeCheck')?.checked !== false;
        const cpus = parseInt(document.getElementById('cpusSlider')?.value) || 0;
        
        // Get GPU settings
        const gpus = {};
        const gpuCheckboxes = modalBody.querySelectorAll('input[data-gpu-id]');
        gpuCheckboxes.forEach(checkbox => {
            const gpuId = checkbox.getAttribute('data-gpu-id');
            if (gpuId) {
                gpus[gpuId] = { enabled: checkbox.checked };
            }
        });
        
        // Build config object - FAH expects groups structure
        const groupConfig = {
            on_idle: onIdle,
            on_battery: onBattery,
            keep_awake: keepAwake,
            cpus: cpus,
            gpus: gpus
        };
        
        // Wrap in groups structure (empty string = default group)
        const config = {
            groups: {
                [currentMachineSettings.groupName || '']: groupConfig
            }
        };
        
        // Save name if changed
        if (newName && newName !== currentMachineSettings.name) {
            // Note: Name changes require account API, for now we'll just update locally
            // In a full implementation, this would call the account API
            console.log('Name change requested (requires account API):', newName);
        }
        
        // Save config
        const response = await fetch(`${API_BASE}/api/fah/${instanceId}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save settings');
        }
        
        // Close modal and refresh
        document.getElementById('machineSettingsModal').classList.remove('active');
        await refreshData();
        
    } catch (error) {
        console.error('Error saving machine settings:', error);
        alert('Error saving settings: ' + error.message);
    }
}

async function showMachineLog(instanceId) {
    const machine = state.machines.find(m => m.instanceId === instanceId);
    if (!machine || !machine.connected) return;
    
    // Create modal first to show loading state
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 90vw; max-height: 90vh;">
            <div class="modal-header">
                <h2>Machine Log: ${machine.name}</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="log-controls" style="padding: 15px; border-bottom: 1px solid var(--border-color); display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                <label style="display: flex; align-items: center; gap: 5px;">
                    <span>Search:</span>
                    <input type="text" id="log-search-${instanceId}" placeholder="Search log..." style="flex: 1; min-width: 200px; padding: 5px 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                </label>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" id="log-errors-${instanceId}" style="cursor: pointer;">
                    <span>Errors</span>
                </label>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" id="log-warnings-${instanceId}" style="cursor: pointer;">
                    <span>Warnings</span>
                </label>
                <button class="btn btn-secondary" id="log-reload-${instanceId}" style="padding: 5px 15px; margin-left: auto;" title="Reload log">
                    <span class="material-symbols-filled">refresh</span> Reload
                </button>
            </div>
            <div class="modal-body" style="overflow: auto; max-height: 60vh;">
                <div style="padding: 20px; text-align: center;">Loading log...</div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    
    try {
        const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
        const result = await response.json();
        
        console.log('Log response:', result); // Debug log
        
        // Handle different response formats
        let logContent = 'No log data available';
        if (result.error) {
            logContent = `Error: ${result.message || result.error}\n\nNote: Logs may not be available if the FAH client hasn't generated any log entries yet.`;
        } else if (Array.isArray(result)) {
            // Direct array of log lines
            logContent = result.length > 0 ? result.join('\n') : 'No log entries available. The log may be empty or not yet populated.';
        } else if (result.data) {
            // Response with data wrapper
            if (Array.isArray(result.data)) {
                logContent = result.data.length > 0 ? result.data.join('\n') : 'No log entries available.';
            } else if (typeof result.data === 'string') {
                logContent = result.data || 'No log data available.';
            } else if (result.data.log) {
                const logData = result.data.log;
                logContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
            } else {
                logContent = 'Log data structure not recognized. Raw data: ' + JSON.stringify(result.data, null, 2);
            }
        } else if (result.log) {
            // Log property
            const logData = result.log;
            logContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
        } else if (typeof result === 'string') {
            logContent = result || 'No log data available.';
        } else {
            logContent = 'Unexpected response format. Raw data: ' + JSON.stringify(result, null, 2);
        }
        
        // Get control elements
        const searchInput = modal.querySelector(`#log-search-${instanceId}`);
        const errorsCheckbox = modal.querySelector(`#log-errors-${instanceId}`);
        const warningsCheckbox = modal.querySelector(`#log-warnings-${instanceId}`);
        const reloadBtn = modal.querySelector(`#log-reload-${instanceId}`);
        
        // Store original log content for filtering
        let originalLogContent = logContent;
        let filteredLogContent = logContent;
        
        // Filter function
        const filterLogs = () => {
            const searchTerm = searchInput.value.toLowerCase();
            const showErrors = errorsCheckbox.checked;
            const showWarnings = warningsCheckbox.checked;
            
            if (!searchTerm && !showErrors && !showWarnings) {
                filteredLogContent = originalLogContent;
            } else {
                const lines = originalLogContent.split('\n');
                filteredLogContent = lines.filter(line => {
                    // Check search term
                    if (searchTerm && !line.toLowerCase().includes(searchTerm)) {
                        return false;
                    }
                    
                    // Check error/warning filters (match official client pattern)
                    if (showErrors || showWarnings) {
                        // Official client uses pattern like ":[E]:" or ":[W]:" in log lines
                        const errorPattern = /:\[E\]:/;
                        const warningPattern = /:\[W\]:/;
                        const hasError = errorPattern.test(line) || /ERROR/i.test(line);
                        const hasWarning = warningPattern.test(line) || /WARNING/i.test(line);
                        
                        if (showErrors && showWarnings) {
                            return hasError || hasWarning;
                        } else if (showErrors) {
                            return hasError;
                        } else if (showWarnings) {
                            return hasWarning;
                        }
                    }
                    
                    return true;
                }).join('\n');
            }
            
            // Update display
            pre.textContent = filteredLogContent || 'No log entries match the current filters.';
            
            // Auto-scroll if user was at bottom
            if (!userScrolledUp) {
                setTimeout(() => {
                    isScrolling = true;
                    modalBody.scrollTop = modalBody.scrollHeight;
                    setTimeout(() => { isScrolling = false; }, 100);
                }, 50);
            }
        };
        
        // Update modal content
        const modalBody = modal.querySelector('.modal-body');
        const pre = document.createElement('pre');
        pre.style.cssText = 'font-family: monospace; white-space: pre-wrap; word-wrap: break-word; background: #1a1a1a; padding: 15px; border-radius: 4px; margin: 0;';
        pre.textContent = logContent;
        modalBody.innerHTML = '';
        modalBody.appendChild(pre);
        
        // Auto-scroll to bottom (scroll the modal-body container)
        const scrollToBottom = () => {
            modalBody.scrollTop = modalBody.scrollHeight;
        };
        
        // Track if user has manually scrolled up
        let userScrolledUp = false;
        let isScrolling = false;
        
        const checkScrollPosition = () => {
            if (isScrolling) return;
            
            // Check if user is near bottom (within 50px)
            const isNearBottom = modalBody.scrollHeight - modalBody.scrollTop - modalBody.clientHeight < 50;
            
            if (isNearBottom) {
                userScrolledUp = false;
            } else if (!userScrolledUp) {
                // User scrolled up
                userScrolledUp = true;
            }
        };
        
        modalBody.addEventListener('scroll', checkScrollPosition);
        
        // Set up filter event listeners
        searchInput.addEventListener('input', filterLogs);
        errorsCheckbox.addEventListener('change', filterLogs);
        warningsCheckbox.addEventListener('change', filterLogs);
        
        // Reload button handler
        reloadBtn.addEventListener('click', async () => {
            reloadBtn.disabled = true;
            reloadBtn.innerHTML = '<span class="material-symbols-filled">refresh</span> Loading...';
            
            try {
                const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
                const result = await response.json();
                
                let newLogContent = 'No log data available';
                if (result.error) {
                    newLogContent = `Error: ${result.message || result.error}`;
                } else if (Array.isArray(result)) {
                    newLogContent = result.length > 0 ? result.join('\n') : 'No log entries available.';
                } else if (result.data) {
                    if (Array.isArray(result.data)) {
                        newLogContent = result.data.length > 0 ? result.data.join('\n') : 'No log entries available.';
                    } else if (typeof result.data === 'string') {
                        newLogContent = result.data || 'No log data available.';
                    } else if (result.data.log) {
                        const logData = result.data.log;
                        newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
                    }
                } else if (result.log) {
                    const logData = result.log;
                    newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
                } else if (typeof result === 'string') {
                    newLogContent = result || 'No log data available.';
                }
                
                originalLogContent = newLogContent;
                filterLogs(); // Reapply filters
                userScrolledUp = false; // Reset scroll position
                setTimeout(scrollToBottom, 100);
            } catch (error) {
                console.error('Error reloading log:', error);
                alert('Failed to reload log: ' + error.message);
            } finally {
                reloadBtn.disabled = false;
                reloadBtn.innerHTML = '<span class="material-symbols-filled">refresh</span> Reload';
            }
        });
        
        // Initial scroll to bottom
        setTimeout(scrollToBottom, 100);
        
        // Set up auto-refresh for logs (every 2 seconds)
        const logRefreshInterval = setInterval(async () => {
            // Always refresh logs, but only auto-scroll if user is at bottom
            
            try {
                const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
                const result = await response.json();
                
                let newLogContent = '';
                if (result.error) {
                    return; // Don't update on error
                } else if (Array.isArray(result)) {
                    newLogContent = result.length > 0 ? result.join('\n') : '';
                } else if (result.data) {
                    if (Array.isArray(result.data)) {
                        newLogContent = result.data.length > 0 ? result.data.join('\n') : '';
                    } else if (typeof result.data === 'string') {
                        newLogContent = result.data || '';
                    } else if (result.data.log) {
                        const logData = result.data.log;
                        newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : '') : (logData || '');
                    }
                } else if (result.log) {
                    const logData = result.log;
                    newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : '') : (logData || '');
                } else if (typeof result === 'string') {
                    newLogContent = result || '';
                }
                
                if (newLogContent && newLogContent !== originalLogContent) {
                    originalLogContent = newLogContent;
                    // Reapply filters with new content
                    filterLogs();
                }
            } catch (error) {
                console.error('Error refreshing log:', error);
            }
        }, 2000);
        
        // Clean up interval when modal is closed
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.onclick = () => {
            clearInterval(logRefreshInterval);
            modal.remove();
        };
    } catch (error) {
        console.error('Error fetching machine log:', error);
        const modalBody = modal.querySelector('.modal-body');
        modalBody.innerHTML = `<div style="padding: 20px; color: var(--error-color);">
            <strong>Error:</strong> Failed to fetch machine log.<br>
            <small>${error.message}</small><br><br>
            Make sure the FAH client is accessible and running.
        </div>`;
    }
}

function showMachineDetails(instanceId) {
    const machine = state.machines.find(m => m.instanceId === instanceId);
    if (!machine || !machine.connected) return;
    
    const info = machine.info || {};
    const gpus = info.gpus || {};
    
    // Build Machine section
    const machineSection = `
        <fieldset style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            <legend style="padding: 0 15px; font-weight: bold; font-size: 1.1em; color: var(--accent);">Machine</legend>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Hostname:</strong> <span style="color: var(--text-primary);">${info.hostname || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">OS:</strong> <span style="color: var(--text-primary);">${info.os || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Client Version:</strong> <span style="color: var(--text-primary);">${info.version || machine.version || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">OS Version:</strong> <span style="color: var(--text-primary);">${info.os_version || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Build Mode:</strong> <span style="color: var(--text-primary);">${info.mode || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Revision:</strong> <span style="color: var(--text-primary); font-family: monospace; font-size: 0.9em;">${info.revision || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Has Battery:</strong> <span style="color: var(--text-primary);">${info.has_battery ? 'true' : 'false'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">On Battery:</strong> <span style="color: var(--text-primary);">${info.on_battery ? 'true' : 'false'}</span></div>
            </div>
        </fieldset>
    `;
    
    // Build CPU section
    const cpuSection = `
        <fieldset style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            <legend style="padding: 0 15px; font-weight: bold; font-size: 1.1em; color: var(--accent);">CPU</legend>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                <div style="grid-column: 1 / -1; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Description:</strong> <span style="color: var(--text-primary);">${info.cpu_brand || info.cpu || 'N/A'}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Cores:</strong> <span style="color: var(--text-primary);">${info.cpus || machine.totalCPUs || 0}</span></div>
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Type:</strong> <span style="color: var(--text-primary);">${info.cpu || 'N/A'}</span></div>
            </div>
        </fieldset>
    `;
    
    // Build GPU sections
    let gpuSections = '';
    for (const [gpuId, gpu] of Object.entries(gpus)) {
        const opencl = gpu.opencl || {};
        const cuda = gpu.cuda || {};
        const hip = gpu.hip || {};
        
        const openclSupported = opencl.compute ? 'supported' : 'unsupported';
        const cudaSupported = cuda.compute ? 'supported' : 'unsupported';
        const hipSupported = hip.compute ? 'supported' : 'unsupported';
        
        const pciDeviceId = gpu.device ? '0x' + gpu.device.toString(16) : 'N/A';
        const pciVendorId = gpu.vendor ? '0x' + gpu.vendor.toString(16) : 'N/A';
        
        gpuSections += `
            <fieldset style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                <legend style="padding: 0 15px; font-weight: bold; font-size: 1.1em; color: var(--accent);">${gpuId}</legend>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                    <div style="grid-column: 1 / -1; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Description:</strong> <span style="color: var(--text-primary);">${gpu.description || 'N/A'}</span></div>
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Vendor:</strong> <span style="color: var(--text-primary);">${gpu.type || 'N/A'}</span></div>
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">Supported:</strong> <span style="color: ${gpu.supported ? 'var(--success)' : 'var(--text-secondary)'};">${gpu.supported ? 'true' : 'false'}</span></div>
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">UUID:</strong> <span style="color: var(--text-primary); font-family: monospace; font-size: 0.9em;">${gpu.uuid || 'N/A'}</span></div>
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">PCI Device ID:</strong> <span style="color: var(--text-primary); font-family: monospace;">${pciDeviceId}</span></div>
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">PCI Vendor ID:</strong> <span style="color: var(--text-primary); font-family: monospace;">${pciVendorId}</span></div>
                    <div style="grid-column: 1 / -1; margin-top: 15px; padding-top: 15px; border-top: 2px solid var(--border);">
                        <div style="padding: 8px 0;"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">OpenCL:</strong> <span style="color: ${opencl.compute ? 'var(--success)' : 'var(--text-secondary)'};">${openclSupported}</span>${opencl.compute ? ` <span style="color: var(--text-primary);">(Compute ${opencl.compute}, Driver ${opencl.driver || 'N/A'})</span>` : ''}</div>
                        <div style="padding: 8px 0;"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">CUDA:</strong> <span style="color: ${cuda.compute ? 'var(--success)' : 'var(--text-secondary)'};">${cudaSupported}</span>${cuda.compute ? ` <span style="color: var(--text-primary);">(Compute ${cuda.compute}, Driver ${cuda.driver || 'N/A'})</span>` : ''}</div>
                        <div style="padding: 8px 0;"><strong style="color: var(--text-secondary); display: inline-block; min-width: 140px;">HIP:</strong> <span style="color: ${hip.compute ? 'var(--success)' : 'var(--text-secondary)'};">${hipSupported}</span>${hip.compute ? ` <span style="color: var(--text-primary);">(Compute ${hip.compute}, Driver ${hip.driver || 'N/A'})</span>` : ''}</div>
                    </div>
                </div>
            </fieldset>
        `;
    }
    
    // If no GPUs found, show a message
    if (gpuSections === '') {
        gpuSections = `
            <fieldset style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                <legend style="padding: 0 15px; font-weight: bold; font-size: 1.1em; color: var(--accent);">GPU</legend>
                <div style="padding: 20px; color: var(--text-secondary); text-align: center;">No GPU information available</div>
            </fieldset>
        `;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 90vw; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header">
                <h2>Machine Details: ${machine.name}</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body" style="padding: 20px;">
                ${machineSection}
                ${cpuSection}
                ${gpuSections}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
}

async function showWorkUnitLog(instanceId, unitIndex) {
    const machine = state.machines.find(m => m.instanceId === instanceId);
    if (!machine || !machine.connected) return;
    
    const unit = machine.units[unitIndex];
    if (!unit) return;
    
    // Extract work unit identifiers for display and searching
    const assign = unit.assignment || unit.assign || {};
    const wu = unit.wu || {};
    const project = assign.project || unit.project || 'N/A';
    const run = wu.run || assign.run || 'N/A';
    const clone = wu.clone || assign.clone || 'N/A';
    const gen = wu.gen || assign.gen || 'N/A';
    
    // We'll extract the WU ID from the logs after loading them
    let wuSearchTerm = '';
    
    // Create modal first to show loading state
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 90vw; max-height: 90vh;">
            <div class="modal-header">
                <h2>Work Unit Log: Project ${project} (Run ${run}, Clone ${clone}, Gen ${gen})</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="log-controls" style="padding: 15px; border-bottom: 1px solid var(--border-color); display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                <label style="display: flex; align-items: center; gap: 5px;">
                    <span>Search:</span>
                    <input type="text" id="wu-log-search-${instanceId}-${unitIndex}" value="${wuSearchTerm}" placeholder="Search log..." style="flex: 1; min-width: 200px; padding: 5px 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                </label>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" id="wu-log-errors-${instanceId}-${unitIndex}" style="cursor: pointer;">
                    <span>Errors</span>
                </label>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" id="wu-log-warnings-${instanceId}-${unitIndex}" style="cursor: pointer;">
                    <span>Warnings</span>
                </label>
                <button class="btn btn-secondary" id="wu-log-reload-${instanceId}-${unitIndex}" style="padding: 5px 15px; margin-left: auto;" title="Reload log">
                    <span class="material-symbols-filled">refresh</span> Reload
                </button>
            </div>
            <div class="modal-body" style="overflow: auto; max-height: 60vh;">
                <div style="padding: 20px; text-align: center;">Loading log...</div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    
    try {
        const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
        const result = await response.json();
        
        console.log('Log response:', result); // Debug log
        
        // Handle different response formats
        let logContent = 'No log data available';
        if (result.error) {
            logContent = `Error: ${result.message || result.error}\n\nNote: Logs may not be available if the FAH client hasn't generated any log entries yet.`;
        } else if (Array.isArray(result)) {
            logContent = result.length > 0 ? result.join('\n') : 'No log entries available.';
        } else if (result.data) {
            if (Array.isArray(result.data)) {
                logContent = result.data.length > 0 ? result.data.join('\n') : 'No log entries available.';
            } else if (typeof result.data === 'string') {
                logContent = result.data || 'No log data available.';
            } else if (result.data.log) {
                const logData = result.data.log;
                logContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
            } else {
                logContent = 'Log data structure not recognized. Raw data: ' + JSON.stringify(result.data, null, 2);
            }
        } else if (result.log) {
            const logData = result.log;
            logContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
        } else if (typeof result === 'string') {
            logContent = result || 'No log data available.';
        } else {
            logContent = 'Unexpected response format. Raw data: ' + JSON.stringify(result, null, 2);
        }
        
        // Extract WU ID from logs by finding entries that match this unit's project/run/clone/gen
        let extractedWuId = null;
        if (project !== 'N/A') {
            const projectStr = String(project);
            const runStr = String(run);
            const cloneStr = String(clone);
            const genStr = String(gen);
            
            // Search for log entries that match this unit
            const lines = logContent.split('\n');
            for (const line of lines) {
                const wuMatch = line.match(/WU(\d+):/);
                if (wuMatch) {
                    const candidateWuId = wuMatch[1];
                    if (line.includes(`Project: ${projectStr}`) || line.includes(`P${projectStr}`)) {
                        if (run !== 'N/A' && clone !== 'N/A' && gen !== 'N/A') {
                            if (line.includes(`Run ${runStr}`) || line.includes(`R${runStr}`) ||
                                line.includes(`Clone ${cloneStr}`) || line.includes(`C${cloneStr}`) ||
                                line.includes(`Gen ${genStr}`) || line.includes(`G${genStr}`) ||
                                line.includes(`${runStr},${cloneStr},${genStr}`)) {
                                extractedWuId = candidateWuId;
                                break;
                            }
                        } else {
                            extractedWuId = candidateWuId;
                            break;
                        }
                    }
                }
            }
        }
        
        // Get control elements
        const searchInput = modal.querySelector(`#wu-log-search-${instanceId}-${unitIndex}`);
        
        // Set the search term based on extracted WU ID
        if (extractedWuId) {
            wuSearchTerm = `:WU${extractedWuId}:`;
            // Update the search input with the extracted WU ID
            if (searchInput) {
                searchInput.value = wuSearchTerm;
            }
        }
        const errorsCheckbox = modal.querySelector(`#wu-log-errors-${instanceId}-${unitIndex}`);
        const warningsCheckbox = modal.querySelector(`#wu-log-warnings-${instanceId}-${unitIndex}`);
        const reloadBtn = modal.querySelector(`#wu-log-reload-${instanceId}-${unitIndex}`);
        
        // Store original log content for filtering
        let originalLogContent = logContent;
        let filteredLogContent = logContent;
        
        // Filter function
        const filterLogs = () => {
            const searchTerm = searchInput.value.toLowerCase();
            const showErrors = errorsCheckbox.checked;
            const showWarnings = warningsCheckbox.checked;
            
            if (!searchTerm && !showErrors && !showWarnings) {
                filteredLogContent = originalLogContent;
            } else {
                const lines = originalLogContent.split('\n');
                filteredLogContent = lines.filter(line => {
                    // Check search term
                    if (searchTerm && !line.toLowerCase().includes(searchTerm)) {
                        return false;
                    }
                    
                    // Check error/warning filters (match official client pattern)
                    if (showErrors || showWarnings) {
                        const errorPattern = /:\[E\]:/;
                        const warningPattern = /:\[W\]:/;
                        const hasError = errorPattern.test(line) || /ERROR/i.test(line);
                        const hasWarning = warningPattern.test(line) || /WARNING/i.test(line);
                        
                        if (showErrors && showWarnings) {
                            return hasError || hasWarning;
                        } else if (showErrors) {
                            return hasError;
                        } else if (showWarnings) {
                            return hasWarning;
                        }
                    }
                    
                    return true;
                }).join('\n');
            }
            
            // Update display
            pre.textContent = filteredLogContent || 'No log entries match the current filters.';
            
            // Auto-scroll if user was at bottom
            if (!userScrolledUp) {
                setTimeout(() => {
                    isScrolling = true;
                    modalBody.scrollTop = modalBody.scrollHeight;
                    setTimeout(() => { isScrolling = false; }, 100);
                }, 50);
            }
        };
        
        // Update modal content
        const modalBody = modal.querySelector('.modal-body');
        const pre = document.createElement('pre');
        pre.style.cssText = 'font-family: monospace; white-space: pre-wrap; word-wrap: break-word; background: #1a1a1a; padding: 15px; border-radius: 4px; margin: 0;';
        pre.textContent = logContent;
        modalBody.innerHTML = '';
        modalBody.appendChild(pre);
        
        // Auto-scroll to bottom
        const scrollToBottom = () => {
            modalBody.scrollTop = modalBody.scrollHeight;
        };
        
        // Track if user has manually scrolled up
        let userScrolledUp = false;
        let isScrolling = false;
        
        const checkScrollPosition = () => {
            if (isScrolling) return;
            
            const isNearBottom = modalBody.scrollHeight - modalBody.scrollTop - modalBody.clientHeight < 50;
            
            if (isNearBottom) {
                userScrolledUp = false;
            } else if (!userScrolledUp) {
                userScrolledUp = true;
            }
        };
        
        modalBody.addEventListener('scroll', checkScrollPosition);
        
        // Set up filter event listeners
        searchInput.addEventListener('input', filterLogs);
        errorsCheckbox.addEventListener('change', filterLogs);
        warningsCheckbox.addEventListener('change', filterLogs);
        
        // Trigger initial filter since search is pre-filled with WU ID
        filterLogs();
        
        // Reload button handler
        reloadBtn.addEventListener('click', async () => {
            reloadBtn.disabled = true;
            reloadBtn.innerHTML = '<span class="material-symbols-filled">refresh</span> Loading...';
            
            try {
                const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
                const result = await response.json();
                
                let newLogContent = 'No log data available';
                if (result.error) {
                    newLogContent = `Error: ${result.message || result.error}`;
                } else if (Array.isArray(result)) {
                    newLogContent = result.length > 0 ? result.join('\n') : 'No log entries available.';
                } else if (result.data) {
                    if (Array.isArray(result.data)) {
                        newLogContent = result.data.length > 0 ? result.data.join('\n') : 'No log entries available.';
                    } else if (typeof result.data === 'string') {
                        newLogContent = result.data || 'No log data available.';
                    } else if (result.data.log) {
                        const logData = result.data.log;
                        newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
                    }
                } else if (result.log) {
                    const logData = result.log;
                    newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : 'No log entries available.') : (logData || 'No log data available.');
                } else if (typeof result === 'string') {
                    newLogContent = result || 'No log data available.';
                }
                
                // Update log content (search filter will handle filtering)
                originalLogContent = newLogContent;
                filterLogs(); // Reapply filters (including pre-filled search)
                userScrolledUp = false;
                setTimeout(scrollToBottom, 100);
            } catch (error) {
                console.error('Error reloading log:', error);
                alert('Failed to reload log: ' + error.message);
            } finally {
                reloadBtn.disabled = false;
                reloadBtn.innerHTML = '<span class="material-symbols-filled">refresh</span> Reload';
            }
        });
        
        // Initial scroll to bottom
        setTimeout(scrollToBottom, 100);
        
        // Set up auto-refresh for logs (every 2 seconds)
        const logRefreshInterval = setInterval(async () => {
            try {
                const response = await fetch(`${API_BASE}/api/fah/${instanceId}/log`);
                const result = await response.json();
                
                let newLogContent = '';
                if (result.error) {
                    return;
                } else if (Array.isArray(result)) {
                    newLogContent = result.length > 0 ? result.join('\n') : '';
                } else if (result.data) {
                    if (Array.isArray(result.data)) {
                        newLogContent = result.data.length > 0 ? result.data.join('\n') : '';
                    } else if (typeof result.data === 'string') {
                        newLogContent = result.data || '';
                    } else if (result.data.log) {
                        const logData = result.data.log;
                        newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : '') : (logData || '');
                    }
                } else if (result.log) {
                    const logData = result.log;
                    newLogContent = Array.isArray(logData) ? (logData.length > 0 ? logData.join('\n') : '') : (logData || '');
                } else if (typeof result === 'string') {
                    newLogContent = result || '';
                }
                
                if (newLogContent && newLogContent !== originalLogContent) {
                    // Update log content (search filter will handle filtering)
                    originalLogContent = newLogContent;
                    filterLogs(); // Reapply filters with new content (including pre-filled search)
                }
            } catch (error) {
                console.error('Error auto-refreshing log:', error);
            }
        }, 2000);
        
        // Clean up interval when modal is closed
        modal.querySelector('.close-btn').addEventListener('click', () => {
            clearInterval(logRefreshInterval);
        });
        
    } catch (error) {
        console.error('Error loading work unit log:', error);
        const modalBody = modal.querySelector('.modal-body');
        modalBody.innerHTML = `<div class="error">Error loading work unit log: ${error.message}</div>`;
    }
}

// Helper function to parse time interval strings (e.g., "5m 30s" -> 330)
function parseTimeInterval(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    
    const re = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g;
    let totalSeconds = 0;
    let match;
    
    while ((match = re.exec(timeStr)) !== null) {
        const num = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        
        if (unit.startsWith('d')) totalSeconds += num * 86400;
        else if (unit.startsWith('h')) totalSeconds += num * 3600;
        else if (unit.startsWith('m')) totalSeconds += num * 60;
        else if (unit.startsWith('s')) totalSeconds += num;
    }
    
    return totalSeconds;
}

// Helper function to format time intervals (matches official client format)
function formatTimeInterval(seconds) {
    if (!isFinite(seconds) || seconds < 0) return 'N/A';
    
    // Match official client format: "5d 20h" or "5m 41s" or "1h 23m"
    if (seconds < 0.9995) return Math.round(seconds * 1000) + 'ms';
    if (seconds < 60) return Math.round(seconds) + 's';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (seconds < 3600) {
        // Less than an hour: "5m 41s"
        return `${minutes}m ${String(secs).padStart(2, '0')}s`;
    } else if (seconds < 86400) {
        // Less than a day: "1h 23m"
        return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    } else {
        // Days: "5d 20h" (no minutes shown)
        return `${days}d ${String(hours).padStart(2, '0')}h`;
    }
}

// Helper function to format relative time (e.g., "2h 15m ago")
function formatRelativeTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);
    
    if (diffSeconds < 60) return 'just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ${Math.floor((diffSeconds % 3600) / 60)}m ago`;
    const days = Math.floor(diffSeconds / 86400);
    return `${days}d ${Math.floor((diffSeconds % 86400) / 3600)}h ago`;
}

// Helper function to format date/time
function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Helper function to get GPU description from unit
function getGPUDescription(unit, machine) {
    if (!unit.assign || !unit.assign.gpus || !Array.isArray(unit.assign.gpus)) {
        return 'N/A';
    }
    const gpus = [];
    unit.assign.gpus.forEach(gpuId => {
        if (machine && machine.info && machine.info.gpus && machine.info.gpus[gpuId]) {
            gpus.push(machine.info.gpus[gpuId].description || gpuId);
        } else {
            gpus.push(gpuId);
        }
    });
    return gpus.length > 0 ? gpus.join(', ') : 'N/A';
}

async function showWorkUnitDetails(instanceId, unitIndex) {
    const machine = state.machines.find(m => m.instanceId === instanceId);
    if (!machine || !machine.connected) return;
    
    const unit = machine.units[unitIndex];
    if (!unit) return;
    
    const assign = unit.assignment || unit.assign || {};
    const wu = unit.wu || {};
    const progress = (unit.progress || unit.wu_progress || 0);
    const progressPercent = progress <= 1 ? progress * 100 : progress;
    
    // Extract values
    const project = assign.project || unit.project || 'N/A';
    const run = wu.run || assign.run || 'N/A';
    const clone = wu.clone || assign.clone || 'N/A';
    const gen = wu.gen || assign.gen || 'N/A';
    const rcg = `${run},${clone},${gen}`;
    const status = getStatusText(unit);
    const statusClass = getStatusClass(unit);
    const machineName = machine.name || 'N/A';
    const os = machine.info?.os || unit.os || 'N/A';
    
    // Calculate TPF (Time Per Frame) - official client: run_time / (progress * 100)
    let tpf = 'N/A';
    if (unit.run_time !== undefined && progress > 0) {
        const frames = progress * 100;
        const tpfSeconds = parseFloat(unit.run_time) / frames;
        if (tpfSeconds > 0 && isFinite(tpfSeconds)) {
            tpf = formatTimeInterval(tpfSeconds);
        }
    } else if (unit.tpf) {
        // Fallback to direct tpf value if available
        const tpfVal = typeof unit.tpf === 'string' ? parseTimeInterval(unit.tpf) : parseFloat(unit.tpf);
        if (tpfVal > 0) {
            tpf = formatTimeInterval(tpfVal);
        }
    }
    
    const ppd = formatNumber(unit.ppd || 0);
    const cpus = unit.cpus || 'N/A';
    const gpus = getGPUDescription(unit, machine);
    
    // Calculate run time - official client adds current time if in RUN state
    let runTime = 'N/A';
    if (unit.run_time !== undefined) {
        let runTimeSeconds = parseFloat(unit.run_time);
        // If unit is running, add elapsed time since start_time
        if (unit.state === 'RUN' && unit.start_time) {
            const startTime = new Date(unit.start_time).getTime();
            const now = new Date().getTime();
            runTimeSeconds += (now - startTime) / 1000;
        }
        if (runTimeSeconds > 0) {
            runTime = formatTimeInterval(runTimeSeconds);
        }
    }
    
    // Calculate ETA - official client handles string format and parses it
    let eta = 'N/A';
    if (unit.eta !== undefined && progress < 1) {
        let etaSeconds = unit.eta;
        if (typeof etaSeconds === 'string') {
            etaSeconds = parseTimeInterval(etaSeconds);
        } else {
            etaSeconds = parseFloat(etaSeconds);
        }
        if (etaSeconds > 0 && isFinite(etaSeconds)) {
            eta = formatTimeInterval(etaSeconds);
        }
    }
    
    const assignTime = assign.time ? formatRelativeTime(assign.time) : 'N/A';
    const baseCredit = assign.credit ? formatNumber(assign.credit) : 'N/A';
    
    // Calculate deadline and timeout - these are time remaining from now, not absolute values
    let deadline = 'N/A';
    let timeout = 'N/A';
    if (assign.time && assign.deadline !== undefined) {
        // Deadline is seconds from assign.time, calculate remaining time
        const assignTimeMs = new Date(assign.time).getTime();
        const now = new Date().getTime();
        const deadlineSeconds = parseFloat(assign.deadline);
        const remaining = deadlineSeconds - ((now - assignTimeMs) / 1000);
        if (remaining > 0) {
            deadline = formatTimeInterval(remaining);
        }
    }
    if (assign.time && assign.timeout !== undefined) {
        // Timeout is seconds from assign.time, calculate remaining time
        const assignTimeMs = new Date(assign.time).getTime();
        const now = new Date().getTime();
        const timeoutSeconds = parseFloat(assign.timeout);
        const remaining = timeoutSeconds - ((now - assignTimeMs) / 1000);
        if (remaining > 0) {
            timeout = formatTimeInterval(remaining);
        }
    }
    
    // Handle core - it might be an object, string, or number
    let core = 'N/A';
    if (assign.core) {
        if (typeof assign.core === 'object') {
            // Official client uses assign.core.type for the hex value
            core = assign.core.type || assign.core.hex || assign.core.id || assign.core.value || 'N/A';
            if (core !== 'N/A') {
                core = String(core);
            }
        } else {
            core = String(assign.core);
        }
    } else if (unit.core) {
        if (typeof unit.core === 'object') {
            // Try type first (official client pattern), then other common properties
            core = unit.core.type || unit.core.hex || unit.core.id || unit.core.value || 'N/A';
            if (core !== 'N/A') {
                core = String(core);
            }
        } else {
            core = String(unit.core);
        }
    }
    
    const workServer = assign.ws || unit.workServer || 'N/A';
    const slot = unit.slot || 'N/A';
    
    // Build work unit details HTML
    const detailsHTML = `
        <fieldset style="border: 1px solid var(--border); border-radius: 4px; padding: 15px; margin-bottom: 20px;">
            <legend style="color: var(--accent); font-weight: 600; padding: 0 10px;">Work Unit #${unit.number || unit.id || 'N/A'}</legend>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px;">
                <div>
                    <strong>Status:</strong> <span class="status-icon ${statusClass}"></span> ${status}
                </div>
                <div>
                    <strong>Progress:</strong> 
                    <div class="progress-bar" style="margin-top: 5px;">
                        <div class="progress-fill ${statusClass === 'paused' ? 'paused' : (progressPercent < 50 ? 'warning' : '')}" style="width: ${progressPercent}%"></div>
                        <div class="progress-text">${progressPercent.toFixed(1)}%</div>
                    </div>
                </div>
                <div><strong>Machine:</strong> ${machineName}</div>
                <div><strong>OS:</strong> ${os}</div>
                <div><strong>TPF:</strong> ${tpf}</div>
                <div><strong>PPD:</strong> ${ppd}</div>
                <div><strong>CPUs:</strong> ${cpus}</div>
                <div><strong>GPUs:</strong> ${gpus}</div>
                <div><strong>Run Time:</strong> ${runTime}</div>
                <div><strong>ETA:</strong> ${eta}</div>
                <div><strong>Assign Time:</strong> ${assignTime}</div>
                <div><strong>Base Credit:</strong> ${baseCredit}</div>
                <div><strong>Deadline:</strong> ${deadline}</div>
                <div><strong>Timeout:</strong> ${timeout}</div>
                <div><strong>Core:</strong> ${core}</div>
                <div><strong>Work Server:</strong> ${workServer}</div>
                <div><strong>Project:</strong> ${project}</div>
                <div><strong>RCG:</strong> ${rcg}</div>
            </div>
        </fieldset>
    `;
    
    // Build logged credits section (only if external API is enabled)
    let creditsHTML = '';
    if (state.externalApiEnabled && project !== 'N/A' && run !== 'N/A' && clone !== 'N/A' && gen !== 'N/A') {
        creditsHTML = `
            <fieldset style="border: 1px solid var(--border); border-radius: 4px; padding: 15px; margin-bottom: 20px;">
                <legend style="color: var(--accent); font-weight: 600; padding: 0 10px;">Logged Credits</legend>
                <div id="workUnitCredits" style="margin-top: 10px;">
                    <div class="loading">Loading credits...</div>
                </div>
            </fieldset>
        `;
    } else if (!state.externalApiEnabled) {
        creditsHTML = `
            <fieldset style="border: 1px solid var(--border); border-radius: 4px; padding: 15px; margin-bottom: 20px;">
                <legend style="color: var(--accent); font-weight: 600; padding: 0 10px;">Logged Credits</legend>
                <div style="margin-top: 10px; color: var(--text-secondary); text-align: center; padding: 20px;">
                    Enable external API calls in Settings to view logged credits.
                </div>
            </fieldset>
        `;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content large">
            <div class="modal-header">
                <h2>Work Unit Details</h2>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                ${detailsHTML}
                ${creditsHTML}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    
    // Load credits if external API is enabled
    if (state.externalApiEnabled && project !== 'N/A' && run !== 'N/A' && clone !== 'N/A' && gen !== 'N/A') {
        loadWorkUnitCredits(project, run, clone, gen, modal);
    }
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function loadWorkUnitCredits(project, run, clone, gen, modal) {
    const creditsContainer = modal.querySelector('#workUnitCredits');
    if (!creditsContainer) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/project/${project}/run/${run}/clone/${clone}/gen/${gen}`);
        if (!response.ok) {
            throw new Error('Failed to fetch credits');
        }
        
        const credits = await response.json();
        
        if (!Array.isArray(credits) || credits.length === 0) {
            creditsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No credits logged</div>';
            return;
        }
        
        creditsContainer.innerHTML = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="border-bottom: 1px solid var(--border);">
                        <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">Code</th>
                        <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">User</th>
                        <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">Team</th>
                        <th style="text-align: right; padding: 10px; color: var(--text-secondary); font-weight: 600;">Credit</th>
                        <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">Assigned</th>
                        <th style="text-align: left; padding: 10px; color: var(--text-secondary); font-weight: 600;">Credited</th>
                    </tr>
                </thead>
                <tbody>
                    ${credits.map(credit => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 10px;">${credit.code || 'N/A'}</td>
                            <td style="padding: 10px;">${credit.user || 'N/A'}</td>
                            <td style="padding: 10px;">${credit.team || 'N/A'}</td>
                            <td style="padding: 10px; text-align: right;">${credit.credit ? formatNumber(credit.credit) : 'N/A'}</td>
                            <td style="padding: 10px;">${credit.assigned ? formatDateTime(credit.assigned) : 'N/A'}</td>
                            <td style="padding: 10px;">${credit.credited ? formatDateTime(credit.credited) : 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="margin-top: 10px; padding: 10px; color: var(--text-secondary); font-size: 12px; text-align: center;">
                May include credits awarded to other users.
            </div>
        `;
    } catch (error) {
        console.error('Error loading work unit credits:', error);
        creditsContainer.innerHTML = `<div class="error" style="text-align: center; padding: 20px;">Error loading credits: ${error.message}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function startAutoRefresh() {
    // Refresh data every 5 seconds, but update DOM incrementally
    state.refreshInterval = setInterval(() => {
        // Only refresh data, renderMachines will do incremental updates
        loadMachines().then(() => {
            renderMachines();
        });
    }, 5000);
}

// Make functions available globally for onclick handlers
window.removeInstance = removeInstance;
window.toggleMachine = toggleMachine;
window.showWorkUnitDetails = showWorkUnitDetails;
window.showWorkUnitLog = showWorkUnitLog;
window.showMachineSettings = showMachineSettings;
window.showMachineLog = showMachineLog;
window.showMachineDetails = showMachineDetails;

