import googleDrive from "@pipedream/google_drive";
import fs from "fs";
import stream from "stream";
import { promisify } from "util";

export default {
	name: "Google Drive – File Download",
	description:
		"Downloads a file from Google Drive (using a stream) and saves it to /tmp/.",
	key: "google-drive-download",
	version: "0.0.3",
	type: "action",
	props: {
		googleDrive,
		steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.\n\n**In this step, you can simply hit Test below, then hit Continue.** The action will download your audio file to temp storage from Google Drive, allowing the next step to send it off for transcription.`,
		},
	},
	async run({ $ }) {
		const tmpFilePath = `/tmp/${this.steps.trigger.event.name}`;

		try {
			console.log("Downloading the file to /tmp/ through a write stream...");

			const fileID = this.steps.trigger.event.id;
			const fileSize = this.steps.trigger.event.size;
			const fileName = this.steps.trigger.event.name;

			const testEventId = "2RPkE7njiIV5RaUYbaHXSi6xhTrkTKBFE"

			if (fileID === testEventId) {
				throw new Error(`Oops, this workflow won't work if you use the **Generate Test Event** button in the Trigger step. Please upload an audio file (mp3 or m4a) to Google Drive, select it from the Select Event dropdown *beneath* that button, then hit Test again on the Trigger step.`)
			}
			
			if (!fileID || !fileName) {
				throw new Error("File ID or File Name is missing");
			}

			if (fileSize > 300 * 1024 * 1024) {
				throw new Error(
					"File size is over 300mb. This workflow only supports files under 300mb;"
				);
			}

			const fileMetadata = await this.googleDrive.getFile(fileID, {
				fields: "name,mimeType",
			});

			const mimeType = fileMetadata.mimeType;
            console.log(`File MIME type: ${mimeType}`);

            // Throw error if MIME isn't mp3 or m4a

            const file = await this.googleDrive.getFile(fileID, {
                alt: "media"
            })

            const pipeline = promisify(stream.pipeline);
            console.log(`Writing the file to: ${tmpFilePath}`);
            await pipeline(file, fs.createWriteStream(tmpFilePath));
            console.log("Fetched the file successfully:", tmpFilePath);
            $.export("$summary", `Successfully downloaded the file, "${fileMetadata.name}"`);
            return fileMetadata;
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
