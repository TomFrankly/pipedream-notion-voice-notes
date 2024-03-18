/* -- Imports -- */

// In progress

// Clients
import { Client } from "@notionhq/client"; // Notion SDK

export default {
    type: "app",
    app: "notion",
    propDefinitions: {
        databaseId: {
            type: "string",
            label: "Database",
            description: "The Notion Database ID ([API Reference](https://developers.notion.com/reference/retrieve-a-database))",
            async options({prevContext}) {

            }
        }
    }
}