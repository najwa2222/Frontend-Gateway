# Stage 1: Build stage
FROM node:18 AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Build the application (optional step, if you want to transpile or bundle files)
# RUN npm run build   # Uncomment if there's a build script

# Stage 2: Production stage
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install dependencies in the runtime image
COPY --from=build /app /app

# Expose the port the app runs on
EXPOSE 3000

# Set environment variable
ENV NODE_ENV=production

# Start the application
CMD ["node", "app.js"]
