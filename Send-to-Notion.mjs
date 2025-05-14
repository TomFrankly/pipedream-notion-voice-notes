import { Client } from "@notionhq/client"; // Notion SDK
import { createPage, createNotion } from "notion-helper"; // Notion helper

import EMOJI from "./helpers/emoji.mjs"; // Emoji list

export default {
    name: "Send to Notion",
    key: "send-to-notion",
    description: "A versatile action for sending data to Notion. Primarily used for sending the results of the Transcribe and Summarize action to Notion.",
    type: "action",
    version: "0.0.43",
    props: {
        instructions: {
            type: "alert",
            alertType: "info",
            content: `## Instructions

This step takes the returned data from the "Transcribe and Summarize" step and sends it to Notion.

To set this step up, first ensure that the "Previous Step Data" property is set to **{{steps}}**. Then, connect your Notion account, grant Pipedream access to the database you want to use, and select it from the dropdown in the "Notes Database" property.

Finally, select the sections you'd like to include in your note and configure the database properties you'd like to use.
          
*Note: You can easily append additional sections to each note by adding a Notion → Append Block to Parent step after this one. Set Parent Block ID to the **{{steps.Send_to_Notion.$return_value.apiResponse.id}}** path.*

## Resources

- This workflow works with any Notion database, but it pairs well with [Ultimate Brain](https://thomasjfrank.com/brain/), my all-in-one productivity template.
- Want to capture web clips, full articles, and highlights to Notion? Check out [Flylighter](https://flylighter.com/), my free web clipper for Notion.
- Check out the [full tutorial and FAQ](https://go.thomasjfrank.com/guide-notion-voice-notes/) for this workflow
- If you run into a bug or problem, please [open an issue](https://github.com/TomFrankly/pipedream-notion-voice-notes/issues) on GitHub.
            `,
        },
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
        databaseID: {
			type: "string",
			label: "Notion Database",
			description: `Select the Notion database you'd like to use for your notes.\n\n*Note 1: If you don't see your desired database in the dropdown, first click the **Load More** and **Refresh Field** buttons. If it still doesn't appear, it menas Pipedream doesn't have access to the database. To fix this, navigate to the database in Notion. Click ••• → Connections, then find and add Pipedream. Finally, refresh this page.*\n\n*Note 2: If you're using my [Ultimate Brain template](https://thomasjfrank.com/brain/), you'll likely want to use the **Notes** database. If you have multiple databases with the same name, you can find the correct one by checking the database's URL and matching the ID contained in it to the IDs below.*`,
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
    async additionalProps(previousPropDefs) {
        let props = { ...previousPropDefs };

        try {
            if (!this.databaseID) return props;
            
            const notion = new Client({
                auth: this.notion.$auth.oauth_access_token,
            });

            const database = await notion.databases.retrieve({
                database_id: this.databaseID,
            });

            const properties = database.properties;

            // Define all properties upfront
            props = {
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
                            `Choose the value for your note title. Defaults to an AI-generated title based off of the first summarized chunk from your transcription. You can also choose to use the audio file name, or both. If you pick both, the title will be in the format "File Name – AI Title".\n\n**Note:** If you didn't set an AI Service in the Transcribe_Summarize step, your title will be the audio file name even if you choose "AI Generated Title" here. Without an AI Service, the previous step is unable to generate a title.\n\n**Advanced:** You can also construct a custom title by choosing the *Enter a custom expression* tab and building an expression that evaluates to a string. `,
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
                        `Select the duration property for your database. This must be a Number-type property. Duration will be expressed in **seconds**.\n\n*Note: You can easily create a formula-type property to format the duration into HH:MM:SS format. [See this example](https://thomasjfrank.com/docs/ultimate-brain/databases/notes/#duration) for the formula code.*`,
                    options: Object.keys(properties)
                        .filter((k) => properties[k].type === "number")
                        .map((prop) => ({ label: prop, value: prop })),
                    optional: true,
                },
                noteTag: {
                    type: "string",
                    label: "Note Tag",
                    description:
                        `Choose a Select-type property for tagging your note (e.g. tagging it as "AI Transcription").\n\n*Note: This option only supports Select-type properties. If you want to set other property types, such as a Multi-Select or Status property, add a Notion → Update Page step after this step. Set the Page ID value to the **{{steps.Send_to_Notion.$return_value.apiResponse.id}}** path.*`,
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
                toggleHeaders: {
                    type: "string[]",
                    label: "Use Toggle Headers",
                    description: "Select the sections for which you'd like to use Toggle Heading blocks.",
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
                            label: "Original-Language Transcript",
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
                    optional: true,
                },
                compressTranscripts: {
                    type: "boolean",
                    label: "Compress Transcripts",
                    description: `If true, content in the Transcript and Original-Language Transcript (if present) sections will be compressed into as few blocks as possible, resulting in far fewer calls to the Notion API.\n\nWhen disabled, each paragraph in the Transcript and Original-Language Transcript sections will be its own block.\n\nThis option can be useful if you're transcribing very long audio files. If you're running into timeout issues with this Send to Notion step, try setting this to true.`,
                    default: false,
                    optional: true,
                },
                compressTimestamps: {
                    type: "boolean",
                    label: "Compress Timestamps",
                    description: `If true, content in the Timestamped Transcript section will be compressed into as few blocks as possible, resulting in far fewer calls to the Notion API.\n\nWhen disabled, each paragraph in the Timestamped Transcript section will be its own block.\n\nThis option can be useful if you're transcribing very long audio files. If you're running into timeout issues with this Send to Notion step, try setting this to true.`,
                    default: false,
                    optional: true,
                },
                giveMeMoreControl: {
                    type: "boolean",
                    label: "Give Me More Control 👷",
                    description: "Set this to true to activate a bunch of additional settings. Defaults to false.",
                    default: false,
                    optional: true,
                    reloadProps: true,
                },
                compressionThreshold: {
                    type: "integer",
                    label: "Compression Threshold",
                    description: "If set, the Compress Transcripts and Compress Timestamps options will only be used if the section's content contains more than this many blocks. Leave this blank or set it to 0 to disable the threshold.",
                    optional: true,
                    hidden: !this.giveMeMoreControl,
                    disabled: !this.giveMeMoreControl
                },
                headerType: {
                    type: "string",
                    label: "Header Type",
                    description: `Choose the type of header to use for each section. Defaults to **heading_1**.`,
                    options: ["heading_1", "heading_2", "heading_3"],
                    default: "heading_1",
                    optional: true,
                    hidden: !this.giveMeMoreControl,
                    disabled: !this.giveMeMoreControl
                },
                sectionOrder: {
                    type: "object",
                    label: "Section Order",
                    description: `If set, the order of the sections in the note will be as specified in the object. Keys must be the section names, and must match the section names shown below. Values must be the section order number, starting with 1. Defaults to the canonical order of sections, which is the following:\n* summary\n* transcript\n* original_language_transcript\n* vtt\n* main_points\n* action_items\n* follow_up\n* stories\n* references\n* arguments\n* related_topics\n* chapters`,
                    optional: true,
                    hidden: !this.giveMeMoreControl,
                    disabled: !this.giveMeMoreControl
                },
                debug: {
                    type: "boolean",
                    label: "Debug",
                    description: "If true, the step will construct the Notion page object, but will not send it to Notion. Instead, it will return the constructed object itself. This can be useful for testing and debugging.",
                    default: false,
                    optional: true,
                    hidden: !this.giveMeMoreControl,
                    disabled: !this.giveMeMoreControl
                }
            };

            return props;
        } catch (error) {
            console.error("Error in additionalProps:", error);
            return props;
        }
    },
    methods: {
        createCompressedTranscript(textArray) {
            const compressedArray = [];
            let i = 0;

            // Maximum number of rich text elements to include in a single block
            const MAX_RICH_TEXT_ELEMENTS = 4;

            // Maximum length of a rich text element
            const MAX_RICH_TEXT_LENGTH = 1000;

            while (i < textArray.length) {
                const currentChunk = [];
                for (let j = 0; j < MAX_RICH_TEXT_ELEMENTS && i < textArray.length; j++) {
                    let currentString = '';
                    let first = true;
                    while (i < textArray.length) {
                        const nextPart = textArray[i] + '\n\n';
                        if ((currentString.length + nextPart.length) > MAX_RICH_TEXT_LENGTH && !first) {
                            break;
                        }
                        currentString += nextPart;
                        i++;
                        first = false;
                    }
                    if (currentString.length > 0) {
                        currentChunk.push(currentString);
                    } else {
                        // If a single textArray[i] is longer than MAX_RICH_TEXT_LENGTH, force add it and move on
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

        console.log(`Additional settings:`)
        console.log(`Included sections: ${this.includedSections}`)
        console.log(`Compress transcripts: ${this.compressTranscripts}`)
        console.log(`Compress timestamps: ${this.compressTimestamps}`)
        console.log(`Toggle headers: ${this.toggleHeaders}`)
        console.log(`Give me more control: ${this.giveMeMoreControl}`)
        
        if (this.giveMeMoreControl) {
            console.log(`Compression threshold: ${this.compressionThreshold}`)
            console.log(`Header type: ${this.headerType}`)
            console.log(`Section order: ${this.sectionOrder}`)
            console.log(`Debug: ${this.debug}`)
        }

        // First, check that 'this.steps' exists, is an object, and the object has at least one key
        if (!this.steps || typeof this.steps !== "object" || Object.keys(this.steps).length === 0) {
            throw new Error(`Previous step data is required. Please ensure the "Previous Step Data" property is set to {{steps}}.`);
        }

        console.log(`Check 1: Steps object exists and is an object with at least one key.`)

        // Next, check that 'this.steps.Transcribe_Summarize' exists and has not been renamed or removed
        if (!this.steps.Transcribe_Summarize) {
            throw new Error(`The "Previous Step Data" property is set, but it looks like there's no "Transcribe and Summarize" step in your workflow. Please ensure that you have not renamed the "Transcribe and Summarize" step or removed it. It must be named "Transcribe and Summarize" for this action step to work.`);
        }

        console.log(`Check 2: "Transcribe and Summarize" step exists and has not been renamed or removed.`)

        // Next, check that the "Transcribe and Summarize" step has a "$return_value" object, which itself should have the keys "property_values", "page_content", and "other_data"
        if (!this.steps.Transcribe_Summarize.$return_value || typeof this.steps.Transcribe_Summarize.$return_value !== "object" || !this.steps.Transcribe_Summarize.$return_value.property_values || !this.steps.Transcribe_Summarize.$return_value.page_content || !this.steps.Transcribe_Summarize.$return_value.other_data) {
            throw new Error(`The "Transcribe and Summarize" step is present, but it doesn't look like it contains any data. Please ensure you've successfully tested the "Transcribe and Summarize" step before running this step.`);
        }

        console.log(`Check 3: "Transcribe and Summarize" step has a "$return_value" object. It contains the keys "property_values", "page_content", and "other_data".`)
        console.log(`All prerequisites for running this step have been met.`)
        
        // Get the "Transcribe and Summarize" step's "$return_value" object
        const fileInfo = this.steps.Transcribe_Summarize.$return_value;

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
            } else if (this.noteTitleValue === "Both (File Name – Audio File Name)" || this.noteTitleValue === "AI Generated Title") {
                // User tried to include AI generated title, but fileInfo doesn't have an ai_title
                console.warn("AI Generated Title was selected, but the audio file does not have an AI-generated title. Using Audio File Name instead.");
                
                if (fileInfo.property_values.filename) {
                    notionData.noteTitle = fileInfo.property_values.filename;
                } else {
                    // Construct a string like "New Audio Recording (Current Date)"
                    notionData.noteTitle = `New Audio Recording (${new Date().toLocaleDateString()})`;
                }
            } else {
                // User constructed their own custom title. Try to use it.
                try {
                    notionData.noteTitle = this.noteTitleValue;
                } catch (error) {
                    console.warn("There was an error evaluating your custom note title. Using Audio File Name instead.");
                    if (fileInfo.property_values.filename) {
                        notionData.noteTitle = fileInfo.property_values.filename;
                    } else {
                        // Construct a string like "New Audio Recording (Current Date)"
                        notionData.noteTitle = `New Audio Recording (${new Date().toLocaleDateString()})`;
                    }
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

        // Default canonical order from property definition
        const defaultCanonicalSectionOrder = {
            summary: 1,
            transcript: 2,
            original_language_transcript: 3,
            vtt: 4,
            main_points: 5,
            action_items: 6,
            follow_up: 7,
            stories: 8,
            references: 9,
            arguments: 10,
            related_topics: 11,
            chapters: 12
        };

        // Check if user has provided a custom section order
        let canonicalSectionOrder = Object.keys(defaultCanonicalSectionOrder);
        try {
            if (this.sectionOrder && typeof this.sectionOrder === 'object') {
                console.log('User provided custom section order:', this.sectionOrder);
                
                // Create a new object that starts with the default order
                const customOrder = { ...defaultCanonicalSectionOrder };
                
                // First, collect all the custom order numbers and validate user input
                const customOrderNumbers = new Set();
                Object.entries(this.sectionOrder).forEach(([key, value]) => {
                    if (defaultCanonicalSectionOrder.hasOwnProperty(key)) {
                        // Try to coerce the value to a number
                        const numericValue = Number(value);
                        if (!isNaN(numericValue) && numericValue > 0) {
                            customOrder[key] = numericValue;
                            customOrderNumbers.add(numericValue);
                        } else {
                            console.log(`Invalid order number for section ${key}: ${value}. Using default order.`);
                        }
                    } else {
                        console.log(`Removing invalid section key: ${key}`);
                    }
                });

                // Find any sections that have conflicting order numbers
                const conflicts = new Map();
                Object.entries(customOrder).forEach(([section, order]) => {
                    if (!conflicts.has(order)) {
                        conflicts.set(order, [section]);
                    } else {
                        conflicts.get(order).push(section);
                    }
                });

                // Resolve conflicts by adjusting the order numbers
                conflicts.forEach((sections, order) => {
                    if (sections.length > 1) {
                        console.log(`Found conflict for order ${order} with sections: ${sections.join(', ')}`);
                        
                        // Find which sections were user-specified
                        const userSpecifiedSection = sections.find(section => 
                            this.sectionOrder && this.sectionOrder.hasOwnProperty(section)
                        );
                        
                        if (userSpecifiedSection) {
                            // If there's a user-specified section, move all other sections
                            const sectionsToMove = sections.filter(section => section !== userSpecifiedSection);
                            let nextOrder = order + 1;
                            
                            sectionsToMove.forEach(section => {
                                // Find the next available order number
                                while (customOrderNumbers.has(nextOrder)) {
                                    nextOrder++;
                                }
                                
                                console.log(`Moving section ${section} from ${order} to ${nextOrder}`);
                                customOrder[section] = nextOrder;
                                customOrderNumbers.add(nextOrder);
                                nextOrder++;
                            });
                        } else {
                            // If no user-specified section, keep the first one and move the rest
                            const [firstSection, ...sectionsToMove] = sections;
                            let nextOrder = order + 1;
                            
                            sectionsToMove.forEach(section => {
                                while (customOrderNumbers.has(nextOrder)) {
                                    nextOrder++;
                                }
                                
                                console.log(`Moving section ${section} from ${order} to ${nextOrder}`);
                                customOrder[section] = nextOrder;
                                customOrderNumbers.add(nextOrder);
                                nextOrder++;
                            });
                        }
                    }
                });

                console.log('Processed section order:', customOrder);
                
                // Create array of [section, order] pairs and sort by order number
                const orderedPairs = Object.entries(customOrder)
                    .map(([section, order]) => [section, order])
                    .sort((a, b) => a[1] - b[1]);
                
                // Extract just the section names in order
                canonicalSectionOrder = orderedPairs.map(([section]) => section);
                console.log('Using custom section order:', canonicalSectionOrder);
            }
        } catch (error) {
            console.error('Error processing custom section order:', error);
            console.log('Falling back to default section order');
        }

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
            
            // Only compress if threshold is not set, or if block count exceeds threshold
            const shouldCompress = !this.compressionThreshold || 
                                 this.compressionThreshold === 0 || 
                                 uncompressedBlockCount > this.compressionThreshold;

            if (shouldCompress) {
                // Compress the timestamped transcript
                notionData.page_content.timestamped_transcript = this.createCompressedTranscript(notionData.page_content.timestamped_transcript);

                const compressedBlockCount = notionData.page_content.timestamped_transcript.length;
                console.log(`Compressed ${uncompressedBlockCount} blocks in the Timestamped Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`);
                console.log(`Compressed timestamped transcript:`);
                // Log the first element of the compressed array
                console.log(notionData.page_content.timestamped_transcript[0]);
            } else {
                console.log(`Skipping compression of Timestamped Transcript section (${uncompressedBlockCount} blocks) as it is below the threshold of ${this.compressionThreshold} blocks`);
            }
        } else if (notionData.page_content.timestamped_transcript) {
            const uncompressedBlockCount = notionData.page_content.timestamped_transcript.length;
            console.log(`Timestamped transcript is present, but compression is disabled. Timestamped Transcript section contains ${uncompressedBlockCount} blocks. First element of uncompressed array:`);
            // Log the first element of the uncompressed array
            console.log(notionData.page_content.timestamped_transcript[0]);
        }

        // If this.compressTranscripts is true, compress transcript and original_language_transcript if present
        if (this.compressTranscripts === true) {
            if (notionData.page_content.transcript) {
                const uncompressedBlockCount = notionData.page_content.transcript.length;
                
                // Only compress if threshold is not set, or if block count exceeds threshold
                const shouldCompress = !this.compressionThreshold || 
                                     this.compressionThreshold === 0 || 
                                     uncompressedBlockCount > this.compressionThreshold;

                if (shouldCompress) {
                    // Compress the transcript
                    notionData.page_content.transcript = this.createCompressedTranscript(notionData.page_content.transcript);

                    const compressedBlockCount = notionData.page_content.transcript.length;
                    console.log(`Compressed ${uncompressedBlockCount} blocks in the Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`);
                    console.log(`Compressed transcript:`);
                    // Log the first element of the compressed array
                    console.log(notionData.page_content.transcript[0]);
                } else {
                    console.log(`Skipping compression of Transcript section (${uncompressedBlockCount} blocks) as it is below the threshold of ${this.compressionThreshold} blocks`);
                }
            }
            if (notionData.page_content.original_language_transcript) {
                const uncompressedBlockCount = notionData.page_content.original_language_transcript.length;
                
                // Only compress if threshold is not set, or if block count exceeds threshold
                const shouldCompress = !this.compressionThreshold || 
                                     this.compressionThreshold === 0 || 
                                     uncompressedBlockCount > this.compressionThreshold;

                if (shouldCompress) {
                    // Compress the original language transcript
                    notionData.page_content.original_language_transcript = this.createCompressedTranscript(notionData.page_content.original_language_transcript);

                    const compressedBlockCount = notionData.page_content.original_language_transcript.length;
                    console.log(`Compressed ${uncompressedBlockCount} blocks in the Original-Language Transcript section to ${compressedBlockCount} blocks. Block reduction: ${(uncompressedBlockCount - compressedBlockCount) / uncompressedBlockCount * 100}%`);
                    console.log(`Compressed original language transcript:`);
                    console.log(notionData.page_content.original_language_transcript[0]);
                } else {
                    console.log(`Skipping compression of Original-Language Transcript section (${uncompressedBlockCount} blocks) as it is below the threshold of ${this.compressionThreshold} blocks`);
                }
            }
        }

        // Start constructing the page content

        // For each key in notionData.page_content, add it to the page content
        Object.keys(notionData.page_content).forEach(key => {
            // Creat the header text by capitalizing the first letter of each word in the key and replacing underscores with spaces
            const headerText = key.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());

            // Determine if the header should be a toggle
            const isToggle = this.toggleHeaders && this.toggleHeaders.includes(key);

            // If the header type is set, use it. Otherwise, use the default header type.
            const headerType = this.headerType || "heading_1";

            // Create the section header
            if (isToggle) {
                page = page.startParent(headerType, headerText);
            } else {
                page = page.addBlock(headerType, headerText);
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

        // If debug is true, return the page object
        if (this.debug === true) {
            return page;
        }
        
        // Create a Notion client
        const notion = new Client({
            auth: this.notion.$auth.oauth_access_token,
        });

        // Create the page
        const response = await createPage({
            client: notion,
            data: page.content,
        })

        // Export a summary with the total number of API calls made.
        if (response.appendedBlocks && response.appendedBlocks.apiCallCount) {
            $.export("$summary", `Successfully created the page in Notion. Total API calls made: ${response.appendedBlocks.apiCallCount + 1}`);
        } else {
            $.export("$summary", `Successfully created the page in Notion. Total API calls made: 1`);
        }

        // Return the response
        return response;

    }
}