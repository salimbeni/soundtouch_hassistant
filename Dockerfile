FROM python:3.11-slim

# Install system dependencies if any (none currently needed for python-bosesoundtouchapi)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Environment variables
ENV PORT=5001

# Expose port
EXPOSE 5001

# Run the application
CMD ["python", "app.py"]
