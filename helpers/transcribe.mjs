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

export default {
    methods: {
        async transcribe({ file, outputDir, service, model, apiKey }) {
            return retry(
                async (bail, attempt) => {
                    console.log(`Attempt ${attempt}: Transcribing file ${file} with ${service}`);
                    
                    try {
                        let result;
                        switch (service.toLowerCase()) {
                            case "openai":
                                result = await this.transcribeOpenAI({ file, outputDir, model, apiKey });
                                break;
                            case "groq":
                                result = await this.transcribeGroq({ file, outputDir, model, apiKey });
                                break;
                            case "deepgram":
                                result = await this.transcribeDeepgram({ file, outputDir, model, apiKey });
                                break;
                            case "elevenlabs":
                                result = await this.transcribeElevenLabs({ file, outputDir, model, apiKey });
                                break;
                            case "google":
                                result = await this.transcribeGoogle({ file, outputDir, model, apiKey });
                                break;
                            default:
                                throw new Error(`Unsupported transcription service: ${service}`);
                        }

                        console.log(`Successfully transcribed file ${file} with ${service}`);
                        return result;
                    } catch (error) {
                        console.error(`Error transcribing file ${file} with ${service}:`, error);

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
                        console.log(`Retrying transcription for ${file} due to error: ${error.message}`);
                    },
                }
            );
        },

        async transcribeOpenAI({ file, outputDir, model = "whisper-1", apiKey }) {
            const openai = new OpenAI({ apiKey });
            const readStream = fs.createReadStream(join(outputDir, file));
            
            try {
                const response = await openai.audio.transcriptions.create({
                    file: readStream,
                    model,
                    response_format: "verbose_json",
                    timestamp_granularities: ["segment"]
                });

                return {
                    text: response.text,
                    timestamps: response.segments,
                    metadata: {
                        language: response.language,
                        duration: response.duration,
                        model
                    }
                };
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
            } finally {
                readStream.destroy();
            }
        },

        async transcribeGroq({ file, outputDir, model = "whisper-large-v3-turbo", apiKey }) {
            const groq = new Groq({ apiKey });
            const readStream = fs.createReadStream(join(outputDir, file));
            
            try {
                const response = await groq.audio.transcriptions.create({
                    file: readStream,
                    model,
                    response_format: "verbose_json",
                    timestamp_granularities: ["word", "segment"]
                });

                return {
                    text: response.text,
                    timestamps: response.segments,
                    metadata: {
                        language: response.language,
                        duration: response.duration,
                        model
                    }
                };
            } catch (error) {
                throw new Error(`Groq transcription error: ${error.message}`);
            } finally {
                readStream.destroy();
            }
        },

        async transcribeDeepgram({ file, outputDir, model = "nova-3-general", apiKey }) {
            const deepgram = createClient(apiKey);
            const readStream = fs.createReadStream(join(outputDir, file));
            
            try {
                const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                    readStream,
                    {
                        model,
                        smart_format: true,
                        punctuate: true,
                        detect_language: true,
                        diarize: true,
                        numerals: false,
                        filler_words: true,
                        measurements: true,
                        profanity_filter: true,
                        dictation: true
                    }
                );

                if (error) {
                    throw new Error(`Deepgram error: ${error.message}`);
                }

                const vttOutput = webvtt(result);
                const speakers = new Set();
                
                if (result.results.channels[0].alternatives[0].words) {
                    for (const word of result.results.channels[0].alternatives[0].words) {
                        if (word.speaker) {
                            speakers.add(word.speaker);
                        }
                    }
                }

                return {
                    text: result.results.channels[0].alternatives[0].transcript,
                    confidence: result.results.channels[0].alternatives[0].confidence,
                    paragraphs: result.results.channels[0].alternatives[0].paragraphs?.transcript,
                    language: result.results.channels[0].detected_language,
                    language_confidence: result.results.channels[0].language_confidence,
                    vtt: vttOutput,
                    speakers: speakers.size,
                    metadata: {
                        ...result.metadata,
                        model
                    }
                };
            } catch (error) {
                throw new Error(`Deepgram transcription error: ${error.message}`);
            } finally {
                readStream.destroy();
            }
        },

        async transcribeElevenLabs({ file, outputDir, model = "scribe_v1", apiKey }) {
            const client = new ElevenLabsClient({ apiKey });
            const readStream = fs.createReadStream(join(outputDir, file));
            
            try {
                const response = await client.speechToText.convert({
                    model_id: model,
                    file: readStream,
                    diarize: true,
                    timestamps_granularity: "word",
                    tag_audio_events: true
                });

                return {
                    text: response.text,
                    timestamps: response.timestamps,
                    speakers: response.speakers,
                    audio_events: response.audio_events,
                    metadata: {
                        language: response.language,
                        duration: response.duration,
                        model
                    }
                };
            } catch (error) {
                throw new Error(`ElevenLabs transcription error: ${error.message}`);
            } finally {
                readStream.destroy();
            }
        },

        async transcribeGoogle({ file, outputDir, model = "gemini-2.0-flash", apiKey }) {
            const ai = new GoogleGenAI({ apiKey });
            const readStream = fs.createReadStream(join(outputDir, file));
            
            try {
                const myfile = await ai.files.upload({
                    file: readStream,
                    config: { mimeType: "audio/mp3" }
                });

                const response = await ai.models.generateContent({
                    model,
                    contents: createUserContent([
                        createPartFromUri(myfile.uri, myfile.mimeType),
                        "Transcribe this audio file with timestamps and speaker diarization"
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
            } finally {
                readStream.destroy();
            }
        }
    }
}