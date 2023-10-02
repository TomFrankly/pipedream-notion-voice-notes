import axios from "axios";
import fs from "fs";
import stream from "stream";
import { promisify } from "util";

const pipeline = promisify(stream.pipeline);

export default {
    name: "Microsoft OneDrive – File Download",
    description: "Downloads a file from Microsoft OneDrive (using a stream) and saves it to /tmp/.",
    key: "ms-onedrive-download",
    version: "0.0.2",
    type: "action",
	props: {
		microsoft_onedrive: {
			type: "app",
			app: "microsoft_onedrive",
		},
        steps: {
            type: "object",
            label: "Previous Step Data (Set by Default)",
            description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
        },
	},
	async run({ $ }) {
		const tmpFilePath = `/tmp/${this.steps.trigger.event.name}`;
		try {
			console.log("Downloading the file to /tmp/ through a write stream...");

			const fileID = this.steps.trigger.event.id;
			const fileSize = this.steps.trigger.event.size;
			const fileName = this.steps.trigger.event.name;

			const testEventId = "52776A9ACB4F8C54!134"

			if (fileID === testEventId) {
				throw new Error(`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file (mp3 or m4a) to OneDrive, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`)
			}

			if (!fileID || !fileName) {
				throw new Error("File ID or File Name is missing");
			}

			if (fileSize > 300 * 1024 * 1024) {
				throw new Error(
					"File size is over 300mb. This workflow only supports files under 300mb;"
				);
			}

			const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileID}/content`;

			console.log(`Fetching the file: ${fileName}`);
			const response = await axios({
				method: "GET",
				url: url,
				responseType: "stream",
				headers: {
					Authorization: `Bearer ${this.microsoft_onedrive.$auth.oauth_access_token}`,
				},
			});

			const writer = fs.createWriteStream(tmpFilePath);

			console.log(`Writing the file to: ${tmpFilePath}`);
			await pipeline(response.data, writer);

			console.log("Fetched the file successfully:", tmpFilePath);
			return tmpFilePath;
		} catch (error) {
			console.error("An error occurred:", error);

			try {
				console.log(`Attempting to delete file: ${tmpFilePath}`);
				await fs.promises.unlink(tmpFilePath);
				console.log(`File deleted successfully: ${tmpFilePath}`);
			} catch (deleteError) {
				console.error("Failed to delete file:", deleteError);
			}

			throw error;
		}
	},
};
