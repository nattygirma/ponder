# Notion Migration Guide

Thanks to Ponder's native support for AI Agent and Model Context Protocol (MCP), if you want to migrate your Notion workspace to Ponder, the most elegant way is to use your AI assistant as a bridge. By mounting both the **Notion MCP** and **Ponder MCP** servers, you can achieve fully automatic cloud-to-cloud page migration.

---

### Migration Steps

#### Step 1: Install and Enable Both MCP Servers in Your AI Assistant

1. **Configure Notion MCP**:
   Set up the Notion MCP server in your AI assistant (e.g., Claude Code, Cursor, WorkBuddy, Cline). Once configured, the AI assistant will be authorized to read your Notion Pages and Databases.

2. **Configure Ponder MCP**:
   - Log in to your Ponder instance, and click **Profile** -> **MCP settings**.
   - Generate an API Token, click **Copy full MCP configuration**, and set it up in your AI assistant.

Make sure your AI assistant can access and call both MCP servers simultaneously.

#### Step 2: Prompt the AI Assistant to Start the Migration

Copy and send the following prompt to the AI assistant that has access to both MCPs:

```text
You are my AI assistant. You are currently connected to both my Notion MCP server and my new Ponder MCP server.
Please help me migrate my Pages and Databases from Notion to Ponder:
1. Call the Notion MCP tools to read my Notion page content (including titles, body content, creation time, tags, etc.) in batches.
2. Call the Ponder MCP tools to write them into my new Ponder instance.
Please report the total number of successfully imported pages and if any page translation failed.
```

The AI assistant will automatically parse and convert Notion's Block format and call the Ponder write tools to complete the data transfer.

#### Step 3: Verify in Web Browser
Go back to your Ponder web client and refresh the page to confirm that all Notion pages have been successfully recorded, and that their formatting and tags are synchronized.
