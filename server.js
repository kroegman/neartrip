/**
 * NearTRIP Server - An NTRIP proxy that connects to the nearest base station
 * 
 * This server acts as an NTRIP server to clients and as an NTRIP client to upstream casters.
 * It automatically connects to the closest NTRIP mount point based on the client's location.
 * 
 * @module server
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gps = require('./utils/gps');
const ntrip = require('./utils/ntrip');
const logger = require('./utils/logger');
const configManager = require('./utils/config');
const { NTRIP, FILES, HTTP } = require('./utils/constants');
const adminServer = require('./admin/adminServer');

// Load configuration
let config;
try {
    config = configManager.getConfig();
    logger.info('Configuration loaded successfully');
} catch (error) {
    logger.error('Failed to load configuration:', error);
    console.error('Error: Could not load config.json. Please ensure it exists and is valid JSON.');
    process.exit(1);
}

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Handle client requests and route to appropriate handlers
 * 
 * @param {net.Socket} clientSocket - The client socket connection
 */
function handleClient(clientSocket) {
    let casterSocket = null;
    let clientIp = clientSocket.remoteAddress;
    let clientPort = clientSocket.remotePort;
    
    // Generate a unique ID for this connection
    const connectionId = crypto.randomUUID();
    
    // Track the connection in admin interface
    adminServer.trackConnection(connectionId, {
        clientIp: clientIp,
        clientPort: clientPort,
        latitude: null,
        longitude: null,
        currentStation: null
    });
    
    logger.info(`Client connected from ${clientIp}:${clientPort} [${connectionId}]`);    // Track data received from client
    let receivedBytes = 0;
    clientSocket.on('data', async (data) => {
        // Update received bytes count
        receivedBytes += data.length;
        adminServer.updateConnection(connectionId, { bytesReceived: receivedBytes });
        
        const request = data.toString().trim();

        try {
            // Handle NTRIP sourcetable request
            if (request.startsWith(NTRIP.REQUEST_TYPES.ROOT)) {
                logger.debug(`Sourcetable request from ${clientIp}:${clientPort}`);
                const response = ntrip.generateSourcetableResponse(config.mountPoint);
                clientSocket.write(response);
                clientSocket.end();
                return;
            } 
              // Handle GPGGA location data
            else if (request.startsWith(NTRIP.REQUEST_TYPES.GPGGA)) {
                handleGpggaRequest(request, clientSocket, casterSocket, connectionId)
                    .then(newCasterSocket => {
                        casterSocket = newCasterSocket;
                    })
                    .catch(error => {
                        logger.error(`Error handling GPGGA request: ${error.message}`);
                    });
            }
            
            // Handle mountpoint request
            else if (request.startsWith(`${NTRIP.REQUEST_TYPES.MOUNTPOINT}${config.mountPoint}`)) {
                logger.info(`Client connected to mountpoint: ${config.mountPoint}`);
                clientSocket.write(`${HTTP.RESPONSE_TYPES.ICY} ${HTTP.OK_STATUS} ${HTTP.OK_MESSAGE}\r\n\r\n`);
            } 
            
            // Handle unknown requests
            else {
                logger.warn(`Unknown request from ${clientIp}:${clientPort}: ${request.substring(0, 100)}`);
                clientSocket.end();
            }
        } catch (error) {
            logger.error(`Error processing client request: ${error.message}`);
            clientSocket.end();
        }
    });    clientSocket.on('end', () => {
        logger.info(`Client disconnected: ${clientIp}:${clientPort} [${connectionId}]`);
        if (casterSocket) {
            logger.debug('Closing caster connection');
            casterSocket.end();
        }
        
        // Remove connection from tracking
        adminServer.removeConnection(connectionId);
    });

    clientSocket.on('error', (error) => {
        logger.error(`Client socket error (${clientIp}:${clientPort} [${connectionId}]):`, error);
        clientSocket.end();
        if (casterSocket) {
            casterSocket.end();
        }
        
        // Remove connection from tracking
        adminServer.removeConnection(connectionId);
    });
}

/**
 * Handle GPGGA NMEA sentence from client
 * 
 * @param {string} request - The GPGGA request string
 * @param {net.Socket} clientSocket - The client socket
 * @param {net.Socket} currentCasterSocket - The current caster socket (if any)
 * @param {string} connectionId - The unique ID for this connection
 * @returns {Promise<net.Socket>} The new or existing caster socket
 */
async function handleGpggaRequest(request, clientSocket, currentCasterSocket, connectionId) {
    // Log NMEA message
    const nmeaLogPath = path.join(logsDir, 'nmea.log');
    fs.appendFile(nmeaLogPath, request + '\n', (err) => {
        if (err) {
            logger.error('Failed to write to NMEA log:', err);
        }
    });
      // Parse GPGGA message
    const nmeaMessage = gps.parseGPGGA(request);

    if (!nmeaMessage || !nmeaMessage.latitude || !nmeaMessage.longitude) {
        logger.warn('Invalid or incomplete GPGGA message');
        return currentCasterSocket;
    }
    
    const user_lat = nmeaMessage.latitude;
    const user_lon = nmeaMessage.longitude;

    logger.info(`User location: ${user_lat.toFixed(6)}, ${user_lon.toFixed(6)}`);
    
    // Update connection tracking with current location
    adminServer.updateConnection(connectionId, {
        latitude: user_lat,
        longitude: user_lon
    });

    // Find closest station
    const closestStation = gps.findClosestStation(user_lat, user_lon, config.stations);

    if (!closestStation) {
        logger.warn('No suitable station found');
        return currentCasterSocket;
    }

    // Check if we need to connect to a new station
    if (!currentCasterSocket || 
        currentCasterSocket.mountPoint !== closestStation.mountPoint || 
        currentCasterSocket.destroyed) {
        
        if (currentCasterSocket) {
            logger.debug(`Closing connection to ${currentCasterSocket.mountPoint}`);
            currentCasterSocket.end();
        }

        logger.info(`Connecting to closest station: ${closestStation.mountPoint} (${closestStation.distance} meters away)`);

        try {
            const newCasterSocket = await ntrip.connectToNtripCaster(
                closestStation.casterHost,
                closestStation.casterPort,
                closestStation.mountPoint,
                closestStation.username,
                closestStation.password,
                config.userAgent
            );            // Store mountPoint on socket for reference
            newCasterSocket.mountPoint = closestStation.mountPoint;
            
            // Update connection tracking with current station
            adminServer.updateConnection(connectionId, {
                currentStation: closestStation.mountPoint
            });
            
            // Track data transfer for admin interface
            let sentBytes = 0;
            let receivedBytes = 0;
            
            // Forward data from caster to client
            newCasterSocket.on('data', (data) => {
                if (clientSocket && !clientSocket.destroyed) {
                    clientSocket.write(data);
                    sentBytes += data.length;
                    
                    // Update bytes sent in admin interface
                    adminServer.updateConnection(connectionId, {
                        bytesSent: sentBytes
                    });
                }
            });

            // Handle caster errors
            newCasterSocket.on('error', (error) => {
                logger.error(`Caster socket error (${closestStation.mountPoint}):`, error);
                newCasterSocket.end();
            });

            // Handle caster connection end
            newCasterSocket.on('end', () => {
                logger.info(`Caster connection ended: ${closestStation.mountPoint}`);
            });

            return newCasterSocket;
        } catch (error) {
            logger.error(`Failed to connect to caster ${closestStation.mountPoint}:`, error);
            return currentCasterSocket;
        }
    }

    return currentCasterSocket;
}

/**
 * Handle configuration changes
 * 
 * @param {Object} newConfig - The new configuration
 */
function handleConfigChange(newConfig) {
    logger.info('Configuration has been updated');
    config = newConfig;
    logger.info(`Mount point: ${config.mountPoint}`);
    logger.info(`Available stations: ${config.stations.length}`);
}

/**
 * Manually reload the configuration
 * 
 * @returns {Object} The new configuration
 */
function reloadConfiguration() {
    try {
        const newConfig = configManager.reloadConfig();
        handleConfigChange(newConfig);
        return newConfig;
    } catch (error) {
        logger.error('Failed to reload configuration:', error);
        throw error;
    }
}

/**
 * Start the NTRIP server
 */
function startServer() {
    const server = net.createServer(handleClient);

    // Handle server errors
    server.on('error', (error) => {
        logger.error('Server error:', error);
        process.exit(1);
    });

    // Start listening
    server.listen(config.port, config.interface, () => {
        logger.info(`NearTRIP server started on ${config.interface}:${config.port}`);
        logger.info(`Mount point: ${config.mountPoint}`);
        logger.info(`Available stations: ${config.stations.length}`);
        
        // Set up config file watcher
        configManager.watchConfig(configManager.CONFIG_FILE_PATH, handleConfigChange);
        logger.info('Configuration file watcher started');
        
        // Start admin interface
        const adminPort = config.adminPort || 3000;
        const adminUser = config.adminUsername || 'admin';
        const adminPass = config.adminPassword || 'admin';
        
        adminServer.initAdminServer({
            port: adminPort,
            username: adminUser,
            password: adminPass
        });
        
        logger.info(`Admin interface available at http://localhost:${adminPort}`);
    });

    return server;
}

// Handle process termination gracefully
process.on('SIGINT', () => {
    logger.info('Received SIGINT. Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Shutting down...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

// Export for testing
module.exports = {
    startServer
};
