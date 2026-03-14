#!/bin/bash
# GPIO Dashboard Agent Installer for Raspberry Pi
# Run as: bash install.sh

set -e

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

echo "=== GPIO Dashboard Agent Installer ==="
echo ""

# 1. Update apt cache
echo "[1/5] Updating package cache..."
$SUDO apt-get update -qq

# 2. Install Python packages
echo "[2/5] Installing Python dependencies..."
PACKAGES="python3-gpiod python3-websockets"

# python3-rpi-lgpio may not exist on all distros; install if available
if apt-cache show python3-rpi-lgpio &>/dev/null; then
    PACKAGES="$PACKAGES python3-rpi-lgpio"
fi

$SUDO apt-get install -y -qq $PACKAGES

# 3. Ensure pinctrl is available (provided by raspi-utils or raspberrypi-utils)
echo "[3/5] Checking for pinctrl..."
if ! command -v pinctrl &>/dev/null; then
    if apt-cache show raspi-utils &>/dev/null; then
        $SUDO apt-get install -y -qq raspi-utils
    elif apt-cache show raspberrypi-utils &>/dev/null; then
        $SUDO apt-get install -y -qq raspberrypi-utils
    else
        echo "  WARNING: pinctrl not found and raspi-utils package unavailable."
        echo "  GPIO monitoring will be limited."
    fi
else
    echo "  pinctrl already installed."
fi

# 4. Add user to gpio group
echo "[4/5] Checking gpio group membership..."
if getent group gpio &>/dev/null; then
    if ! id -nG "$USER" | grep -qw gpio; then
        $SUDO usermod -aG gpio "$USER"
        echo "  Added $USER to gpio group (re-login required)."
    else
        echo "  $USER already in gpio group."
    fi
else
    echo "  gpio group does not exist, skipping."
fi

# 5. Done
echo "[5/5] Installation complete!"
echo ""
echo "To start the agent:"
echo "  python3 $(dirname "$0")/agent.py"
echo ""
echo "The agent will listen on ws://0.0.0.0:8765"
echo "Set AGENT_HOST and AGENT_PORT environment variables to customize."
echo ""

# Uncomment below to install as a systemd service:
# cat <<'SERVICE' | $SUDO tee /etc/systemd/system/gpio-dashboard-agent.service
# [Unit]
# Description=GPIO Dashboard Agent
# After=network.target
#
# [Service]
# Type=simple
# User=pi
# WorkingDirectory=/home/pi/gpio-dashboard/pi-agent
# ExecStart=/usr/bin/python3 /home/pi/gpio-dashboard/pi-agent/agent.py
# Restart=on-failure
# RestartSec=5
#
# [Install]
# WantedBy=multi-user.target
# SERVICE
# $SUDO systemctl daemon-reload
# $SUDO systemctl enable gpio-dashboard-agent
# $SUDO systemctl start gpio-dashboard-agent
# echo "Systemd service installed and started."
