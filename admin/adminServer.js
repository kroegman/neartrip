/**
 * Admin server for NearTRIP
 * Provides a web interface for managing stations and viewing connections
 */
const express = require('express');
const basicAuth = require('express-basic-auth');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const configManager = require('../utils/config');

// Store active connections for the admin interface
const activeConnections = new Map();

/**
 * Initialize the admin server
 * 
 * @param {Object} options - Options for the admin server
 * @param {number} options.port - Port to listen on
 * @param {string} options.username - Username for basic auth
 * @param {string} options.password - Password for basic auth
 * @returns {express.Application} The Express app
 */
function initAdminServer(options = {}) {
    const { 
        port = 3000, 
        username = 'admin', 
        password = 'admin'
    } = options;

    const app = express();

    // Enable logging
    app.use(morgan('dev'));

    // Parse JSON bodies
    app.use(express.json());

    // Enable CORS
    app.use(cors());

    // Basic authentication
    app.use(basicAuth({
        users: { [username]: password },
        challenge: true,
        realm: 'NearTRIP Admin'
    }));

    // Serve static files from the admin/public directory
    const publicPath = path.join(__dirname, 'public');
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath, { recursive: true });
    }
    app.use(express.static(publicPath));

    // API endpoints
    setupApiRoutes(app);

    // Start server
    const server = app.listen(port, () => {
        logger.info(`Admin server started on http://localhost:${port}`);
    });

    return { app, server };
}

/**
 * Set up API routes for admin interface
 * 
 * @param {express.Application} app - Express app
 */
function setupApiRoutes(app) {
    // Get all stations
    app.get('/api/stations', (req, res) => {
        try {
            const config = configManager.getConfig();
            res.json(config.stations);
        } catch (error) {
            logger.error('Error fetching stations:', error);
            res.status(500).json({ error: 'Failed to fetch stations' });
        }
    });

    // Add a new station
    app.post('/api/stations', (req, res) => {
        try {
            const newStation = req.body;
            
            // Validate required fields
            if (!newStation.mountPoint || !newStation.casterHost || 
                !newStation.casterPort || !newStation.latitude || !newStation.longitude) {
                return res.status(400).json({ error: 'Missing required station fields' });
            }

            const config = configManager.getConfig();
            
            // Check for duplicate mountPoint
            const exists = config.stations.some(s => s.mountPoint === newStation.mountPoint);
            if (exists) {
                return res.status(400).json({ error: 'Station with this mount point already exists' });
            }

            // Set active to true by default if not specified
            if (newStation.active === undefined) {
                newStation.active = true;
            }

            // Add the new station
            config.stations.push(newStation);
            
            // Save the updated config
            saveConfig(config);
            
            res.status(201).json(newStation);
        } catch (error) {
            logger.error('Error adding station:', error);
            res.status(500).json({ error: 'Failed to add station' });
        }
    });

    // Update a station
    app.put('/api/stations/:mountPoint', (req, res) => {
        try {
            const { mountPoint } = req.params;
            const updatedStation = req.body;
            
            const config = configManager.getConfig();
            
            // Find the station index
            const index = config.stations.findIndex(s => s.mountPoint === mountPoint);
            if (index === -1) {
                return res.status(404).json({ error: 'Station not found' });
            }

            // Update the station
            config.stations[index] = updatedStation;
            
            // Save the updated config
            saveConfig(config);
            
            res.json(updatedStation);
        } catch (error) {
            logger.error('Error updating station:', error);
            res.status(500).json({ error: 'Failed to update station' });
        }
    });

    // Delete a station
    app.delete('/api/stations/:mountPoint', (req, res) => {
        try {
            const { mountPoint } = req.params;
            
            const config = configManager.getConfig();
            
            // Find the station index
            const index = config.stations.findIndex(s => s.mountPoint === mountPoint);
            if (index === -1) {
                return res.status(404).json({ error: 'Station not found' });
            }

            // Remove the station
            const removedStation = config.stations.splice(index, 1)[0];
            
            // Save the updated config
            saveConfig(config);
            
            res.json(removedStation);
        } catch (error) {
            logger.error('Error deleting station:', error);
            res.status(500).json({ error: 'Failed to delete station' });
        }
    });    // Get active connections
    app.get('/api/connections', (req, res) => {
        try {
            const connections = Array.from(activeConnections.values());
            res.json(connections);
        } catch (error) {
            logger.error('Error fetching connections:', error);
            res.status(500).json({ error: 'Failed to fetch connections' });
        }
    });
    
    // Get server info
    app.get('/api/info', (req, res) => {
        try {
            const config = configManager.getConfig();
            const { username, password, adminPassword, ...safeConfig } = config;
            res.json({
                version: require('../package.json').version,
                config: safeConfig,
                uptime: Math.floor(process.uptime()),
                memoryUsage: process.memoryUsage(),
                nodeVersion: process.version
            });
        } catch (error) {
            logger.error('Error fetching server info:', error);
            res.status(500).json({ error: 'Failed to fetch server info' });
        }
    });

    // Get full configuration
    app.get('/api/config', (req, res) => {
        try {
            const config = configManager.getConfig();
            res.json(config);
        } catch (error) {
            logger.error('Error fetching configuration:', error);
            res.status(500).json({ error: 'Failed to fetch configuration' });
        }
    });

    // Update configuration
    app.put('/api/config', (req, res) => {
        try {
            const newConfig = req.body;
            
            // Validate required fields
            if (!newConfig.mountPoint || !newConfig.stations || !Array.isArray(newConfig.stations)) {
                return res.status(400).json({ error: 'Invalid configuration format' });
            }
            
            // Save the new config
            saveConfig(newConfig);
            
            // Get the updated config to return (without sensitive info)
            const config = configManager.getConfig();
            const { adminPassword, ...safeConfig } = config;
            
            res.json(safeConfig);
        } catch (error) {
            logger.error('Error updating configuration:', error);
            res.status(500).json({ error: 'Failed to update configuration' });
        }
    });

    // Reset configuration to defaults
    app.post('/api/config/reset', (req, res) => {
        try {
            // Reset config to default values
            configManager.resetToDefaultConfig();
            
            // Get the updated config to return (without sensitive info)
            const config = configManager.getConfig();
            const { adminPassword, ...safeConfig } = config;
            
            res.json(safeConfig);
        } catch (error) {
            logger.error('Error resetting configuration:', error);
            res.status(500).json({ error: 'Failed to reset configuration' });
        }
    });

    // Reload configuration from disk
    app.post('/api/reload', (req, res) => {
        try {
            // Reload config from disk
            const config = configManager.reloadConfig();
            
            // Return the reloaded config (without sensitive info)
            const { adminPassword, ...safeConfig } = config;
            
            res.json(safeConfig);
        } catch (error) {
            logger.error('Error reloading configuration:', error);
            res.status(500).json({ error: 'Failed to reload configuration' });
        }
    });
}

/**
 * Save the configuration to disk
 * 
 * @param {Object} config - The configuration to save
 */
function saveConfig(config) {
    const configPath = configManager.CONFIG_FILE_PATH;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    logger.info('Configuration saved successfully');
}

/**
 * Track a new client connection
 * 
 * @param {string} id - Unique ID for the connection
 * @param {Object} connectionInfo - Information about the connection
 */
function trackConnection(id, connectionInfo) {
    activeConnections.set(id, {
        id,
        connectedAt: new Date().toISOString(),
        ...connectionInfo,
        bytesSent: 0,
        bytesReceived: 0
    });
    logger.debug(`Tracking connection: ${id}`);
}

/**
 * Update an existing connection
 * 
 * @param {string} id - Unique ID for the connection
 * @param {Object} updates - Updated information about the connection
 */
function updateConnection(id, updates) {
    if (activeConnections.has(id)) {
        const connection = activeConnections.get(id);
        activeConnections.set(id, { ...connection, ...updates });
    }
}

/**
 * Remove a connection from tracking
 * 
 * @param {string} id - Unique ID for the connection
 */
function removeConnection(id) {
    if (activeConnections.has(id)) {
        activeConnections.delete(id);
        logger.debug(`Removed connection: ${id}`);
    }
}

module.exports = {
    initAdminServer,
    trackConnection,
    updateConnection,
    removeConnection
};
