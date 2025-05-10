// Text utils
import natural from "natural"; // Sentence tokenization
import { franc, francAll } from "franc"; // Language detection
import { encode, decode } from "gpt-3-encoder"; // GPT-3 encoder for ChatGPT-specific tokenization

// Rate limiting and error handling
import Bottleneck from "bottleneck"; // Concurrency handler
import retry from "async-retry"; // Retry handler

// Node.js utils
import stream from "stream"; // Stream handling
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import got from "got"; // HTTP requests
import { inspect } from "util"; // Object inspection
import { join, extname } from "path"; // Path handling
import { exec, spawn } from "child_process"; // Shell commands

// Project utils
import fileSystem from "./helpers/file-system.mjs"; // File system methods
import lang from "./helpers/languages.mjs"; // Language codes
import transcribe from "./helpers/transcribe.mjs"; // Transcription methods
import textProcessor from "./helpers/text-processor.mjs"; // Text processing methods
import ffmpegHelper from "./helpers/ffmpeg.mjs"; // FFmpeg methods
import llm from "./helpers/llm.mjs"; // LLM methods
import prompts from "./helpers/prompts.mjs"; // Prompts

const config = {
	filePath: "",
	chunkDir: "",
	supportedMimes: [".flac", ".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"],
	no_duration_flag: false,
};

export default {
    name: "Transcribe and Summarize",
    description: "A robust workflow for transcribing and optionally summarizing audio files",
    key: "transcribe-summarize",
    version: "0.0.44",
    type: "action",
    props: {
        steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
		},
		transcription_service: {
			type: "string",
			label: "Transcription Service",
			description:
				`Choose the service to use for transcription. Once you select a service, you'll need to provide an API key in the property that appears later in this step's setup.\n\nOptions include [OpenAI](https://platform.openai.com/docs/guides/speech-to-text), [Deepgram](https://deepgram.com/product/speech-to-text), [Google Gemini](https://ai.google.dev/gemini-api/docs/audio), [Groq](https://console.groq.com/docs/speech-to-text), and [ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).\n\n**Recommendations:** If you're on Pipedream's free plan, you're likely limited to 3 total app connections. That means you'll want a service that can handle both transcription and summarization. **Groq, Gemini, and OpenAI** can all do this. Here some more detailed recommendations:\n\n- **Groq** is the best overall option for most people. It's free, very accurate, and is one of the fastest services. Its Whisper models can return accurate timestamps. It can also be used for summarization.\n\n - **Google Gemini** is also extremely accurate and has a generous free tier. Like Groq, it can also be used for summarization, and the Gemini models may be more powerful than Groq's open-source models for summarization. It is NOT useful if you need accurate timestamps.\n\n - **ElevenLabs** is a good option for transcription.\n\n - **Deepgram** is extremely fast (on par or faster than Groq), but often fails to add punctuation.\n\n- **OpenAI** is the least recommended option. Its summarization models are good, but its transcription models are slow and often reject requests.`,
			options: [
				{
					label: "OpenAI (Whisper, ChatGPT)",
					value: "openai",
				},
				{
					label: "Deepgram (Nova)",	
					value: "deepgram",
				},
				{
					label: "Google (Gemini)",
					value: "google_gemini",
				},
				{
					label: "Groq (Whisper)",
					value: "groqcloud",
				},
				{
					label: "ElevenLabs (Scribe)",
					value: "elevenlabs",
				}
			],
            reloadProps: true,
		},
		ai_service: {
			type: "string",
			label: "AI Summary Service (Also Used for Translation)",
			description:
				`Choose the service to use for the AI Summary. Once you select a service, you'll need to provide an API key in the property that appears later in this step's setup.\n\nOptions include [OpenAI](https://platform.openai.com/docs/api-reference/chat), [Anthropic](https://docs.anthropic.com/en/api/messages), [Google Gemini](https://ai.google.dev/gemini-api/docs/text-generation), and [Groq](https://console.groq.com/docs/text-chat).\n\nYou can also select **None** – this will disable the summary step.\n\n*Note: If you select **None**, your only page title option will be the audio file name. Alternatively, you can select a service here if you want to generate a title, then uncheck all other summary options in the Summary Options property.*\n\n*Note: If you select **None**, you won't be able to translate the transcript into another language. If you want to translate the transcript, select a service here, then enable Advanced Options.*\n\n**Recommendations:** If you're on Pipedream's free plan, you're likely limited to 3 total app connections. That means you'll want a service that can handle both transcription and summarization. **Groq, Gemini, and OpenAI** can all do this. Here some more detailed recommendations:\n\n- **Groq** is the best overall option for most people. It's free, very accurate, and is one of the fastest services. It can also be used for transcription.\n\n - **Google Gemini** is also extremely accurate and has a generous free tier. Like Groq, it can also be used for transcription, and the Gemini models may be more powerful than Groq's open-source models for summarization.\n\n - **OpenAI** is a good option for summarization, but its transcription models are slow and often reject requests.\n\n - **Anthropic** is a good option for summarization, but it does not offer transcription.`,
			options: [
				{
					label: "OpenAI",
					value: "openai",
				},
				{
					label: "Anthropic",
					value: "anthropic",
				},
				{
					label: "Google (Gemini)",
					value: "google_gemini",
				},
				{
					label: "Groq",
					value: "groqcloud",
				},
				{
					label: "None (No Summary)",
					value: "none",
				}
			],
            reloadProps: true,
		}
    },
    async additionalProps(previousPropDefs) {
        console.log("=== additionalProps called ===");
        console.log("this.transcription_service:", this.transcription_service);
        console.log("this.ai_service:", this.ai_service);
        console.log("previousPropDefs:", previousPropDefs);
        
        // Start with previous props
        let props = { ...previousPropDefs };
        
        // Log the current state of this
        console.log("Current this context:", {
            transcription_service: this.transcription_service,
            ai_service: this.ai_service,
            openaiValue: this.openai,
            anthropicValue: this.anthropic,
            deepgramValue: this.deepgram,
            googleValue: this.google,
            groqValue: this.groqcloud,
            elevenlabsValue: this.elevenlabs,
            openaiKeys: this.openai ? Object.keys(this.openai) : [],
            anthropicKeys: this.anthropic ? Object.keys(this.anthropic) : [],
            deepgramKeys: this.deepgram ? Object.keys(this.deepgram) : [],
            googleKeys: this.google_gemini ? Object.keys(this.google_gemini) : [],
            groqKeys: this.groqcloud ? Object.keys(this.groqcloud) : [],
            elevenlabsKeys: this.elevenlabs ? Object.keys(this.elevenlabs) : [],
        });

        // Manage service-specific properties based on user choices
        const serviceConfigs = {
            transcription: {
                openai: {
                    name: "OpenAI",
                    recommended: "whisper-1",
                    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
                    prop: "openai",
                    app: {
                        type: "app",
                        app: "openai",
                        description: "This is OpenAI's app property. After this loads, you should see OpenAI's model options.",
                        reloadProps: true
                    }
                },
                deepgram: {
                    name: "Deepgram",
                    recommended: "nova-3",
                    models: ["nova-3", "nova-2", "nova"],
                    prop: "deepgram",
                    app: {
                        type: "app",
                        app: "deepgram",
                        description: "This is Deepgram's app property. After this loads, you should see Deepgram's model options.",
                        reloadProps: true
                    }
                },
                groqcloud: {
                    name: "Groq",
                    recommended: "distil-whisper-large-v3-en",
                    models: ["whisper-large-v3-turbo", "distil-whisper-large-v3-en", "whisper-large-v3"],
                    prop: "groqcloud",
                    app: {
                        type: "app",
                        app: "groqcloud",
                        description: "This is Groq's app property. After this loads, you should see Groq's model options.",
                        reloadProps: true
                    }
                },
                google_gemini: {
                    name: "Google Gemini",
                    recommended: "gemini-1.5-flash",
                    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"],
                    prop: "google_gemini",
                    app: {
                        type: "app",
                        app: "google_gemini",
                        description: "This is Google Gemini's app property. After this loads, you should see Google's model options.",
                        reloadProps: true
                    }
                },
                elevenlabs: {
                    name: "ElevenLabs",
                    recommended: "scribe_v1",
                    models: ["scribe_v1"],
                    prop: "elevenlabs",
                    app: {
                        type: "app",
                        app: "elevenlabs",
                        description: "This is ElevenLabs' app property. After this loads, you should see ElevenLabs' model options.",
                        reloadProps: true
                    }
                }
            },
            ai: {
                openai: {
                    name: "OpenAI",
                    recommended: "gpt-4.1-nano",
                    models: ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
                    prop: "openai",
                    app: {
                        type: "app",
                        app: "openai",
                        description: "This is OpenAI's app property. After this loads, you should see OpenAI's model options.",
                        reloadProps: true
                    }
                },
                anthropic: {
                    name: "Anthropic",
                    recommended: "claude-3-5-haiku-latest",
                    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
                    prop: "anthropic",
                    app: {
                        type: "app",
                        app: "anthropic",
                        description: "This is Anthropic's app property. After this loads, you should see Anthropic's model options.",
                        reloadProps: true
                    }
                },
                google_gemini: {
                    name: "Google Gemini",
                    recommended: "gemini-2.0-flash-lite",
                    models: ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"],
                    prop: "google_gemini",
                    app: {
                        type: "app",
                        app: "google_gemini",
                        description: "This is Google Gemini's app property. After this loads, you should see Google's model options.",
                        reloadProps: true
                    }
                },
                groqcloud: {
                    name: "Groq",
                    recommended: "llama-3.1-8b-instant",
                    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"],
                    prop: "groqcloud",
                    app: {
                        type: "app",
                        app: "groqcloud",
                        description: "This is Groq's app property. After this loads, you should see Groq's model options.",
                        reloadProps: true
                    }
                }
            }
        };

        // Function to manage all properties based on service selections
        const manageProperties = () => {
            // Get all unique app properties from both service types
            const allAppProps = new Set([
                ...Object.values(serviceConfigs.transcription).map(config => config.prop),
                ...Object.values(serviceConfigs.ai).map(config => config.prop)
            ]);

            // Get the currently selected services
            const selectedTranscriptionService = this.transcription_service;
            const selectedAiService = this.ai_service;

            // Disable all app properties first
            allAppProps.forEach(propName => {
                if (props[propName]) {
                    props[propName].hidden = true;
                    props[propName].disabled = true;
                }
            });

            // Handle transcription service
            if (selectedTranscriptionService && selectedTranscriptionService !== 'none') {
                const config = serviceConfigs.transcription[selectedTranscriptionService];
                if (config) {
                    // Enable app property
                    if (props[config.prop]) {
                        props[config.prop].hidden = false;
                        props[config.prop].disabled = false;
                    }

                    // Set up model property
                    props.transcription_model = {
                        type: "string",
                        label: "Speech-to-Text Model",
                        description: `Select the ${config.name} model you'd like to use for transcription. If you're not sure, **${config.recommended}** is recommended.`,
                        options: config.models,
                        hidden: false,
                        disabled: false,
                        reloadProps: true
                    };
                }
            } else {
                // Hide transcription model if no service selected
                if (props.transcription_model) {
                    props.transcription_model.hidden = true;
                    props.transcription_model.disabled = true;
                }
            }

            // Add advanced options toggle
            props.advanced_options = {
                type: "boolean",
                label: "Enable Advanced Options",
                description: `Set this to **True** to enable advanced options for this workflow.`,
                default: false,
                optional: true,
                reloadProps: true,
            };

            if (this.advanced_options === true) {

                // Common advanced options
                props.chunk_size = {
                    type: "integer",
                    label: "Audio File Chunk Size",
                    description: `Your audio file will be split into chunks before being sent to Whisper for transcription. This is done to handle Whisper's 24mb max file size limit.\n\nThis setting will let you make those chunks even smaller – anywhere between 8mb and 24mb.\n\nSince the workflow makes concurrent requests to Whisper, a smaller chunk size may allow this workflow to handle longer files.\n\nSome things to note with this setting: \n\n* Chunks will default to 24mb if you don't set a value here. I've successfully transcribed a 2-hour file at this default setting by changing my workflow's timeout limit to 300 seconds, which is possible on the free plan. \n* If you're currently using trial credit with OpenAI and haven't added your billing information, your [Audio rate limit](https://platform.openai.com/docs/guides/rate-limits/what-are-the-rate-limits-for-our-api) will likely be 3 requests per minute – meaning setting a smaller chunk size may cause you to hit that rate limit. You can fix this by adding your billing info and generating a new API key. \n* Longer files may also benefit from your workflow having a higher RAM setting. \n* There will still be limits to how long of a file you can transcribe, as the max workflow timeout setting you can choose on Pipedream's free plan is 5 minutes. If you upgrade to a paid account, you can go as high as 12 minutes.`,
                    optional: true,
                    min: 8,
                    max: 24,
                    default: 24,
                };

                // Add downsampling option
                props.enable_downsampling = {
                    type: "boolean",
                    label: "Enable Audio Downsampling",
                    description: `When enabled, this will downsample your audio file to 16kHz mono and convert it to MP3 format (32kbps) before transcription. This can significantly reduce file size while maintaining quality, potentially avoiding the need for chunking.\n\n**Note:** This option may be useful for avoiding chunking of large audio files, which you may want to avoid if you're trying to generate timestamps. However, it may also increase the time each run takes, since the file won't be split into chunks that can be processed concurrently. If you run into timeout issues with this enabled, try disabling it or increasing your workflow's timeout limit.`,
                    default: false,
                    optional: true,
                };

            } else {
                // Hide all advanced options if advanced options are disabled
                const advancedProps = [
                    'chunk_size',
                    'enable_downsampling'
                ];
                advancedProps.forEach(prop => {
                    if (props[prop]) {
                        props[prop].hidden = true;
                        props[prop].disabled = true;
                    }
                });
            }

            // Handle AI service
            if (selectedAiService && selectedAiService !== 'none') {
                const config = serviceConfigs.ai[selectedAiService];
                if (config) {
                    // Enable app property
                    if (props[config.prop]) {
                        props[config.prop].hidden = false;
                        props[config.prop].disabled = false;
                    }

                    // Set up model property
                    props.ai_model = {
                        type: "string",
                        label: "AI Model",
                        description: `Select the ${config.name} model you'd like to use for summarization. If you're not sure, **${config.recommended}** is recommended.`,
                        options: config.models,
                        hidden: false,
                        disabled: false,
                        reloadProps: true
                    };

                    // Add summary options property
                    props.summary_options = {
                        type: "string[]",
                        label: "Summary Options",
                        description: `Select the options you would like to include in your summary. You can select multiple options.\n\nYou can also de-select all options, which will cause the summary step to only run once in order to generate a title for your note.`,
                        options: [
                            "Summary",
                            "Main Points",
                            "Action Items",
                            "Follow-up Questions",
                            "Stories",
                            "References",
                            "Arguments",
                            "Related Topics",
                            "Chapters",
                        ],
                        optional: true,
                        default: ["Summary"],
                        hidden: false,
                        disabled: false
                    };

                    // Add advanced options if enabled
                    if (this.advanced_options === true) {

                        // Whisper-specific options
                        if (this.transcription_model?.toLowerCase().includes('whisper') || this.transcription_model?.toLowerCase().includes('gpt-4o-transcribe') || this.transcription_model?.toLowerCase().includes('gpt-4o-mini-transcribe') || this.transcription_model?.toLowerCase().includes('gemini')) {
                            props.whisper_prompt = {
                                type: "string",
                                label: "Transcription Prompt (Optional)",
                                description: `You can enter a prompt here to help guide the transcription model's style. By default, the prompt will be "Hello, welcome to my lecture." which is a default prompt provided by OpenAI to help improve with punctuation. Learn more: https://platform.openai.com/docs/guides/speech-to-text/prompting`,
                                optional: true,
                            };

                            props.whisper_temperature = {
                                type: "integer",
                                label: "Transcription Temperature",
                                description: `Set the temperature for the transcription model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0. Higher temperatures may result in more "creative" output. This workflow defaults to 0.2.`,
                                optional: true,
                                min: 0,
                                max: 20,
                            };
                        } else {
                            // Hide whisper-specific options if not using a whisper model
                            if (props.whisper_prompt) {
                                props.whisper_prompt.hidden = true;
                                props.whisper_prompt.disabled = true;
                            }
                            if (props.whisper_temperature) {
                                props.whisper_temperature.hidden = true;
                                props.whisper_temperature.disabled = true;
                            }
                        }

                        // AI-specific options
                        if (this.ai_service && this.ai_service !== 'none') {
                            props.translation_language = {
                                type: "string",
                                label: "Translation Language",
                                description: `If you set a language here, your transcript and chosen summary options will translated into that language (if it differs from the language of the transcript).`,
                                optional: true,
                                options: lang.LANGUAGES.map((lang) => ({
                                    label: lang.label,
                                    value: lang.value,
                                })),
                                reloadProps: true,
                            };
                            
                            props.summary_density = {
                                type: "integer",
                                label: "Summary Density (Advanced)",
                                description: `*It is recommended to leave this setting at its default unless you have a good understanding of how LLMs handle tokens.*\n\nSets the maximum number of tokens (word fragments) for each chunk of your transcript, and therefore the max number of user-prompt tokens that will be sent to your chosen LLM in each summarization request.\n\nA smaller number will result in a more "dense" summary, as the same summarization prompt will be run for a smaller chunk of the transcript – hence, more requests will be made, as the transcript will be split into more chunks.\n\nThis will enable the script to handle longer files, as the script uses concurrent requests, and your LLM will take less time to process a chunk with fewer prompt tokens.\n\nThis does mean your summary and list will be longer, as you'll get them for each chunk. You can somewhat counteract this with the **Summary Verbosity** option.\n\n**Lowering the number here will also *slightly* increase the cost of the summarization step**, both because you're getting more summarization data and because the summarization prompt's system instructions will be sent more times.\n\nDefaults to 5,000 tokens. The maximum value depends on your chosen model, and the minimum value is 500 tokens.\n\nKeep in mind that setting a very high value will result in a very sparse summary.`,
                                min: 500,
                                max: 100000,
                                default: 5000,
                                optional: true,
                            };
                            
                            props.verbosity = {
                                type: "string",
                                label: "Summary Verbosity (Advanced)",
                                description: `Sets the verbosity of your summary and lists (whichever you've activated) **per transcript chunk**. Defaults to **Medium**.\n\nHere's what each setting does:\n\n* **High** - Summary will be 20-25% of the transcript length. Most lists will be limited to 5 items.\n* **Medium** - Summary will be 10-15% of the transcript length. Most lists will be limited to 3 items.\n* **Low** - Summary will be 5-10% of the transcript length. Most lists will be limited to 2 items.\n\nNote that these numbers apply *per transcript chunk*, as the instructions have to be sent with each chunk.`,
                                default: "Medium",
                                options: ["High", "Medium", "Low"],
                                optional: true,
                            };

                            props.ai_temperature = {
                                type: "integer",
                                label: "AI Model Temperature",
                                description: `Set the temperature for the AI model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0. Higher temperatures may result in more "creative" output, but have the potential to cause the output to fail to be valid JSON. This workflow defaults to 0.2. **Note: This setting is not available for all models, so it may be ignored depending on the model you've selected.**`,
                                optional: true,
                                min: 0,
                                max: 20,
                            };
                        } else {
                            // Hide AI-specific options if no AI service selected

                            if (props.translation_language) {
                                props.translation_language.hidden = true;
                                props.translation_language.disabled = true;
                            }

                            if (props.summary_density) {
                                props.summary_density.hidden = true;
                                props.summary_density.disabled = true;
                            }

                            if (props.verbosity) {
                                props.verbosity.hidden = true;
                                props.verbosity.disabled = true;
                            }

                            if (props.ai_temperature) {
                                props.ai_temperature.hidden = true;
                                props.ai_temperature.disabled = true;
                            }
                        }
                    } else {
                        // Hide all advanced options if advanced options are disabled
                        const advancedProps = [
                            'whisper_prompt',
                            'whisper_temperature',
                            'translation_language',
                            'summary_density',
                            'verbosity',
                            'ai_temperature',
                            'chunk_size',
                            'enable_downsampling'
                        ];
                        advancedProps.forEach(prop => {
                            if (props[prop]) {
                                props[prop].hidden = true;
                                props[prop].disabled = true;
                            }
                        });
                    }
                }
            } else if (this.ai_service === "none") {
                
                // Hide AI model if "none" is selected for AI service
                if (props.ai_model) {
                    props.ai_model.hidden = true;
                    props.ai_model.disabled = true;
                }

                // Hide summary options if "none" is selected for AI service
                if (props.summary_options) {
                    props.summary_options.hidden = true;
                    props.summary_options.disabled = true;
                }
                
                // Show advanced options if "none" is selected for AI service
                if (props.advanced_options) {
                    props.advanced_options.hidden = false;
                    props.advanced_options.disabled = false;
                }
            } else {
                // Hide AI model if no service selected
                if (props.ai_model) {
                    props.ai_model.hidden = true;
                    props.ai_model.disabled = true;
                }
                // Hide summary options if no AI service selected
                if (props.summary_options) {
                    props.summary_options.hidden = true;
                    props.summary_options.disabled = true;
                }
                // Hide advanced options if no AI service selected
                if (props.advanced_options) {
                    props.advanced_options.hidden = true;
                    props.advanced_options.disabled = true;
                }
            }
        };

        // Initialize app properties only if they don't exist
        const initializeAppProps = () => {
            // Initialize transcription service app properties
            Object.values(serviceConfigs.transcription).forEach(config => {
                if (!props[config.prop]) {
                    props[config.prop] = {
                        ...config.app,
                        hidden: true,
                        disabled: true
                    };
                }
            });

            // Initialize AI service app properties
            Object.values(serviceConfigs.ai).forEach(config => {
                if (!props[config.prop]) {
                    props[config.prop] = {
                        ...config.app,
                        hidden: true,
                        disabled: true
                    };
                }
            });
        };

        // Initialize app properties first
        initializeAppProps();

        // Manage all properties based on service selections
        manageProperties();

        console.log("Returning props:", props);
        return props;
    },
    methods: {
        ...fileSystem.methods,
        ...ffmpegHelper.methods,
        ...transcribe.methods,
        ...textProcessor.methods,
        ...llm.methods,
        async checkSize(fileSize) {
			if (fileSize > 700000000) {
				throw new Error(
					`File is too large. Files must be under 700mb and one of the following file types: ${config.supportedMimes.join(
						", "
					)}. Note that 700mb may be too high of a limit, due to Pipedream's 2gb temp storage maximum. This temp storage is needed for both the file itself and the chunks it is split into. You may need to compress large files before uploading.
					
					Note: If you upload a particularly large file and get an Out of Memory error, try setting your workflow's RAM setting higher. Learn how to do this here: https://pipedream.com/docs/workflows/settings/#memory`
				);
			} else {
				// Log file size in mb to nearest hundredth
				const readableFileSize = fileSize / 1000000;
				console.log(
					`File size is approximately ${readableFileSize.toFixed(1).toString()}mb.`
				);
			}
		},
    },
    async run({ steps, $ }) {
        // Object for storing performance logs
		let stageDurations = {
			setup: 0,
			download: 0,
			transcription: 0,
			transcriptCombination: 0,
            translation: 0,
			summary: 0,
            total: 0
		};

		function totalDuration(obj) {
			return Object.keys(obj)
				.filter((key) => typeof obj[key] === "number" && key !== "total")
				.reduce((a, b) => a + obj[b], 0);
		}

		let previousTime = process.hrtime.bigint();
        
        console.log("=== STARTING RUN ===");
        console.log("Logging Settings...");
        const logSettings = {
            transcription_service: this.transcription_service,
            ai_service: this.ai_service,
            hasOpenAI: this.openai !== undefined,
            hasAnthropic: this.anthropic !== undefined,
            hasDeepgram: this.deepgram !== undefined,
            hasGoogle: this.google_gemini !== undefined,
            hasGroq: this.groqcloud !== undefined,
            hasElevenLabs: this.elevenlabs !== undefined,
            transcription_model: this.transcription_model,
            ai_model: this.ai_model,
            summary_options: this.summary_options,
            advanced_options: this.advanced_options,
            translation_language: this.translation_language,
            whisper_prompt: this.whisper_prompt,
            whisper_temperature: this.whisper_temperature,
            summary_density: this.summary_density,
            verbosity: this.verbosity,
            ai_temperature: this.ai_temperature,
            chunk_size: this.chunk_size
        }
        console.dir(logSettings);

        // Get service configurations
        const serviceConfigs = {
            transcription: {
                openai: {
                    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]
                },
                deepgram: {
                    models: ["nova-3", "nova-2-general", "nova-general"]
                },
                groqcloud: {
                    models: ["whisper-large-v3-turbo", "distil-whisper-large-v3-en", "whisper-large-v3"]
                },
                google_gemini: {
                    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"]
                },
                elevenlabs: {
                    models: ["scribe_v1"]
                }
            },
            ai: {
                openai: {
                    models: ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"]
                },
                anthropic: {
                    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"]
                },
                google_gemini: {
                    models: ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"]
                },
                groqcloud: {
                    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"]
                }
            }
        };

        // Set supported mimes
        this.supportedMimes = [".flac", ".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"]

        // Validate selected models against chosen services
        if (this.transcription_service && this.transcription_service !== 'none') {
            // Check if the service is properly configured
            const serviceProp = this[this.transcription_service];
            if (!serviceProp) {
                throw new Error(`Transcription service ${this.transcription_service} is not properly configured. Please check your API key and try again.`);
            }

            // Get the available models for the service
            const availableModels = serviceConfigs.transcription[this.transcription_service]?.models || [];
            if (!availableModels.includes(this.transcription_model)) {
                throw new Error(
                    `Invalid transcription model "${this.transcription_model}" for service ${this.transcription_service}. ` +
                    `Available models are: ${availableModels.join(', ')}`
                );
            }
        }

        if (this.ai_service && this.ai_service !== 'none') {
            // Check if the service is properly configured
            const serviceProp = this[this.ai_service];
            if (!serviceProp) {
                throw new Error(`AI service ${this.ai_service} is not properly configured. Please check your API key and try again.`);
            }

            // Get the available models for the service
            const availableModels = serviceConfigs.ai[this.ai_service]?.models || [];
            if (!availableModels.includes(this.ai_model)) {
                throw new Error(
                    `Invalid AI model "${this.ai_model}" for service ${this.ai_service}. ` +
                    `Available models are: ${availableModels.join(', ')}`
                );
            }
        }

        /* -- Setup Stage -- */
        console.log("=== SETUP STAGE ===");

		const fileID = this.steps.trigger.event.id;
		const testEventId = "52776A9ACB4F8C54!134";

		if (fileID === testEventId) {
			throw new Error(
				`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file (mp3 or m4a) to Dropbox, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`
			);
		}

        console.log("Checking that file is under 700mb...");
		await this.checkSize(this.steps.trigger.event.size);
		console.log("File is under the size limit. Continuing...");

        if (this.translation_language && this.translation_language !== "") {
            console.log(`User set translation language to ${this.translation_language}.`);
            config.translationLanguage = this.translation_language;
        }

        const fileInfo = {};

		fileInfo.log_settings = logSettings;

		// Capture the setup stage's time taken in milliseconds
		stageDurations.setup = Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(`Setup stage duration: ${stageDurations.setup}ms`);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations)}ms (${
				totalDuration(stageDurations) / 1000
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

        /* -- Download Stage -- */

		if (this.steps.google_drive_download?.$return_value?.name) {
			// Google Drive method
			fileInfo.cloud_app = "Google Drive";
			fileInfo.file_name =
				this.steps.google_drive_download.$return_value.name.replace(
					/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g,
					""
				);
			fileInfo.path = `/tmp/${fileInfo.file_name}`;
			console.log(`File path of Google Drive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			fileInfo.link = this.steps.trigger.event.webViewLink;
			if (config.supportedMimes.includes(fileInfo.mime) === false) {
				throw new Error(
					`Unsupported file type. OpenAI's Whisper transcription service only supports the following file types: ${config.supportedMimes.join(
						", "
					)}.`
				);
			}
		} else if (this.steps.download_file?.$return_value?.name) {
			// Google Drive fallback method
			fileInfo.cloud_app = "Google Drive";
			fileInfo.file_name = this.steps.download_file.$return_value.name.replace(
				/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g,
				""
			);
			fileInfo.path = `/tmp/${fileInfo.file_name}`;
			console.log(`File path of Google Drive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			fileInfo.link = this.steps.trigger.event.webViewLink;
			if (config.supportedMimes.includes(fileInfo.mime) === false) {
				throw new Error(
					`Unsupported file type. OpenAI's Whisper transcription service only supports the following file types: ${config.supportedMimes.join(
						", "
					)}.`
				);
			}
		} else if (
			this.steps.ms_onedrive_download?.$return_value &&
			/^\/tmp\/.+/.test(this.steps.ms_onedrive_download.$return_value)
		) {
			// MS OneDrive method
			fileInfo.cloud_app = "OneDrive";
			fileInfo.path = this.steps.ms_onedrive_download.$return_value.replace(
				/[\?$#&\{\}\[\]<>\*!@:\+\\]/g,
				""
			);
			fileInfo.file_name = fileInfo.path.replace(/^\/tmp\//, "");
			console.log(`File path of MS OneDrive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			fileInfo.link = this.steps.trigger.event.webUrl;
			if (config.supportedMimes.includes(fileInfo.mime) === false) {
				throw new Error(
					`Unsupported file type. OpenAI's Whisper transcription service only supports the following file types: ${config.supportedMimes.join(
						", "
					)}.`
				);
			}
		} else {
			// Dropbox method
			fileInfo.cloud_app = "Dropbox";
			Object.assign(
				fileInfo,
				await this.downloadToTmp(
					this.steps.trigger.event.link,
					this.steps.trigger.event.path_lower,
					this.steps.trigger.event.name
				)
			);

			fileInfo.link = encodeURI(
				"https://www.dropbox.com/home" + this.steps.trigger.event.path_lower
			);
			console.log(`File path of Dropbox file: ${fileInfo.path}`);
		}

		this.filePath = fileInfo.path;
		this.fileName = fileInfo.file_name;
		this.fileLink = fileInfo.link;

		fileInfo.duration = await this.getDuration(fileInfo.path);
        fileInfo.duration_formatted = this.formatDuration(fileInfo.duration);

		// Capture the download stage's time taken in milliseconds
		stageDurations.download =
			Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(
			`Download stage duration: ${stageDurations.download}ms (${
				stageDurations.download / 1000
			} seconds)`
		);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations)}ms (${
				totalDuration(stageDurations) / 1000
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

        /* -- Transcription Stage -- */

        // Check if downsampling is enabled
        let fileToProcess = fileInfo.path;
        if (this.advanced_options && this.enable_downsampling) {
            console.log("Downsampling enabled. Processing audio file...");
            const downsampledResult = await this.downsampleAudio({ file: fileInfo.path });
            fileToProcess = downsampledResult.path;
            console.log(`Using downsampled file: ${fileToProcess}`);
            console.log(`Size reduction: ${downsampledResult.sizeReduction}%`);
        }

        // Chunk the file
        const chunkFiles = await this.chunkFile({ file: fileToProcess });

        console.log(`Chunks created successfully. Transcribing chunks: ${chunkFiles.files}`);

        // Transcribe the chunk(s)
        fileInfo.transcript_chunks = await this.transcribeFiles({
            files: chunkFiles.files,
            outputDir: chunkFiles.outputDir,
        })

        await this.cleanTmp();

        // Capture the transcription stage's time taken in milliseconds
		stageDurations.transcription =
        Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Transcription stage duration: ${stageDurations.transcription}ms (${
                stageDurations.transcription / 1000
            } seconds)`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations)}ms (${
                totalDuration(stageDurations) / 1000
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        /* -- Transcript Combination Stage -- */

        console.log("=== TRANSCRIPT COMBINATION STAGE ===");

        // Combine all transcript chunks into a single transcript
        console.log("Combining transcript chunks...");
		fileInfo.full_transcript = await this.combineTranscriptChunks(fileInfo.transcript_chunks)

        // If transcript chunks have VTT files, combine them into a single VTT file
        if (fileInfo.transcript_chunks.every(chunk => chunk.vtt)) {
            console.log("Combining VTT chunks...");
            fileInfo.full_vtt = await this.combineVTTChunks(fileInfo.transcript_chunks)
        }

        // Capture the transcript combination stage's time taken in milliseconds
		stageDurations.transcriptCombination =
        Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Transcript combination stage duration: ${stageDurations.transcriptCombination}ms`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations)}ms (${
                totalDuration(stageDurations) / 1000
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        // If an AI service is selected, proceed to summarization (and translation if selected)

        if (this.ai_service && this.ai_service !== "none") {
            
            console.log(`Using ${this.ai_service} and model ${this.ai_model} for summarization.`);

            /* -- Summary Stage -- */

            console.log("=== SUMMARY STAGE ===");

            // Set the max tokens per summary chunk based on the AI service and model
            const maxTokens = this.summary_density
                ? this.summary_density
                : 5000;

            console.log(`Max tokens per summary chunk: ${maxTokens}`);

            // Find the longest period gap in the transcript
            fileInfo.longest_gap = this.findLongestPeriodGap(
                fileInfo.full_transcript,
                maxTokens
            );
            console.log(
                `Longest period gap info: ${JSON.stringify(fileInfo.longest_gap, null, 2)}`
            );

            if (fileInfo.longest_gap.encodedGapLength > maxTokens) {
                console.log(
                    `Longest sentence in the transcript exceeds the max per-chunk token length of ${maxTokens}. Transcript chunks will be split mid-sentence, potentially resulting in lower-quality summaries.`
                );
            }

            // Encode the transcript to get a rough token count
            const encodedTranscript = encode(fileInfo.full_transcript);
            console.log(
                `Full transcript is roughly ${encodedTranscript.length} tokens. This is a rough estimate, and the actual number of input tokens may vary based on the model used.`
            );

            // Split the transcript into chunks of a specified maximum number of tokens
            fileInfo.summary_chunks = this.splitTranscript(
                encodedTranscript,
                maxTokens,
                fileInfo.longest_gap
            );

            // If no summary options are selected, use the first chunk as the title
            if (this.summary_options === null || this.summary_options.length === 0) {
                console.log("No summary options selected. Using the first chunk as the title.");

                
                const titleArr = [fileInfo.summary_chunks[0]];
                fileInfo.summary = await this.sendToChat({
                    service: this.ai_service,
                    model: this.ai_model,
                    stringsArray: titleArr,
                });
            } else {
                console.log("Summary options selected. Using the selected options.");
                console.log(`Summary options: ${this.summary_options}`);
                
                // If summary options are selected, use the selected options
                fileInfo.summary = await this.sendToChat({
                    service: this.ai_service,
                    model: this.ai_model,
                    stringsArray: fileInfo.summary_chunks,
                });
            }

            console.log(`Summary array from ${this.ai_service} (${this.ai_model}):`);
            console.dir(fileInfo.summary, { depth: null });
            fileInfo.formatted_chat = await this.formatChat(fileInfo.summary);

            fileInfo.paragraphs = {
                transcript: this.makeParagraphs(fileInfo.full_transcript, 1200),
                ...(this.summary_options.includes("Summary") && {
                    summary: this.makeParagraphs(fileInfo.formatted_chat.summary, 1200),
                }),
            };

            // Capture the summary stage's time taken in milliseconds
            stageDurations.summary = Number(process.hrtime.bigint() - previousTime) / 1e6;
            console.log(
                `Summary stage duration: ${stageDurations.summary}ms (${
                    stageDurations.summary / 1000
                } seconds)`
            );
            console.log(
                `Total duration so far: ${totalDuration(stageDurations)}ms (${
                    totalDuration(stageDurations) / 1000
                } seconds)`
            );
            previousTime = process.hrtime.bigint();

            // If translation is selected, translate the transcript
            if (this.translation_language && this.translation_language !== "") {
                
                /* === TRANSLATION STAGE === */
                
                console.log(
                    `User specified ${this.translation_language} for the translation. Checking if the transcript language matches...`
                );
    
                const detectedLanguage = await this.detectLanguage(
                    this.ai_service,
                    this.chat_model,
                    fileInfo.paragraphs.transcript[0]
                );
    
                fileInfo.language = {
                    transcript: await this.formatDetectedLanguage(
                        detectedLanguage.choices[0].message.content
                    ),
                    summary: this.translation_language
                        ? lang.LANGUAGES.find((l) => l.value === this.translation_language)
                        : "No language set.",
                };
            }

        }

        // Add total duration to stageDurations
        stageDurations.total = totalDuration(stageDurations);
        fileInfo.performance_metrics = stageDurations;
        // Create a formatted performance log that expresses the performance values as strings with ms and second labels
        fileInfo.performance_formatted = Object.fromEntries(
            Object.entries(fileInfo.performance_metrics).map(([stageName, stageDuration]) => [
                stageName,
                stageDuration > 1000
                    ? `${(stageDuration / 1000).toFixed(2)} seconds`
                    : `${stageDuration.toFixed(2)}ms`,
            ])
        );
        
        return fileInfo;

    }
};
