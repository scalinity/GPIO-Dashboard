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

INSTALL_USER="${SUDO_USER:-$USER}"

# 1. Update apt cache
echo "[1/5] Updating package cache..."
if ! $SUDO apt-get update -qq; then
    echo "ERROR: Failed to update package cache."
    exit 1
fi

# 2. Install Python packages
echo "[2/5] Installing Python dependencies..."
PACKAGES="python3-libgpiod python3-websockets python3-venv"

# python3-rpi-lgpio may not exist on all distros; install if available
if apt-cache show python3-rpi-lgpio &>/dev/null; then
    PACKAGES="$PACKAGES python3-rpi-lgpio"
fi

if ! $SUDO apt-get install -y -qq $PACKAGES; then
    echo "ERROR: Failed to install Python packages."
    exit 1
fi

# The agent needs the libgpiod 2 Python API. Trixie's apt binding is 2.x; Bookworm's is 1.6.3, so
# gpiod 2 goes into a venv here that still sees apt's packages, and the app starts the agent with it.
if ! python3 -c 'import gpiod, sys; sys.exit(not hasattr(gpiod, "request_lines"))' 2>/dev/null; then
    echo "  apt's gpiod binding is 1.x; installing gpiod 2 into $(pwd)/venv..."
    if ! { python3 -m venv --system-site-packages venv && venv/bin/pip install -q 'gpiod>=2,<3'; }; then
        rm -rf venv
        echo "  WARNING: gpiod 2 could not be installed. Board Sense and line-usage info are unavailable."
    fi
fi

# Programs import RPi.GPIO or gpiozero, and on a Pi 5 both drive pins through lgpio. Where apt has
# none (Kali, Debian), rpi-lgpio goes into the venv, which Run on Pi uses when it exists. lgpio's
# SWIG interface still calls Python 2's PyInt and PyString functions, which SWIG 4.3 stopped
# mapping to Python 3, so the build maps the four it uses.
if ! python3 -c 'import lgpio' 2>/dev/null && ! venv/bin/python3 -c 'import lgpio' 2>/dev/null; then
    echo "  No lgpio for Python; installing rpi-lgpio into $(pwd)/venv..."
    $SUDO apt-get install -y -qq swig python3-dev gcc >/dev/null 2>&1 || true
    had_venv=$([ -d venv ] && echo 1 || echo 0)
    if ! { [ -x venv/bin/python3 ] || python3 -m venv --system-site-packages venv; } ||
        ! CFLAGS="-DPyInt_FromLong=PyLong_FromLong -DPyInt_AsLong=PyLong_AsLong -DPyInt_Check=PyLong_Check -DPyString_FromString=PyUnicode_FromString" \
            venv/bin/pip install -q rpi-lgpio; then
        [ "$had_venv" = 0 ] && rm -rf venv
        echo "  WARNING: rpi-lgpio could not be installed. Programs that import RPi.GPIO or gpiozero cannot drive pins on a Pi 5."
    fi
fi

# 3. Ensure pinctrl is available (provided by raspi-utils or raspberrypi-utils)
echo "[3/5] Checking for pinctrl..."
if ! command -v pinctrl &>/dev/null; then
    if apt-cache show raspi-utils &>/dev/null; then
        if ! $SUDO apt-get install -y -qq raspi-utils; then
            echo "ERROR: Failed to install raspi-utils."
            exit 1
        fi
    elif apt-cache show raspberrypi-utils &>/dev/null; then
        if ! $SUDO apt-get install -y -qq raspberrypi-utils; then
            echo "ERROR: Failed to install raspberrypi-utils."
            exit 1
        fi
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
    if ! id -nG "$INSTALL_USER" | grep -qw gpio; then
        $SUDO usermod -aG gpio "$INSTALL_USER"
        echo "  Added $INSTALL_USER to gpio group (re-login required)."
    else
        echo "  $INSTALL_USER already in gpio group."
    fi
else
    echo "  gpio group does not exist, skipping."
fi

# 5. Done
echo "[5/5] Installation complete!"
echo ""
echo "To start the agent:"
echo "  $([ -x venv/bin/python3 ] && echo "$(pwd)/venv/bin/python3" || echo python3) $(pwd)/agent.py"
echo ""
echo "The agent will listen on ws://127.0.0.1:8765"
echo "It listens on loopback only; the dashboard connects through the SSH session."
echo "Set AGENT_PORT to change the port."
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
