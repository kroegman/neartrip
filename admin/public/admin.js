/**
 * NearTRIP Admin Dashboard JavaScript
 */

// Global variables for UI elements
const stationModal = new bootstrap.Modal(document.getElementById('stationModal'));
let refreshInterval;

// Map variables
let map = null;
let stationMarkers = [];
let clientMarkers = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Initial data load
    loadServerInfo();
    loadStations();
    loadConnections();
    
    // Initialize map
    initMap();    // Set up periodic refresh (every 5 seconds)
    refreshInterval = setInterval(() => {
        loadConnections();
        
        // Only refresh server info and don't auto-refresh the config editor
        // This prevents overwriting user edits in the config
        updateServerInfoWithoutConfigRefresh();
    }, 5000);

    // Setup event listeners
    setupEventListeners();
});

/**
 * Set up event listeners for all interactive elements
 */
function setupEventListeners() {    // Add station button
    document.getElementById('addStationBtn').addEventListener('click', () => {
        document.getElementById('formAction').value = 'add';
        document.getElementById('modalTitle').textContent = 'Add Station';
        document.getElementById('stationForm').reset();
        stationModal.show();
    });

    // Save station button
    document.getElementById('saveStationBtn').addEventListener('click', saveStation);

    // Reload config button
    document.getElementById('reloadConfigBtn').addEventListener('click', reloadConfig);
    
    // Config editor buttons
    document.getElementById('saveConfigBtn').addEventListener('click', saveFullConfig);
    document.getElementById('cancelConfigBtn').addEventListener('click', loadConfigEditor);
    document.getElementById('resetConfigBtn').addEventListener('click', resetToDefaultConfig);// Navigation links
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            
            // Hide all sections
            document.querySelectorAll('#stations, #connections, #map, #settings').forEach(section => {
                section.style.display = 'none';
            });
            
            // Show target section
            document.getElementById(targetId).style.display = 'block';
            
            // Update active nav link
            document.querySelectorAll('.navbar-nav .nav-link').forEach(navLink => {
                navLink.classList.remove('active');
            });
            this.classList.add('active');
            
            // Refresh map if showing map view
            if (targetId === 'map' && map) {
                map.invalidateSize();
                updateMap();
            }
        });
    });
}

/**
 * Load server information
 */
async function loadServerInfo() {
    try {
        const response = await fetch('/api/info');
        if (!response.ok) throw new Error('Failed to fetch server info');
        
        const data = await response.json();
        
        // Format and display server information
        const uptime = formatUptime(data.uptime);
        const memoryUsage = formatMemoryUsage(data.memoryUsage);
        
        document.getElementById('serverInfo').innerHTML = `
            <strong>NearTRIP v${data.version}</strong> | 
            Node ${data.nodeVersion} | 
            Uptime: ${uptime} | 
            Memory: ${memoryUsage} | 
            Mount Point: ${data.config.mountPoint} | 
            Stations: ${data.config.stations.length}
        `;
        
        // Load config editor if we're on the settings tab
        if (document.getElementById('settings').style.display !== 'none') {
            loadConfigEditor();
        }
    } catch (error) {
        console.error('Error loading server info:', error);
        document.getElementById('serverInfo').innerHTML = `
            <strong>Error:</strong> Could not load server information. ${error.message}
        `;
    }
}

/**
 * Load stations list 
 */
async function loadStations() {
    try {
        const response = await fetch('/api/stations');
        if (!response.ok) throw new Error('Failed to fetch stations');
        
        const stations = await response.json();
        
        const tableBody = document.querySelector('#stationsTable tbody');
        tableBody.innerHTML = '';
        
        if (stations.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No stations configured</td></tr>';
            return;
        }
        
        stations.forEach(station => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <span class="status-indicator ${station.active ? 'status-active' : 'status-inactive'}" 
                          title="${station.active ? 'Active' : 'Inactive'}"></span>
                </td>
                <td>${station.mountPoint}</td>
                <td>${station.casterHost}</td>
                <td>${station.casterPort}</td>
                <td>${station.latitude.toFixed(6)}</td>
                <td>${station.longitude.toFixed(6)}</td>
                <td>
                    <button class="btn btn-sm btn-primary edit-btn" data-mount="${station.mountPoint}">Edit</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-mount="${station.mountPoint}">Delete</button>
                </td>
            `;
            tableBody.appendChild(row);
            
            // Add event listeners for the edit and delete buttons
            row.querySelector('.edit-btn').addEventListener('click', () => editStation(station));
            row.querySelector('.delete-btn').addEventListener('click', () => deleteStation(station.mountPoint));
        });
    } catch (error) {
        console.error('Error loading stations:', error);
        document.querySelector('#stationsTable tbody').innerHTML = `
            <tr><td colspan="7" class="text-center text-danger">Error loading stations: ${error.message}</td></tr>
        `;
    }
}

/**
 * Load active connections
 */
async function loadConnections() {
    try {
        const response = await fetch('/api/connections');
        if (!response.ok) throw new Error('Failed to fetch connections');
        
        const connections = await response.json();
        
        const tableBody = document.querySelector('#connectionsTable tbody');
        tableBody.innerHTML = '';
        
        if (connections.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center">No active connections</td></tr>';
            return;
        }
        
        connections.forEach(conn => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${conn.id.substring(0, 8)}...</td>
                <td>${conn.clientIp}</td>
                <td>${formatTimestamp(conn.connectedAt)}</td>
                <td>${conn.currentStation || '-'}</td>
                <td>${conn.latitude ? conn.latitude.toFixed(6) : '-'}</td>
                <td>${conn.longitude ? conn.longitude.toFixed(6) : '-'}</td>
                <td>${formatBytes(conn.bytesSent)}</td>
                <td>${formatBytes(conn.bytesReceived)}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading connections:', error);
        document.querySelector('#connectionsTable tbody').innerHTML = `
            <tr><td colspan="8" class="text-center text-danger">Error loading connections: ${error.message}</td></tr>
        `;
    }
}

/**
 * Open the edit station modal
 * 
 * @param {Object} station - Station to edit
 */
function editStation(station) {
    document.getElementById('formAction').value = 'edit';
    document.getElementById('modalTitle').textContent = 'Edit Station';
    document.getElementById('originalMountPoint').value = station.mountPoint;
    
    // Fill the form with station data
    document.getElementById('mountPoint').value = station.mountPoint;
    document.getElementById('casterHost').value = station.casterHost;
    document.getElementById('casterPort').value = station.casterPort;
    document.getElementById('stationUsername').value = station.username || '';
    document.getElementById('stationPassword').value = station.password || '';
    document.getElementById('latitude').value = station.latitude;
    document.getElementById('longitude').value = station.longitude;
    document.getElementById('active').checked = station.active !== false;
    
    stationModal.show();
}

/**
 * Save station (add or edit)
 */
async function saveStation() {
    try {
        const formAction = document.getElementById('formAction').value;
        const originalMountPoint = document.getElementById('originalMountPoint').value;
        
        const station = {
            mountPoint: document.getElementById('mountPoint').value,
            casterHost: document.getElementById('casterHost').value,
            casterPort: parseInt(document.getElementById('casterPort').value),
            username: document.getElementById('stationUsername').value,
            password: document.getElementById('stationPassword').value,
            latitude: parseFloat(document.getElementById('latitude').value),
            longitude: parseFloat(document.getElementById('longitude').value),
            active: document.getElementById('active').checked
        };
        
        let url = '/api/stations';
        let method = 'POST';
        
        if (formAction === 'edit') {
            url = `/api/stations/${originalMountPoint}`;
            method = 'PUT';
        }
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(station)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save station');
        }
        
        // Success - close modal and reload stations
        stationModal.hide();
        loadStations();
        
        // Show success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show';
        alertDiv.innerHTML = `
            <strong>Success!</strong> Station ${formAction === 'add' ? 'added' : 'updated'} successfully.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.navbar'));
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Error saving station:', error);
        alert(`Error saving station: ${error.message}`);
    }
}

/**
 * Delete a station
 * 
 * @param {string} mountPoint - Mount point of the station to delete
 */
async function deleteStation(mountPoint) {
    if (!confirm(`Are you sure you want to delete the station "${mountPoint}"?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/stations/${mountPoint}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete station');
        }
        
        // Success - reload stations
        loadStations();
        
        // Show success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show';
        alertDiv.innerHTML = `
            <strong>Success!</strong> Station "${mountPoint}" deleted successfully.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.navbar'));
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Error deleting station:', error);
        alert(`Error deleting station: ${error.message}`);
    }
}

/**
 * Reload server configuration
 */
async function reloadConfig() {
    try {
        const response = await fetch('/api/reload', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to reload configuration');
        }
        
        // Success - reload data
        loadServerInfo();        loadStations();
        
        // Show success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show';
        alertDiv.innerHTML = `
            <strong>Success!</strong> Configuration reloaded successfully.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.navbar'));
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
        
        // Update map
        updateMap();
        
    } catch (error) {
        console.error('Error reloading configuration:', error);
        alert(`Error reloading configuration: ${error.message}`);
    }
}

/**
 * Load and display the full configuration in the editor
 */
async function loadConfigEditor() {
    try {
        const response = await fetch('/api/fullconfig');
        if (!response.ok) throw new Error('Failed to fetch full configuration');
        
        const config = await response.json();
        
        // Pretty print the JSON with 4 spaces indentation
        document.getElementById('configEditor').value = JSON.stringify(config, null, 4);
    } catch (error) {
        console.error('Error loading configuration editor:', error);
        alert(`Error loading configuration: ${error.message}`);
    }
}

/**
 * Save the full configuration from the editor
 */
async function saveFullConfig() {
    try {
        const configText = document.getElementById('configEditor').value;
        
        // Validate JSON
        let config;
        try {
            config = JSON.parse(configText);
        } catch (error) {
            alert(`Invalid JSON: ${error.message}`);
            return;
        }
        
        // Comprehensive validation
        const validationErrors = validateConfiguration(config);
        
        if (validationErrors.length > 0) {
            alert(`Configuration validation failed:\n\n${validationErrors.join('\n')}`);
            return;
        }
          // Send the updated config
        const response = await fetch('/api/fullconfig', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: configText
        });
        
        // Handle validation errors from server
        if (!response.ok) {
            const errorData = await response.json();
            
            if (errorData.validationErrors) {
                // Show validation errors in a more readable format
                alert(`Server validation failed:\n\n${errorData.validationErrors.join('\n')}\n\nPlease correct these issues and try again.`);
                return;
            } else {
                throw new Error(errorData.error || 'Failed to save configuration');
            }
        }
        
        // Show success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show';
        alertDiv.innerHTML = `
            <strong>Success!</strong> Configuration saved successfully.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.navbar'));
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
        
        // Reload all data
        loadServerInfo();
        loadStations();
        updateMap();
    } catch (error) {
        console.error('Error saving configuration:', error);
        alert(`Error saving configuration: ${error.message}`);
    }
}

/**
 * Reset to default configuration
 */
async function resetToDefaultConfig() {
    if (!confirm('Are you sure you want to reset to the default configuration? This will remove all stations and reset all settings.')) {
        return;
    }
    
    try {
        const defaultConfig = {
            username: "",
            password: "",
            interface: "0.0.0.0",
            port: 2101,
            mountPoint: "NEAR-Default",
            userAgent: "NearTRIP/1.0",
            adminPort: 3000,
            adminUsername: "admin",
            adminPassword: "admin",
            stations: []
        };
        
        // Display in editor
        document.getElementById('configEditor').value = JSON.stringify(defaultConfig, null, 4);
        
        // Save the default config
        await saveFullConfig();
    } catch (error) {
        console.error('Error resetting configuration:', error);
        alert(`Error resetting configuration: ${error.message}`);
    }
}

/**
 * Format uptime in a human-readable format
 * 
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Format bytes to human-readable format
 * 
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted bytes
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format memory usage information
 * 
 * @param {Object} memory - Memory usage object
 * @returns {string} Formatted memory usage
 */
function formatMemoryUsage(memory) {
    return formatBytes(memory.rss);
}

/**
 * Format ISO timestamp to readable format
 * 
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

/**
 * Initialize the map
 */
function initMap() {
    try {
        map = L.map('mapContainer').setView([37.5, -122.0], 9);
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);
        
        // Initial update
        updateMap();
        
        // Update map when window is resized
        window.addEventListener('resize', () => {
            if (map) {
                map.invalidateSize();
            }
        });
    } catch (error) {
        console.error('Error initializing map:', error);
    }
}

/**
 * Update the map with stations and client connections
 */
async function updateMap() {
    if (!map) return;
    
    try {
        // Get current data
        const stationsResponse = await fetch('/api/stations');
        const connectionsResponse = await fetch('/api/connections');
        
        if (!stationsResponse.ok || !connectionsResponse.ok) {
            throw new Error('Failed to fetch data for map');
        }
        
        const stations = await stationsResponse.json();
        const connections = await connectionsResponse.json();
        
        // Clear existing markers
        clearMapMarkers();
        
        // Add station markers
        addStationMarkers(stations);
        
        // Add client markers
        addClientMarkers(connections);
        
        // Fit bounds if we have markers
        if (stationMarkers.length > 0 || clientMarkers.length > 0) {
            const allMarkers = [...stationMarkers, ...clientMarkers];
            const bounds = L.featureGroup(allMarkers).getBounds();
            
            // Only fit bounds if we have valid bounds with real coordinates
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    } catch (error) {
        console.error('Error updating map:', error);
    }
}

/**
 * Clear all markers from the map
 */
function clearMapMarkers() {
    // Remove station markers
    stationMarkers.forEach(marker => {
        marker.remove();
    });
    stationMarkers = [];
    
    // Remove client markers
    clientMarkers.forEach(marker => {
        marker.remove();
    });
    clientMarkers = [];
}

/**
 * Add station markers to the map
 * 
 * @param {Array} stations - Array of station objects
 */
function addStationMarkers(stations) {
    stations.forEach(station => {
        if (!station.latitude || !station.longitude) return;
        
        // Create marker icon
        const markerIcon = L.divIcon({
            className: 'station-marker',
            html: `<div class="status-indicator ${station.active !== false ? 'status-active' : 'status-inactive'}" style="width: 24px; height: 24px;"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        // Create marker
        const marker = L.marker([station.latitude, station.longitude], { icon: markerIcon });
        
        // Create popup content
        const popupContent = `
            <div class="map-popup">
                <h5>${station.mountPoint}</h5>
                <p><strong>Host:</strong> ${station.casterHost}:${station.casterPort}</p>
                <p><strong>Location:</strong> ${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}</p>
                <p><strong>Status:</strong> ${station.active !== false ? 'Active' : 'Inactive'}</p>
            </div>
        `;
        
        // Add popup to marker
        marker.bindPopup(popupContent);
        
        // Add marker to map
        marker.addTo(map);
        
        // Store marker
        stationMarkers.push(marker);
    });
}

/**
 * Add client connection markers to the map
 * 
 * @param {Array} connections - Array of connection objects
 */
function addClientMarkers(connections) {
    connections.forEach(conn => {
        if (!conn.latitude || !conn.longitude) return;
        
        // Create marker icon
        const markerIcon = L.divIcon({
            className: 'client-marker',
            html: '<div class="status-indicator" style="width: 16px; height: 16px; background-color: #2196F3;"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        
        // Create marker
        const marker = L.marker([conn.latitude, conn.longitude], { icon: markerIcon });
        
        // Get time connected
        const connectedDate = new Date(conn.connectedAt);
        const now = new Date();
        const connectedTime = formatTimeDifference(now - connectedDate);
        
        // Create popup content
        const popupContent = `
            <div class="map-popup">
                <h5>Client: ${conn.id.substring(0, 8)}...</h5>
                <p><strong>IP:</strong> ${conn.clientIp}</p>
                <p><strong>Connected:</strong> ${connectedTime} ago</p>
                <p><strong>Location:</strong> ${conn.latitude.toFixed(6)}, ${conn.longitude.toFixed(6)}</p>
                <p><strong>Station:</strong> ${conn.currentStation || 'None'}</p>
                <p><strong>Data:</strong> Sent: ${formatBytes(conn.bytesSent)}, Received: ${formatBytes(conn.bytesReceived)}</p>
            </div>
        `;
        
        // Add popup to marker
        marker.bindPopup(popupContent);
        
        // Add marker to map
        marker.addTo(map);
        
        // Store marker
        clientMarkers.push(marker);
    });
}

/**
 * Format time difference in a human-readable format
 * 
 * @param {number} ms - Time difference in milliseconds
 * @returns {string} Formatted time difference
 */
function formatTimeDifference(ms) {
    const seconds = Math.floor(ms / 1000);
    
    if (seconds < 60) {
        return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ${seconds % 60}s`;
    }
    
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

/**
 * Clean up when page is unloaded
 */
window.addEventListener('beforeunload', () => {
    // Clear the refresh interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});

/**
 * Validate the configuration
 * 
 * @param {Object} config - Configuration to validate
 * @returns {Array} Array of validation error messages, empty if valid
 */
function validateConfiguration(config) {
    const errors = [];
    
    // Required top-level fields
    if (!config.port) {
        errors.push('Missing required field: port');
    } else if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
        errors.push('Port must be a number between 1 and 65535');
    }
    
    if (!config.mountPoint) {
        errors.push('Missing required field: mountPoint');
    } else if (typeof config.mountPoint !== 'string' || config.mountPoint.trim() === '') {
        errors.push('Mount point must be a non-empty string');
    }
    
    if (!config.interface) {
        errors.push('Missing required field: interface');
    } else if (typeof config.interface !== 'string') {
        errors.push('Interface must be a string');
    }
    
    // Validate admin settings if present
    if (config.adminPort !== undefined) {
        if (typeof config.adminPort !== 'number' || config.adminPort < 1 || config.adminPort > 65535) {
            errors.push('Admin port must be a number between 1 and 65535');
        }
        
        // Check for port conflict
        if (config.adminPort === config.port) {
            errors.push('Admin port cannot be the same as the main port');
        }
    }
    
    // Validate stations array
    if (!Array.isArray(config.stations)) {
        errors.push('Stations must be an array');
    } else {
        // Track mountPoints to ensure uniqueness
        const mountPoints = new Set();
        
        // Validate each station
        config.stations.forEach((station, index) => {
            if (!station.mountPoint) {
                errors.push(`Station #${index + 1} is missing required field: mountPoint`);
            } else if (typeof station.mountPoint !== 'string' || station.mountPoint.trim() === '') {
                errors.push(`Station #${index + 1} has invalid mountPoint: must be a non-empty string`);
            } else if (mountPoints.has(station.mountPoint)) {
                errors.push(`Duplicate mount point: ${station.mountPoint}`);
            } else {
                mountPoints.add(station.mountPoint);
            }
            
            if (!station.casterHost) {
                errors.push(`Station #${index + 1} is missing required field: casterHost`);
            } else if (typeof station.casterHost !== 'string' || station.casterHost.trim() === '') {
                errors.push(`Station #${index + 1} has invalid casterHost: must be a non-empty string`);
            }
            
            if (!station.casterPort) {
                errors.push(`Station #${index + 1} is missing required field: casterPort`);
            } else if (typeof station.casterPort !== 'number' || station.casterPort < 1 || station.casterPort > 65535) {
                errors.push(`Station #${index + 1} has invalid casterPort: must be a number between 1 and 65535`);
            }
            
            if (!station.latitude && station.latitude !== 0) {
                errors.push(`Station #${index + 1} is missing required field: latitude`);
            } else if (typeof station.latitude !== 'number' || station.latitude < -90 || station.latitude > 90) {
                errors.push(`Station #${index + 1} has invalid latitude: must be a number between -90 and 90`);
            }
            
            if (!station.longitude && station.longitude !== 0) {
                errors.push(`Station #${index + 1} is missing required field: longitude`);
            } else if (typeof station.longitude !== 'number' || station.longitude < -180 || station.longitude > 180) {
                errors.push(`Station #${index + 1} has invalid longitude: must be a number between -180 and 180`);
            }
            
            // active is optional but must be boolean if provided
            if (station.active !== undefined && typeof station.active !== 'boolean') {
                errors.push(`Station #${index + 1} has invalid active: must be a boolean`);
            }
        });
    }
    
    return errors;
}

/**
 * Update server info without refreshing the config editor
 * This allows us to keep the server info updated without overwriting config edits
 */
async function updateServerInfoWithoutConfigRefresh() {
    try {
        const response = await fetch('/api/info');
        if (!response.ok) throw new Error('Failed to fetch server info');
        
        const data = await response.json();
        
        // Format and display server information
        const uptime = formatUptime(data.uptime);
        const memoryUsage = formatMemoryUsage(data.memoryUsage);
        
        document.getElementById('serverInfo').innerHTML = `
            <strong>NearTRIP v${data.version}</strong> | 
            Node ${data.nodeVersion} | 
            Uptime: ${uptime} | 
            Memory: ${memoryUsage} | 
            Mount Point: ${data.config.mountPoint} | 
            Stations: ${data.config.stations.length}
        `;
        
        // Note: We specifically do NOT call loadConfigEditor() here
        // This allows the user to edit the configuration without it being
        // automatically refreshed and overwritten
    } catch (error) {
        console.error('Error updating server info:', error);
        // Don't update the serverInfo display when there's an error
        // This prevents showing error messages that quickly disappear
    }
}
