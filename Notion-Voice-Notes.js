import { Client } from "@notionhq/client";
import Bottleneck from "bottleneck";
import OpenAI from "openai";
import { encode, decode } from "gpt-3-encoder";
import stream from "stream";
import { promisify } from "util";
import fs from "fs";
import got from "got";
import { parseFile } from "music-metadata";
import { inspect } from "util";
import { join, extname } from "path";
import { exec } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import natural from "natural";
import retry from "async-retry";
import { jsonrepair } from "jsonrepair";

const execAsync = promisify(exec);

const systemPrompt = `You are an assistant that only speaks JSON. Do not write normal text. Example formatting: {"title": "Notion Buttons","summary": "A collection of buttons for Notion","action_items": ["item 1","item 2","item 3"],"follow_up": ["item 1","item 2","item 3"],"arguments": ["item 1","item 2","item 3"],"related_topics": ["item 1","item 2","item 3"],"sentiment": "positive"}`;

function createPrompt(arr) {
	return `Analyze the transcript provided below, then provide the following:
Key "title:" - add a title.
Key "summary" - create a summary.
Key "main_points" - add an array of the main points. Limit each item to 100 words, and limit the list to 10 items.
Key "action_items:" - add an array of action items. Limit each item to 100 words, and limit the list to 5 items.
Key "follow_up:" - add an array of follow-up questions. Limit each item to 100 words, and limit the list to 5 items.
Key "stories:" - add an array of an stories, examples, or cited works found in the transcript. Limit each item to 200 words, and limit the list to 5 items.
Key "arguments:" - add an array of potential arguments against the transcript. Limit each item to 100 words, and limit the list to 5 items.
Key "related_topics:" - add an array of topics related to the transcript. Limit each item to 100 words, and limit the list to 5 items.
Key "sentiment" - add a sentiment analysis

Ensure that the final element of any array within the JSON object is not followed by a comma.

Transcript:

${arr}`;
}

const rates = {
	"gpt-3.5-turbo": {
		prompt: 0.0015,
		completion: 0.002,
	},
	"gpt-3.5-turbo-16k": {
		prompt: 0.003,
		completion: 0.004,
	},
	"gpt-4": {
		prompt: 0.03,
		completion: 0.06,
	},
	"gpt-4-32k": {
		prompt: 0.06,
		completion: 0.12,
	},
	whisper: {
		completion: 0.006, // $0.006 per minute
	},
};

export default defineComponent({
	props: {
		notion: {
			type: "app",
			app: "notion",
			description: `⬆ Don\'t forget to connect your Notion account! Additionally, be sure to give Pipedream access to your Notes database, or to a page that contains it.\n\n## Overview\n\nThis workflow lets you create perfectly-transcribed and summarized notes from voice recordings.\n\nIt also creates useful lists from the transcript, including:\n\n* Main points\n* Action items\n* Follow-up questions\n* Potential rebuttals\n\n**Need help with this workflow? [Check out the full instructions and FAQ here.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)**\n\n## Compatibility\n\nThis workflow will work with any Notion database. It is currently configured to support **Dropbox** for audio file uploads. More cloud storage providers are coming in future releases.\n\n### Upgrade Your Notion Experience\n\nWhile this workflow will work with any Notion database, it\'s even better with a template.\n\nFor general productivity use, you\'ll love [Ultimate Brain](https://thomasjfrank.com/brain/) – my all-in-one second brain template for Notion. \n\nUltimate Brain brings tasks, notes, projects, and goals all into one tool. Naturally, it works very well with this workflow.\n\n**Are you a creator?** \n\nMy [Creator\'s Companion](https://thomasjfrank.com/creators-companion/) template includes a ton of features that will help you make better-performing content and optimize your production process. There\'s even a version that includes Ultimate Brain, so you can easily use this workflow to create notes whenever you have an idea for a new video or piece of content.\n\n*P.S. – This free workflow took hundreds of hours to build. If you\'d like to support my work, buying one of my templates is the best way to do so!*\n\n## Instructions\n\n[Click here for the full instructions on setting up this workflow.](https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/)\n\n## More Resources\n\n**More automations you may find useful:**\n\n* [Create Tasks in Notion with Your Voice](https://thomasjfrank.com/notion-chatgpt-voice-tasks/)\n* [Notion to Google Calendar Sync](https://thomasjfrank.com/notion-google-calendar-sync/)\n\n**All My Notion Automations:**\n\n* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)\n\n**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**\n\n* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)\n\n`,
		},
		openai: {
			type: "app",
			app: "openai",
			description: `**Important:** If you're currently using OpenAI's free trial credit, your API key will be subject to much lower [rate limits](https://platform.openai.com/account/rate-limits), and may not be able to handle longer files (aprox. 1 hour+, but the actual limit is hard to determine). If you're looking to work with long files, I recommend [setting up your billing info at OpenAI now](https://platform.openai.com/account/billing/overview).\n\nAdditionally, you'll need generate a new API key and enter it here once you enter your billing information at OpenAI; once you do that, trial keys stop working.\n\n`,
		},
		databaseID: {
			type: "string",
			label: "Notes Database",
			description: "Select your notes database.",
			async options({ query, prevContext }) {
				if (this.notion) {
					try {
						const notion = new Client({
							auth: this.notion.$auth.oauth_access_token,
						});

						let start_cursor = prevContext?.cursor;

						const response = await notion.search({
							...(query ? { query } : {}),
							...(start_cursor ? { start_cursor } : {}),
							page_size: 50,
							filter: {
								value: "database",
								property: "object",
							},
							sorts: [
								{
									direction: "descending",
									property: "last_edited_time",
								},
							],
						});

						let allTasksDbs = response.results.filter((db) =>
							db.title?.[0]?.plain_text.includes("All Notes")
						);
						let nonTaskDbs = response.results.filter(
							(db) => !db.title?.[0]?.plain_text.includes("All Notes")
						);
						let sortedDbs = [...allTasksDbs, ...nonTaskDbs];
						const UTregex = /All Notes/;
						const UTLabel = " – (used for Ultimate Notes)";
						const UBregex = /All Notes \[\w*\]/;
						const UBLabel = " – (used for Ultimate Brain)";
						const options = sortedDbs.map((db) => ({
							label: UBregex.test(db.title?.[0]?.plain_text)
								? db.title?.[0]?.plain_text + UBLabel
								: UTregex.test(db.title?.[0]?.plain_text)
								? db.title?.[0]?.plain_text + UTLabel
								: db.title?.[0]?.plain_text,
							value: db.id,
						}));

						return {
							context: {
								cursor: response.next_cursor,
							},
							options,
						};
					} catch (error) {
						console.error(error);
						return {
							context: {
								cursor: null,
							},
							options: [],
						};
					}
				} else {
					return {
						options: ["Please connect your Notion account first."],
					};
				}
			},
			reloadProps: true,
		},
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

				results = response.data.filter(
					(model) =>
						model.id.includes("gpt") &&
						!model.id.endsWith("0301") &&
						!model.id.endsWith("0314")
				);
			} catch (err) {
				console.error(
					`Encountered an error with OpenAI: ${err} – Please check that your API key is still valid.`
				);
			}
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

		const props = {
			noteTitle: {
				type: "string",
				label: "Note Title (Required)",
				description: "Select the title property for your notes.",
				options: titleProps.map((prop) => ({ label: prop, value: prop })),
				optional: false,
			},
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
					'Choose a Select-type property for tagging your note (e.g. tagging it as "AI Trasncription".',
				options: selectProps.map((prop) => ({ label: prop, value: prop })),
				optional: true,
				reloadProps: true,
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
			chat_model: {
				type: "string",
				label: "ChatGPT Model",
				description: `Select the model you would like to use.\n\nDefaults to **gpt-3.5-turbo**, which is recommended for this workflow.\n\nSwitching to the gpt-3.5-turbo-16k model will allow you to set the **summary density** option below up to 5,000 tokens, rather than gpt-3.5-turbo's max of 2,750.\n\nYou can also use **gpt-4**, which may provide more insightful summaries and lists, but it will increase the cost of the summarization step by a factor of 20 (it won't increase the cost of transcription, which is typically about 90% of the cost).`,
				default: "gpt-3.5-turbo",
				options: results.map((model) => ({
					label: model.id,
					value: model.id,
				})),
				optional: true,
				reloadProps: true,
			},
			summary_density: {
				type: "integer",
				label: "Summary Density (Advanced)",
				description: `*It is recommended to leave this setting at its default unless you have a good understanding of how ChatGPT handles tokens.*\n\nSets the maximum of tokens (word fragments) for each chunk of your transcript, and therefore the max number of user-prompt tokens that will be sent to ChatGPT in each summarization request.\n\nA smaller number will result in a more "dense" summary, as the same summarization prompt will be run for a smaller chunk of the transcript – hence, more requests will be made, as the transcript will be split into more chunks.\n\nThis *may* enable the script to handle longer files as the script uses concurrent requests, and a ChatGPT may take less time to process a chunk with fewer prompt tokens.\n\n**This will also *slightly* increase the cost of the summarization step**, both because you're getting more summarization data and because the summarization prompt's system instructions will be sent more times.\n\nDefaults to 2,750 tokens. The maximum value is 5,000 tokens (2,750 for gpt-3.5-turbo, which has a 4,096-token limit that includes the completion and system instruction tokens), and the minimum value is 1,000 tokens.\n\n*If you need to go beyond these limits, feel free to modify the code and run tests; these limits were chosen to avoid Pipedream timeout and database errors that can occur if chunks are significantly smaller or larger, respectively. Note that OpenAI may count tokens differently than this code does; I've found that it appears to given lower token counts, even though this code uses OpenAI's own open-source tokenizer for counting.*`,
				min: 1000,
				max:
					this.chat_model.includes("gpt-4") ||
					this.chat_model.includes("gpt-3.5-turbo-16k")
						? 5000
						: 2750,
				default: 2750,
				optional: true,
			},
			temperature: {
				type: "integer",
				label: "Model Temperature",
				description: `Set the temperature for the model. Valid values are integers between 0 and 20 (inclusive), which are divided by 10 to achieve a final value between 0 and 2.0. Higher temeperatures may result in more "creative" output, but have the potential to cause the output the fail to be valid JSON. This workflow defaults to 0.2.`,
				optional: true,
				min: 0,
				max: 20
			}
		};

		return props;
	},
	methods: {
		async checkSize(fileSize) {
			if (fileSize > 300000000) {
				throw new Error(
					"File is too large. Files must be mp3 or m4a files under 300mb."
				);
			}
		},
		async downloadToTmp(fileLink, filePath, fileSize) {
			try {
				// Define the mimetype
				const mime = filePath.match(/\.\w+$/)[0];

				// Check if the mime type is supported (mp3 or m4a)
				if (mime !== ".mp3" && mime !== ".m4a") {
					throw new Error(
						"Unsupported file type. Only mp3 and m4a files are supported."
					);
				}

				// Define the tmp file path
				const tmpPath = `/tmp/${filePath.match(/[^\/]*\.\w+$/)[0]}`;

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
						"Failed to read audio file metadata. The file format might be unsupported or corrupted, or the file might no longer exist at the specified file path (which is in temp storage)."
					);
				}

				// Get and return the duration in seconds
				const duration = Math.round(
					await inspect(dataPack.format.duration, {
						showHidden: false,
						depth: null,
					})
				);
				console.log(`Successfully got duration: ${duration} seconds`);
				return duration;
			} catch (error) {
				// Log the error and return an error message or handle the error as required
				console.error(error);
				throw new Error(
					`An error occurred while processing the audio file: ${error.message}`
				);
			}
		},
		async chunkFileAndTranscribe({ file }, openai) {
			const outputDir = join("/tmp", "chunks");
			await execAsync(`mkdir -p "${outputDir}"`);
			await execAsync(`rm -f "${outputDir}/*"`);

			console.log(`Chunking file: ${file}`);
			await this.chunkFile({
				file,
				outputDir,
			});

			const files = await fs.promises.readdir(outputDir);

			console.log(`Transcribing chunks: ${files}`);
			return await this.transcribeFiles(
				{
					files,
					outputDir,
				},
				openai
			);
		},
		async chunkFile({ file, outputDir }) {
			const ffmpegPath = ffmpegInstaller.path;
			const ext = extname(file);

			const fileSizeInMB = fs.statSync(file).size / (1024 * 1024);
			const numberOfChunks = Math.ceil(fileSizeInMB / 24);

			if (numberOfChunks === 1) {
				await execAsync(`cp "${file}" "${outputDir}/chunk-000${ext}"`);
				return;
			}

			const { stdout: durationOutput } = await execAsync(
				`${ffmpegPath} -i "${file}" 2>&1 | grep "Duration"`
			);
			const duration = durationOutput.match(/\d{2}:\d{2}:\d{2}\.\d{2}/s)[0];
			const [hours, minutes, seconds] = duration.split(":").map(parseFloat);

			const totalSeconds = hours * 60 * 60 + minutes * 60 + seconds;
			const segmentTime = Math.ceil(totalSeconds / numberOfChunks);

			const command = `${ffmpegPath} -i "${file}" -f segment -segment_time ${segmentTime} -c copy -loglevel verbose "${outputDir}/chunk-%03d${ext}"`;
			console.log(`Spliting file into chunks with ffmpeg command: ${command}`);
			const { stdout: chunkOutput, stderr: chunkError } = await execAsync(
				command
			);

			if (chunkOutput) {
				console.log(`stdout: ${chunkOutput}`);
			}

			if (chunkError) {
				console.log(`stderr: ${chunkError}`);
			}
		},
		transcribeFiles({ files, outputDir }, openai) {
			const limiter = new Bottleneck({
				maxConcurrent: 15,
				minTime: 1000 / 3,
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
			const readStream = fs.createReadStream(join(outputDir, file));
			console.log(`Transcribing file: ${file}`);
			const response = openai.audio.transcriptions
				.create(
					{
						model: "whisper-1",
						file: readStream,
					},
					{
						maxRetries: 5,
					}
				)
				.withResponse();

			// Log the user's Audio limits
			const limits = {
				requestRate: response.response.headers.get(
					"x-ratelimit-limit-requests"
				),
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
				"Your API key's current Audio endpoing limits (learn more at https://platform.openai.com/docs/guides/rate-limits/overview):"
			);
			console.table(limits);

			// Warn the user if their remaining requests are down to 1
			if (limits.remainingRequests <= 1) {
				console.log(
					"WARNING: Only 1 request remaining in the current time period. Rate-limiting may occur after the next request. If so, this script will attempt to retry with exponential backoff, but the workflow run may hit your Timeout Settings (https://pipedream.com/docs/workflows/settings/#execution-timeout-limit) before completing. If you have not upgraded your OpenAI account to a paid account by adding your billing information (and generated a new API key afterwards, replacing your trial key here in Pipedream with that new one), your trial API key is subject to low rate limits. Learn more here: https://platform.openai.com/docs/guides/rate-limits/overview"
				);
			}

			return response;
		},
		combineWhisperChunks(chunksArray) {
			let combinedText = "";

			for (let i = 0; i < chunksArray.length; i++) {
				let currentChunk = chunksArray[i].data.text; // Added .data to comply with the withResponse() data scheme
				let nextChunk =
					i < chunksArray.length - 1 ? chunksArray[i + 1].text : null;

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

			return combinedText;
		},
		splitTranscript(encodedTranscript, maxTokens) {
			const stringsArray = [];
			let currentIndex = 0;

			while (currentIndex < encodedTranscript.length) {
				let endIndex = Math.min(
					currentIndex + maxTokens,
					encodedTranscript.length
				);

				// Find the next period
				while (
					endIndex < encodedTranscript.length &&
					decode([encodedTranscript[endIndex]]) !== "."
				) {
					endIndex++;
				}

				// Include the period in the current string
				if (endIndex < encodedTranscript.length) {
					endIndex++;
				}

				// Add the current chunk to the stringsArray
				const chunk = encodedTranscript.slice(currentIndex, endIndex);
				stringsArray.push(decode(chunk));

				currentIndex = endIndex;
			}

			console.log(`Split transcript into ${stringsArray.length} chunks`);
			return stringsArray;
		},
		async sendToChat(openai, stringsArray) {
			const limiter = new Bottleneck({
				maxConcurrent: 15,
			});

			console.log(`Sending ${stringsArray.length} chunks to ChatGPT`);
			const results = limiter.schedule(() => {
				const tasks = stringsArray.map((arr, index) =>
					this.chat(openai, arr, index)
				);
				return Promise.all(tasks);
			});
			return results;
		},
		async chat(openai, prompt, index) {
			return retry(
				async (bail, attempt) => {
					console.log(`Attempt ${attempt}: Sending chunk ${index} to ChatGPT`);
					return openai.chat.completions.create(
						{
							model: this.chat_model ?? "gpt-3.5-turbo",
							messages: [
								{
									role: "user",
									content: createPrompt(prompt),
								},
								{
									role: "system",
									content: systemPrompt,
								},
							],
							temperature: this.temperature / 10 ?? 0.2,
						},
						{
							maxRetries: 3,
						}
					);
				},
				{
					retries: 3,
					onRetry: (error, attempt) => {
						console.error(
							`Attempt ${attempt} for chunk ${index} failed with error: ${error.message}. Retrying...`
						);
					},
				}
			);
		},
		formatChat(summaryArray) {
			const resultsArray = [];
			console.log(`Formatting the ChatGPT results...`);
			for (let result of summaryArray) {
				const input = result.choices[0].message.content;
				let jsonObj;
				try {
					jsonObj = JSON.parse(input);
				} catch (error) {
					try {
						console.log(
							`Encountered an error: ${error}. Attempting JSON repair...`
						);
						const cleanedJsonString = jsonrepair(input);
						jsonObj = JSON.parse(cleanedJsonString);
					} catch (error) {
						console.log(
							`First JSON repair attempt failed with error: ${error}. Attempting more involved JSON repair...`
						);
						try {
							// Find the first { or [ and the last } or ]
							const beginningIndex = Math.min(
								input.indexOf("{") !== -1 ? input.indexOf("{") : Infinity,
								input.indexOf("[") !== -1 ? input.indexOf("[") : Infinity
							);
							const endingIndex = Math.max(
								input.lastIndexOf("}") !== -1
									? input.lastIndexOf("}")
									: -Infinity,
								input.lastIndexOf("]") !== -1
									? input.lastIndexOf("]")
									: -Infinity
							);

							// If no JSON object or array is found, throw an error
							if (beginningIndex == Infinity || endingIndex == -1) {
								throw new Error(
									"No JSON object or array found (in repairJSON)."
								);
							}

							const cleanedJsonString = jsonrepair(
								input.substring(beginningIndex, endingIndex + 1)
							);
							jsonObj = JSON.parse(cleanedJsonString);
						} catch (error) {
							throw new Error(
								`Recieved invalid JSON from ChatGPT. All JSON repair efforts failed. Recommended fix: Lower the ChatGPT model temperature and try uploading the file again.`
							);
						}
					}
				}

				const response = {
					choice: jsonObj,
					usage: !result.usage.total_tokens ? 0 : result.usage.total_tokens,
				};

				resultsArray.push(response);
			}

			const chatResponse = {
				title: resultsArray[0].choice.title,
				sentiment: resultsArray[0].choice.sentiment,
				summary: [],
				main_points: [],
				action_items: [],
				stories: [],
				arguments: [],
				follow_up: [],
				related_topics: [],
				usageArray: [],
			};

			for (let arr of resultsArray) {
				chatResponse.summary.push(arr.choice.summary);
				chatResponse.main_points.push(arr.choice.main_points);
				chatResponse.action_items.push(arr.choice.action_items);
				chatResponse.stories.push(arr.choice.stories);
				chatResponse.arguments.push(arr.choice.arguments);
				chatResponse.follow_up.push(arr.choice.follow_up);
				chatResponse.related_topics.push(arr.choice.related_topics);
				chatResponse.usageArray.push(arr.usage);
			}

			function arraySum(arr) {
				const init = 0;
				const sum = arr.reduce(
					(accumulator, currentValue) => accumulator + currentValue,
					init
				);
				return sum;
			}

			const finalChatResponse = {
				title: chatResponse.title,
				summary: chatResponse.summary.join(" "),
				sentiment: chatResponse.sentiment,
				main_points: chatResponse.main_points.flat(),
				action_items: chatResponse.action_items.flat(),
				stories: chatResponse.stories.flat(),
				arguments: chatResponse.arguments.flat(),
				follow_up: chatResponse.follow_up.flat(),
				related_topics: Array.from(
					new Set(
						chatResponse.related_topics.flat().map((item) => item.toLowerCase())
					)
				).sort(),
				tokens: arraySum(chatResponse.usageArray),
			};

			return finalChatResponse;
		},
		makeParagraphs(transcript, summary) {
			const tokenizer = new natural.SentenceTokenizer();
			const transcriptSentences = tokenizer.tokenize(transcript);
			const summarySentences = tokenizer.tokenize(summary);

			const sentencesPerParagraph = 5;

			function sentenceGrouper(arr) {
				const newArray = [];

				for (let i = 0; i < arr.length; i += sentencesPerParagraph) {
					const group = [];
					for (let j = i; j < i + sentencesPerParagraph; j++) {
						if (arr[j]) {
							group.push(arr[j]);
						}
					}

					newArray.push(group.join(" "));
				}

				return newArray;
			}

			function charMaxChecker(arr) {
				const sentenceArray = arr
					.map((element) => {
						if (element.length > 800) {
							const pieces = element.match(/.{800}[^\s]*\s*/g);
							if (element.length > pieces.join("").length) {
								pieces.push(element.slice(pieces.join("").length));
							}
							return pieces;
						} else {
							return element;
						}
					})
					.flat();

				return sentenceArray;
			}

			console.log(`Converting the transcript to paragraphs...`);
			const paragraphs = sentenceGrouper(transcriptSentences);
			console.log(`Converting the summary to paragraphs...`);
			const lengthCheckedParagraphs = charMaxChecker(paragraphs);

			const summaryParagraphs = sentenceGrouper(summarySentences);
			const lengthCheckedSummaryParagraphs = charMaxChecker(summaryParagraphs);

			const allParagraphs = {
				transcript: lengthCheckedParagraphs,
				summary: lengthCheckedSummaryParagraphs,
			};

			return allParagraphs;
		},
		async calculateTranscriptCost(duration, model) {
			if (!duration || typeof duration !== "number") {
				throw new Error(
					"Invalid duration number (thrown from calculateTranscriptCost)."
				);
			}

			if (!model || typeof model !== "string") {
				throw new Error(
					"Invalid model string (thrown from calculateTranscriptCost)."
				);
			}

			console.log(`Calculating the cost of the transcript...`);
			const cost = (duration / 60) * rates[model].completion;

			return cost;
		},
		async calculateGPTCost(usage, model) {
			if (
				!usage ||
				typeof usage !== "object" ||
				!usage.prompt_tokens ||
				!usage.completion_tokens
			) {
				throw new Error("Invalid usage object (thrown from calculateGPTCost).");
			}

			if (!model || typeof model !== "string") {
				throw new Error("Invalid model string (thrown from calculateGPTCost).");
			}

			const chatModel = model.includes("gpt-4-32")
				? "gpt-4-32k"
				: model.includes("gpt-4")
				? "gpt-4"
				: model.includes("gpt-3.5-turbo-16k")
				? "gpt-3.5-turbo-16k"
				: "gpt-3.5-turbo";

			if (!rates[chatModel]) {
				throw new Error("Non-supported model. (thrown from calculateGPTCost).");
			}

			console.log(`Calculating the cost of the summary...`);
			const costs = {
				prompt: (usage.prompt_tokens / 1000) * rates[chatModel].prompt,
				completion:
					(usage.completion_tokens / 1000) * rates[chatModel].completion,
				get total() {
					return this.prompt + this.completion;
				},
			};

			return costs.total;
		},
		async createNotionPage(
			steps,
			notion,
			duration,
			formatted_chat,
			paragraphs,
			cost
		) {
			let mp3Link;
			if (steps.trigger.event.webViewLink) {
				// Google Drive web link path
				mp3Link = steps.trigger.event.webViewLink;
			} else if (steps.trigger.event.webUrl) {
				// MS OneDrive web link path
				mp3Link = steps.trigger.event.webUrl;
			} else {
				mp3Link = encodeURI(
					"https://www.dropbox.com/home" + steps.trigger.event.path_lower
				);
			}

			const today = new Date();
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, "0");
			const day = String(today.getDate()).padStart(2, "0");
			const date = `${year}-${month}-${day}`;

			const meta = formatted_chat;

			meta.transcript = paragraphs.transcript;
			meta.long_summary = paragraphs.summary;

			const transcriptionCost = cost.transcript;
			meta["transcription-cost"] = `Transcription Cost: $${transcriptionCost
				.toFixed(3)
				.toString()}`;
			const chatCost = cost.summary;
			meta["chat-cost"] = `Chat API Cost: $${chatCost.toFixed(3).toString()}`;
			const totalCost = transcriptionCost + chatCost;
			meta["total-cost"] = `Total Cost: $${totalCost.toFixed(3).toString()}`;

			const labeledSentiment = `Sentiment: ${meta.sentiment}`;

			const data = {
				parent: {
					type: "database_id",
					database_id: this.databaseID,
				},
				icon: {
					type: "emoji",
					emoji: "🤖",
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
				},
				children: [
					{
						callout: {
							rich_text: [
								{
									text: {
										content:
											"This AI transcription and summary was created on ",
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
											url: mp3Link,
										},
									},
								},
							],
							icon: {
								emoji: "🤖",
							},
							color: "blue_background",
						},
					},
					{
						table_of_contents: {
							color: "default",
						},
					},
					{
						heading_1: {
							rich_text: [
								{
									text: {
										content: "Summary",
									},
								},
							],
						},
					},
				],
			};

			// Construct the summary
			for (let paragraph of meta.long_summary) {
				const summaryParagraph = {
					paragraph: {
						rich_text: [
							{
								text: {
									content: paragraph,
								},
							},
						],
					},
				};

				data.children.push(summaryParagraph);
			}

			// Add the Transcript header
			const transcriptHeader = {
				heading_1: {
					rich_text: [
						{
							text: {
								content: "Transcript",
							},
						},
					],
				},
			};

			data.children.push(transcriptHeader);

			// Create an array of paragraphs from the transcript
			// If the transcript has more than 80 paragraphs, I need to split it and only send
			// the first 80.
			const transcriptHolder = [];
			const transcriptBlockMaxLength = 80;

			for (
				let i = 0;
				i < meta.transcript.length;
				i += transcriptBlockMaxLength
			) {
				const chunk = meta.transcript.slice(i, i + transcriptBlockMaxLength);
				transcriptHolder.push(chunk);
			}

			// Push the first block of transcript chunks into the data object
			const firstTranscriptBlock = transcriptHolder[0];
			for (let sentence of firstTranscriptBlock) {
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

			// Add Additional Info

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

			// Add Action Items

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

			additionalInfoHandler(
				meta.main_points,
				"Main Points",
				"bulleted_list_item"
			);
			additionalInfoHandler(
				meta.stories,
				"Stories, Examples, and Citations",
				"bulleted_list_item"
			);
			additionalInfoHandler(
				meta.action_items,
				"Potential Action Items",
				"to_do"
			);
			additionalInfoHandler(
				meta.follow_up,
				"Follow-Up Questions",
				"bulleted_list_item"
			);
			additionalInfoHandler(
				meta.arguments,
				"Arguments and Areas for Improvement",
				"bulleted_list_item"
			);
			additionalInfoHandler(
				meta.related_topics,
				"Related Topics",
				"bulleted_list_item"
			);

			// Add sentiment and cost
			const metaArray = [
				labeledSentiment,
				meta["transcription-cost"],
				meta["chat-cost"],
				meta["total-cost"],
			];
			additionalInfoHandler(metaArray, "Meta", "bulleted_list_item");

			// Create the page in Notion
			let response;
			try {
				await retry(
					async (bail) => {
						try {
							console.log(`Creating Notion page...`);
							response = await notion.pages.create(data);
						} catch (error) {
							if (400 <= error.status && error.status <= 409) {
								// Don't retry for errors 400-409
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
						onRetry: (error) =>
							console.log("Retrying Notion task creation:", error),
					}
				);
			} catch (error) {
				throw new Error("Failed to create Notion page.");
			}

			// Create an object to pass to the next step
			const responseHolder = {
				response: response,
				transcript: transcriptHolder,
				additional_info: additionalInfoArray,
			};

			return responseHolder;
		},
		async updateNotionPage(notion, page) {
			console.log(`Updating the Notion page with all leftover information.`);

			const limiter = new Bottleneck({
				maxConcurrent: 1,
				minTime: 300,
			});

			const pageID = page.response.id.replace(/-/g, "");

			const transcriptArray = page.transcript;
			transcriptArray.shift();

			const transcriptAdditionResponses = await Promise.all(
				transcriptArray.map((transcript) =>
					limiter.schedule(() =>
						this.sendTranscripttoNotion(notion, transcript, pageID)
					)
				)
			);

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

			const allAPIResponses = {
				transcript_responses: transcriptAdditionResponses,
				additional_info_responses: additionalInfoAdditionResponses,
			};

			return allAPIResponses;
		},
		async sendTranscripttoNotion(notion, transcript, pageID) {
			return retry(
				async (bail, attempt) => {
					const data = {
						block_id: pageID,
						children: [],
					};

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

					console.log(`Attempt ${attempt}: Sending transcript to Notion...`);
					const response = await notion.blocks.children.append(data);
					return response;
				},
				{
					retries: 3,
					onRetry: (error, attempt) =>
						console.log(
							`Retrying Notion transcript addition (attempt ${attempt}):`,
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

					console.log(
						`Attempt ${attempt}: Sending additional info to Notion...`
					);
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
	},
	async run({ steps, $ }) {
		console.log("Checking that file is under 300mb...");
		await this.checkSize(steps.trigger.event.size);
		console.log("File is under 300mb. Continuing...");

		const notion = new Client({ auth: this.notion.$auth.oauth_access_token });

		const fileInfo = {};

		if (steps.download_file?.$return_value?.name) {
			// Google Drive method
			fileInfo.path = `/tmp/${steps.download_file.$return_value.name}`;
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			if (fileInfo.mime !== ".mp3" && fileInfo.mime !== ".m4a") {
				throw new Error(
					"Unsupported file type. Only mp3 and m4a files are supported."
				);
			}
		} else if (
			steps.download_file?.$return_value &&
			/^\/tmp\/.+/.test(steps.download_file.$return_value)
		) {
			// MS OneDrive method
			fileInfo.path = steps.download_file.$return_value;
			fileInfo.mime = fileInfo.path.match(/\.\w+$/)[0];
			if (fileInfo.mime !== ".mp3" && fileInfo.mime !== ".m4a") {
				throw new Error(
					"Unsupported file type. Only mp3 and m4a files are supported."
				);
			}
		} else {
			// Dropbox method
			Object.assign(
				fileInfo,
				await this.downloadToTmp(
					steps.trigger.event.link,
					steps.trigger.event.path_lower,
					steps.trigger.event.size
				)
			);
		}

		console.log(`File path and mime:`);
		console.log(fileInfo);

		fileInfo.duration = await this.getDuration(fileInfo.path);

		const openai = new OpenAI({
			apiKey: this.openai.$auth.api_key,
		});

		fileInfo.whisper = await this.chunkFileAndTranscribe(
			{ file: fileInfo.path },
			openai
		);

		const chatModel = this.chat_model.includes("gpt-4-32")
			? "gpt-4-32k"
			: this.chat_model.includes("gpt-4")
			? "gpt-4"
			: this.chat_model.includes("gpt-3.5-turbo-16k")
			? "gpt-3.5-turbo-16k"
			: "gpt-3.5-turbo";

		const maxTokens = this.summary_density
			? this.summary_density
			: chatModel === "gpt-4-32k"
			? 5000
			: chatModel === "gpt-4"
			? 5000
			: chatModel === "gpt-3.5-turbo-16k"
			? 5000
			: 2750;

		fileInfo.full_transcript = this.combineWhisperChunks(fileInfo.whisper);

		const encodedTranscript = encode(fileInfo.full_transcript);
		console.log(
			`Full transcript is ${encodedTranscript.lenth} tokens. If you run into rate-limit errors and are currently using free trial credit from OpenAI, please note the Tokens Per Minute (TPM) limits: https://platform.openai.com/docs/guides/rate-limits/what-are-the-rate-limits-for-our-api`
		);

		fileInfo.transcript_chunks = this.splitTranscript(
			encodedTranscript,
			maxTokens
		);

		fileInfo.summary = await this.sendToChat(
			openai,
			fileInfo.transcript_chunks
		);

		fileInfo.formatted_chat = this.formatChat(fileInfo.summary);

		fileInfo.paragraphs = this.makeParagraphs(
			fileInfo.full_transcript,
			fileInfo.formatted_chat.summary
		);

		fileInfo.cost = {};

		fileInfo.cost.transcript = await this.calculateTranscriptCost(
			fileInfo.duration,
			"whisper"
		);

		const summaryUsage = {
			prompt_tokens: fileInfo.summary.reduce((total, item) => {
				return total + item.usage.prompt_tokens;
			}, 0),
			completion_tokens: fileInfo.summary.reduce((total, item) => {
				return total + item.usage.completion_tokens;
			}, 0),
		};

		console.log(`Total tokens used in the summary process: ${summaryUsage}`);

		fileInfo.cost.summary = await this.calculateGPTCost(
			summaryUsage,
			fileInfo.summary[0].model
		);

		fileInfo.notion_response = await this.createNotionPage(
			steps,
			notion,
			fileInfo.duration,
			fileInfo.formatted_chat,
			fileInfo.paragraphs,
			fileInfo.cost
		);

		fileInfo.updated_notion_response = await this.updateNotionPage(
			notion,
			fileInfo.notion_response
		);

		return fileInfo;
	},
});
