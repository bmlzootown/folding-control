const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// File to store instances
const INSTANCES_FILE = path.join(__dirname, 'instances.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store configured instances
// FAH v8.4 default port is 7396 (not 36330)
let instances = [
  { id: 'local', name: 'Local Instance', host: '127.0.0.1', port: 7396, enabled: true }
];

// Load instances from file
async function loadInstances() {
  try {
    const data = await fs.readFile(INSTANCES_FILE, 'utf8');
    const savedInstances = JSON.parse(data);
    // Merge with default local instance (always keep local)
    const localInstance = instances.find(i => i.id === 'local');
    instances = [localInstance, ...savedInstances.filter(i => i.id !== 'local')];
    console.log(`Loaded ${savedInstances.length} saved instance(s)`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, that's okay - use defaults
      console.log('No saved instances found, using defaults');
    } else {
      console.error('Error loading instances:', error.message);
    }
  }
}

// Save instances to file
async function saveInstances() {
  try {
    // Don't save the local instance (it's always there by default)
    const instancesToSave = instances.filter(i => i.id !== 'local');
    await fs.writeFile(INSTANCES_FILE, JSON.stringify(instancesToSave, null, 2), 'utf8');
    console.log(`Saved ${instancesToSave.length} instance(s) to ${INSTANCES_FILE}`);
  } catch (error) {
    console.error('Error saving instances:', error.message);
  }
}

// Store WebSocket connections to FAH clients
const fahConnections = new Map();
// Store initial machine data for each connection
const machineData = new Map();

/**
 * Normalizes property keys for FAH protocol compatibility.
 * The FAH protocol uses hyphenated keys (e.g., "work-unit"), but JavaScript
 * objects work better with underscores. This function converts hyphens to underscores.
 */
function normalizePropertyKey(key) {
  // Only normalize string keys that are short enough to be property names
  if (typeof key === 'string' && key.length > 0 && key.length <= 16) {
    // Replace hyphens with underscores for JavaScript compatibility
    return key.replace(/-/g, '_');
  }
  // Return non-string keys (like array indices) as-is
  return key;
}

/**
 * Applies FAH protocol update arrays to state objects.
 * 
 * The FAH client sends incremental state updates as arrays following the format:
 * ['path', 'to', 'field', newValue]
 * 
 * This function processes these protocol-compliant updates and applies them to
 * the current state.
 */
function applyStateUpdate(currentState, updateArray) {
  // Validate input
  if (!Array.isArray(updateArray) || updateArray.length < 2) {
    return currentState;
  }
  
  // Initialize state if needed
  if (!currentState || typeof currentState !== 'object' || Array.isArray(currentState)) {
    currentState = {};
  }
  
  // Create a working copy to avoid mutating the original
  const state = JSON.parse(JSON.stringify(currentState));
  
  // Process the update path: all elements except the last two form the path,
  // second-to-last is the key, last is the value
  const pathLength = updateArray.length - 2;
  let currentObject = state;
  let pathIndex = 0;
  
  // Traverse the path, creating nested objects/arrays as needed
  while (pathIndex < pathLength) {
    const pathKey = normalizePropertyKey(updateArray[pathIndex]);
    pathIndex++;
    
    // Validate current object
    if (currentObject === null || currentObject === undefined || 
        (typeof currentObject !== 'object' && !Array.isArray(currentObject))) {
      // Invalid path, return original state
      return currentState;
    }
    
    // Determine if we need to create a new nested structure
    if (currentObject[pathKey] === undefined || currentObject[pathKey] === null) {
      // Check the next element to decide if it should be an array or object
      const nextElement = pathIndex < updateArray.length ? updateArray[pathIndex] : null;
      currentObject[pathKey] = (nextElement !== null && Number.isInteger(nextElement)) ? [] : {};
    }
    
    // Move to the next level
    currentObject = currentObject[pathKey];
    
    // Safety check
    if (currentObject === null || currentObject === undefined) {
      return currentState;
    }
  }
  
  // Now apply the final update at the target location
  if (currentObject === null || currentObject === undefined || 
      (typeof currentObject !== 'object' && !Array.isArray(currentObject))) {
    return currentState;
  }
  
  const targetKey = normalizePropertyKey(updateArray[pathIndex]);
  const newValue = updateArray[pathIndex + 1];
  const isTargetArray = Array.isArray(currentObject);
  
  // Handle different update operations based on FAH protocol
  if (isTargetArray) {
    if (targetKey === -1) {
      // Append operation: add value to end of array
      currentObject.push(newValue);
    } else if (targetKey === -2) {
      // Bulk append: add multiple values to end of array
      if (Array.isArray(newValue)) {
        currentObject.splice(currentObject.length, 0, ...newValue);
      }
    } else if (newValue === null) {
      // Delete operation: remove element at index
      if (targetKey >= 0 && targetKey < currentObject.length) {
        currentObject.splice(targetKey, 1);
      }
    } else {
      // Set operation: update element at index
      currentObject[targetKey] = newValue;
    }
  } else {
    // Object operations
    if (newValue === null) {
      // Delete operation: remove property
      delete currentObject[targetKey];
    } else {
      // Set operation: update property value
      currentObject[targetKey] = newValue;
    }
  }
  
  return state;
}

// Helper function to get or create WebSocket connection to FAH client
// FAH v8.4 uses ws://host:port/api/websocket
function getFAHConnection(instanceId, host, port) {
  const key = `${instanceId}:${host}:${port}`;
  
  if (fahConnections.has(key)) {
    const conn = fahConnections.get(key);
    if (conn.readyState === WebSocket.OPEN) {
      return Promise.resolve(conn);
    }
    // Connection is closed, remove it
    fahConnections.delete(key);
    machineData.delete(key);
  }
  
  return new Promise((resolve, reject) => {
    // FAH v8.4 uses WebSocket at /api/websocket endpoint
    const wsUrl = `ws://${host}:${port}/api/websocket`;
    const ws = new WebSocket(wsUrl);
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);
    
    // Set up persistent message handler to update machine state
    const messageHandler = (rawData) => {
      try {
        const data = JSON.parse(rawData.toString());
        let currentState = machineData.get(key);
        
        // Initialize state if it doesn't exist
        if (!currentState || typeof currentState !== 'object') {
          currentState = {};
        }
        
        if (Array.isArray(data)) {
          // This is an update array - apply it to current state
          // Deep clone to avoid mutating the stored state
          const stateCopy = JSON.parse(JSON.stringify(currentState));
          const updatedState = applyStateUpdate(stateCopy, data);
          if (updatedState) {
            machineData.set(key, updatedState);
          }
        } else if (data && typeof data === 'object') {
          // This is the initial full state or a complete state update
          machineData.set(key, data);
        }
      } catch (error) {
        // Only log errors that aren't about undefined properties (those are common during initialization)
        if (!error.message.includes('Cannot read properties of undefined')) {
          console.error(`Error processing message for ${key}:`, error.message);
        }
      }
    };
    
    ws.on('open', () => {
      clearTimeout(timeout);
      fahConnections.set(key, ws);
      
      // Set up persistent message handler
      ws.on('message', messageHandler);
      
      // Enable log streaming when connection opens (like official client)
      try {
        const logEnableRequest = {
          cmd: 'log',
          time: new Date().toISOString(),
          enable: true
        };
        ws.send(JSON.stringify(logEnableRequest));
      } catch (error) {
        console.error(`Error enabling log on connection for ${key}:`, error);
      }
      
      // Clean up on close
      ws.on('close', () => {
        fahConnections.delete(key);
        machineData.delete(key);
      });
      
      ws.on('error', () => {
        fahConnections.delete(key);
        machineData.delete(key);
      });
      
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// Helper function to send WebSocket command
// FAH protocol: Commands are sent as {cmd, time, ...data}
async function fahWebSocketCommand(instanceId, host, port, command, data = {}) {
  try {
    const ws = await getFAHConnection(instanceId, host, port);
    const key = `${instanceId}:${host}:${port}`;
    
    // Send the command in FAH format: {cmd, time, ...data}
    const request = {
      cmd: command,
      time: new Date().toISOString(),
      ...data
    };
    
    ws.send(JSON.stringify(request), (error) => {
      if (error) {
        console.error(`Error sending command to ${key}:`, error);
      }
    });
    
    // Wait a bit for state to update, then return current state
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const currentState = machineData.get(key);
    if (currentState) {
      return { success: true, data: currentState };
    }
    
    return { success: false, error: 'No machine state available' };
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.message.includes('timeout')) {
      return { success: false, error: 'Connection refused or timed out' };
    }
    return { success: false, error: error.message };
  }
}

// Helper function to make FAH API requests (tries WebSocket first, then HTTP fallback)
async function fahRequest(instanceId, host, port, endpoint, method = 'GET', data = null) {
  // Try WebSocket first (FAH v8.4 primary method)
  try {
    // Map endpoint to FAH command
    // Common endpoints: 'info', 'slots', 'queue' -> these are accessed via machine state
    // Commands: 'state' (pause/unpause), 'config', 'dump', etc.
    
    let command = endpoint;
    let commandData = data || {};
    
    // Map REST-like endpoints to FAH commands
    if (endpoint === 'pause' || endpoint === 'unpause') {
      command = 'state';
      // Official client uses 'fold' to resume, not 'unpause'
      commandData = { state: endpoint === 'pause' ? 'pause' : 'fold' };
    } else if (endpoint === 'log') {
      // Enable log streaming and get logs from machine state
      const key = `${instanceId}:${host}:${port}`;
      
      // First, enable log streaming if not already enabled
      try {
        const ws = await getFAHConnection(instanceId, host, port);
        const logEnableRequest = {
          cmd: 'log',
          time: new Date().toISOString(),
          enable: true
        };
        ws.send(JSON.stringify(logEnableRequest));
      } catch (error) {
        console.error(`Error enabling log for ${key}:`, error);
      }
      
      // Wait a bit for log data to arrive
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (machineData.has(key)) {
        const machineState = machineData.get(key);
        const log = machineState.log || [];
        return { success: true, data: log };
      }
      // Need to get initial state first - connect and wait for first message
      command = null;
    } else if (endpoint.startsWith('queue/') || endpoint === 'units') {
      // Units/work units access is via machine state
      const key = `${instanceId}:${host}:${port}`;
      if (machineData.has(key)) {
        const machineState = machineData.get(key);
        const units = machineState.units || [];
        if (endpoint.startsWith('queue/')) {
          const slotIndex = parseInt(endpoint.split('/')[1]);
          // Return units for a specific slot/group
          return { success: true, data: units.filter(u => u.slot === slotIndex) || [] };
        }
        return { success: true, data: units };
      }
      // Need to get initial state first
      command = null;
    } else if (endpoint === 'slots' || endpoint === 'info') {
      // These are accessed from machine state, not commands
      const key = `${instanceId}:${host}:${port}`;
      if (machineData.has(key)) {
        const machineState = machineData.get(key);
        if (endpoint === 'slots') {
          // Slots might be in groups or config
          const groups = machineState.groups || {};
          const slots = [];
          for (const groupName in groups) {
            const group = groups[groupName];
            if (group.slots) {
              slots.push(...group.slots);
            }
          }
          return { success: true, data: slots.length ? slots : [] };
        } else if (endpoint === 'info') {
          // Return the full machine state, not just info
          return { success: true, data: machineState };
        }
      }
      // Need to get initial state first - connect and wait for first message
      command = null;
    }
    
    if (command) {
      const result = await fahWebSocketCommand(instanceId, host, port, command, commandData);
      if (result.success) {
        return result;
      }
    } else {
      // Just connect to get initial state (if not already connected)
      const key = `${instanceId}:${host}:${port}`;
      
      // Try to get connection (will create if needed)
      try {
        await getFAHConnection(instanceId, host, port);
        
        // Wait a bit for initial state to arrive
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const machineState = machineData.get(key);
        if (machineState) {
          if (endpoint === 'slots') {
            const groups = machineState.groups || {};
            const slots = [];
            for (const groupName in groups) {
              const group = groups[groupName];
              if (group.slots) {
                slots.push(...group.slots);
              }
            }
            return { success: true, data: slots.length ? slots : [] };
          } else if (endpoint === 'units' || endpoint.startsWith('queue/')) {
            const units = machineState.units || [];
            if (endpoint.startsWith('queue/')) {
              const slotIndex = parseInt(endpoint.split('/')[1]);
              return { success: true, data: units.filter(u => u.slot === slotIndex) || [] };
            }
            return { success: true, data: units };
          } else if (endpoint === 'info') {
            // Return the full machine state
            return { success: true, data: machineState };
          } else if (endpoint === 'log') {
            const log = machineState.log || [];
            return { success: true, data: log };
          } else {
            return { success: true, data: machineState };
          }
        }
        
        return { success: false, error: 'Timeout waiting for initial state' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  } catch (error) {
    // WebSocket failed, try HTTP fallback
    console.log(`WebSocket failed for ${instanceId}, trying HTTP fallback...`);
  }
  
  // HTTP fallback for older clients or different configurations
  const endpoints = [
    `http://${host}:${port}/api/${endpoint}`,
    `http://${host}:${port}/${endpoint}`,
    `http://${host}:${port}/api/v1/${endpoint}`
  ];
  
  for (const url of endpoints) {
    try {
      const config = {
        method,
        url,
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };
      
      if (data) {
        config.data = data;
      }
      
      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error) {
      // If this is the last endpoint to try, return the error
      if (endpoints.indexOf(url) === endpoints.length - 1) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          return { success: false, error: 'Connection refused or timed out' };
        }
        if (error.response) {
          return { success: false, error: `HTTP ${error.response.status}: ${error.response.statusText}` };
        }
        return { success: false, error: error.message };
      }
      continue;
    }
  }
  
  return { success: false, error: 'All connection attempts failed' };
}

// Get all instances
app.get('/api/instances', (req, res) => {
  res.json(instances);
});

// Add a new instance
app.post('/api/instances', async (req, res) => {
  const { name, host, port = 7396 } = req.body;
  
  if (!name || !host) {
    return res.status(400).json({ error: 'Name and host are required' });
  }
  
  const newInstance = {
    id: `instance-${Date.now()}`,
    name,
    host,
    port: parseInt(port) || 7396,
    enabled: true
  };
  
  instances.push(newInstance);
  await saveInstances();
  res.json(newInstance);
});

// Remove an instance
app.delete('/api/instances/:id', async (req, res) => {
  const { id } = req.params;
  const index = instances.findIndex(i => i.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  // Don't allow removing the local instance
  if (instances[index].id === 'local') {
    return res.status(400).json({ error: 'Cannot remove local instance' });
  }
  
  instances.splice(index, 1);
  await saveInstances();
  res.json({ success: true });
});

// Proxy request to a specific FAH instance
app.all('/api/fah/:instanceId/*', async (req, res) => {
  const { instanceId } = req.params;
  const endpoint = req.params[0];
  const instance = instances.find(i => i.id === instanceId);
  
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  if (!instance.enabled) {
    return res.status(400).json({ error: 'Instance is disabled' });
  }
  
  // Handle config command specially (use WebSocket)
  if (endpoint === 'config' && req.method === 'POST') {
    try {
      const { config } = req.body;
      if (!config) {
        return res.status(400).json({ error: 'Config object required' });
      }
      
      const result = await fahWebSocketCommand(instanceId, instance.host, instance.port, 'config', { config });
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(200).json({ 
          error: true, 
          message: result.error || 'Failed to save config',
          connected: false 
        });
      }
      return;
    } catch (error) {
      console.error(`Error saving config for ${instanceId}:`, error);
      res.status(200).json({ 
        error: true, 
        message: error.message,
        connected: false 
      });
      return;
    }
  }
  
  const result = await fahRequest(
    instanceId,
    instance.host,
    instance.port,
    endpoint,
    req.method,
    req.body
  );
  
  if (result.success) {
    res.json(result.data);
  } else {
    // Return 200 with error info instead of 500, so frontend can handle gracefully
    res.status(200).json({ 
      error: true, 
      message: result.error,
      connected: false 
    });
  }
});

// Test FAH instance connectivity
app.get('/api/test/:instanceId', async (req, res) => {
  const { instanceId } = req.params;
  const instance = instances.find(i => i.id === instanceId);
  
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  // Try common FAH API endpoints
  const testEndpoints = [
    'info',
    'slots',
    'queue/0',
    'queue',
    'api/info',
    'api/slots',
    'api/queue/0'
  ];
  
  const results = {};
  for (const endpoint of testEndpoints) {
    const result = await fahRequest(instanceId, instance.host, instance.port, endpoint);
    results[endpoint] = result.success ? 'OK' : result.error;
  }
  
  res.json({
    instance: instance.name,
    host: `${instance.host}:${instance.port}`,
    tests: results
  });
});

// Get aggregated data from all instances
app.get('/api/aggregate/*', async (req, res) => {
  const endpoint = req.params[0];
  const results = {};
  
  const promises = instances
    .filter(i => i.enabled)
    .map(async (instance) => {
      const result = await fahRequest(instance.id, instance.host, instance.port, endpoint);
      return { instanceId: instance.id, instanceName: instance.name, result };
    });
  
  const responses = await Promise.all(promises);
  
  responses.forEach(({ instanceId, instanceName, result }) => {
    results[instanceId] = {
      name: instanceName,
      ...result
    };
  });
  
  res.json(results);
});

// Proxy endpoint for Folding@Home user stats (to bypass CORS)
app.get('/api/stats/user/:username', async (req, res) => {
  const { username } = req.params;
  const { team } = req.query;
  
  try {
    const url = team 
      ? `https://api.foldingathome.org/user/${encodeURIComponent(username)}?team=${team}`
      : `https://api.foldingathome.org/user/${encodeURIComponent(username)}`;
    
    console.log(`[Stats Proxy] Fetching user stats from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors
      }
    });
    
    console.log(`[Stats Proxy] User stats response status: ${response.status}`);
    console.log(`[Stats Proxy] Content-Type: ${response.headers['content-type']}`);
    
    // Check if response is HTML (error page)
    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      console.error('[Stats Proxy] Received HTML instead of JSON, likely an error page');
      return res.status(404).json({ error: 'User not found or stats unavailable' });
    }
    
    // Check if response data is actually an object (JSON)
    if (typeof response.data === 'object' && response.data !== null) {
      res.json(response.data);
    } else {
      console.error('[Stats Proxy] Response is not valid JSON:', typeof response.data);
      res.status(500).json({ error: 'Invalid response format from stats server' });
    }
  } catch (error) {
    console.error('[Stats Proxy] Error fetching user stats:', error.message);
    if (error.response) {
      console.error('[Stats Proxy] Response status:', error.response.status);
      console.error('[Stats Proxy] Response data:', error.response.data);
      res.status(error.response.status).json({ error: error.response.statusText, details: error.response.data });
    } else if (error.request) {
      console.error('[Stats Proxy] No response received');
      res.status(500).json({ error: 'No response from stats server' });
    } else {
      res.status(500).json({ error: 'Failed to fetch user stats', message: error.message });
    }
  }
});

// Proxy endpoint for Folding@Home projects summary (to bypass CORS)
app.get('/api/projects/summary', async (req, res) => {
  try {
    const url = 'https://assign1.foldingathome.org/api/project/summary';
    
    console.log(`[Projects Proxy] Fetching projects summary from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500;
      }
    });
    
    console.log(`[Projects Proxy] Projects summary response status: ${response.status}`);
    console.log(`[Projects Proxy] Content-Type: ${response.headers['content-type']}`);
    
    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      return res.status(404).json({ error: 'Projects summary not available' });
    }
    
    if (typeof response.data === 'object' && response.data !== null) {
      res.json(response.data);
    } else {
      res.status(500).json({ error: 'Invalid response format' });
    }
  } catch (error) {
    console.error('[Projects Proxy] Error fetching projects summary:', error.message);
    if (error.response) {
      res.status(error.response.status).json({ error: error.response.statusText });
    } else {
      res.status(500).json({ error: 'Failed to fetch projects summary', message: error.message });
    }
  }
});

// Proxy endpoint for work unit logged credits
app.get('/api/project/:projectId/run/:run/clone/:clone/gen/:gen', async (req, res) => {
  const { projectId, run, clone, gen } = req.params;
  
  try {
    const url = `https://api.foldingathome.org/project/${projectId}/run/${run}/clone/${clone}/gen/${gen}`;
    
    console.log(`[Credits Proxy] Fetching logged credits from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500; // Don't throw on 4xx errors
      }
    });
    
    // Check if response is HTML (error page)
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      console.log(`[Credits Proxy] Received HTML response (likely 404), returning empty array`);
      return res.json([]);
    }
    
    // Validate JSON response
    if (typeof response.data !== 'object' || response.data === null) {
      console.log(`[Credits Proxy] Invalid JSON response, returning empty array`);
      return res.json([]);
    }
    
    // If it's an array, return it; otherwise wrap in array
    const credits = Array.isArray(response.data) ? response.data : [response.data];
    
    console.log(`[Credits Proxy] Successfully fetched ${credits.length} credit entries`);
    res.json(credits);
    
  } catch (error) {
    console.error(`[Credits Proxy] Error fetching credits:`, error.message);
    res.status(500).json({ error: 'Failed to fetch logged credits', message: error.message });
  }
});

// Proxy endpoint for Extreme Overclocking graph images
app.get('/api/eoc/graph/:type/:period', async (req, res) => {
  const { type, period } = req.params;
  const { userId } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }
  
  try {
    // Map period to filename
    const periodMap = {
      'hour': 'hour',
      'day': 'day',
      'week': 'week',
      'month': 'month',
      'daytotal': 'day_total'
    };
    
    const periodFile = periodMap[period] || 'day';
    const graphParam = type === 'wus' ? '&g=2' : '';
    const url = `https://folding.extremeoverclocking.com/graphs/production_${periodFile}.php?s=&u=${userId}${graphParam}`;
    
    console.log(`[EOC Graph Proxy] Fetching graph from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'image/*',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500;
      }
    });
    
    if (response.status !== 200) {
      return res.status(response.status).json({ error: 'Failed to fetch graph' });
    }
    
    const contentType = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', contentType);
    res.send(response.data);
    
  } catch (error) {
    console.error(`[EOC Graph Proxy] Error fetching graph:`, error.message);
    res.status(500).json({ error: 'Failed to fetch graph', message: error.message });
  }
});

// Proxy endpoint for Extreme Overclocking user stats
app.get('/api/eoc/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const url = `https://folding.extremeoverclocking.com/user_summary.php?s=&u=${userId}`;
    
    console.log(`[EOC Proxy] Fetching user stats from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500; // Don't throw on 4xx errors
      }
    });
    
    if (response.status !== 200) {
      console.log(`[EOC Proxy] Received status ${response.status}`);
      return res.status(response.status).json({ error: 'Failed to fetch EOC stats' });
    }
    
    // Parse HTML to extract stats
    const html = response.data;
    const stats = {};
    
    // Extract main stats table
    const mainStatsMatch = html.match(/<th>Rank<span[^>]*>[\s\S]*?<\/th>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (mainStatsMatch) {
      const cells = mainStatsMatch[1].matchAll(/<td[^>]*align="right"[^>]*>([\s\S]*?)<\/td>/gi);
      const values = [];
      for (const cell of cells) {
        const text = cell[1].replace(/<[^>]*>/g, '').trim();
        values.push(text);
      }
      if (values.length >= 10) {
        stats.rankTeam = parseInt(values[0].replace(/,/g, '')) || 0;
        stats.rankProject = parseInt(values[1].replace(/,/g, '')) || 0;
        stats.points24hrAvg = parseInt(values[2].replace(/,/g, '')) || 0;
        stats.pointsLast24hr = parseInt(values[3].replace(/,/g, '')) || 0;
        stats.pointsLast7days = parseInt(values[4].replace(/,/g, '')) || 0;
        stats.pointsToday = parseInt(values[5].replace(/,/g, '')) || 0;
        stats.pointsWeek = parseInt(values[6].replace(/,/g, '')) || 0;
        stats.totalPoints = parseInt(values[7].replace(/,/g, '')) || 0;
        stats.totalWUs = parseInt(values[8].replace(/,/g, '')) || 0;
        stats.firstRecord = values[9] || 'N/A';
      }
    }
    
    // Extract Conquests and Threats table
    
    const conquestsIndex = html.indexOf('Top 5');
    if (conquestsIndex === -1) {
      console.log(`[EOC Proxy] Could not find "Top 5" in HTML`);
    } else {
      // Get everything after "Top 5"
      const afterConquests = html.substring(conquestsIndex);  
      const searchSection = afterConquests.substring(0, 10000);
      let conquestsTableContent = null;
      
      const bgcolorTableMatch = searchSection.match(/<table[^>]*bgcolor\s*=\s*["']?#C0C0C0["']?[^>]*>([\s\S]*?)<\/table>/i);
      if (bgcolorTableMatch) {
        const outerContent = bgcolorTableMatch[1];
        const innerTableMatch = outerContent.match(/<table[^>]*border\s*=\s*["']?0["']?[^>]*>([\s\S]*?)<\/table>/i);
        if (innerTableMatch && innerTableMatch[1].includes('User')) {
          conquestsTableContent = innerTableMatch[1];
        } else if (outerContent.includes('User') && outerContent.includes('Rank')) {
          conquestsTableContent = outerContent;
        }
      }
      
      // Strategy 2: If strategy 1 failed, find any table after "Top 5" that contains User/Name/Rank
      if (!conquestsTableContent) {
        const allTables = Array.from(searchSection.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi));
        for (const tableMatch of allTables) {
          const content = tableMatch[1];
          // Check if this table has the conquests structure
          if (content.includes('User') && (content.includes('Name') || content.includes('Rank')) && 
              content.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi)?.length > 1) {
            conquestsTableContent = content;
            break;
          }
        }
      }
      
      if (conquestsTableContent) {
        // Extract all rows from the table
        const rowPatterns = [
          /<tr[^>]*class\s*=\s*["']?alt[^"']*["']?[^>]*>([\s\S]*?)<\/tr>/gi,
          /<tr[^>]*>([\s\S]*?)<\/tr>/gi
        ];
        
        let allRows = [];
        for (const pattern of rowPatterns) {
          const matches = Array.from(conquestsTableContent.matchAll(pattern));
          if (matches.length > 0) {
            allRows = matches;
            break;
          }
        }
        
        const conquests = [];
        
        // Process each row (skip header row if it exists)
        for (let i = 0; i < allRows.length; i++) {
          const rowMatch = allRows[i];
          const rowContent = rowMatch[1];
          
          // Skip header rows (contain <th> tags)
          if (rowContent.includes('<th>') || rowContent.includes('<th ')) {
            continue;
          }
          
          // Extract cells from this row
          const cellMatches = Array.from(rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
          
          if (cellMatches.length >= 5) {
            // Extract name (first cell, might be in an <a> tag)
            let name = '';
            const nameCell = cellMatches[0][1];
            const nameLinkMatch = nameCell.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
            if (nameLinkMatch) {
              name = nameLinkMatch[1].replace(/<[^>]*>/g, '').trim();
            } else {
              name = nameCell.replace(/<[^>]*>/g, '').trim();
            }
            
            // Skip if name is empty or looks like a header
            if (!name || name === 'User Name' || name === 'User' || name.includes('Rank')) {
              continue;
            }
            
            // Extract rank diff (second cell)
            const rankDiffText = cellMatches[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
            const rankDiff = rankDiffText === '--' || rankDiffText === '' ? 0 : (parseInt(rankDiffText) || 0);
            
            // Extract points diff (third cell)
            const pointsDiffText = cellMatches[2][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
            const pointsDiff = pointsDiffText === '--' || pointsDiffText === '' ? 0 : (parseInt(pointsDiffText) || 0);
            
            // Extract gain daily (fourth cell)
            const gainDailyText = cellMatches[3][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
            const gainDaily = gainDailyText === '--' || gainDailyText === '' ? 0 : (parseInt(gainDailyText) || 0);
            
            // Extract date overtake (fifth cell)
            let dateOvertake = cellMatches[4][1].replace(/<[^>]*>/g, '').trim();
            if (dateOvertake === '--' || dateOvertake === '') {
              dateOvertake = null;
            }
            
            conquests.push({
              name,
              rankDiff,
              pointsDiff,
              gainDaily,
              dateOvertake
            });
          }
        }
        
        if (conquests.length > 0) {
          stats.conquests = conquests;
          console.log(`[EOC Proxy] Successfully extracted ${conquests.length} conquests/threats entries`);
        } else {
          console.log(`[EOC Proxy] Found conquests table structure but extracted 0 data rows (found ${allRows.length} total rows)`);
        }
      } else {
        console.log(`[EOC Proxy] Found "Top 5" but could not find conquests table after it`);
        console.log(`[EOC Proxy] Search section preview (first 500 chars): ${searchSection.substring(0, 500)}`);
      }
    }
    
    // Extract Monthly Production table
    const monthlyMatch = html.match(/<th[^>]*>Monthly Production<\/th>[\s\S]*?<tr[^>]*>[\s\S]*?<th[^>]*>Month<\/th>[\s\S]*?<\/tr>([\s\S]*?)<\/table>/i);
    if (monthlyMatch) {
      const tableHtml = monthlyMatch[1];
      const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*class="alt[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi));
      const monthly = [];
      
      for (const rowMatch of rowMatches) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
        if (cells.length >= 3) {
          monthly.push({
            month: cells[0][1].replace(/<[^>]*>/g, '').trim(),
            points: parseInt(cells[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0,
            wus: parseInt(cells[2][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0
          });
        }
      }
      if (monthly.length > 0) {
        stats.monthlyProduction = monthly;
      }
    }
    
    // Extract Weekly Production table
    const weeklyMatch = html.match(/<th[^>]*>Weekly Production<\/th>[\s\S]*?<tr[^>]*>[\s\S]*?<th[^>]*>Week<\/th>[\s\S]*?<\/tr>([\s\S]*?)<\/table>/i);
    if (weeklyMatch) {
      const tableHtml = weeklyMatch[1];
      const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*class="alt[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi));
      const weekly = [];
      
      for (const rowMatch of rowMatches) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
        if (cells.length >= 3) {
          weekly.push({
            week: cells[0][1].replace(/<[^>]*>/g, '').trim(),
            points: parseInt(cells[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0,
            wus: parseInt(cells[2][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0
          });
        }
      }
      if (weekly.length > 0) {
        stats.weeklyProduction = weekly;
      }
    }
    
    // Extract Daily Production table
    const dailyMatch = html.match(/<th[^>]*>Daily Production<\/th>[\s\S]*?<tr[^>]*>[\s\S]*?<th[^>]*>Day<\/th>[\s\S]*?<\/tr>([\s\S]*?)<\/table>/i);
    if (dailyMatch) {
      const tableHtml = dailyMatch[1];
      const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*class="alt[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi));
      const daily = [];
      
      for (const rowMatch of rowMatches) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
        if (cells.length >= 3) {
          daily.push({
            day: cells[0][1].replace(/<[^>]*>/g, '').trim(),
            points: parseInt(cells[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0,
            wus: parseInt(cells[2][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0
          });
        }
      }
      if (daily.length > 0) {
        stats.dailyProduction = daily;
      }
    }
    
    // Extract Hourly Production table
    const hourlyMatch = html.match(/<th[^>]*>Hourly Production<\/th>[\s\S]*?<tr[^>]*>[\s\S]*?<th[^>]*>Time<\/th>[\s\S]*?<\/tr>([\s\S]*?)<\/table>/i);
    if (hourlyMatch) {
      const tableHtml = hourlyMatch[1];
      const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*class="alt[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi));
      const hourly = [];
      
      for (const rowMatch of rowMatches) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
        if (cells.length >= 3) {
          hourly.push({
            time: cells[0][1].replace(/<[^>]*>/g, '').trim(),
            points: parseInt(cells[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0,
            wus: parseInt(cells[2][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim()) || 0
          });
        }
      }
      if (hourly.length > 0) {
        stats.hourlyProduction = hourly;
      }
    }
    
    // Graph URLs
    stats.graphUrls = {
      points: {
        hourly: `https://folding.extremeoverclocking.com/graphs/production_hour.php?s=&u=${userId}`,
        daily: `https://folding.extremeoverclocking.com/graphs/production_day.php?s=&u=${userId}`,
        weekly: `https://folding.extremeoverclocking.com/graphs/production_week.php?s=&u=${userId}`,
        monthly: `https://folding.extremeoverclocking.com/graphs/production_month.php?s=&u=${userId}`,
        dailyTotal: `https://folding.extremeoverclocking.com/graphs/production_day_total.php?s=&u=${userId}`
      },
      wus: {
        hourly: `https://folding.extremeoverclocking.com/graphs/production_hour.php?s=&u=${userId}&g=2`,
        daily: `https://folding.extremeoverclocking.com/graphs/production_day.php?s=&u=${userId}&g=2`,
        weekly: `https://folding.extremeoverclocking.com/graphs/production_week.php?s=&u=${userId}&g=2`,
        monthly: `https://folding.extremeoverclocking.com/graphs/production_month.php?s=&u=${userId}&g=2`,
        dailyTotal: `https://folding.extremeoverclocking.com/graphs/production_day_total.php?s=&u=${userId}&g=2`
      }
    };
    
    console.log(`[EOC Proxy] Successfully parsed stats for user ${userId}`);
    res.json(stats);
    
  } catch (error) {
    console.error(`[EOC Proxy] Error fetching EOC stats:`, error.message);
    res.status(500).json({ error: 'Failed to fetch EOC stats', message: error.message });
  }
});

app.get('/api/project/:projectId', async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const url = `https://api.foldingathome.org/project/${projectId}`;
    
    console.log(`[Project Proxy] Fetching project details from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors
      }
    });
    
    console.log(`[Project Proxy] Project ${projectId} response status: ${response.status}`);
    console.log(`[Project Proxy] Content-Type: ${response.headers['content-type']}`);
    
    // Check if response is HTML (error page)
    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      console.error('[Project Proxy] Received HTML instead of JSON, likely an error page');
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if response data is actually an object (JSON)
    if (typeof response.data === 'object' && response.data !== null) {
      res.json(response.data);
    } else {
      console.error('[Project Proxy] Response is not valid JSON:', typeof response.data);
      res.status(500).json({ error: 'Invalid response format from API server' });
    }
  } catch (error) {
    console.error(`[Project Proxy] Error fetching project ${projectId}:`, error.message);
    if (error.response) {
      console.error('[Project Proxy] Response status:', error.response.status);
      console.error('[Project Proxy] Response data:', error.response.data);
      res.status(error.response.status).json({ error: error.response.statusText, details: error.response.data });
    } else if (error.request) {
      console.error('[Project Proxy] No response received');
      res.status(500).json({ error: 'No response from API server' });
    } else {
      res.status(500).json({ error: 'Failed to fetch project details', message: error.message });
    }
  }
});

// Proxy endpoint for Folding@Home team stats (to bypass CORS)
app.get('/api/stats/team/:teamNumber', async (req, res) => {
  const { teamNumber } = req.params;
  
  try {
    const url = `https://api.foldingathome.org/team/${teamNumber}`;
    
    console.log(`[Stats Proxy] Fetching team stats from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Folding@Home-Control/1.0'
      },
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors
      }
    });
    
    console.log(`[Stats Proxy] Team stats response status: ${response.status}`);
    console.log(`[Stats Proxy] Content-Type: ${response.headers['content-type']}`);
    
    // Check if response is HTML (error page)
    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      console.error('[Stats Proxy] Received HTML instead of JSON, likely an error page');
      return res.status(404).json({ error: 'Team not found or stats unavailable' });
    }
    
    // Check if response data is actually an object (JSON)
    if (typeof response.data === 'object' && response.data !== null) {
      res.json(response.data);
    } else {
      console.error('[Stats Proxy] Response is not valid JSON:', typeof response.data);
      res.status(500).json({ error: 'Invalid response format from stats server' });
    }
  } catch (error) {
    console.error(`[Stats Proxy] Error fetching team stats for ${teamNumber}:`, error.message);
    if (error.response) {
      console.error('[Stats Proxy] Response status:', error.response.status);
      console.error('[Stats Proxy] Response data:', error.response.data);
      res.status(error.response.status).json({ error: error.response.statusText, details: error.response.data });
    } else if (error.request) {
      console.error('[Stats Proxy] No response received');
      res.status(500).json({ error: 'No response from stats server' });
    } else {
      res.status(500).json({ error: 'Failed to fetch team stats', message: error.message });
    }
  }
});

// Serve favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize server
async function startServer() {
  // Load saved instances
  await loadInstances();
  
  server.listen(PORT, () => {
    console.log(`Folding@Home Control Server running on http://localhost:${PORT}`);
    console.log(`Default local instance: 127.0.0.1:7396`);
    console.log(`Loaded ${instances.length} instance(s) (${instances.filter(i => i.id !== 'local').length} remote)`);
    console.log(`Note: Make sure Folding@Home client is running and accessible`);
    console.log(`Using WebSocket protocol for FAH v8.4 clients`);
  });
}

startServer();



