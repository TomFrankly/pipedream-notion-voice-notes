import { Client } from "@notionhq/client";
import Bottleneck from "bottleneck";
import { Configuration, OpenAIApi } from "openai";
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
import FormData from "form-data";
import openai from "@pipedream/openai";
import natural from "natural";
import retry from "async-retry";
import deepgram from "@deepgram/sdk";

const COMMON_AUDIO_FORMATS_TEXT =
	"Your audio file must be in one of these formats: mp3, mp4, mpeg, mpga, m4a, wav, or webm.";

const execAsync = promisify(exec);
const pipelineAsync = promisify(stream.pipeline);

const systemPrompt = `You are an assistant that only speaks JSON. Do not write normal text.

Example formatting:

{
    "title": "Notion Buttons",
    "summary": "A collection of buttons for Notion",
    "action_items": [
        "item 1",
        "item 2",
        "item 3"
    ],
    "follow_up": [
        "item 1",
        "item 2",
        "item 3"
    ],
    "arguments": [
        "item 1",
        "item 2",
        "item 3"
    ],
    "related_topics": [
        "item 1",
        "item 2",
        "item 3"
    ]
    "sentiment": "positive"
}
              `;

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
		openai,
		deepgram: {
			type: "app",
			app: "deepgram",
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
				const configuration = new Configuration({
					apiKey: this.openai.$auth.api_key,
				});

				const openai = new OpenAIApi(configuration);
				const response = await openai.listModels();

				results = response.data.data.filter(
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
				description: `Select the model you would like to use.\n\nDefaults to **gpt-3.5-turbo**, which is recommended for this workflow.\n\nSwitching to the gpt-3.5-turbo-16k model may help you handle longer files. You can also use **gpt-4**, which may provide more insightful summaries and lists, but it will increase the cost of the summarization step by a factor of 20 (it won't increase the cost of transcription, which is typically about 90% of the cost).`,
				default: "gpt-3.5-turbo",
				options: results.map((model) => ({
					label: model.id,
					value: model.id,
				})),
				optional: true,
			},
		};

		return props;
	},
	methods: {
		async downloadToTmp(fileLink, filePath, fileSize) {
			if (fileSize > 150000000) {
				throw new Error(
					"File is too large. Files must be mp3 or m4a files under 150mb"
				);
			}

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
		async transcribeWithDeepgram(file) {
			console.log(`Transcribing file: ${file}`);

			// Initialize Deepgram client with your API key
			const client = new deepgram.Deepgram(this.deepgram.$auth.api_key);

			// Read the audio file as a buffer
			const audioData = fs.readFileSync(file);

			// Use Deepgram's SDK to transcribe the audio
			const result = await client.transcription.transcribe({
				data: audioData,
				// Add any additional parameters needed for your transcription here
			});

			// Convert the transcription result to plaintext, if necessary
			const transcript = result.transcript; // Adjust as needed based on the result structure
			const plaintextTranscript = transcriptToString(transcript); // You may need to write a conversion function

			console.log(`Transcription complete for file: ${file}`);
			return plaintextTranscript;
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
				maxConcurrent: 5,
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
					return openai.createChatCompletion({
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
						temperature: 0.2,
					});
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
				// ChatGPT loves to occasionally throw commas after the final element in arrays, so let's remove them
				function removeTrailingCommas(jsonString) {
					const regex = /,\s*(?=])/g;
					return jsonString.replace(regex, "");
				}

				// Need some code that will ensure we only get the JSON portion of the response
				// This should be the entire response already, but we can't always trust GPT
				const jsonString = result.data.choices[0].message.content
					.replace(/^[^\{]*?{/, "{")
					.replace(/\}[^}]*?$/, "}");

				const cleanedJsonString = removeTrailingCommas(jsonString);

				let jsonObj;
				try {
					jsonObj = JSON.parse(cleanedJsonString);
				} catch (error) {
					console.error("Error while parsing cleaned JSON string:");
					console.error(error);
					console.log("Original JSON string:", jsonString);
					console.log(cleanedJsonString);
					console.log("Cleaned JSON string:", cleanedJsonString);
					jsonObj = {};
				}

				const response = {
					choice: jsonObj,
					usage: !result.data.usage.total_tokens
						? 0
						: result.data.usage.total_tokens,
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

			console.log(chatResponse.related_topics);

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

			const sentencesPerParagraph = 3;

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
			const lengthCheckedSummaryParagraphcs = charMaxChecker(summaryParagraphs);

			const allParagraphs = {
				transcript: lengthCheckedParagraphs,
				summary: lengthCheckedSummaryParagraphcs,
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
			const mp3Link = encodeURI(
				"https://www.dropbox.com/home" + steps.trigger.event.path_lower
			);

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
			console.log(firstTranscriptBlock);
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
				console.log(sentence);
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
				maxConcurrent: 5,
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
		const notion = new Client({ auth: this.notion.$auth.oauth_access_token });

		const fileInfo = {};

		Object.assign(
			fileInfo,
			await this.downloadToTmp(
				steps.trigger.event.link,
				steps.trigger.event.path_lower,
				steps.trigger.event.size
			)
		);

		fileInfo.duration = await this.getDuration(fileInfo.path);

		fileInfo.whisper = await this.chunkFileAndTranscribe({
			file: fileInfo.path,
			$,
		});

		const chatModel = this.chat_model.includes("gpt-4-32")
			? "gpt-4-32k"
			: this.chat_model.includes("gpt-4")
			? "gpt-4"
			: this.chat_model.includes("gpt-3.5-turbo-16k")
			? "gpt-3.5-turbo-16k"
			: "gpt-3.5-turbo";

		const maxTokens =
			chatModel === "gpt-4-32k"
				? 30000
				: chatModel === "gpt-4"
				? 6000
				: chatModel === "gpt-3.5-turbo-16k"
				? 14000
				: 2750;

		fileInfo.transcript_chunks = this.splitTranscript(
			encode(fileInfo.whisper[0].text),
			maxTokens
		);

		const openAIkey = this.openai.$auth.api_key;
		const configuration = new Configuration({
			apiKey: openAIkey,
		});
		const openai = new OpenAIApi(configuration);

		fileInfo.summary = await this.sendToChat(
			openai,
			fileInfo.transcript_chunks
		);

		fileInfo.formatted_chat = this.formatChat(fileInfo.summary);

		fileInfo.paragraphs = this.makeParagraphs(
			fileInfo.whisper[0].text,
			fileInfo.formatted_chat.summary
		);

		fileInfo.cost = {};

		fileInfo.cost.transcript = await this.calculateTranscriptCost(
			fileInfo.duration,
			"whisper"
		);

		fileInfo.cost.summary = await this.calculateGPTCost(
			fileInfo.summary[0].data.usage,
			fileInfo.summary[0].data.model
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
