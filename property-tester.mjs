import { Client } from "@notionhq/client";
import common from "./helpers/common.mjs";
import translation from "./helpers/translate-transcript.mjs";
import openaiOptions from "./helpers/openai-options.mjs";

export default {
    name: "Notion Voice Notes Property Test",
    description: "A test component for Notion Voice Notes property configuration",
    key: "notion-voice-notes-property-test",
    version: "0.0.14",
    type: "action",
    props: {
        // Initial service selection properties
        transcription_service: {
            type: "string",
            label: "Transcription Service",
            description: "Choose the service to use for transcription.",
            options: [
                { label: "OpenAI (Whisper, ChatGPT)", value: "OpenAI" },
                { label: "Deepgram (Nova)", value: "Deepgram" },
                { label: "Google (Gemini)", value: "Google" },
                { label: "Groq (Whisper)", value: "Groq" },
                { label: "ElevenLabs (Scribe)", value: "ElevenLabs" }
            ],
            reloadProps: true
        },
        ai_service: {
            type: "string",
            label: "AI Summary Service",
            description: "Choose the service to use for the AI Summary.",
            options: [
                { label: "OpenAI", value: "OpenAI" },
                { label: "Anthropic", value: "Anthropic" },
                { label: "Google (Gemini)", value: "Google" },
                { label: "Groq", value: "Groq" },
                { label: "None (No Summary)", value: "None" }
            ],
            reloadProps: true
        },
        send_to_notion: {
            type: "boolean",
            label: "Send to Notion",
            description: "Select True to automatically send the transcription and summary to Notion.",
            reloadProps: true
        }
    },
    async additionalProps(previousPropDefs) {
        console.log("=== additionalProps called ===");
        console.log("Current state:", {
            transcription_service: this.transcription_service,
            ai_service: this.ai_service,
            send_to_notion: this.send_to_notion
        });

        // Start with previous props
        let props = { ...previousPropDefs };

        // Helper function to check if an app is truly configured
        const isAppConfigured = (app) => {
            if (!app) return false;
            const keys = Object.keys(app);
            
            if (keys.includes('$auth')) {
                const auth = app.$auth;
                const hasApiKey = auth && Object.keys(auth).length > 0 && auth.api_key !== undefined;
                const hasOAuth = auth && Object.keys(auth).length > 0 && auth.oauth_access_token !== undefined;
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
            
            return keys.length > 0;
        };

        // Early return if required properties aren't set
        if (!this.transcription_service || !this.ai_service || this.send_to_notion === undefined) {
            console.log("Required properties not set, returning early");
            return props;
        }

        // Handle transcription service properties
        if (this.transcription_service === "OpenAI" || this.ai_service === "OpenAI") {
            console.log("Adding OpenAI properties");
            props.openai = {
                type: "app",
                app: "openai",
                description: "Add your OpenAI API key.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };

            const isOpenAIConfigured = isAppConfigured(this.openai);
            console.log("OpenAI configuration check:", { 
                openai: this.openai, 
                isConfigured: isOpenAIConfigured 
            });
        }

        if (this.transcription_service === "Deepgram") {
            console.log("Adding Deepgram properties");
            props.deepgram = {
                type: "app",
                app: "deepgram",
                description: "Add your Deepgram API key.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };
        }

        if (this.transcription_service === "Groq" || this.ai_service === "Groq") {
            console.log("Adding Groq properties");
            props.groq = {
                type: "app",
                app: "groq",
                description: "Add your Groq API key.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };
        }

        if (this.transcription_service === "Google" || this.ai_service === "Google") {
            console.log("Adding Google properties");
            props.google_gemini = {
                type: "app",
                app: "google_gemini",
                description: "Add your Google Gemini API key.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };
        }

        if (this.transcription_service === "ElevenLabs") {
            console.log("Adding ElevenLabs properties");
            props.elevenlabs = {
                type: "app",
                app: "elevenlabs",
                description: "Add your ElevenLabs API key.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };
        }

        // Handle Notion configuration
        if (this.send_to_notion === true) {
            console.log("Adding Notion properties");
            props.notion = {
                type: "app",
                app: "notion",
                description: "Authenticate your Notion account.",
                reloadProps: true,
                hidden: false,
                disabled: false
            };

            const isNotionConfigured = isAppConfigured(this.notion);
            console.log("Notion configuration check:", {
                notion: this.notion,
                isConfigured: isNotionConfigured
            });

            if (isNotionConfigured) {
                console.log("Adding Notion database ID property");
                props.databaseID = {
                    type: "string",
                    label: "Notes Database",
                    description: "Select your notes database.",
                    reloadProps: true,
                    async options({ query, prevContext }) {
                        if (this.notion) {
                            try {
                                const notion = new Client({
                                    auth: this.notion.$auth.oauth_access_token,
                                });
        
                                let start_cursor = prevContext?.cursor;
        
                                const response = await notion.search({
                                    ...(query ? { query } : {}),
                                    ...(start_cursor ? { start_cursor } : {}),
                                    page_size: 50,
                                    filter: {
                                        value: "database",
                                        property: "object",
                                    },
                                    sorts: [
                                        {
                                            direction: "descending",
                                            property: "last_edited_time",
                                        },
                                    ],
                                });
        
                                let notesDbs = response.results.filter((db) =>
                                    /notes/i.test(db.title?.[0]?.plain_text)
                                );
                                let nonNotesDbs = response.results.filter(
                                    (db) => !/notes/i.test(db.title?.[0]?.plain_text)
                                );
                                let sortedDbs = [...notesDbs, ...nonNotesDbs];
                                const options = sortedDbs.map((db) => ({
                                    label: db.title?.[0]?.plain_text,
                                    value: db.id,
                                }));
        
                                return {
                                    context: {
                                        cursor: response.next_cursor,
                                    },
                                    options,
                                };
                            } catch (error) {
                                console.error(error);
                                return {
                                    context: {
                                        cursor: null,
                                    },
                                    options: [],
                                };
                            }
                        } else {
                            return {
                                options: ["Please connect your Notion account first."],
                            };
                        }
                    }
                };
            }
        }

        // Handle transcription model configuration
        if (this.transcription_service) {
            const isServiceConfigured = (service) => {
                switch(service) {
                    case "OpenAI":
                        return isAppConfigured(this.openai);
                    case "Deepgram":
                        return isAppConfigured(this.deepgram);
                    case "Groq":
                        return isAppConfigured(this.groq);
                    case "Google":
                        return isAppConfigured(this.google_gemini);
                    case "ElevenLabs":
                        return isAppConfigured(this.elevenlabs);
                    default:
                        return false;
                }
            };

            if (isServiceConfigured(this.transcription_service)) {
                console.log("Adding transcription model properties");
                const transcriptionModels = {
                    "OpenAI": ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
                    "Deepgram": ["nova-3-general", "nova-2-general", "nova-general"],
                    "Groq": ["whisper-large-v3-turbo", "distil-whisper-large-v3-en", "whisper-large-v3"],
                    "Google": ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"],
                    "ElevenLabs": ["scribe-v1"]
                };

                props.transcription_model = {
                    type: "string",
                    label: "Speech-to-Text Model",
                    description: "Select the speech-to-text model you'd like to use.",
                    options: transcriptionModels[this.transcription_service] || []
                };
            } else {
                console.log(`${this.transcription_service} is not fully configured yet`);
                delete props.transcription_model;
            }
        }

        // Handle chat model configuration
        if (this.ai_service && this.ai_service !== "None") {
            const isServiceConfigured = (service) => {
                switch(service) {
                    case "OpenAI":
                        return isAppConfigured(this.openai);
                    case "Anthropic":
                        return isAppConfigured(this.anthropic);
                    case "Groq":
                        return isAppConfigured(this.groq);
                    case "Google":
                        return isAppConfigured(this.google_gemini);
                    default:
                        return false;
                }
            };

            if (isServiceConfigured(this.ai_service)) {
                console.log("Adding chat model properties");
                const chatModels = {
                    "OpenAI": ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
                    "Anthropic": ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
                    "Google": ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"],
                    "Groq": ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
                };

                props.chat_model = {
                    type: "string",
                    label: "AI Summarization Model",
                    description: "Select the chat model you'd like to use.",
                    options: chatModels[this.ai_service] || []
                };
            } else {
                console.log(`${this.ai_service} is not fully configured yet`);
                delete props.chat_model;
            }
        }

        // Handle summary configuration
        if (this.ai_service && this.ai_service !== "None") {
            const isServiceConfigured = (service) => {
                switch(service) {
                    case "OpenAI":
                        return isAppConfigured(this.openai);
                    case "Anthropic":
                        return isAppConfigured(this.anthropic);
                    case "Groq":
                        return isAppConfigured(this.groq);
                    case "Google":
                        return isAppConfigured(this.google_gemini);
                    default:
                        return false;
                }
            };

            if (isServiceConfigured(this.ai_service)) {
                console.log("Adding summary options");
                props.summary_options = {
                    type: "string[]",
                    label: "Summary Options",
                    description: "Select the options you would like to include in your summary.",
                    options: [
                        "Summary",
                        "Main Points",
                        "Action Items",
                        "Follow-up Questions",
                        "Stories",
                        "References",
                        "Arguments",
                        "Related Topics",
                        "Chapters"
                    ],
                    default: ["Summary", "Main Points", "Action Items", "Follow-up Questions"],
                    optional: false
                };

                props.meta_options = {
                    type: "string[]",
                    label: "Meta Options",
                    description: "Select the meta sections you'd like to include in your note.",
                    options: ["Top Callout", "Table of Contents"],
                    default: [],
                    optional: true
                };
            } else {
                console.log(`${this.ai_service} is not fully configured yet`);
                delete props.summary_options;
                delete props.meta_options;
            }
        }
        /*
        // Handle Notion properties configuration
        if (this.send_to_notion === true && this.notion && this.databaseID) {
            console.log("Adding Notion database properties");
            try {
                const notion = new Client({
                    auth: this.notion.$auth.oauth_access_token
                });

                const database = await notion.databases.retrieve({
                    database_id: this.databaseID
                });

                const properties = database.properties;
                console.log("Retrieved database properties:", Object.keys(properties));

                const notionProps = {
                    noteTitle: {
                        type: "string",
                        label: "Note Title (Required)",
                        description: "Select the title property for your notes.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "title")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: false,
                        reloadProps: true
                    }
                };

                // Add other Notion properties based on database schema
                if (this.noteTitle) {
                    notionProps.noteTitleValue = {
                        type: "string",
                        label: "Note Title Value",
                        description: "Choose the value for your note title.",
                        options: [
                            "AI Generated Title",
                            "Audio File Name",
                            'Both ("File Name – AI Title")'
                        ],
                        default: "AI Generated Title",
                        optional: true
                    };
                }

                // Add remaining Notion properties
                Object.assign(notionProps, {
                    noteDuration: {
                        type: "string",
                        label: "Note Duration",
                        description: "Select the duration property for your notes.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "number")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: true
                    },
                    noteTag: {
                        type: "string",
                        label: "Note Tag",
                        description: "Choose a Select-type property for tagging your note.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "select")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: true,
                        reloadProps: true
                    }
                });

                // Add tag value options if a tag is selected
                if (this.noteTag) {
                    notionProps.noteTagValue = {
                        type: "string",
                        label: "Note Tag Value",
                        description: "Choose the value for your note tag.",
                        options: properties[this.noteTag].select.options.map(option => ({
                            label: option.name,
                            value: option.name
                        })),
                        default: "AI Transcription",
                        optional: true
                    };
                }

                // Add remaining Notion properties
                Object.assign(notionProps, {
                    noteDate: {
                        type: "string",
                        label: "Note Date",
                        description: "Select a date property for your note.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "date")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: true
                    },
                    noteFileName: {
                        type: "string",
                        label: "Note File Name",
                        description: "Select a text-type property for your note's file name.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "rich_text")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: true
                    },
                    noteFileLink: {
                        type: "string",
                        label: "Note File Link",
                        description: "Select a URL-type property for your note's file link.",
                        options: Object.keys(properties)
                            .filter(k => properties[k].type === "url")
                            .map(prop => ({ label: prop, value: prop })),
                        optional: true
                    }
                });

                // Add all Notion properties to props
                props = { ...props, ...notionProps };
            } catch (error) {
                console.error("Error configuring Notion properties:", error);
            }
        } */

        // Add debug state
        props.debug_state = {
            type: "string",
            label: "Debug State",
            description: "This shows the current state of properties",
            default: JSON.stringify({
                transcription_service: this.transcription_service,
                ai_service: this.ai_service,
                send_to_notion: this.send_to_notion,
                hasOpenAI: this.openai !== undefined,
                hasDeepgram: this.deepgram !== undefined,
                hasGroq: this.groq !== undefined,
                hasGoogle: this.google_gemini !== undefined,
                hasElevenLabs: this.elevenlabs !== undefined,
                hasNotion: this.notion !== undefined,
                isNotionConfigured: isAppConfigured(this.notion),
                hasDatabaseID: this.databaseID !== undefined,
                openaiValue: this.openai,
                deepgramValue: this.deepgram,
                groqValue: this.groq,
                googleValue: this.google_gemini,
                elevenlabsValue: this.elevenlabs,
                notionValue: this.notion
            }, null, 2)
        };

        console.log("Returning props:", props);
        return props;
    },
    async run({ steps, $ }) {
        console.log("=== run called ===");
        console.log("Final state:", {
            transcription_service: this.transcription_service,
            ai_service: this.ai_service,
            send_to_notion: this.send_to_notion,
            hasOpenAI: this.openai !== undefined,
            hasDeepgram: this.deepgram !== undefined,
            hasGroq: this.groq !== undefined,
            hasGoogle: this.google_gemini !== undefined,
            hasElevenLabs: this.elevenlabs !== undefined,
            hasNotion: this.notion !== undefined,
            databaseID: this.databaseID,
            transcription_model: this.transcription_model,
            chat_model: this.chat_model,
            summary_options: this.summary_options,
            meta_options: this.meta_options
        });
        
        return {
            message: "Test completed",
            state: {
                transcription_service: this.transcription_service,
                ai_service: this.ai_service,
                send_to_notion: this.send_to_notion,
                hasOpenAI: this.openai !== undefined,
                hasDeepgram: this.deepgram !== undefined,
                hasGroq: this.groq !== undefined,
                hasGoogle: this.google_gemini !== undefined,
                hasElevenLabs: this.elevenlabs !== undefined,
                hasNotion: this.notion !== undefined,
                databaseID: this.databaseID,
                transcription_model: this.transcription_model,
                chat_model: this.chat_model,
                summary_options: this.summary_options,
                meta_options: this.meta_options
            }
        };
    }
};
