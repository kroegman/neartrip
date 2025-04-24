FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose the NTRIP port and Admin UI port
EXPOSE 2101 3000

# Start the application
CMD ["npm", "start"]
