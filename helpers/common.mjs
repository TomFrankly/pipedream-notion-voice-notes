import { jsonrepair } from "jsonrepair";
import { Client } from "@notionhq/client";

export default {
    props: {
        steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
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
	methods: {
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
		}
	}
}