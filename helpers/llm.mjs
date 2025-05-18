// Import LLM SDKs
import OpenAI from "openai"; // OpenAI SDK
import Groq from "groq-sdk"; // Groq SDK
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenAI } from "@google/genai";
import Cerebras from '@cerebras/cerebras_cloud_sdk'; // Cerebras SDK

// Import local files
import prompts from "./prompts.mjs";
import lang from "./languages.mjs";

// Import utilities
import retry from "async-retry"; // Retry handler
import Bottleneck from "bottleneck";
import { jsonrepair } from "jsonrepair";

export default {
    methods: {
        ...prompts.methods,

        async llmRequest({
            service,
            model,
            prompt,
            systemMessage,
            temperature,
            log_action = (attempt) => `Attempt ${attempt}: Sending request to ${service}`,
            log_success = `Request received successfully.`,
            log_failure = (attempt, error) => `Attempt ${attempt} failed with error: ${error.message}. Retrying...`
        }) {
            return retry(
                async (bail, attempt) => {
                    console.log(log_action(attempt));

                    let response;

                    try {
                        switch (service.toLowerCase()) {
                            case "openai":
                                response = await this.requestOpenAI({
                                    model,
                                    prompt,
                                    systemMessage,
                                    temperature
                                });
                                break;
                            case "groqcloud":
                                response = await this.requestGroq({
                                    model,
                                    prompt,
                                    systemMessage,
                                    temperature
                                });
                                break;
                            case "anthropic":
                                response = await this.requestAnthropic({
                                    model,
                                    prompt,
                                    systemMessage,
                                    temperature
                                });
                                break;
                            case "google_gemini":
                                response = await this.requestGoogle({
                                    model,
                                    prompt,
                                    systemMessage,
                                    temperature
                                });
                                break;
                            case "cerebras":
                                response = await this.requestCerebras({
                                    model,
                                    prompt,
                                    systemMessage,
                                    temperature
                                });
                                break;
                            default:
                                throw new Error(`Unsupported LLM service: ${service}`);
                        }

                        return this.unifyLLMResponse(response, service);
                    } catch (error) {
                        // If this is the last retry attempt, create an error response instead of throwing
                        if (attempt === 3) {
                            console.error(`All retry attempts failed for ${service}. Creating error response.`);
                            console.error(`Final error: ${error.message}`);
                            
                            // Create a response object that exactly matches the unified format
                            return {
                                id: `error-${Date.now()}`,
                                model: model,
                                provider: service,
                                content: JSON.stringify({
                                    title: "Error in processing",
                                    summary: `An error occurred while processing this section: ${error.message}`,
                                    main_points: [],
                                    action_items: [],
                                    stories: [],
                                    references: [],
                                    arguments: [],
                                    follow_up: [],
                                    related_topics: []
                                }),
                                usage: {
                                    prompt_tokens: 0,
                                    completion_tokens: 0,
                                    total_tokens: 0
                                }
                            };
                        }
                        // For non-final attempts, throw the error to trigger retry
                        throw error;
                    }
                },
                {
                    retries: 3,
                    onRetry: (error, attempt) => {
                        console.error(log_failure(attempt, error));
                    },
                }
            );
        },

        async requestOpenAI({ model, prompt, systemMessage, temperature }) {
            const openai = new OpenAI({ apiKey: this.openai.$auth.api_key });
            
            try {
                const response = await openai.chat.completions.create({
                    model: model ?? "gpt-4.1-nano",
                    messages: [
                        {
                            role: "system",
                            content: systemMessage
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    response_format: { type: "json_object" },
                    temperature: temperature / 10 ?? 0.2
                });

                return response;
            } catch (error) {
                throw new Error(`OpenAI request error: ${error.message}`);
            }
        },

        async requestGroq({ model, prompt, systemMessage, temperature }) {
            const groq = new Groq({ apiKey: this.groqcloud.$auth.api_key });
            
            try {
                const response = await groq.chat.completions.create({
                    model: model ?? "llama-3.1-8b-instant",
                    messages: [
                        {
                            role: "system",
                            content: systemMessage
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    response_format: { type: "json_object" },
                    temperature: temperature / 10 ?? 0.2
                });

                return response;
            } catch (error) {
                throw new Error(`Groq request error: ${error.message}`);
            }
        },

        async requestAnthropic({ model, prompt, systemMessage, temperature }) {
            const anthropic = new Anthropic({ apiKey: this.anthropic.$auth.api_key });
            
            try {
                const response = await anthropic.messages.create({
                    model: model ?? "claude-3-5-haiku-latest",
                    max_tokens: 8000,
                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    system: systemMessage,
                    temperature: temperature > 10 ? 1 : temperature > 1 ? Math.round(temperature / 10 * 10) / 10 : temperature
                });

                return response;
            } catch (error) {
                throw new Error(`Anthropic request error: ${error.message}`);
            }
        },

        async requestGoogle({ model, prompt, systemMessage, temperature }) {
            const genAI = new GoogleGenAI({ apiKey: this.google_gemini.$auth.api_key });
            
            try {
                const response = await genAI.models.generateContent({
                    model: model ?? "gemini-2.0-flash",
                    contents: prompt,
                    config: {
                        systemInstruction: systemMessage,
                        temperature: temperature / 10 ?? 0.2
                    }
                });

                return response;
            } catch (error) {
                throw new Error(`Google Gemini request error: ${error.message}`);
            }
        },

        async requestCerebras({ model, prompt, systemMessage, temperature }) {
            const cerebras = new Cerebras({ apiKey: this.cerebras.$auth.api_key });
            
            try {
                const response = await cerebras.chat.completions.create({
                    model: model ?? "llama3.1-8b",
                    messages: [
                        {
                            role: "system",
                            content: systemMessage
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    response_format: { type: "json_object" },
                    temperature: temperature / 10 ?? 0.2
                });

                return response;
            } catch (error) {
                throw new Error(`Cerebras request error: ${error.message}`);
            }
        },

        unifyLLMResponse(response, service) {
            console.log(`Converting ${service} API response to unified format...`);

            let unifiedResponse = {
                id: "",
                model: "",
                provider: service,
                content: "",
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

            try {
                switch (service.toLowerCase()) {
                    case "openai":
                        unifiedResponse.id = response.id;
                        unifiedResponse.model = response.model;
                        unifiedResponse.content = response.choices[0].message.content;
                        unifiedResponse.usage = {
                            prompt_tokens: response.usage.prompt_tokens,
                            completion_tokens: response.usage.completion_tokens,
                            total_tokens: response.usage.total_tokens
                        };
                        break;

                    case "groqcloud":
                        unifiedResponse.id = response.id;
                        unifiedResponse.model = response.model;
                        unifiedResponse.content = response.choices[0].message.content;
                        unifiedResponse.usage = {
                            prompt_tokens: response.usage?.prompt_tokens ?? 0,
                            completion_tokens: response.usage?.completion_tokens ?? 0,
                            total_tokens: response.usage?.total_tokens ?? 0
                        };
                        break;

                    case "anthropic":
                        unifiedResponse.id = response.id;
                        unifiedResponse.model = response.model;
                        unifiedResponse.content = response.content[0].text;
                        unifiedResponse.usage = {
                            prompt_tokens: response.usage.input_tokens,
                            completion_tokens: response.usage.output_tokens,
                            total_tokens: response.usage.input_tokens + response.usage.output_tokens
                        };
                        break;

                    case "google_gemini":
                        unifiedResponse.id = "";
                        unifiedResponse.model = response.modelVersion ?? "gemini-2.0-flash";
                        unifiedResponse.content = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                        unifiedResponse.usage = {
                            prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
                            completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
                            total_tokens: response.usageMetadata?.totalTokenCount ?? 0
                        };
                        break;

                    case "cerebras":
                        unifiedResponse.id = response.id;
                        unifiedResponse.model = response.model;
                        unifiedResponse.content = response.choices[0].message.content;
                        unifiedResponse.usage = {
                            prompt_tokens: response.usage?.prompt_tokens ?? 0,
                            completion_tokens: response.usage?.completion_tokens ?? 0,
                            total_tokens: response.usage?.total_tokens ?? 0
                        };
                        break;

                    default:
                        throw new Error(`Unsupported service for response unification: ${service}`);
                }

                return unifiedResponse;
            } catch (error) {
                throw new Error(`Failed to unify response: ${error.message}`);
            }
        },

        splitTranscript(paragraphs, maxParagraphs) {
            console.log(`Splitting transcript into chunks of ${maxParagraphs} paragraphs...`);

            const stringsArray = [];
            
            // Process paragraphs in chunks of maxParagraphs
            for (let i = 0; i < paragraphs.length; i += maxParagraphs) {
                const chunk = paragraphs.slice(i, i + maxParagraphs);
                stringsArray.push(chunk.join(' '));
            }

            console.log(`Split transcript into ${stringsArray.length} chunks.`);
            return stringsArray;
        },

        async detectLanguage(service, model, text) {
            const systemMessage = `You are a language detection service. Your ONLY task is to detect the language of the provided text and return a valid JSON object with exactly two properties:
1. "label": The full name of the detected language in English (e.g., "English", "Spanish", "French")
2. "value": The ISO 639-1 language code (e.g., "en", "es", "fr")

IMPORTANT RULES:
- Return ONLY the JSON object, nothing else
- Do not include any explanations, code, or additional text
- Do not use any external libraries or code
- If the language cannot be determined, return {"label": "Unknown", "value": "unknown"}

Example valid response: {"label": "English", "value": "en"}

IMPORTANT: Do not include any explanatory text, markdown formatting, or code blocks.`;

        
            try {
                const response = await this.llmRequest({
                    service,
                    model,
                    prompt: text,
                    systemMessage,
                    temperature: 0,
                    log_action: (attempt) => `Attempt ${attempt}: Detecting transcript language using ${service}`,
                    log_success: "Language detected successfully.",
                    log_failure: (attempt, error) => `Attempt ${attempt} for language detection failed with error: ${error.message}. Retrying...`
                });

                const result = this.repairJSON(response.content);

                // Check if the response contains an error
                if (result.error) {
                    console.error(`Language detection failed: ${result.error_message}. Returning unknown language.`);
                    return {
                        label: "Unknown",
                        value: "unknown",
                        error: true,
                        error_message: result.error_message
                    };
                }

                return result;
            } catch (error) {
                console.error(`Language detection failed with error: ${error.message}. Returning unknown language.`);
                return {
                    label: "Unknown",
                    value: "unknown",
                    error: true,
                    error_message: error.message
                };
            }
        },

        async translateParagraphs({
            service,
            model,
            stringsArray,
            languageCode,
            temperature = 2,
            log_action = (attempt, index) => `Attempt ${attempt}: Sending paragraph ${index} to ${service} for translation...`,
            log_success = (index) => `Paragraph ${index} received successfully.`,
            log_failure = (attempt, error, index) => `Attempt ${attempt} for translation of paragraph ${index} failed with error: ${error.message}. Retrying...`
        }) {
            try {
                // Find the language object from the languages array
                const language = lang.LANGUAGES.find(lang => lang.value === languageCode);
                if (!language) {
                    throw new Error(`Invalid language code: ${languageCode}`);
                }

                let maxConcurrent;
                let minTime;
                
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                } else if (this.ai_service === "cerebras") {
                    // Cerebras has a rate limit of 30 RPM, but enforces it per second
                    // We'll set maxConcurrent to 1 and minTime to 2000ms (2 seconds)
                    // This ensures we stay well under their rate limits
                    maxConcurrent = 1;
                    minTime = 2000; // 2 seconds between requests
                }

                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                    minTime: minTime || Math.ceil(1000 / (maxConcurrent * 0.9)),
                    reservoir: this.ai_service === "cerebras" ? 30 : maxConcurrent * 2,
                    reservoirRefreshAmount: this.ai_service === "cerebras" ? 30 : maxConcurrent,
                    reservoirRefreshInterval: this.ai_service === "cerebras" ? 60 * 1000 : 1000
                });

                console.log(`Sending ${stringsArray.length} paragraphs to ${service} for translation to ${language.label} (ISO 639-1 code: ${language.value}) using ${model} with rate limiting: maxConcurrent=${maxConcurrent}, minTime=${minTime || 'default'}...`);
                
                const results = await limiter.schedule(() => {
                    const tasks = stringsArray.map((text, index) => {
                        const systemMessage = `You are a translator. Your task is to translate the provided text into ${language.label} (ISO 639-1 code: ${language.value}). 

IMPORTANT: You must respond with a valid JSON object containing a single property:
{
    "translation": "your translated text here"
}

Rules:
- Do not add any preamble, introduction, or suffix to your translation
- Do not explain your translation or add any notes
- Maintain the original formatting, including line breaks and punctuation
- Return ONLY the JSON object, nothing else
- The translation must be in ${language.label}`;

                        return this.llmRequest({
                            service,
                            model,
                            prompt: text,
                            systemMessage,
                            temperature,
                            log_action: (attempt) => log_action(attempt, index),
                            log_success: log_success(index),
                            log_failure: (attempt, error) => log_failure(attempt, error, index)
                        });
                    });
                    return Promise.all(tasks);
                });

                // Check for error responses
                const hasError = results.some(result => {
                    try {
                        const content = this.repairJSON(result.content);
                        return content.title === "Error in processing";
                    } catch (e) {
                        return false;
                    }
                });

                if (hasError) {
                    console.error("Translation failed due to LLM errors. Returning error response.");
                    return {
                        paragraphs: stringsArray, // Return original text
                        language: language.label,
                        languageCode: language.value,
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        },
                        model: model,
                        error: true,
                        error_message: "Translation failed due to LLM errors. Original text preserved."
                    };
                }

                const translationResult = {
                    paragraphs: results.map(result => {
                        try {
                            const parsedContent = this.repairJSON(result.content);
                            
                            // If we have a translation property, use it
                            if (parsedContent.translation) {
                                return parsedContent.translation;
                            }

                            // If the content is already a string, use it
                            if (typeof result.content === 'string') {
                                return result.content;
                            }

                            // Last resort: stringify the content
                            return JSON.stringify(result.content);
                        } catch (error) {
                            console.error(`Error parsing translation JSON: ${error.message}`);
                            // If content is a string, use it directly
                            if (typeof result.content === 'string') {
                                return result.content;
                            }
                            // Otherwise stringify the content
                            return JSON.stringify(result.content);
                        }
                    }),
                    language: language.label,
                    languageCode: language.value,
                    usage: {
                        prompt_tokens: results.reduce((total, item) => total + item.usage.prompt_tokens, 0),
                        completion_tokens: results.reduce((total, item) => total + item.usage.completion_tokens, 0),
                        total_tokens: results.reduce((total, item) => total + item.usage.total_tokens, 0)
                    },
                    model: results[0].model,
                };

                console.log(`Translated ${stringsArray.length} paragraphs successfully.`);
                return translationResult;
            } catch (error) {
                console.error(error);
                throw new Error(`An error occurred while translating the transcript: ${error.message}`);
            }
        },

        async cleanupParagraphs({
            service,
            model,
            stringsArray,
            temperature = 2,
            keyterms = [],
            log_action = (attempt, index) => `Attempt ${attempt}: Sending paragraph ${index} to ${service} for cleanup...`,
            log_success = (index) => `Paragraph ${index} received successfully.`,
            log_failure = (attempt, error, index) => `Attempt ${attempt} for cleanup of paragraph ${index} failed with error: ${error.message}. Retrying...`
        }) {
            try {
                let maxConcurrent;
                let minTime;
                
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                } else if (this.ai_service === "cerebras") {
                    // Cerebras has a rate limit of 30 RPM, but enforces it per second
                    // We'll set maxConcurrent to 1 and minTime to 2000ms (2 seconds)
                    // This ensures we stay well under their rate limits
                    maxConcurrent = 1;
                    minTime = 2000; // 2 seconds between requests
                }

                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                    minTime: minTime || Math.ceil(1000 / (maxConcurrent * 0.9)),
                    reservoir: this.ai_service === "cerebras" ? 30 : maxConcurrent * 2,
                    reservoirRefreshAmount: this.ai_service === "cerebras" ? 30 : maxConcurrent,
                    reservoirRefreshInterval: this.ai_service === "cerebras" ? 60 * 1000 : 1000
                });

                console.log(`Sending ${stringsArray.length} paragraphs to ${service} for cleanup using ${model} with rate limiting: maxConcurrent=${maxConcurrent}, minTime=${minTime || 'default'}...`);
                
                const results = await limiter.schedule(() => {
                    const tasks = stringsArray.map((text, index) => {
                        // Base system message for cleanup
                        let systemMessage = `You are a transcript cleanup assistant. Your task is to clean up the provided text by:
- Fixing any spelling errors
- Correcting grammar and punctuation
- Maintaining proper sentence structure
- Preserving the original meaning and tone
- Keeping any technical terms, names, or specialized vocabulary intact
- Maintaining the original formatting, including line breaks and punctuation

IMPORTANT: You must respond with a valid JSON object containing a single property:
{
    "cleaned_text": "your cleaned text here"
}

Rules:
- Do not add any preamble, introduction, or suffix to your cleaned text
- Do not explain your changes or add any notes
- Return ONLY the JSON object, nothing else
- Preserve the original meaning and intent of the text`;

                        // If keyterms are provided, add them to the system message
                        if (keyterms && keyterms.length > 0) {
                            systemMessage += `\n\nIMPORTANT: For the following terms:
${keyterms.map(term => `- ${term}`).join('\n')}

Rules for key terms:
1. If a term appears in the text exactly as written above, preserve it exactly as is
2. If a term appears in the text with spelling errors, correct it to match the exact spelling above
3. If a term appears in the text with different capitalization, correct it to match the exact spelling above
4. If a term appears in the text with different spacing, correct it to match the exact spelling above`;
                        }

                        return this.llmRequest({
                            service,
                            model,
                            prompt: text,
                            systemMessage,
                            temperature,
                            log_action: (attempt) => log_action(attempt, index),
                            log_success: log_success(index),
                            log_failure: (attempt, error) => log_failure(attempt, error, index)
                        });
                    });
                    return Promise.all(tasks);
                });

                // Check for error responses
                const hasError = results.some(result => {
                    try {
                        const content = this.repairJSON(result.content);
                        return content.title === "Error in processing";
                    } catch (e) {
                        return false;
                    }
                });

                if (hasError) {
                    console.error("Cleanup failed due to LLM errors. Returning error response.");
                    return {
                        paragraphs: stringsArray, // Return original text
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        },
                        model: model,
                        error: true,
                        error_message: "Cleanup failed due to LLM errors. Original text preserved."
                    };
                }

                const cleanupResult = {
                    paragraphs: results.map(result => {
                        try {
                            const parsedContent = this.repairJSON(result.content);
                            
                            // If we have a cleaned_text property, use it
                            if (parsedContent.cleaned_text) {
                                return parsedContent.cleaned_text;
                            }

                            // If the content is already a string, use it
                            if (typeof result.content === 'string') {
                                return result.content;
                            }

                            // Last resort: stringify the content
                            return JSON.stringify(result.content);
                        } catch (error) {
                            console.error(`Error parsing cleanup JSON: ${error.message}`);
                            // If content is a string, use it directly
                            if (typeof result.content === 'string') {
                                return result.content;
                            }
                            // Otherwise stringify the content
                            return JSON.stringify(result.content);
                        }
                    }),
                    usage: {
                        prompt_tokens: results.reduce((total, item) => total + item.usage.prompt_tokens, 0),
                        completion_tokens: results.reduce((total, item) => total + item.usage.completion_tokens, 0),
                        total_tokens: results.reduce((total, item) => total + item.usage.total_tokens, 0)
                    },
                    model: results[0].model,
                };

                console.log(`Cleaned up ${stringsArray.length} paragraphs successfully.`);
                return cleanupResult;
            } catch (error) {
                console.error(error);
                throw new Error(`An error occurred while cleaning up the transcript: ${error.message}`);
            }
        },

        repairJSON(input) {
			let jsonObj;
			try {
				jsonObj = JSON.parse(input);
				
				return jsonObj;
			} catch (error) {
				try {
					console.log(`Encountered an error: ${error}. Attempting JSON repair...`);
					const cleanedJsonString = jsonrepair(input);
					jsonObj = JSON.parse(cleanedJsonString);
					console.log(`JSON repair successful.`);
					return jsonObj;
				} catch (error) {
					console.log(
						`First JSON repair attempt failed with error: ${error}. Attempting more involved JSON repair...`
					);
					try {
						const beginningIndex = Math.min(
							input.indexOf("{") !== -1 ? input.indexOf("{") : Infinity,
							input.indexOf("[") !== -1 ? input.indexOf("[") : Infinity
						);
						const endingIndex = Math.max(
							input.lastIndexOf("}") !== -1 ? input.lastIndexOf("}") : -Infinity,
							input.lastIndexOf("]") !== -1 ? input.lastIndexOf("]") : -Infinity
						);

						if (beginningIndex == Infinity || endingIndex == -1) {
							throw new Error("No JSON object or array found (in repairJSON).");
						}

						const cleanedJsonString = jsonrepair(
							input.substring(beginningIndex, endingIndex + 1)
						);
						jsonObj = JSON.parse(cleanedJsonString);
						console.log(`2nd-stage JSON repair successful.`);
						return jsonObj;
					} catch (error) {
						throw new Error(
							`Recieved invalid JSON from ChatGPT. All JSON repair efforts failed.`
						);
					}
				}
			}
		},

        async sendToChat({
            service,
            model,
            stringsArray,
            log_action = (attempt, index) => `Attempt ${attempt}: Sending chunk ${index} to ${service}`,
            log_success = (index) => `Chunk ${index} received successfully.`,
            log_failure = (attempt, error, index) => `Attempt ${attempt} for chunk ${index} failed with error: ${error.message}. Retrying...`
        }) {
            try {
                
                let maxConcurrent;
                let minTime;
                
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                } else if (this.ai_service === "cerebras") {
                    // Cerebras has a rate limit of 30 RPM, but enforces it per second
                    // We'll set maxConcurrent to 1 and minTime to 2000ms (2 seconds)
                    // This ensures we stay well under their rate limits
                    maxConcurrent = 1;
                    minTime = 2000; // 2 seconds between requests
                }
                
                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                    minTime: minTime || Math.ceil(1000 / (maxConcurrent * 0.9)),
                    reservoir: this.ai_service === "cerebras" ? 30 : maxConcurrent * 2,
                    reservoirRefreshAmount: this.ai_service === "cerebras" ? 30 : maxConcurrent,
                    reservoirRefreshInterval: this.ai_service === "cerebras" ? 60 * 1000 : 1000
                });

                console.log(`Sending ${stringsArray.length} chunks to ${service} with rate limiting: maxConcurrent=${maxConcurrent}, minTime=${minTime || 'default'}`);
                
                const results = await limiter.schedule(() => {
                    const tasks = stringsArray.map((text, index) => {
                        
                        // Get the current date and time as a string
                        const date = new Date().toLocaleString();
                        
                        const prompt = this.createPrompt(text, date);

                        const systemMessage = this.createSystemMessage(index, this.summary_options, this.verbosity, this.translation_language, stringsArray.length);
                        
                        return this.llmRequest({
                            service: service,
                            model: model,
                            prompt: prompt,
                            systemMessage: systemMessage,
                            temperature: this.ai_temperature ? this.ai_temperature : 2,
                            log_action: (attempt) => log_action(attempt, index),
                            log_success: log_success(index),
                            log_failure: (attempt, error) => log_failure(attempt, error, index)
                        });
                    });
                    return Promise.all(tasks);
                });
                return results;
            } catch (error) {
                console.error(error);
                throw new Error(`An error occurred while sending the transcript to ${service}: ${error.message}`);
            }
        },

        async formatChat(summaryArray) {
            const resultsArray = [];
            console.log(`Formatting the LLM results...`);
            
            for (let result of summaryArray) {
                const response = {
                    choice: this.repairJSON(result.content),
                    usage: result.usage.total_tokens || 0,
                };
                resultsArray.push(response);
            }

            // Create a variable for the AI-generated title
            const AI_generated_title = resultsArray[0]?.choice?.title;

            let chatResponse = resultsArray.reduce(
                (acc, curr) => {
                    if (!curr.choice) return acc;

                    acc.summary.push(curr.choice.summary || []);
                    acc.main_points.push(curr.choice.main_points || []);
                    acc.action_items.push(curr.choice.action_items || []);
                    acc.stories.push(curr.choice.stories || []);
                    acc.references.push(curr.choice.references || []);
                    acc.arguments.push(curr.choice.arguments || []);
                    acc.follow_up.push(curr.choice.follow_up || []);
                    acc.related_topics.push(curr.choice.related_topics || []);
                    acc.usageArray.push(curr.usage || 0);

                    return acc;
                },
                {
                    title: AI_generated_title ?? "No title found",
                    sentiment: resultsArray[0]?.choice?.sentiment,
                    summary: [],
                    main_points: [],
                    action_items: [],
                    stories: [],
                    references: [],
                    arguments: [],
                    follow_up: [],
                    related_topics: [],
                    usageArray: [],
                }
            );

            console.log(`ChatResponse object preview after LLM items have been inserted:`);
            console.log(JSON.stringify(chatResponse, null, 2).slice(0, 1000) + "...");

            function arraySum(arr) {
                return arr.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
            }

            console.log(`Filtering Related Topics, if any exist:`);
            let filtered_related_topics = chatResponse.related_topics
                .flat()
                .filter((item) => item !== undefined && item !== null && item !== "");

            let filtered_related_set;

            if (filtered_related_topics.length > 1) {
                filtered_related_set = Array.from(
                    new Set(filtered_related_topics.map((item) => item.toLowerCase()))
                );
            }

            const finalChatResponse = {
                title: chatResponse.title,
                summary: chatResponse.summary.join(" "),
                ...(chatResponse.sentiment && {
                    sentiment: chatResponse.sentiment,
                }),
                main_points: chatResponse.main_points.flat(),
                action_items: chatResponse.action_items.flat(),
                stories: chatResponse.stories.flat(),
                references: chatResponse.references.flat(),
                arguments: chatResponse.arguments.flat(),
                follow_up: chatResponse.follow_up.flat(),
                ...(filtered_related_set?.length > 1 && {
                    related_topics: filtered_related_set.sort(),
                }),
                tokens: arraySum(chatResponse.usageArray),
            };

            console.log(`Final ChatResponse object preview:`);
            console.log(JSON.stringify(finalChatResponse, null, 2).slice(0, 1000) + "...");

            return finalChatResponse;
        },

        makeParagraphs(rawTranscript, maxLength = 1200, sentencesPerParagraph = 3) {
            console.log(`Starting paragraph creation with maxLength: ${maxLength}`);
            this.logMemoryUsage('Start of makeParagraphs');

            // Normalize spaces in the input transcript
            let transcript = rawTranscript.replace(/\s+/g, ' ').trim();
            this.logMemoryUsage('After normalizing spaces');

            // Set sentences per paragraph
            console.log(`Using ${sentencesPerParagraph} sentences per paragraph.`);

            try {
                console.log(`Attempting to use Intl.Segmenter for sentence segmentation...`);
                // Create a segmenter for sentences
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
                
                // Process sentences directly into paragraphs without intermediate arrays
                let paragraphs = [];
                let currentSentenceGroup = [];
                let currentParagraph = '';
                let splitCount = 0;

                // Process sentences and build paragraphs in a streaming fashion
                for (const segment of segmenter.segment(transcript)) {
                    const sentence = segment.segment.trim();
                    if (!sentence) continue;

                    currentSentenceGroup.push(sentence);
                    
                    if (currentSentenceGroup.length === sentencesPerParagraph) {
                        currentParagraph = currentSentenceGroup.join(' ').trim();
                        
                        // Handle paragraphs that exceed maxLength
                        if (currentParagraph.length <= maxLength) {
                            paragraphs.push(currentParagraph);
                        } else {
                            console.log(`Paragraph exceeds maxLength (${currentParagraph.length} chars), splitting...`);
                            splitCount++;

                            // Create a word segmenter for splitting long paragraphs
                            const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
                            let currentChunk = '';
                            let chunkCount = 0;

                            // Process words directly without creating an intermediate array
                            for (const word of wordSegmenter.segment(currentParagraph)) {
                                const wordSegment = word.segment.trim();
                                if (!wordSegment) continue;

                                const isPunctuation = /^[.,!?;:()\-–—]$/.test(wordSegment);
                                
                                if (currentChunk.length + wordSegment.length + (isPunctuation ? 0 : 1) <= maxLength) {
                                    currentChunk += (isPunctuation ? '' : (currentChunk ? ' ' : '')) + wordSegment;
                                } else {
                                    if (currentChunk) {
                                        paragraphs.push(currentChunk.trim());
                                        chunkCount++;
                                    }
                                    currentChunk = wordSegment;
                                }
                            }

                            if (currentChunk) {
                                paragraphs.push(currentChunk.trim());
                                chunkCount++;
                            }
                            console.log(`Split paragraph into ${chunkCount} chunks`);
                        }

                        currentSentenceGroup = [];
                        currentParagraph = '';
                    }
                }

                // Handle any remaining sentences
                if (currentSentenceGroup.length > 0) {
                    currentParagraph = currentSentenceGroup.join(' ').trim();
                    if (currentParagraph.length <= maxLength) {
                        paragraphs.push(currentParagraph);
                    } else {
                        console.log(`Final paragraph exceeds maxLength (${currentParagraph.length} chars), splitting...`);
                        splitCount++;

                        const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
                        let currentChunk = '';
                        let chunkCount = 0;

                        for (const word of wordSegmenter.segment(currentParagraph)) {
                            const wordSegment = word.segment.trim();
                            if (!wordSegment) continue;

                            const isPunctuation = /^[.,!?;:()\-–—]$/.test(wordSegment);
                            
                            if (currentChunk.length + wordSegment.length + (isPunctuation ? 0 : 1) <= maxLength) {
                                currentChunk += (isPunctuation ? '' : (currentChunk ? ' ' : '')) + wordSegment;
                            } else {
                                if (currentChunk) {
                                    paragraphs.push(currentChunk.trim());
                                    chunkCount++;
                                }
                                currentChunk = wordSegment;
                            }
                        }

                        if (currentChunk) {
                            paragraphs.push(currentChunk.trim());
                            chunkCount++;
                        }
                        console.log(`Split final paragraph into ${chunkCount} chunks`);
                    }
                }

                // Clean up variables
                transcript = null;
                currentSentenceGroup = null;
                currentParagraph = null;
                this.logMemoryUsage('After processing all paragraphs');

                console.log(`Total paragraphs split: ${splitCount}`);
                console.log(`Final paragraph count: ${paragraphs.length}`);
                console.log(`First few final paragraphs for verification:`);
                paragraphs.slice(0, 3).forEach((para, i) => {
                    console.log(`Paragraph ${i + 1} (${para.length} chars): ${para.substring(0, 100)}...`);
                });

                return paragraphs;
            } catch (error) {
                console.log(`Intl.Segmenter failed. Splitting transcript into paragraphs based on periods and maxLength. Error: ${error.message}`);
                console.log(`Error details:`, error);

                let transcript = rawTranscript.replace(/\s+/g, ' ').trim();
                let finalParagraphs = [];
                let currentParagraph = '';
                let sentenceCount = 0;

                // Split into sentences first
                const sentences = transcript.split(/(?<=[.!?])\s*/).filter(s => s.trim().length > 0);
                
                for (const sentence of sentences) {
                    // If adding this sentence would exceed maxLength, start a new paragraph
                    if (currentParagraph.length + sentence.length > maxLength) {
                        if (currentParagraph) {
                            finalParagraphs.push(currentParagraph.trim());
                        }
                        currentParagraph = sentence;
                        sentenceCount = 1;
                    } else {
                        // If this is the first sentence in the paragraph
                        if (sentenceCount === 0) {
                            currentParagraph = sentence;
                        } else {
                            currentParagraph += ' ' + sentence;
                        }
                        sentenceCount++;
                    }

                    // If we've reached 3 sentences, start a new paragraph
                    if (sentenceCount >= 3) {
                        finalParagraphs.push(currentParagraph.trim());
                        currentParagraph = '';
                        sentenceCount = 0;
                    }
                }

                // Add any remaining text
                if (currentParagraph) {
                    finalParagraphs.push(currentParagraph.trim());
                }

                // If no paragraphs were created (no periods found), fall back to simple maxLength split
                if (finalParagraphs.length === 0) {
                    console.log('No periods found in transcript. Falling back to simple maxLength split.');
                    for (let i = 0; i < transcript.length; i += maxLength) {
                        finalParagraphs.push(transcript.substring(i, i + maxLength));
                    }
                }

                this.logMemoryUsage('After creating finalParagraphs');
                console.log(`Created ${finalParagraphs.length} paragraphs in fallback mode`);

                return finalParagraphs;
            }
        },
    }
}