import OpenAI from "openai"; // OpenAI SDK
import Groq from "groq-sdk"; // Groq SDK
import { createClient } from "@deepgram/sdk"; // Deepgram SDK
import { webvtt } from "@deepgram/captions"; // Deepgram WebVTT formatter
import { ElevenLabsClient } from "elevenlabs";
import {
    GoogleGenAI,
    createUserContent,
    createPartFromUri,
} from "@google/genai";
import fs from "fs";
import { join } from "path";
import retry from "async-retry";
import Bottleneck from "bottleneck";

export default {
    methods: {
        async transcribeFiles({ files, outputDir }) {
			let maxConcurrent;
            let apiKey;

            if (this.transcription_service === "openai") {
                maxConcurrent = 50;
                apiKey = this.openai.$auth.api_key;
            } else if (this.transcription_service === "deepgram") {
                maxConcurrent = 50;
                apiKey = this.deepgram.$auth.api_key;
            } else if (this.transcription_service === "groqcloud") {
                maxConcurrent = 20;
                apiKey = this.groqcloud.$auth.api_key;
            } else if (this.transcription_service === "elevenlabs") {
                maxConcurrent = 10;
                apiKey = this.elevenlabs.$auth.api_key;
            } else if (this.transcription_service === "google_gemini") {
                maxConcurrent = 15;
                apiKey = this.google_gemini.$auth.api_key;
            }

            console.log(`Limiting transcription to ${maxConcurrent} concurrent requests.`);
            console.log("Selected transcription service:", this.transcription_service);

            const limiter = new Bottleneck({
				maxConcurrent: maxConcurrent,
				minTime: 1000 / maxConcurrent,
			});

            const readStreams = new Set();

			return Promise.all(
				files.map((file) => {
					return limiter.schedule(async () => {
                        const readStream = fs.createReadStream(join(outputDir, file));
                        readStreams.add(readStream);
                        
                        try {
                            const result = await this.transcribe({
                                file,
                                outputDir,
                                service: this.transcription_service,
                                model: this.transcription_model,
                                apiKey: apiKey,
                                readStream
                            });
                            return result;
                        } finally {
                            readStream.destroy();
                            readStreams.delete(readStream);
                        }
                    });
				})
			).finally(() => {
                // Clean up any remaining streams
                for (const stream of readStreams) {
                    stream.destroy();
                }
                readStreams.clear();
            });
		},
        async transcribe({ file, outputDir, service, model, apiKey, readStream }) {
            return retry(
                async (bail, attempt) => {
                    console.log(`Attempt ${attempt}: Transcribing file ${file} with service ${service} and model ${model}.`);
                    
                    try {
                        let result;
                        switch (service.toLowerCase()) {
                            case "openai":
                                console.log("Routing to OpenAI transcription");
                                result = await this.transcribeOpenAI({ model, apiKey, readStream });
                                break;
                            case "groqcloud":
                                console.log("Routing to Groq transcription");
                            result = await this.transcribeGroq({ model, apiKey, readStream });
                                break;
                            case "deepgram":
                                console.log("Routing to Deepgram transcription");
                                result = await this.transcribeDeepgram({ model, apiKey, readStream });
                                break;
                            case "elevenlabs":
                                console.log("Routing to ElevenLabs transcription");
                                result = await this.transcribeElevenLabs({ model, apiKey, readStream });
                                break;
                            case "google_gemini":
                                console.log("Routing to Google Gemini transcription");
                                result = await this.transcribeGoogle({ file, outputDir, model, apiKey, readStream });
                                break;
                            default:
                                throw new Error(`Unsupported transcription service: ${service}`);
                        }

                        console.log(`Successfully transcribed file ${file} with service ${service} and model ${model}.`);
                        return result;
                    } catch (error) {
                        console.error(`Error transcribing file ${file} with service ${service} and model ${model}:`, error);

                        // Check if error is recoverable
                        if (
                            error.message.toLowerCase().includes("econnreset") ||
                            error.message.toLowerCase().includes("connection error") ||
                            (error.status && error.status >= 500)
                        ) {
                            console.log(`Encountered a recoverable error. Retrying...`);
                            throw error;
                        } else {
                            console.log(`Encountered an error that won't be helped by retrying. Bailing...`);
                            bail(error);
                        }
                    }
                },
                {
                    retries: 3,
                    onRetry: (error, attempt) => {
                        console.log(`Retry attempt ${attempt} for file ${file} due to: ${error.message}`);
                    }
                }
            );
        },

        async transcribeOpenAI({ model = "whisper-1", apiKey, readStream }) {
            const openai = new OpenAI({ apiKey });
            
            try {
                // Determine if we're using a GPT-4o model
                const isGPT4oModel = model.toLowerCase().includes('gpt-4o');
                
                // Set up base request parameters
                const requestParams = {
                    file: readStream,
                    model,
                    response_format: isGPT4oModel ? "json" : "verbose_json",
                };

                // Add temperature if provided (convert from 0-20 scale to 0-1 scale)
                if (this.whisper_temperature !== undefined) {
                    requestParams.temperature = this.whisper_temperature / 10;
                }

                // Add prompt if provided
                if (this.whisper_prompt) {
                    requestParams.prompt = this.whisper_prompt;
                    console.log(`Using custom prompt: ${this.whisper_prompt}`);
                }

                // Add timestamp granularities only for non-GPT-4o models
                if (!isGPT4oModel) {
                    requestParams.timestamp_granularities = ["segment"];
                }

                const response = await openai.audio.transcriptions.create(requestParams);

                // Handle different response formats
                if (isGPT4oModel) {
                    return {
                        text: response.text,
                        metadata: {
                            language: response.language,
                            duration: response.duration,
                            model,
                            logprobs: response.logprobs
                        }
                    };
                } else {
                    return {
                        text: response.text,
                        timestamps: response.segments,
                        vtt: this.generateVTT(response.segments),
                        metadata: {
                            language: response.language,
                            duration: response.duration,
                            model
                        }
                    };
                }
            } catch (error) {
                let errorText;

                if (/connection error/i.test(error.message)) {
                    errorText = `PLEASE READ THIS ENTIRE ERROR MESSAGE.
                    
                    An error occured while sending the chunks to OpenAI.
                    
                    If the full error below says "Unidentified connection error", please double-check that you have entered valid billing info in your OpenAI account. Afterward, generate a new API key and enter it in the OpenAI app here in Pipedream. Then, try running the workflow again.

                    IF THAT DOES NOT WORK, IT MEANS OPENAI'S SERVERS ARE OVERLOADED RIGHT NOW. "Connection error" means OpenAI's servers simply rejected the request. Please come back and retry the workflow later.
                    
                    If retrying later does not work, please open an issue at this workflow's Github repo: https://github.com/TomFrankly/pipedream-notion-voice-notes/issues

                    IMPORTANT: OpenAI's Speech-to-Text API is easily the most fragile of all the transcription services. It gets overloaded and rejects requests all the time. You'll likely have better results with one of the other services. If you're on Pipedream's free plan, you can use Groq for both transcription and summarization while staying within the 3-connection limit.`;
                } else if (/Invalid file format/i.test(error.message)) {
                    errorText = `An error occured while sending the chunks to OpenAI.

                    Note: OpenAI officially supports .m4a files, but some apps create .m4a files that OpenAI can't read. If you're using an .m4a file, try converting it to .mp3 and running the workflow again.`;
                } else {
                    errorText = `An error occured while sending the chunks to OpenAI.`;
                }

                throw new Error(
                    `${errorText}
                    
                    Full error from OpenAI: ${error.message}`
                );
            }
        },

        async transcribeGroq({ model = "distil-whisper-large-v3-en", apiKey, readStream }) {
            const groq = new Groq({ apiKey });
            
            try {
                // Set the request parameters
                const requestParams = {
                    file: readStream,
                    model,
                    response_format: "verbose_json",
                    timestamp_granularities: ["segment"]
                };

                // Add the whisper prompt if provided
                if (this.whisper_prompt) {
                    requestParams.prompt = this.whisper_prompt;
                    console.log(`Using custom prompt: ${this.whisper_prompt}`);
                }

                // Add temperature if provided (convert from 0-20 scale to 0-1 scale)
                if (this.whisper_temperature !== undefined) {
                    requestParams.temperature = this.whisper_temperature / 10;
                }
                
                const response = await groq.audio.transcriptions.create(requestParams);

                return {
                    text: response.text,
                    timestamps: response.segments,
                    vtt: this.generateVTT(response.segments),
                    metadata: {
                        language: response.language,
                        duration: response.duration,
                        model
                    }
                };
            } catch (error) {
                throw new Error(`Groq transcription error: ${error.message}`);
            }
        },

        async transcribeDeepgram({ model = "nova-3", apiKey, readStream }) {
            const deepgram = createClient(apiKey);
            
            try {
                console.log("Starting Deepgram transcription request...");
                const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                    readStream,
                    {
                        model: model,
                        detect_language: true,
                        diarize: true,
                        numerals: true,
                        measurements: true,
                        punctuate: true,
                        dictation: true,
                        summarize: "v2",
                        utterances: true
                    }
                );

                if (error) {
                    console.error("Deepgram error response:", error);
                    throw new Error(`Deepgram error: ${error.message}`);
                }

                // Debug logging for response structure
                console.log("Deepgram response structure:", {
                    hasResult: !!result,
                    resultKeys: result ? Object.keys(result) : null,
                    hasResults: result?.results ? true : false,
                    resultsKeys: result?.results ? Object.keys(result.results) : null,
                    hasChannels: result?.results?.channels ? true : false,
                    channelCount: result?.results?.channels?.length,
                    hasAlternatives: result?.results?.channels?.[0]?.alternatives ? true : false,
                    alternativeCount: result?.results?.channels?.[0]?.alternatives?.length,
                    transcriptPreview: result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.substring(0, 100) + "...",
                    confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence,
                    hasParagraphs: !!result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs,
                    detectedLanguage: result?.results?.channels?.[0]?.detected_language,
                    metadataKeys: result?.metadata ? Object.keys(result.metadata) : null
                });

                // Log the actual response object structure
                console.log("Raw Deepgram response:", JSON.stringify(result, null, 2).substring(0, 500) + "...");

                const vttOutput = webvtt(result);

                // Log the VTT output structure
                console.log("VTT output structure:", {
                    hasVtt: !!vttOutput,
                    vttLength: vttOutput?.length,
                    vttPreview: vttOutput?.substring(0, 100) + "..."
                });

                // Create the return object
                const returnObject = {
                    text: result.results.channels[0].alternatives[0].transcript,
                    confidence: result.results.channels[0].alternatives[0].confidence,
                    paragraphs: result.results.channels[0].alternatives[0].paragraphs?.transcript,
                    language: result.results.channels[0].detected_language,
                    utterances: result.results.utterances,
                    vtt: vttOutput,
                    metadata: {
                        ...result.metadata,
                        model
                    }
                };

                // Log the return object structure
                console.log("Return object structure:", {
                    keys: Object.keys(returnObject),
                    textLength: returnObject.text?.length,
                    hasConfidence: !!returnObject.confidence,
                    hasParagraphs: !!returnObject.paragraphs,
                    hasLanguage: !!returnObject.language,
                    hasVtt: !!returnObject.vtt,
                    metadataKeys: Object.keys(returnObject.metadata)
                });

                return returnObject;
            } catch (error) {
                console.error("Deepgram transcription error details:", {
                    name: error.name,
                    message: error.message,
                    stack: error.stack?.split('\n').slice(0, 3).join('\n')
                });
                throw new Error(`Deepgram transcription error: ${error.message}`);
            }
        },

        async transcribeElevenLabs({ model = "scribe_v1", apiKey, readStream }) {
            const client = new ElevenLabsClient({ apiKey });
            
            try {
                const response = await client.speechToText.convert({
                    model_id: model,
                    file: readStream,
                    diarize: true,
                    timestamps_granularity: "word",
                    tag_audio_events: true,
                    additional_formats: [
                        {
                            format: "srt"
                        }
                    ]
                });

                return {
                    text: response.text,
                    timestamps: response.timestamps,
                    speakers: response.speakers,
                    audio_events: response.audio_events,
                    additional_formats: response.additional_formats,
                    metadata: {
                        language: response.language,
                        duration: response.duration,
                        model
                    }
                };
            } catch (error) {
                throw new Error(`ElevenLabs transcription error: ${error.message}`);
            }
        },

        async transcribeGoogle({ file, outputDir, model = "gemini-2.0-flash", apiKey, readStream }) {
            const ai = new GoogleGenAI({ apiKey });
            const filePath = join(outputDir, file);
            
            try {
                const myfile = await ai.files.upload({
                    file: filePath,
                    config: { mimeType: "audio/mp3" }
                });

                // Add prompt if provided
                let prompt;
                if (this.whisper_prompt) {
                    prompt = this.whisper_prompt;
                } else {
                    prompt = "Transcribe this audio file completely and accurately. Remove filler words like 'um' and 'like'. Remove stammering. Convert numbers to numerals. Convert measurements to numerals with units. Do not add any additional text or commentary.";
                }
                
                const response = await ai.models.generateContent({
                    model,
                    contents: createUserContent([
                        createPartFromUri(myfile.uri, myfile.mimeType),
                        prompt
                    ])
                });

                return {
                    text: response.text,
                    metadata: {
                        model,
                        file_info: myfile
                    }
                };
            } catch (error) {
                throw new Error(`Google Gemini transcription error: ${error.message}`);
            }
        },

        generateVTT(timestamps) {
            if (!timestamps || !Array.isArray(timestamps)) {
                return '';
            }

            let vtt = '';

            // Convert each timestamp segment to VTT format
            timestamps.forEach((segment, index) => {
                // Format timestamps to VTT format (HH:MM:SS.mmm)
                const startTime = this.formatTimestamp(segment.start);
                const endTime = this.formatTimestamp(segment.end);
                
                // Add cue number and timestamps
                vtt += `${index + 1}\n`;
                vtt += `${startTime} --> ${endTime}\n`;
                
                // Add text content
                vtt += `${segment.text.trim()}\n\n`;
            });

            return vtt;
        },

        formatTimestamp(seconds) {
            const date = new Date(seconds * 1000);
            const hours = date.getUTCHours().toString().padStart(2, '0');
            const minutes = date.getUTCMinutes().toString().padStart(2, '0');
            const secs = date.getUTCSeconds().toString().padStart(2, '0');
            const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
            
            return `${hours}:${minutes}:${secs}.${ms}`;
        }
    }
}