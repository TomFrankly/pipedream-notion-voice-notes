import { Client } from "@notionhq/client"; // Notion SDK
import { createPage, createNotion } from "notion-helper"; // Notion helper

import EMOJI from "./helpers/emoji.mjs"; // Emoji list

export default {
    name: "Send to Notion",
    key: "send-to-notion",
    description: "A versatile action for sending data to Notion. Primarily used for sending the results of the Transcribe and Summarize action to Notion.",
    type: "action",
    version: "0.0.21",
    props: {
        steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
		},
        notion: {
            type: "app",
            app: "notion",
            description: "Connect your Notion account to send data to Notion.",
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
							page_size: 100,
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

						let notesDbs = response.results.filter((db) =>
							/notes/i.test(db.title?.[0]?.plain_text)
						);
						let nonNotesDbs = response.results.filter(
							(db) => !/notes/i.test(db.title?.[0]?.plain_text)
						);
						let sortedDbs = [...notesDbs, ...nonNotesDbs];
						const options = sortedDbs.map((db) => ({
							label: db.title?.[0]?.plain_text,
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
		}
    },
    async additionalProps() {
        if (!this.databaseID) return {};
        
        let props = {}

        const notion = new Client({
            auth: this.notion.$auth.oauth_access_token,
        });

        const database = await notion.databases.retrieve({
            database_id: this.databaseID,
        });

        const properties = database.properties;

        const notionProps = {
            noteTitle: {
                type: "string",
                label: "Note Title (Required)",
                description: `Select the title property for your notes. By default, it is called **Name**. Your chosen database will only ever have one choice for this property.`,
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "title")
                    .map((prop) => ({ label: prop, value: prop })),
                optional: false,
                reloadProps: true,
            },
            ...(this.noteTitle && {
                noteTitleValue: {
                    type: "string",
                    label: "Note Title Value",
                    description:
                        `Choose the value for your note title. Defaults to an AI-generated title based off of the first summarized chunk from your transcription. You can also choose to use the audio file name, or both. If you pick both, the title will be in the format "File Name – AI Title".\n\n**Note:** If you didn't set an AI Service in the Transcribe_and_Summarize step, your title will be the audio file name even if you choose "AI Generated Title" here. Without an AI Service, the previous step is unable to generate a title.\n\n**Advanced:** You can also construct a custom title by choosing the *Enter a custom expression* tab and building an expression that evaluates to a string. `,
                    options: [
                        "AI Generated Title",
                        "Audio File Name",
                        'Both ("File Name – AI Title")',
                    ],
                    default: "AI Generated Title",
                    optional: true,
                },
            }),
            noteDuration: {
                type: "string",
                label: "Note Duration",
                description:
                    "Select the duration property for your database. This must be a Number-type property. Duration will be expressed in **seconds**.",
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "number")
                    .map((prop) => ({ label: prop, value: prop })),
                optional: true,
            },
            noteTag: {
                type: "string",
                label: "Note Tag",
                description:
                    'Choose a Select-type property for tagging your note (e.g. tagging it as "AI Transcription").',
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "select")
                    .map((prop) => ({ label: prop, value: prop })),
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
            noteIcon: {
                type: "string",
                label: "Note Page Icon",
                description:
                    "Choose an emoji to use as the icon for your note page. Defaults to 🤖. If you don't see the emoji you want in the list, you can also simply type or paste it in the box below.",
                options: EMOJI,
                optional: true,
                default: "🤖",
            },
            noteDate: {
                type: "string",
                label: "Note Date",
                description:
                    "Select a date property for your note. This property will be set to the date the audio file was created.",
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "date")
                    .map((prop) => ({ label: prop, value: prop })),
                optional: true,
            },
            noteFileName: {
                type: "string",
                label: "Note File Name",
                description:
                    "Select a text-type property for your note's file name. This property will store the name of the audio file.",
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "rich_text")
                    .map((prop) => ({ label: prop, value: prop })),
                optional: true,
            },
            noteFileLink: {
                type: "string",
                label: "Note File Link",
                description:
                    "Select a URL-type property for your note's file link. This property will store a link to the audio file.",
                options: Object.keys(properties)
                    .filter((k) => properties[k].type === "url")
                    .map((prop) => ({ label: prop, value: prop })),
                optional: true,
            },
            useToggleHeaders: {
                type: "boolean",
                label: "Use Toggle Headers",
                description: "If true, the note will be formatted with toggle headers for each section of the note.",
                default: false,
                optional: true,
            },
            includedSections: {
                type: "string[]",
                label: "Included Sections",
                description: `Choose the sections you'd like to include in your Notion page. A chosen section will only be included if the Transcribe and Summarize step includes data for that section.\n\n**Note:** If you don't include a section here, you can still reference it in your own additional action steps later in the workflow.`,
                options: [
                    {
                        label: "Summary",
                        value: "summary",
                    },
                    {
                        label: "Transcript",
                        value: "transcript",
                    },
                    {
                        label: "Original-Language Transcript (If Translated)",
                        value: "original_language_transcript",
                    },
                    {
                        label: "Timestamped Transcript",
                        value: "vtt",
                    },
                    {
                        label: "Main Points",
                        value: "main_points",
                    },
                    {
                        label: "Action Items",
                        value: "action_items",
                    },
                    {   
                        label: "Follow-Up Questions",
                        value: "follow_up",
                    },
                    {
                        label: "Stories",
                        value: "stories",
                    },
                    {
                        label: "References",
                        value: "references",
                    },
                    {   
                        label: "Arguments",
                        value: "arguments",
                    },
                    {
                        label: "Related Topics",
                        value: "related_topics",
                    },
                    {
                        label: "Chapters",
                        value: "chapters",
                    }
                ],
            },
            compressTranscripts: {
                type: "boolean",
                label: "Compress Transcripts",
                description: `If true, content in the Transcript and Original-Language Transcript (if present) sections will be compressed into as few blocks as possible, resulting in far fewer calls to the Notion API.\n\nThis can be useful if you're transcribing very long audio files. If you're running into timeout issues with this Send to Notion step, try setting this to true.`,
                default: false,
                optional: true,
            },
            compressTimestamps: {
                type: "boolean",
                label: "Compress Timestamps",
                description: `If true, content in the Timestamped Transcript section will be compressed into as few blocks as possible, resulting in far fewer calls to the Notion API.\n\nThis can be useful if you're transcribing very long audio files. If you're running into timeout issues with this Send to Notion step, try setting this to true.`,
                default: false,
                optional: true,
            }
                
        }

        // Add notionProps to props
        props = {
            ...props,
            ...notionProps,
        }

        return props;
    },
    methods: {
        createCompressedTranscript(textArray) {
            const compressedArray = [];
            let i = 0;
            while (i < textArray.length) {
                const currentChunk = [];
                for (let j = 0; j < 4 && i < textArray.length; j++) {
                    let currentString = '';
                    let first = true;
                    while (i < textArray.length) {
                        const nextPart = textArray[i] + '\n\n';
                        if ((currentString.length + nextPart.length) > 1000 && !first) {
                            break;
                        }
                        currentString += nextPart;
                        i++;
                        first = false;
                    }
                    if (currentString.length > 0) {
                        currentChunk.push(currentString);
                    } else {
                        // If a single textArray[i] is longer than 2000, force add it and move on
                        currentChunk.push(textArray[i] + '\n\n');
                        i++;
                    }
                }
                if (currentChunk.length > 0) {
                    compressedArray.push(currentChunk);
                }
            }
            return compressedArray;
        }
    },
    async run({ steps, $ }) {

        // Log all the settings, except for the steps object
        console.log(`Notion database settings:`)
        console.log(`Database ID: ${this.databaseID}`)
        console.log(`Note title: ${this.noteTitle}`)
        console.log(`Note title value: ${this.noteTitleValue}`)
        console.log(`Note duration: ${this.noteDuration}`)
        console.log(`Note tag: ${this.noteTag}`)
        console.log(`Note tag value: ${this.noteTagValue}`)

        console.log(`Compression settings:`)
        console.log(`Compress transcripts: ${this.compressTranscripts}`)
        console.log(`Compress timestamps: ${this.compressTimestamps}`)
        
        // First, check that 'this.steps' exists, is an object, and the object has at least one key
        if (!this.steps || typeof this.steps !== "object" || Object.keys(this.steps).length === 0) {
            throw new Error(`Previous step data is required. Please ensure the "Previous Step Data" property is set to {{steps}}.`);
        }

        console.log(`Check 1: Steps object exists and is an object with at least one key.`)

        // Next, check that 'this.steps.Transcribe_and_Summarize' exists and has not been renamed or removed
        if (!this.steps.Transcribe_and_Summarize) {
            throw new Error(`The "Previous Step Data" property is set, but it looks like there's no "Transcribe and Summarize" step in your workflow. Please ensure that you have not renamed the "Transcribe and Summarize" step or removed it. It must be named "Transcribe and Summarize" for this action step to work.`);
        }

        console.log(`Check 2: "Transcribe and Summarize" step exists and has not been renamed or removed.`)

        // Next, check that the "Transcribe and Summarize" step has a "$return_value" object, which itself should have the keys "property_values", "page_content", and "other_data"
        if (!this.steps.Transcribe_and_Summarize.$return_value || typeof this.steps.Transcribe_and_Summarize.$return_value !== "object" || !this.steps.Transcribe_and_Summarize.$return_value.property_values || !this.steps.Transcribe_and_Summarize.$return_value.page_content || !this.steps.Transcribe_and_Summarize.$return_value.other_data) {
            throw new Error(`The "Transcribe and Summarize" step is present, but it doesn't look like it contains any data. Please ensure you've successfully tested the "Transcribe and Summarize" step before running this step.`);
        }

        console.log(`Check 3: "Transcribe and Summarize" step has a "$return_value" object. It contains the keys "property_values", "page_content", and "other_data".`)
        console.log(`All prerequisites for running this step have been met.`)
        
        // Get the "Transcribe and Summarize" step's "$return_value" object
        const fileInfo = this.steps.Transcribe_and_Summarize.$return_value;

        // Set up our Notion data
        let notionData = {}

        // Add the note title to the Notion data
        if (this.noteTitleValue && this.noteTitleValue.length > 0) {
            // User specified a custom title. Use it if able.
            if (this.noteTitleValue === `Both ("File Name – AI Title")` && fileInfo.property_values.ai_title) {
                notionData.noteTitle = `${fileInfo.property_values.filename} – ${fileInfo.property_values.ai_title}`;
            } else if (this.noteTitleValue === "AI Generated Title" && fileInfo.property_values.ai_title) {
                notionData.noteTitle = fileInfo.property_values.ai_title;
            } else if (this.noteTitleValue === "Audio File Name" && fileInfo.property_values.filename) {
                notionData.noteTitle = fileInfo.property_values.filename;
            } else {
                // User constructed their own custom title. Try to use it.
                try {
                    notionData.noteTitle = this.noteTitleValue;
                } catch (error) {
                    throw new Error(`There was an error evaluating your custom note title. Please ensure your custom title in the Note Title Value property is a valid string, and that any referenced variables from previous steps are valid.`);
                }
            }
        } else {
            // User didn't specify a custom title. If AI-generated title is present, use it. Otherwise, use the audio file name.
            if (fileInfo.property_values.ai_title) {
                notionData.noteTitle = fileInfo.property_values.ai_title;
            } else {
                notionData.noteTitle = fileInfo.property_values.filename;
            }
        }

        console.log(`Set title for the note to: ${notionData.noteTitle}`)

        // Set the page content
        notionData.page_content = {}

        // Canonical order from property definition
        const canonicalSectionOrder = [
            "summary",
            "transcript",
            "original_language_transcript",
            "vtt",
            "main_points",
            "action_items",
            "follow_up",
            "stories",
            "references",
            "arguments",
            "related_topics",
            "chapters"
        ];

        // Create orderedSections: only those selected by the user, in canonical order
        const orderedSections = canonicalSectionOrder.filter(section => this.includedSections.includes(section));

        // page_content option should have every key that is present in both this.includedSections and fileInfo.page_content
        // Create an ordered object by using a Map to maintain section order
        const orderedContent = new Map();
        orderedSections.forEach(section => {
            if (fileInfo.page_content[section]) {
                // Rename 'vtt' to 'timestamped_transcript' in the output
                const outputKey = section === 'vtt' ? 'timestamped_transcript' : section;
                orderedContent.set(outputKey, fileInfo.page_content[section]);
            }
        });
        notionData.page_content = Object.fromEntries(orderedContent);

        console.log(`Notion data:   `)
        console.dir(notionData, { depth: null });

        // Start constructing the Notion API data object with notion-helper
        let page = createNotion({
            limitChildren: false,
        })
            .parentDb(this.databaseID)
            .title(this.noteTitle, notionData.noteTitle)

        // If page icon is set, add it
        if (this.noteIcon) {
            page = page.icon(this.noteIcon);
        }

        // For each other Notion property, add it to the page if it's set
        try {
            if (this.noteDuration) {
                page = page.number(this.noteDuration, fileInfo.property_values.duration);
            }

            if (this.noteTag) {
                page = page.select(this.noteTag, this.noteTagValue);
            }

            if (this.noteFileName) {
                page = page.richText(this.noteFileName, fileInfo.property_values.filename);
            }

            if (this.noteFileLink) {
                page = page.url(this.noteFileLink, fileInfo.property_values.file_link);
            }
        } catch (error) {
            throw new Error(`There was an error adding a Notion property to the page. Please ensure that the property is valid and that the value is a string.`);
        }

        // if this.compressTimestamps is true and timestamped_transcript is present, compress the timestamps
        if (this.compressTimestamps === true && notionData.page_content.timestamped_transcript) {
            const uncompressedBlockCount = notionData.page_content.timestamped_transcript.length;

            // Compress the timestamped transcript
            notionData.page_content.timestamped_transcript = this.createCompressedTranscript(notionData.page_content.timestamped_transcript);

            const compressedBlockCount = notionData.page_content.timestamped_transcript.length;
            console.log(`Compressed ${uncompressedBlockCount} blocks in the Timestamped Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`)
            console.log(`Compressed timestamped transcript:`)
            // Log the first element of the compressed array
            console.log(notionData.page_content.timestamped_transcript[0]);
        } else if (notionData.page_content.timestamped_transcript) {
            const uncompressedBlockCount = notionData.page_content.timestamped_transcript.length;
            console.log(`Timestamped transcript is present, but compression is disabled. Timestamped Transcript section contains ${uncompressedBlockCount} blocks. First element of uncompressed array:`)
            // Log the first element of the uncompressed array
            console.log(notionData.page_content.timestamped_transcript[0]);
        }

        // If this.compressTranscripts is true, compress transcript and original_language_transcript if present
        if (this.compressTranscripts === true) {
            if (notionData.page_content.transcript) {
                const uncompressedBlockCount = notionData.page_content.transcript.length;

                // Compress the transcript
                notionData.page_content.transcript = this.createCompressedTranscript(notionData.page_content.transcript);

                const compressedBlockCount = notionData.page_content.transcript.length;
                console.log(`Compressed ${uncompressedBlockCount} blocks in the Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`)
                console.log(`Compressed transcript:`)
                // Log the first element of the compressed array
                console.log(notionData.page_content.transcript[0]);
            }
            if (notionData.page_content.original_language_transcript) {
                const uncompressedBlockCount = notionData.page_content.original_language_transcript.length;

                // Compress the original language transcript
                notionData.page_content.original_language_transcript = this.createCompressedTranscript(notionData.page_content.original_language_transcript);

                const compressedBlockCount = notionData.page_content.original_language_transcript.length;
                console.log(`Compressed ${uncompressedBlockCount} blocks in the Original-Language Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`)
                console.log(`Compressed original language transcript:`)
                console.log(notionData.page_content.original_language_transcript[0]);
            }
        }

        // Start constructing the page content

        // For each key in notionData.page_content, add it to the page content
        Object.keys(notionData.page_content).forEach(key => {
            // Creat the header text by capitalizing the first letter of each word in the key and replacing underscores with spaces
            const headerText = key.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());

            // Determine if the header should be a toggle
            const isToggle = this.useToggleHeaders && key !== "summary";

            // Create the section header
            if (isToggle) {
                page = page.startParent('heading_1', headerText);
            } else {
                page = page.heading1(headerText);
            }

            // Set the blocktype for the section content. If summary, transcript, original_language_transcript, or vtt, use a paragraph block. Otherwise, use a bulleted_list_item block.
            const blockType = ["summary", "transcript", "original_language_transcript", "timestamped_transcript"].includes(key) ? "paragraph" : "bulleted_list_item";

            // Add the section content
            page = page.loop(blockType, notionData.page_content[key]);

            // Close the section header
            if (isToggle) {
                page = page.endParent();
            }
        });

        // Build the page object
        page = page.build();

        // Log the size of page.additionalBlocks in kb
        const additionalBlocksSize = JSON.stringify(page.additionalBlocks).length / 1024;
        console.log(`Size of page.additionalBlocks: ${additionalBlocksSize.toFixed(2)} KB`);

        
        // Log the page object
        console.log(`Constructed page object:`)
        console.dir(page, { depth: null });
        
        // Create a Notion client
        const notion = new Client({
            auth: this.notion.$auth.oauth_access_token,
        });

        return page;

        // Create the page
        const response = await createPage({
            client: notion,
            data: page.content,
        })

        // Return the response
        return response;

    }
}