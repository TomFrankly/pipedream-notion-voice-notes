import fileSystem from "./helpers/file-system.mjs";
import lang from "./helpers/languages.mjs";
import transcribe from "./helpers/transcribe.mjs";
import textProcessor from "./helpers/text-processor.mjs";
import ffmpegHelper from "./helpers/ffmpeg.mjs";
import llm from "./helpers/llm.mjs";

export default {
    name: "Transcribe and Summarize",
    description: "A robust workflow for transcribing and optionally summarizing audio files",
    key: "transcribe-summarize",
    version: "0.1.62",
    type: "action",
    props: {
        instructions: {
            type: "alert",
            alertType: "info",
            content: `## Instructions
            
This is a super flexible transcription and AI summarization action built by your 'ole buddy Thomas Frank. It can transcribe nearly any audio file that you've downloaded to Pipedream temp storage, and gives you several transcription service options, including Groq (recommended), Deepgram, ElevenLabs, AssemblyAI, Google Gemini, and OpenAI.

If you like, it can also translate your transcript to another language, create a summary, and create lists of main points, action items, and more.

**I highly recommend checking out the [full tutorial and FAQ](https://go.thomasjfrank.com/guide-notion-voice-notes/) to learn how to set this step up and to see everything it can do!**

## Basic Setup:

- Ensure **Previous Step Data** is set to **{{steps}}**
- Select a **Transcription Service**
- Select an **AI Summary Service** (required for translation and AI-generated note titles as well). You can select **None** if you only want transcription.
- Provide API keys for the services you've selected
- Choose models for the services you've selected
- Choose your **Summary Options** (if desired)

This step works seamlessly with the **Send to Notion** step you likely see below it. However, you can also use the return value of this step in your own custom steps.

## Resources

- This workflow works with any Notion database, but it pairs well with [Ultimate Brain](https://thomasjfrank.com/brain/), my all-in-one productivity template.
- Want to capture web clips, full articles, and highlights to Notion? Check out [Flylighter](https://flylighter.com/), my free web clipper for Notion.
- Check out the [full tutorial and FAQ](https://go.thomasjfrank.com/guide-notion-voice-notes/) for this workflow
- If you run into a bug or problem, please [open an issue](https://github.com/TomFrankly/pipedream-notion-voice-notes/issues) on GitHub.
`
        },
        steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
		},
		transcription_service: {
			type: "string",
			label: "Transcription Service",
			description:
				`Choose the service to use for transcription. Once you select a service, you'll need to provide an API key in the property that appears later in this step's setup.\n\nOptions include [OpenAI](https://platform.openai.com/docs/guides/speech-to-text), [Deepgram](https://deepgram.com/product/speech-to-text), [Google Gemini](https://ai.google.dev/gemini-api/docs/audio), [Groq](https://console.groq.com/docs/speech-to-text), [AssemblyAI](https://www.assemblyai.com/products/speech-to-text), and [ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).\n\n**Recommendations:** If you're on Pipedream's free plan, you're likely limited to 3 total app connections. That means you'll want a service that can handle both transcription and summarization. **Groq, Gemini, and OpenAI** can all do this. Here some more detailed recommendations:\n\n- **Groq** is the best overall option for most people. It has a generous free tier, is very accurate, and is one of the fastest services. Its Whisper models can return accurate timestamps. On the pay-by-usage Dev Tier, its Whisper models are the fastest and least expensive in the industry. It can also be used for summarization.\n\n - **Google Gemini** is also extremely accurate and has a generous free tier. Like Groq, it can also be used for summarization, and the Gemini models may be more powerful than Groq's open-source models for summarization. It is NOT useful if you need accurate timestamps.\n\n - **ElevenLabs** is a good option for transcription.\n\n - **Deepgram** is extremely fast (on par or faster than Groq). It's more expensive, but supports diarization (speaker labels). Under this workflow's current architecture, you should choose Deepgram if you want caption-style timestamps with speaker labels.\n\n- **AssemblyAI** is another good transcription option comparable to Deepgram. Under this workflow's current architecture, you should choose AssemblyAI if you want larger timestamp segments for multi-speaker audio, rather than caption-style segments.\n\n- **OpenAI** is the least recommended option. Its summarization models are good, but its transcription models are slow and often reject requests.`,
			options: [
				{
					label: "Groq (Whisper)",
					value: "groqcloud",
				},
                {
					label: "Deepgram (Nova)",	
					value: "deepgram",
				},
                {
                    label: "AssemblyAI",
                    value: "assemblyai",
                },
                {
					label: "ElevenLabs (Scribe)",
					value: "elevenlabs",
				},
                {
					label: "OpenAI (Whisper, ChatGPT)",
					value: "openai",
				},
				{
					label: "Google (Gemini)",
					value: "google_gemini",
				}
			],
            reloadProps: true,
		},
		ai_service: {
			type: "string",
			label: "AI Summary Service (Also Used for Translation)",
			description:
				`Choose the service to use for AI summaries, translations, and AI-generated note titles. Once you select a service, you'll need to provide an API key in the property that appears later in this step's setup.\n\nOptions include [OpenAI](https://platform.openai.com/docs/api-reference/chat), [Anthropic](https://docs.anthropic.com/en/api/messages), [Google Gemini](https://ai.google.dev/gemini-api/docs/text-generation), [Groq](https://console.groq.com/docs/text-chat), and [Cerebras](https://inference-docs.cerebras.ai/api-reference/chat-completions).\n\nYou can also select **None** – this will disable the summary step.\n\n*Note: If you select **None**, you won't be able to create an AI-generated note title. Alternatively, you can select a service here if you want to generate a title, then uncheck all other summary options in the Summary Options property.*\n\n*Note: If you select **None**, you won't be able to translate the transcript into another language. If you want to translate the transcript, select a service here, then enable Advanced Options.*\n\n**Recommendations:** If you're on Pipedream's free plan, you're likely limited to 3 total app connections. That means you'll want a service that can handle both transcription and summarization. **Groq, Gemini, and OpenAI** can all do this. Here some more detailed recommendations:\n\n- **Groq** is the best overall option for most people. It's free, very accurate, and is one of the fastest services. It can also be used for transcription.\n\n - **Google Gemini** is also extremely accurate and has a generous free tier. Like Groq, it can also be used for transcription, and the Gemini models may be more powerful than Groq's open-source models for summarization.\n\n - **OpenAI** is a good option for summarization, but its transcription models are slow and often reject requests.\n\n - **Anthropic** is a good option for summarization, but it does not offer transcription.\n\n - **Cerebras** is similar to Groq, offering open-source Meta Llama models. It is usually the fastest LLM option and has a free tier. It does not offer transcription models.`,
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
					label: "Cerebras",
					value: "cerebras",
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
        
        // Start with previous props
        let props = { ...previousPropDefs };

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
                },
                assemblyai: {
                    name: "AssemblyAI",
                    recommended: "best",
                    models: ["best", "slam-1", "nano", "universal"],
                    prop: "assemblyai",
                    app: {
                        type: "app",
                        app: "assemblyai",
                        description: "This is AssemblyAI's app property. After this loads, you should see AssemblyAI's model options.",
                        reloadProps: true
                    }
                },
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
                    recommended: "meta-llama/llama-4-scout-17b-16e-instruct",
                    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"],
                    prop: "groqcloud",
                    app: {
                        type: "app",
                        app: "groqcloud",
                        description: "This is Groq's app property. After this loads, you should see Groq's model options.",
                        reloadProps: true
                    }
                },
                cerebras: {
                    name: "Cerebras",
                    recommended: "llama-4-scout-17b-16e-instruct",
                    models: ["llama-4-scout-17b-16e-instruct", "llama3.1-8b", "llama-3.3-70b"],
                    prop: "cerebras",
                    app: {
                        type: "app",
                        app: "cerebras",
                        description: "This is Cerebras' app property. After this loads, you should see Cerebras' model options.",
                        reloadProps: true
                    }
                }
            }
        };

        const manageProperties = () => {

            const allAppProps = new Set([
                ...Object.values(serviceConfigs.transcription).map(config => config.prop),
                ...Object.values(serviceConfigs.ai).map(config => config.prop)
            ]);

            const selectedTranscriptionService = this.transcription_service;
            const selectedAiService = this.ai_service;

            allAppProps.forEach(propName => {
                if (props[propName]) {
                    props[propName].hidden = true;
                    props[propName].disabled = true;
                }
            });

            if (selectedTranscriptionService && selectedTranscriptionService !== 'none') {
                const config = serviceConfigs.transcription[selectedTranscriptionService];
                if (config) {

                    if (props[config.prop]) {
                        props[config.prop].hidden = false;
                        props[config.prop].disabled = false;
                    }

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

                if (props.transcription_model) {
                    props.transcription_model.hidden = true;
                    props.transcription_model.disabled = true;
                }
            }

            props.advanced_options = {
                type: "boolean",
                label: "Enable Advanced Options",
                description: `Set this to **True** to enable advanced options for this workflow.`,
                default: false,
                optional: true,
                reloadProps: true,
            };

            if (this.advanced_options === true) {

                props.chunk_size = {
                    type: "integer",
                    label: "Audio File Chunk Size",
                    description: `By default, your audio file will be split into 10mb chunks before being sent to your chosen transcription service. This is done both to handle the max file size limits of some transcription services and to greatly speed up the transcription process, which reduces credit usage.\n\nYou can change the chunk size here to be anywhere between 4mb and 24mb; however, chunks will also be limited to 10 minutes in length.\n\n**Note:** Deepgram, AssemblyAI, Gemini, and ElevenLabs can accept larger files. You can set **Disable Chunking** to **True** below if you'd like to send the entire file at once.`,
                    optional: true,
                    min: 4,
                    max: 24,
                    default: 10,
                };

                props.disable_chunking = {
                    type: "boolean",
                    label: "Disable Chunking",
                    description: `When enabled, this will disable chunking of your audio file. This will cause the workflow to send your entire file to the transcription service at once (if possible), which may result in a longer runtime and/or higher credit usage.`,
                    default: false,
                    optional: true,
                };

                props.keep_file = {
                    type: "boolean",
                    label: "Keep File",
                    description: `When enabled, this step will not actively try to delete the original audio file in /tmp/ in normal, successful runs. This is useful if you want to use the audio file in another step – for example, the Send to Notion step can be set to upload the file to Notion.\n\n**Note:** Pipedream may still automatically delete the file when it cleans up the /tmp/ directory. This can often happen when you're setting up and testing the workflow. If it does happen, you can re-test your Download File step to re-download the file to /tmp/.`,
                    default: true,
                    optional: true,
                };

                props.enable_downsampling = {
                    type: "boolean",
                    label: "Enable Audio Downsampling",
                    description: `When enabled, this will downsample your audio file to 16kHz mono and convert it to M4A format (32kbps) before transcription. You probably don't need this.`,
                    default: false,
                    optional: true,
                };

                props.path_to_file = {
                    type: "string",
                    label: "Path to File",
                    description: `If you've downloaded your audio file to temporary storage and know the path to it, you can enter it here.\n\nPath should start with /tmp/ and include the file name. Example: /tmp/my-audio-file.mp3\n\nIf a previous step has provided the entire path to the file, you can reference that step's path here.\n\nIf a previous step has provided the file name, you can reference it like so: /tmp/{{file_name_variable}}\n\nIf you have a value here, it will override the default behavior of the workflow, which looks for specific 'download to temp' action steps for Google Drive, Microsoft OneDrive, and Dropbox. You can use this if you're downloading your file to temp storage using another type of action step.`,
                    optional: true,
                };

                props.file_link = {
                    type: "string",
                    label: "File Link (Cloud Storage)",
                    description: `If you've provided a custom Path to File, you can also provide the link to the file from your trigger step here. If you don't provide a value here, your final Notion page may not contain a link to the audio file.`,
                    optional: true,
                };

                props.debug = {
                    type: "boolean",
                    label: "Enable Debug Mode",
                    description: `When enabled, this will enable debug mode, which will cause this step to return the full JSON objects for each transcript and summary response.\n\nThis will increase workflow memory usage, so you should only use it when testing workflow steps manually. In Build mode, workflow steps have far more memory available than the default 256mb that deployed workflows have.`,
                    default: false,
                    optional: true,
                };

                props.stop_stage = {
                    type: "string",
                    label: "Stop Stage",
                    description: `Set this to the stage you'd like to stop at. This setting should only be used for debugging purposes.`,
                    options: ["chunking", "transcription", "cleanup", "summary", "translation"],
                    optional: true,
                };

            } else {
                const advancedProps = [
                    'chunk_size',
                    'disable_chunking',
                    'keep_file',
                    'enable_downsampling',
                    'path_to_file',
                    'file_link',
                    'debug',
                    'stop_stage'
                ];
                advancedProps.forEach(prop => {
                    if (props[prop]) {
                        props[prop].hidden = true;
                        props[prop].disabled = true;
                    }
                });
            }

            if (
                this.advanced_options === true && (
                    this.transcription_model === "slam-1" ||
                    this.ai_cleanup === true
                )
            ) {
                props.keyterms = {
                    type: "string[]",
                    label: "Key Terms",
                    description: `Enter an array of key terms that the transcription model may need help with.\n\nIf you're using **AssemblyAI** as your transcription service with the **slam-1** model and an English-language audio file, these terms [will be included in the key_terms parameter of the transcription request](https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/improving-transcript-accuracy). No other transcription services or models currently support this feature within this workflow.\n\nIf you've enabled **AI Cleanup**, these key terms will be included in the system prompt for the LLM that cleans up the transcript.`,
                    optional: true,
                };
            } else {
                if (props.keyterms) {
                    props.keyterms.hidden = true;
                    props.keyterms.disabled = true;
                }
            }

            if (selectedAiService && selectedAiService !== 'none') {
                const config = serviceConfigs.ai[selectedAiService];
                if (config) {

                    if (props[config.prop]) {
                        props[config.prop].hidden = false;
                        props[config.prop].disabled = false;
                    }

                    props.ai_model = {
                        type: "string",
                        label: "AI Model",
                        description: `Select the ${config.name} model you'd like to use for summarization. If you're not sure, **${config.recommended}** is recommended.`,
                        options: config.models,
                        hidden: false,
                        disabled: false,
                        reloadProps: true
                    };

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
                            "Jokes",
                            "Chapters",
                        ],
                        optional: true,
                        default: ["Summary"],
                        hidden: false,
                        disabled: false
                    };

                    props.custom_prompt = {
                        type: "string",
                        label: "Custom Section Prompt (Optional)",
                        description: `If you'd like to generate a section not listed in the Summary Options, you can enter a custom prompt here.\n\n*Example: "Create a blog post draft from the transcript."*\n\nThis will be set as the system instructions for a prompt that will contain your *entire* transcript (unlike Summary Options, which run prompts on chunks of your transcript as defined by the Summary Density setting).\n\nThis prompt will return a **single Markdown string**, which you'll find in the \`custom_prompt\` property of this step's output.\n\nIn the \`Send to Notion\` step, you can choose whether or not to include this section.`,
                        optional: true,
                        hidden: false,
                        disabled: false,
                    }

                    if (this.advanced_options === true) {
                        
                        if (this.transcription_model?.toLowerCase().includes('whisper') || this.transcription_model?.toLowerCase().includes('gpt-4o-transcribe') || this.transcription_model?.toLowerCase().includes('gpt-4o-mini-transcribe') || this.transcription_model?.toLowerCase().includes('gemini')) {
                            
                            props.whisper_prompt = {
                                type: "string",
                                label: "Transcription Prompt (Optional)",
                                description: `You can enter a prompt here to help guide the transcription model's style.`,
                                optional: true,
                            };

                            props.whisper_temperature = {
                                type: "integer",
                                label: "Transcription Temperature",
                                description: `Set the temperature for the transcription model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0.`,
                                optional: true,
                                min: 0,
                                max: 20,
                            };
                        } else {

                            if (props.whisper_prompt) {
                                props.whisper_prompt.hidden = true;
                                props.whisper_prompt.disabled = true;
                            }
                            if (props.whisper_temperature) {
                                props.whisper_temperature.hidden = true;
                                props.whisper_temperature.disabled = true;
                            }
                        }

                        if (this.ai_service && this.ai_service !== 'none') {
                            props.translation_language = {
                                type: "string",
                                label: "Translation Language",
                                description: `If you set a language here, your transcript and chosen summary options will translated into that language (if it differs from the language of the transcript).\n\n**Note:** This feature uses your chosen **AI Model** to translate the transcript once the transcription step is complete. It will increase the run time (and potentially the cost) of the workflow.`,
                                optional: true,
                                options: lang.LANGUAGES.map((lang) => ({
                                    label: lang.label,
                                    value: lang.value,
                                })),
                                reloadProps: true,
                            };

                            props.ai_cleanup = {
                                type: "boolean",
                                label: "Enable AI Cleanup",
                                description: `Set this feature to true to enable AI cleanup of the transcript. This will send each chunk of your transcript to your chosen **AI Model** in order to clean it up. If you've provided an array of terms in the **Key Terms** field, these terms will be included in the system prompt for the LLM that cleans up the transcript.\n\n**Note:** This feature will increase the run time (and potentially the cost) of the workflow. It works identically to the translation feature.`,
                                default: false,
                                optional: true,
                            };
                            
                            props.summary_density = {
                                type: "integer",
                                label: "Summary Density (Advanced)",
                                description: `Sets the maximum number of paragraphs for each chunk of your transcript, and therefore the max number of paragraphs that will be sent to your chosen LLM in each summarization request.\n\nA smaller number will result in a more "dense" summary, as the same summarization prompt will be run for a smaller chunk of the transcript – hence, more requests will be made, as the transcript will be split into more chunks.\n\nSplitting the transcript into chunks will also slightly speed up the workflow, as each chunk will be sent to the LLM in parallel – except the first chunk. It is sent ahead of time, allowing its summary to be included in the system instructions for all other chunks in order to improve summary quality.\n\nDefaults to 20 paragraphs (of 3 sentences each), with a minimum of 1 and a maximum of 5,000.\n\n**Note:** Depending on your chosen AI model, it is possible to set this number too high for the model's context window. This workflow does not estimate the number of tokens in each request (the libraries for doing so are too large), but a good rule of thumb is that 100 tokens roughly equals 75 English-language words.`,
                                min: 1,
                                max: 5000,
                                default: 20,
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
                                description: `Set the temperature for the AI model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0.`,
                                optional: true,
                                min: 0,
                                max: 20,
                            };
                        } else {

                            if (props.translation_language) {
                                props.translation_language.hidden = true;
                                props.translation_language.disabled = true;
                            }

                            if (props.ai_cleanup) {
                                props.ai_cleanup.hidden = true;
                                props.ai_cleanup.disabled = true;
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
                        const advancedProps = [
                            'whisper_prompt',
                            'whisper_temperature',
                            'translation_language',
                            'ai_cleanup',
                            'summary_density',
                            'verbosity',
                            'ai_temperature',
                            'chunk_size',
                            'disable_chunking',
                            'keep_file',
                            'enable_downsampling',
                            'path_to_file',
                            'debug',
                            'stop_stage'
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
                
                if (props.ai_model) {
                    props.ai_model.hidden = true;
                    props.ai_model.disabled = true;
                }

                if (props.summary_options) {
                    props.summary_options.hidden = true;
                    props.summary_options.disabled = true;
                }

                if (props.custom_prompt) {
                    props.custom_prompt.hidden = true;
                    props.custom_prompt.disabled = true;
                }
                
                if (props.advanced_options) {
                    props.advanced_options.hidden = false;
                    props.advanced_options.disabled = false;
                }
            } else {
                if (props.ai_model) {
                    props.ai_model.hidden = true;
                    props.ai_model.disabled = true;
                }
                if (props.summary_options) {
                    props.summary_options.hidden = true;
                    props.summary_options.disabled = true;
                }
                if (props.custom_prompt) {
                    props.custom_prompt.hidden = true;
                    props.custom_prompt.disabled = true;
                }
                if (props.advanced_options) {
                    props.advanced_options.hidden = true;
                    props.advanced_options.disabled = true;
                }
            }
        };

        const initializeAppProps = () => {
            Object.values(serviceConfigs.transcription).forEach(config => {
                if (!props[config.prop]) {
                    props[config.prop] = {
                        ...config.app,
                        hidden: true,
                        disabled: true
                    };
                }
            });

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

        initializeAppProps();

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
    },
    async run({ steps, $ }) {

        this.start_time = Date.now();
        this.timeout_seconds = this.debug === true ? 290 : 10000

		let stageDurations = {
			setup: 0,
            chunking: 0,
			transcription: 0,
			transcriptCombination: 0,
            cleanup: 0,
            translation: 0,
			summary: 0,
            custom_prompt: 0,
            total: 0
		};

		function totalDuration(obj) {
			return Object.keys(obj)
				.filter((key) => typeof obj[key] === "number" && key !== "total")
				.reduce((a, b) => a + obj[b], 0);
		}

		let previousTime = process.hrtime.bigint();
        
        console.log("=== STARTING RUN ===");

        console.log("Initializing required advanced properties...");

        if (this.keep_file === undefined) this.keep_file = true;
        if (this.chunk_size === undefined) this.chunk_size = 10;
        if (this.disable_chunking === undefined) this.disable_chunking = false;
        if (this.enable_downsampling === undefined) this.enable_downsampling = false;
        if (this.summary_density === undefined) this.summary_density = 20;

        console.log("Logging Settings...");
        const logSettings = {
            transcription_service: this.transcription_service,
            ai_service: this.ai_service,
            transcription_model: this.transcription_model,
            ai_model: this.ai_model,
            summary_options: this.summary_options,
            custom_prompt: this.custom_prompt,
            advanced_options: this.advanced_options,
            translation_language: this.translation_language,
            ai_cleanup: this.ai_cleanup,
            keyterms: this.keyterms,
            whisper_prompt: this.whisper_prompt,
            whisper_temperature: this.whisper_temperature,
            summary_density: this.summary_density,
            verbosity: this.verbosity,
            ai_temperature: this.ai_temperature,
            chunk_size: this.chunk_size,
            disable_chunking: this.disable_chunking,
            keep_file: this.keep_file,
            enable_downsampling: this.enable_downsampling,
            path_to_file: this.path_to_file,
            file_link: this.file_link,
            debug: this.debug,
            stop_stage: this.stop_stage
        }
        console.dir(logSettings);

        const serviceConfigs = {
            transcription: {
                openai: {
                    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]
                },
                deepgram: {
                    models: ["nova-3", "nova-2", "nova-general"]
                },
                groqcloud: {
                    models: ["whisper-large-v3-turbo", "distil-whisper-large-v3-en", "whisper-large-v3"]
                },
                google_gemini: {
                    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"]
                },
                elevenlabs: {
                    models: ["scribe_v1"]
                },
                assemblyai: {
                    models: ["best", "slam-1", "nano", "universal"]
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
                },
                cerebras: {
                    models: ["llama-4-scout-17b-16e-instruct", "llama3.1-8b", "llama-3.3-70b"]
                }
            }
        };

        const commonMimes = [".flac", ".mp3", ".wav", ".webm", ".ogg", ".aac", ".m4a"];
        
        const serviceSpecificMimes = {
            openai: [".mp4", ".mpeg", ".mpga"],
            deepgram: [
                ".mp4", ".mp2", ".pcm", 
                ".opus", ".amr", ".mulaw", ".alaw", ".speex", ".g729"
            ],
            groqcloud: [".mp4", ".mpeg", ".mpga"],
            google_gemini: [".aiff"],
            elevenlabs: [
                ".aiff", ".mpeg3", ".opus", 
                ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".3gp"
            ],
            assemblyai: [".mp4"]
        };

        this.supportedMimes = [...commonMimes];

        if (this.transcription_service && this.transcription_service !== 'none') {
            this.supportedMimes = [
                ...commonMimes,
                ...(serviceSpecificMimes[this.transcription_service] || [])
            ];
        }

        if (this.transcription_service && this.transcription_service !== 'none') {
            const serviceProp = this[this.transcription_service];
            if (!serviceProp) {
                throw new Error(`Transcription service ${this.transcription_service} is not properly configured. Please check your API key and try again.`);
            }

            const availableModels = serviceConfigs.transcription[this.transcription_service]?.models || [];
            if (!availableModels.includes(this.transcription_model)) {
                throw new Error(
                    `Invalid transcription model "${this.transcription_model}" for service ${this.transcription_service}. ` +
                    `Available models are: ${availableModels.join(', ')}`
                );
            }
        }

        if (this.ai_service && this.ai_service !== 'none') {
            const serviceProp = this[this.ai_service];
            if (!serviceProp) {
                throw new Error(`AI service ${this.ai_service} is not properly configured. Please check your API key and try again.`);
            }

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
				`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file to Dropbox, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`
			);
		}

        console.log("Checking that file is within size limits...");
        this.file_size = this.steps.trigger.event.size;
		await this.checkSize(this.file_size, true);


        const eventSizeInMB = this.file_size / 1000000;
        const maxChunkSize = this.chunk_size || 24;
        const directUploadServices = ['deepgram', 'assemblyai', 'google_gemini', 'elevenlabs'];
        const DIRECT_UPLOAD_THRESHOLD = 700;

        if (directUploadServices.includes(this.transcription_service) &&
            eventSizeInMB <= DIRECT_UPLOAD_THRESHOLD &&
            this.disable_chunking === true
        ) {
            console.log(`Direct upload service ${this.transcription_service} is selected, file size is less than the direct upload threshold of ${DIRECT_UPLOAD_THRESHOLD}MB, and disable chunking is true. Uploading directly to transcription service.`);

            this.direct_upload = true;

        } else if (eventSizeInMB <= maxChunkSize) {
            console.log(`File size is less than the max chunk size. Uploading directly to transcription service ${this.transcription_service}.`);
            this.direct_upload = true;
        } else {
            console.log(`File size is greater than the max chunk size. Chunking file for transcription...`);
            if (!this.chunk_size) {
                this.chunk_size = 10;
            }
            this.direct_upload = false;
        }

        const fileInfo = {};

        fileInfo.metadata = {};

		fileInfo.metadata.log_settings = logSettings;

		stageDurations.setup = Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(`Setup stage duration: ${stageDurations.setup.toFixed(2)}ms (${
			(stageDurations.setup / 1000).toFixed(3)
		} seconds)`);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
				(totalDuration(stageDurations) / 1000).toFixed(3)
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

        /* -- Download Stage -- */

        console.log("=== DOWNLOAD STAGE ===");

        if (this.path_to_file && this.path_to_file !== "") {
            console.log("User has set a custom file path for the audio file. Using that path instead of the default behavior.");

            if (!/^\/tmp\/.+/.test(this.path_to_file)) {
                throw new Error("Invalid custom file path. You have a value set in the Path to File property; please ensure the path starts with /tmp/ and includes the file name. Example: /tmp/my-audio-file.mp3");
            }

            fileInfo.metadata.cloud_app = "Custom";
            fileInfo.metadata.path = this.path_to_file;
            fileInfo.file_name = fileInfo.metadata.path.replace(/^\/tmp\//, "")
            console.log(`File path of custom file: ${fileInfo.metadata.path}`);
            fileInfo.metadata.mime = fileInfo.metadata.path.match(/\.\w+$/)[0];
            
            if (this.file_link && this.file_link !== "") {
                console.log("User has provided a file link. Using that link instead of the default behavior.");
                fileInfo.link = this.file_link;
            } else {
                console.log("No file link provided. Checking if the trigger step has any of the supported cloud storage link variables.");
                if (this.steps.trigger.event.webViewLink) {
                    console.log("Trigger step has a webViewLink. Using that link.");
                    fileInfo.link = this.steps.trigger.event.webViewLink;
                } else if (this.steps.trigger.event.webUrl) {
                    console.log("Trigger step has a webUrl. Using that link.");
                    fileInfo.link = this.steps.trigger.event.webUrl;
                } else if (this.steps.trigger.event.link) {
                    console.log("Trigger step has a link variable. Using that link.");
                    fileInfo.link = this.steps.trigger.event.link;
                } else {
                    console.log("No file link provided. Using the default behavior.");
                    fileInfo.link = this.steps.trigger.event.webViewLink;
                }
            }

            if (this.supportedMimes.includes(fileInfo.metadata.mime) === false) {
                console.warn("Unsupported file type. File will be downsampled and converted to m4a before being processed.");
            }
        } else if (this.steps.download_file?.$return_value?.filePath) {
			// Google Drive method
            console.log("User appears to be using the current Google Drive → download_file action.")
			fileInfo.metadata.cloud_app = "Google Drive";
			fileInfo.file_name =
				this.steps.download_file.$return_value.fileMetadata.name
			fileInfo.metadata.path = this.steps.download_file.$return_value.filePath;
			console.log(`File path of Google Drive file: ${fileInfo.metadata.path}`);
			fileInfo.metadata.mime = fileInfo.metadata.path.match(/\.\w+$/)[0];
			fileInfo.link = this.steps.trigger.event.webViewLink;
			if (this.supportedMimes.includes(fileInfo.metadata.mime) === false) {
				console.warn("Unsupported file type. File will be downsampled and converted to m4a before being processed.");
			}
		} else if (
			this.steps.download_file?.$return_value &&
			/^\/tmp\/.+/.test(this.steps.download_file.$return_value)
		) {
			// MS OneDrive method
            console.log("User appears to be using the current Microsoft OneDrive → ms_onedrive_download action.")
			fileInfo.metadata.cloud_app = "Microsoft OneDrive";
			fileInfo.metadata.path = this.steps.download_file.$return_value
			fileInfo.file_name = fileInfo.metadata.path.replace(/^\/tmp\//, "")
			console.log(`File path of MS OneDrive file: ${fileInfo.metadata.path}`);
			fileInfo.metadata.mime = fileInfo.metadata.path.match(/\.\w+$/)[0];
			fileInfo.link = this.steps.trigger.event.webUrl;
			if (this.supportedMimes.includes(fileInfo.metadata.mime) === false) {
				console.warn("Unsupported file type. File will be downsampled and converted to m4a before being processed.");
			}
		} else if (this.steps.download_file_to_tmp?.$return_value) {
            // Official Dropbox method
            console.log("User appears to be using the current Dropbox → download_file_to_tmp action.")
			fileInfo.metadata.cloud_app = "Dropbox";
			fileInfo.metadata.path = this.steps.download_file_to_tmp.$return_value.tmpPath
            fileInfo.file_name = this.steps.download_file_to_tmp.$return_value.name
            fileInfo.metadata.mime = this.steps.download_file_to_tmp.$return_value.name.match(/\.\w+$/)[0];
            fileInfo.link = this.steps.trigger.event.link;

            if (this.supportedMimes.includes(fileInfo.metadata.mime) === false) {
                console.warn("Unsupported file type. File will be downsampled and converted to m4a before being processed.");
            }
        } else {
			// Legacy built-in Dropbox method. Deprecated in favor of using the official Dropbox → download_file_to_tmp action.
            console.log("User appears to be using the legacy built-in Dropbox method.")
			fileInfo.metadata.cloud_app = "Dropbox";
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
			console.log(`File path of Dropbox file: ${fileInfo.metadata.path}`);
		}

		this.filePath = fileInfo.metadata.path;
		this.fileName = fileInfo.file_name;
		this.fileLink = fileInfo.link;

        await this.checkFileExists(this.filePath);

		fileInfo.metadata.duration = await this.getDuration(fileInfo.metadata.path);
        fileInfo.metadata.duration_formatted = this.formatDuration(fileInfo.metadata.duration);

        this.duration = fileInfo.metadata.duration;

        console.log(`File duration: ${fileInfo.metadata.duration_formatted}`);

        stageDurations.download = Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Download stage duration: ${stageDurations.download.toFixed(2)}ms (${
                (stageDurations.download / 1000).toFixed(3)
            } seconds)`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                (totalDuration(stageDurations) / 1000).toFixed(3)
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        /* -- Chunking/Conversion Stage -- */

        console.log("=== CHUNKING/CONVERSION STAGE ===");

        let fileToProcess = fileInfo.metadata.path;

        if ((this.advanced_options && this.enable_downsampling === true) || !this.supportedMimes.includes(fileInfo.metadata.mime)) {
            if (this.advanced_options && this.enable_downsampling === true) {
                console.log("Downsampling enabled. Processing audio file...");
            } else {
                console.log("Unsupported file type. File will be downsampled and converted to m4a before being processed.");
            }

            const downsampledResult = await this.downsampleAudio({ file: fileInfo.metadata.path });
            fileToProcess = downsampledResult.path;
            console.log(`Using downsampled file: ${fileToProcess}`);
            console.log(`Size reduction: ${downsampledResult.sizeReduction}%`);
        }
        
        let chunkFiles;
        if (this.direct_upload === true) {
            chunkFiles = {
                files: [fileToProcess.replace(/^\/tmp\//, "")],
                outputDir: "/tmp"
            }
        } else {
            chunkFiles = await this.chunkFile({ file: fileToProcess });
        }

        stageDurations.chunking =
        Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Chunking stage duration: ${stageDurations.chunking.toFixed(2)}ms (${
                (stageDurations.chunking / 1000).toFixed(3)
            } seconds)`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                (totalDuration(stageDurations) / 1000).toFixed(3)
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        if (this.stop_stage === "chunking" || await this.earlyTermination()) {
            console.log("Stopping workflow at chunking stage.");
            return fileInfo;
        }

        /* -- Transcription Stage -- */

        console.log("=== TRANSCRIPTION STAGE ===");

        console.log(`Transcribing file(s): ${chunkFiles.files}`);

        fileInfo.chunks = {}

        fileInfo.chunks.transcript_responses = await this.transcribeFiles({
            files: chunkFiles.files,
            outputDir: chunkFiles.outputDir,
        })

        await this.cleanTmp({cleanChunks: true, keepFile: this.keep_file});

		stageDurations.transcription =
        Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Transcription stage duration: ${stageDurations.transcription.toFixed(2)}ms (${
                (stageDurations.transcription / 1000).toFixed(3)
            } seconds)`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                (totalDuration(stageDurations) / 1000).toFixed(3)
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        if (this.stop_stage === "transcription" || await this.earlyTermination()) {
            console.log("Stopping workflow at transcription stage.");
            return fileInfo;
        }

        /* -- Transcript Combination Stage -- */

        console.log("=== TRANSCRIPT COMBINATION STAGE ===");

        this.logMemoryUsage('Start of transcript combination');

        console.log("Combining transcript chunks...");
        fileInfo.full_transcript = await this.combineTranscriptChunks(fileInfo.chunks.transcript_responses)

        this.logMemoryUsage('After combining transcript chunks');

        if (fileInfo.chunks.transcript_responses.every(chunk => chunk.vtt)) {
            console.log("Combining VTT chunks...");
            fileInfo.full_vtt = await this.combineVTTChunks(fileInfo.chunks.transcript_responses)
        }

        this.logMemoryUsage('After combining VTT chunks');

        if (!this.debug) {
            this.cleanupLargeObjects({object: fileInfo.chunks.transcript_responses, objectName: 'fileInfo.chunks.transcript_responses', debug: this.debug});
        }

        this.logMemoryUsage('After cleaning transcript responses');

        fileInfo.metadata.paragraphs = {
            transcript: this.makeParagraphs(fileInfo.full_transcript, 1200),
            ...(fileInfo.full_vtt && fileInfo.full_vtt.length > 0 && {
                vtt: fileInfo.full_vtt.split("\n\n").map(segment => {
                    const lines = segment.split('\n');
                    while (lines.length && lines[0].trim() === '') lines.shift();
                    return lines.join('\n').trim();
                }).filter(segment => segment.length > 0),
            })
        };

        this.logMemoryUsage('After creating paragraphs');

        stageDurations.transcriptCombination =
        Number(process.hrtime.bigint() - previousTime) / 1e6;
        console.log(
            `Transcript combination stage duration: ${stageDurations.transcriptCombination.toFixed(2)}ms (${
                (stageDurations.transcriptCombination / 1000).toFixed(3)
            } seconds)`
        );
        console.log(
            `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                (totalDuration(stageDurations) / 1000).toFixed(3)
            } seconds)`
        );
        previousTime = process.hrtime.bigint();

        if (this.ai_cleanup === true) {
            /* === AI CLEANUP STAGE === */

            console.log("=== AI CLEANUP STAGE ===");

            console.log("Cleaning up transcript with AI...");

            const transcriptParagraphs = fileInfo.metadata.paragraphs.transcript.map(paragraph => paragraph.trim()).filter(paragraph => paragraph.length > 0);
            const groupedTranscript = [];
            for (let i = 0; i < transcriptParagraphs.length; i += 10) {
                groupedTranscript.push(transcriptParagraphs.slice(i, i + 10).join(" "));
            }

            console.log(`Condensed ${transcriptParagraphs.length} paragraphs into ${groupedTranscript.length} chunks for cleanup. Processing...`);
            
            const cleanedTranscript = await this.cleanupParagraphs({
                service: this.ai_service,
                model: this.ai_model,
                stringsArray: groupedTranscript,
                ...(this.keyterms && this.keyterms.length > 0 && { keyterms: this.keyterms })
            });

            if (cleanedTranscript.error) {
                console.error(`Cleanup failed: ${cleanedTranscript.error_message}. Preserving original transcript.`);
            } else {
                console.log(`Making paragraphs from cleaned transcript...`);

                fileInfo.metadata.paragraphs.transcript = this.makeParagraphs(
                    cleanedTranscript.paragraphs.join(" "),
                    1200
                );
                fileInfo.full_transcript = cleanedTranscript.paragraphs.join(" ");
            }

            console.log(`Finished cleaning transcript.`);

            stageDurations.cleanup =
            Number(process.hrtime.bigint() - previousTime) / 1e6;
            console.log(
                `Cleanup stage duration: ${stageDurations.cleanup.toFixed(2)}ms (${
                    (stageDurations.cleanup / 1000).toFixed(3)
                } seconds)`
            );
            console.log(
                `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                    (totalDuration(stageDurations) / 1000).toFixed(3)
                } seconds)`
            );
            previousTime = process.hrtime.bigint();

            if (this.stop_stage === "cleanup" || await this.earlyTermination()) {
                console.log("Stopping workflow at cleanup stage.");
                return fileInfo;
            }
        }

        if (this.ai_service && this.ai_service !== "none") {
            
            console.log(`Using ${this.ai_service} and model ${this.ai_model} for summarization.`);

            /* -- Summary Stage -- */

            console.log("=== SUMMARY STAGE ===");

            this.logMemoryUsage('Start of summary stage');

            const maxParagraphs = this.summary_density
                ? this.summary_density
                : 5;

            fileInfo.chunks.summary_chunks = this.splitTranscript(
                fileInfo.metadata.paragraphs.transcript,
                maxParagraphs
            );

            this.logMemoryUsage('After splitting transcript');

            if (this.summary_options === null || this.summary_options.length === 0) {
                console.log("No summary options selected. Using the first chunk as the title.");
                
                const titleArr = [fileInfo.chunks.summary_chunks[0]];
                fileInfo.chunks.summary_responses = await this.sendToChat({
                    service: this.ai_service,
                    model: this.ai_model,
                    stringsArray: titleArr,
                });
            } else {
                console.log("Summary options selected. Using the selected options.");
                
                fileInfo.chunks.summary_responses = await this.sendToChat({
                    service: this.ai_service,
                    model: this.ai_model,
                    stringsArray: fileInfo.chunks.summary_chunks,
                });
            }

            this.logMemoryUsage('After getting summary responses');

            console.log(`Summary array preview from ${this.ai_service} (${this.ai_model}):`);
            console.log(JSON.stringify(fileInfo.chunks.summary_responses, null, 2).slice(0, 1000) + "...");

            fileInfo.metadata.formatted_chat = await this.formatChat(fileInfo.chunks.summary_responses);

            this.logMemoryUsage('After formatting chat');

            // Clean up the entire chunks object now that we're done with it
            if (!this.debug) {
                this.cleanupLargeObjects({object: fileInfo.chunks, objectName: 'fileInfo.chunks', debug: this.debug});
            }

            this.logMemoryUsage('After cleaning chunks object');

            if (this.summary_options.includes("Summary")) {
                fileInfo.metadata.paragraphs.summary = this.makeParagraphs(fileInfo.metadata.formatted_chat.summary, 1200);
            }

            stageDurations.summary = Number(process.hrtime.bigint() - previousTime) / 1e6;
            console.log(
                `Summary stage duration: ${stageDurations.summary.toFixed(2)}ms (${
                    (stageDurations.summary / 1000).toFixed(3)
                } seconds)`
            );
            console.log(
                `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                    (totalDuration(stageDurations) / 1000).toFixed(3)
                } seconds)`
            );
            previousTime = process.hrtime.bigint();

            if (this.stop_stage === "summary" || await this.earlyTermination()) {
                console.log("Stopping workflow at summary stage.");
                return fileInfo;
            }

            if (this.custom_prompt && this.custom_prompt !== "") {
                
                /* === CUSTOM PROMPT STAGE === */

                console.log("=== CUSTOM PROMPT STAGE ===");

                console.log(`Generating custom section with prompt: ${this.custom_prompt}`);

                fileInfo.metadata.custom_prompt = await this.sendToChatCustomPrompt({
                    service: this.ai_service,
                    model: this.ai_model,
                    transcript: fileInfo.full_transcript,
                    custom_prompt: this.custom_prompt,
                });

                stageDurations.custom_prompt = Number(process.hrtime.bigint() - previousTime) / 1e6;
                console.log(
                    `Custom prompt stage duration: ${stageDurations.custom_prompt.toFixed(2)}ms (${
                        (stageDurations.custom_prompt / 1000).toFixed(3)
                    } seconds)`
                );
                console.log(
                    `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                        (totalDuration(stageDurations) / 1000).toFixed(3)
                    } seconds)`
                );
                previousTime = process.hrtime.bigint();
                
            }

            if (this.translation_language && this.translation_language !== "") {
                
                /* === TRANSLATION STAGE === */

                console.log("=== TRANSLATION STAGE ===");
                
                console.log(
                    `User specified ${this.translation_language} for the translation. Checking if the transcript language matches...`
                );
    
                const detectedLanguage = await this.detectLanguage(
                    this.ai_service,
                    this.chat_model,
                    fileInfo.metadata.paragraphs.transcript[0]
                );

                if (detectedLanguage.error) {
                    console.error(`Language detection failed: ${detectedLanguage.error_message}. Will skip translation.`);
                } else {
                    console.log(`Detected language of the transcript is ${detectedLanguage.label} (ISO 639-1 code: ${detectedLanguage.value}).`);
                }
    
                fileInfo.metadata.original_language = detectedLanguage;

                if (!detectedLanguage.error && detectedLanguage.value !== this.translation_language) {
                    console.log(`Translating the transcript to ${this.translation_language}...`);

                    const transcriptParagraphs = fileInfo.metadata.paragraphs.transcript.map(paragraph => paragraph.trim()).filter(paragraph => paragraph.length > 0);
                    const groupedTranscript = [];
                    for (let i = 0; i < transcriptParagraphs.length; i += 10) {
                        groupedTranscript.push(transcriptParagraphs.slice(i, i + 10).join(" "));
                    }

                    console.log(`Condensed ${transcriptParagraphs.length} paragraphs into ${groupedTranscript.length} chunks for translation. Translating...`);
                    
                    const translatedTranscript = await this.translateParagraphs({
                        service: this.ai_service,
                        model: this.chat_model,
                        stringsArray: groupedTranscript,
                        languageCode: this.translation_language
                    });

                    if (translatedTranscript.error) {
                        console.error(`Translation failed: ${translatedTranscript.error_message}. Preserving original transcript.`);
                    } else {
                        console.log(`Making paragraphs from translated transcript...`);

                        fileInfo.metadata.paragraphs.translated_transcript = this.makeParagraphs(
                            translatedTranscript.paragraphs.join(" "),
                            1200
                        );
                    }

                    stageDurations.translation =
                    Number(process.hrtime.bigint() - previousTime) / 1e6;
                    console.log(
                        `Translation stage duration: ${stageDurations.translation.toFixed(2)}ms (${
                            (stageDurations.translation / 1000).toFixed(3)
                        } seconds)`
                    );
                    console.log(
                        `Total duration so far: ${totalDuration(stageDurations).toFixed(2)}ms (${
                            (totalDuration(stageDurations) / 1000).toFixed(3)
                        } seconds)`
                    );
                    previousTime = process.hrtime.bigint();

                    if (this.stop_stage === "translation" || await this.earlyTermination()) {
                        console.log("Stopping workflow at translation stage.");
                        return fileInfo;
                    }
                }

            }

        } else {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        fileInfo.final_results = {}

        if (fileInfo.metadata.paragraphs && fileInfo.metadata.paragraphs.summary) {
            fileInfo.final_results.summary = fileInfo.metadata.paragraphs.summary;
        }

        if (fileInfo.metadata.paragraphs.translated_transcript) {
            fileInfo.final_results.transcript = fileInfo.metadata.paragraphs.translated_transcript;
            fileInfo.final_results.original_language_transcript = fileInfo.metadata.paragraphs.transcript;
        } else {
            fileInfo.final_results.transcript = fileInfo.metadata.paragraphs.transcript;
        }

        if (fileInfo.metadata.paragraphs.vtt) {
            fileInfo.final_results.vtt = fileInfo.metadata.paragraphs.vtt;
        }

        if (fileInfo.metadata.formatted_chat) {
            Object.keys(fileInfo.metadata.formatted_chat).forEach(key => {
                if (key !== "summary" && key !== "title" && key !== "tokens") {
                    fileInfo.final_results[key] = fileInfo.metadata.formatted_chat[key];
                }
            });
        }

        fileInfo.property_values = {}

        fileInfo.property_values.filename = this.fileName;

        if (fileInfo.metadata.formatted_chat && fileInfo.metadata.formatted_chat.title) {
            fileInfo.property_values.ai_title = fileInfo.metadata.formatted_chat.title;
        }

        fileInfo.property_values.duration = fileInfo.metadata.duration;
        fileInfo.property_values.duration_formatted = fileInfo.metadata.duration_formatted;

        stageDurations.total = totalDuration(stageDurations);
        fileInfo.metadata.performance_metrics = stageDurations;
        fileInfo.metadata.performance_formatted = Object.fromEntries(
            Object.entries(fileInfo.metadata.performance_metrics).map(([stageName, stageDuration]) => [
                stageName,
                stageDuration > 1000
                    ? `${(stageDuration / 1000).toFixed(2)} seconds`
                    : `${stageDuration.toFixed(2)}ms`,
            ])
        );

        const finalReturn = {}
        finalReturn.property_values = fileInfo.property_values;
        finalReturn.property_values.file_link = fileInfo.link;

        finalReturn.page_content = Object.fromEntries(
            Object.entries(fileInfo.final_results).filter(([key, value]) => value.length > 0)
        );

        if (fileInfo.metadata.custom_prompt) {
            finalReturn.custom_prompt = fileInfo.metadata.custom_prompt;
        }

        finalReturn.other_data = {
            file_name: fileInfo.file_name,
            full_transcript: fileInfo.full_transcript,
            ...(fileInfo.metadata.formatted_chat && fileInfo.metadata.formatted_chat.summary && { summary: fileInfo.metadata.formatted_chat.summary }),
            ...(fileInfo.full_vtt && { full_vtt: fileInfo.full_vtt }),
            ...(this.debug && this.debug === true && { chunks: fileInfo.chunks }),
            performance: fileInfo.metadata.performance_formatted,
            metadata: {
                log_settings: fileInfo.metadata.log_settings ?? null,
                cloud_app: fileInfo.metadata.cloud_app ?? null,
                path: fileInfo.metadata.path ?? null,
                mime: fileInfo.metadata.mime ?? null,
                file_size: this.file_size ?? null,
                duration: fileInfo.metadata.duration ?? null,
                duration_formatted: fileInfo.metadata.duration_formatted ?? null,
                longest_gap: fileInfo.metadata.longest_gap ?? null,
                original_language: fileInfo.metadata.original_language ?? null,
            }
        }
        
        this.logMemoryUsage('Final memory log');

        console.log(`Finished transcribing and summarizing the audio file. Total duration: ${fileInfo.metadata.performance_formatted.total}. Note that this duration may be a couple seconds off from Pipedream's internal timer (see Details tab → Duration), which has a higher-level view of the workflow's runtime.`);

        $.export("$summary", `Successfully processed ${fileInfo.file_name} in ${fileInfo.metadata.performance_formatted.total}.`);
        
        return finalReturn;

    }
};
