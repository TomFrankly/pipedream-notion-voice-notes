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

// Import language data
import { LANGUAGES } from "./languages.mjs";

// Import utilities
import retry from "async-retry"; // Retry handler

export default {
    methods: {
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
                        default:
                            throw new Error(`Unsupported LLM service: ${service}`);
                    }

                    console.log(log_success);
                    console.dir(response);
                    return this.unifyLLMResponse(response, service);
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
                const model = genAI.getGenerativeModel({ model: model ?? "gemini-2.0-flash" });
                
                const response = await model.generateContent({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }]
                        }
                    ],
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
                        unifiedResponse.id = response.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                        unifiedResponse.model = response.model ?? "gemini-2.0-flash";
                        unifiedResponse.content = response.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                        unifiedResponse.usage = {
                            prompt_tokens: response.response?.usageMetadata?.promptTokenCount ?? 0,
                            completion_tokens: response.response?.usageMetadata?.candidatesTokenCount ?? 0,
                            total_tokens: (response.response?.usageMetadata?.promptTokenCount ?? 0) + 
                                        (response.response?.usageMetadata?.candidatesTokenCount ?? 0)
                        };
                        break;

                    default:
                        throw new Error(`Unsupported service for response unification: ${service}`);
                }

                return unifiedResponse;
            } catch (error) {
                throw new Error(`Failed to unify response: ${error.message}`);
            }
        }
    }
}