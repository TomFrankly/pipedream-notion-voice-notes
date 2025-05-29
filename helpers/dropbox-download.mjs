import { Dropbox } from "dropbox";
import fs from "fs";
import stream from "stream";
import { promisify } from "util";
import got from "got";

export default {
    name: "Download File to TMP",
    description: "Download a specific file to the temporary directory using streaming to avoid memory issues. Memory-efficient alternative to the official PipedreamDropbox action.",
    key: "download-file-to-tmp",
    version: "0.1.1",
    type: "action",
    props: {
        dropbox: {
            type: "app",
            app: "dropbox",
        },
        path: {
            type: "string",
            label: "File Path",
            description: `The path to the file in Dropbox (e.g., '/folder/file.mp3'). This should be **{{steps.trigger.event.path_lower}}**.`,
        },
        name: {
            type: "string",
            label: "File Name",
            description: "The new name of the file to be saved, including its extension. e.g: `myFile.mp3`. This should be **{{steps.trigger.event.name}}**.",
            optional: true,
        },
    },
    methods: {
        getDropboxClient() {
            return new Dropbox({
                accessToken: this.dropbox.$auth.oauth_access_token,
            });
        },
    },
    async run({ $ }) {
        try {
            const client = this.getDropboxClient();
            
            // Get temporary download link
            const linkResponse = await client.filesGetTemporaryLink({
                path: this.path,
            });

            if (!linkResponse || !linkResponse.result) {
                throw new Error("Failed to get temporary download link from Dropbox");
            }

            const { link, metadata } = linkResponse.result;
            
            // Determine the file extension and name
            const originalName = metadata.name;
            const extension = originalName.split(".").pop();
            
            // Use provided name or original name
            const fileName = this.name || originalName;
            
            // Clean the filename to remove problematic characters
            const cleanFileName = fileName.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "");
            
            // Define the tmp file path
            const tmpPath = `/tmp/${cleanFileName}`;

            // Stream download the file to avoid memory issues
            const pipeline = promisify(stream.pipeline);
            
            console.log(`Streaming download of ${originalName} to ${tmpPath}...`);
            
            await pipeline(
                got.stream(link),
                fs.createWriteStream(tmpPath)
            );

            console.log(`File successfully downloaded and saved to ${tmpPath}`);

            // Create return object that matches the official Dropbox action format
            const result = {
                tmpPath,
                name: originalName,
                path_lower: metadata.path_lower,
                path_display: metadata.path_display,
                id: metadata.id,
                client_modified: metadata.client_modified,
                server_modified: metadata.server_modified,
                rev: metadata.rev,
                size: metadata.size,
                is_downloadable: metadata.is_downloadable,
                content_hash: metadata.content_hash,
            };

            $.export("$summary", `File successfully saved in "${tmpPath}"`);

            return result;
            
        } catch (error) {
            throw new Error(`Failed to download file: ${error.message}`);
        }
    },
}