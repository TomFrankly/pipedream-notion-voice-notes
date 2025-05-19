/**
 * To Do
 * - [ ] Move all needed transcription code 
 * - [ ] Add an option to transcribe a very short test file
 * - [ ] Add validation to ensure file is over 1 second, if duration can be determined
 * - [ ] Add Deegram as an option
 * - [ ] Add SRT output as an option
 * - [ ] Pause until callback (deepgram only)
 * -- Notes: Re-awakening on a callback will use another credit. So we could only pass a callback on files that are going to take a long time to transcribe.
 */

/**
 * Maximizing performance:
 * 
 * Option 1: Chunking
 * - Benefit: Faster, may use fewer Pipedream credits
 * - Drawbacks: Risk of cutting off words or sentences, more complexity due to VTT chunking, more complex to summarize
 * - Get the full duration of the file and store it
 * - Split long files into chunks, named sequentially
 * - Get the duration of each chunk and store it, along with a start index which is the end index of the previous chunk, and an end index which is the start index plus the duration.
 * - Transcribe each chunk
 * - Send each chunk through the VTT caption function
 * - Add every timestamp to the start time of the chunk to create a modified timestamp
 * - Send VTT chunk to OpenAI for summary with timestamp markers on summary points
 * - Concatenate all the VTT files into one
 * - Concatenate all the summaries into one
 * 
 * Option 2: Pause and resume with callback
 * - Benefit: No need to chunk the file, so no risk of cutting off words or sentences
 * - Drawback: Will take longer
 * - To optimize: Figure out when to use a callback. Will always use at least 2 Pipedream credits.
 * -- Initial guess calculation: File duration (in minutes) * 3.5 = workflow runtime in seconds
 * -- But only 20% of the time on my test file was spent transcribing, so we could use a lower multiplier. 6.7s on Deepgram to transcribe. But 34s to get the full result (albiet using Whisper, not Deepgram).
 * -- I think it only makes sense to do a callback if the file will take more than 30 seconds to transcribe.
 * Method:
 * - Get the full duration of the file and store it
 * - Transcribe the file
 * - Send the file through the VTT caption function
 * - Chunk the full VTT into smaller pieces based on LLM context window limit
 * - Send each chunk through the OpenAI summarization function
 * - Concatenate all the summaries into one
 */

/** 
 * Needed fields
 * - Deepgram API key
 * - OpenAI API key
 * [x] Transcription service choice
 * [x] Steps
 * [ ] Include timestamps (only deepgram)
 * [ ] Chunking options
 * 
 * Needed instructions
 * - Try testing on a short file first! No need to wait a long time and spend money on a long file if it doesn't work. Here's a link to one you can download, then upload to your chosen cloud storage app.
 */

/* IMPORTS */

// Transcription clients
import { createClient } from "@deepgram/sdk";
import { webvtt } from "@deepgram/captions";
import OpenAI from "openai";

// Rate limiting and error handling
import Bottleneck from "bottleneck";
import retry from "async-retry";

// Node.js utils
import stream from "stream";
import { promisify } from "util";
import fs from "fs";
import got from "got";
import { inspect } from "util";
import { join, extname } from "path";
import { exec } from "child_process";

// Other libraries
import { parseFile } from "music-metadata";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { encode, decode } from "gpt-3-encoder";
import natural from "natural";
import {franc, francAll} from 'franc';

// Project utils
import lang from "../helpers/languages.mjs";
import common from "../helpers/common.mjs";
import translation from "../helpers/translate-transcript.mjs";
import openaiOptions from "../helpers/openai-options.mjs";
import EMOJI from '../helpers/emoji.mjs';
import RATES from '../helpers/rates.mjs';

const config = {
	filePath: "",
	chunkDir: "",
	supportedMimes: [".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"],
	no_duration_flag: false
};

export default {
    name: "Flylighter Transcribe",
    description: "MVP Transcriber Module",
    key: "beta-fly-transcribe",
    version: "0.0.16",
    type: "action",
    props: {
        steps: common.props.steps,
        transcription_service: {
            type: "string",
            label: "Transcription Service",
            description: "Choose the service to use for transcription",
            options: ["OpenAI", "Deepgram"],
            default: "",
            reloadProps: true,
        }
    },
    async additionalProps() {
        const props = {}
        if (this.transcription_service === "OpenAI") {
            props.openai = {
                type: "app",
                app: "openai",
                description: `**Important:** If you're currently using OpenAI's free trial credit, your API key will be subject to much lower [rate limits](https://platform.openai.com/account/rate-limits), and may not be able to handle longer files (approx. 1 hour+, but the actual limit is hard to determine). If you're looking to work with long files, I recommend [setting up your billing info at OpenAI now](https://platform.openai.com/account/billing/overview).\n\nAdditionally, you'll need to generate a new API key and enter it here once you enter your billing information at OpenAI; once you do that, trial keys stop working.\n\n`,
            }
        }

        if (this.transcription_service === "Deepgram") {
            props.deepgram = {
                type: "app",
                app: "deepgram",
                reloadProps: true
            },
            props.include_timestamps = {
                type: "boolean",
                label: "Include Timestamps",
                description: "Include timestamps in the transcription",
                default: false
            }
        }
        
        return props
    },
    methods: {
        async checkSize(fileSize) {
			if (fileSize > 200000000) {
				throw new Error(
					`File is too large. Files must be under 200mb and one of the following file types: ${config.supportedMimes.join(
						", "
					)}.
					
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
        async downloadToTmp(fileLink, filePath) {
			try {
				// Define the mimetype
				const mime = filePath.match(/\.\w+$/)[0];

				// Check if the mime type is supported (mp3 or m4a)
				if (config.supportedMimes.includes(mime) === false) {
					throw new Error(
						`Unsupported file type. Supported file types include ${config.supportedMimes.join(', ')}.`
					);
				}

				// Define the tmp file path
				const tmpPath = `/tmp/${filePath.match(/[^\/]*\.\w+$/)[0].replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "")}`;

				// Download the audio recording from Dropbox to tmp file path
				const pipeline = promisify(stream.pipeline);
				await pipeline(got.stream(fileLink), fs.createWriteStream(tmpPath));

				// Create a results object
				const results = {
					path: tmpPath,
					mime: mime,
				};

				console.log("Downloaded file to tmp storage:");
				console.log(results);
				return results;
			} catch (error) {
				throw new Error(`Failed to download file: ${error.message}`);
			}
		},
        async getDuration(filePath) {
			try {
				let dataPack;
				try {
					dataPack = await parseFile(filePath);
				} catch (error) {
					throw new Error(
						"Failed to read audio file metadata. The file format might be unsupported or corrupted, or the file might no longer exist at the specified file path (which is in temp storage). If you are using the Google Drive or OneDrive versions of this workflow and are currently setting it up, please try testing your 'download' step again in order to re-download the file into temp storage. Then test this step again. Learn more here: https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/#error-failed-to-read-audio-file-metadata"
					);
				}

				const duration = Math.round(
					await inspect(dataPack.format.duration, {
						showHidden: false,
						depth: null,
					})
				);
				console.log(`Successfully got duration: ${duration} seconds`);
				return duration;
			} catch (error) {
				console.error(error);

				await this.cleanTmp(false);

				throw new Error(
					`An error occurred while processing the audio file: ${error.message}`
				);
			}
		},
        formatWebVTT(webVTTString) {
            // Split the input into lines
            const lines = webVTTString.split("\n");
            let formattedLines = [];
        
            for (let i = 0; i < lines.length; i++) {
                
                const clearedLine = lines[i].trim();
                
                if (clearedLine.match(/^\d{2}:\d{2}:\d{2}.\d{3}.*/)) {
                    // Keep only the start timestamp
                    const timestampParts = clearedLine.split(" --> ");
                    console.log(timestampParts);
                    formattedLines.push(timestampParts[0]);
                }
                // Check and format speaker lines
                else if (clearedLine.match(/<v ([^>]+)>(.*)/)) {
                    const speakerMatch = clearedLine.match(/<v ([^>]+)>(.*)/);
                    // Adjust speaker format
                    if (speakerMatch) {
                        formattedLines.push(`${speakerMatch[1]}: ${speakerMatch[2].trim()}`);
                    }
                } else {
                    // For lines that do not need formatting, push them as they are
                    formattedLines.push(clearedLine);
                }
            }
        
            return formattedLines.join("\n");
        }
    },
    async run({ steps, $ }) {
        const fileID = this.steps.trigger.event.id;
		const testEventId = "52776A9ACB4F8C54!134";

		if (fileID === testEventId) {
			throw new Error(
				`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file (mp3 or m4a) to Dropbox, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`
			);
		}

		console.log("Checking that file is under 300mb...");
		await this.checkSize(this.steps.trigger.event.size);
		console.log("File is under the size limit. Continuing...");

		//console.log("Checking if the user set languages...");
		//this.setLanguages();

		/*const logSettings = {
			"Chat Model": this.chat_model,
			"Summary Options": this.summary_options,
			"Summary Density": this.summary_density,
			Verbosity: this.verbosity,
			"Temperature:": this.temperature,
			"Audio File Chunk Size": this.chunk_size,
			"Moderation Check": this.disable_moderation_check,
			"Note Title Property": this.noteTitle,
			"Note Tag Property": this.noteTag,
			"Note Tag Value": this.noteTagValue,
			"Note Duration Property": this.noteDuration,
			"Note Cost Property": this.noteCost,
			"Transcript Language": this.transcript_language ?? "No language set.",
			"Summary Language": this.summary_language ?? "No language set.",
		};*/

		const fileInfo = {};

		if (this.steps.google_drive_download?.$return_value?.name) {
			// Google Drive method
			fileInfo.path = `/tmp/${this.steps.google_drive_download.$return_value.name.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "")}`;
			console.log(`File path of Google Drive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			if (config.supportedMimes.includes(fileInfo.mime) === false) {
				throw new Error(
					`Unsupported file type. OpenAI's Whisper transcription service only supports the following file types: ${config.supportedMimes.join(
						", "
					)}.`
				);
			}
		} else if (this.steps.download_file?.$return_value?.name) {
			// Google Drive fallback method
			fileInfo.path = `/tmp/${this.steps.download_file.$return_value.name.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "")}`;
			console.log(`File path of Google Drive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
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
			fileInfo.path = this.steps.ms_onedrive_download.$return_value.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\]/g, "");
			console.log(`File path of MS OneDrive file: ${fileInfo.path}`);
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			if (config.supportedMimes.includes(fileInfo.mime) === false) {
				throw new Error(
					`Unsupported file type. OpenAI's Whisper transcription service only supports the following file types: ${config.supportedMimes.join(
						", "
					)}.`
				);
			}
		} else {
			// Dropbox method
			Object.assign(
				fileInfo,
				await this.downloadToTmp(
					this.steps.trigger.event.link,
					this.steps.trigger.event.path_lower,
					this.steps.trigger.event.size
				)
			);
			console.log(`File path of Dropbox file: ${fileInfo.path}`);
		}

		config.filePath = fileInfo.path;

		fileInfo.duration = await this.getDuration(fileInfo.path);
        
        const deepgram = createClient(this.deepgram.$auth.api_key);
        
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            fs.createReadStream(fileInfo.path),
            {
                model: "nova-2",
                smart_format: true,
                detect_language: true,
                diarize: true,
                keywords: [
                    {"word": "Flylighter", "boost": 1.5},
                ]
            }
        )

        if (error) {
            throw new Error(`Deepgram error: ${error.message}`);
        }

        const vttOutput = this.formatWebVTT(webvtt(result));

        const output = {
            config: config,
            fileInfo: fileInfo,
            result: {
                metadata: result?.metadata ?? "No metadata available",
                raw_transcript: result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "Transcript not available",
                raw_transcript_confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence ?? "Confidence score not available",
                paragraphs: result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript ?? "No paragraphs available",
                detected_language: result?.results?.channels?.[0]?.detected_language ?? "Language not detected",
                language_confidence: result?.results?.channels?.[0]?.language_confidence ?? "Language confidence not available",
            },
            vttOutput: vttOutput ?? "VTT output not available"
        };        

        return output
    }
}

