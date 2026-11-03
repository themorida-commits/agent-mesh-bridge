# Optional: pass these in the MCP server's `env` block (or export them) when your
# installs differ from the defaults. Shown for Claude-style JSON configs:
#
#   "agent-mesh": {
#     "command": "node",
#     "args": ["/Users/YOUR_USERNAME/agent-bridges/agent-mesh-mcp.js"],
#     "env": {
#       "AGENT_MESH_GHOSTEX_BIN": "/opt/homebrew/bin/ghostex",
#       "AGENT_MESH_BRIDGE_DIR": "/Users/YOUR_USERNAME/agent-bridges"
#     }
#   }
export AGENT_MESH_CODEG_CLI="/Applications/Codeg.app/Contents/MacOS/codeg-cli"
export AGENT_MESH_GHOSTEX_BIN="/opt/homebrew/bin/ghostex"
export AGENT_MESH_ZCODE_BIN="$HOME/.local/bin/zcode"
export AGENT_MESH_BRIDGE_DIR="$HOME/agent-bridges"
