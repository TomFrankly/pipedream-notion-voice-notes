import fs from "fs"
import axios from "axios";
import splitFile from "split-file"
import FormData from "form-data"
import Bottleneck from "bottleneck"
import retry from "async-retry"

export default {
    methods: {
        checkForUUID(string) {
            const regex = /^[0-9a-fA-F]{8}(-?[0-9a-fA-F]{4}){3}-?[0-9a-fA-F]{12}$/;
            return regex.test(string);
        },

        isSupportedAudioFile(extension) {
            const supportedExtensions = [
                '.aac', '.mid', '.midi', '.mp3', '.ogg', 
                '.wav', '.wma', '.m4a', '.m4b'
            ];
            return supportedExtensions.includes(extension.toLowerCase());
        },

        async splitFileIntoPieces(filePath) {
            const MAX_PART_SIZE = 10 * 1024 * 1024; // 10MB per part
            return await splitFile.splitFileBySize(filePath, MAX_PART_SIZE);
        },

        async makeNotionRequest(config, fileSize) {
            try {
                return await retry(
                    async (bail, attempt) => {
                        try {
                            const response = await axios(config);
                            return response;
                        } catch (error) {
                            // Don't retry on 4xx errors (except 429) or 5xx errors that aren't 503
                            if (error.response) {
                                const status = error.response.status;
                                if ((status >= 400 && status < 500 && status !== 429) || 
                                    (status >= 500 && status !== 503)) {
                                    bail(error);
                                    return;
                                }
                            }
                            
                            // Log retry attempt
                            if (attempt > 1) {
                                console.log(`Retry attempt ${attempt} for ${config.url}`);
                            }
                            
                            throw error;
                        }
                    },
                    {
                        retries: 2,
                        factor: 2,
                        minTimeout: 1000,
                        maxTimeout: 5000,
                        onRetry: (error, attempt) => {
                            console.log(`Retry attempt ${attempt} failed: ${error.message}`);
                        }
                    }
                );
            } catch (error) {
                // Ensure we always return an error object that can be handled by the parent function
                if (error.response) {
                    // If we have a response, it's an API error
                    const status = error.response.status;
                    const data = error.response.data;
                    
                    // Handle specific error cases
                    if (status === 400 && data?.code === "validation_error") {
                        if (data?.message?.includes("free plan") || data?.message?.includes("exceeds the limit")) {
                            const fileSizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(2) : 'unknown';
                            throw new Error(`Your workspace is on the free plan and only supports uploads that are < 5MB. The audio file was ${fileSizeMB}MB.`);
                        }
                    }
                    
                    // For other API errors, include status and message
                    throw new Error(`Notion API error (${status}): ${data?.message || error.message}`);
                } else if (error.request) {
                    // If we have a request but no response, it's a network error
                    throw new Error(`Network error: ${error.message}`);
                } else {
                    // For other errors (like retry failures)
                    throw new Error(`Request failed: ${error.message}`);
                }
            }
        },

        async uploadFileToNotion({path, name, mime, size}) {
            // Validate input parameters
            if (!path || !name || !mime || typeof size !== 'number') {
                console.error("Invalid input parameters:", { path, name, mime, size });
                return "Error: Invalid input parameters. All parameters (path, name, mime, size) are required.";
            }

            const fileSizeMB = (size / (1024 * 1024)).toFixed(2);
            console.log(`Starting upload process for file: ${name}`);
            console.log(`File size: ${fileSizeMB} MB`);

            // Check if file exists
            if (!fs.existsSync(path)) {
                console.error(`File not found at path: ${path}`);
                return "Error: File does not exist at the specified path";
            }

            // Check if file type is supported
            if (!this.isSupportedAudioFile(mime)) {
                console.error(`Unsupported file type: ${mime}`);
                return "Error: File type not supported. Supported audio formats are: .aac, .mid, .midi, .mp3, .ogg, .wav, .wma, .m4a, .m4b";
            }

            const apiVersion = "2022-06-28";
            const MAX_SINGLE_FILE_SIZE = 20 * 1024 * 1024; // 20MB
            let uploadId;

            try {
                // Check if file needs to be split
                const needsSplitting = size > MAX_SINGLE_FILE_SIZE;
                console.log(`File needs splitting: ${needsSplitting}`);
                console.log(`File size (${fileSizeMB} MB) is ${needsSplitting ? 'greater than' : 'less than'} the ${(MAX_SINGLE_FILE_SIZE / (1024 * 1024)).toFixed(2)} MB limit`);

                if (needsSplitting) {
                    console.log("Starting multi-part upload process");
                    // Split file into pieces
                    const outputFiles = await this.splitFileIntoPieces(path);
                    const numberOfParts = outputFiles.length;
                    console.log(`File split into ${numberOfParts} parts`);

                    // Log size of each chunk
                    for (let i = 0; i < outputFiles.length; i++) {
                        const stats = fs.statSync(outputFiles[i]);
                        const chunkSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                        console.log(`Chunk ${i + 1} size: ${chunkSizeMB} MB`);
                    }

                    try {
                        // Create multi-part upload
                        const fileUpload = await this.makeNotionRequest({
                            method: "POST",
                            url: "https://api.notion.com/v1/file_uploads",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`,
                                "Notion-Version": apiVersion
                            },
                            data: {
                                mode: "multi_part",
                                number_of_parts: numberOfParts,
                                filename: name,
                            }
                        }, size);

                        uploadId = fileUpload.data.id;
                        console.log(`Created multi-part upload with ID: ${uploadId}`);

                        // Create a limiter for concurrent uploads
                        const limiter = new Bottleneck({
                            maxConcurrent: 10,
                            minTime: 100 // Add a small delay between requests
                        });

                        // Upload each part with rate limiting
                        console.log("Starting to upload file parts (max 10 concurrent uploads)...");
                        await Promise.all(
                            outputFiles.map(async (part, index) => {
                                return limiter.schedule(async () => {
                                    const stats = fs.statSync(part);
                                    const chunkSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                                    console.log(`Uploading part ${index + 1} of ${numberOfParts} (${chunkSizeMB} MB)`);
                                    const fileStream = fs.createReadStream(part);
                                    const form = new FormData();
                                    form.append('file', fileStream, {
                                        filename: part
                                    });
                                    form.append('part_number', index + 1);

                                    const response = await this.makeNotionRequest({
                                        method: "POST",
                                        url: `https://api.notion.com/v1/file_uploads/${uploadId}/send`,
                                        headers: {
                                            "Content-Type": "multipart/form-data",
                                            "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`,
                                            "Notion-Version": apiVersion
                                        },
                                        data: form
                                    }, size);
                                    console.log(`Part ${index + 1} (${chunkSizeMB} MB) uploaded successfully`);
                                    return response;
                                });
                            })
                        );

                        // Complete the multi-part upload
                        console.log("Completing multi-part upload...");
                        const completeResponse = await this.makeNotionRequest({
                            method: "POST",
                            url: `https://api.notion.com/v1/file_uploads/${uploadId}/complete`,
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`,
                                "Notion-Version": apiVersion
                            }
                        }, size);
                        console.log("Multi-part upload completed successfully");
                    } catch (error) {
                        // Clean up temporary files in case of error
                        console.log("Cleaning up temporary files due to error...");
                        for (const file of outputFiles) {
                            try {
                                fs.unlinkSync(file);
                            } catch (cleanupError) {
                                console.error(`Error cleaning up temporary file ${file}:`, cleanupError.message);
                            }
                        }
                        throw error; // Re-throw the original error
                    } finally {
                        // Clean up temporary files
                        console.log("Cleaning up temporary files...");
                        for (const file of outputFiles) {
                            try {
                                fs.unlinkSync(file);
                            } catch (cleanupError) {
                                console.error(`Error cleaning up temporary file ${file}:`, cleanupError.message);
                            }
                        }
                    }
                } else {
                    console.log("Starting single-file upload process");
                    // Single file upload
                    const fileUpload = await this.makeNotionRequest({
                        method: "POST",
                        url: "https://api.notion.com/v1/file_uploads",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`,
                            "Notion-Version": apiVersion
                        }
                    }, size);

                    uploadId = fileUpload.data.id;
                    console.log(`Created single-file upload with ID: ${uploadId}`);

                    const fileStream = fs.createReadStream(path);
                    const form = new FormData();
                    form.append('file', fileStream, {
                        filename: name
                    });

                    const uploadResponse = await this.makeNotionRequest({
                        method: "POST",
                        url: `https://api.notion.com/v1/file_uploads/${uploadId}/send`,
                        headers: {
                            "Content-Type": "multipart/form-data",
                            "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`,
                            "Notion-Version": apiVersion
                        },
                        data: form
                    }, size);
                    console.log(`Single-file upload (${fileSizeMB} MB) completed successfully`);
                }
            } catch (error) {
                console.error("Error uploading file to Notion:", error.message);
                return error.message; // Return the error message directly since makeNotionRequest now formats it properly
            }

            // Check if upload was successful
            try {
                console.log("Checking upload status...");
                const uploadStatus = await this.makeNotionRequest({
                    method: "GET",
                    url: `https://api.notion.com/v1/file_uploads/${uploadId}`,
                    headers: {
                        "Notion-Version": apiVersion,
                        "Authorization": `Bearer ${this.notion.$auth.oauth_access_token}`
                    }
                }, size);

                console.log(`Upload status: ${uploadStatus.data.status}`);
                if (uploadStatus.data.status === "uploaded") {
                    console.log(`Upload successful. Final upload ID: ${uploadId}`);
                    
                    // Clean up the original file after successful upload
                    try {
                        console.log("Cleaning up original file...");
                        fs.unlinkSync(path);
                        console.log("Original file cleaned up successfully");
                    } catch (cleanupError) {
                        console.error(`Error cleaning up original file: ${cleanupError.message}`);
                        // Don't throw the error since the upload was successful
                    }
                    
                    return uploadId;
                } else {
                    console.error(`Upload failed with status: ${uploadStatus.data.status}`);
                    return "File upload failed - upload status is not 'uploaded'";
                }
            } catch (error) {
                console.error("Error checking upload status:", error.message);
                return error.message; // Return the error message directly since makeNotionRequest now formats it properly
            }
        }
    }
}