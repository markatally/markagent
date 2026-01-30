# Manus Agent Sandbox Image
# Isolated execution environment for user code
FROM node:20-slim

# Install common development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    curl \
    wget \
    git \
    unzip \
    # Build tools
    build-essential \
    python3 \
    python3-pip \
    # Editors
    vim \
    nano \
    # Network tools (limited use when network disabled)
    dnsutils \
    # Process tools
    procps \
    htop \
    && rm -rf /var/lib/apt/lists/*

# Install Bun runtime
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install common Python packages
RUN pip3 install --no-cache-dir --break-system-packages \
    requests \
    numpy \
    pandas \
    pytest

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Create non-root user for better security
RUN useradd -m -s /bin/bash manus
RUN chown -R manus:manus /workspace

# Switch to non-root user
USER manus

# Set environment variables
ENV HOME=/workspace
ENV USER=manus

# Default command (keep container running)
CMD ["sleep", "infinity"]
