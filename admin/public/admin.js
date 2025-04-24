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
            tableBody.innerHTML = '<tr><td colspan="10" class="text-center">No active connections</td></tr>';
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
                <td>${getFixQualityText(conn.fixQuality)}</td>
                <td>${conn.numSatellites !== undefined ? conn.numSatellites : '-'}</td>
                <td>${formatBytes(conn.bytesSent)}</td>
                <td>${formatBytes(conn.bytesReceived)}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading connections:', error);
        document.querySelector('#connectionsTable tbody').innerHTML = `
            <tr><td colspan="10" class="text-center text-danger">Error loading connections: ${error.message}</td></tr>
        `;
    }
    
    // Update map with new client positions if map is initialized
    if (map) {
        updateClientMarkers();
    }
}

/**
 * Convert a fix quality number to descriptive text
 * 
 * @param {number|undefined} fixQuality - GPS fix quality value (0-8)
 * @returns {string} Human-readable fix quality description
 */
function getFixQualityText(fixQuality) {
    if (fixQuality === undefined || fixQuality === null) return '-';
    
    switch (parseInt(fixQuality, 10)) {
        case 0: return 'Invalid';
        case 1: return 'GPS Fix';
        case 2: return 'DGPS Fix';
        case 3: return 'PPS Fix';
        case 4: return 'RTK Fix';
        case 5: return 'Float RTK';
        case 6: return 'Estimated';
        case 7: return 'Manual';
        case 8: return 'Simulation';
        default: return `Unknown (${fixQuality})`;
    }
}

/**
 * Generate a formatted uptime string
 * 
 * @param {number} uptime - Server uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(uptime) {
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
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
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g. "1.5 MB")
 */
function formatBytes(bytes) {
    if (bytes === 0 || bytes === undefined) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format memory usage
 * 
 * @param {Object} memoryUsage - Node.js memory usage object
 * @returns {string} Formatted memory usage string
 */
function formatMemoryUsage(memoryUsage) {
    return `${formatBytes(memoryUsage.rss)} / ${formatBytes(memoryUsage.heapTotal)}`;
}

/**
 * Format a timestamp
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted time string
 */
function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Initialize the map
 */
function initMap() {
    // Create a map centered around a default location
    map = L.map('mapContainer').setView([37.7749, -122.4194], 5);
    
    // Add the OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Update the map with station and client markers
    updateMap();
}

/**
 * Update the map with all markers
 */
function updateMap() {
    updateStationMarkers();
    updateClientMarkers();
}

/**
 * Update the station markers on the map
 */
async function updateStationMarkers() {
    try {
        const response = await fetch('/api/stations');
        if (!response.ok) throw new Error('Failed to fetch stations');
        
        const stations = await response.json();
        
        // Clear existing station markers
        stationMarkers.forEach(marker => marker.remove());
        stationMarkers = [];
        
        // Add markers for each station
        stations.forEach(station => {
            if (station.latitude && station.longitude) {
                const marker = L.marker([station.latitude, station.longitude], {
                    icon: L.divIcon({
                        className: station.active ? 'marker-station-active' : 'marker-station-inactive',
                        html: `<div class="marker-icon"></div>`,
                        iconSize: [20, 20]
                    })
                }).addTo(map);
                
                marker.bindPopup(`
                    <strong>${station.mountPoint}</strong><br>
                    ${station.casterHost}:${station.casterPort}<br>
                    Status: ${station.active ? 'Active' : 'Inactive'}
                `);
                
                stationMarkers.push(marker);
            }
        });
    } catch (error) {
        console.error('Error updating station markers:', error);
    }
}

/**
 * Update the client markers on the map
 */
async function updateClientMarkers() {
    try {
        const response = await fetch('/api/connections');
        if (!response.ok) throw new Error('Failed to fetch connections');
        
        const connections = await response.json();
        
        // Clear existing client markers
        clientMarkers.forEach(marker => marker.remove());
        clientMarkers = [];
        
        // Add markers for each client
        connections.forEach(conn => {
            if (conn.latitude && conn.longitude) {
                const marker = L.marker([conn.latitude, conn.longitude], {
                    icon: L.divIcon({
                        className: 'marker-client',
                        html: `<div class="marker-icon"></div>`,
                        iconSize: [20, 20]
                    })
                }).addTo(map);
                
                // Include fix quality and satellites in the popup
                marker.bindPopup(`
                    <strong>Client ID:</strong> ${conn.id.substring(0, 8)}...<br>
                    <strong>IP:</strong> ${conn.clientIp}<br>
                    <strong>Current Station:</strong> ${conn.currentStation || '-'}<br>
                    <strong>Fix Quality:</strong> ${getFixQualityText(conn.fixQuality)}<br>
                    <strong>Satellites:</strong> ${conn.numSatellites !== undefined ? conn.numSatellites : '-'}<br>
                    <strong>Data Sent:</strong> ${formatBytes(conn.bytesSent)}<br>
                    <strong>Data Received:</strong> ${formatBytes(conn.bytesReceived)}
                `);
                
                clientMarkers.push(marker);
            }
        });
    } catch (error) {
        console.error('Error updating client markers:', error);
    }
}

// Additional functions in your admin.js file...
