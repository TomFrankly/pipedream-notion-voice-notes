export default {
    name: "Property Loading Test",
    description: "A test component to understand Pipedream's property loading behavior",
    key: "property-loading-test",
    version: "0.0.12",
    type: "action",
    props: {
        // Initial property that will trigger reloads
        service: {
            type: "string",
            label: "Service",
            description: "Select a service to see how properties load",
            options: [
                {
                    label: "OpenAI",
                    value: "openai"
                },
                {
                    label: "Anthropic",
                    value: "anthropic"
                }
            ],
            reloadProps: true
        },
        sendToNotion: {
            type: "boolean",
            label: "Send to Notion",
            description: "Enable to send the transcription to Notion",
            default: false,
            reloadProps: true
        }
    },
    async additionalProps(previousPropDefs) {
        console.log("=== additionalProps called ===");
        console.log("this.service:", this.service);
        console.log("this.sendToNotion:", this.sendToNotion);
        console.log("previousPropDefs:", previousPropDefs);
        
        // Start with previous props
        let props = { ...previousPropDefs };
        
        // Log the current state of this
        console.log("Current this context:", {
            service: this.service,
            hasOpenAI: this.openai !== undefined,
            hasAnthropic: this.anthropic !== undefined,
            openaiValue: this.openai,
            anthropicValue: this.anthropic,
            openaiKeys: this.openai ? Object.keys(this.openai) : [],
            anthropicKeys: this.anthropic ? Object.keys(this.anthropic) : [],
            sendToNotion: this.sendToNotion,
            hasNotion: this.notion !== undefined
        });

        // Helper function to check if an app is truly configured
        const isAppConfigured = (app) => {
            if (!app) return false;
            const keys = Object.keys(app);
            
            // Check for auth configuration
            if (keys.includes('$auth')) {
                const auth = app.$auth;
                // Check if auth has actual configuration data
                const hasApiKey = auth && Object.keys(auth).length > 0 && auth.api_key;
                const hasOAuth = auth && Object.keys(auth).length > 0 && auth.oauth_access_token;
                const isConfigured = hasApiKey || hasOAuth;
                console.log("Auth check result:", { 
                    auth, 
                    isConfigured,
                    hasApiKey,
                    hasOAuth,
                    authKeys: auth ? Object.keys(auth) : []
                });
                return isConfigured;
            }
            
            // Check for other configuration data
            return keys.length > 0;
        };

        // Handle OpenAI properties
        if (this.service === "openai") {
            console.log("Adding OpenAI properties");
            props.openai = {
                type: "app",
                app: "openai",
                description: "This is OpenAI's app property. After this loads, you should see OpenAI's model options.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };

            // Only add model options if openai is truly configured
            const isConfigured = isAppConfigured(this.openai);
            console.log("OpenAI configuration check:", { 
                openai: this.openai, 
                isConfigured,
                hasModel: props.model !== undefined 
            });

            if (isConfigured) {
                console.log("Adding OpenAI model options");
                props.model = {
                    type: "string",
                    label: "OpenAI Model",
                    description: "This should appear after OpenAI is configured",
                    options: [
                        "gpt-4.1-nano",
                        "gpt-4.1-mini",
                        "gpt-4.1",
                        "gpt-4o-mini",
                        "gpt-4o"
                    ],
                    hidden: false,
                    disabled: false
                };
            } else {
                console.log("OpenAI is not fully configured yet:", this.openai);
                // Ensure model is removed if it exists
                delete props.model;
            }

            // Hide and disable Anthropic properties if they exist
            if (props.anthropic) {
                console.log("Hiding and disabling Anthropic properties");
                props.anthropic.hidden = true;
                props.anthropic.disabled = true;
            }
        }

        // Handle Anthropic properties
        if (this.service === "anthropic") {
            console.log("Adding Anthropic properties");
            props.anthropic = {
                type: "app",
                app: "anthropic",
                description: "This is Anthropic's app property. After this loads, you should see Anthropic's model options.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };

            // Only add model options if anthropic is truly configured
            const isConfigured = isAppConfigured(this.anthropic);
            console.log("Anthropic configuration check:", { 
                anthropic: this.anthropic, 
                isConfigured,
                hasModel: props.model !== undefined 
            });

            if (isConfigured) {
                console.log("Adding Anthropic model options");
                props.model = {
                    type: "string",
                    label: "Anthropic Model",
                    description: "This should appear after Anthropic is configured",
                    options: [
                        "claude-3-5-haiku-latest",
                        "claude-3-5-sonnet-latest"
                    ],
                    hidden: false,
                    disabled: false
                };
            } else {
                console.log("Anthropic is not fully configured yet:", this.anthropic);
                // Ensure model is removed if it exists
                delete props.model;
            }

            // Hide and disable OpenAI properties if they exist
            if (props.openai) {
                console.log("Hiding and disabling OpenAI properties");
                props.openai.hidden = true;
                props.openai.disabled = true;
            }
        }

        // Handle Notion properties
        if (this.sendToNotion) {
            console.log("Adding Notion properties");
            props.notion = {
                type: "app",
                app: "notion",
                description: "Configure your Notion account to send transcriptions",
                reloadProps: true,
                hidden: false,
                disabled: false
            };

            // Only add database ID if Notion is configured
            const isNotionConfigured = isAppConfigured(this.notion);
            console.log("Notion configuration check:", {
                notion: this.notion,
                isConfigured: isNotionConfigured
            });

            if (isNotionConfigured) {
                console.log("Adding Notion database ID property");
                props.databaseId = {
                    type: "string",
                    label: "Notion Database ID",
                    description: "The ID of the Notion database to send transcriptions to",
                    hidden: false,
                    disabled: false
                };
            } else {
                console.log("Notion is not fully configured yet");
                delete props.databaseId;
            }
        } else {
            // Hide and disable Notion properties if they exist
            if (props.notion) {
                console.log("Hiding and disabling Notion properties");
                props.notion.hidden = true;
                props.notion.disabled = true;
            }
            delete props.databaseId;
        }

        // If no service is selected, hide and disable all service-specific properties
        if (!this.service) {
            console.log("No service selected, hiding all service properties");
            if (props.openai) {
                props.openai.hidden = true;
                props.openai.disabled = true;
            }
            if (props.anthropic) {
                props.anthropic.hidden = true;
                props.anthropic.disabled = true;
            }
            if (props.model) {
                props.model.hidden = true;
                props.model.disabled = true;
            }
        }

        // Add a debug property that shows the current state
        props.debug_state = {
            type: "string",
            label: "Debug State",
            description: "This shows the current state of properties",
            default: JSON.stringify({
                service: this.service,
                hasOpenAI: this.openai !== undefined,
                hasAnthropic: this.anthropic !== undefined,
                openaiValue: this.openai,
                anthropicValue: this.anthropic,
                openaiKeys: this.openai ? Object.keys(this.openai) : [],
                anthropicKeys: this.anthropic ? Object.keys(this.anthropic) : [],
                isOpenAIConfigured: isAppConfigured(this.openai),
                isAnthropicConfigured: isAppConfigured(this.anthropic),
                openaiHidden: props.openai?.hidden,
                anthropicHidden: props.anthropic?.hidden,
                modelHidden: props.model?.hidden,
                hasModel: props.model !== undefined,
                sendToNotion: this.sendToNotion,
                hasNotion: this.notion !== undefined,
                isNotionConfigured: isAppConfigured(this.notion),
                notionHidden: props.notion?.hidden,
                hasDatabaseId: props.databaseId !== undefined
            }, null, 2)
        };

        console.log("Returning props:", props);
        return props;
    },
    async run({ steps, $ }) {
        console.log("=== run called ===");
        console.log("Final state:", {
            service: this.service,
            hasOpenAI: this.openai !== undefined,
            hasAnthropic: this.anthropic !== undefined,
            model: this.model,
            sendToNotion: this.sendToNotion,
            hasNotion: this.notion !== undefined,
            databaseId: this.databaseId
        });
        
        return {
            message: "Test completed",
            state: {
                service: this.service,
                hasOpenAI: this.openai !== undefined,
                hasAnthropic: this.anthropic !== undefined,
                model: this.model,
                sendToNotion: this.sendToNotion,
                hasNotion: this.notion !== undefined,
                databaseId: this.databaseId
            }
        };
    }
};
