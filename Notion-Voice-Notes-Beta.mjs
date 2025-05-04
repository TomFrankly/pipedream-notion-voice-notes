/* -- Imports -- */

// Transcription and LLM clients
import { createClient } from "@deepgram/sdk"; // Deepgram SDK
import { webvtt } from "@deepgram/captions"; // Deepgram WebVTT formatter
import OpenAI from "openai"; // OpenAI SDK
import Anthropic from "@anthropic-ai/sdk";

// Other clients
import { Client } from "@notionhq/client"; // Notion SDK

// Audio utils
import { parseFile } from "music-metadata"; // Audio duration parser
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"; // ffmpeg

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
import lang from "./helpers/languages.mjs"; // Language codes
import common from "./helpers/common.mjs"; // Common methods
import chat from "./helpers/chat.mjs"; // LLM API methods
import translation from "./helpers/translate-transcript.mjs"; // Transcript translation
import openaiOptions from "./helpers/openai-options.mjs"; // OpenAI options
import EMOJI from "./helpers/emoji.mjs"; // Emoji list
import MODEL_INFO from "./helpers/model-info.mjs"; // LLM model pricing, context window, and output limits

const execAsync = promisify(exec);

const config = {
	filePath: "",
	chunkDir: "",
	supportedMimes: [".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"],
	no_duration_flag: false,
};

export default {
	name: "Beta Voice Notes",
	description:
		"Transcribes audio files, summarizes the transcript, and sends both transcript and summary to Notion.",
	key: "beta-voice-notes",
	version: "0.0.26",
	type: "action",
	props: {
		notion: {
			type: "app",
			app: "notion",
			description: `⬆ Don\'t forget to connect your Notion account! Additionally, be sure to give Pipedream access to your Notes database, or to a page that contains it.\n\n## Overview\n\nThis workflow lets you create perfectly-transcribed and summarized notes from voice recordings.\n\nIt also creates useful lists from the transcript, including:\n\n* Main points\n* Action items\n* Follow-up questions\n* Potential rebuttals\n\n**Need help with this workflow? [Check out the full instructions and FAQ here.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)**\n\n## Compatibility\n\nThis workflow will work with any Notion database.\n\n### Upgrade Your Notion Experience\n\nWhile this workflow will work with any Notion database, it\'s even better with a template.\n\nFor general productivity use, you\'ll love [Ultimate Brain](https://thomasjfrank.com/brain/) – my all-in-one second brain template for Notion. \n\nUltimate Brain brings tasks, notes, projects, and goals all into one tool. Naturally, it works very well with this workflow.\n\n**Are you a creator?** \n\nMy [Creator\'s Companion](https://thomasjfrank.com/creators-companion/) template includes a ton of features that will help you make better-performing content and optimize your production process. There\'s even a version that includes Ultimate Brain, so you can easily use this workflow to create notes whenever you have an idea for a new video or piece of content.\n\n## Instructions\n\n[Click here for the full instructions on setting up this workflow.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)\n\n## More Resources\n\n**More automations you may find useful:**\n\n* [Create Tasks in Notion with Your Voice](https://thomasjfrank.com/notion-chatgpt-voice-tasks/)\n* [Notion to Google Calendar Sync](https://thomasjfrank.com/notion-google-calendar-sync/)\n\n**All My Notion Automations:**\n\n* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)\n\n**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**\n\n* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)\n\n## Support My Work\n\nThis workflow is **100% free** – and it gets updates and improvements! *When there's an update, you'll see an **update** button in the top-right corner of this step.*\n\nIf you want to support my work, the best way to do so is buying one of my premium Notion Templates:\n\n* [Ultimate Brain](https://thomasjfrank.com/brain/) – the ultimate second-brain template for Notion\n* [Creator\'s Companion](https://thomasjfrank.com/creators-companion/) – my advanced template for serious content creators looking to publish better content more frequently\n\nBeyond that, sharing this automation\'s YouTube tutorial online or with friends is also helpful!`,
		},
		openai: {
			type: "app",
			app: "openai",
			description: `**Important:** If you're currently using OpenAI's free trial credit, your API key will be subject to much lower [rate limits](https://platform.openai.com/account/rate-limits), and may not be able to handle longer files (approx. 1 hour+, but the actual limit is hard to determine). If you're looking to work with long files, I recommend [setting up your billing info at OpenAI now](https://platform.openai.com/account/billing/overview).\n\nAdditionally, you'll need to generate a new API key and enter it here once you enter your billing information at OpenAI; once you do that, trial keys stop working.\n\n`,
		},
		steps: common.props.steps,
		summary_options: {
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
			default: ["Summary", "Main Points", "Action Items", "Follow-up Questions"],
			optional: false,
		},
		meta_options: {
			type: "string[]",
			label: "Meta Options",
			description: `Select the meta sections you'd like to include in your note.\n\nTop Callout will create a callout that includes the date the note was created and a link to the audio file. Table of Contents will create a table of contents block. Meta will create a section at the bottom that includes cost information.`,
			options: [
				"Top Callout",
				"Table of Contents",
				"Meta",
			],
			default: [],
			optional: true,
		},
		databaseID: common.props.databaseID,
	},
	async additionalProps() {
		let results;

		if (this.openai) {
			try {
				// Initialize OpenAI
				const openai = new OpenAI({
					apiKey: this.openai.$auth.api_key,
				});
				const response = await openai.models.list();

				const initialResults = response.data.filter(
					(model) =>
						model.id.includes("gpt")
				).sort((a, b) => a.id.localeCompare(b.id));

				const preferredModels = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]

				const preferredItems = []
				for (const model of preferredModels) {
					const index = initialResults.findIndex((result) => result.id === model)
					if (index !== -1) {
						preferredItems.push(initialResults.splice(index, 1)[0])
					}
				}

				results = [...preferredItems, ...initialResults];
			} catch (err) {
				console.error(
					`Encountered an error with OpenAI: ${err} – Please check that your API key is still valid.`
				);
			}
		}

		if (results === undefined || results.length === 0) {
			throw new Error(
				`No available ChatGPT models found. Please check that your OpenAI API key is still valid. If you have recently added billing information to your OpenAI account, you may need to generate a new API key.Keys generated during the trial credit period may not work once billing information is added.`
			);
		}

		if (!this.databaseID) return {};

		const notion = new Client({
			auth: this.notion.$auth.oauth_access_token,
		});

		const database = await notion.databases.retrieve({
			database_id: this.databaseID,
		});

		const properties = database.properties;

		const titleProps = Object.keys(properties).filter(
			(k) => properties[k].type === "title"
		);

		const numberProps = Object.keys(properties).filter(
			(k) => properties[k].type === "number"
		);

		const selectProps = Object.keys(properties).filter(
			(k) => properties[k].type === "select"
		);

		const dateProps = Object.keys(properties).filter(
			(k) => properties[k].type === "date"
		);

		const textProps = Object.keys(properties).filter(
			(k) => properties[k].type === "rich_text"
		);

		const urlProps = Object.keys(properties).filter(
			(k) => properties[k].type === "url"
		);

		const props = {
			noteTitle: {
				type: "string",
				label: "Note Title (Required)",
				description: `Select the title property for your notes. By default, it is called **Name**.`,
				options: titleProps.map((prop) => ({ label: prop, value: prop })),
				optional: false,
				reloadProps: true,
			},
			...(this.noteTitle && {
				noteTitleValue: {
					type: "string",
					label: "Note Title Value",
					description:
						'Choose the value for your note title. Defaults to an AI-generated title based off of the first summarized chunk from your transcription. You can also choose to use the audio file name, or both. If you pick both, the title will be in the format "File Name – AI Title".\n\n**Advanced:** You can also construct a custom title by choosing the *Enter a custom expression* tab and building an expression that evaluates to a string.',
					options: [
						"AI Generated Title",
						"Audio File Name",
						'Both ("File Name – AI Title")',
					],
					default: "AI Generated Title",
					optional: true,
				},
			}),
			noteDuration: {
				type: "string",
				label: "Note Duration",
				description:
					"Select the duration property for your notes. This must be a Number-type property. Duration will be expressed in **seconds**.",
				options: numberProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
			},
			noteCost: {
				type: "string",
				label: "Note Cost",
				description:
					"Select the cost property for your notes. This will store the total cost of the run, including both the Whisper (transcription) and ChatGPT (summarization) costs. This must be a Number-type property.",
				options: numberProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
			},
			noteTag: {
				type: "string",
				label: "Note Tag",
				description:
					'Choose a Select-type property for tagging your note (e.g. tagging it as "AI Transcription").',
				options: selectProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
				reloadProps: true,
			},
			noteIcon: {
				type: "string",
				label: "Note Page Icon",
				description:
					"Choose an emoji to use as the icon for your note page. Defaults to 🤖. If you don't see the emoji you want in the list, you can also simply type or paste it in the box below.",
				options: EMOJI,
				optional: true,
				default: "🤖",
			},
			...(this.noteTag && {
				noteTagValue: {
					type: "string",
					label: "Note Tag Value",
					description: "Choose the value for your note tag.",
					options: this.noteTag
						? properties[this.noteTag].select.options.map((option) => ({
								label: option.name,
								value: option.name,
						  }))
						: [],
					default: "AI Transcription",
					optional: true,
				},
			}),
			noteDate: {
				type: "string",
				label: "Note Date",
				description:
					"Select a date property for your note. This property will be set to the date the audio file was created.",
				options: dateProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
			},
			noteFileName: {
				type: "string",
				label: "Note File Name",
				description:
					"Select a text-type property for your note's file name. This property will store the name of the audio file.",
				options: textProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
			},
			noteFileLink: {
				type: "string",
				label: "Note File Link",
				description:
					"Select a URL-type property for your note's file link. This property will store a link to the audio file.",
				options: urlProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
			},
			chat_model: {
				type: "string",
				label: "ChatGPT Model",
				description: `Select the model you would like to use.\n\nDefaults to **gpt-4o-mini**, which is recommended for this workflow.`,
				default: "gpt-4o-mini",
				options: results.map((model) => ({
					label: model.id,
					value: model.id,
				})),
				optional: true,
				reloadProps: true,
			},
			transcript_language: translation.props.transcript_language,
			transcription_service: {
				type: "string",
				label: "Transcription Service",
				description:
					"Choose the service to use for transcription. By default, OpenAI's Whisper service is used, which uses your OpenAI API key. If you choose to transcribe with [Deepgram](https://deepgram.com/), you'll need to provide a Deepgram API key in the property that appears after you select Deepgram. \n\n**Note: Deepgram transcription is in beta and may not work as expected.**",
				options: ["OpenAI", "Deepgram"],
				default: "OpenAI",
				reloadProps: true,
			},
			...(this.transcription_service === "Deepgram" && {
				deepgram: {
					type: "app",
					app: "deepgram",
				},
				deepgram_model: {
					type: "string",
					label: "Deepgram Model",
					description:
						"Select the model you would like to use. Defaults to **nova-3-general**.",
					default: "nova-3-general",
					options: [
						"nova-3-general",
						"nova-2-general",
						"nova-2-medical",
						"nova-2-finance",
						"nova-2-meeting",
						"nova-2-phonecall",
						"nova-2-voicemail",
						"nova-2-video",
						"nova-2-automotive",
						"nova-general",
						"whisper-tiny",
						"whisper-base",
						"whisper-small",
						"whisper-medium",
						"whisper-large",
					],
				},
				deepgram_options: {
					type: "string[]",
					label: "Deepgram Options",
					description: `Select the options you would like to include in your transcript. You can select multiple options.\n\n**Note:** Deepgram's transcription service is in beta and may not work as expected.`,
					options: [
						"Diarize",
						"Smart Format",
						"Punctuate",
						"Dictation",
						"Filler Words",
						"Measurements",
						"Profanity Filter",
					],
					default: ["Punctuate", "Smart Format"],
				}
			}),
			ai_service: {
				type: "string",
				label: "AI Service",
				description:
					"Choose the service to use for AI. By default, OpenAI's ChatGPT service is used, which uses your OpenAI API key. If you choose to use [Anthropic](https://anthropic.com/), you'll need to provide an Anthropic API key in the property that appears after you select Anthropic.",
				options: ["OpenAI", "Anthropic"],
				default: "OpenAI",
				reloadProps: true,
			},
			...(this.ai_service === "Anthropic" && {
				anthropic: {
					type: "app",
					app: "anthropic",
					description:
						"Note that you MUST have set up a payment method, and your Anthropic account must be at least on the Build Plan in order to use this option. Price calculations will be incorrect when using Anthropic or Deepgram.",
				},
			}),
			...(this.anthropic && {
				anthropic_model: {
					type: "string",
					label: "Anthropic Model",
					description:
						"Select the Anthropic model you would like to use. Defaults to **claude-3-5-haiku-20241022**. Only Claude 3/3.5 models are offered.",
					default: "claude-3-5-haiku-20241022",
					options: [
						"claude-3-5-haiku-20241022",
						"claude-3-5-sonnet-20241022",
						"claude-3-7-sonnet-20250219",
						"claude-3-sonnet-20240229",
						"claude-3-opus-20240229",
						"claude-3-haiku-20240307"
					],
				},
			}),
			advanced_options: {
				type: "boolean",
				label: "Enable Advanced Options",
				description: `Set this to **True** to enable advanced options for this workflow.`,
				default: false,
				optional: true,
				reloadProps: true,
			},
			...(this.chat_model &&
				this.advanced_options === true && {
					summary_density: {
						type: "integer",
						label: "Summary Density (Advanced)",
						description: `*It is recommended to leave this setting at its default unless you have a good understanding of how LLMs handle tokens.*\n\nSets the maximum number of tokens (word fragments) for each chunk of your transcript, and therefore the max number of user-prompt tokens that will be sent to your chosen LLM in each summarization request.\n\nA smaller number will result in a more "dense" summary, as the same summarization prompt will be run for a smaller chunk of the transcript – hence, more requests will be made, as the transcript will be split into more chunks.\n\nThis will enable the script to handle longer files, as the script uses concurrent requests, and your LLM will take less time to process a chunk with fewer prompt tokens.\n\nThis does mean your summary and list will be longer, as you'll get them for each chunk. You can somewhat counteract this with the **Summary Verbosity** option.\n\n**Lowering the number here will also *slightly* increase the cost of the summarization step**, both because you're getting more summarization data and because the summarization prompt's system instructions will be sent more times.\n\nDefaults to 2,750 tokens. The maximum value depends on your chosen model, and the minimum value is 500 tokens.\n\nKeep in mind that setting a very high value will result in a very sparse summary. (E.g. with Claude models, you could set a density as high as 150,000 tokens. But this workflow will output a maxiumum of 5 items per transcript chunk for most lists. That'd be 5 items to summarize *Moby Dick*. I recommend setting a lower density so your transcript is split into smaller chunks, each of which will be summarized.\n\nIf you're using an OpenAI trial account and haven't added your billing info yet, note that you may get rate-limited due to the low requests-per-minute (RPM) rate on trial accounts.`,
						min: 500,
						max: MODEL_INFO[this.ai_service?.toLowerCase()]?.text[this.model?.toLowerCase()]?.window
							? MODEL_INFO[this.ai_service?.toLowerCase()]?.text[this.model?.toLowerCase()]?.window * .75
							: 2750,
						default: 2750,
						optional: true,
					},
				}),
			...(this.advanced_options === true && {
				whisper_prompt: openaiOptions.props.whisper_prompt,
				verbosity: openaiOptions.props.verbosity,
				summary_language: translation.props.summary_language,
				...(this.summary_language && {
					translate_transcript: translation.props.translate_transcript,
				}),
				temperature: openaiOptions.props.temperature,
				chunk_size: openaiOptions.props.chunk_size,
				disable_moderation_check: openaiOptions.props.disable_moderation_check,
				fail_on_no_duration: openaiOptions.props.fail_on_no_duration,
			}),
		};

		return props;
	},
	methods: {
		...common.methods,
		...chat.methods,
		...translation.methods,
		async checkSize(fileSize) {
			if (fileSize > 500000000) {
				throw new Error(
					`File is too large. Files must be under 500mb and one of the following file types: ${config.supportedMimes.join(
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
		setLanguages() {
			if (this.transcript_language) {
				console.log(`User set transcript language to ${this.transcript_language}.`);
				config.transcriptLanguage = this.transcript_language;
			}

			if (this.summary_language) {
				console.log(`User set summary language to ${this.summary_language}.`);
				config.summaryLanguage = this.summary_language;
			}

			if (!this.transcript_language && !this.summary_language) {
				console.log(
					`No language set. Whisper will attempt to detect the language.`
				);
			}
		},
		async downloadToTmp(fileLink, filePath, fileName) {
			try {
				// Define the mimetype
				const mime = filePath.match(/\.\w+$/)[0];

				// Check if the mime type is supported (mp3 or m4a)
				if (config.supportedMimes.includes(mime) === false) {
					throw new Error(
						`Unsupported file type. Supported file types include ${config.supportedMimes.join(
							", "
						)}.`
					);
				}

				// Define the tmp file path
				const tmpPath = `/tmp/${filePath
					.match(/[^\/]*\.\w+$/)[0]
					.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "")}`;

				// Download the audio recording from Dropbox to tmp file path
				const pipeline = promisify(stream.pipeline);
				await pipeline(got.stream(fileLink), fs.createWriteStream(tmpPath));

				// Create a results object
				const results = {
					file_name: fileName,
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
		async chunkFileAndTranscribe({ file }, openai) {
			const chunkDirName = "chunks-" + this.steps.trigger.context.id;
			const outputDir = join("/tmp", chunkDirName);
			config.chunkDir = outputDir;
			await execAsync(`mkdir -p "${outputDir}"`);
			await execAsync(`rm -f "${outputDir}/*"`);

			let files

			// Chunk the files
			try {
				console.log(`Chunking file: ${file}`);
				await this.chunkFile({
					file,
					outputDir,
				});

				files = await fs.promises.readdir(outputDir);
			} catch (error) {
				await this.cleanTmp();

				console.error(`An error occured while chunking the file: ${error}`);
				throw new Error(`An error occured while chunking the file: ${error}`);
			}

			// Transcribe the chunks
			try {
				console.log(`Chunks created successfully. Transcribing chunks: ${files}`);
				return await this.transcribeFiles(
					{
						files,
						outputDir,
					},
					openai
				);
			} catch (error) {
				await this.cleanTmp();

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
		async chunkFile({ file, outputDir }) {
			const ffmpegPath = ffmpegInstaller.path;
			const ext = extname(file);

			const fileSizeInMB = fs.statSync(file).size / (1024 * 1024);
			const chunkSize = this.chunk_size ?? 24;
			const numberOfChunks = Math.ceil(fileSizeInMB / chunkSize);

			console.log(
				`Full file size: ${fileSizeInMB}mb. Chunk size: ${chunkSize}mb. Expected number of chunks: ${numberOfChunks}. Commencing chunking...`
			);

			if (numberOfChunks === 1) {
				await execAsync(`cp "${file}" "${outputDir}/chunk-000${ext}"`);
				console.log(`Created 1 chunk: ${outputDir}/chunk-000${ext}`);
				return;
			}

			// Get duration using spawn instead of exec
			const getDuration = () => {
				return new Promise((resolve, reject) => {
					let durationOutput = '';
					const ffprobe = spawn(ffmpegPath, ['-i', file]);
					
					ffprobe.stderr.on('data', (data) => {
						durationOutput += data.toString();
					});
					
					ffprobe.on('close', (code) => {
						try {
							const durationMatch = durationOutput.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
							if (durationMatch && durationMatch[1]) {
								resolve(durationMatch[1]);
							} else {
								reject(new Error('Could not determine file duration'));
							}
						} catch (error) {
							reject(error);
						}
					});
					
					ffprobe.on('error', (err) => {
						reject(err);
					});
				});
			};

			try {
				const duration = await getDuration();
				const [hours, minutes, seconds] = duration.split(":").map(parseFloat);

				const totalSeconds = hours * 60 * 60 + minutes * 60 + seconds;
				const segmentTime = Math.ceil(totalSeconds / numberOfChunks);

				console.log(`File duration: ${duration}, segment time: ${segmentTime} seconds`);
				
				// Use spawn for the chunking operation
				const chunkFile = () => {
					return new Promise((resolve, reject) => {
						const args = [
							'-i', file,
							'-f', 'segment',
							'-segment_time', segmentTime.toString(),
							'-c', 'copy',
							'-loglevel', 'verbose',
							`${outputDir}/chunk-%03d${ext}`
						];
						
						console.log(`Splitting file into chunks with ffmpeg command: ${ffmpegPath} ${args.join(' ')}`);
						
						const ffmpeg = spawn(ffmpegPath, args);
						
						let stdoutData = '';
						let stderrData = '';
						
						ffmpeg.stdout.on('data', (data) => {
							const chunk = data.toString();
							stdoutData += chunk;
							console.log(`ffmpeg stdout: ${chunk}`);
						});
						
						ffmpeg.stderr.on('data', (data) => {
							const chunk = data.toString();
							stderrData += chunk;
							// Only log important messages to avoid excessive output
							if (chunk.includes('Opening') || chunk.includes('Output') || chunk.includes('Error')) {
								console.log(`ffmpeg stderr: ${chunk}`);
							}
						});
						
						ffmpeg.on('close', (code) => {
							if (code === 0) {
								resolve({ stdout: stdoutData, stderr: stderrData });
							} else {
								reject(new Error(`ffmpeg process exited with code ${code}: ${stderrData}`));
							}
						});
						
						ffmpeg.on('error', (err) => {
							reject(err);
						});
					});
				};
				
				await chunkFile();

				const chunkFiles = await fs.promises.readdir(outputDir);
				const chunkCount = chunkFiles.filter((file) =>
					file.includes("chunk-")
				).length;
				console.log(`Created ${chunkCount} chunks.`);
			} catch (error) {
				console.error(
					`An error occurred while splitting the file into chunks: ${error}`
				);
				throw error;
			}
		},
		transcribeFiles({ files, outputDir }, openai) {
			const limiter = new Bottleneck({
				maxConcurrent: 30,
				minTime: 1000 / 30,
			});

			return Promise.all(
				files.map((file) => {
					return limiter.schedule(() =>
						this.transcribe(
							{
								file,
								outputDir,
							},
							openai
						)
					);
				})
			);
		},
		transcribe({ file, outputDir }, openai) {
			return retry(
				async (bail, attempt) => {
					const readStream = fs.createReadStream(join(outputDir, file));
					console.log(`Transcribing file: ${file}`);

					try {
						const response = await openai.audio.transcriptions
							.create(
								{
									model: "whisper-1",
									...(config.transcriptLanguage &&
										config.transcriptLanguage !== "" && {
											language: config.transcriptLanguage,
										}),
									file: readStream,
									prompt:
										this.whisper_prompt && this.whisper_prompt !== ""
											? this.whisper_prompt
											: `Hello, welcome to my lecture.`,
								},
								{
									maxRetries: 5,
								}
							)
							.withResponse();

						const limits = {
							requestRate: response.response.headers.get("x-ratelimit-limit-requests"),
							tokenRate: response.response.headers.get("x-ratelimit-limit-tokens"),
							remainingRequests: response.response.headers.get(
								"x-ratelimit-remaining-requests"
							),
							remainingTokens: response.response.headers.get(
								"x-ratelimit-remaining-tokens"
							),
							rateResetTimeRemaining: response.response.headers.get(
								"x-ratelimit-reset-requests"
							),
							tokenRestTimeRemaining: response.response.headers.get(
								"x-ratelimit-reset-tokens"
							),
						};
						console.log(
							`Received response from OpenAI Whisper endpoint for ${file}. Your API key's current Audio endpoing limits (learn more at https://platform.openai.com/docs/guides/rate-limits/overview):`
						);
						console.table(limits);

						if (limits.remainingRequests <= 1) {
							console.log(
								"WARNING: Only 1 request remaining in the current time period. Rate-limiting may occur after the next request. If so, this script will attempt to retry with exponential backoff, but the workflow run may hit your Timeout Settings (https://pipedream.com/docs/workflows/settings/#execution-timeout-limit) before completing. If you have not upgraded your OpenAI account to a paid account by adding your billing information (and generated a new API key afterwards, replacing your trial key here in Pipedream with that new one), your trial API key is subject to low rate limits. Learn more here: https://platform.openai.com/docs/guides/rate-limits/overview"
							);
						}

						return response;
					} catch (error) {
						if (error instanceof OpenAI.APIError) {
							console.log(`Encountered error from OpenAI: ${error.message}`);
							console.log(`Status code: ${error.status}`);
							console.log(`Error name: ${error.name}`);
							console.log(`Error headers: ${JSON.stringify(error.headers)}`);
						} else {
							console.log(
								`Encountered generic error, not described by OpenAI SDK error handler: ${error}`
							);
						}

						if (
							error.message.toLowerCase().includes("econnreset") ||
							error.message.toLowerCase().includes("connection error") ||
							(error.status && error.status >= 500)
						) {
							console.log(`Encountered a recoverable error. Retrying...`);
							throw error;
						} else {
							console.log(
								`Encountered an error that won't be helped by retrying. Bailing...`
							);
							bail(error);
						}
					} finally {
						readStream.destroy();
					}
				},
				{
					retries: 3,
					onRetry: (err) => {
						console.log(`Retrying transcription for ${file} due to error: ${err}`);
					},
				}
			);
		},
		async transcribeDeepgram(file) {
			console.log(`Deepgram formatting options: ${this.deepgram_options.join(", ")}`)

			const deepgram = createClient(this.deepgram.$auth.api_key);

			try {
				const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
					fs.createReadStream(file),
					{
						model: this.deepgram_model ?? "nova-2-general",
						smart_format: this.deepgram_options.includes('Smart Format') ? true : false,
						punctuate: this.deepgram_options.includes('Punctuate') ? true : false,
						detect_language: true,
						diarize: this.deepgram_options.includes('Diarize') ? true : false,
						numerals: false,
						filler_words: this.deepgram_options.includes('Filler Words') ? true : false,
						measurements: this.deepgram_options.includes('Measurements') ? true : false,
						profanity_filter: this.deepgram_options.includes('Profanity Filter') ? true : false,
						dictation: this.deepgram_options.includes('Dictation') ? true : false,
						// keywords: [{ word: "Flylighter", boost: 1.5 }],
					}
				);
	
				if (error) {
					throw new Error(`Deepgram error: ${error.message}`);
				}
	
				const vttOutput = this.formatWebVTT(webvtt(result));

				// If diarization was enabled, count the speakers
				let speakers = 1;
				if (this.deepgram_options.includes('Diarize') && result.results.channels[0].alternatives[0].words && result.results.channels[0].alternatives[0].words.length > 0) {
					console.log(`Diarization enabled. Counting speakers. Transcript contains ${result.results.channels[0].alternatives[0].words.length} words.`)

					const speakerIds = new Set()

					for (const word of result.results.channels[0].alternatives[0].words) {
						if (word.speaker !== undefined && word.speaker !== null && word.speaker !== "") {
							speakerIds.add(word.speaker)
						}
					}

					speakers = speakerIds.size
					console.log(`Detected ${speakers} speakers.`)
				}
	
				const output = {
					metadata: result?.metadata ?? "No metadata available",
					raw_transcript:
						result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ??
						"Transcript not available",
					raw_transcript_confidence:
						result?.results?.channels?.[0]?.alternatives?.[0]?.confidence ??
						"Confidence score not available",
					paragraphs:
						result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs
							?.transcript ?? "No paragraphs available",
					detected_language:
						result?.results?.channels?.[0]?.detected_language ??
						"Language not detected",
					language_confidence:
						result?.results?.channels?.[0]?.language_confidence ??
						"Language confidence not available",
					vttOutput: vttOutput ?? "VTT output not available",
					speakers: speakers
				};
	
				return output;
			} catch (error) {
				throw new Error(
					`An error occurred while transcribing the file with Deepgram: ${error.message}`
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
					//console.log(timestampParts);
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
		},
		async combineWhisperChunks(chunksArray) {
			console.log(
				`Combining ${chunksArray.length} transcript chunks into a single transcript...`
			);

			try {
				let combinedText = "";

				for (let i = 0; i < chunksArray.length; i++) {
					let currentChunk = chunksArray[i].data.text;
					let nextChunk =
						i < chunksArray.length - 1 ? chunksArray[i + 1].data.text : null;

					if (
						nextChunk &&
						currentChunk.endsWith(".") &&
						nextChunk.charAt(0).toLowerCase() === nextChunk.charAt(0)
					) {
						currentChunk = currentChunk.slice(0, -1);
					}

					if (i < chunksArray.length - 1) {
						currentChunk += " ";
					}

					combinedText += currentChunk;
				}

				console.log("Transcript combined successfully.");
				return combinedText;
			} catch (error) {
				throw new Error(
					`An error occurred while combining the transcript chunks: ${error.message}`
				);
			}
		},
		findLongestPeriodGap(text, maxTokens) {
			let lastPeriodIndex = -1;
			let longestGap = 0;
			let longestGapText = "";

			for (let i = 0; i < text.length; i++) {
				if (text[i] === ".") {
					if (lastPeriodIndex === -1) {
						lastPeriodIndex = i;
						continue;
					}

					let gap = i - lastPeriodIndex - 1;
					let gapText = text.substring(lastPeriodIndex + 1, i);

					if (gap > longestGap) {
						longestGap = gap;
						longestGapText = gapText;
					}

					lastPeriodIndex = i;
				}
			}

			if (lastPeriodIndex === -1) {
				return { longestGap: -1, longestGapText: "No period found" };
			} else {
				const encodedLongestGapText = encode(longestGapText);
				return {
					longestGap,
					longestGapText,
					maxTokens,
					encodedGapLength: encodedLongestGapText.length,
				};
			}
		},
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
		async moderationCheck(transcript, openai) {
			console.log(`Initiating moderation check on the transcript.`);

			const chunks = this.makeParagraphs(transcript, 1800);

			console.log(
				`Transcript split into ${chunks.length} chunks. Moderation check is most accurate on chunks of 2,000 characters or less. Moderation check will be performed on each chunk.`
			);

			try {
				const limiter = new Bottleneck({
					maxConcurrent: 500,
				});

				const moderationPromises = chunks.map((chunk, index) => {
					return limiter.schedule(() => this.moderateChunk(index, chunk, openai));
				});

				await Promise.all(moderationPromises);

				console.log(
					`Moderation check completed successfully. No abusive content detected.`
				);
			} catch (error) {
				throw new Error(
					`An error occurred while performing a moderation check on the transcript: ${error.message}
					
					Note that you can set Enable Advanced Settings to True, and then set Disable Moderation Check to True, to skip the moderation check. This will speed up the workflow run, but it will also increase the risk of inappropriate content being sent to ChatGPT.`
				);
			}
		},
		async moderateChunk(index, chunk, openai) {
			try {
				const moderationResponse = await openai.moderations.create({
					input: chunk,
				});

				const flagged = moderationResponse.results[0].flagged;

				if (flagged === undefined || flagged === null) {
					throw new Error(
						`Moderation check failed. Request to OpenAI's Moderation endpoint could not be completed.
						
						Note that you can set Enable Advanced Settings to True, and then set Disable Moderation Check to True, to skip the moderation check. This will speed up the workflow run, but it will also increase the risk of inappropriate content being sent to ChatGPT.`
					);
				}

				if (flagged === true) {
					console.log(
						`Moderation check flagged innapropriate content in chunk ${index}.

						The content of this chunk is as follows:
					
						${chunk}
						
						Contents of moderation check:`
					);
					console.dir(moderationResponse, { depth: null });

					throw new Error(
						`Detected inappropriate content in the transcript chunk. Summarization on this file cannot be completed.
						
						The content of this chunk is as follows:
					
						${chunk}

						Note that you can set Enable Advanced Settings to True, and then set Disable Moderation Check to True, to skip the moderation check. This will speed up the workflow run, but it will also increase the risk of inappropriate content being sent to ChatGPT.
						`
					);
				}
			} catch (error) {
				throw new Error(
					`An error occurred while performing a moderation check on chunk ${index}.
					
					The content of this chunk is as follows:
					
					${chunk}
					
					Error message:
					
					${error.message}
					
					Note that you can set Enable Advanced Settings to True, and then set Disable Moderation Check to True, to skip the moderation check. This will speed up the workflow run, but it will also increase the risk of inappropriate content being sent to ChatGPT.`
				);
			}
		},
		async sendToChat(llm, stringsArray, maxConcurrent = 35) {
			try {
				const limiter = new Bottleneck({
					maxConcurrent: maxConcurrent,
				});

				console.log(`Sending ${stringsArray.length} chunks to ${this.ai_service}`);
				const results = limiter.schedule(() => {
					const tasks = stringsArray.map((arr, index) => {
						const systemMessage = this.createSystemMessage(
							index,
							this.summary_options,
							this.verbosity,
							this.summary_language
						)

						const userPrompt = this.createPrompt(arr, this.steps.trigger.context.ts)
						
						return this.chat(
							llm,
							this.ai_service,
							this.ai_service === "OpenAI" ? this.chat_model : this.anthropic_model,
							userPrompt,
							systemMessage,
							this.temperature,
							index,
							(attempt) => `Attempt ${attempt}: Sending chunk ${index} to ${this.ai_service}`,
							`Chunk ${index} received successfully.`,
							(attempt, error) => `Attempt ${attempt} failed with error: ${error.message}. Retrying...`
						);
					});
					return Promise.all(tasks);
				});
				return results;
			} catch (error) {
				console.error(error);

				throw new Error(
					`An error occurred while sending the transcript to ${this.ai_service}: ${error.message}`
				);
			}
		},
		async formatChat(summaryArray) {
			const resultsArray = [];
			console.log(`Formatting the ChatGPT results...`);
			for (let result of summaryArray) {
				const response = {
					choice: this.repairJSON(result.choices[0].message.content),
					usage: !result.usage.total_tokens ? 0 : result.usage.total_tokens,
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
					sentiment: this.summary_options.includes("Sentiment")
						? resultsArray[0]?.choice?.sentiment
						: undefined,
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

			console.log(`ChatResponse object after ChatGPT items have been inserted:`);
			console.dir(chatResponse, { depth: null });

			function arraySum(arr) {
				const init = 0;
				const sum = arr.reduce(
					(accumulator, currentValue) => accumulator + currentValue,
					init
				);
				return sum;
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
				...(this.summary_options.includes("Sentiment") && {
					sentiment: chatResponse.sentiment,
				}),
				main_points: chatResponse.main_points.flat(),
				action_items: chatResponse.action_items.flat(),
				stories: chatResponse.stories.flat(),
				references: chatResponse.references.flat(),
				arguments: chatResponse.arguments.flat(),
				follow_up: chatResponse.follow_up.flat(),
				...(this.summary_options.includes("Related Topics") &&
					filtered_related_set.length > 1 && {
						related_topics: filtered_related_set.sort(),
					}),
				tokens: arraySum(chatResponse.usageArray),
			};

			console.log(`Final ChatResponse object:`);
			console.dir(finalChatResponse, { depth: null });

			return finalChatResponse;
		},
		makeParagraphs(transcript, maxLength = 1200) {
			const languageCode = franc(transcript);
			console.log(`Detected language with franc library: ${languageCode}`);

			let transcriptSentences;
			let sentencesPerParagraph;

			if (languageCode === "cmn" || languageCode === "und") {
				console.log(
					`Detected language is Chinese or undetermined, splitting by punctuation...`
				);
				transcriptSentences = transcript
					.split(/[\u3002\uff1f\uff01\uff1b\uff1a\u201c\u201d\u2018\u2019]/)
					.filter(Boolean);
				sentencesPerParagraph = 3;
			} else {
				console.log(
					`Detected language is not Chinese, splitting by sentence tokenizer...`
				);
				const tokenizer = new natural.SentenceTokenizer();
				transcriptSentences = tokenizer.tokenize(transcript);
				sentencesPerParagraph = 4;
			}

			function sentenceGrouper(arr, sentencesPerParagraph) {
				const newArray = [];

				for (let i = 0; i < arr.length; i += sentencesPerParagraph) {
					newArray.push(arr.slice(i, i + sentencesPerParagraph).join(" "));
				}

				return newArray;
			}

			function charMaxChecker(arr, maxSize) {
				const hardLimit = 1800;

				return arr
					.map((element) => {
						let chunks = [];
						let currentIndex = 0;

						while (currentIndex < element.length) {
							let nextCutIndex = Math.min(currentIndex + maxSize, element.length);

							let nextSpaceIndex = element.indexOf(" ", nextCutIndex);

							if (nextSpaceIndex === -1 || nextSpaceIndex - currentIndex > hardLimit) {
								console.log(`No space found or hard limit reached in element, splitting at ${nextCutIndex}.
								
								Transcript chunk is as follows: ${element}`);
								nextSpaceIndex = nextCutIndex;
							}

							while (
								nextSpaceIndex > 0 &&
								isHighSurrogate(element.charCodeAt(nextSpaceIndex - 1))
							) {
								nextSpaceIndex--;
							}

							chunks.push(element.substring(currentIndex, nextSpaceIndex));

							currentIndex = nextSpaceIndex + 1;
						}

						return chunks;
					})
					.flat();
			}

			function isHighSurrogate(charCode) {
				return charCode >= 0xd800 && charCode <= 0xdbff;
			}

			console.log(`Converting the transcript to paragraphs...`);
			console.log(
				`Number of sentences before paragraph grouping: ${transcriptSentences.length}`
			);
			const paragraphs = sentenceGrouper(
				transcriptSentences,
				sentencesPerParagraph
			);
			console.log(`Number of paragraphs after grouping: ${paragraphs.length}`);
			console.log(`Limiting paragraphs to ${maxLength} characters...`);
			const lengthCheckedParagraphs = charMaxChecker(paragraphs, maxLength);

			return lengthCheckedParagraphs;
		},
		async calculateTranscriptCost(duration, service, medium, model) {
			let internalDuration;

			if (!duration || typeof duration !== "number") {
				if (this.fail_on_no_duration === true) {
					throw new Error(
						`Duration of the audio file could not be determined. Fail On No Duration flag is set to true; workflow is ending.`
					);
				}
				internalDuration = 0;
				console.log(
					`Duration of the audio file could not be determined. Setting duration to zero so run does not fail. Note that pricing information about the run will be inaccurate for this reason. Duration calculation issues are almost always caused by certain recording apps creating audio files that cannot be parsed by this workflow's duration-calculation function. If you want accurate durations and AI costs from this automation, consider trying a different voice recorder app.`
				);
			} else {
				internalDuration = duration;
			}

			const service_lower = service.toLowerCase();

			let plan = "completion"
			let modelSize = "default"
			if (service_lower === "deepgram") {
				plan = "pay-as-you-go"
			}

			let audioModel = model
			if (audioModel.includes("nova-3")) {
				audioModel = "nova-3"
			}
			if (audioModel.includes("nova-2")) {
				audioModel = "nova-2"
			}
			if (service_lower === "deepgram" && audioModel.includes("whisper")) {
				audioModel = "whisper"
				modelSize = audioModel.split("-")[1]
			}
			if (service_lower === "openai") {
				modelSize = "large"
			}

			if (!model || typeof model !== "string") {
				throw new Error(
					"Invalid model string (thrown from calculateTranscriptCost)."
				);
			}

			if (internalDuration > 0) {
				console.log(`Calculating the cost of the transcript...`);
			}

			console.log(`service_lower: ${service_lower}, medium: ${medium}, audioModel: ${audioModel}, modelSize: ${modelSize}, plan: ${plan}`)

			try {
				const cost = (internalDuration / 60) * MODEL_INFO[service_lower][medium][audioModel][modelSize][plan];
				console.log(`Transcript cost: $${cost.toFixed(3).toString()}`);

				return cost;
			} catch (e) {
				console.warn(`Model could not be determined. Cost will be set to $0.`)
				const cost = 0

				return cost;
			}
		},
		async calculateGPTCost(usage, service, medium, model, label) {
			if (
				!usage ||
				typeof usage !== "object" ||
				!usage.prompt_tokens ||
				!usage.completion_tokens
			) {
				throw new Error("Invalid usage object (thrown from calculateGPTCost).");
			}

			const service_lower = service.toLowerCase();

			if (!model || typeof model !== "string") {
				console.warn("Invalid model string (thrown from calculateGPTCost).");
				return 0
			}

			if (!MODEL_INFO[service_lower][medium][model]) {
				console.warn("Non-supported model. (thrown from calculateGPTCost).");
				return 0
			}

			console.log(`Calculating the cost of the ${label.toLowerCase()}...`);
			console.log(`Service: ${service_lower}, Medium: ${medium}, Model: ${model}`);
			const costs = {
				prompt: (usage.prompt_tokens / 1000) * MODEL_INFO[service_lower][medium][model].prompt,
				completion: (usage.completion_tokens / 1000) * MODEL_INFO[service_lower][medium][model].completion,
				get total() {
					return this.prompt + this.completion;
				},
			};
			console.log(`${label} cost: $${costs.total.toFixed(3).toString()}`);

			return costs.total;
		},
		async createNotionPage(
			steps,
			notion,
			duration,
			formatted_chat,
			paragraphs,
			cost,
			language
		) {
			const today = new Date();
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, "0");
			const day = String(today.getDate()).padStart(2, "0");
			const date = `${year}-${month}-${day}`;

			const meta = formatted_chat;

			// Construct the title based on the user's title setting
			const AI_generated_title = formatted_chat.title;
			let noteTitle = "";
			if (this.noteTitleValue == 'Both ("File Name – AI Title")') {
				noteTitle = `${config.fileName} – ${AI_generated_title}`;
			} else if (this.noteTitleValue == "Audio File Name") {
				noteTitle = config.fileName;
			} else if (
				this.noteTitleValue == "AI Generated Title" ||
				!this.noteTitleValue
			) {
				// Default to AI Generated Title
				noteTitle = AI_generated_title;
			} else {
				// Allow for custom title value
				noteTitle = this.noteTitleValue;
			}
			meta.title = noteTitle;

			meta.transcript = paragraphs.transcript;
			if (paragraphs.summary && paragraphs.summary.length > 0) {
				meta.long_summary = paragraphs.summary;
			}
			if (
				paragraphs.translated_transcript &&
				paragraphs.translated_transcript.length > 0
			) {
				meta.translated_transcript = paragraphs.translated_transcript;
			}

			const transcriptionCost = cost.transcript;
			meta["transcription-cost"] = `Transcription Cost: $${cost.transcript
				.toFixed(3)
				.toString()}`;
			const chatCost = cost.summary;
			meta["chat-cost"] = `Chat API Cost: $${cost.summary.toFixed(3).toString()}`;
			const totalCostArray = [cost.transcript, cost.summary];
			if (cost.language_check) {
				meta["language-check-cost"] = `Language Check Cost: $${cost.language_check
					.toFixed(3)
					.toString()}`;
				totalCostArray.push(cost.language_check);
			}
			if (cost.translated_transcript) {
				meta["translation-cost"] = `Translation Cost: $${cost.translated_transcript
					.toFixed(3)
					.toString()}`;
				totalCostArray.push(cost.translated_transcript);
			}
			const totalCost = totalCostArray.reduce((a, b) => a + b, 0);
			meta["total-cost"] = `Total Cost: $${totalCost.toFixed(3).toString()}`;

			Object.keys(meta).forEach((key) => {
				if (Array.isArray(meta[key])) {
					meta[key] = meta[key].filter(
						(item) => item !== undefined && item !== null && item !== ""
					);
				}
			});

			console.log("Meta info in the Notion constructor:");
			console.dir(meta);

			let labeledSentiment;

			if (meta.sentiment && meta.sentiment.length > 1) {
				labeledSentiment = `Sentiment: ${meta.sentiment}`;
			}

			const data = {
				parent: {
					type: "database_id",
					database_id: this.databaseID,
				},
				icon: {
					type: "emoji",
					emoji: this.noteIcon,
				},
				properties: {
					[this.noteTitle]: {
						title: [
							{
								text: {
									content: meta.title,
								},
							},
						],
					},
					...(this.noteTag && {
						[this.noteTag]: {
							select: {
								name: this.noteTagValue,
							},
						},
					}),
					...(this.noteDuration && {
						[this.noteDuration]: {
							number: duration,
						},
					}),
					...(this.noteCost && {
						[this.noteCost]: {
							number: totalCost,
						},
					}),
					...(this.noteDate && {
						[this.noteDate]: {
							date: {
								start: date,
							},
						},
					}),
					...(this.noteFileLink && {
						[this.noteFileLink]: {
							url: config.fileLink,
						},
					}),
					...(this.noteFileName && {
						[this.noteFileName]: {
							rich_text: [
								{
									text: {
										content: config.fileName,
										link: {
											url: config.fileLink,
										},
									},
								},
							],
						},
					}),
				},
				children: [
					...(this.meta_options && this.meta_options.includes("Top Callout") ? [{
						callout: {
							rich_text: [
								{
									text: {
										content: "This AI transcription/summary was created on ",
									},
								},
								{
									mention: {
										type: "date",
										date: {
											start: date,
										},
									},
								},
								{
									text: {
										content: ". ",
									},
								},
								{
									text: {
										content: "Listen to the original recording here.",
										link: {
											url: config.fileLink,
										},
									},
								},
							],
							icon: {
								emoji: this.noteIcon,
							},
							color: "blue_background",
						},
					}] : []),
					...(this.meta_options && this.meta_options.includes("Table of Contents") ? [{
						table_of_contents: {
							color: "default",
						},
					}] : []),
				],
			};

			const responseHolder = {};

			if (meta.long_summary) {
				const summaryHeader = "Summary";

				responseHolder.summary_header = summaryHeader;

				const summaryHolder = [];
				const summaryBlockMaxLength = 80;

				for (let i = 0; i < meta.long_summary.length; i += summaryBlockMaxLength) {
					const chunk = meta.long_summary.slice(i, i + summaryBlockMaxLength);
					summaryHolder.push(chunk);
				}

				responseHolder.summary = summaryHolder;
			}

			let transcriptHeaderValue;
			if (
				language &&
				language.transcript &&
				language.summary &&
				language.transcript.value !== language.summary.value
			) {
				transcriptHeaderValue = `Transcript (${language.transcript.label})`;
			} else {
				transcriptHeaderValue = "Transcript";
			}

			responseHolder.transcript_header = transcriptHeaderValue;

			const transcriptHolder = [];
			const transcriptBlockMaxLength = 80;

			for (let i = 0; i < meta.transcript.length; i += transcriptBlockMaxLength) {
				const chunk = meta.transcript.slice(i, i + transcriptBlockMaxLength);
				transcriptHolder.push(chunk);
			}

			responseHolder.transcript = transcriptHolder;

			if (
				paragraphs.translated_transcript &&
				paragraphs.translated_transcript.length > 0
			) {
				const translationHeader = `Translated Transcript (${language.summary.label})`;

				responseHolder.translation_header = translationHeader;

				const translationHolder = [];
				const translationBlockMaxLength = 80;

				for (
					let i = 0;
					i < paragraphs.translated_transcript.length;
					i += translationBlockMaxLength
				) {
					const chunk = paragraphs.translated_transcript.slice(
						i,
						i + translationBlockMaxLength
					);
					translationHolder.push(chunk);
				}

				responseHolder.translation = translationHolder;
			}

			const additionalInfoArray = [];

			const additionalInfoHeader = {
				heading_1: {
					rich_text: [
						{
							text: {
								content: "Additional Info",
							},
						},
					],
				},
			};

			additionalInfoArray.push(additionalInfoHeader);

			function additionalInfoHandler(arr, header, itemType) {
				const infoHeader = {
					heading_2: {
						rich_text: [
							{
								text: {
									content: header,
								},
							},
						],
					},
				};

				additionalInfoArray.push(infoHeader);

				if (header === "Arguments and Areas for Improvement") {
					const argWarning = {
						callout: {
							rich_text: [
								{
									text: {
										content:
											"These are potential arguments and rebuttals that other people may bring up in response to the transcript. Like every other part of this summary document, factual accuracy is not guaranteed.",
									},
								},
							],
							icon: {
								emoji: "⚠️",
							},
							color: "orange_background",
						},
					};

					additionalInfoArray.push(argWarning);
				}

				for (let item of arr) {
					const infoItem = {
						[itemType]: {
							rich_text: [
								{
									text: {
										content: item,
									},
								},
							],
						},
					};

					additionalInfoArray.push(infoItem);
				}
			}

			const sections = [
				{
					arr: meta.main_points,
					header: "Main Points",
					itemType: "bulleted_list_item",
				},
				{
					arr: meta.stories,
					header: "Stories and Examples",
					itemType: "bulleted_list_item",
				},
				{
					arr: meta.references,
					header: "References and Citations",
					itemType: "bulleted_list_item",
				},
				{
					arr: meta.action_items,
					header: "Potential Action Items",
					itemType: "to_do",
				},
				{
					arr: meta.follow_up,
					header: "Follow-Up Questions",
					itemType: "bulleted_list_item",
				},
				{
					arr: meta.arguments,
					header: "Arguments and Areas for Improvement",
					itemType: "bulleted_list_item",
				},
				{
					arr: meta.related_topics,
					header: "Related Topics",
					itemType: "bulleted_list_item",
				},
			];

			for (let section of sections) {
				if (section.arr && section.arr.length > 0) {
					additionalInfoHandler(section.arr, section.header, section.itemType);
				}
			}

			if (this.meta_options && this.meta_options.includes("Meta")) {
			
				const metaArray = [meta["transcription-cost"], meta["chat-cost"]];

				if (meta["language-check-cost"]) {
					metaArray.push(meta["language-check-cost"]);
				}

				if (meta["translation-cost"]) {
					metaArray.push(meta["translation-cost"]);
				}

				metaArray.push(meta["total-cost"]);

				if (labeledSentiment && labeledSentiment.length > 1) {
					metaArray.unshift(labeledSentiment);
				}

				additionalInfoHandler(metaArray, "Meta", "bulleted_list_item");
			}

			responseHolder.additional_info = additionalInfoArray;

			let response;
			try {
				await retry(
					async (bail) => {
						try {
							console.log(`Creating Notion page...`);
							response = await notion.pages.create(data);
						} catch (error) {
							if (400 <= error.status && error.status <= 409) {
								console.log("Error creating Notion task:", error);
								bail(error);
							} else {
								console.log("Error creating Notion task:", error);
								throw error;
							}
						}
					},
					{
						retries: 3,
						onRetry: (error) => console.log("Retrying Notion task creation:", error),
					}
				);
			} catch (error) {
				throw new Error("Failed to create Notion page.");
			}

			responseHolder.response = response;

			return responseHolder;
		},
		async updateNotionPage(notion, page) {
			console.log(`Updating the Notion page with all leftover information:`);
			console.dir(page);

			const limiter = new Bottleneck({
				maxConcurrent: 1,
				minTime: 300,
			});

			const pageID = page.response.id.replace(/-/g, "");

			const allAPIResponses = {};

			if (page.summary) {
				const summaryArray = page.summary;
				const summaryAdditionResponses = await Promise.all(
					summaryArray.map((summary, index) =>
						limiter.schedule(() =>
							this.sendTranscripttoNotion(
								notion,
								summary,
								pageID,
								index,
								page.summary_header,
								"summary"
							)
						)
					)
				);
				allAPIResponses.summary_responses = summaryAdditionResponses;
			}

			if (page.translation) {
				const translationArray = page.translation;
				const translationAdditionResponses = await Promise.all(
					translationArray.map((translation, index) =>
						limiter.schedule(() =>
							this.sendTranscripttoNotion(
								notion,
								translation,
								pageID,
								index,
								page.translation_header,
								"translation"
							)
						)
					)
				);
				allAPIResponses.translation_responses = translationAdditionResponses;
			}

			if (
				!this.translate_transcript ||
				this.translate_transcript.includes("Keep Original") ||
				this.translate_transcript.includes("Don't Translate") ||
				!page.translation
			) {
				const transcriptArray = page.transcript;
				const transcriptAdditionResponses = await Promise.all(
					transcriptArray.map((transcript, index) =>
						limiter.schedule(() =>
							this.sendTranscripttoNotion(
								notion,
								transcript,
								pageID,
								index,
								page.transcript_header,
								"transcript"
							)
						)
					)
				);
				allAPIResponses.transcript_responses = transcriptAdditionResponses;
			}

			if (page.additional_info && page.additional_info.length > 0) {
				const additionalInfo = page.additional_info;
				const infoHolder = [];
				const infoBlockMaxLength = 95;

				for (let i = 0; i < additionalInfo.length; i += infoBlockMaxLength) {
					const chunk = additionalInfo.slice(i, i + infoBlockMaxLength);
					infoHolder.push(chunk);
				}

				const additionalInfoAdditionResponses = await Promise.all(
					infoHolder.map((info) =>
						limiter.schedule(() =>
							this.sendAdditionalInfotoNotion(notion, info, pageID)
						)
					)
				);

				allAPIResponses.additional_info_responses = additionalInfoAdditionResponses;
			}

			return allAPIResponses;
		},
		async sendTranscripttoNotion(
			notion,
			transcript,
			pageID,
			index,
			title,
			logValue
		) {
			return retry(
				async (bail, attempt) => {
					const data = {
						block_id: pageID,
						children: [],
					};

					if (index === 0) {
						const transcriptHeader = {
							heading_1: {
								rich_text: [
									{
										text: {
											content: title,
										},
									},
								],
							},
						};

						data.children.push(transcriptHeader);
					}

					for (let sentence of transcript) {
						const paragraphBlock = {
							paragraph: {
								rich_text: [
									{
										text: {
											content: sentence,
										},
									},
								],
							},
						};

						data.children.push(paragraphBlock);
					}

					console.log(
						`Attempt ${attempt}: Sending ${logValue} chunk ${index} to Notion...`
					);
					const response = await notion.blocks.children.append(data);
					return response;
				},
				{
					retries: 3,
					onRetry: (error, attempt) =>
						console.log(
							`Retrying Notion ${logValue} addition (attempt ${attempt}):`,
							error
						),
				}
			);
		},
		async sendAdditionalInfotoNotion(notion, additionalInfo, pageID) {
			return retry(
				async (bail, attempt) => {
					const data = {
						block_id: pageID,
						children: [],
					};

					for (let block of additionalInfo) {
						data.children.push(block);
					}

					console.log(`Attempt ${attempt}: Sending additional info to Notion...`);
					const response = await notion.blocks.children.append(data);
					return response;
				},
				{
					retries: 3,
					onRetry: (error, attempt) =>
						console.log(
							`Retrying Notion additional info addition (attempt ${attempt}):`,
							error
						),
				}
			);
		},
		async cleanTmp(cleanChunks = true) {
			console.log(`Attempting to clean up the /tmp/ directory...`);

			if (config.filePath && fs.existsSync(config.filePath)) {
				await fs.promises.unlink(config.filePath);
			} else {
				console.log(`File ${config.filePath} does not exist.`);
			}

			if (
				cleanChunks &&
				config.chunkDir.length > 0 &&
				fs.existsSync(config.chunkDir)
			) {
				console.log(`Cleaning up ${config.chunkDir}...`);
				await execAsync(`rm -rf "${config.chunkDir}"`);
			} else {
				console.log(`Directory ${config.chunkDir} does not exist.`);
			}
		},
	},
	async run({ steps, $ }) {
		// Object for storing performance logs
		let stageDurations = {
			setup: 0,
			download: 0,
			transcription: 0,
			transcriptCleanup: 0,
			moderation: 0,
			summary: 0,
			translation: 0,
			notionCreation: 0,
			notionUpdate: 0,
		};

		function totalDuration(obj) {
			return Object.keys(obj)
				.filter((key) => typeof obj[key] === "number" && key !== "total")
				.reduce((a, b) => a + obj[b], 0);
		}

		let previousTime = process.hrtime.bigint();

		/* -- Setup Stage -- */

		const fileID = this.steps.trigger.event.id;
		const testEventId = "52776A9ACB4F8C54!134";

		if (fileID === testEventId) {
			throw new Error(
				`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file (mp3 or m4a) to Dropbox, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`
			);
		}

		console.log("Checking that file is under 500mb...");
		await this.checkSize(this.steps.trigger.event.size);
		console.log("File is under the size limit. Continuing...");

		console.log("Checking if the user set languages...");
		this.setLanguages();

		console.log("Setting the transcription service...");
		config.transcription_service = this.transcription_service ?? "OpenAI";

		const logSettings = {
			"AI Service": this.ai_service,
			"Chat Model":
				this.ai_service === "Anthropic" ? this.anthropic_model : this.chat_model,
			"Transcription Service": config.transcription_service,
			"Summary Options": this.summary_options,
			"Summary Density": this.summary_density ?? "2750 (default)",
			Verbosity: this.verbosity ?? "Medium (default)",
			"Temperature:": this.temperature ?? "0.2 (default)",
			"Audio File Chunk Size": this.chunk_size ?? "24 (default)",
			"Moderation Check": this.disable_moderation_check ?? "Disabled (default)",
			"Note Title Property": this.noteTitle,
			"Note Tag Property": this.noteTag,
			"Note Tag Value": this.noteTagValue,
			"Note Duration Property": this.noteDuration,
			"Note Cost Property": this.noteCost,
			"Transcript Language": this.transcript_language ?? "No language set.",
			"Summary Language": this.summary_language ?? "No language set.",
			"Fail on no Duration": this.fail_on_no_duration ?? "Disabled (default)",
		};

		console.log("Logging settings...");
		console.dir(logSettings);

		const notion = new Client({ auth: this.notion.$auth.oauth_access_token });

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

		config.filePath = fileInfo.path;
		config.fileName = fileInfo.file_name;
		config.fileLink = fileInfo.link;

		fileInfo.duration = await this.getDuration(fileInfo.path);

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

		const openai = new OpenAI({
			apiKey: this.openai.$auth.api_key,
		});

		if (config.transcription_service === "OpenAI") {
			console.log(`Using OpenAI's Whisper service for transcription.`);
			fileInfo.whisper = await this.chunkFileAndTranscribe(
				{ file: fileInfo.path },
				openai
			);

			console.log("Whisper chunks array:");
			console.dir(fileInfo.whisper, { depth: null });
		} else if (config.transcription_service === "Deepgram") {
			console.log(`Using Deepgram for transcription.`);
			fileInfo.deepgram = await this.transcribeDeepgram(fileInfo.path);
			console.log("Deepgram transcript:");
			console.dir(fileInfo.deepgram, { depth: null });
		}

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

		/* -- Transcript Cleanup Stage -- */

		console.log(`Using the ${this.ai_service === "Anthropic" ? this.anthropic_model : this.chat_model} model.`);

		const maxTokens = this.summary_density
			? this.summary_density
			: this.ai_service === "Anthropic"
			? 5000
			: this.chat_model.includes("gpt-4")
			? 5000
			: this.chat_model.includes("gpt-3.5-turbo")
			? 5000
			: 2750;

		console.log(`Max tokens per summary chunk: ${maxTokens}`);

		// Set the full transcript based on which transcription service was used
		fileInfo.full_transcript =
			config.transcription_service === "OpenAI"
				? await this.combineWhisperChunks(fileInfo.whisper)
				: config.transcription_service === "Deepgram"
				? fileInfo.deepgram.raw_transcript
				: "No transcript available.";

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

		// Capture the transcript cleanup stage's time taken in milliseconds
		stageDurations.transcriptCleanup =
			Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(
			`Transcript cleanup stage duration: ${stageDurations.transcriptCleanup}ms`
		);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations)}ms (${
				totalDuration(stageDurations) / 1000
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

		/* -- Moderation Stage (Optional) -- */

		if (this.disable_moderation_check === false && this.openai) {
			console.log(
				`Modederation check has been enabled. Running the moderation check...`
			);
			await this.moderationCheck(fileInfo.full_transcript, openai);

			// Capture the moderation stage's time taken in milliseconds and seconds
			stageDurations.moderation =
				Number(process.hrtime.bigint() - previousTime) / 1e6;
			console.log(
				`Moderation stage duration: ${stageDurations.moderation}ms (${
					stageDurations.moderation / 1000
				} seconds)`
			);
			console.log(
				`Total duration so far: ${totalDuration(stageDurations)}ms (${
					totalDuration(stageDurations) / 1000
				} seconds)`
			);
			previousTime = process.hrtime.bigint();
		} else {
			console.log(
				`Moderation check has been disabled. Moderation will not be performed.`
			);
		}

		/* -- Summary Stage -- */

		const encodedTranscript = encode(fileInfo.full_transcript);
		console.log(
			`Full transcript is ${encodedTranscript.length} tokens. If you run into rate-limit errors and are currently using free trial credit from OpenAI, please note the Tokens Per Minute (TPM) limits: https://platform.openai.com/docs/guides/rate-limits/what-are-the-rate-limits-for-our-api`
		);

		fileInfo.transcript_chunks = this.splitTranscript(
			encodedTranscript,
			maxTokens,
			fileInfo.longest_gap
		);

		// Create an LLM authentication object based on the user's AI service choice
		const llm =
			this.ai_service === "Anthropic"
				? new Anthropic({ apiKey: this.anthropic.$auth.api_key })
				: openai;

		if (this.summary_options === null || this.summary_options.length === 0) {
			const titleArr = [fileInfo.transcript_chunks[0]];
			fileInfo.summary = await this.sendToChat(llm, titleArr);
		} else {
			fileInfo.summary = await this.sendToChat(llm, fileInfo.transcript_chunks);
		}

		console.log("Summary array from ChatGPT:");
		console.dir(fileInfo.summary, { depth: null });
		fileInfo.formatted_chat = await this.formatChat(fileInfo.summary);

		// If user chose Deepgram and diarization, and if there are 2+ speakers, we'll use the diarized paragraph object from Deepgram instead of making paragraphs.

		let transcript
		if (this.transcription_service === "Deepgram" && this.deepgram_options.includes('Diarize') && fileInfo.deepgram.paragraphs && fileInfo.deepgram.speakers > 1) {
			console.log(`Detected ${fileInfo.deepgram.speakers} speakers in the audio. Using Deepgram's diarized paragraphs for the transcript.`)
			transcript = fileInfo.deepgram.paragraphs.split("\n\n").filter(line => line.trim() !== "")
		} else {
			transcript = this.makeParagraphs(fileInfo.full_transcript, 1200)
		}
		
		fileInfo.paragraphs = {
			transcript: transcript,
			...(this.summary_options.includes("Summary") && {
				summary: this.makeParagraphs(fileInfo.formatted_chat.summary, 1200),
			}),
		};

		fileInfo.cost = {};

		fileInfo.cost.transcript = await this.calculateTranscriptCost(
			fileInfo.duration,
			this.transcription_service,
			"audio",
			this.transcription_service === "Deepgram" ? this.deepgram_model : "whisper"
		);

		const summaryUsage = {
			prompt_tokens: fileInfo.summary.reduce((total, item) => {
				return total + item.usage.prompt_tokens;
			}, 0),
			completion_tokens: fileInfo.summary.reduce((total, item) => {
				return total + item.usage.completion_tokens;
			}, 0),
		};

		console.log(
			`Total tokens used in the summary process: ${summaryUsage.prompt_tokens} prompt tokens and ${summaryUsage.completion_tokens} completion tokens.`
		);

		fileInfo.cost.summary = await this.calculateGPTCost(
			summaryUsage,
			this.ai_service,
			"text",
			fileInfo.summary[0].model,
			"Summary"
		);

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

		/* -- Translation Stage (Optional) -- */

		if (this.summary_language && this.summary_language !== "") {
			console.log(
				`User specified ${this.summary_language} for the summary. Checking if the transcript language matches...`
			);

			const detectedLanguage = await this.detectLanguage(
				llm,
				this.ai_service,
				this.ai_service === "Anthropic" ? this.anthropic_model : this.chat_model,
				fileInfo.paragraphs.transcript[0]
			);

			fileInfo.language = {
				transcript: await this.formatDetectedLanguage(
					detectedLanguage.choices[0].message.content
				),
				summary: this.summary_language
					? lang.LANGUAGES.find((l) => l.value === this.summary_language)
					: "No language set.",
			};

			console.log("Language info:");
			console.dir(fileInfo.language, { depth: null });

			const languageCheckUsage = {
				prompt_tokens: detectedLanguage.usage.prompt_tokens,
				completion_tokens: detectedLanguage.usage.completion_tokens,
			};

			fileInfo.cost.language_check = await this.calculateGPTCost(
				languageCheckUsage,
				this.ai_service,
				"text",
				detectedLanguage.model,
				"Language Check"
			);

			if (
				this.translate_transcript &&
				this.translate_transcript.includes("Translate") &&
				fileInfo.language.transcript.value !== fileInfo.language.summary.value
			) {
				console.log(
					"Transcript language does not match the summary language. Translating transcript..."
				);

				const translatedTranscript = await this.translateParagraphs(
					llm,
					this.ai_service,
					this.ai_service === "Anthropic" ? this.anthropic_model : this.chat_model,
					fileInfo.paragraphs.transcript,
					fileInfo.language.summary,
					this.temperature
				);

				fileInfo.paragraphs.translated_transcript = this.makeParagraphs(
					translatedTranscript.paragraphs.join(" "),
					1200
				);
				fileInfo.cost.translated_transcript = await this.calculateGPTCost(
					translatedTranscript.usage,
					this.ai_service,
					"text",
					translatedTranscript.model,
					"Transcript Translation"
				);

				console.log(
					`Total tokens used in the translation process: ${translatedTranscript.usage.prompt_tokens} prompt tokens and ${translatedTranscript.usage.completion_tokens} completion tokens.`
				);

				// Capture the translation stage's time taken in milliseconds
				stageDurations.translation =
					Number(process.hrtime.bigint() - previousTime) / 1e6;
				console.log(
					`Translation stage duration: ${stageDurations.translation}ms (${
						stageDurations.translation / 1000
					} seconds)`
				);
				console.log(
					`Total duration so far: ${totalDuration(stageDurations)}ms (${
						totalDuration(stageDurations) / 1000
					} seconds)`
				);
				previousTime = process.hrtime.bigint();
			}
		}

		/* -- Notion Creation Stage -- */

		fileInfo.notion_response = await this.createNotionPage(
			this.steps,
			notion,
			fileInfo.duration,
			fileInfo.formatted_chat,
			fileInfo.paragraphs,
			fileInfo.cost,
			...(fileInfo.language ? [fileInfo.language] : [])
		);

		// Capture the Notion creation stage's time taken in milliseconds
		stageDurations.notionCreation =
			Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(
			`Notion creation stage duration: ${stageDurations.notionCreation}ms (${
				stageDurations.notionCreation / 1000
			} seconds)`
		);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations)}ms (${
				totalDuration(stageDurations) / 1000
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

		/* -- Notion Update Stage -- */

		fileInfo.updated_notion_response = await this.updateNotionPage(
			notion,
			fileInfo.notion_response
		);

		console.log(`All info successfully sent to Notion.`);

		// Capture the Notion update stage's time taken in milliseconds
		stageDurations.notionUpdate =
			Number(process.hrtime.bigint() - previousTime) / 1e6;
		console.log(
			`Notion update stage duration: ${stageDurations.notionUpdate}ms (${
				stageDurations.notionUpdate / 1000
			} seconds)`
		);
		console.log(
			`Total duration so far: ${totalDuration(stageDurations)}ms (${
				totalDuration(stageDurations) / 1000
			} seconds)`
		);
		previousTime = process.hrtime.bigint();

		// Add total duration to stageDurations
		stageDurations.total = totalDuration(stageDurations);

		// Add performance data to fileInfo
		fileInfo.performance = stageDurations;

		// Create a formatted performance log that expresses the performance values as strings with ms and second labels
		fileInfo.performance_formatted = Object.fromEntries(
			Object.entries(fileInfo.performance).map(([stageName, stageDuration]) => [
				stageName,
				stageDuration > 1000
					? `${(stageDuration / 1000).toFixed(2)} seconds`
					: `${stageDuration.toFixed(2)}ms`,
			])
		);

		return fileInfo;
	},
};
