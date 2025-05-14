/** 
 * LLM Functions
 * 
 * This file contains all functions needed for translation and summarization
 */

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
import { encode, decode } from "gpt-3-encoder"; // GPT-3 encoder for ChatGPT-specific tokenization
import { franc, francAll } from "franc"; // Language detection
import natural from "natural";

export default {
    methods: {
        ...prompts.methods,

        /**
         * Makes a request to an LLM service with retry logic and unified response handling.
         * This is the core function that handles all LLM API interactions, supporting multiple
         * providers (OpenAI, Anthropic, Google Gemini, and Groq) with a consistent interface.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.service - The LLM service to use ('openai', 'anthropic', 'google_gemini', or 'groqcloud')
         * @param {string} params.model - The specific model to use
         * @param {string} params.prompt - The user prompt to send to the LLM
         * @param {string} params.systemMessage - The system message/instruction for the LLM
         * @param {number} params.temperature - Temperature setting for the LLM (0-10)
         * @param {Function} [params.log_action] - Custom logging function for request attempts
         * @param {string} [params.log_success] - Custom success message
         * @param {Function} [params.log_failure] - Custom logging function for failed attempts
         * 
         * @returns {Promise<Object>} A promise that resolves to a unified response object containing:
         *   @property {string} id - The response ID from the LLM service
         *   @property {string} model - The model used for the request
         *   @property {string} provider - The LLM service provider
         *   @property {string} content - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} prompt_tokens - Number of tokens used in prompts
         *     @property {number} completion_tokens - Number of tokens used in completions
         *     @property {number} total_tokens - Total number of tokens used
         * 
         * @throws {Error} If the service is unsupported or if the request fails after retries
         * 
         * @example
         * const response = await llmRequest({
         *   service: 'openai',
         *   model: 'gpt-3.5-turbo',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2,
         *   log_action: (attempt) => `Attempt ${attempt}: Sending request to OpenAI`,
         *   log_success: 'Request received successfully',
         *   log_failure: (attempt, error) => `Attempt ${attempt} failed: ${error.message}`
         * });
         * 
         * @note
         * - Automatically retries failed requests up to 3 times
         * - Normalizes responses from different LLM providers into a unified format
         * - Handles temperature scaling for different providers
         * - Provides detailed logging for debugging and monitoring
         */
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

        /**
         * Makes a request to the OpenAI API using the specified parameters.
         * This function handles the specific formatting and requirements for OpenAI's API.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.model - The OpenAI model to use (defaults to 'gpt-3.5-turbo')
         * @param {string} params.prompt - The user prompt to send to the model
         * @param {string} params.systemMessage - The system message/instruction for the model
         * @param {number} params.temperature - Temperature setting (0-10, will be divided by 10)
         * 
         * @returns {Promise<Object>} A promise that resolves to the OpenAI API response containing:
         *   @property {string} id - The response ID
         *   @property {string} model - The model used
         *   @property {Array<Object>} choices - Array of response choices
         *     @property {Object} choices[].message - The message object
         *       @property {string} choices[].message.content - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} usage.prompt_tokens - Number of tokens used in prompt
         *     @property {number} usage.completion_tokens - Number of tokens used in completion
         *     @property {number} usage.total_tokens - Total tokens used
         * 
         * @throws {Error} If the API request fails or if the response is invalid
         * 
         * @example
         * const response = await requestOpenAI({
         *   model: 'gpt-3.5-turbo',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2
         * });
         * 
         * @note
         * - Uses OpenAI's chat completions API
         * - Automatically scales temperature (divides by 10)
         * - Requires valid OpenAI API key in auth
         * - Handles message formatting according to OpenAI's requirements
         */
        async requestOpenAI({ model, prompt, systemMessage, temperature }) {
            const openai = new OpenAI({ apiKey: this.openai.$auth.api_key });
            
            try {
                const response = await openai.chat.completions.create({
                    model: model ?? "gpt-3.5-turbo",
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

        /**
         * Makes a request to the Groq API using the specified parameters.
         * This function handles the specific formatting and requirements for Groq's API.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.model - The Groq model to use (defaults to 'llama-3.1-8b-instant')
         * @param {string} params.prompt - The user prompt to send to the model
         * @param {string} params.systemMessage - The system message/instruction for the model
         * @param {number} params.temperature - Temperature setting (0-10, will be divided by 10)
         * 
         * @returns {Promise<Object>} A promise that resolves to the Groq API response containing:
         *   @property {string} id - The response ID
         *   @property {string} model - The model used
         *   @property {Array<Object>} choices - Array of response choices
         *     @property {Object} choices[].message - The message object
         *       @property {string} choices[].message.content - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} usage.prompt_tokens - Number of tokens used in prompt
         *     @property {number} usage.completion_tokens - Number of tokens used in completion
         *     @property {number} usage.total_tokens - Total tokens used
         * 
         * @throws {Error} If the API request fails or if the response is invalid
         * 
         * @example
         * const response = await requestGroq({
         *   model: 'llama-3.1-8b-instant',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2
         * });
         * 
         * @note
         * - Uses Groq's chat completions API
         * - Automatically scales temperature (divides by 10)
         * - Requires valid Groq API key in auth
         * - Handles message formatting according to Groq's requirements
         */
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

        /**
         * Makes a request to the Anthropic API using the specified parameters.
         * This function handles the specific formatting and requirements for Anthropic's API.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.model - The Anthropic model to use (defaults to 'claude-3-5-haiku-latest')
         * @param {string} params.prompt - The user prompt to send to the model
         * @param {string} params.systemMessage - The system message/instruction for the model
         * @param {number} params.temperature - Temperature setting (0-10, will be scaled appropriately)
         * 
         * @returns {Promise<Object>} A promise that resolves to the Anthropic API response containing:
         *   @property {string} id - The response ID
         *   @property {string} model - The model used
         *   @property {Array<Object>} content - Array of content blocks
         *     @property {string} content[].text - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} usage.input_tokens - Number of tokens used in input
         *     @property {number} usage.output_tokens - Number of tokens used in output
         * 
         * @throws {Error} If the API request fails or if the response is invalid
         * 
         * @example
         * const response = await requestAnthropic({
         *   model: 'claude-3-5-haiku-latest',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2
         * });
         * 
         * @note
         * - Uses Anthropic's messages API
         * - Has special temperature scaling logic:
         *   - > 10: scales to 1
         *   - > 1: scales to 0.1-1.0
         *   - ≤ 1: uses as is
         * - Requires valid Anthropic API key in auth
         * - Handles message formatting according to Anthropic's requirements
         */
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

        /**
         * Makes a request to the Google Gemini API using the specified parameters.
         * This function handles the specific formatting and requirements for Google's API.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.model - The Google model to use (defaults to 'gemini-2.0-flash')
         * @param {string} params.prompt - The user prompt to send to the model
         * @param {string} params.systemMessage - The system message/instruction for the model
         * @param {number} params.temperature - Temperature setting (0-10, will be divided by 10)
         * 
         * @returns {Promise<Object>} A promise that resolves to the Google API response containing:
         *   @property {string} modelVersion - The model version used
         *   @property {Array<Object>} candidates - Array of response candidates
         *     @property {Object} candidates[].content - The content object
         *       @property {Array<Object>} candidates[].content.parts - Array of content parts
         *         @property {string} candidates[].content.parts[].text - The generated content
         *   @property {Object} usageMetadata - Token usage statistics
         *     @property {number} usageMetadata.promptTokenCount - Number of tokens used in prompt
         *     @property {number} usageMetadata.candidatesTokenCount - Number of tokens used in response
         *     @property {number} usageMetadata.totalTokenCount - Total tokens used
         * 
         * @throws {Error} If the API request fails or if the response is invalid
         * 
         * @example
         * const response = await requestGoogle({
         *   model: 'gemini-2.0-flash',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2
         * });
         * 
         * @note
         * - Uses Google's Gemini API
         * - Automatically scales temperature (divides by 10)
         * - Requires valid Google API key in auth
         * - Handles message formatting according to Google's requirements
         * - Uses systemInstruction for system messages
         */
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

        /**
         * Makes a request to the Cerebras API using the specified parameters.
         * This function handles the specific formatting and requirements for Cerebras's API.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.model - The Cerebras model to use (defaults to 'llama3.1-8b')
         * @param {string} params.prompt - The user prompt to send to the model
         * @param {string} params.systemMessage - The system message/instruction for the model
         * @param {number} params.temperature - Temperature setting (0-10, will be divided by 10)
         * 
         * @returns {Promise<Object>} A promise that resolves to the Cerebras API response containing:
         *   @property {string} id - The response ID
         *   @property {string} model - The model used
         *   @property {Array<Object>} choices - Array of response choices
         *     @property {Object} choices[].message - The message object
         *       @property {string} choices[].message.content - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} usage.prompt_tokens - Number of tokens used in prompt
         *     @property {number} usage.completion_tokens - Number of tokens used in completion
         *     @property {number} usage.total_tokens - Total tokens used
         * 
         * @throws {Error} If the API request fails or if the response is invalid
         * 
         * @example
         * const response = await requestCerebras({
         *   model: 'llama3.1-8b',
         *   prompt: 'Translate this to French: Hello world',
         *   systemMessage: 'You are a translator',
         *   temperature: 2
         * });
         * 
         * @note
         * - Uses Cerebras's chat completions API
         * - Automatically scales temperature (divides by 10)
         * - Requires valid Cerebras API key in auth
         * - Handles message formatting according to Cerebras's requirements
         */
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

        /**
         * Normalizes responses from different LLM providers into a unified format.
         * This function handles the conversion of provider-specific response structures
         * into a consistent format that can be used throughout the application.
         * 
         * @param {Object} response - The raw response from the LLM provider
         * @param {string} service - The LLM service provider ('openai', 'anthropic', 'google_gemini', or 'groqcloud')
         * 
         * @returns {Object} A unified response object containing:
         *   @property {string} id - The response ID from the LLM service
         *   @property {string} model - The model used for the request
         *   @property {string} provider - The LLM service provider
         *   @property {string} content - The generated content
         *   @property {Object} usage - Token usage statistics
         *     @property {number} prompt_tokens - Number of tokens used in prompts
         *     @property {number} completion_tokens - Number of tokens used in completions
         *     @property {number} total_tokens - Total number of tokens used
         * 
         * @throws {Error} If the service is unsupported or if the response format is invalid
         * 
         * @example
         * // OpenAI response
         * const openaiResponse = {
         *   id: 'chatcmpl-123',
         *   model: 'gpt-3.5-turbo',
         *   choices: [{ message: { content: 'Hello' } }],
         *   usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
         * };
         * const unified = unifyLLMResponse(openaiResponse, 'openai');
         * 
         * // Anthropic response
         * const anthropicResponse = {
         *   id: 'msg_123',
         *   model: 'claude-3-haiku',
         *   content: [{ text: 'Hello' }],
         *   usage: { input_tokens: 10, output_tokens: 5 }
         * };
         * const unified = unifyLLMResponse(anthropicResponse, 'anthropic');
         * 
         * @note
         * - Handles different token counting methods between providers
         * - Normalizes content extraction from different response structures
         * - Maintains consistent property names across all providers
         * - Provides fallback values for optional properties
         */
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

        
        /**
         * Splits an encoded transcript into chunks of specified maximum token length,
         * while preserving sentence boundaries and handling special cases for different
         * languages and punctuation.
         * 
         * @param {number[]} encodedTranscript - Array of token IDs representing the encoded transcript
         * @param {number} maxTokens - Maximum number of tokens allowed per chunk
         * @param {Object} periodInfo - Information about sentence boundaries and gaps
         * @param {number} periodInfo.longestGap - The longest gap between sentences (-1 if no periods found)
         * 
         * @returns {string[]} Array of decoded text chunks, where each chunk:
         *   - Does not exceed maxTokens in length
         *   - Respects sentence boundaries where possible
         *   - Is properly decoded from token IDs to text
         * 
         * @throws {Error} If the input is invalid or if decoding fails
         * 
         * @example
         * const encodedText = encode("This is the first sentence. This is the second sentence.");
         * const periodInfo = { longestGap: 1 };
         * const chunks = splitTranscript(encodedText, 10, periodInfo);
         * // Returns: ["This is the first sentence.", "This is the second sentence."]
         * 
         * @note
         * - Uses GPT-3 encoder for tokenization
         * - Attempts to split at sentence boundaries when possible
         * - Falls back to splitting at the nearest space if no sentence boundary is found
         * - Handles special cases for different languages and punctuation
         * - Preserves original text formatting and structure
         */
        splitTranscript(encodedTranscript, maxTokens, periodInfo) {
			console.log(`Splitting transcript into chunks of ${maxTokens} tokens...`);

			const stringsArray = [];
			let currentIndex = 0;
			let round = 0;

			while (currentIndex < encodedTranscript.length) {
				//console.log(`Round ${round++} of transcript splitting...`);

				let endIndex = Math.min(currentIndex + maxTokens, encodedTranscript.length);

				//console.log(`Current endIndex: ${endIndex}`);
				const nonPeriodEndIndex = endIndex;

				if (periodInfo.longestGap !== -1) {
					let forwardEndIndex = endIndex;
					let backwardEndIndex = endIndex;

					let maxForwardEndIndex = 100;
					let maxBackwardEndIndex = 100;

					while (
						forwardEndIndex < encodedTranscript.length &&
						maxForwardEndIndex > 0 &&
						decode([encodedTranscript[forwardEndIndex]]) !== "."
					) {
						forwardEndIndex++;
						maxForwardEndIndex--;
					}

					while (
						backwardEndIndex > 0 &&
						maxBackwardEndIndex > 0 &&
						decode([encodedTranscript[backwardEndIndex]]) !== "."
					) {
						backwardEndIndex--;
						maxBackwardEndIndex--;
					}

					if (
						Math.abs(forwardEndIndex - nonPeriodEndIndex) <
						Math.abs(backwardEndIndex - nonPeriodEndIndex)
					) {
						endIndex = forwardEndIndex;
					} else {
						endIndex = backwardEndIndex;
					}

					if (endIndex < encodedTranscript.length) {
						endIndex++;
					}

					//console.log(
					//	`endIndex updated to ${endIndex} to keep sentences whole. Non-period endIndex was ${nonPeriodEndIndex}. Total added/removed tokens to account for this: ${
					//		endIndex - nonPeriodEndIndex
					//	}.`
					//);
				}

				const chunk = encodedTranscript.slice(currentIndex, endIndex);
				stringsArray.push(decode(chunk));

				currentIndex = endIndex;
			}

			console.log(`Split transcript into ${stringsArray.length} chunks.`);
			return stringsArray;
		},

        /**
         * Detects the language of the provided text using the specified language model.
         *
         * @param {string} service - The service provider, e.g., "OpenAI" or "Anthropic".
         * @param {string} model - The specific language model to use for detection.
         * @param {string} text - The text whose language needs to be detected.
         * @returns {Promise<Object>} - A promise that resolves to a JSON object with the detected language name and code.
         * @throws {Error} - Throws an error if the language detection fails.
         */
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

        /**
         * Translates an array of text paragraphs into the specified language using the chosen LLM service.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.service - The LLM service to use ('openai', 'anthropic', 'google_gemini', or 'groqcloud')
         * @param {string} params.model - The specific model to use for translation
         * @param {string[]} params.stringsArray - Array of text paragraphs to translate
         * @param {string} params.languageCode - ISO 639-1 language code for the target language
         * @param {number} [params.temperature=2] - Temperature setting for the LLM (0-10)
         * @param {Function} [params.log_action] - Custom logging function for request attempts
         * @param {Function} [params.log_success] - Custom logging function for successful requests
         * @param {Function} [params.log_failure] - Custom logging function for failed requests
         * 
         * @returns {Promise<Object>} A promise that resolves to an object containing:
         *   @property {string[]} paragraphs - Array of translated paragraphs
         *   @property {string} language - Full name of the target language
         *   @property {string} languageCode - ISO 639-1 code of the target language
         *   @property {Object} usage - Token usage statistics
         *     @property {number} prompt_tokens - Number of tokens used in prompts
         *     @property {number} completion_tokens - Number of tokens used in completions
         *     @property {number} total_tokens - Total number of tokens used
         *   @property {string} model - Name of the model used for translation
         * 
         * @throws {Error} If the language code is invalid or if translation fails
         * 
         * @example
         * const result = await translateParagraphs({
         *   service: 'openai',
         *   model: 'gpt-3.5-turbo',
         *   stringsArray: ['Hello world', 'How are you?'],
         *   languageCode: 'es',
         *   temperature: 2
         * });
         */
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

                let maxConcurrent
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                }
                
                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                });

                console.log(`Sending ${stringsArray.length} paragraphs to ${service} for translation to ${language.label} (ISO 639-1 code: ${language.value}) using ${model}...`);
                
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
                let maxConcurrent
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                }
                
                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                });

                console.log(`Sending ${stringsArray.length} paragraphs to ${service} for cleanup using ${model}...`);
                
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

        /**
         * Repairs JSON strings that are not valid JSON.
         * 
         * @param {string} input - The JSON string to repair
         * @returns {Object} The repaired JSON object
         * @throws {Error} If the JSON string is not valid or if repair fails
         * 
         * @example
         * const repairedJSON = repairJSON('{"name": "John", "age": 30}');
         * console.log(repairedJSON); // { name: 'John', age: 30 }
         */
        repairJSON(input) {
			let jsonObj;
			try {
				jsonObj = JSON.parse(input);
				console.log(`JSON repair not needed.`);
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

        
        /**
         * Sends an array of text chunks to the specified LLM service for processing.
         * This function handles concurrent requests with rate limiting and retries.
         * 
         * @param {Object} params - The parameters object
         * @param {string} params.service - The LLM service to use ('openai', 'anthropic', 'google_gemini', or 'groqcloud')
         * @param {string} params.model - The specific model to use for processing
         * @param {string[]} params.stringsArray - Array of text chunks to process
         * @param {Function} [params.log_action] - Custom logging function for request attempts
         * @param {Function} [params.log_success] - Custom logging function for successful requests
         * @param {Function} [params.log_failure] - Custom logging function for failed requests
         * 
         * @returns {Promise<Array<Object>>} A promise that resolves to an array of LLM responses, where each response contains:
         *   @property {string} content - The processed content from the LLM
         *   @property {Object} usage - Token usage statistics
         *     @property {number} prompt_tokens - Number of tokens used in prompts
         *     @property {number} completion_tokens - Number of tokens used in completions
         *     @property {number} total_tokens - Total number of tokens used
         *   @property {string} model - Name of the model used
         *   @property {string} provider - The LLM service provider
         * 
         * @throws {Error} If processing fails or if the service is unsupported
         * 
         * @example
         * const results = await sendToChat({
         *   service: 'openai',
         *   model: 'gpt-3.5-turbo',
         *   stringsArray: ['First chunk', 'Second chunk'],
         *   log_action: (attempt, index) => `Processing chunk ${index}, attempt ${attempt}`,
         *   log_success: (index) => `Chunk ${index} processed successfully`,
         *   log_failure: (attempt, error, index) => `Failed to process chunk ${index}: ${error.message}`
         * });
         */
        async sendToChat({
            service,
            model,
            stringsArray,
            log_action = (attempt, index) => `Attempt ${attempt}: Sending chunk ${index} to ${service}`,
            log_success = (index) => `Chunk ${index} received successfully.`,
            log_failure = (attempt, error, index) => `Attempt ${attempt} for chunk ${index} failed with error: ${error.message}. Retrying...`
        }) {
            try {
                
                let maxConcurrent
                if (this.ai_service === "openai") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "anthropic") {
                    maxConcurrent = 35;
                } else if (this.ai_service === "google_gemini") {
                    maxConcurrent = 15;
                } else if (this.ai_service === "groqcloud") {
                    maxConcurrent = 25;
                }
                
                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                });

                console.log(`Sending ${stringsArray.length} chunks to ${service}`);
                const results = await limiter.schedule(() => {
                    const tasks = stringsArray.map((text, index) => {
                        
                        // Get the current date and time as a string
                        const date = new Date().toLocaleString();
                        
                        const prompt = this.createPrompt(text, date);

                        const systemMessage = this.createSystemMessage(index, this.summary_options, this.verbosity, this.translation_language);
                        
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

        
        /**
         * Formats and consolidates an array of LLM responses into a structured chat response.
         * This function processes multiple chunks of LLM responses and combines them into
         * a single, well-organized response object with various analysis components.
         * 
         * @param {Array<Object>} summaryArray - Array of LLM response objects to format
         * @param {Object} summaryArray[].content - The content from each LLM response
         * @param {Object} summaryArray[].usage - Token usage statistics for each response
         * 
         * @returns {Object} A formatted chat response containing:
         *   @property {string} title - The AI-generated title from the first response
         *   @property {string} summary - Combined summary of all responses
         *   @property {string} [sentiment] - Overall sentiment analysis (if requested)
         *   @property {Array<string>} main_points - List of key points extracted
         *   @property {Array<string>} action_items - List of actionable items identified
         *   @property {Array<string>} stories - List of stories or examples mentioned
         *   @property {Array<string>} references - List of references or citations
         *   @property {Array<string>} arguments - List of arguments or points made
         *   @property {Array<string>} follow_up - List of follow-up questions or topics
         *   @property {Array<string>} [related_topics] - List of related topics (if requested)
         *   @property {number} tokens - Total tokens used across all responses
         * 
         * @throws {Error} If the response format is invalid or if JSON repair fails
         * 
         * @example
         * const summaryArray = [
         *   {
         *     content: '{"title": "Meeting Summary", "summary": "First part", "main_points": ["Point 1"]}',
         *     usage: { total_tokens: 100 }
         *   },
         *   {
         *     content: '{"summary": "Second part", "main_points": ["Point 2"]}',
         *     usage: { total_tokens: 150 }
         *   }
         * ];
         * const formatted = formatChat(summaryArray);
         * // Returns: {
         * //   title: "Meeting Summary",
         * //   summary: "First part Second part",
         * //   main_points: ["Point 1", "Point 2"],
         * //   tokens: 250
         * // }
         * 
         * @note
         * - Repairs and validates JSON from each response
         * - Combines and flattens arrays from multiple responses
         * - Deduplicates related topics
         * - Calculates total token usage
         * - Handles optional components based on summary options
         */
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

        
        /**
         * Splits a transcript into paragraphs of appropriate length, respecting sentence boundaries
         * and language-specific formatting rules. Uses Intl.Segmenter for sentence segmentation
         * with a fallback to natural.SentenceTokenizer.
         * 
         * @param {string} transcript - The full transcript text to split into paragraphs
         * @param {number} [maxLength=1200] - Maximum character length for each paragraph
         * 
         * @returns {string[]} Array of paragraphs, where each paragraph:
         *   - Respects sentence boundaries
         *   - Does not exceed maxLength
         *   - Maintains proper formatting
         *   - Is optimized for the detected language
         * 
         * @throws {Error} If both Intl.Segmenter and natural.SentenceTokenizer fail
         * 
         * @example
         * const paragraphs = makeParagraphs(
         *   "This is the first sentence. This is the second sentence. This is the third sentence.",
         *   100
         * );
         * // Returns: ["This is the first sentence. This is the second sentence.", "This is the third sentence."]
         * 
         * @note
         * - Uses 3 sentences per paragraph for Chinese and undetermined languages
         * - Uses 4 sentences per paragraph for all other languages
         * - Falls back to natural.SentenceTokenizer if Intl.Segmenter is not available
         * - Handles special cases for Chinese text using specific punctuation marks
         */
        makeParagraphs(transcript, maxLength = 1200) {
            console.log(`Starting paragraph creation with maxLength: ${maxLength}`);
            const languageCode = franc(transcript);
            console.log(`Detected language with franc library: ${languageCode}`);

            // Normalize spaces in the input transcript
            transcript = transcript.replace(/\s+/g, ' ').trim();

            // Set sentences per paragraph based on language
            const sentencesPerParagraph = (languageCode === "cmn" || languageCode === "und") ? 3 : 4;
            console.log(`Using ${sentencesPerParagraph} sentences per paragraph based on language detection`);

            try {
                console.log(`Attempting to use Intl.Segmenter for sentence segmentation...`);
                // Create a segmenter for sentences
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
                
                // Get sentence segments and normalize spaces
                const segments = Array.from(segmenter.segment(transcript));
                const sentences = segments.map(segment => segment.segment.trim());
                
                console.log(`Intl.Segmenter successfully created ${sentences.length} sentence segments`);
                console.log(`First few sentences for verification:`);
                sentences.slice(0, 3).forEach((sentence, i) => {
                    console.log(`Sentence ${i + 1}: ${sentence.substring(0, 100)}...`);
                });

                // Group sentences into paragraphs
                const paragraphs = [];
                for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
                    paragraphs.push(sentences.slice(i, i + sentencesPerParagraph).join(' ').trim());
                }

                console.log(`Grouped sentences into ${paragraphs.length} initial paragraphs`);
                console.log(`First paragraph for verification: ${paragraphs[0].substring(0, 100)}...`);
                console.log(`Limiting paragraphs to ${maxLength} characters...`);

                // Split paragraphs that exceed maxLength
                const finalParagraphs = [];
                let splitCount = 0;
                for (const paragraph of paragraphs) {
                    if (paragraph.length <= maxLength) {
                        finalParagraphs.push(paragraph);
                        continue;
                    }

                    console.log(`Paragraph exceeds maxLength (${paragraph.length} chars), splitting...`);
                    splitCount++;

                    // Create a word segmenter for splitting long paragraphs
                    const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
                    const words = Array.from(wordSegmenter.segment(paragraph));
                    
                    console.log(`Split paragraph into ${words.length} words`);
                    let currentChunk = '';
                    let chunkCount = 0;
                    
                    for (const word of words) {
                        const wordSegment = word.segment.trim();
                        // Skip empty segments
                        if (!wordSegment) continue;
                        
                        // Check if the segment is punctuation
                        const isPunctuation = /^[.,!?;:()\-–—]$/.test(wordSegment);
                        
                        if (currentChunk.length + wordSegment.length + (isPunctuation ? 0 : 1) <= maxLength) {
                            // For punctuation, don't add a space before it
                            if (isPunctuation) {
                                currentChunk += wordSegment;
                            } else {
                                currentChunk += (currentChunk ? ' ' : '') + wordSegment;
                            }
                        } else {
                            if (currentChunk) {
                                finalParagraphs.push(currentChunk.trim());
                                chunkCount++;
                            }
                            currentChunk = wordSegment;
                        }
                    }
                    if (currentChunk) {
                        finalParagraphs.push(currentChunk.trim());
                        chunkCount++;
                    }
                    console.log(`Split paragraph into ${chunkCount} chunks`);
                }

                console.log(`Total paragraphs split: ${splitCount}`);
                console.log(`Final paragraph count: ${finalParagraphs.length}`);
                console.log(`First few final paragraphs for verification:`);
                finalParagraphs.slice(0, 3).forEach((para, i) => {
                    console.log(`Paragraph ${i + 1} (${para.length} chars): ${para.substring(0, 100)}...`);
                });

                return finalParagraphs;
            } catch (error) {
                console.log(`Intl.Segmenter failed, falling back to natural.SentenceTokenizer: ${error.message}`);
                console.log(`Error details:`, error);
                
                // Fallback to original implementation
                let transcriptSentences;
                if (languageCode === "cmn" || languageCode === "und") {
                    console.log(`Detected language is Chinese or undetermined, splitting by punctuation...`);
                    transcriptSentences = transcript
                        .split(/[\u3002\uff1f\uff01\uff1b\uff1a\u201c\u201d\u2018\u2019]/)
                        .map(s => s.trim())
                        .filter(Boolean);
                    console.log(`Split Chinese text into ${transcriptSentences.length} sentences using punctuation`);
                } else {
                    console.log(`Detected language is not Chinese, splitting by sentence tokenizer...`);
                    const tokenizer = new natural.SentenceTokenizer();
                    transcriptSentences = tokenizer.tokenize(transcript).map(s => s.trim());
                    console.log(`Split text into ${transcriptSentences.length} sentences using natural.SentenceTokenizer`);
                }

                console.log(`First few sentences for verification:`);
                transcriptSentences.slice(0, 3).forEach((sentence, i) => {
                    console.log(`Sentence ${i + 1}: ${sentence.substring(0, 100)}...`);
                });

                function sentenceGrouper(arr, sentencesPerParagraph) {
                    console.log(`Grouping ${arr.length} sentences into paragraphs of ${sentencesPerParagraph} sentences each`);
                    const newArray = [];
                    for (let i = 0; i < arr.length; i += sentencesPerParagraph) {
                        newArray.push(arr.slice(i, i + sentencesPerParagraph).join(" ").trim());
                    }
                    console.log(`Created ${newArray.length} initial paragraphs`);
                    return newArray;
                }

                function charMaxChecker(arr, maxSize) {
                    console.log(`Checking character limits for ${arr.length} paragraphs (max: ${maxSize} chars)`);
                    const hardLimit = 1800;
                    console.log(`Using hard limit of ${hardLimit} characters`);
                    
                    const result = arr
                        .map((element, index) => {
                            console.log(`Processing paragraph ${index + 1} (${element.length} chars)`);
                            let chunks = [];
                            let currentIndex = 0;
                            let chunkCount = 0;

                            while (currentIndex < element.length) {
                                let nextCutIndex = Math.min(currentIndex + maxSize, element.length);
                                let nextSpaceIndex = element.indexOf(" ", nextCutIndex);

                                if (nextSpaceIndex === -1 || nextSpaceIndex - currentIndex > hardLimit) {
                                    console.log(`No space found or hard limit reached in paragraph ${index + 1}, splitting at ${nextCutIndex}`);
                                    nextSpaceIndex = nextCutIndex;
                                }

                                while (
                                    nextSpaceIndex > 0 &&
                                    isHighSurrogate(element.charCodeAt(nextSpaceIndex - 1))
                                ) {
                                    nextSpaceIndex--;
                                }

                                chunks.push(element.substring(currentIndex, nextSpaceIndex).trim());
                                chunkCount++;
                                currentIndex = nextSpaceIndex + 1;
                            }

                            console.log(`Split paragraph ${index + 1} into ${chunkCount} chunks`);
                            return chunks;
                        })
                        .flat();

                    console.log(`Final paragraph count after character limit check: ${result.length}`);
                    return result;
                }

                function isHighSurrogate(charCode) {
                    return charCode >= 0xd800 && charCode <= 0xdbff;
                }

                const paragraphs = sentenceGrouper(transcriptSentences, sentencesPerParagraph);
                const finalParagraphs = charMaxChecker(paragraphs, maxLength);
                
                console.log(`Fallback method completed. Final paragraph count: ${finalParagraphs.length}`);
                console.log(`First few final paragraphs for verification:`);
                finalParagraphs.slice(0, 3).forEach((para, i) => {
                    console.log(`Paragraph ${i + 1} (${para.length} chars): ${para.substring(0, 100)}...`);
                });

                return finalParagraphs;
            }
        },
    }
}