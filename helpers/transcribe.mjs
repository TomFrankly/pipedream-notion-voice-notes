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
import { AssemblyAI } from "assemblyai"; // AssemblyAI SDK
import fs from "fs";
import { join } from "path";
import retry from "async-retry";
import Bottleneck from "bottleneck";

export default {
    methods: {
        async transcribeFiles({ files, outputDir }) {
            let baseConcurrent;
            let apiKey;

            // Base concurrency limits per service
            if (this.transcription_service === "openai") {
                baseConcurrent = 50;
                apiKey = this.openai.$auth.api_key;
            } else if (this.transcription_service === "deepgram") {
                baseConcurrent = 50;
                apiKey = this.deepgram.$auth.api_key;
            } else if (this.transcription_service === "groqcloud") {
                baseConcurrent = 20;
                apiKey = this.groqcloud.$auth.api_key;
            } else if (this.transcription_service === "elevenlabs") {
                baseConcurrent = 10;
                apiKey = this.elevenlabs.$auth.api_key;
            } else if (this.transcription_service === "google_gemini") {
                baseConcurrent = 15;
                apiKey = this.google_gemini.$auth.api_key;
            } else if (this.transcription_service === "assemblyai") {
                baseConcurrent = 5;
                apiKey = this.assemblyai.$auth.api_key;
            }

            console.log(`Base API call concurrency for ${this.transcription_service}: ${baseConcurrent}`);

            const apiLimiter = new Bottleneck({
                maxConcurrent: baseConcurrent,
                minTime: Math.ceil(1000 / (baseConcurrent * 0.9)),
                reservoir: baseConcurrent * 2,
                reservoirRefreshAmount: baseConcurrent,
                reservoirRefreshInterval: 1000,
            });

            // Add error handlers for limiters
            apiLimiter.on("failed", (error, jobInfo) => {
                console.error(`API Limiter job failed: ${error.message}`);
            });

            const BASE_CHUNK_SIZE_MB = 10;
            const BASE_CONCURRENCY = 8;
            const MIN_CHUNK_SIZE_MB = 4;
            const MAX_CHUNK_SIZE_MB = 24;
            const MIN_CONCURRENCY = 6;
            const MAX_CONCURRENCY = 30;

            const chunkSizeMB = Math.max(MIN_CHUNK_SIZE_MB, Math.min(MAX_CHUNK_SIZE_MB, this.chunk_size || BASE_CHUNK_SIZE_MB));

            let dynamicConcurrency = Math.floor(BASE_CONCURRENCY * (BASE_CHUNK_SIZE_MB / chunkSizeMB));
            dynamicConcurrency = Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, dynamicConcurrency));

            console.log(`Dynamic concurrency for chunk size ${chunkSizeMB}MB: ${dynamicConcurrency}`);

            const processingLimiter = new Bottleneck({
                maxConcurrent: dynamicConcurrency,
                reservoir: dynamicConcurrency,
                reservoirRefreshAmount: dynamicConcurrency,
                reservoirRefreshInterval: 1000,
            });

            // Add error handler for processing limiter
            processingLimiter.on("failed", (error, jobInfo) => {
                console.error(`Processing Limiter job failed: ${error.message}`);
            });

            const readStreams = new Set();
            const results = [];
            let activeApiCalls = 0;
            let totalProcessed = 0;
            let lastLogTime = Date.now();
            const LOG_INTERVAL = 5000;
            
            const latencies = [];
            const startTime = Date.now();

            const memoryMultipliers = [];

            // Add cleanup function
            const cleanup = async () => {
                // Stop all limiters
                await apiLimiter.stop();
                await processingLimiter.stop();

                // Clean up any remaining streams
                for (const stream of readStreams) {
                    try {
                        stream.destroy();
                    } catch (error) {
                        console.error(`Error destroying stream: ${error.message}`);
                    }
                }
                readStreams.clear();
            };

            const logState = (stage, file) => {
                const now = Date.now();
                if (now - lastLogTime < LOG_INTERVAL && !['Start', 'End'].includes(stage)) {
                    return;
                }
                
                lastLogTime = now;
                const memoryUsage = process.memoryUsage();
                const memUsagePercent = (memoryUsage.heapUsed / (256 * 1024 * 1024)) * 100;
                
                if (['Start', 'End'].includes(stage)) {
                    console.log(`\n=== ${stage} State ===`);
                    console.log(`Active read streams: ${readStreams.size}`);
                    console.log(`Active API calls: ${activeApiCalls}`);
                    console.log(`Total chunks processed: ${totalProcessed}/${files.length}`);
                    console.log('Memory usage:');
                    console.log(`  RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB`);
                    console.log(`  Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
                    console.log(`  Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB (${Math.round(memUsagePercent)}%)`);
                    console.log(`  External: ${Math.round(memoryUsage.external / 1024 / 1024)}MB`);
                    console.log(`Active streams: ${readStreams.size}, Active API calls: ${activeApiCalls}`);
                    
                    if (stage === 'End') {
                        const totalTime = (Date.now() - startTime) / 1000;
                        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
                        const longestLatency = Math.max(...latencies);
                        const shortestLatency = Math.min(...latencies);

                        const avgMultiplier = memoryMultipliers.length > 0 ? (memoryMultipliers.reduce((a, b) => a + b, 0) / memoryMultipliers.length) : 0;
                        console.log('\nPerformance Metrics:');
                        console.log(`Total processing time: ${totalTime.toFixed(2)} seconds`);
                        console.log(`Average API latency: ${avgLatency.toFixed(2)} seconds`);
                        console.log(`Longest API latency: ${longestLatency.toFixed(2)} seconds`);
                        console.log(`Shortest API latency: ${shortestLatency.toFixed(2)} seconds`);
                        console.log(`Total chunks: ${files.length}`);
                        console.log(`Average time per chunk: ${(totalTime / files.length).toFixed(2)} seconds`);
                        console.log(`Average memory multiplier per chunk: ${avgMultiplier.toFixed(2)}`);
                        console.log(`Concurrency level: 10`);
                    }
                    
                    console.log('===============================\n');
                } else {
                    console.log(`\nProgress Update:`);
                    console.log(`Processed ${totalProcessed}/${files.length} chunks (${Math.round(totalProcessed/files.length * 100)}%)`);
                    console.log(`Active streams: ${readStreams.size}, Active API calls: ${activeApiCalls}`);
                    console.log(`Memory: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB RSS, ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB Heap Used (${Math.round(memUsagePercent)}%)`);
                    console.log(`Active streams: ${readStreams.size}, Active API calls: ${activeApiCalls}\n`);
                }
            };

            // Log initial state
            logState('Start', 'Initial');

            // Process files in parallel with controlled concurrency
            const processChunk = async (file, index) => {
                return await processingLimiter.schedule(async () => {
                    const filePath = join(outputDir, file);
                    const readStream = fs.createReadStream(filePath);
                    
                    // Add error handler for the stream
                    readStream.on('error', (error) => {
                        console.error(`Error reading file ${file}: ${error.message}`);
                        readStream.destroy();
                        readStreams.delete(readStream);
                    });

                    readStreams.add(readStream);

                    // Get chunk size
                    const { size: chunkSize } = await fs.promises.stat(filePath);
                    // Memory before
                    const memBefore = process.memoryUsage().heapUsed;

                    try {
                        // Use apiLimiter for the actual API call
                        return await apiLimiter.schedule(async () => {
                            activeApiCalls++;
                            const chunkStartTime = Date.now();

                            const result = await this.transcribe({
                                file,
                                outputDir,
                                service: this.transcription_service,
                                model: this.transcription_model,
                                apiKey: apiKey,
                                readStream
                            });

                            const chunkLatency = (Date.now() - chunkStartTime) / 1000;
                            latencies.push(chunkLatency);

                            // Memory after
                            const memAfter = process.memoryUsage().heapUsed;
                            const memDiff = memAfter - memBefore;
                            const multiplier = chunkSize > 0 ? memDiff / chunkSize : 0;
                            memoryMultipliers.push(multiplier);
                            console.log(`Chunk ${file}: size=${(chunkSize/1024/1024).toFixed(2)}MB, memDiff=${(memDiff/1024/1024).toFixed(2)}MB, multiplier=${multiplier.toFixed(2)}`);

                            activeApiCalls--;
                            totalProcessed++;
                            logState('Progress', file);

                            return result;
                        });
                    } catch (error) {
                        console.error(`Error processing chunk ${file}: ${error.message}`);
                        throw error;
                    } finally {
                        try {
                            readStream.destroy();
                            readStreams.delete(readStream);
                        } catch (error) {
                            console.error(`Error cleaning up stream for ${file}: ${error.message}`);
                        }
                    }
                });
            };

            try {
                // Process all chunks in parallel with controlled concurrency
                const chunkPromises = files.map((file, index) => processChunk(file, index));
                const chunkResults = await Promise.all(chunkPromises);
                results.push(...chunkResults);
            } catch (error) {
                console.error(`Error during transcription: ${error.message}`);
                throw error;
            } finally {
                // Ensure cleanup happens even if there's an error
                await cleanup();
            }

            // Log final state
            logState('End', 'Final');

            return results;
        },
        async transcribe({ file, outputDir, service, model, apiKey, readStream }) {
            return retry(
                async (bail, attempt) => {
                    console.log(`Attempt ${attempt}: Transcribing file ${file} with service ${service} and model ${model}.`);
                    
                    try {
                        let result;
                        switch (service.toLowerCase()) {
                            case "openai":
                                result = await this.transcribeOpenAI({ model, apiKey, readStream });
                                break;
                            case "groqcloud":
                                result = await this.transcribeGroq({ model, apiKey, readStream });
                                break;
                            case "deepgram":
                                result = await this.transcribeDeepgram({ model, apiKey, readStream });
                                break;
                            case "elevenlabs":
                                result = await this.transcribeElevenLabs({ model, apiKey, readStream });
                                break;
                            case "google_gemini":
                                result = await this.transcribeGoogle({ file, outputDir, model, apiKey, readStream });
                                break;
                            case "assemblyai":
                                result = await this.transcribeAssemblyAI({ model, apiKey, readStream });
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

                // Add language if provided
                if (this.whisper_language) {
                    requestParams.language = this.whisper_language;
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
                        // timestamps: response.segments,
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
                    
                    If retrying later does not work, please open an issue at this workflow's Github repo: https://github.com/TomFrankly/pipedream-notion-voice-notes/issues`;
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

                // Add language if provided
                if (this.whisper_language) {
                    requestParams.language = this.whisper_language;
                }
                
                const response = await groq.audio.transcriptions.create(requestParams);

                return {
                    text: response.text,
                    // timestamps: response.segments,
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

        async transcribeDeepgram({ model = "nova-3", apiKey, readStream, useSDK = true }) {
            try {
                let result;

                // Define common parameters for both SDK and fetch
                const transcriptionParams = {
                    model: model,
                    detect_language: true,
                    diarize: true,
                    numerals: true,
                    fill_words: false,
                    measurements: true,
                    profanity_filter: false,
                    smart_format: false,
                    dictation: false,
                    punctuate: true,
                    utterances: true
                };

                // Add language if provided
                if (this.whisper_language) {
                    transcriptionParams.language = this.whisper_language;
                }

                const deepgram = createClient(apiKey);
                const { result: sdkResult, error } = await deepgram.listen.prerecorded.transcribeFile(
                    readStream,
                    transcriptionParams
                );

                if (error) {
                    console.error("Deepgram error response:", error);
                    throw new Error(`Deepgram error: ${error.message}`);
                }
                result = sdkResult;
 
                if (result.error) {
                    console.error("Deepgram error response:", result.error);
                    throw new Error(`Deepgram error: ${result.error.message}`);
                }

                // Safely generate VTT output
                let vttOutput = '';
                try {
                    if (result && result.results && result.results.channels && result.results.channels[0]) {
                        vttOutput = webvtt(result);

                    } else {
                        console.warn("Deepgram response missing expected structure for VTT generation");
                    }
                } catch (vttError) {
                    console.warn("Error generating VTT:", vttError);
                    // Continue without VTT if generation fails
                }

                // Create the return object with safe property access
                const returnObject = {
                    text: result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
                    confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence,
                    // paragraphs: result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript,
                    language: result?.results?.channels?.[0]?.detected_language,
                    utterances: result?.results?.utterances,
                    vtt: vttOutput,
                    metadata: {
                        ...(result?.metadata || {}),
                        model
                    }
                };

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
                const requestParams = {
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
                }

                // Add language if provided
                if (this.whisper_language) {
                    requestParams.language = this.whisper_language;
                }
                
                const response = await client.speechToText.convert(requestParams);

                return {
                    text: response.text,
                    vtt: response.additional_formats[0].content,
                    speakers: response.speakers,
                    audio_events: response.audio_events,
                    // additional_formats: response.additional_formats,
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

        async transcribeAssemblyAI({ model = "best", apiKey, readStream }) {
            try {
                console.log(`Starting AssemblyAI transcription request with model ${model}...`);
                
                // Initialize AssemblyAI client
                const client = new AssemblyAI({
                    apiKey,
                });

                // Define transcription parameters similar to Deepgram
                const transcriptionParams = {
                    audio: readStream,
                    speech_model: model,
                    speaker_labels: true,
                    format_text: true,
                    punctuate: true,
                    boost_param: "high",
                    filter_profanity: false,
                    disfluencies: false,
                    auto_chapters: false,
                    auto_highlights: false,
                    sentiment_analysis: false,
                    summarization: false,
                    iab_categories: false,
                    redact_pii: false,
                    multichannel: false
                };

                // Add keyterms if provided and model is "slam-1"
                if (
                    this.keyterms 
                    && Array.isArray(this.keyterms) 
                    && this.keyterms.length > 0 
                    && this.keyterms.length < 1000 
                    && this.keyterms.every((term) => typeof term === "string")
                    && this.keyterms.every((term) => term.split(" ").length < 7)
                    && model === "slam-1"
                ) {
                    // Add keyterms to transcription parameters
                    console.log("Adding keyterms to transcription parameters...");
                    transcriptionParams.keyterms_prompt = this.keyterms;
                }

                // Add language_code if provided and if model is not "slam-1"
                if (this.whisper_language && model !== "slam-1") {
                    transcriptionParams.language_code = this.whisper_language;
                }

                // Submit transcription request and wait for completion
                const result = await client.transcripts.transcribe(transcriptionParams);

                if (result.status === "error") {
                    throw new Error(`AssemblyAI transcription failed: ${result.error}`);
                }

                // Use utterances array for VTT generation if available
                const utterances = result.utterances || [];

                return {
                    text: result.text,
                    confidence: result.confidence,
                    language: result.language_code,
                    vtt: this.generateVTT(utterances, { includeSpeaker: true }),
                    metadata: {
                        speech_model: result.speech_model,
                        duration: result.audio_duration,
                        speakers: result.speakers,
                        language_confidence: result.language_confidence,
                        entities: result.entities,
                    }
                };
            } catch (error) {
                console.error("AssemblyAI transcription error details:", {
                    name: error.name,
                    message: error.message,
                    stack: error.stack?.split('\n').slice(0, 3).join('\n')
                });
                throw new Error(`AssemblyAI transcription error: ${error.message}`);
            }
        },

        generateVTT(timestamps, options = {}) {
            if (!timestamps || !Array.isArray(timestamps)) {
                return '';
            }

            let vtt = '';
            timestamps.forEach((segment, index) => {
                // If start/end are in ms, convert to seconds
                const startSec = segment.start > 1000 ? segment.start / 1000 : segment.start;
                const endSec = segment.end > 1000 ? segment.end / 1000 : segment.end;
                const startTime = this.formatTimestamp(startSec);
                const endTime = this.formatTimestamp(endSec);

                vtt += `${index + 1}\n`;
                vtt += `${startTime} --> ${endTime}\n`;

                let text = segment.text ? segment.text.trim() : '';
                if (options.includeSpeaker && segment.speaker) {
                    text = `Speaker ${segment.speaker}: ${text}`;
                }
                vtt += `${text}\n\n`;
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