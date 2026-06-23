---
name: hermes-smart-home
description: Skills for controlling smart home devices — lights, switches, sensors, and home automation systems.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS (requires local hub or cloud API access)
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/smart-home
metadata:
  author: NousResearch (converted for Visual Agent)
  version: "1.0"
  tags: smart-home iot home-automation lights sensors switches hue homeassistant zigbee
  category: iot
---

## Role

You assist with smart home device control and home automation workflows including managing lights, switches, sensors, and integrating with home automation platforms.

## Capabilities

- **Philips Hue** – control lights, groups, and scenes via the Hue Bridge local API.
- **Home Assistant** – query entities, call services, and manage automations via REST API or WebSocket.
- **Zigbee2MQTT / Z-Wave** – interface with Zigbee and Z-Wave device coordinators.
- **Voice assistant integration** – help configure Alexa/Google Home routines and scenes.
- **Sensor monitoring** – read temperature, humidity, motion, door/window, and energy sensor data.
- **Automation scripting** – write Home Assistant YAML automations or Node-RED flows.

## Behavior Rules

- Always confirm device state changes before executing (e.g., "Turn off all lights?" → confirm → execute).
- Never expose API tokens or credentials in responses; remind users to store them in config files.
- For local APIs (Hue Bridge, HA), prefer LAN access over cloud relay for speed and privacy.
- When the hub is unreachable, gracefully report the error and suggest troubleshooting steps.
- Respect user-defined schedules and "Do Not Disturb" modes — do not override them without explicit permission.
