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

// Import local files
import prompts from "./prompts.mjs";

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

                    default:
                        throw new Error(`Unsupported service for response unification: ${service}`);
                }

                return unifiedResponse;
            } catch (error) {
                throw new Error(`Failed to unify response: ${error.message}`);
            }
        },

        // Splits a transcript into chunks of a specified maximum number of tokens
        splitTranscript(encodedTranscript, maxTokens, periodInfo) {
			console.log(`Splitting transcript into chunks of ${maxTokens} tokens...`);

			const stringsArray = [];
			let currentIndex = 0;
			let round = 0;

			while (currentIndex < encodedTranscript.length) {
				console.log(`Round ${round++} of transcript splitting...`);

				let endIndex = Math.min(currentIndex + maxTokens, encodedTranscript.length);

				console.log(`Current endIndex: ${endIndex}`);
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

					console.log(
						`endIndex updated to ${endIndex} to keep sentences whole. Non-period endIndex was ${nonPeriodEndIndex}. Total added/removed tokens to account for this: ${
							endIndex - nonPeriodEndIndex
						}.`
					);
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
            const systemMessage = `Detect the language of the prompt, then return a valid JSON object containing the language name and language code of the text.
                                    
            Example: {"label": "English", "value": "en"}`;
        
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

                return this.repairJSON(response.content);
            } catch (error) {
                throw new Error(`Language detection failed with error: ${error.message}`);
            }
        },

        /**
         * Translates an array of text paragraphs into the specified language.
         *
         * @param {string} service - The service provider, e.g., "OpenAI" or "Anthropic".
         * @param {string} model - The specific language model to use for translation.
         * @param {string[]} stringsArray - Array of text paragraphs to translate.
         * @param {Object} language - Object containing language label and value.
         * @param {number} temperature - Temperature setting for the translation (default: 0.2).
         * @param {number} maxConcurrent - Maximum number of concurrent translations (default: 35).
         * @returns {Promise<Object>} - A promise that resolves to the translation results.
         * @throws {Error} - Throws an error if the translation fails.
         */
        async translateParagraphs(
            service,
            model,
            stringsArray,
            language,
            temperature = 2,
            maxConcurrent = 35
        ) {
            try {
                const limiter = new Bottleneck({
                    maxConcurrent: maxConcurrent,
                });

                console.log(`Sending ${stringsArray.length} paragraphs to ${service} for translation...`);
                
                const results = await limiter.schedule(() => {
                    const tasks = stringsArray.map((text, index) => {
                        const systemMessage = `Translate the text into ${language.label} (ISO 639-1 code: ${language.value}).`;

                        return this.llmRequest({
                            service,
                            model,
                            prompt: text,
                            systemMessage,
                            temperature,
                            log_action: (attempt) => `Attempt ${attempt}: Sending paragraph ${index} to ${service} for translation...`,
                            log_success: `Paragraph ${index} received successfully.`,
                            log_failure: (attempt, error) => `Attempt ${attempt} for translation of paragraph ${index} failed with error: ${error.message}. Retrying...`
                        });
                    });
                    return Promise.all(tasks);
                });

                const translationResult = {
                    paragraphs: results.map(result => result.content),
                    language: language.label,
                    languageCode: language.value,
                    usage: {
                        prompt_tokens: results.reduce((total, item) => total + item.usage.prompt_tokens, 0),
                        completion_tokens: results.reduce((total, item) => total + item.usage.completion_tokens, 0),
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

                        const systemMessage = this.createSystemMessage(index, this.summary_options, this.summary_verbosity, this.translation_language);
                        
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

            console.log(`ChatResponse object after LLM items have been inserted:`);
            console.dir(chatResponse, { depth: null });

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

            console.log(`Final ChatResponse object:`);
            console.dir(finalChatResponse, { depth: null });

            return finalChatResponse;
        },

        makeParagraphs(transcript, maxLength = 1200) {
            console.log(`Starting paragraph creation with maxLength: ${maxLength}`);
            const languageCode = franc(transcript);
            console.log(`Detected language with franc library: ${languageCode}`);

            // Set sentences per paragraph based on language
            const sentencesPerParagraph = (languageCode === "cmn" || languageCode === "und") ? 3 : 4;
            console.log(`Using ${sentencesPerParagraph} sentences per paragraph based on language detection`);

            try {
                console.log(`Attempting to use Intl.Segmenter for sentence segmentation...`);
                // Create a segmenter for sentences
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
                
                // Get sentence segments
                const segments = Array.from(segmenter.segment(transcript));
                const sentences = segments.map(segment => segment.segment);
                
                console.log(`Intl.Segmenter successfully created ${sentences.length} sentence segments`);
                console.log(`First few sentences for verification:`);
                sentences.slice(0, 3).forEach((sentence, i) => {
                    console.log(`Sentence ${i + 1}: ${sentence.substring(0, 100)}...`);
                });

                // Group sentences into paragraphs
                const paragraphs = [];
                for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
                    paragraphs.push(sentences.slice(i, i + sentencesPerParagraph).join(' '));
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
                        if (currentChunk.length + word.segment.length + 1 <= maxLength) {
                            currentChunk += (currentChunk ? ' ' : '') + word.segment;
                        } else {
                            if (currentChunk) {
                                finalParagraphs.push(currentChunk);
                                chunkCount++;
                            }
                            currentChunk = word.segment;
                        }
                    }
                    if (currentChunk) {
                        finalParagraphs.push(currentChunk);
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
                        .filter(Boolean);
                    console.log(`Split Chinese text into ${transcriptSentences.length} sentences using punctuation`);
                } else {
                    console.log(`Detected language is not Chinese, splitting by sentence tokenizer...`);
                    const tokenizer = new natural.SentenceTokenizer();
                    transcriptSentences = tokenizer.tokenize(transcript);
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
                        newArray.push(arr.slice(i, i + sentencesPerParagraph).join(" "));
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

                                chunks.push(element.substring(currentIndex, nextSpaceIndex));
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